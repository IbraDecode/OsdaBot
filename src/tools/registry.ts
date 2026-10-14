/**
 * ToolRegistry — satu-satunya jalan menjalankan tool.
 *
 * Pipeline yang ditegakkan:
 *   1. tool ada?          → kalau tidak, tolak (jangan pernah eksekusi dinamis)
 *   2. input valid?       → Zod
 *   3. aktor terautentikasi?
 *   4. permission cukup?
 *   5. scope organisasi valid (untuk tool yang punya resourceType)?
 *   6. perlu approval?
 *   7. baru `execute`
 *
 * Perhatikan bahwa (1)-(6) terjadi di backend. Model AI hanya menghasilkan
 * "permintaan", bukan izin.
 */
import { z, type ZodType } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../database/client.js'
import { logger } from '../observability/logger.js'
import { describeDenial } from '../security/authorization.js'
import { PERMISSIONS, type Permission } from '../security/permissions.js'
import {
  fail,
  type ToolErrorCode,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSchemaForModel,
} from './types.js'

/** Launcher approval — di-inject supaya registry tidak bergantung pada HTTP. */
export interface ApprovalBroker {
  /**
   * Minta persetujuan. Mengembalikan:
   *  - 'approved' → boleh jalan
   *  - 'rejected' → ditolak pengguna
   *  - 'pending'  → persetujuan dicatat, dijawab terpisah
   *
   * `chatJid` menentukan ke mana permintaan dikirim dan dari mana balasan
   * diterima. Kalau kosong, permintaan dicatat tapi tidak bisa dijawab — itu
   * lebih baik daripada diam-diam menjalankan tindakan tanpa persetujuan.
   */
  request(context: {
    actorUserId: string | null
    organizationId: string | null
    taskId: string | null
    permission: Permission
    actionType: string
    payload: unknown
    preview: string
    chatJid?: string | null
    correlationId?: string | null
  }): Promise<'approved' | 'rejected' | 'pending'>
}

export interface ToolRegistryDeps {
  prisma?: typeof prisma
  logger?: typeof logger
  approvals?: ApprovalBroker
  /** Batas jumlah pemanggilan tool dalam satu putaran agent. */
  maxCallsPerRun?: number
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<never, never>>()
  private readonly logger: typeof logger
  private readonly prisma: typeof prisma
  private readonly maxCallsPerRun: number

  constructor(private readonly deps: ToolRegistryDeps = {}) {
    this.logger = deps.logger ?? logger.child({ module: 'tools' })
    this.prisma = deps.prisma ?? prisma
    this.maxCallsPerRun = deps.maxCallsPerRun ?? 12
  }

  setApprovalBroker(broker: ApprovalBroker): void {
    this.deps.approvals = broker
  }

