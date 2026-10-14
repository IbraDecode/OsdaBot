/**
 * Normalisasi identitas WhatsApp (JID).
 *
 * ── Kenapa ini penting dan tidak bisa dilewati ──────────────────────────────
 * WhatsApp dulunya hanya memakai JID nomor telepon:
 *     6281234567890@s.whatsapp.net
 *
 * Sekarang WhatsApp juga memakai LID (Linked ID) berupa ID numerik acak:
 *     123456789012345@lid
 *
 * LID muncul karena WA menyembunyikan nomor asli (privacy). Konsekuensinya:
 *  - satu orang bisa punya PN JID *dan* LID JID;
 *  - mention harus memakai format yang cocok dengan JID yang dipakai di grup;
 *  - nomor asli bisa TIDAK diketahui sama sekali kalau kontak tidak pernah
 *    menukar nomor ("number sharing off").
 *
 * Jadi: nomor telepon BUKAN identitas yang bisa diasumsikan selalu tersedia.
 * Identitas internal OSDABOT tetap UUID di database; JID hanya identitas
 * eksternal yang dicocokkan.
 */

// Domain JID yang dikenali.
export const JID_DOMAINS = {
  /** Nomor telepon pengguna. */
  PN: 's.whatsapp.net',
  /** WhatsApp LID — identitas berbasis ID, bukan nomor. */
  LID: 'lid',
  /** Grup: 1234567890-1234567890@g.us */
  GROUP: 'g.us',
  /** Broadcast list: 1234567890@broadcast */
  BROADCAST: 'broadcast',
  /** Legacy: 628...@c.us (masih muncul di beberapa kode lama). */
  CUS: 'c.us',
} as const

export type JidKind = 'pn' | 'lid' | 'group' | 'broadcast' | 'status' | 'unknown'

/**
 * Buang device suffix yang kadang muncul di JID hasil parsing
 * (mis. `628123:12@s.whatsapp.net` → device 12).
 */
function stripDeviceSuffix(userPart: string): string {
  const colon = userPart.indexOf(':')
  return colon === -1 ? userPart : userPart.slice(0, colon)
}

export interface ParsedJid {
  /** Bagian sebelum '@', sudah dibersihkan dari device suffix. */
  user: string
  /** Bagian setelah '@', lowercase. */
  server: string
  kind: JidKind
  /** Nomor telepon ternormalisasi (hanya untuk kind 'pn'). */
  phoneNumber: string | null
}

/**
 * Pecah JID menjadi bagian-bagiannya dengan aman.
 * Input boleh `string | undefined | null` supaya pemanggil tidak perlu cek dulu.
 */
export function parseJid(jid: string | null | undefined): ParsedJid | null {
  if (typeof jid !== 'string') return null

  const trimmed = jid.trim().replace(/^@/, '')
  if (trimmed === '') return null

  // JID WAHARUS memuat '@'. Tanpa itu input bukan JID (bisa number polos atau
  // teks sembarang) — lebih baik null daripada dikira user dengan server kosong.
  const at = trimmed.indexOf('@')
  if (at <= 0) return null

  const user = stripDeviceSuffix(trimmed.slice(0, at))
  const server = trimmed.slice(at + 1).toLowerCase()

  if (user === '' || server === '') return null

  if (server === JID_DOMAINS.PN || server === JID_DOMAINS.CUS) {
    return { user, server, kind: 'pn', phoneNumber: user }
  }
  if (server === JID_DOMAINS.LID) {
    return { user, server, kind: 'lid', phoneNumber: null }
  }
  if (server === JID_DOMAINS.GROUP) {
    return { user, server, kind: 'group', phoneNumber: null }
  }
  if (server === 'status') {
    return { user, server, kind: 'status', phoneNumber: null }
  }
  if (server === JID_DOMAINS.BROADCAST) {
    return { user, server, kind: 'broadcast', phoneNumber: null }
  }
  return { user, server, kind: 'unknown', phoneNumber: null }
}

/** Buang device suffix dan normalisasi huruf besar → kecil. */
export function normalizeJid(jid: string | null | undefined): string | null {
  const parsed = parseJid(jid)
  if (!parsed) return null
  return `${parsed.user}@${parsed.server}`
}

export function isGroupJid(jid: string | null | undefined): boolean {
  return parseJid(jid)?.kind === 'group'
}

export function isUserJid(jid: string | null | undefined): boolean {
  const kind = parseJid(jid)?.kind
  return kind === 'pn' || kind === 'lid'
}

/** Ambil nomor telepon bila JID berupa PN. Null untuk LID. */
export function getPhoneNumber(jid: string | null | undefined): string | null {
  return parseJid(jid)?.phoneNumber ?? null
}

/** Format nomor internasional tanpa '+' dan tanpa spasi — dipakai untuk pairing code. */
export function toInternationalPhone(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

/**
 * Mention WhatsApp.
 *
 * - Untuk PN JID, WAqdmRecognizes `@6281234567890`.
 * - Untuk LID JID, WAqdmRecognizes `@123456789012345`.
 *
 * Teks mention harus memakai user-part dari JID yang dipakai di grup tersebut.
 * Kalau kita mengirim PN tapi grup tahu LID-nya (atau sebaliknya), mention
 * bisa tidak ter-render. Karena itu `formatMention` menerima JID apa adanya.
 */
export function formatMention(jid: string): string {
  const parsed = parseJid(jid)
  if (!parsed) return `@${jid}`
  return `@${parsed.user}`
}

/**
 * Bandingkan dua JID yang mungkin berbeda bentuk.
 *
 * Dua identitas dianggap sama kalau:
 * - JID-nya persis sama, atau
 * - keduanya PN dengan user-part sama (server c.us vs s.whatsapp.net).
 *
 * PN vs LID TIDAK bisa dianggap sama tanpa mapping resmi — inilah gunanya
 * tabel `WhatsAppIdentity` yang menyimpan kedua bentuk tersebut.
 */
export function isSameJid(a: string | null | undefined, b: string | null | undefined): boolean {
  const ja = parseJid(a)
  const jb = parseJid(b)
  if (!ja || !jb) return false
  return ja.user === jb.user && ja.server === jb.server
}

/** Buang `,g.us` / `,s.whatsapp.net` yang kadang ada di array participants. */
export function stripBroadcastSuffix(jid: string): string {
  const comma = jid.indexOf(',')
  return comma === -1 ? jid : jid.slice(0, comma)
}

/** Buang prefix 'lid:' yang kadang dipakai di konteks internal WA. */
export function stripLidPrefix(value: string): string {
  return value.startsWith('lid:') ? value.slice(4) : value
}