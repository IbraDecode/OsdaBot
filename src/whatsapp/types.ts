/**
 * Kontrak provider WhatsApp.
 *
 * Kenapa abstraksi? Baileys adalah integrasi TIDAK RESMI. WhatsApp bisa saja
 * mengganti protokol, atau akun kena limit/ban. Dengan meletakkan semua detail Baileys
 * di balik interface ini, bagian OSDABOT lain tidak perlu tahu library apa
 * yang dipakai, dan provider alternatif bisa ditambahkan tanpa mengubah
 * modul lain.
 *
 * DAN yang lebih penting: batas eksternal (WhatsApp) tidak boleh bocor ke dalam
 * domain. Semua yang masuk ke OSDABOT dinormalisasi lebih dulu.
 */
import type { GroupActivationPolicy } from '@prisma/client'
import { normalizeJid, parseJid } from './jid.js'

/** Jenis konten yang OSDABOTunderstand. Yang lain diabaikan dengan aman. */
export type NormalizedMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'reaction'
  | 'poll'
  | 'location'
  | 'contact'
  | 'unknown'

/** Pesan yang sudah dinormalisasi — satu-satunya bentuk yang dilihat pipeline. */
export interface NormalizedMessage {
  /** ID pesan dari WhatsApp. Bergabung dengan accountId untuk dedupe. */
  id: string
  /** JID akun OSDABOT yang menerima pesan ini. */
  accountId: string
  /** JID chat tujuan/pengirim: PN untuk private, @gus untuk grup. */
  chatJid: string
  /** JID pengirim (PN atau LID). */
  senderJid: string
  /** JID grup bila pesan dari grup. */
  groupJid: string | null
  /** Nama tampilan pengirimseperti yang terlihat di WhatsApp (pushName). */
  senderPushName: string | null

  type: NormalizedMessageType
  /** Teks pesan. Untuk Reaction/Location/Contact, mungkin null. */
  text: string | null
  /** Nama file untuk dokumen/media. */
  fileName: string | null
  mimetype: string | null

  /** ID pesan yang di-quote, jika ada. */
  quotedMessageId: string | null
  /** JID yang di-mention pada pesan ini (mention eksplisit). */
  mentionedJids: string[]
  /** Nama mention tekstual seperti "@628123…" yang tidak ketemu ke JID. */
  mentionText: string[]

  timestamp: Date
  isFromMe: boolean
  /** Status pengiriman dari provider (hanya untuk pesan keluar). */
  deliveryStatus: string | null
  /** Data mentah yang tidak dimapikan — disimpan untuk keperluan debug. */
  raw: Record<string, unknown>
}

/** Metadata grup yang sudah dinormalisasi. */
export interface NormalizedGroupMetadata {
  jid: string
  subject: string | null
  description: string | null
  ownerJid: string | null
  participantCount: number | null
  participants: Array<{
    jid: string
    isAdmin: boolean
    isSuperAdmin: boolean
  }>
}

/** Hasil pengiriman. PENTING: `deliveryStatus` jujur soal apa yang diketahui. */
export type DeliveryStatus =
  /** Belum dikirim. */
  | 'pending'
  /** Sedang dikirim. */
  | 'sending'
  /** Provider MENERIMA permintaan kirim (WhatsApp sudah terima), belum tentu sampai. */
  | 'provider_accepted'
  /** Dikonfirmasi provider sudah sampai ke tujuan. */
  | 'delivered'
  /** Gagal. */
  | 'failed'
  /**
   * Hasil tidak diketahui — mis. timeout lalu proses mati.
   * WAJIB direkonsiliasi sebelum retry supaya tidak terkirim dua kali.
   */
  | 'unknown'

export interface SendTextOptions {
  /** Balas pesan tertentu (quote). */
  quotedMessageId?: string | null
  /** JID yang perlu di-mention. Teks mention dibuat otomatis. */
  mentions?: string[]
  /** JID chat tujuan. Kalau diisi, chatJid diabaikan. */
  targetJid?: string
  /** Kunci idempotensi internal supaya pengiriman ulang aman. */
  idempotencyKey?: string
}

export interface SendResult {
  /** ID pesan yang dikembalikan provider, kalau ada. */
  providerMessageId: string | null
  status: DeliveryStatus
  /** Alasan kalau gagal. */
  errorCode?: string
  errorMessage?: string
}

/** Keadaan koneksi WhatsApp. */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'auth_required'
  | 'failed'

export interface ConnectionStatus {
  state: ConnectionState
  /** Nomor akun yang terhubung (kalau ada). */
  phoneNumber: string | null
  /** Alasan status terakhir, untuk log diagnostik. */
  reason: string | null
  since: Date
}

