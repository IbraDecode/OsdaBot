/**
 * Daemon pairing WhatsApp — proses yang bertahan sampai berhasil.
 *
 * ── Dua jebakan nyata yang sudah ditemukan lewat pengujian ──────────────────
 *
 * 1. Socket pairing punya umur terbatas, dan itu TIDAK terkait kode.
 *
 *    Server hanya mengirimSejumlah kecil "pairing ref". Baileys menghabiskannya
 *    satu per satu setiap rotasi QR:
 *
 *        const refNode = refNodes.shift()
 *        if (!refNode) {
 *            void end(new Boom('QR refs attempts ended', { statusCode: 408 }))
 *            return
 *        }
 *
 *    QR pertama hidup 60 detik, berikutnya 20 detik. Setelah ref habis —
 *    sekitar 2,5 menit — socket MATI, apa pun yang terjadi. Di Chevalier
 *    162 detik: 60 + (5 x 20).
 *
 *    Artinya: operator harus sudah siap menerima kode sebelum diminta.
 *
 * 2. Kode Pairing hanya berlaku pada socket yang membuatnya.
 *
 *    Setelah socket putus atau di-restart, kode lama mati. Kalau daemon tidak
 *    membuat kode baru tiap reconnect, operator akan offered kode yang sudah
 *    tidak berlaku — persis gejala "tidak bisa ditautkan".
 *
 * Jalankan di latar belakang (server tanpa layar):
 *   nohup pnpm osda:pair:daemon > pairing.log 2>&1 &
 *
 * Baca kode terbaru dari terminal lain:
 *   pnpm osda:pair:code
 */
import { setTimeout as delay } from 'node:timers/promises'
import { binaryNodeToString } from '@whiskeysockets/baileys'
import { env } from '../config/env.js'
import { logger } from '../observability/logger.js'
import { BaileysProvider, maskPhone } from '../whatsapp/baileys-provider.js'
import {
  describeErrorCode,
  isPairingRelevant,
  isRateLimited,
  parseErrorCode,
} from './pair-frames.js'
import { clearPairingState, writePairingState, type PairingState } from './pairing-state.js'

const log = logger.child({ module: 'pairing-daemon' })

/** Berapa lama daemon menunggu sebelum menyerah. Default 30 menit. */
const MAX_MS = Number(process.env.PAIRING_MAX_MS ?? 30 * 60 * 1000)

/** Umur perkiraan socket pairing, dari siklus ref server. */
const JEDA_SIAP_MS = 3_000

const MAX_PERCOBAAN = 40

const mulai = Date.now()

let percobaan = 0
let sudahTertaut = false
let berhenti = false
/** Cegah permintaan kode tumpang tindih saat reconnect berlapis. */
let sedangMinta = false
/**
 * Server memblokir percobaan pairing.
 *
 * PENTING: once `true`, jangan pernah mencoba pairing lagi dalam proses ini.
 * Retry saat kena 429 bukan hanya tidak berguna — itu memperpanjang blokir
 * dan membuat cooldown berikutnya lebih lama.
 */
let rateLimited = false

const state: PairingState = {
  code: null,
  phone: env.WHATSAPP_LINK_PHONE ?? null,
  phase: 'starting',
  startedAt: new Date(mulai).toISOString(),
  updatedAt: new Date().toISOString(),
  attempts: 0,
  lastError: null,
  rateLimited: false,
  pid: process.pid,
}

function simpan(): void {
  state.updatedAt = new Date().toISOString()
  try {
    writePairingState(state)
  } catch (error) {
    log.error({ err: error }, 'gagal menulis status pairing')
  }
}

const provider = new BaileysProvider()

/**
 * Berhenti karena server memblokir percobaan.
 *
 * Provider Baileys punya reconnect internal yang tidak bisa dimatikan dari
 * luar. Menutup socket lalu keluar dari proses adalah satu-satunya cara
 * benar-benar berhenti menyentuh server.
 */
async function berhentiKenaRateLimit(): Promise<never> {
  console.log('')
  console.log('  ############################################################')
  console.log('  #  SERVER MEMBLOKIR PAIRING — 429 rate-overlimit           #')
  console.log('  ############################################################')
  console.log('')
  console.log('  Percobaan pairing dari IP ini terlalu sering. WhatsApp')
  console.log('  memblokir sementara, dan setiap percobaan baru MEMPERPANJANG')
  console.log('  blokir tersebut.')
  console.log('')
  console.log('  Yang harus dilakukan:')
  console.log('    1. Jangan coba pairing lagi sekarang.')
  console.log('    2. Tunggu minimal 1 jam, lebih baik beberapa jam.')
  console.log('    3. Saat mencoba lagi, jalankan SATU proses saja:')
  console.log('         nohup pnpm osda:pair:daemon > pairing.log 2>&1 &')
  console.log('    4. Langsung masukkan kode yang diberikan.')
  console.log('')
  console.log('  Jangan menjalankan pairing code DAN QR sekaligus, dan jangan')
  console.log('  membuka beberapa proses pairing bersamaan.')
  console.log('')
  await provider.disconnect().catch(() => undefined)
  simpan()
  process.exit(3)
}

