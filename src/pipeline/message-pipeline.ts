/**
 * Message Pipeline — filter dan routing pesan sebelum sampai ke agent.
 *
 * Fungsinya:
 *  1. Deduplikasi. WhatsApp sering mengirim ulang event yang sama (reconnect,
 *     resync offline). Satu pesan harus diproses SATU KALI.
 *  2. Kebijakan aktivasi grup. Bot TIDAK boleh membalas semua pesan grup.
 *  3. Rate limit per aktor.
 *  4. Penyaringan konten yang tidak diproses.
 *
 * Semua iniDeterministic — tidak butuh AI. Menghemat token dan bikin perilaku
 * bisa diprediksi.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { GroupActivationPolicy } from '@prisma/client'
import { prisma } from '../database/client.js'
import { env } from '../config/env.js'
import { logger } from '../observability/logger.js'
import type { NormalizedMessage } from '../whatsapp/types.js'
import { normalizeJid, parseJid } from '../whatsapp/jid.js'

const log = logger.child({ module: 'pipeline' })

export type IncomingDecision =
  | { action: 'process'; reason: string }
  | { action: 'skip'; reason: string; debug?: Record<string, unknown> }

/** Rate limit sederhana berbasis sliding window in-memory. */
class SlidingWindowLimiter {
  private readonly buckets = new Map<string, number[]>()

  constructor(private readonly limitPerMinute: number) {}

  /** True kalau masih boleh; kalau tidak, kembalikan waktu tunggu (ms). */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now()
    const cutoff = now - 60_000

    const timestamps = (this.buckets.get(key) ?? []).filter((time) => time > cutoff)

    if (timestamps.length >= this.limitPerMinute) {
      const oldest = timestamps[0] ?? now
      this.buckets.set(key, timestamps)
      return { allowed: false, retryAfterMs: Math.max(0, oldest + 60_000 - now) }
    }

    timestamps.push(now)
    this.buckets.set(key, timestamps)

    // Bersihkan bucket yang sudah tua supaya tidak tumbuh tanpa batas.
    if (this.buckets.size > 5_000) {
      for (const [bucketKey, values] of this.buckets) {
        if (values.every((time) => time <= cutoff)) this.buckets.delete(bucketKey)
      }
    }

    return { allowed: true, retryAfterMs: 0 }
  }

  reset(): void {
    this.buckets.clear()
  }
}

export interface PipelineDeps {
  prisma?: typeof prisma
  botName?: string
  messageRateLimit?: number
  /**
   * Dicatat setiap kali pesan grup ditolak karena grupnya belum tertaut.
   *
   * Tanpa ini, operator tidak akan pernah tahu JID grup mana yang perlu
   * ditautkan — bot terlihat "rusak" tanpa penjelasan apa pun.
   */
  onUnlinkedGroup?: (message: NormalizedMessage) => Promise<void>
}

/** Kata pemicu yang mengaktifkan bot di grup. */
const ACTIVATION_PATTERNS = [
  /^\s*[!/.]?(osda|osdabot|bot)\b/i,
  /\bosda\b/i,
]

export class MessagePipeline {
  private readonly prisma: typeof prisma
  private readonly botName: string
  private readonly limiter: SlidingWindowLimiter
  private readonly seen = new Map<string, number>()
  private readonly onUnlinkedGroup: ((message: NormalizedMessage) => Promise<void>) | null

  constructor(deps: PipelineDeps = {}) {
    this.prisma = deps.prisma ?? prisma
    this.botName = deps.botName ?? env.WHATSAPP_BOT_NAME
    this.limiter = new SlidingWindowLimiter(deps.messageRateLimit ?? env.RATE_LIMIT_MESSAGES_PER_MINUTE)
    this.onUnlinkedGroup = deps.onUnlinkedGroup ?? null
  }

  /**
   * Kunci dedupe.
   *
   * Cukup `accountId + messageId` — ID pesan WhatsApp unik per akun. Menambahkan
   * isi pesan ke kunci akan gagal dedupe kalau ada edit/retry dengan isi beda.
   */
  static dedupeKey(message: NormalizedMessage): string {
    return createHash('sha256')
      .update(`${message.accountId}|${message.id}`)
      .digest('hex')
  }

  /** Buang kunci dedupe yang sudah lama (paging agar tidak tumbuh). */
  private pruneSeen(): void {
    if (this.seen.size < 10_000) return
    const cutoff = Date.now() - 3_600_000
    for (const [key, time] of this.seen) {
      if (time < cutoff) this.seen.delete(key)
    }
  }

