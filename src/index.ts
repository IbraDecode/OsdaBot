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

  // Server yang terekspos ke jaringan tanpa token administrative akan
  // membiarkan siapa saja mematikan bot. Dan hal itu bisa terjadi tak
  // sengaja: menyalin konfigurasi dari mesin lokal ke VPS sering ikut
  // menyalin `SERVER_HOST=0.0.0.0` tanpa menyalin tokennya.
  //
  // Diberi peringatan, bukan error: `/health` dan webhook pembayaran tetap
  // berguna di jaringan, dan operator mungkin memang administering lewat
  // SSH tunnel. Yang ditolak hanya akses ke kendali tanpa token.
  if (!env.SYSTEM_ADMIN_TOKEN && bukanLoopback(env.SERVER_HOST)) {
    log.warn(
      { host: env.SERVER_HOST },
      'SERVER_HOST bukan loopback tapi SYSTEM_ADMIN_TOKEN kosong — endpoint /admin/* tidak dibuat. ' +
        'Set token kalau server ini terjangkau dari jaringan.',
    )
  }

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

  // Grup yang ditemukan dilaporkan supaya operator bisa menautkannya tanpa
  // harus menunggu ada pesan. Bot yang baru ditambahkan ke grup tidak akan
  // mengirim event apa pun sampai ada yang bicara.
  app.whatsapp.on('groupDiscovered', ({ jid, subject }) => {
    log.info({ jid, subject }, 'grup terdeteksi — jalankan pnpm osda group:link untuk menautkannya')

    // Subjek ikut disimpan. `groupFetchAllParticipating` sering mengembalikan
    // metadata tanpa `subject`, jadi event `groups.update` adalah sumber
    // subjek yang lebih lengkap — tanpa ini, grup yang tertaut tampil
    // "(tanpa subjek)" padahal namanya jelas ada.
    void app.groups
      .sinkronSubjek([{ jid, subject }])
      .then(() => app.groups.catatGrupBelumTertaut(jid, { subject }))
      .catch((error: unknown) => log.warn({ err: error, jid }, 'gagal menyimpan data grup yang terdeteksi'))
  })

  // Pindai grup saat soket benar-benar terhubung, bukan tepat setelah
  // `connect()` selesai.
  //
  // `connect()` resolve sebelum socket open. Memindai di sana gagal dengan
  // "Connection Closed" — dan karena kegagalannya ditelan diam-diam, bot
  // terlihat tidak pernah menemukan grup padahal sudah=df biasanya ada.
  let sudahPindai = false
  app.whatsapp.on('connection', (status) => {
    if (status.state !== 'connected' || sudahPindai) return
    sudahPindai = true

    void (async () => {
      try {
        const grup = await app.whatsapp.listJoinedGroups()
        const perluTaut: string[] = []
        for (const g of grup) {
          if (await app.groups.catatGrupBelumTertaut(g.jid, { subject: g.subject })) {
            perluTaut.push(`${g.subject ?? '(tanpa subjek)'} (${g.jid})`)
          }
        }
        await app.groups.sinkronSubjek(grup)
        log.info({ totalGrup: grup.length, perluTaut: perluTaut.length }, 'daftar grup diperiksa')

        if (perluTaut.length > 0) {
          log.warn(
            { grup: perluTaut },
            'ada grup yang belum tertaut — bot TIDAK akan merespons di sana sampai ditautkan',
          )
          log.warn('Tautkan dengan: pnpm osda group:link --jid=<JID> --org=<NAMA>')
        } else if (grup.length > 0) {
          log.info({ totalGrup: grup.length }, 'semua grup sudah tertaut')
        }
      } catch (error) {
        log.error({ err: error }, 'gagal memindai daftar grup')
      }
    })()
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

/** Apakah host hanya mendengarkan di mesin ini sendiri? */
function bukanLoopback(host: string): boolean {
  return !['127.0.0.1', 'localhost', '::1', '0:0:0:0:0:0:0:1'].includes(host.trim())
}

main().catch((error) => {
  logger.fatal({ err: error }, 'gagal menjalankan OSDABOT')
  process.exit(1)
})