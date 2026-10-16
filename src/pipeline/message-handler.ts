/**
 * Message Handler — menyatukan pipeline, identity, context, agent, dan balasan.
 *
 * Ini orchestrator tipis. Semua keputusan penting (boleh/tidak boleh, nama
 * mana, izin apa) didelegasikan ke modul yang punya tanggung jawab masing-masing.
 * File ini tidak boleh berisi aturan bisnis.
 */
import { randomUUID } from 'node:crypto'
import type { AgentRuntime } from '../agent/runtime.js'
import type { ApprovalEngine } from '../approvals/engine.js'
import type { ReminderService } from '../reminders/service.js'
import type { AttendanceService } from '../attendance/service.js'
import { env } from '../config/env.js'
import type { IdentityEngine } from '../identity/resolver.js'
import { logger } from '../observability/logger.js'
import { SkillRegistry } from '../skills/registry.js'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import { parseJid } from '../whatsapp/jid.js'
import { buildAttendanceTools } from '../tools/attendance-tools.js'
import { buildOrganizationTools } from '../tools/organization-tools.js'
import { buildReminderTools } from '../tools/reminder-tools.js'
import { buildFinanceTools } from '../tools/finance-tools.js'
import { buildDocumentTools } from '../tools/document-tools.js'
import { buildKnowledgeTools } from '../tools/knowledge-tools.js'
import { buildMediaTools } from '../tools/media-tools.js'
import { buildPaymentTools } from '../tools/payment-tools.js'
import { buildGroupTools } from '../tools/group-tools.js'
import { buildTaskTools } from '../tools/task-tools.js'
import type { FinanceService } from '../finance/service.js'
import type { DocumentService } from '../documents/service.js'
import type { KnowledgeService } from '../knowledge/service.js'
import type { BaturPayAdapter } from '../payments/baturpay.js'
import type { GroupLinkService } from '../groups/service.js'
import type { TaskService } from '../tasks/service.js'
import type { SafeModeService } from '../system/safe-mode.js'
import { prismaForRegistry } from '../bootstrap.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { MessagePipeline } from './message-pipeline.js'

const log = logger.child({ module: 'handler' })

/** Metadata lampiran yang perlu diingat per percakapan. */
interface MediaPendek {
  messageId: string
  fileName: string | null
  mimetype: string | null
  type: string
}

/**
 * Ambil metadata lampiran dari pesan.
 *
 * Hanya `document` dan `image` — stiker dan audio tidak punya teks yang bisa
 * dipakai, dan memper liberallykan tipe membuat cache terisi pesan yang tidak
 * pernah bisa dibaca.
 */
function ambilLampiran(message: import('../whatsapp/types.js').NormalizedMessage): MediaPendek | null {
  if (message.type !== 'document' && message.type !== 'image') return null
  return {
    messageId: message.id,
    fileName: message.fileName,
    mimetype: message.mimetype,
    type: message.type,
  }
}

/**
 * Deskripsi lampiran sebagai teks perintah.
 *
 * Pesan yang isinya cuma PDF tidak punya teks. Kalau diteruskan kosong, agent
 * melihat pesan kosong dan tidak tahu ada berkas yang bisa dibaca.
 */
function describeLampiran(message: import('../whatsapp/types.js').NormalizedMessage): string {
  const nama = message.fileName ?? 'berkas'
  return `[Lampiran: ${nama}${message.mimetype ? ` (${message.mimetype})` : ''}]`
}

/** Kemampuan aktif — sumber jawaban untuk "kamu bisa apa". */
const CAPABILITIES: Array<{ name: string; description: string; status: string }> = [
  { name: 'Kehadiran', description: 'Buat daftar hadir, tambah anggota, ubah status dan alasan.', status: 'enabled' },
  { name: 'Anggota', description: 'Cari dan lihat data anggota organisasi.', status: 'enabled' },
  { name: 'Pengumuman & Undangan', description: 'Susun draf pengumuman atau undangan resmi.', status: 'enabled' },
  { name: 'Kirim pesan', description: 'Kirim pesan WhatsApp setelah kamu setujui.', status: 'enabled' },
  { name: 'Jadwal & Pengingat', description: 'Buat, lihat, dan batalkan pengingat terjadwal.', status: 'enabled' },
  { name: 'Keuangan', description: 'Catat kas, buat tagihan, dan terima pembayaran.', status: 'enabled' },
  { name: 'Dokumen', description: 'Buat surat izin, surat tugas, sertifikat, dan daftar hadir dalam PDF.', status: 'enabled' },
  { name: 'Pengetahuan', description: 'Cari jawaban di dokumen resmi organisasi.', status: 'enabled' },
]

