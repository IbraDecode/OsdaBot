/**
 * Entry point aplikasi.
 *
 * Urutan boot penting:
 *  1. Validasi env (sudah terjadi di import config/env).
 *  2. Bangun modul.
 *  3. Jalankan HTTP server (health check + webhook).
 *  4. Hubungkan WhatsApp.
 *  5. Pasang shutdown handler.
 *
 * Kenapa WhatsAppConnector.connect() TIDAK-blocking? Karena kalau gagal
 * (mis. belum di-pairing), server tetap harus hidup supaya health check dan
 * CLI tetap bisa dipakai untuk diagnosis.
 */
import { bootstrap, safeConfigSummary } from './bootstrap.js'
import { env } from './config/env.js'
import { logger } from './observability/logger.js'
import { createServer } from './server.js'

const log = logger.child({ module: 'main' })

/** Batas waktu graceful shutdown sebelum proses dipaksa mati. */
const SHUTDOWN_TIMEOUT_MS = 20_000

async function main(): Promise<void> {
  log.info(safeConfigSummary(), 'memulai OSDABOT')

  const app = await bootstrap()
  const server = await createServer(app)

  // Event WhatsApp → handler.
  app.whatsapp.on('message', (message) => {
    void app.handler.handle(message).catch((error) => {
      log.error({ err: error, chatJid: message.chatJid }, 'gagal memproses pesan')
    })
  })

  app.whatsapp.on('connection', (status) => {
    log.info({ state: status.state, reason: status.reason, phoneNumber: status.phoneNumber }, 'status WhatsApp')
  })

  app.whatsapp.on('qr', (qr) => {
    // QR di-render oleh CLI (`osda whatsapp:qr`) supaya output boot tetap bersih.
    log.info('QR baru dibuat. Jalankan `pnpm osda whatsapp:qr` untuk menampilkannya.')
    void qr
  })

  app.whatsapp.on('pairingCode', (code) => {
    log.info({ code }, 'kode pairing dibuat')
  })

  app.whatsapp.onError((error, context) => {
    log.error({ err: error, context }, 'kesalahan provider WhatsApp')
  })

  // Hubungkan WhatsApp tanpa await supaya boot tidak terhenti.
  app.whatsapp
    .connect()
    .then(() => {
      log.info('koneksi WhatsApp dimulai')
    })
    .catch((error) => {
      log.error({ err: error }, 'gagal memulai koneksi WhatsApp')
    })

  log.info(
    { url: `http://${env.SERVER_HOST}:${env.SERVER_PORT}`, tools: app.tools.names().length, skills: app.skills.size() },
    'OSDABOT siap',
  )

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal }, 'menerima sinyal berhenti')

    const timer = setTimeout(() => {
      log.error('batas waktu shutdown habis, keluar paksa')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    timer.unref()

    try {
      await server.close()
      await app.shutdown()
      clearTimeout(timer)
      log.info('OSDABOT berhenti dengan bersih')
      process.exit(0)
    } catch (error) {
      log.error({ err: error }, 'gagal berhenti dengan bersih')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'unhandled rejection')
  })
  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'uncaught exception')
    void shutdown('uncaughtException')
  })
}

main().catch((error) => {
  logger.fatal({ err: error }, 'gagal menjalankan OSDABOT')
  process.exit(1)
})