async function selesai(kodeKeluar: number, pesan: string): Promise<never> {
  berhenti = true
  simpan()
  console.log(`\n${pesan}\n`)
  await provider.disconnect().catch(() => undefined)
  clearPairingState()
  process.exit(kodeKeluar)
}

/**
 * Pasang pendengar frame mentah.
 *
 * `ws.emit('frame', frame)` dipancarkan Baileys untuk setiap frame yang sudah
 * ter-dekripsi Noise. Ini satu-satunya tempat kita bisa melihat node
 * `<error>` yang tidak pernah disentuh `requestPairingCode()` — fungsi itu
 * memakai `sendNode()` yang hanya menulis, tanpa menunggu balasan.
 *
 * Tanpa ini, penolakan server benar-benar tidak terlihat di mana pun.
 */
function pasangPendengarFrame(): void {
  const internal = provider as unknown as {
    sock: { ws: { on(event: 'frame', handler: (frame: unknown) => void): void } } | null
  }

  const sock = internal.sock
  if (!sock?.ws) {
    log.warn('socket belum tersedia, pendengar frame tidak dipasang')
    return
  }

  sock.ws.on('frame', (frame: unknown) => {
    let teks: string
    try {
      teks = binaryNodeToString(frame as never)
    } catch {
      return
    }

    // Hanya yang relevan dengan pairing atau penolakan.
    if (!isPairingRelevant(teks)) return

    const baris = teks.split('\n').filter((b) => b.trim() && !/^\s*$/.test(b))
    console.log('')
    console.log('  ── [SERVER] ──')
    for (const b of baris.slice(0, 8)) console.log(`  ${b.slice(0, 240)}`)
    console.log('')

    // Status kegagalan yang bisa ditindaklanjuti.
    //
    // Pembacaan kode TIDAK ditulis inline di sini — dipakai dari
    // `./pair-frames.js` supaya format kutip tunggal bisa diuji terhadap
    // output Baileys sungguhan. Versi inline pernah salah (`code=".."`
    // padahal Baileys mencetak `code='..'`) dan karena itu guard rate limit
    // tidak pernah aktif.
    const kode = parseErrorCode(teks)
    if (kode) {
      state.lastError = describeErrorCode(kode)
      simpan()
      console.log(`  >> ${state.lastError}\n`)
    }

    // 429 harus menghentikan segalanya, bukan memicu retry.
    if (isRateLimited(teks) && !rateLimited) {
      rateLimited = true
      state.phase = 'rate_limited'
      state.rateLimited = true
      state.code = null
      state.lastError =
        'Server memblokir percobaan pairing (429 rate-overlimit). ' +
        'Terlalu banyak percobaan dari IP ini.'
      simpan()
      void berhentiKenaRateLimit()
      return
    }

    if (/pair-success/i.test(teks)) {
      console.log('  >> Server mengonfirmasi pairing. Menyelesaikan registrasi...\n')
    }
  })
}

provider.on('pairingCode', (code) => {
  percobaan += 1
  state.attempts = percobaan
  state.code = code
  state.phase = 'waiting_scan'
  state.lastError = null
  simpan()

  console.log('')
  console.log(`  +${'-'.repeat(58)}+`)
  console.log(`  |  KODE PAIRING : ${code}${' '.repeat(Math.max(0, 45 - code.length))}|`)
  console.log(`  |  Nomor bot    : ${env.WHATSAPP_LINK_PHONE ?? '-'}${' '.repeat(Math.max(0, 33 - (env.WHATSAPP_LINK_PHONE?.length ?? 14)))}|`)
  console.log('  |')
  console.log('  |  SEKARANG, di WhatsApp nomor bot:')
  console.log('  |  Perangkat Tertaut -> Tautkan Perangkat')
  console.log('  |  -> "Tautkan dengan nomor telepon"')
  console.log(`  |  -> ${code}`)
  console.log('  |')
  console.log('  |  PENTING: socket pairing hidup sekitar 2,5 menit.')
  console.log('  |  Kalau gagal, baca kode BARU lalu: pnpm osda:pair:code')
  console.log('  |  Jangan jalankan proses pairing kedua.')
  console.log(`  +${'-'.repeat(58)}+`)
  console.log('')
  log.info({ percobaan }, 'kode pairing baru dibuat')
})

