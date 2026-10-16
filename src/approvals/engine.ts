/**
 * ApprovalEngine — persetujuan yang benar-benar bisa dieksekusi dan tidak
 * bisa ditiru oleh orang lain.
 *
 * ── Binga yang dijaga engine ini ────────────────────────────────────────────
 *
 * 1. Orang yang menyetujui harus orang yang MEMINTA.
 *
 *    Di grup, siapa pun bisa mengetik. Kalau balasan "iya" diterima dari siapa
 *    saja, anggota biasa bisa menyetujui penghapusan yang diminta operator.
 *
 * 2. Balasan hanya sah dari chat asal.
 *
 *    Permintaan dikirim ke chat tertentu. Balasan dari chat lain diabaikan.
 *
 * 3. Persetujuan terikat pada payload.
 *
 *    Kalau isi payload berubah antara diminta dan disetujui, persetujuan
 *    BATAL. Tanpa ini, persetujuan "kirim ringkasan ini" bisa dipakai untuk
 *    mengirim data yang jauh lebih banyak.
 *
 * 4. Satu persetujuan hanya bisa diselesaikan SATU KALI.
 *
 *    Done lewat `updateMany` bersyarat status PENDING, jadi dua pesan "iya"
 *    yang datang bersamaan tidak bisa menjalankan tindakan dua kali.
 *
 * 5. Persetujuan punya kedaluwarsa.
 *
 *    Permintaan lama yang tidak dijawab tidak boleh bisa dipakai selamanya.
 */
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { ApprovalBroker } from '../tools/registry.js'
import type { Permission } from '../security/permissions.js'
import { logger } from '../observability/logger.js'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import { hashPayload, parseApprovalIntent, type ApprovalIntent } from './intent.js'

const log = logger.child({ module: 'approvals' })

/** Berapa lama persetujuan menunggu jawaban. Default 15 menit. */
/**
 * Masa berlaku persetujuan.
 *
 * ── Kenapa tidak `Number(process.env...)` polos ──────────────────────────────
 *
 * `APPROVAL_TTL_MS=abc` → `NaN` → `expiresAt` jadi `Invalid Date` → pencarian
 * `expiresAt: { gt: new Date() }` tidak pernah cocok. Efeknya: **semua
 * persetujuan menggantung selamanya** — tidak bisa disetujui, tidak bisa
 * kedaluwarsa, tidak ada error di boot. Satu typo di `.env` jadi outage
 * senyap.
 *
 * Semua konfigurasi lain di repo lewat `src/config/env.ts` dengan Zod. Ini
 * tidak boleh jadi pengecualian.
 */
const TTL_MS = Number.isFinite(Number(process.env.APPROVAL_TTL_MS))
  ? Number(process.env.APPROVAL_TTL_MS)
  : 15 * 60 * 1000

if (!Number.isFinite(TTL_MS) || TTL_MS <= 0) {
  log.error({ nilai: process.env.APPROVAL_TTL_MS }, 'APPROVAL_TTL_MS tidak valid, memakai bawaan 15 menit')
}

export interface ApprovalEngineDeps {
  prisma: PrismaClient
  whatsapp: WhatsAppProvider
  /** Executor tindakan yang sudah disetujui. Disuntikkan dari bootstrap. */
  executor?: ApprovalExecutor
}

/**
 * Menjalankan tindakan yang sudah disetujui.
 *
 * Sengaja interface: engine tidak boleh tahu detail tool. Dia hanya
 * menyerahkan (toolName, payload) ke lapisan yang paham tool.
 */
