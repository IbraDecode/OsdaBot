/**
 * Layanan tautan grup WhatsApp ke organisasi.
 *
 * ── Kenapa ini harus disengaja ──────────────────────────────────────────────
 *
 * Menautkan grup ke organisasi berarti memberi grup itu akses ke data
 * organisasi: daftar anggota, buku kas, daftar hadir. Pesan dari JID mana saja
 * di dalam grup akan dianggap sebagai anggota yang sedang bicara kalau
 * kecocokannya berhasil.
 *
 * Jadi tautan bukan sekadar catatan. Itu pemberian izin, dan karena itu:
 *
 * 1. **Satu grup = satu organisasi.** Kolom `jid` unik global. Grup yang
 *    sama tidak boleh bisa dimiliki dua organisasi berbeda — kalau bisa, isi
 *    grup jadi dua sumber kebenaran.
 *
 * 2. **Hanya admin yang boleh menautkan.** Disebut eksplisit di CLI, bukan
 *    ditebak dari siapa yang mengetik.
 *
 * 3. **Aktivasi default `MENTION_OR_REPLY`.** Bot tidak membalas semua pesan
 *    di grup. Itu boros token dan mengganggu — dan di grup yang berisi
 *    percakapan biasa, membalas semuanya berarti menyela orang.
 *
 * 4. **Grup yang belum tertaut dicatat, bukan diabaikan diam-diam.**
 *    Kalau operator tidak tahu JID grup mana yang masuk, dia tidak akan pernah
 *    bisa menautkannya. Bot yang diam-diam membuang pesan grup adalah bot yang
 *    kelihatan "rusak" tanpa penjelasan.
 */
import type { PrismaClient } from '@prisma/client'
import { parseJid } from '../whatsapp/jid.js'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'groups' })

export class GroupLinkError extends Error {
  constructor(
    readonly code: 'INVALID_JID' | 'NOT_FOUND' | 'ALREADY_LINKED' | 'GROUP_BOUND',
    message: string,
  ) {
    super(message)
    this.name = 'GroupLinkError'
  }
}

export interface LinkGroupInput {
  organizationId: string
  /** JID grup, mis. "123456789-123456@g.us". */
  jid: string
  subject?: string | null
  purpose?: string | null
  /** Kosongkan untuk memakai default `MENTION_OR_REPLY`. */
  activation?: 'MENTION_OR_REPLY' | 'ALL_MESSAGES' | 'OFF'
}

export interface SeenGroup {
  jid: string
  subject: string | null
  /** Berapa kali pesan dari grup ini pernah masuk. */
  messageCount: number
  lastSeenAt: Date
  lastSenderName: string | null
}