/** Event yang dipancarkan provider. */
export interface WhatsAppProviderEvents {
  /** Pesan masuk yang sudah dinormalisasi. */
  message: (message: NormalizedMessage) => void
  /** Perubahan status koneksi. */
  connection: (status: ConnectionStatus) => void
  /** Kode pairing siap dipakai (bila metode pairing code). */
  pairingCode: (code: string) => void
  /** QR string siap ditampilkan di terminal. */
  qr: (qr: string) => void
  /**
   * Grup yang terdeteksi (bot sudah ikut, atau baru menerima update).
   *
   * Dipakai supaya operator bisa menautkan grup tanpa harus menunggu ada
   * pesan. Tanpa ini, satu-satunya cara discovering grup adalah mengirim
   * pesan dulu — dan itu membingungkan untuk operator yang baru saja
   * menambahkan bot ke grup.
   */
  groupDiscovered: (group: { jid: string; subject: string | null }) => void
}

type EventMap = {
  [K in keyof WhatsAppProviderEvents]: (...args: Parameters<WhatsAppProviderEvents[K]>) => void
}

/**
 * Interface provider WhatsApp.
 *
 * Semua implementasi WAJIB:
 * - mengembalikan NormalizedMessage (bukan objek mentah library),
 * - tidak melempar error dari dalam event handler (tangkap & log),
 * -|Expose status koneksi yang jujur.
 */
export interface WhatsAppProvider {
  readonly name: string

  /** Mulai/mulihkan koneksi. Idempoten. */
  connect(): Promise<void>
  /** Tutup koneksi dengan rapi. */
  disconnect(): Promise<void>

  getStatus(): ConnectionStatus

  sendText(chatJid: string, text: string, options?: SendTextOptions): Promise<SendResult>
  sendDocument(
    chatJid: string,
    document: { url?: string; buffer?: Buffer; filename: string; mimetype: string },
    options?: SendTextOptions,
  ): Promise<SendResult>
  sendImage(
    chatJid: string,
    image: { url?: string; buffer?: Buffer; caption?: string },
    options?: SendTextOptions,
  ): Promise<SendResult>
  reactToMessage(chatJid: string, messageId: string, emoji: string): Promise<SendResult>

  getGroupMetadata(groupJid: string): Promise<NormalizedGroupMetadata | null>
  getGroupParticipants(groupJid: string): Promise<string[]>
  getAllGroups(): Promise<NormalizedGroupMetadata[]>

  /**
   * Unduh lampiran pesan berdasarkan id pesannya.
   *
   * `null` kalau pesan sudah tidak tersimpan, lampirannya hilang di sisi
   * WhatsApp, atau ukurannya melebihi batas. Yang penting: mengembalikan
   * `Buffer` kosong **tidak pernah** berarti "berkas kosong".
   */
  downloadMediaById(messageId: string): Promise<Buffer | null>

  /**
   * Daftar grup yang diikuti akun ini, diringkas jadi JID + subjek.
   *
   * Hanya JID dan subjek yang dibutuhkan saat memindai grup yang belum
   * tertaut; sisanya sudah tersedia lewat `getAllGroups()`.
   */
  listJoinedGroups(): Promise<Array<{ jid: string; subject: string | null }>>

  on<K extends keyof WhatsAppProviderEvents>(event: K, listener: EventMap[K]): () => void
  onError(listener: (error: Error, context?: string) => void): () => void
}

// =============================================================================
// Helper bersama
// =============================================================================

/**
 * Ubah hasil `sock.getMentions()` / `mentionedJid` dari Baileys menjadi
 * JID yang bersih.
 *
 * Catatan penting: field `contextInfo.mentionedJid` bisa berisi entri dengan
 *berbentuk `{ server: 'lid', user: '...' }` pada versi Baileys terbaru. Kita terima
 * dua bentuk (string atau objek) supaya tidak rapuh saat format berubah.
 */
export function extractMentionJids(
  raw: Array<string | { server?: string; user?: string } | null | undefined>,
): string[] {
  const hasil: string[] = []

  for (const item of raw) {
    if (typeof item === 'string') {
      const jid = normalizeJid(item)
      if (jid) hasil.push(jid)
      continue
    }

    if (item && typeof item === 'object' && typeof item.user === 'string') {
      const server = typeof item.server === 'string' && item.server !== '' ? item.server : 's.whatsapp.net'
      const jid = normalizeJid(`${item.user}@${server}`)
      if (jid) hasil.push(jid)
    }
  }

  return [...new Set(hasil)]
}

/** Ambil ID pesan dari objek `key` Baileys. */
export function extractMessageKeyId(key: unknown): string | null {
  if (!key || typeof key !== 'object') return null
  const k = key as { id?: unknown; remoteJid?: unknown; fromMe?: unknown; participant?: unknown }
  if (typeof k.id !== 'string' || k.id === '') return null
  const remote = typeof k.remoteJid === 'string' ? k.remoteJid : ''
  const fromMe = k.fromMe === true
  return `${fromMe ? 'out' : 'in'}|${remote}|${k.id}`
}

/** Nama group untuk ditampilkan. Aman untuk chat private. */
export function chatDisplayName(jid: string, groupSubject?: string | null): string {
  if (parseJid(jid)?.kind === 'group') return groupSubject ?? 'Grup'
  return jid
}

/** Default aktivasi grup: konservatif — hanya kalau dipanggil. */
export const DEFAULT_GROUP_ACTIVATION: GroupActivationPolicy = 'MENTION_OR_REPLY'