export interface ApprovalExecutor {
  /**
   * `approvalId` itu penting, bukan opsional.
   *
   * Dulu executor mencari sendiri baris approval yang cocok dari
   * `(toolName, correlationId)`. Itu bermasalah: satu jalan agent bisa membuat
   * **dua** approval untuk tool yang sama, jadi `findFirst` bisa mengembalikan
   * baris yang salah — termasuk yang sudah dieksekusi. Pemanggil sudah tahu
   * persis baris mana yang ia setujui, jadi menebak ulang itu murni sumber
   * kesalahan.
   *
   * `organizationId` dipakai sebagai pagar: tanpa itu, pencarian bisa
   * menjatuhkan payload milik organisasi lain.
   */
  executeApproved(input: {
    toolName: string
    payload: unknown
    correlationId: string | null
    approvalId?: string
    organizationId?: string | null
  }): Promise<{
    ok: boolean
    summary: string
  }>
}

export interface ApprovalRequestContext {
  actorUserId: string | null
  organizationId: string | null
  taskId: string | null
  permission: Permission
  actionType: string
  payload: unknown
  preview: string
  /** Chat tempat permintaan dikirim & balasan diterima. */
  chatJid?: string
  correlationId?: string | null
}

export class ApprovalEngine implements ApprovalBroker {
  constructor(private readonly deps: ApprovalEngineDeps) {}

  /**
   * Catat permintaan persetujuan lalu kirim ke pengguna.
   *
   * Selalu mengembalikan `'pending'`. Polling sambil menunggu (yang pernah
   * tercatat di kontrak lama) berarti menahan satu putaran agent selama
   * menit-menit dan tidak tahan proses restart — request yang sudah disimpan
   * di database tetap-living jauh lebih baik.
   */
  async request(context: ApprovalRequestContext): Promise<'approved' | 'rejected' | 'pending'> {
    const chatJid = context.chatJid ?? null
    const payloadHash = hashPayload(context.payload)

    const approval = await this.deps.prisma.approval.create({
      data: {
        organizationId: context.organizationId,
        taskId: context.taskId,
        requestedBy: context.actorUserId,
        requiredPermission: context.permission,
        actionType: context.actionType,
        payloadHash,
        payloadPreview: context.preview.slice(0, 2000),
        payload: (context.payload ?? null) as never,
        chatJid,
        correlationId: context.correlationId ?? null,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + TTL_MS),
      },
      select: { id: true },
    })

    log.info(
      { approvalId: approval.id, actionType: context.actionType, hasChat: chatJid !== null },
      'permintaan persetujuan dicatat',
    )

    // Tanpa chat tidak ada yang bisa menjawab. Lebih baik bilang terus terang
    // daripada menyimpan permintaan yang tidak akan pernah diselesaikan.
    if (!chatJid) {
      log.warn({ approvalId: approval.id }, 'permintaan tanpa chat tidak bisa dijawab')
      return 'pending'
    }

    await this.sendRequest(chatJid, approval.id, context.actionType, context.preview)