export class GroupLinkService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Catat grup yang mengirim pesan tapi belum tertaut.
   *
   * Dipanggil setiap kali pesan grup ditolak karena `group_not_linked`.
   * Tanpa ini operator tidak akan pernah tahu JID mana yang perlu ditautkan —
   * dan bot terlihat rusak tanpa penjelasan apa pun.
   */
  async catatGrupBelumTertaut(
    jid: string,
    options: { subject?: string | null; senderName?: string | null } = {},
  ): Promise<boolean> {
    const parsed = parseJid(jid)
    if (parsed?.kind !== 'group') return false

    try {
      // Kalau sudah tertaut, jangan sentuh apa pun.
      const sudah = await this.prisma.group.findUnique({ where: { jid }, select: { id: true } })
      if (sudah) return false

      await this.prisma.seenGroup.upsert({
        where: { jid },
        create: {
          jid,
          subject: options.subject ?? null,
          messageCount: 1,
          lastSeenAt: new Date(),
          lastSenderName: options.senderName ?? null,
        },
        update: {
          messageCount: { increment: 1 },
          lastSeenAt: new Date(),
          // Subjek dan nama pengirim boleh berubah; yang terbaru lebih berguna.
          ...(options.subject ? { subject: options.subject } : {}),
          ...(options.senderName ? { lastSenderName: options.senderName } : {}),
        },
      })
      return true
    } catch (error) {
      // Pencatatan tidak boleh menggagalkan pemrosesan pesan.
      log.warn({ err: error, jid }, 'gagal mencatat grup yang belum tertaut')
      return false
    }
  }

  /** Grup yang pernah mengirim pesan tapi belum tertaut ke organisasi mana pun. */
  async listUnlinked(limit = 20): Promise<SeenGroup[]> {
    return this.prisma.seenGroup.findMany({
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
      select: { jid: true, subject: true, messageCount: true, lastSeenAt: true, lastSenderName: true },
    })
  }

  /** Grup yang sudah tertaut. */
  async listLinked(
    organizationId?: string,
  ): Promise<
    Array<{
      jid: string
      subject: string | null
      purpose: string | null
      activation: string
      organizationName: string
      isArchived: boolean
    }>
  > {
    const grup = await this.prisma.group.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { linkedAt: 'desc' },
      select: {
        jid: true,
        subject: true,
        purpose: true,
        activation: true,
        isArchived: true,
        organization: { select: { name: true } },
      },
    })

    return grup.map((row) => ({
      jid: row.jid,
      subject: row.subject,
      purpose: row.purpose,
      activation: row.activation,
      isArchived: row.isArchived,
      organizationName: row.organization.name,
    }))
  }

  /**
   * Perbarui subjek grup yang sudah tertaut.
   *
   * Subjek WhatsApp bisa berubah kapan saja (orang mengganti nama grup).
   * Kalau tidak disinkronkan, operator melihat subjek lama padahal grupnya
   * sudah diganti nama — dan itu membuat salah daftar.
   *
   * Hanya subjek yang disentuh. Aktivasi, arsip, dan tautan tetap milik
   * keputusan operator.
   */
  async sinkronSubjek(
    grup: Array<{ jid: string; subject: string | null }>,
  ): Promise<{ diperbarui: number }> {
    let diperbarui = 0

    for (const g of grup) {
      if (!g.subject) continue

      // `NOT: { subject: x }` TIDAK cocok untuk baris dengan `subject IS NULL`.
      // Di SQL, `NULL <> 'x'` menghasilkan NULL, bukan TRUE — jadi baris
      // subjek kosong akan lolos tanpa pernah tersimpan, persis kondisi yang
      // paling perlu diperbaiki.
      const hasil = await this.prisma.group.updateMany({
        where: { jid: g.jid, OR: [{ subject: null }, { subject: { not: g.subject } }] },
        data: { subject: g.subject },
      })
      diperbarui += hasil.count
    }

    if (diperbarui > 0) log.info({ diperbarui }, 'subjek grup disinkronkan')
    return { diperbarui }
  }

  /**
   * Hubungkan grup ke organisasi.
   *
   * Menolak kalau JID-nya bukan grup, atau grup itu sudah dimiliki
   * organisasi lain — baik pun organisasi yang sama (tautan ganda hanya
   * membuat kebingungan).
   */
  async link(input: LinkGroupInput): Promise<{ jid: string; subject: string | null; activation: string }> {
    const jid = input.jid.trim()
    const parsed = parseJid(jid)

    if (!parsed || parsed.kind !== 'group') {
      throw new GroupLinkError(
        'INVALID_JID',
        `"${jid}" bukan JID grup. Formatnya "1234567890-1234567890@g.us" (diakhiri @g.us).`,
      )
    }

    const organisasi = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true },
    })
    if (!organisasi) {
      throw new GroupLinkError('NOT_FOUND', 'Organisasi tidak ditemukan.')
    }

    const ada = await this.prisma.group.findUnique({
      where: { jid },
      select: { id: true, organizationId: true, subject: true },
    })
    if (ada) {
      throw new GroupLinkError(
        'ALREADY_LINKED',
        ada.organizationId === input.organizationId
          ? `Grup ini sudah tertaut ke organisasi ini. Gunakan "group:unlink" dulu kalau mau menautkan ulang.`
          : 'Grup ini sudah tertaut ke organisasi LAIN. Satu grup hanya boleh dimiliki satu organisasi.',
      )
    }

    const group = await this.prisma.group.create({
      data: {
        organizationId: input.organizationId,
        jid,
        subject: input.subject ?? null,
        purpose: input.purpose ?? null,
        // Default: hanya merespons kalau disebut. Bot yang membalas semua
        // pesan di grup boros token dan menyela percakapan orang.
        activation: input.activation ?? 'MENTION_OR_REPLY',
      },
      select: { jid: true, subject: true, activation: true },
    })

    // Sudah tertaut — jangan biarkan muncul lagi di daftar "belum tertaut".
    await this.prisma.seenGroup.deleteMany({ where: { jid } })

    log.info({ jid, organizationId: input.organizationId, activation: group.activation }, 'grup ditautkan')
    return group
  }

  /** Ubah kebijakan aktivasi grup yang sudah tertaut. */
  async setActivation(
    jid: string,
    activation: 'MENTION_OR_REPLY' | 'ALL_MESSAGES' | 'OFF',
  ): Promise<{ jid: string; activation: string }> {
    const ada = await this.prisma.group.findUnique({ where: { jid }, select: { id: true } })
    if (!ada) {
      throw new GroupLinkError('NOT_FOUND', `Grup "${jid}" belum tertaut. Tautkan dulu dengan group:link.`)
    }

    const group = await this.prisma.group.update({
      where: { jid },
      data: { activation },
      select: { jid: true, activation: true },
    })

    log.info({ jid, activation }, 'aktivasi grup diubah')
    return group
  }

  /**
   * Lepaskan tautan grup.
   *
   * Data grup (kehadiran, pengingat) TIDAK ikut terhapus — yang dilepas
   * hanya halamannya. Menghapus riwayat tanpa diminta adalah keputusan yang
   * harus diambil manusia, bukan efek samping dari melepas tautan.
   */
  async unlink(jid: string): Promise<boolean> {
    const hasil = await this.prisma.group.deleteMany({ where: { jid } })
    if (hasil.count === 0) {
      throw new GroupLinkError('NOT_FOUND', `Grup "${jid}" tidak tertaut.`)
    }
    log.info({ jid }, 'tautan grup dilepas')
    return true
  }
}