  register<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): this {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" sudah terdaftar.`)
    }
    this.tools.set(definition.name, definition as unknown as ToolDefinition<never, never>)
    this.logger.debug({ tool: definition.name }, 'tool terdaftar')
    return this
  }

  registerAll(definitions: Array<ToolDefinition<never, never>>): this {
    for (const definition of definitions) this.register(definition as never)
    return this
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): ToolDefinition<never, never> | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition<never, never>[] {
    return [...this.tools.values()]
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  /**
   * Skema tool yang dikirim ke model AI.
   *
   * Hanya menyertakan tool yang relevan: terdaftar DAN seluruh permission-nya
   * dimiliki aktor. Ini menghemat token sekaligus mencegah model "mengingat"
   * kemampuan yang tidak boleh ia pakai.
   */
  async schemasFor(context: ToolExecutionContext): Promise<Array<{ type: 'function'; function: ToolSchemaForModel }>> {
    const schemas: Array<{ type: 'function'; function: ToolSchemaForModel }> = []

    for (const tool of this.tools.values()) {
      const allowed = await this.hasAllPermissions(tool.requiredPermissions, context)
      if (!allowed) continue

      schemas.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToJsonSchema(tool.inputSchema),
        },
      })
    }

    return schemas
  }

  /** Cek apakah aktor memenuhi seluruh permission sebuah tool. */
  async hasAllPermissions(permissions: Permission[], context: ToolExecutionContext): Promise<boolean> {
    if (permissions.length === 0) return true
    if (!context.actorUserId || !context.organizationId) return false

    const owned = await context.authorization.checkMany(
      context.actorUserId,
      context.organizationId,
      permissions,
    )
    return permissions.every((permission) => owned.has(permission))
  }

  /**
   * Jalankan tool dengan seluruh lapisan pemeriksaan.
   *
   * `runCount` membatasi total tool call per putaran agent supaya
   * tidak ada loop tak berujung.
   */
  async execute(
    name: string,
    rawInput: unknown,
    context: ToolExecutionContext,
    runCount = 0,
  ): Promise<ToolResult<unknown>> {
    const mulai = Date.now()

    if (runCount >= this.maxCallsPerRun) {
      return fail(
        'RATE_LIMITED',
        'Jumlah permintaan tindakan sudah melebihi batas untuk satu pesan.',
        { retryable: false },
      )
    }

    // 1. Tool harus terdaftar.
    const tool = this.tools.get(name)
    if (!tool) {
      this.logger.warn({ tool: name, correlationId: context.correlationId }, 'tool tidak dikenal')
      return fail('VALIDATION_FAILED', `Kemampuan "${name}" tidak tersedia.`)
    }

    // 2. Validasi input (argumen model AI = input tak dipercaya).
    let input: unknown
    try {
      input = tool.inputSchema.parse(rawInput)
    } catch (error) {
      const detail = formatZodError(error)
      this.logger.warn({ tool: name, err: detail }, 'validasi input tool gagal')
      return fail('VALIDATION_FAILED', 'Parameter yang dikirim tidak sesuai.', { details: detail })
    }

    // 3-4. Autentikasi & otorisasi.
    if (!context.actorUserId || !context.organizationId) {
      await this.audit(context, name, input, 'denied', 'UNAUTHENTICATED')
      return fail('UNAUTHENTICATED', 'Identitas pengirim belum terverifikasi.')
    }

    for (const permission of tool.requiredPermissions) {
      const decision = await context.authorization.check({
        actorId: context.actorUserId,
        organizationId: context.organizationId,
        permission,
      })
      if (!decision.allowed) {
        this.logger.warn(
          { tool: name, permission, reason: decision.reason, correlationId: context.correlationId },
          'izin tool ditolak',
        )
        await this.audit(context, name, input, 'denied', decision.reason)
        return fail('PERMISSION_DENIED', describeDenial(decision))
      }
    }

    // 5-6. Approval untuk tindakan yang ditandai `requiresApproval`.
    //
    // PENTING: syaratnya HANYA `requiresApproval` — BUKAN
    // `requiresApproval && riskLevel === 'HIGH'`.
    //
    // Versi lama menambah syarat riskLevel HIGH, padahal tool seperti
    // `whatsapp.send_message` menandai requiresApproval dengan riskLevel
    // MEDIUM. Akibatnya approval tidak pernah diminta untuk tool yang paling
    // butuh persetujuan: pesan yang terkirim tidak bisa ditarik kembali.
    // Sekali dilepas, persetujuan yang keliru tidak bisa dikoreksi.
    if (tool.requiresApproval) {
      const broker = this.deps.approvals
      if (!broker) {
        // Tolak, jangan lewati. Tanpa broker, tool berisiko TIDAK BOLEH jalan.
        this.logger.error({ tool: name, correlationId: context.correlationId }, 'tool butuh persetujuan tapi broker tidak terpasang')
        await this.audit(context, name, input, 'denied', 'APPROVAL_UNAVAILABLE')
        return fail('INTERNAL_ERROR', 'Mekanisme persetujuan belum siap. Tindakan ini belum bisa dijalankan.')
      }

      const verdict = await broker.request({
        actorUserId: context.actorUserId,
        organizationId: context.organizationId,
        taskId: context.taskId,
        permission: tool.requiredPermissions[0] ?? PERMISSIONS.SYSTEM_STATUS_READ,
        actionType: tool.name,
        payload: input,
        preview: this.previewFor(tool.name, input),
        chatJid: context.chatJid,
        correlationId: context.correlationId,
      })

      if (verdict === 'rejected') {
        await this.audit(context, name, input, 'rejected', 'APPROVAL_REJECTED')
        return fail('PERMISSION_DENIED', 'Tindakan ini dibatalkan.')
      }
      if (verdict === 'pending') {
        await this.audit(context, name, input, 'pending', 'APPROVAL_PENDING')
        return fail(
          'VALIDATION_FAILED',
          'Tindakan ini menunggu persetujuan. Balas "iya" untuk melanjutkan atau "batal" untuk membatalkan.',
        )
      }
    }

    // 7. Eksekusi.
    try {
      const data = await tool.execute(input as never, context)
      const durationMs = Date.now() - mulai
      this.logger.info(
        { tool: name, correlationId: context.correlationId, durationMs },
        'tool selesai',
      )
      await this.recordExecution(context, name, input, 'success', undefined, durationMs)
      return { success: true, data }
    } catch (error) {
      const durationMs = Date.now() - mulai
      const mapped = mapToolError(error)

      this.logger.error(
        { tool: name, correlationId: context.correlationId, code: mapped.code, err: error },
        'tool gagal',
      )
      await this.recordExecution(context, name, input, 'failure', mapped.code, durationMs)
      return mapped
    }
  }

  /** Ringkasan singkat payload untuk pratinjau persetujuan. */
  private previewFor(toolName: string, input: unknown): string {
    if (typeof input !== 'object' || input === null) return toolName
    const record = input as Record<string, unknown>
    const bagian: string[] = [`tool: ${toolName}`]
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' && value.length > 0) bagian.push(`${key}=${value}`)
      else if (typeof value === 'number' || typeof value === 'boolean') bagian.push(`${key}=${String(value)}`)
      else if (Array.isArray(value)) bagian.push(`${key}=[${value.length} item]`)
      else if (value !== null && value !== undefined) bagian.push(`${key}=<object>`)
    }
    return bagian.join('\n')
  }

  /** Catat eksekusi tool untuk audit trail & analisis kualitas. */
  private async recordExecution(
    context: ToolExecutionContext,
    toolName: string,
    input: unknown,
    outcome: 'success' | 'failure' | 'denied' | 'rejected' | 'pending',
    errorCode?: string,
    durationMs?: number,
  ): Promise<void> {
    try {
      await this.prisma.toolExecution.create({
        data: {
          toolName,
          organizationId: context.organizationId,
          actorUserId: context.actorUserId,
          taskId: context.taskId,
          correlationId: context.correlationId,
          // Ringkasan input, bukan input mentah: hindari menyimpan konten sensitif.
          inputSummary: summarize(input) as Prisma.InputJsonValue,
          outcome,
          errorCode: errorCode ?? null,
          durationMs: durationMs ?? null,
        },
      })
    } catch (error) {
      // Kegagalan audit tidak boleh menggagalkan operasi bisnis.
      this.logger.error({ err: error, toolName }, 'gagal menulis jejak eksekusi tool')
    }
  }

  private async audit(
    context: ToolExecutionContext,
    toolName: string,
    input: unknown,
    outcome: 'success' | 'failure' | 'denied' | 'rejected' | 'pending',
    reasonCode?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.actorUserId,
          action: `tool.${toolName}`,
          resourceType: 'tool',
          outcome,
          reasonCode: reasonCode ?? null,
          correlationId: context.correlationId,
          metadata: summarize(input) as Prisma.InputJsonValue,
        },
      })
    } catch (error) {
      this.logger.error({ err: error, toolName }, 'gagal menulis audit log')
    }
  }
}