provider.on('connection', (status) => {
  log.info({ state: status.state, reason: status.reason }, 'status koneksi')

  if (status.state === 'connected' && !sudahTertaut) {
    sudahTertaut = true
    state.phase = 'linked'
    state.code = null
    simpan()
    console.log('\n  [*] WhatsApp tertaut. Jalankan `pnpm start` untuk menyalakan bot.\n')
    void selesai(0, 'Pairing berhasil.')
    return
  }

  if (berhenti || sudahTertaut) return
  if (status.state !== 'connecting' && status.state !== 'reconnecting') return

  // Kode lama mati bersama socket lama. Wajib minta yang baru.
  //
  // Socket baru butuh handshake lebih dulu, jadi tunggu sebentar.
  state.code = null
  state.phase = 'waiting_code'
  simpan()

  if (rateLimited) return

  setTimeout(() => {
    if (!berhenti && !sudahTertaut && !rateLimited) void mintaKode()
  }, JEDA_SIAP_MS).unref()
})

provider.onError((error, context) => {
  state.lastError = error.message
  simpan()
  log.error({ err: error, context }, 'kesalahan saat pairing')
})

/** Minta kode baru, dengan toleransi kegagalan lokal sementara. */
async function mintaKode(): Promise<void> {
  if (berhenti || sudahTertaut) return
  if (rateLimited) return
  if (sedangMinta) return
  sedangMinta = true

  try {
    if (percobaan >= MAX_PERCOBAAN) {
      state.phase = 'failed'
      state.lastError = `menyerah setelah ${MAX_PERCOBAAN} percobaan`
      simpan()
      void selesai(2, `Gagal: tidak bisa meminta kode setelah ${MAX_PERCOBAAN} percobaan.`)
      return
    }

    await provider.requestPairingCode()
  } catch (error) {
    const pesan = error instanceof Error ? error.message : String(error)

    // Sudah tertaut — itu keberhasilan, bukan kegagalan.
    if (/sudah tertaut/i.test(pesan)) return

    // Jangan retry kalau server sedang membatasi.
    if (/limit|429|throttl/i.test(pesan)) {
      rateLimited = true
      state.phase = 'rate_limited'
      state.rateLimited = true
      simpan()
      void berhentiKenaRateLimit()
      return
    }

    percobaan += 1
    state.attempts = percobaan
    state.lastError = pesan
    simpan()
    log.warn({ err: pesan }, 'gagal meminta kode, akan coba lagi')
    setTimeout(() => {
      if (!rateLimited) void mintaKode()
    }, 5_000).unref()
  } finally {
    sedangMinta = false
  }
}

async function main(): Promise<void> {
  console.log('')
  console.log('  Daemon pairing WhatsApp')
  console.log(`  Nomor bot   : ${env.WHATSAPP_LINK_PHONE ? maskPhone(env.WHATSAPP_LINK_PHONE) : '(KOSONG)'}`)
  console.log(`  Batas waktu : ${Math.round(MAX_MS / 60_000)} menit`)
  console.log('')

  if (!env.WHATSAPP_LINK_PHONE) {
    console.error('  WHATSAPP_LINK_PHONE kosong — tidak ada nomor bot untuk ditautkan.\n')
    process.exit(1)
  }

  simpan()
  await provider.connect()
  pasangPendengarFrame()

  // Tunggu handshake selesai. QR adalah buktinya — status `connected` hanya
  // muncul setelah pairing BERHASIL, jadi tidak bisa dipakai sebagai penanda.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, JEDA_SIAP_MS)
    const stop = provider.on('qr', () => {
      clearTimeout(timer)
      stop()
      resolve()
    })
  })

  await delay(2_000)
  await mintaKode()
}

const pengawas = setTimeout(() => {
  state.phase = 'failed'
  state.lastError = 'batas waktu habis'
  simpan()
  void selesai(2, 'Batas waktu habis. Pairing belum selesai.')
}, MAX_MS)

process.on('SIGINT', () => void selesai(130, 'Dihentikan operator (Ctrl+C).'))
process.on('SIGTERM', () => void selesai(143, 'Dihentikan sistem.'))

main().catch((error: unknown) => {
  state.phase = 'failed'
  state.lastError = error instanceof Error ? error.message : String(error)
  simpan()
  console.error('\n  Daemon gagal:', error, '\n')
  clearInterval(pengawas)
  process.exit(1)
})