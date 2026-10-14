/**
 * Normalisasi nama untuk resolusi identitas.
 *
 * Ini adalah lapisan yang mencegah bug_REALISTIS yang sering terjadi di bot
 * organisasi:
 *
 *   User  : "tambahin danya"
 *   Data  : "Danya Sefti Cahyani", "Danya Putri", "Ni Ketut Danya"
 *
 * Dua pendekatan yang SALAH:
 *   (a) `name.includes('danya')` → hardcoded, rapuh, tidak mempertimbangkan alias.
 *   (b) autocomplete model tanpa batas → bisa memilih orang yang salah.
 *
 * Pendekatan OSDABOT: normalisasi kanonik (separable), lalu SISTEM yang
 * mendeteksi ambiguitas dan meminta klarifikasi.
 *
 * Prinsip: nomor urut dalam daftar BUKAN identitas. Identitas selalu UUID.
 */

/** Jabatan/gelar yang sering muncul di daftar anggota sekolah. */
const TITLE_PREFIXES = [
  'h',
  'hj',
  's',
  'sd',
  'sdr',
  'sdrs',
  'bapak',
  'bpk',
  'ibu',
  'ib',
  'kak',
  'kakak',
  'adik',
  'saudara',
]

/** Akhiran gelar. */
const TITLE_SUFFIXES = ['spd', 'mpd', 'skom', 'ssi', 'sos', 'sh', 'se', 'st', 'mtd']

/**
 * Diakritik + normalisasi whitespace.
 * "  Danya   Sefti  Cahyani " → "danya sefti cahyani"
 */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Bentuk kanonik untuk pencocokan: huruf kecil, tanpa tanda baca, tanpa gelar.
 *
 * "Bapak Danya Sefti Cahyani, S.Kom." → "danya sefti cahyani"
 */
export function canonicalizeName(value: string): string {
  let name = normalizeWhitespace(value).toLowerCase()

  // Gabung gelar bertanda titik lebih dulu ("S.Kom" → "skom"), kalau tidak
  // penghapusan titik akan memecahnya jadi dua token dan gelar tak terdeteksi.
  name = name.replace(/\b([a-z])\.([a-z]+)\b/g, '$1$2')

  // Buang tanda baca kecuali spasi.
  name = name.replace(/[.,/\\|@#_'"`~^()[\]{}<>+*=$%&]/g, ' ')
  // Buang aksen supaya "seftié" tetap cocok dengan "seftie".
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const tokens = name.split(' ').filter(Boolean)

  // Buang gelar di depan maupun di belakang.
  const filtered = tokens.filter((token, index) => {
    const diAwal = index === 0 && TITLE_PREFIXES.includes(token)
    const diAkhir = index === tokens.length - 1 && TITLE_SUFFIXES.includes(token)
    return !diAwal && !diAkhir
  })

  return filtered.join(' ')
}

/**
 * Ambil token yang bisa dipakai sebagai nama pendek / panggilan.
 *
 * Untuk nama Indonesia, nama panggilan biasanya:
 *   - salah satu nama given, ATAU
 *   - gabungan nama depan + nama tengah (mis. "Danya Sefti").
 */
export function nameTokens(value: string): string[] {
  return canonicalizeName(value).split(' ').filter((token) => token.length >= 2)
}

/**
 * Heuristik "nama panggilan" untuk pencocokan longgar.
 * Hasilnya SELALU perlu diverifikasi terhadap kandidat di database.
 */
export function nicknameCandidates(value: string): string[] {
  const tokens = nameTokens(value)
  if (tokens.length === 0) return []
  if (tokens.length === 1) return [tokens[0]!]

  const hasil: string[] = [tokens[0]!]
  // Gabung dua token pertama — sangat umum di Indonesia ("Danya Sefti").
  if (tokens.length >= 2) {
    hasil.push(`${tokens[0]}_${tokens[1]}`)
    // Bentuk "danyasefti" untuk tahan typo pemenggalan.
    hasil.push(`${tokens[0]}${tokens[1]}`)
  }
  // Nama belakang sebagai kandidat lemah (jarang dipakai sebagai panggilan,
  // tapi tetap dicatat untuk kasus "Cahyani" → "Danya Sefti Cahyani").
  const last = tokens[tokens.length - 1]
  if (last && !hasil.includes(last)) hasil.push(last)

  return [...new Set(hasil)]
}

/** searchName yang disimpan di DB supaya query tidak perlu normalisasi ulang. */
export function searchNameFor(value: string): string {
  return canonicalizeName(value)
}

/**
 * Skor kecocokan 0..1 antara nama yang diucapkan pengguna dan nama anggota.
 *
 * Digunakan untuk MENGURUTKAN kandidat, bukan untuk memutuskan secara
 * otomatis. Kalau skor teratas tidak jauh di atas skor kedua, sistem wajib
 * meminta klarifikasi.
 */
export function similarityScore(queryRaw: string, candidateRaw: string): number {
  const query = canonicalizeName(queryRaw)
  const candidate = canonicalizeName(candidateRaw)
  if (query === '' || candidate === '') return 0
  if (query === candidate) return 1

  const queryTokens = new Set(query.split(' '))
  const candidateTokens = new Set(candidate.split(' '))

  let overlap = 0
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1
      continue
    }
    // Kecocokan parsial: token kueris adalah awalan token kandidat ("dany" vs
    // "danya") atau sebaliknya. Ini umum di ketikan cepat di WhatsApp.
    for (const candidateToken of candidateTokens) {
      const shorter = token.length <= candidateToken.length ? token : candidateToken
      const longer = token.length <= candidateToken.length ? candidateToken : token
      if (shorter.length >= 3 && longer.startsWith(shorter)) {
        overlap += PREFIX_MATCH_WEIGHT
        break
      }
    }
  }

  if (queryTokens.size === 0) return 0

  // Bobot: seberapa besar bagian kueri yang cocok (penting), dikalikan how
  // lengkap penecocokan terhadap nama lengkap (menolak nama yang cuma cocok
  // satu huruf depan).
  const queryCoverage = overlap / queryTokens.size
  const candidateCoverage = overlap / candidateTokens.size

  return Math.min(1, queryCoverage * QUERY_COVERAGE_WEIGHT + candidateCoverage * CANDIDATE_COVERAGE_WEIGHT)
}

