/**
 * Persentase balasan persetujuan.
 *
 * TUGASAN: menentukan apakah sebuah pesan WhatsApp adalah jawaban atas
 * permintaan persetujuan, atau percakapan biasa yang harus diteruskan ke agent.
 *
 * ── Aturan paling penting di sini ───────────────────────────────────────────
 * default ke "bukan balasan". Salah classifiesasi "iya" dari percakapan biasa
 * sebagai persetujuan berarti menjalankan tindakan tanpa benar-benar
 * disetujui — itu kegagalan keamanan, bukan sekadar bug UX.
 *
 * Karena itu matcher sengaja KETAT:
 *  1. Hanya pesan pendek yang dipertimbangkan.
 *  2. Harus persis cocok dengan daftar dikenal (bukan substring).
 *  3. Emoji dan tanda baca dibersihkan, tapi tidak ada tebakan lain.
 *
 * "iya" di dalam kalimat panjang TIDAK dihitung. Kalau ragu, biarkan agent
 * yang memutuskan — biayanya jauh lebih murah daripada salah menyetujui.
 */
import { createHash } from 'node:crypto'

/** Panjang maksimum pesan yang mungkin adalah balasan persetujuan. */
const MAKS_PANJANG = 40

/**
 * Balasan persetujuan — persis setelah normalisasi (huruf kecil, tanpa tanda
 * baca dan emoji).
 *
 * Sengaja TIDAK memuat kata umum secara liar — tiap kata Listed eksplisit
 * Listed eksplisit supaya reviewer bisa menilai setiap kata secara sadar.
 * supaya reviewer bisa menilai tiap kata. Menambah kata baru adalah
 * keputusan sadar, bukan hasil keyword soup.
 */
const SETUJU = new Set([
  'iya',
  'ya',
  'y',
  'yes',
  'betul',
  'benar',
  'setuju',
  'approve',
  'approved',
  'ok',
  'oke',
  'okay',
  'siap',
  'sip',
  'gas',
  'lanjut',
  'lanjutkan',
  'boleh',
  'kirim',
  'kirimkan',
  'silakan',
  'confirm',
  'konfirmasi',
  'go',
  'yes please',
])

const BATAL = new Set([
  'batal',
  'batalkan',
  'jangan',
  'jangan kirim',
  'tidak',
  'nggak',
  'enggak',
  'belum',
  'nanti',
  'nanti dulu',
  'hold',
  'reject',
  'tolak',
  'stop',
  'berhenti',
  'urungkan',
  'ganti',
  'bukan',
  'no',
  'n',
])

const BATAL_SEMUA = new Set(['batal semua', 'batalkan semua', 'stop semua', 'batal semua ya'])

export type ApprovalIntent = 'approve' | 'reject' | 'reject_all' | 'none'

/**
 * Normalisasi teks sebelum dicocokkan.
 *
 * Menghapus: huruf besar, tanda baca, emoji, dan spasi berlebih. Emoji
 *Dilempar karena WhatsApp penuh dengan reaction dan orang sering membalas
 * "✅" atau "🙏".
 */
export function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tebak niat balasan persetujuan.
 *
 * Mengembalikan `'none'` kalau tidak yakin. Default itu disengaja.
 */
export function parseApprovalIntent(text: string | null | undefined): ApprovalIntent {
  if (!text) return 'none'

  const normalized = normalizeReply(text)
  if (normalized.length === 0) return 'none'

  // Panjang adalah filter pertama. Pesan panjang selalu percakapan biasa.
  if (normalized.length > MAKS_PANJANG) return 'none'

  if (BATAL_SEMUA.has(normalized)) return 'reject_all'

  // Persis cocok, BUKAN `includes`. "iyausername" bukan persetujuan.
  if (SETUJU.has(normalized)) return 'approve'
  if (BATAL.has(normalized)) return 'reject'

  return 'none'
}

/**
 * Hash payload secara kanonik.
 *
 * `JSON.stringify` tidak stabil untuk kunci yang sama dalam urutan berbeda,
 * jadi kuncinya diurutkan lebih dulu. Tanpa ini, hash yang sama untuk payload
 * yang sama bisa gagal kalau urutan kunci berubah — dan validasi payloadHash
 * akan menolak persetujuan yang sah.
 */
export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

/** JSON dengan kunci terurut secara rekursif. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${parts.join(',')}}`
}