  /**
   * Keputusan proses/skip, SEBELUM menyentuh AI.
   *
   * Alasan yang dikembalikan dipakai untuk log dan metrik, bukan untuk
   * dibacakan ke pengguna.
   */
  async decide(message: NormalizedMessage): Promise<IncomingDecision> {
    // 1. Jangan proses pesan kita sendiri.
    if (message.isFromMe) return { action: 'skip', reason: 'own_message' }

    // 2. Pesan kosong dilewati — kecuali yang membawa lampiran.
    //
    // PDF atau foto yang dikirim tanpa caption bukan pesan kosong: isinya
    // justru seluruh pesan. Melewatkannya membuat pengguna mengira
    // lampirannya tidak pernah sampai.
    const adaTeks = Boolean(message.text && message.text.trim() !== '')
    const adaLampiran =
      message.type === 'document' || message.type === 'image' || message.type === 'video'

    if (!adaTeks && !adaLampiran) {
      return { action: 'skip', reason: 'empty_text' }
    }

    // 3. Dedupe in-memory (lapisan cepat, sebelum query database).
    const key = MessagePipeline.dedupeKey(message)
    if (this.seen.has(key)) {
      return { action: 'skip', reason: 'duplicate_in_memory' }
    }
    this.seen.set(key, Date.now())
    this.pruneSeen()

    // 4. Rate limit per pengirim.
    const limitKey = `${message.senderJid}`
    const limit = this.limiter.check(limitKey)
    if (!limit.allowed) {
      return {
        action: 'skip',
        reason: 'rate_limited',
        debug: { retryAfterMs: limit.retryAfterMs },
      }
    }

    // 5. Kebijakan aktivasi untuk grup.
    const isGroup = parseJid(message.chatJid)?.kind === 'group'
    if (isGroup) {
      const groupDecision = await this.decideForGroup(message)
      if (groupDecision.action === 'skip') return groupDecision
      // Pertahankan alasan spesifik dari kebijakan grup ("mentioned",
      // "group_all_messages") supaya metrik tidak menggabungkan semua
      // kondisi grup jadi satu label yang tidak berguna.
      return groupDecision
    }

    return { action: 'process', reason: 'private_message' }
  }

  /**
   * Kebijakan grup.
   *
   * Default: bot hanya merespons kalau di-mention, dibalas, atau namanya
   * dipanggil. Tanpa ini bot akan membalas setiap pesan di grup — boros token
   * dan mengganggu.
   */
  private async decideForGroup(message: NormalizedMessage): Promise<IncomingDecision> {
    const groupJid = normalizeJid(message.chatJid)

    const group = groupJid
      ? await this.prisma.group.findUnique({
          where: { jid: groupJid },
          select: { activation: true, isArchived: true },
        })
      : null

    // Grup belum tertaut ke organisasi: tidak ada konteks, jangan diproses.
    //
    // Dicatat supaya operator bisa menautkannya. Melewati tanpa jejak membuat
    // bot terlihat rusak tanpa penjelasan apa pun.
    if (!group) {
      if (this.onUnlinkedGroup) {
        // Kegagalan mencatat tidak boleh menggagalkan pemrosesan pesan.
        await this.onUnlinkedGroup(message).catch(() => undefined)
      }
      return { action: 'skip', reason: 'group_not_linked' }
    }
    if (group.isArchived) return { action: 'skip', reason: 'group_archived' }

    const policy: GroupActivationPolicy = group.activation

    if (policy === 'OFF') return { action: 'skip', reason: 'group_activation_off' }

    // Kalau percakapan ini sudah dibangun dengan bot, lanjutkan boleh.
    if (message.mentionedJids.length > 0 || this.isBotMentioned(message)) {
      return { action: 'process', reason: 'mentioned' }
    }

    if (policy === 'MENTION_OR_REPLY') {
      return { action: 'skip', reason: 'group_requires_mention' }
    }

    // ALL_MESSAGES — hanya jika admin benar-benar menyalakannya.
    return { action: 'process', reason: 'group_all_messages' }
  }

  /** Apakah pesan ini memanggil nama bot? */
  private isBotMentioned(message: NormalizedMessage): boolean {
    const text = message.text ?? ''
    const names = [this.botName, 'osda', 'osdabot']

    for (const pattern of ACTIVATION_PATTERNS) {
      if (pattern.test(text)) return true
    }

    // "@NamaBot" di awal pesan.
    const atMention = new RegExp(`@?\\s*${escapeRegExp(this.botName)}\\b`, 'i')
    if (atMention.test(text)) return true

    for (const name of names) {
      if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text) && text.trim().length <= 40) {
        return true
      }
    }

    return false
  }

  /** Cek & tandai pesan sebagai sudah pernah diproses (persistensi database). */
  async claimMessage(message: NormalizedMessage, conversationId: string): Promise<boolean> {
    try {
      await this.prisma.message.create({
        data: {
          conversationId,
          dedupeKey: MessagePipeline.dedupeKey(message),
          waMessageId: message.id,
          senderJid: message.senderJid,
          direction: 'in',
          type: message.type,
          text: message.text,
          quotedWaId: message.quotedMessageId,
          mentionedJids: message.mentionedJids,
          timestamp: message.timestamp,
        },
      })
      return true
    } catch {
      // Pelanggaran unique constraint = pesan sudah pernah diproses.
      return false
    }
  }

  /** Ambil atau buat percakapan untuk JID chat ini. */
  async ensureConversation(chatJid: string, chatType: string, title: string | null): Promise<string> {
    const normalized = normalizeJid(chatJid) ?? chatJid

    const existing = await this.prisma.conversation.findUnique({
      where: { chatJid: normalized },
      select: { id: true },
    })
    if (existing) {
      await this.prisma.conversation.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date(), ...(title ? { title } : {}) },
      })
      return existing.id
    }

    const created = await this.prisma.conversation.create({
      data: { chatJid: normalized, chatType, title, lastMessageAt: new Date() },
      select: { id: true },
    })
    return created.id
  }

  /** Ambil N pesan terakhir untuk konteks percakapan. */
  async recentMessages(conversationId: string, limit = 12): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: { direction: true, text: true, type: true },
    })

    return rows
      .reverse()
      .filter((row) => row.text !== null && row.text !== '')
      .map((row) => ({
        role: row.direction === 'out' ? ('assistant' as const) : ('user' as const),
        content: row.text as string,
      }))
  }

  /** Bersihkan state in-memory (dipakai test). */
  reset(): void {
    this.seen.clear()
    this.limiter.reset()
  }

  newCorrelationId(): string {
    return randomUUID()
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}