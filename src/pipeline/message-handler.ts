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
import type { AttendanceService } from '../attendance/service.js'
import { env } from '../config/env.js'
import type { IdentityEngine } from '../identity/resolver.js'
import { logger } from '../observability/logger.js'
import { SkillRegistry } from '../skills/registry.js'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import { parseJid } from '../whatsapp/jid.js'
import { buildAttendanceTools } from '../tools/attendance-tools.js'
import { buildOrganizationTools } from '../tools/organization-tools.js'
import { prismaForRegistry } from '../bootstrap.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { MessagePipeline } from './message-pipeline.js'

const log = logger.child({ module: 'handler' })

/** Kemampuan aktif — sumber jawaban untuk "kamu bisa apa". */
const CAPABILITIES: Array<{ name: string; description: string; status: string }> = [
  { name: 'Kehadiran', description: 'Buat daftar hadir, tambah anggota, ubah status dan alasan.', status: 'enabled' },
  { name: 'Anggota', description: 'Cari dan lihat data anggota organisasi.', status: 'enabled' },
  { name: 'Pengumuman & Undangan', description: 'Susun draf pengumuman atau undangan resmi.', status: 'enabled' },
  { name: 'Kirim pesan', description: 'Kirim pesan WhatsApp setelah kamu setujui.', status: 'enabled' },
  { name: 'Jadwal & Pengingat', description: 'Buat pengingat terjadwal.', status: 'planned' },
  { name: 'Keuangan', description: 'Catatan kas dan tagihan.', status: 'planned' },
  { name: 'Dokumen (PDF/DOCX)', description: 'Buat berkas PDF atau Word.', status: 'planned' },
]

export interface MessageHandlerDeps {
  pipeline: MessagePipeline
  identity: IdentityEngine
  agent: AgentRuntime
  tools: ToolRegistry
  skills: SkillRegistry
  whatsapp: WhatsAppProvider
  attendance: AttendanceService
  /**
   * Engine persetujuan.
   *
   * Wajib ada: tanpa ini, "iya"/"batal" diperlakukan sebagai percakapan biasa
   * dan tindakan yang disetujui tidak pernah dijalankan.
   */
  approvals: ApprovalEngine
  /** Versi aplikasi untuk log. */
  version?: string
}

export class MessageHandler {
  constructor(private readonly deps: MessageHandlerDeps) {}

  async registerTools(): Promise<void> {
    this.deps.tools.registerAll(buildAttendanceTools({ attendance: this.deps.attendance, identity: this.deps.identity }) as never)
    this.deps.tools.registerAll(
      buildOrganizationTools({ prisma: prismaForRegistry(this.deps.tools), whatsapp: this.deps.whatsapp }) as never,
    )
    log.info({ tools: this.deps.tools.names().length }, 'tool terdaftar')
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

    const relevantSkills = this.deps.skills.select(message.text ?? '', {
      isGroup,
      allowedPermissions,
    })

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
      text: message.text ?? '',
      history,
      capabilities: CAPABILITIES.filter((cap) => cap.status === 'enabled').map((cap) => ({
        name: cap.name,
        description: cap.description,
      })),
      extraSystemContext: this.deps.skills.render(relevantSkills) || undefined,
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