/**
 * Kontrak Tool.
 *
 * Prinsip yang ditegakkan:
 *
 * 1. TOOL BUKAN "doAnything(input: any)". Setiap tool punya nama, skema
 *    input/output, permission, dan tingkat risiko yang eksplisit.
 *
 * 2. IDENTITAS AKTOR DIKIRIM OLEH BACKEND lewat `ToolExecutionContext`.
 *    Tool TIDAK BOLEH mempercayai `actorId` dari argumen model AI. Kalau model
 *    mengarang UUID aktor lain, nilai itu diabaikan.
 *
 * 3. SETIAP TOOL MENGEMBALIKAN STRUKTUR TERCOCOK, bukan string "Success!".
 *    Agent butuh bukti untuk tidak berbohong ke pengguna.
 */
import type { ResourceRiskLevel } from '@prisma/client'
import type { ZodType } from 'zod'
import type { AuthorizationService } from '../security/authorization.js'
import type { Permission } from '../security/permissions.js'

/**
 * Konteks eksekusi — semua berasal dari backend, sudah diverifikasi.
 */
export interface ToolExecutionContext {
  /** UUID user internal. Sumber: IdentityEngine, bukan argumen AI. */
  actorUserId: string | null
  /** UUID organisasi aktif. Sumber: resolusi grup/keanggotaan. */
  organizationId: string | null
  /** UUID percakapan. */
  conversationId: string | null
  /** UUID tugas agent (kalau ada). */
  taskId: string | null
  /** JID chat tempat perintah datang. */
  chatJid: string
  /** JID pengirim. */
  senderJid: string
  /** ID untuk korelasi log. */
  correlationId: string
  /** Zona waktu organisasi — penting untuk "besok" dan jam. */
  timezone: string
  /** Layanan otorisasi. */
  authorization: AuthorizationService
  /**
   * Lampiran terakhir yang dikirim di percakapan ini.
   *
   * Disini — bukan sebagai parameter tool — supaya model tidak bisa meminta
   * berkas dari percakapan lain. Isinya hanya metadata; unduhannya tetap lewat
   * provider.
   */
  pendingMedia?: {
    messageId: string
    fileName: string | null
    mimetype: string | null
    type: string
  } | null
  /** Convenience: id lampiran terakhir, atau null. */
  pendingMediaId?: string | null
}

/** Hasil tool yang seragam. */
export type ToolResult<T = unknown> =
  | { success: true; data: T }
  | {
      success: false
      error: {
        /** Kode stabil untuk log & percabangan. */
        code: ToolErrorCode
        /** Pesan aman untuk ditampilkan ke pengguna (tanpa stack trace). */
        message: string
        /** Apakah layak dicoba ulang? */
        retryable: boolean
        /** Detail teknis untuk log — TIDAK dikirim ke model/pengguna. */
        details?: unknown
      }
    }

export type ToolErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'RESOURCE_SCOPE_MISMATCH'
  | 'AMBIGUOUS_REFERENCE'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNKNOWN_OUTCOME'
  | 'INTERNAL_ERROR'
  /**
   * Sistem sedang dalam mode aman.
   *
   * Kode tersendiri, bukan `RATE_LIMITED` atau `INTERNAL_ERROR`, karena
   * maknanya berbeda bagi pemanggil:
   *
   * - `retryable: false` — mencoba lagi tidak akan pernah berhasil sampai
   *   operator mengubahnya, jadi tidak ada gunanya meminta model untuk
   *   "coba lagi".
   * - Penyebabnya **bukan** salah di tool, input, atau izin. Kalau
   *   dicampur dengan `INTERNAL_ERROR`, agent akan mencoba mendiagnosis
   *   sendiri lalu memberi saran yang salah ke pengguna.
   */
  | 'SAFE_MODE'

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Nama unik, pakai titik: "attendance.update". */
  name: string
  /** Deskripsi untuk model AI. Harus menjelaskan KAPAN dipakai, bukan apa. */
  description: string
  /** Skema input. Argument AI tervalidasi sebelum masuk sini. */
  inputSchema: ZodType<TInput>
  /** Permission yang WAJIB dimiliki aktor. */
  requiredPermissions: Permission[]
  riskLevel: ResourceRiskLevel
  /** Kalau true, tool tidak dijalankan tanpa persetujuan eksplisit. */
  requiresApproval: boolean
  /** Hanya untuk organisasinya sendiri — mencegah kebocoran lintas tenant. */
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>
  /** Keterangan tambahan untuk dokumentasi. */
  notes?: string
}

/** Bentuk tool yang diberikan ke model AI (OpenAI function-calling). */
export interface ToolSchemaForModel {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export function ok<T>(data: T): ToolResult<T> {
  return { success: true, data }
}

export function fail(
  code: ToolErrorCode,
  message: string,
  options: { retryable?: boolean; details?: unknown } = {},
): ToolResult<never> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.details === undefined ? {} : { details: options.details }),
    },
  }
}

/** Error domain yang bisa dipetakan ke ToolErrorCode. */
export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}