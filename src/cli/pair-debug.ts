/**
 * Diagnostik pairing WhatsApp — menangkap jawaban server yang sebenarnya.
 *
 * ── Kenapa skrip ini perlu ada ───────────────────────────────────────────────
 * `sock.requestPairingCode()` memanggil `sendNode()`, bukan `query()`.
 *
 *     const requestPairingCode = async (phoneNumber) => {
 *         ...
 *         await sendNode({ tag: 'iq', ... })   // ← hanya menulis
 *         return pairingCode                    // ← selalu "berhasil"
 *     }
 *
 * `sendNode()` menulis ke WebSocket dan **tidak pernah menunggu balasan**.
 * Node `<iq type="error">` dari server tidak dicek sama sekali.
 *
 * Akibatnya: kode tetap tercetak meski server sudah menolaknya. Gejalanya
 * persis "pairing code berhasil dibuat tapi tidak bisa ditautkan", dan tidak
 * ada satu baris pun yang mengatakannya.
 *
 * Skrip ini pasang listener di `ws.on('frame', …)` — Baileys memancarkan
 * event itu untuk setiap frame yang sudah ter-dekripsi Noise, termasuk error.
 *
 * Jalankan: pnpm osda:pair --debug
 */
import { binaryNodeToString } from '@whiskeysockets/baileys'
import { env } from '../config/env.js'
import { BaileysProvider, companionBrowserIdentity, maskPhone } from '../whatsapp/baileys-provider.js'

/** Bentuk minimum socket Baileys yang kita butuhkan untuk diagnosa. */
interface SocketMinimal {
  ws: { on(event: 'frame', handler: (frame: unknown) => void): void }
}

/** Batas waktu menunggu konfirmasi di HP. */
const TIMEOUT_MS = 4 * 60 * 1000

function judul(teks: string): void {
  console.log(`\n\u2500\u2500 ${teks} ${'\u2500'.repeat(Math.max(0, 62 - teks.length))}`)
}

/**
 * Filter frame yang layak ditampilkan.
 *
 * Semua `<iq>` ke/from server ditampilkan — di situ balasan penolakan muncul.
 * Plus semua `error` dan `pair-success` yang muncul di mana saja.
 */
function layakTampil(teks: string): boolean {
  return (
    /link_code|companion|pair-success|bad-request|rate|blocked|conflict|<error|statusCode/i.test(teks)
  )
}

async function main(): Promise<void> {
  const provider = new BaileysProvider()

  // Akses internal socket. Ini skrip diagnosa sekali jalan; tidak masuk
  // jalur produksi, jadi cast di sini tidakuinsional.
  const internal = provider as unknown as { sock: SocketMinimal | null }

  let frameCount = 0
  let errorCount = 0

  judul('KONFIGURASI')
  console.log(`  Nomor bot     : ${env.WHATSAPP_LINK_PHONE ? maskPhone(env.WHATSAPP_LINK_PHONE) : '(KOSONG)'}`)
  console.log(`  Browser tuple : ${JSON.stringify(companionBrowserIdentity())}`)
  console.log(`  Session       : ${env.WHATSAPP_SESSION_DIR}`)
  console.log(`  Admin phone   : ${env.WHATSAPP_ADMIN_PHONE ? maskPhone(env.WHATSAPP_ADMIN_PHONE) : '(kosong)'}`)

  provider.on('connection', (status) => {
    console.log(`  [koneksi] ${status.state}${status.reason ? ` \u2014 ${status.reason}` : ''}`)
  })

  await provider.connect()

  // Pasang listener begitu socket terbentuk.
  const pasang = (): boolean => {
    const sock = internal.sock
    if (!sock?.ws) return false
    sock.ws.on('frame', (frame: unknown) => {
      frameCount += 1
      let teks: string
      try {
        teks = binaryNodeToString(frame as never)
      } catch {
        return
      }
      if (!layakTampil(teks)) return
      const baris = teks.split('\n').filter((b) => layakTampil(b))
      if (baris.length === 0) return
      if (/error/i.test(teks)) errorCount += 1
      judul('[server]')
      for (const b of baris.slice(0, 10)) console.log(`  ${b.slice(0, 260)}`)
    })
    return true
  }

  if (!pasang()) {
    console.error('Socket belum tersedia setelah connect().')
    process.exit(1)
  }

  // QR sebagai penanda handshake selesai (bukan status 'connected' — itu
  // hanya muncul setelah pairing BERHASIL).
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 25_000)
    const stop = provider.on('qr', () => {
      clearTimeout(timer)
      stop()
      resolve()
    })
  })

  judul('MENGIRIM PERMINTAAN PAIRING')
  try {
    const code = await provider.requestPairingCode()
    console.log(`  Kode : ${code}`)
  } catch (error) {
    console.error(`  GAGAL: ${error instanceof Error ? error.message : String(error)}`)
    await provider.disconnect().catch(() => undefined)
    process.exit(1)
  }

  console.log('\n  Sekarang masukkan kode di WhatsApp nomor bot:')
  console.log('  Perangkat Tertaut \u2192 Tautkan Perangkat \u2192 Tautkan dengan nomor telepon')
  console.log('\n  Tunggu frame dari server\u2026 (Ctrl+C untuk berhenti)\n')

  let pairBerhasil = false
  provider.on('connection', (status) => {
    if (status.reason?.includes('pairing berhasil')) pairBerhasil = true
  })

  setTimeout(() => {
    judul('RINGKASAN')
    console.log(`  Frame diterima : ${frameCount}`)
    console.log(`  Error server   : ${errorCount}`)
    console.log(`  Pair-success   : ${pairBerhasil ? 'YA' : 'TIDAK'}`)
    console.log('')
    if (errorCount > 0) {
      console.log('  \u2192 Server MENOLAK. Lihat blok [server] di atas untuk kode error.')
      console.log('    400 bad-request \u2192 companion_platform_id salah (lihat WHATSAPP-PAIRING.md)')
      console.log('    429 / rate       \u2192 IP kena limit; tunggu 15\u201360 menit sebelum coba lagi')
      console.log('    405              \u2192 throttling pairing; JANGAN ulangi sebentar')
    } else {
      console.log('  \u2192 Server tidak menolak. Kalau kode tetap gagal dipakai,')
      console.log('    kemungkinan besar bukan sisi kode \u2014 cek dari HP:')
      console.log('    \u2022 nomor bot harus punya WhatsApp terinstal & aktif')
      console.log('    \u2022 kode harus di masuk lewat "Tautkan dengan nomor telepon", bukan scan QR')
      console.log('    \u2022 jangan tutup terminal sebelum selesai')
    }
    void provider.disconnect().finally(() => process.exit(pairBerhasil ? 0 : 2))
  }, TIMEOUT_MS).unref()
}

main().catch(async (error: unknown) => {
  console.error('Diagnostik gagal:', error)
  process.exit(1)
})