export interface MessageHandlerDeps {
  pipeline: MessagePipeline
  identity: IdentityEngine
  agent: AgentRuntime
  tools: ToolRegistry
  skills: SkillRegistry
  whatsapp: WhatsAppProvider
  attendance: AttendanceService
  finance: FinanceService
  documents: DocumentService
  knowledge: KnowledgeService
  payments: BaturPayAdapter
  groups: GroupLinkService
  tasks: TaskService
  safeMode: SafeModeService
  /**
   * Engine persetujuan.
   *
   * Wajib ada: tanpa ini, "iya"/"batal" diperlakukan sebagai percakapan biasa
   * dan tindakan yang disetujui tidak pernah dijalankan.
   */
  approvals: ApprovalEngine
  /**
   * Layanan pengingat. Wajib ada supaya tool jadwal bisa mendaftarkan
   * pengingat.
   */
  reminders: ReminderService
  /** Versi aplikasi untuk log. */
  version?: string
}

export class MessageHandler {
  /** Lampiran terakhir per chat JID. */
  private readonly lampiran = new Map<string, MediaPendek>()
  constructor(private readonly deps: MessageHandlerDeps) {}

  async registerTools(): Promise<void> {
    this.deps.tools.registerAll(buildAttendanceTools({ attendance: this.deps.attendance, identity: this.deps.identity }) as never)
    this.deps.tools.registerAll(
      buildOrganizationTools({ prisma: prismaForRegistry(this.deps.tools), whatsapp: this.deps.whatsapp }) as never,
    )
    this.deps.tools.registerAll(
      buildReminderTools({
        prisma: prismaForRegistry(this.deps.tools),
        reminders: this.deps.reminders,
      }) as never,
    )
    this.deps.tools.registerAll(
      buildFinanceTools({
        finance: this.deps.finance,
        identity: this.deps.identity,
      }) as never,
    )
    this.deps.tools.registerAll(buildKnowledgeTools({ knowledge: this.deps.knowledge, documents: this.deps.documents }) as never)
    this.deps.tools.registerAll(
      buildMediaTools({ whatsapp: this.deps.whatsapp, knowledge: this.deps.knowledge }) as never,
    )
    this.deps.tools.registerAll(
      buildPaymentTools({
      payments: this.deps.payments,
      identity: this.deps.identity,
      whatsapp: this.deps.whatsapp,
    }) as never,
    )
    this.deps.tools.registerAll(
      buildGroupTools({ groups: this.deps.groups, whatsapp: this.deps.whatsapp }) as never,
    )
    this.deps.tools.registerAll(
      buildTaskTools({ tasks: this.deps.tasks, identity: this.deps.identity }) as never,
    )
    this.deps.tools.registerAll(
      buildDocumentTools({
        documents: this.deps.documents,
        identity: this.deps.identity,
        attendance: this.deps.attendance,
        whatsapp: this.deps.whatsapp,
      }) as never,
    )
    log.info({ tools: this.deps.tools.names().length }, 'tool terdaftar')
  }

  /**
   * Ingat lampiran terakhir di satu percakapan.
   *
   * Dibatasi 50 percakapan supaya tidak tumbuh tanpa batas — percakapan yang
   * sudah lama tidak mungkin masih punya lampiran aktif (media WhatsApp
   * kedaluwarsa dalam hitungan menit).
   */
  lampiranIngat(chatJid: string, media: MediaPendek): void {
    if (this.lampiran.size >= 50) {
      const tertua = this.lampiran.keys().next()
      if (!tertua.done) this.lampiran.delete(tertua.value)
    }
    this.lampiran.set(chatJid, media)
  }