/** Format error Zod jadi pesan ringkas. */
function formatZodError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
  }
  return 'parameter tidak valid'
}

/** Ringkas objek jadi bentuk aman untuk disimpan (tanpa string panjang). */
function summarize(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) return { value: truncate(String(input)) }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = truncate(value, 160)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) result[key] = value
    else if (Array.isArray(value)) result[key] = `[${value.length} item]`
    else if (typeof value === 'object' && value !== null) result[key] = '{object}'
  }
  return result
}

function truncate(value: string, max = 160): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

/** Hasil mapToolError: selalu gagal, dan kodenya bisa dibaca terpisah. */
type MappedToolFailure = ToolResult<never> & { code: ToolErrorCode }

/** Ubah error tak terduga jadi ToolResult yang aman. */
function mapToolError(error: unknown): MappedToolFailure {
  if (error instanceof Error) {
    // Pesan error domain yang sudah aman untuk ditampilkan ke pengguna.
    const known = [
      'ATTENDANCE_NOT_FOUND',
      'ENTRY_NOT_FOUND',
      'MEMBER_NOT_FOUND',
      'DUPLICATE_MEMBER',
      'AMBIGUOUS_TARGET',
    ]
    const code = (error as { code?: string }).code
    if (code && known.includes(code)) {
      return { ...fail(code as never, error.message, { retryable: false }), code: code as ToolErrorCode }
    }

    if (error.name === 'PrismaClientKnownRequestError') {
      const prismaCode = (error as { code?: string }).code
      if (prismaCode === 'P2002') {
        return { ...fail('CONFLICT', 'Data itu sudah ada (duplikat).'), code: 'CONFLICT' }
      }
      if (prismaCode === 'P2025') {
        return { ...fail('NOT_FOUND', 'Data yang dimaksud tidak ditemukan.'), code: 'NOT_FOUND' }
      }
    }

    if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
      return {
        ...fail('PROVIDER_UNAVAILABLE', 'Layanan sedang tidak tersedia. Coba lagi sebentar.', { retryable: true }),
        code: 'PROVIDER_UNAVAILABLE',
      }
    }
  }

  return {
    ...fail('INTERNAL_ERROR', 'Terjadi kendala di sistem. Coba lagi sebentar.', { retryable: true }),
    code: 'INTERNAL_ERROR',
  }
}