    return 'pending'
  }

  private async sendRequest(
    chatJid: string,
    approvalId: string,
    actionType: string,
    preview: string,
  ): Promise<void> {
    const menit = Math.round(TTL_MS / 60_000)
    const teks = [
      'Perlu persetujuan dulu sebelum aku lanjut.',
      '',
      '*Tindakan*',
      `${actionType}`,
      '',
      '*Isi*',
      preview,
      '',
      `Balas *iya* untuk lanjut atau *batal* untuk membatalkan. Berlaku ${menit} menit.`,
      `(ref ${approvalId.slice(0, 8)})`,
    ].join('\n')

    try {
      const result = await this.deps.whatsapp.sendText(chatJid, teks, {
        idempotencyKey: `approval:${approvalId}`,
      })
      if (result.status === 'failed') {
        log.error({ approvalId, errorCode: result.errorCode }, 'gagal mengirim permintaan persetujuan')
      }
    } catch (error) {
      log.error({ approvalId, err: error }, 'gagal mengirim permintaan persetujuan')
    }
  }

  /**
   * Coba perlakukan sebuah pesan sebagai balasan persetujuan.
   *
   * Mengembalikan `'none'` kalau pesan ini bukan balasan — pemanggil lalu
   * meneruskannya ke agent seperti biasa.
   */
  async tryHandleReply(input: {
    text: string | null
    chatJid: string
    actorUserId: string | null
  }): Promise<ApprovalIntent> {
    const intent = parseApprovalIntent(input.text)
    if (intent === 'none') return 'none'
    if (!input.actorUserId) {
      await this.say(input.chatJid, 'Persetujuan hanya bisa diberikan oleh orang yang meminta tindakan ini.')
      return 'reject'
    }

    const pending = await this.deps.prisma.approval.findFirst({
      where: {
        chatJid: input.chatJid,
        requestedBy: input.actorUserId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, actionType: true, payloadPreview: true, payloadHash: true, payload: true, correlationId: true },
    })

    if (!pending) {
      await this.say(
        input.chatJid,
        'Tidak ada tindakan yang menunggu persetujuan kamu sekarang. Kalau ini tidak sengaja, abaikan saja.',
      )
      return 'reject'
    }

    if (intent === 'reject_all') {
      await this.resolve(pending.id, 'REJECTED', input.actorUserId)
      await this.say(input.chatJid, 'Dibatalkan.')
      return 'reject'
    }

    if (intent === 'reject') {
      await this.resolve(pending.id, 'REJECTED', input.actorUserId)
      await this.say(input.chatJid, 'Dibatalkan. Aku tidak melakukan tindakan itu.')
      return 'reject'
    }

    return this.approve(pending, input.chatJid, input.actorUserId)
  }

  private async approve(
    pending: {
      id: string
      actionType: string
      payloadHash: string
      payload: unknown
      correlationId: string | null
    },
    chatJid: string,
    actorUserId: string,
  ): Promise<ApprovalIntent> {
    // Integritas payload: kalau isi berubah sejak diminta, persetujuan void.
    if (hashPayload(pending.payload) !== pending.payloadHash) {
      await this.resolve(pending.id, 'CANCELLED', actorUserId)
      await this.say(
        chatJid,
        'Isi tindakan sudah berubah sejak diminta, jadi persetujuan tidak berlaku. Kirim ulang perintahnya ya.',
      )
      log.warn({ approvalId: pending.id }, 'payload berubah, persetujuan dibatalkan')
      return 'reject'
    }

    // `updateMany` bersyarat PENDING = hanya satu balasan yang menang walau ada
    // dua pesan "iya" yang tiba bersamaan.
    const claimed = await this.deps.prisma.approval.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: actorUserId },
    })

    if (claimed.count === 0) {
      await this.say(chatJid, 'Tindakan itu sudah pernah ditangani sebelumnya.')
      return 'reject'
    }

    log.info({ approvalId: pending.id, actionType: pending.actionType }, 'persetujuan diberikan')

    const executor = this.deps.executor
    if (!executor) {
      await this.say(chatJid, 'Persetujuan dicatat, tapi tidak ada yang bisa menjalankan tindakannya.')
      return 'approve'
    }

    try {
      // `approvalId` dan `organizationId` diteruskan supaya executor tidak
      // perlu menebak baris mana yang disetujui.
      const result = await executor.executeApproved({
        toolName: pending.actionType,
        payload: pending.payload,
        correlationId: pending.correlationId,
        approvalId: pending.id,
        organizationId: (pending as { organizationId?: string | null }).organizationId ?? null,
      })
      await this.say(chatJid, result.ok ? result.summary : `Gagal dijalankan: ${result.summary}`)
    } catch (error) {
      log.error({ approvalId: pending.id, err: error }, 'gagal menjalankan tindakan yang disetujui')
      await this.say(chatJid, 'Ada kendala saat menjalankan tindakan itu.')
    }

    return 'approve'
  }

  private async resolve(id: string, status: 'REJECTED' | 'CANCELLED', actorUserId: string): Promise<void> {
    await this.deps.prisma.approval.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, resolvedAt: new Date(), resolvedBy: actorUserId },
    })
  }

  /** Tandai persetujuan yang lewat masa berlaku sebagai kedaluwarsa. */
  async expireStale(): Promise<number> {
    const result = await this.deps.prisma.approval.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED', resolvedAt: new Date() },
    })
    if (result.count > 0) log.info({ jumlah: result.count }, 'persetujuan kedaluwarsa')
    return result.count
  }

  /**
   * Kirim pesan sistem — dan **simpan** ke riwayat.
   *
   * ── Kenapa ini diubah ──────────────────────────────────────────────────────
   *
   * Dua hal rusak di versi lama, keduanya menutupi bug yang lebih dalam:
   *
   * 1. **Hasil pengiriman dibuang.** `sendText` tidak pernah melempar error;
   *    kegagalan dikembalikan sebagai `{ status: 'failed' | 'unknown' }`
   *    (`baileys-provider.ts` memanggil `mapSendError`, bukan `throw`). Versi
   *    lama tidak memeriksanya, jadi pesan "Gagal menjalankan: sudah ada
   *    permintaan lain yang menunggu" bisa gagal terkirim dan tidak ada yang
   *    tahu. Bot diam, dan pengguna mengira tidak ada yang terjadi.
   *
   * 2. **Pesannya tidak masuk tabel `Message`.** Semua pesan bot lain disimpan
   *    lewat `saveBotMessage`. Kalau approval tidak ikut, riwayat yang dibaca
   *    agent pada pesan berikutnya berakhir begitu saja di "iya" tanpa balasan,
   *    tanpa hasil, tanpa error — dan model tidak punya apa pun selain
   *    mengarang. Itulah asal kalimat "masih ditahan oleh sistem persetujuan".
   *
   * Sekarang pesan approval menjadi bagian dari riwayat, jadi jawaban
   * berikutnya punya dasar.
   */
  private async say(chatJid: string, text: string): Promise<void> {
    let terkirim: boolean

    try {
      const hasil = await this.deps.whatsapp.sendText(chatJid, text, {
        idempotencyKey: `approval-reply:${randomUUID()}`,
      })
      if (hasil.status === 'failed') {
        log.error({ chatJid, errorCode: hasil.errorCode }, 'balasan persetujuan gagal terkirim')
        terkirim = false
      } else {
        if (hasil.status === 'unknown') log.warn({ chatJid }, 'status pengiriman persetujuan tidak diketahui')
        terkirim = true
      }
    } catch (error) {
      log.warn({ err: error }, 'gagal mengirim balasan persetujuan')
      terkirim = false
    }

    // Hanya kalau benar-benar sampai ke pengguna.
    //
    // Menyimpan pesan yang gagal terkirim membuat riwayat berbohong: agent
    // berikutnya akan "membaca" jawaban yang tidak pernah dibaca pengguna.
    if (terkirim) await this.catatPesan(chatJid, text)
  }

  /** Simpan pesan sistem ke riwayat percakapan. Gagal menulis tidak boleh fatal. */
  private async catatPesan(chatJid: string, text: string): Promise<void> {
    try {
      // Pakai `this.deps.prisma`, bukan mengimpor client sendiri.
      //
      // Versi lama mengimpor `../database/client.js` langsung. Itu memutus
      // injeksi dependensi: test tidak bisa mengujinya, dan secara diam-diam
      // membuat modul ini tidak bisa dipakai dengan database lain.
      const percakapan = await this.deps.prisma.conversation.findFirst({
        where: { chatJid },
        select: { id: true },
        orderBy: { lastMessageAt: 'desc' },
      })
      if (!percakapan) return

      await this.deps.prisma.message.create({
        data: {
          conversationId: percakapan.id,
          dedupeKey: `out:approval:${randomUUID()}`,
          waMessageId: `out_${randomUUID().slice(0, 12)}`,
          senderJid: 'me',
          direction: 'out',
          type: 'text',
          text,
          timestamp: new Date(),
        },
      })
    } catch (error) {
      log.warn({ err: error }, 'gagal menyimpan pesan persetujuan sebagai konteks')
    }
  }
}