  /** Titik masuk untuk setiap pesan masuk yang lolos filter. */
  async handle(message: import('../whatsapp/types.js').NormalizedMessage): Promise<void> {
    const correlationId = randomUUID()
    const childLog = log.child({ correlationId, chatJid: message.chatJid })

    const decision = await this.deps.pipeline.decide(message)
    if (decision.action === 'skip') {
      childLog.debug({ reason: decision.reason }, 'pesan dilewati')
      return
    }

    const isGroup = parseJid(message.chatJid)?.kind === 'group'
    const chatType = isGroup ? 'group' : 'private'

    let title: string | null = null
    if (isGroup) {
      const metadata = await this.deps.whatsapp.getGroupMetadata(message.chatJid)
      title = metadata?.subject ?? null
    }

    const conversationId = await this.deps.pipeline.ensureConversation(message.chatJid, chatType, title)

    // Dedupe persisten. Kalau sudah pernah disimpan, jangan proses lagi.
    const claimed = await this.deps.pipeline.claimMessage(message, conversationId)
    if (!claimed) {
      childLog.info('pesan sudah pernah diproses, dilewati')
      return
    }

    // Resolusi identitas + organisasi.
    const resolved = await this.deps.identity.resolveSender({
      jid: message.senderJid,
      chatJid: message.chatJid,
      pushName: message.senderPushName,
    })

    // ── Gerbang mode aman ─────────────────────────────────────────────────
    //
    // Diletakkan SETELAH pesan tersimpan dan SETELAH identitas terpecah, tapi
    // SEBELUM satu pun hal yang bisa berdampak ke orang lain: panggilan AI,
    // tool, atau balasan.
    //
    // Letaknya disengaja:
    //
    // - **Setelah** penyimpanan, karena pesan yang masuk tetap harus tercatat.
    //   Kalau tidak, insidennya tidak punya jejak — dan "bot diam" jadi tidak
    //   bisa dibedakan dari "bot mati".
    // - **Setelah** identitas, supaya catatan auditnya punya organisasi dan
    //   pelaku yang bisa ditelusuri.
    // - **Sebelum** AI, jadi tidak ada biaya dan tidak ada balasan salah yang
    //   sampai ke orang.
    //
    // Ada gerbang serupa di ToolRegistry dan di outbox. Yang ini lapisan
    // paling awal; yang lain menangkap jalur yang tidak lewat sini (mis.
    // approval yang sudah disetujui sebelum mode aman dinyalakan).
    if (await this.deps.safeMode.aktif()) {
      await this.deps.safeMode.catatDiblokir({
        apa: 'pesan-masuk',
        detail: 'pesan masuk dicatat, tidak diproses',
        chatJid: message.chatJid,
        actorUserId: resolved.identity.userId,
        organizationId: resolved.organization?.organizationId ?? null,
      })
      childLog.error(
        { userId: resolved.identity.userId },
        'pesan tidak diproses: mode aman aktif',
      )
      return
    }

    // Kalau pengirim punya beberapa keanggotaan dan tidak sedang di grup yang
    // tertaut, jangan asal pilih organisasi.
    if (resolved.organizationAmbiguity === 'multiple_memberships') {
      await this.reply(
        message.chatJid,
        'Akunmu terhubung ke lebih dari satu organisasi. Sebutkan organizasinya dulu ya, biar aku tidak salah akses data.',
      )
      return
    }

    const organization = resolved.organization

    // Balasan persetujuan dicek setelah identitas diketahui (butuh actorUserId
    // untuk mencocokkan dengan pemohon), tapi SEBELUM agent berjalan.
    //
    // Urutan ini penting: kalau dicek setelah agent, "iya" akan sampai ke model
    // dan bisa ditafsirkan ulang menjadi perintah lain.
    if (resolved.identity.userId) {
      const intent = await this.deps.approvals.tryHandleReply({
        text: message.text,
        chatJid: message.chatJid,
        actorUserId: resolved.identity.userId,
      })

      if (intent !== 'none') {
        childLog.info({ intent }, 'pesan diperlakukan sebagai balasan persetujuan')
        return
      }
    }

    if (!organization) {
      await this.reply(
        message.chatJid,
        'Halo! Aku belum tahu kamu bagian dari organisasi mana. Hubungkan akunmu ke organisasi dulu supaya aksesnya benar.',
      )
      return
    }

    const history = await this.deps.pipeline.recentMessages(conversationId, env.AGENT_MAX_CONTEXT_MESSAGES)

    // Skill yang relevan saja yang dimuat — bukan semuanya.
    const allowedPermissions = resolved.identity.userId
      ? await this.collectPermissions(resolved.identity.userId, organization.organizationId)
      : new Set<string>()

    // Lampiran terakhir di percakapan ini, kalau ada.
    //
    // Disimpan di memori proses, bukan di database: media WhatsApp hanya
    // tersedia singkat, dan menyimpan metadata lampiran ke database hanya
    // menambah baris yang tidak pernah bisa dipakai ulang.
    const media = ambilLampiran(message)
    if (media) this.lampiranIngat(message.chatJid, media)

    const relevantSkills = this.deps.skills.select(message.text ?? '', {
      isGroup,
      allowedPermissions,
    })

    // Tool yang dikirim ke model dibatasi pada tool milik skill yang cocok.
    //
    // Ini bukan penghematan token saja. Diperiksa ke gateway sungguhan,
    // waktu respons naik dari 4 detik (0 tool) ke >60 detik (18 tool) —
    // artinya tanpa penyaringan, pesan paling sederhana pun timeout.
    const relevantToolNames = [
      ...new Set(relevantSkills.flatMap((skill) => skill.metadata.requiredTools)),
    ]

    const response = await this.deps.agent.run({
      correlationId,
      actorUserId: resolved.identity.userId,
      organizationId: organization.organizationId,
      conversationId,
      chatJid: message.chatJid,
      senderJid: resolved.identity.jid,
      isGroup,
      timezone: organization.timezone,
      organizationName: organization.name,
      memberName: resolved.identity.displayName,
      // Pesan tanpa caption tetap punya teks: nama berkasnya. Tanpa ini,
      // pesan yang isinya cuma lampiran akan terlihat seperti pesan kosong
      // dan agent tidak tahu ada berkas yang bisa dibaca.
      text: message.text?.trim() ? message.text : describeLampiran(message),
      pendingMedia: media ?? this.lampiran.get(message.chatJid) ?? null,
      history,
      capabilities: CAPABILITIES.filter((cap) => cap.status === 'enabled').map((cap) => ({
        name: cap.name,
        description: cap.description,
      })),
      extraSystemContext: this.deps.skills.render(relevantSkills) || undefined,
      // Selalu dikirim, termasuk saat kosong: array kosong berarti "tidak ada
      // skill yang cocok" dan agent akan memakai tool default saja.
      relevantToolNames,
    })

    if (response.status === 'failed') {
      childLog.warn({ errorCode: response.errorCode }, 'agent gagal')
      await this.reply(message.chatJid, response.message)
      return
    }

    await this.reply(message.chatJid, response.message)

    // Simpan balasan bot sebagai konteks percakapan berikutnya.
    await this.saveBotMessage(conversationId, response.message)
  }