/**
 * Ubah skema Zod menjadi JSON Schema yang dipahami OpenAI function-calling.
 *
 * Kita TIDAK memakai pustaka pihak ketiga karena kebutuhan kita sempit dan
 * karena versinya bisa berubah. Hanya kasus yang memang kita pakai yang ditangani.
 */
export function zodToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  const described = describeZod(schema, 0)
  return described
}

const MAX_DEPTH = 6

function describeZod(schema: ZodType<unknown>, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH) return { type: 'object', additionalProperties: false }

  const def = (schema as unknown as { _def: Record<string, unknown> })._def ?? {}
  const typeName = def.typeName as string | undefined

  switch (typeName) {
    case 'ZodString': {
      const checks = (def.checks as Array<{ kind: string; value?: number; regex?: RegExp }> | undefined) ?? []
      const result: Record<string, unknown> = { type: 'string' }
      for (const check of checks) {
        if (check.kind === 'min') result.minLength = check.value
        if (check.kind === 'max') result.maxLength = check.value
        if (check.kind === 'email') result.format = 'email'
        if (check.kind === 'uuid') result.format = 'uuid'
      }
      return result
    }

    case 'ZodNumber': {
      const result: Record<string, unknown> = { type: 'number' }
      if (def.checks) {
        const checks = def.checks as Array<{ kind: string; value: number }>
        for (const check of checks) {
          if (check.kind === 'int') result.type = 'integer'
          if (check.kind === 'min') result.minimum = check.value
          if (check.kind === 'max') result.maximum = check.value
        }
      }
      return result
    }

    case 'ZodBoolean':
      return { type: 'boolean' }

    case 'ZodEnum':
      return { type: 'string', enum: (def.values as string[] | undefined)?.slice() ?? [] }

    case 'ZodLiteral':
      return { type: 'string', enum: [def.value as string] }

    case 'ZodArray': {
      const min = (def.minLength as { value?: number } | null)?.value
      return {
        type: 'array',
        items: describeZod(def.type as ZodType<unknown>, depth + 1),
        ...(typeof min === 'number' ? { minItems: min } : {}),
      }
    }

    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault': {
      const inner = (def.innerType ?? def.type) as ZodType<unknown> | undefined
      if (!inner) return { type: 'string' }
      const described = describeZod(inner, depth + 1)
      if (typeName === 'ZodDefault' && def.defaultValue !== undefined) {
        const fn = def.defaultValue as () => unknown
        return { ...described, default: fn() }
      }
      return described
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options as ZodType<unknown>[] | undefined) ?? []
      const variants = options.map((option) => describeZod(option, depth + 1))
      return { anyOf: variants }
    }

    case 'ZodRecord':
      return { type: 'object', additionalProperties: true }

    case 'ZodObject': {
      const shapeFn = def.shape as (() => Record<string, ZodType<unknown>>) | undefined
      const shape = shapeFn ? shapeFn() : {}
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = describeZod(value, depth + 1)
        if (!isOptionalSchema(value)) required.push(key)
      }

      const result: Record<string, unknown> = { type: 'object', properties }
      if (required.length > 0) result.required = required
      result.additionalProperties = false
      return result
    }

    default:
      return { type: 'string' }
  }
}

function isOptionalSchema(schema: ZodType<unknown>): boolean {
  const def = (schema as unknown as { _def: { typeName?: string; isOptional?: () => boolean } })._def
  if (def?.typeName === 'ZodOptional' || def?.typeName === 'ZodDefault') return true
  return typeof def?.isOptional === 'function' ? def.isOptional() : false
}