/** Kecocokan prefiks dinilai sangat tinggi: "dany" → "danya" itu hampir pasti orang yang sama. */
const PREFIX_MATCH_WEIGHT = 0.95
const QUERY_COVERAGE_WEIGHT = 0.7
const CANDIDATE_COVERAGE_WEIGHT = 0.3

/**
 * Ambang heuristik untuk memutuskan "cukup yakin" vs "harus bertanya".
 *
 * Kita sengaja konservatif. Salah bertanya jauh lebih murah daripada salah
 * mengubah data kehadiran orang yang salah.
 */
export const MATCH_THRESHOLD = 0.62

/**
 * Bandingkan kandidat dengan ambang kejelasan tertentu.
 * Mengembalikan klasifikasi, bukan hanya boolean.
 */
export type MatchCertainty =
  /** Satu kandidat jelas lebih baik → boleh diproses. */
  | 'unique'
  /** Beberapa kandidat sama-sama masuk akal → wajib klarifikasi. */
  | 'ambiguous'
  /** Tidak ada yang cocok → wajib klarifikasi. */
  | 'none'

export interface RankedCandidate<T> {
  item: T
  score: number
}

/**
 * Putuskan kandidat terbaik.
 *
 * SYARAT_UNIQUE:
 *  - skor teratas >= MATCH_THRESHOLD
 *  - selisih skor terhadap kandidat kedua >= MARGIN
 *
 * Kalau tidak, hasilnya 'ambiguous'. Ini yang mencegah "tambahin Ibra" mengubah
 * data Ibra yang salah ketika ada dua anggota bernama Ibra.
 */
export const AMBIGUITY_MARGIN = 0.18

export function decideMatch<T extends { name: string }>(
  query: string,
  candidates: T[],
): { certainty: MatchCertainty; ranked: RankedCandidate<T>[]; best?: T } {
  if (candidates.length === 0) return { certainty: 'none', ranked: [] }

  const ranked: RankedCandidate<T>[] = candidates
    .map((item) => ({ item, score: similarityScore(query, item.name) }))
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  if (!top) return { certainty: 'none', ranked }

  const runnerUp = ranked[1]
  const margin = runnerUp ? top.score - runnerUp.score : top.score

  if (top.score < MATCH_THRESHOLD) return { certainty: 'none', ranked }
  if (margin < AMBIGUITY_MARGIN) return { certainty: 'ambiguous', ranked }

  return { certainty: 'unique', ranked, best: top.item }
}

/** Bersihkan input teks dari pengguna sebelum diproses sebagai nama. */
export function cleanNameInput(value: string): string {
  return normalizeWhitespace(
    value
      // Buang sapaan & kata penghubung yang biasa muncul: "tambahin", "ubah", "sampai"
      .replace(/^\s*(tambahin|tambah|masukin|masuk|ubah|ubahin|set|jadi|jadiin|status)\s+/i, '')
      .replace(/[.,;:!?]+$/, '')
      .trim(),
  )
}