  /** Kirim balasan dan catat status pengiriman secara jujur. */
  private async reply(chatJid: string, text: string): Promise<void> {
    if (!text || text.trim() === '') return

    const result = await this.deps.whatsapp.sendText(chatJid, text, {
      idempotencyKey: `reply:${chatJid}:${Date.now()}`,
    })

    if (result.status === 'unknown') {
      log.warn({ chatJid }, 'status pengiriman tidak diketahui')
    } else if (result.status === 'failed') {
      log.error({ chatJid, errorCode: result.errorCode }, 'gagal mengirim balasan')
    }
  }

  private async saveBotMessage(conversationId: string, text: string): Promise<void> {
    try {
      const { prisma } = await import('../database/client.js')
      await prisma.message.create({
        data: {
          conversationId,
          dedupeKey: `out:${conversationId}:${randomUUID()}`,
          waMessageId: `out_${randomUUID().slice(0, 12)}`,
          senderJid: 'me',
          direction: 'out',
          type: 'text',
          text,
          timestamp: new Date(),
        },
      })
    } catch (error) {
      log.warn({ err: error }, 'gagal menyimpan balasan sebagai konteks')
    }
  }

  private async collectPermissions(userId: string, organizationId: string): Promise<Set<string>> {
    const { prisma } = await import('../database/client.js')
    const rows = await prisma.rolePermission.findMany({
      where: {
        role: {
          organizationId,
          memberBindings: { some: { member: { userId, isActive: true } } },
        },
      },
      select: { permissionId: true },
    })
    return new Set(rows.map((row) => row.permissionId))
  }

  /** Daftar kemampuan untuk diagnostics/CLI. */
  static capabilities(): typeof CAPABILITIES {
    return CAPABILITIES
  }
}