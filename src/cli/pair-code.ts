/**
 * Baca status pairing dari terminal lain.
 *
 * Dipakai saat daemon pairing berjalan di latar belakang (server tanpa
 * layar) dan operator perlu melihat kode terbaru tanpa menggulir log.
 *
 * Contoh:
 *   # terminal 1
 *   nohup pnpm osda:pair:daemon > pairing.log 2>&1 &
 *
 *   # terminal 2
 *   pnpm osda:pair:code
 */
import { readPairingState, prosesHidup } from './pairing-state.js'

/** Kode keluar: 0 = tertaut, 1 = tidak ada daemon, 2 = masih menunggu. */
function main(): void {
  const state = readPairingState()

  if (!state) {
    console.error('Tidak ada status pairing.')
    console.error('Jalankan daemon dulu: pnpm osda:pair:daemon')
    process.exit(1)
  }

  const hidup = prosesHidup(state.pid)
  const umur = Math.round((Date.now() - new Date(state.updatedAt).getTime()) / 1000)

  console.log('')

  if (state.phase === 'rate_limited') {
    console.log('  Status : DIBLOKIR SERVER (429 rate-overlimit)')
    console.log('')
    console.log('  Percobaan pairing dari IP ini terlalu sering.')
    console.log('  Setiap percobaan baru akan memperpanjang blokir.')
    console.log('')
    console.log('  Tunggu minimal 1 jam sebelum mencoba lagi.')
    console.log('  Lalu jalankan SATU proses saja:')
    console.log('    nohup pnpm osda:pair:daemon > pairing.log 2>&1 &')
    console.log('')
    process.exit(3)
  }

  if (state.phase === 'linked') {
    console.log('  Status : SUDAH TERTAUT')
    console.log('  Jalankan: pnpm start\n')
    process.exit(0)
  }

  if (!hidup) {
    console.log(`  Status : DAEMON MATI (pid ${state.pid})`)
    console.log(`  Fase   : ${state.phase}`)
    if (state.lastError) console.log(`  Error  : ${state.lastError}`)
    console.log('')
    console.log('  Kode di bawah sudah tidak berlaku. Jalankan ulang:')
    console.log('    pnpm osda:pair:daemon\n')
    process.exit(1)
  }

  console.log(`  Daemon : hidup (pid ${state.pid})`)
  console.log(`  Nomor  : ${state.phone ?? '(tidak diisi)'}`)
  console.log(`  Percobaan ke-${state.attempts}`)
  console.log(`  Diperbarui ${umur} detik lalu`)
  if (state.lastError) console.log(`  Catatan: ${state.lastError}`)

  if (state.code) {
    console.log('')
    console.log(`  KODE : ${state.code}`)
    console.log('')
    console.log('  Perangkat Tertaut -> Tautkan Perangkat ->')
    console.log('  "Tautkan dengan nomor telepon" -> masukkan kode di atas')
  } else {
    console.log('')
    console.log('  Belum ada kode. Tunggu sebentar lalu jalankan ulang.')
  }

  console.log('')
  process.exit(2)
}

main()