/**
 * Perintah pairing WhatsApp.
 *
 * Menghubungkan socket lalu menampilkan QR ATAU meminta pairing code.
 * Dipisah dari proses utama karena ini operasi sekali jalan, bukan bagian
 * dari runtime yang berjalan terus.
 *
 * Cara pakai:
 *   pnpm osda whatsapp:pair          # tampilkan QR
 *   pnpm osda whatsapp:pair --code   # pairing code (butuh nomor bot di env)
 */
import qrcode from 'qrcode-terminal'
import { env } from '../config/env.js'
import { logger } from '../observability/logger.js'
import { BaileysProvider, maskPhone } from '../whatsapp/baileys-provider.js'
import { listSessionFiles } from '../whatsapp/session-store.js'

const log = logger.child({ module: 'pairing' })

/** Batas waktu menunggu koneksi. QR expired 60 detik pertama lalu 20 detik. */
const TIMEOUT_MS = 5 * 60 * 1000

async function main(): Promise<void> {
  const mauCode = process.argv.includes('--code')

  const files = await listSessionFiles(process.env.WHATSAPP_SESSION_DIR ?? './auth_info_baileys')
  if (files.includes('creds.json')) {
    console.log('Session sudah ada. Jalankan `pnpm osda whatsapp:logout` lebih dulu untuk menautkan ulang.')
    process.exit(0)
  }

  const provider = new BaileysProvider()

  /**
   * Tunggu socket siap menerima perintah.
   *
   * PENTING: status 'connected' (connection: 'open') HANYA terjadi setelah
   * registrasi/pairing BERHASIL — jadi tidak bisa dipakai sebagai penanda
   * socket siap. Penanda yang benar: QR berhasil dibuat (berarti handshake
   * selesai dan socket hidup), atau socket minimal sudah Several saat.
   */
  const socketSiap = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 20_000)
    timer.unref()
    const lepas = provider.on('qr', () => {
      clearTimeout(timer)
      lepas()
      resolve()
    })
  })

  // QR bisa arrive beberapa kali (WhatsApp me-rotasi QR). Cetak yang terbaru
  // dan beri tahu kalau string-nya berganti.
  //
  // Di mode pairing code, QR tidak ditampilkan sama sekali — biar output
  // terminal tetap terbaca dan tidakkencandon oleh blok QR yang terus berganti.
  let qrCount = 0
  provider.on('qr', (qr: string) => {
    if (mauCode) {
      // Tetap dihitung supaya bisa digunakan sebagai penanda socket siap.
      qrCount += 1
      return
    }
    qrCount += 1
    console.log('')
    if (qrCount > 1) console.log('── QR diperbarui, pindai ulang yang terbaru ──\n')
    qrcode.generate(qr, { small: true })
    console.log('\nPindai QR ini dari WhatsApp → Perangkat Tertaut → Tautkan Perangkat.')
  })

  provider.on('connection', (status) => {
    if (status.state === 'connected') {
      console.log('\n✓ WhatsApp terhubung.')
      console.log(`  Nomor  : ${maskPhone(status.phoneNumber ?? '')}`)
      console.log(`  Device : ${process.env.WHATSAPP_BOT_NAME ?? 'Osda'}`)
      void provider.disconnect().then(() => process.exit(0))
    } else if (status.state === 'auth_required') {
      console.error(`\n✗ Autentikasi ulang dibutuhkan (${status.reason ?? 'tidak diketahui'}).`)
      process.exit(1)
    }
  })

  provider.onError((error, context) => {
    log.error({ err: error, context }, 'kesalahan saat pairing')
  })

  await provider.connect()

  if (mauCode) {
    try {
      await socketSiap

      // Socket occasionally belum siap menerima IQ walau WebSocket sudah
      // terbuka. "Connection Closed" karena balasan belum bisa dikirim.
      // Retry terbatas lebih baik daripada langsung gagal.
      let code: string | null = null
      let errorTerakhir: unknown = null

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          code = await provider.requestPairingCode()
          break
        } catch (error) {
          errorTerakhir = error
          const pesan = error instanceof Error ? error.message : String(error)
          if (!/Connection Closed|not open|closed/i.test(pesan)) break
          await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
        }
      }

      if (!code) {
        throw new Error(
          `Gagal meminta pairing code: ${errorTerakhir instanceof Error ? errorTerakhir.message : String(errorTerakhir)}`,
        )
      }

      console.log('')
      console.log(`  Nomor bot : ${env.WHATSAPP_LINK_PHONE ?? '(tidak diisi)'}`)
      console.log(`  Kode      : ${code}`)
      console.log('')
      console.log('  1. Buka WhatsApp di nomor bot')
      console.log('  2. Perangkat Tertaut → Tautkan Perangkat')
      console.log(`  3. Masukkan kode: ${code}`)
      console.log('')
      console.log('  Menunggu konfirmasi...')
    } catch (error) {
      console.error('Gagal meminta pairing code:', error instanceof Error ? error.message : error)
      await provider.disconnect().catch(() => undefined)
      process.exit(1)
    }
  }

  setTimeout(() => {
    console.error('\n✗ Batas waktu habis sebelum berhasil terhubung.')
    void provider.disconnect().then(() => process.exit(1))
  }, TIMEOUT_MS).unref()
}

main().catch((error) => {
  console.error('Pairing gagal:', error)
  process.exit(1)
})