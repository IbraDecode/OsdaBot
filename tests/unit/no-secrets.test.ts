/**
 * Invarian: tidak ada kredensial sungguhan di file yang dilacak git.
 *
 * ── Kenapa ini perlu ────────────────────────────────────────────────────────
 *
 * `.env` sudah ada di `.gitignore`. Tapi `.gitignore` hanya mencegah file yang
 * **bernama** itu. Nilai kredensial bisa masuk lewat jalur lain:
 *
 *   - menyalin `DATABASE_URL` ke pesan error atau log
 *   - menempelkan kunci ke `docs/` saat sedang menulis debugging
 *   - `git add -A` setelah mengisi `.env.local` yang tidak terpakai
 *   - menyalin blok `env:` dari `docker-compose` ke dokumentasi
 *
 * Semua itu lolos `.gitignore` dan masuk riwayat **permanen**. Menghapus
 * commit tidak menghapus salinan yang sudah di-clone orang lain.
 *
 * Audit manual pada 2026-10-15 menunjukkan riwayat repo ini bersih. Tapi itu
 * hanya berlaku saat audit itu dijalankan. Yang diperiksa di sini adalah
 * **setiap commit berikutnya**, otomatis.
 *
 * ── Yang dianggap kebocoran ─────────────────────────────────────────────────
 *
 * Pola di bawah sengaja dibuat **konservatif**. Terlalu longgar menghasilkan
 * alarm palsu yang akhirnya diabaikan; terlalu sempit misses yang penting.
 * Kebocoran sekali saja tidak bisa diperbaiki, jadi lebih baik alarm yang
 * beberapa kali perlu ditinjau.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Pola kredensial sungguhan. */
