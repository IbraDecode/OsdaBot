/**
 * Executor untuk tindakan yang sudah disetujui.
 *
 * Menjembatani ApprovalEngine (yang tidak boleh tahu detail tool) dengan
 * ToolRegistry (yang butuh `ToolExecutionContext` lengkap).
 *
 * Yang dijaga di sini:
 *  1. Konteks eksekusi dibangun dari baris `Approval` yang disimpan server —
 *     bukan dari argumen percakapan atau model.
 *  2. Otorisasi diulang saat eksekusi. Izin bisa berubah antara waktu minta
 *     dan waktu setujui; persetujuan lama bukan bukti izin masih ada.
 *  3. Idempotensi lewat `executedAt`. Satu persetujuan menghasilkan paling
 *     banyak satu eksekusi, walau "iya" datang dua kali.
 */
import type { PrismaClient } from '@prisma/client'
import type { ApprovalExecutor } from './engine.js'
import type { AuthorizationService } from '../security/authorization.js'
import type { SafeModeGate } from '../system/safe-mode.js'
import type { ToolRegistry } from '../tools/registry.js'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'approval-executor' })

export interface ToolApprovalExecutorDeps {
  prisma: PrismaClient
  tools: ToolRegistry
  authorization: AuthorizationService
  /** Zona waktu fallback kalau baris approval tidak punya. */
  defaultTimezone?: string
  /**
   * Tombol darurat.
   *
   * Opsional karena jalur ini memang ada sebelum mode aman ada — tapi kalau
   * di produksi biarkan kosong, persetujuan yang sudah diberikan tetap jalan
   * meski operator mengira sudah mematikan semua.
   */
  safeMode?: SafeModeGate
}

/** Kolom yang dipakai executor — dinyatakan eksplisit agar mudah diuji. */
const SELECT = {
  id: true,
  organizationId: true,
  taskId: true,
  requestedBy: true,
  chatJid: true,
  payload: true,
  correlationId: true,
  status: true,
  executedAt: true,
} as const

type ApprovalRow = {
  id: string
  organizationId: string | null
  taskId: string | null
  requestedBy: string | null
  chatJid: string | null
  payload: unknown
  correlationId: string | null
  status: string
  executedAt: Date | null
}

export class ToolApprovalExecutor implements ApprovalExecutor {
  constructor(private readonly deps: ToolApprovalExecutorDeps) {}