const POLA: Array<{ nama: string; pola: RegExp }> = [
  { nama: 'blok kunci privat', pola: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { nama: 'kunci gaya OpenAI (sk-...)', pola: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { nama: 'JWT', pola: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/g },
  {
    nama: 'URL database dengan sandi',
    pola: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:[^@\s/]{6,}@/g,
  },
  {
    nama: 'kunci AWS',
    pola: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    nama: 'token GitHub',
    pola: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  },
  {
    nama: 'token Slack',
    pola: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    nama: 'kunci BaturPay yang terlihat nyata',
    pola: /\bbp_(?:live|prod)_[A-Za-z0-9]{20,}\b/g,
  },
  {
    nama: 'kunci S3 yang terlihat nyata',
    pola: /\bAKIA[A-Z0-9]{16}\b/g,
  },
]

/**
 * Kunci env yang **memang menyimpan kredensial**.
 *
 * Daftar ini disengaja, bukan pakai pola. Menyaring berdasarkan "nilai
 * panjang" akan menandai `BATURPAY_BASE_URL=https://baturpay.vercel.app` —
 * itu URL dokumentasi publik, bukan rahasia. Alarm palsu yang berulang
 * akhirnya diabaikan, dan invarian yang diabaikan lebih berbahaya daripada
 * tidak ada.
 */
const KUNCI_RAHASIA = [
  'DATABASE_URL',
  'DATABASE_ADMIN_URL',
  'REDIS_URL',
  'AI_API_KEY',
  'BATURPAY_API_KEY',
  'BATURPAY_WEBHOOK_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'WHATSAPP_LINK_PHONE',
  'WHATSAPP_ADMIN_PHONE',
]

/**
 * Kunci yang **bukan** rahasia meski长得 mirip.
 *
 * Dicatat eksplisit supaya ada yang menghapus berdasarkan asumsi. `APP_TIMEZONE`
 * dan `BATURPAY_BASE_URL` sudah pernah terbaca sebagai "bocor" oleh penyaring
 * dangkal — bukan karena bocor, karena memang tidak rahasia.
 */
const KUNCI_BUKAN_RAHASIA = new Set([
  'APP_TIMEZONE',
  'APP_LOCALE',
  'BATURPAY_BASE_URL',
  'AI_BASE_URL',
  'AI_MODEL',
  'WHATSAPP_SESSION_DIR',
  'STORAGE_LOCAL_DIR',
  'AWS_REGION',
  'AWS_BUCKET',
])

/**
 * Penanda bahwa nilai ini memang tiruan, bukan sungguhan.
 *
 * Fixture test boleh memakai string berbentuk kredensial — signature webhook
 * tidak bisa diuji tanpa bentuk yang benar. Yang tidak boleh adalah fixture
 * yang **terlihat hidup**.
 */
const PENANDA_TIRUAN = [
  'test',
  'uji',
  'dummy',
  'fake',
  'contoh',
  'example',
  'sample',
  'xxx',
  '000',
  'abcd',
  'placeholder',
  'notreal',
  'rahasia',
]

/** Ekstensi yang isinya biner, tidak masuk akal untuk discan teks. */
const BINAR = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.ico', '.woff', '.woff2', '.zip'])

function fileDilacak(): string[] {
  return execFileSync('git', ['ls-files'], { encoding: 'utf-8' })
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f !== '')
}

describe('invarian: tidak ada kredensial di file yang dilacak', () => {
  const files = fileDilacak()

  it('repo punya file yang dilacak (kalau kosong, audit ini diam-diam tak berguna)', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('.env tidak ikut dilacak', () => {
    const bocor = files.filter((f) => /^\.env$|\.env\.local$|\.env\..*\.local$/.test(f))
    expect(bocor, `.env ikut ter-commit: ${bocor.join(', ')}`).toEqual([])
  })

  it('.env.example tidak punya nilai kredensial yang disalin dari .env', () => {
    // Berkas contoh memang wajib ada dan memang boleh berisi bentuk kredensial.
    // Yang dilarang: nilai **kredensial** yang disalin apa adanya dari `.env`.
    //
    // Yang diperiksa hanya kunci yang benar-benar menyimpan rahasia. Kunci lain
    // seperti `APP_TIMEZONE` atau `BATURPAY_BASE_URL` sengaja tidak masuk daftar
    // ini — keduanya bukan rahasia dan akan memicu alarm palsu.
    if (!existsSync('.env.example') || !existsSync('.env')) return

    const contoh = readFileSync('.env.example', 'utf-8')
    const nyata: string[] = []

    for (const baris of readFileSync('.env', 'utf-8').split('\n')) {
      const bersih = baris.trim()
      if (bersih === '' || bersih.startsWith('#') || !bersih.includes('=')) continue

      const pisah = bersih.indexOf('=')
      const kunci = bersih.slice(0, pisah).trim()
      const nilai = bersih.slice(pisah + 1).trim().replace(/^["']|["']$/g, '')

      if (!KUNCI_RAHASIA.includes(kunci)) continue
      if (nilai.length < 8) continue
      // Sudah jelas-jelas nilai contoh, bukan isi sungguhan.
      if (!/[A-Za-z0-9]/.test(nilai)) continue
      if (PENANDA_TIRUAN.some((t) => nilai.toLowerCase().includes(t))) continue

      if (contoh.includes(nilai)) nyata.push(kunci)
    }

    expect(
      nyata,
      `nilai kredensial ini disalin dari .env ke .env.example: ${nyata.join(', ')}. ` +
        'Ganti dengan placeholder yang jelas bukan nilai sungguhan.',
    ).toEqual([])
  })

  it('daftar kunci yang bukan rahasia tidak boleh masuk daftar rahasia', () => {
    // Kalau `APP_TIMEZONE` masuk daftar rahasia, test .env.example akan
    // complain setiap kali zona waktu organisasi kebetulan sama dengan contoh.
    // Alarm palsu yang berulang adalah cara tercepat membuat invarian diabaikan.
    const tabrakan = [...KUNCI_BUKAN_RAHASIA].filter((k) => KUNCI_RAHASIA.includes(k))
    expect(tabrakan, `kunci ini ada di dua daftar: ${tabrakan.join(', ')}`).toEqual([])
  })

  it('tidak ada pola kredensial sungguhan di file yang dilacak', () => {
    const temuan: string[] = []

    for (const file of files) {
      const titik = file.lastIndexOf('.')
      if (titik >= 0 && BINAR.has(file.slice(titik).toLowerCase())) continue
      if (file === '.env.example') continue
      if (!existsSync(file)) continue

      const isi = readFileSync(file, 'utf-8')

      // `matchAll` — bukan `while (pola.exec(...))`.
      //
      // Tanpa flag `g`, `exec` selalu mengembalikan kecocokan pertama di
      // posisi yang sama dan `lastIndex` tidak pernah maju: loopWhile-nya jadi
      // tak berakhir begitu ada satu saja kecocokan. Test seperti ini hang
      // persis ketika ia paling dibutuhkan — yaitu saat menemukan kebocoran.
      const dalamTest = file.startsWith('tests/')

      for (const { nama, pola } of POLA) {
        for (const cocok of isi.matchAll(pola)) {
          // Pengecualian "ini cuma fixture" **hanya berlaku di dalam `tests/`**.
          //
          // Versi pertama menerapkannya ke semua file. Akibatnya kredensial
          // asli di dokumen yang kebetulan memuat kata "uji" atau "contoh"
          // lolos tanpa suara — persis kebocoran yang paling tidak boleh
          // lolos. Sumber dan dokumentasi tidak punya alasan apa pun untuk
          // memuat apa pun yang berbentuk kredensial, jadi di sana tidak ada
          // pengecualian sama sekali.
          if (dalamTest) {
            const sekitar = isi.slice(Math.max(0, cocok.index - 120), cocok.index + cocok[0].length + 40)
            if (PENANDA_TIRUAN.some((t) => sekitar.toLowerCase().includes(t))) continue
          }

          const baris = isi.slice(0, cocok.index).split('\n').length
          temuan.push(`${file}:${baris} — ${nama}`)
        }
      }
    }

    expect(
      temuan,
      `kredensial sungguhan terdeteksi:\n${temuan.join('\n')}\n\n` +
        'Kalau ini memang nilai tiruan, tambahkan kata test/uji/contoh di dekatnya.',
    ).toEqual([])
  })
})