  async executeApproved(input: {
    toolName: string
    payload: unknown
    correlationId: string | null
  }): Promise<{ ok: boolean; summary: string }> {
    const approval = await this.loadApproval(input)
    if (!approval) {
      return { ok: false, summary: 'Data persetujuan tidak ditemukan.' }
    }

    if (approval.executedAt) {
      return { ok: true, summary: 'Tindakan itu sudah dijalankan sebelumnya.' }
    }

    // Tanpa identitas, tidak boleh ada yang dieksekusi.
    if (!approval.requestedBy) {
      log.error({ approvalId: approval.id }, 'approval tanpa identitas pemohon')
      return { ok: false, summary: 'Persetujuan tidak bisa dijalankan karena identitas pemohon tidak tercatat.' }
    }

    // Tanpa organisasi, JANGAN jalan. `organizationId` nullable di tabel
    // approval, tapi setiap akses data wajib punya organisasi — dengannya
    // ada risiko data satu organisasi bocor ke yang lain. Menolak lebih aman
    // daripada memaksa nilai.
    if (!approval.organizationId) {
      log.error({ approvalId: approval.id }, 'approval tanpa organisasi')
      return { ok: false, summary: 'Persetujuan tidak bisa dijalankan karena organisasi tidak tercatat.' }
    }

    const definition = this.deps.tools.get(input.toolName)
    if (!definition) {
      log.error({ tool: input.toolName }, 'tool yang disetujui tidak terdaftar')
      return { ok: false, summary: 'Tindakan itu tidak lagi tersedia.' }
    }

    // Gerbang mode aman.
    //
    // Jalur ini penting dan sering terlewat: executor memanggil
    // `definition.execute` **langsung**, bukan lewat `ToolRegistry.execute`.
    // Jadi apa pun yang dipasang di registry TIDAK menangkapnya.
    //
    // Kalau mode aman hanya dipasang di registry, persetujuan yang sudah
    // diberikan sebelum mode aman dinyalakan akan tetap dieksekusi — persis
    // tindakan yang paling ingin dihentikan.
    if (this.deps.safeMode && (await this.deps.safeMode.aktif())) {
      await this.deps.safeMode.catatDiblokir({
        apa: 'approval',
        detail: `approval untuk ${input.toolName} tidak dijalankan`,
        chatJid: approval.chatJid ?? null,
        actorUserId: approval.requestedBy,
        organizationId: approval.organizationId,
      })
      log.error({ approvalId: approval.id, tool: input.toolName }, 'approval diblokir: mode aman aktif')
      return {
        ok: false,
        summary:
          'Sistem sedang dalam mode aman, jadi persetujuan ini belum dijalankan. ' +
          'Coba lagi setelah operator mengematikannya.',
      }
    }

    // Otorisasi diulang, bukan diasumsikan sudah lolos.
    for (const permission of definition.requiredPermissions) {
      const decision = await this.deps.authorization.check({
        actorId: approval.requestedBy,
        organizationId: approval.organizationId,
        permission,
      })
      if (!decision.allowed) {
        log.warn(
          { tool: input.toolName, permission, reason: decision.reason },
          'izin dicabut setelah persetujuan diberikan',
        )
        return {
          ok: false,
          summary: 'Izin kamu untuk tindakan ini sudah berubah, jadi tidak dijalankan.',
        }
      }
    }

    try {
      const data = await definition.execute(approval.payload as never, {
        actorUserId: approval.requestedBy,
        organizationId: approval.organizationId,
        conversationId: null,
        taskId: approval.taskId,
        chatJid: approval.chatJid ?? '',
        senderJid: approval.chatJid ?? '',
        correlationId: approval.correlationId ?? `approval:${approval.id}`,
        timezone: this.deps.defaultTimezone ?? 'Asia/Makassar',
        authorization: this.deps.authorization,
      })

      await this.deps.prisma.approval.update({
        where: { id: approval.id },
        data: { executedAt: new Date() },
      })

      log.info({ tool: input.toolName, approvalId: approval.id }, 'tindakan disetujui berhasil dijalankan')
      return { ok: true, summary: this.summarize(input.toolName, data) }
    } catch (error) {
      log.error({ tool: input.toolName, approvalId: approval.id, err: error }, 'gagal menjalankan tindakan')
      return {
        ok: false,
        summary: error instanceof Error ? error.message : 'Ada kendala saat menjalankan tindakan.',
      }
    }
  }

  /**
   * Cari approval yang cocok.
   *
   * `correlationId` adalah kunci paling sempit dan jadi pilihan pertama.
   * Kalau tidak ada, pakai approval APPROVED yang belum dieksekusi.
   */
  private async loadApproval(input: {
    toolName: string
    correlationId: string | null
  }): Promise<ApprovalRow | null> {
    if (input.correlationId) {
      const row = await this.deps.prisma.approval.findFirst({
        where: {
          actionType: input.toolName,
          status: 'APPROVED',
          correlationId: input.correlationId,
        },
        orderBy: { createdAt: 'desc' },
        select: SELECT,
      })
      if (row) return row as ApprovalRow
    }

    const fallback = await this.deps.prisma.approval.findFirst({
      where: { actionType: input.toolName, status: 'APPROVED', executedAt: null },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    })
    return fallback as ApprovalRow | null
  }

  private summarize(toolName: string, data: unknown): string {
    if (typeof data === 'object' && data !== null) {
      const record = data as Record<string, unknown>
      for (const key of ['message', 'summary', 'description']) {
        const value = record[key]
        if (typeof value === 'string' && value) return value
      }
    }
    return `Selesai: ${toolName}.`
  }
}