/**
 * Agent Runtime — otak eksekusi OSDABOT.
 *
 * Alur yang ditegakkan:
 *
 *   Terima → Normalisasi → Resolve Identitas → Cek Aktivasi Grup → Muat Konteks
 *   → Temukan Skill → Panggil Model → Validasi Tool Call → Otorisasi
 *   → Jalankan Tool → Verifikasi Hasil → Balas
 *
 * Batas keras yang WAJIB ada (tanpa ini, satu pesan bisa Belt Loop tak batas):
 *  - `maxSteps`       : putaran maksimum per pesan.
 *  - `maxToolCalls`   : total tool call per pesan.
 *  - `maxTokens`      : سقgat token output per langkah.
 *
 * Pemisahan penting: penalaran AI (fase "pikir") dipisahkan dari eksekusi tool
 * (fase "kerja"). Model hanya MEMINTA; backend yang MEMUTUSKAN.
 */
import { randomUUID } from 'node:crypto'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from '../config/env.js'
import { canonicalJson } from '../approvals/intent.js'
import { logger } from '../observability/logger.js'
import type { LlmProvider, ToolCall, ToolDefinitionForModel } from './llm/provider.js'
import { LlmError } from './llm/provider.js'
import { buildSystemPrompt } from './prompt.js'
import type { AuthorizationService } from '../security/authorization.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { ToolExecutionContext, ToolResult } from '../tools/types.js'

const log = logger.child({ module: 'agent' })

/**
 * Tool yang selalu dikirim, apa pun pesan yang masuk.
 *
 * Dipilih karena tool kecil yang dibutuhkan hampir
 * setiap percakapan: melihat anggota, melihat jadwal, membatalkan pengingat.
 *
 * Tanpa ini, pesan yang tidak cocok dengan skill apa pun akan membuat model
 * kehilangan kemampuan dasar.
 */
/**
 * Sidik jari unik dari satu panggilan tool.
 *
 * Menyertakan nama + argumen. Panggilan berbeda dengan argumen berbeda tetap
 * diizinkan — misalnya mencoba lagi dengan tanggal yang dikoreksi.
 */
export function failedFingerprint(call: { name: string; arguments: Record<string, unknown> }): string {
  let args: string
  try {
    args = canonicalJson(call.arguments ?? {})
  } catch {
    args = String(call.arguments)
  }
  return `${call.name}:${args}`
}

const DEFAULT_TOOLS = [
  'organization_list_members',
  'attendance_list_events',
  'reminder_list',
]

/** Permintaan masuk ke agent. */
export interface AgentRequest {
  correlationId: string
  actorUserId: string | null
  organizationId: string | null
  conversationId: string | null
  chatJid: string
  senderJid: string
  isGroup: boolean
  timezone: string
  /**
   * Lampiran yang menyertai pesan.
   *
   * Diteruskan ke `ToolExecutionContext` supaya tool tahu berkas mana yang
   * dimaksud tanpa harus jadi parameter — model tidak boleh meminta berkas
   * dari percakapan lain hanya dengan menyebut id-nya.
   */
  pendingMedia?: {
    messageId: string
    fileName: string | null
    mimetype: string | null
    type: string
  } | null
  /** Nama organisasi untuk system prompt. */
  organizationName: string | null
  /** Nama anggota untuk system prompt. */
  memberName: string | null
  /** Pesan pengguna (sudah bersih dari prefix pemicu). */
  text: string
  /** Riwayat percakapan singkat. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Kemampuan aktif (untuk jawaban "kamu bisa apa"). */
  capabilities: Array<{ name: string; description: string }>
  /** Tool tambahan di luar registry (mis. hasil context). */
  extraSystemContext?: string
  /**
   * Tool yang relevan untuk pesan ini, hasil dari pemilihan skill.
   *
   * Dikirim dari handler yang sudah menghitung skill mana yang cocok.
   * Mengosongkan berarti "kirim semua" — dipakai kalau memang tidak ada
   * informasi yang cukup untuk menyaring.
   */
  relevantToolNames?: string[]
}

/** Hasil agent. */
export type AgentResponse =
  | {
      status: 'completed'
      message: string
      steps: number
      toolCalls: number
      usage: { promptTokens: number; completionTokens: number; totalTokens: number }
    }
  | {
      status: 'awaiting_clarification'
      message: string
      steps: number
      toolCalls: number
    }
  | {
      status: 'failed'
      message: string
      errorCode: string
      retryable: boolean
    }

export interface AgentRuntimeDeps {
  llm: LlmProvider
  tools: ToolRegistry
  /** Satu-satunya sumber kebenaran izin. Disuntikkan, bukan diambil global. */
  authorization: AuthorizationService
  botName?: string
  maxSteps?: number
  maxToolCalls?: number
}

export class AgentRuntime {
  private readonly maxSteps: number
  private readonly maxToolCalls: number
  private readonly botName: string

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.maxSteps = deps.maxSteps ?? env.AGENT_MAX_STEPS
    this.maxToolCalls = deps.maxToolCalls ?? env.AGENT_MAX_TOOL_CALLS
    this.botName = deps.botName ?? env.WHATSAPP_BOT_NAME
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const childLog = log.child({ correlationId: request.correlationId, chatJid: request.chatJid })

    // Konteks tool dibangun dari konteks backend yang SUDAH diverifikasi.
    // Tidak ada satu pun field di sini yang berasal dari argumen model AI.
    const context: ToolExecutionContext = {
      actorUserId: request.actorUserId,
      organizationId: request.organizationId,
      conversationId: request.conversationId,
      taskId: null,
      chatJid: request.chatJid,
      senderJid: request.senderJid,
      correlationId: request.correlationId,
      timezone: request.timezone,
      authorization: this.deps.authorization,
      pendingMedia: request.pendingMedia ?? null,
      pendingMediaId: request.pendingMedia?.messageId ?? null,
    }

    // Hanya tool dari skill yang relevan yang dikirim.
    //
    // Diperiksa terhadap gateway sungguhan: 0 tool -> 4 detik, 3 tool ->
    // 34 detik, 18 tool -> lebih dari 60 detik (timeout). Tanpa penyaringan,
    // pesan paling sederhana pun tidak bisa dijawab.
    const rawSchemas = await this.deps.tools.schemasFor(context, {
      ...(request.relevantToolNames ? { only: request.relevantToolNames } : {}),
      defaultToolNames: DEFAULT_TOOLS,
    })
    const availableToolNames = rawSchemas.map((schema) => schema.function.name)
    const toolSchemas: ToolDefinitionForModel[] = rawSchemas.map((schema) => schema.function)

    const systemPrompt = buildSystemPrompt({
      botName: this.botName,
      organizationName: request.organizationName,
      memberName: request.memberName,
      isGroup: request.isGroup,
      timezone: request.timezone,
      todayLabel: formatToday(request.timezone),
      capabilities: request.capabilities,
      availableTools: availableToolNames,
    })

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...request.history.map((turn) =>
        turn.role === 'user'
          ? ({ role: 'user', content: turn.content } as ChatCompletionMessageParam)
          : ({ role: 'assistant', content: turn.content } as ChatCompletionMessageParam),
      ),
      { role: 'user', content: request.text },
    ]

    if (request.extraSystemContext) {
      // Konteks tambahan masuk sebagai pesan developer agar tidak tercampur
      // dengan instruksi sistem utama.
      messages.splice(1, 0, { role: 'developer', content: request.extraSystemContext })
    }

    let steps = 0
    let totalToolCalls = 0

    /**
     * Sidik jari tool yang sudah GAGAL dalam satu percakapan.
     *
     * Menghindre pengulangan yang pasti gagal dengan argumen identik.
     */
    const failedCalls = new Set<string>()
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    while (steps < this.maxSteps) {
      steps += 1

      let response
      try {
        response = await this.deps.llm.chat({
          messages,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          toolChoice: toolSchemas.length > 0 ? 'auto' : 'none',
        })
      } catch (error) {
        const mapped = error instanceof LlmError ? error : new LlmError('unknown', String(error), true)
        childLog.error({ kind: mapped.kind }, 'permintaan LLM gagal')

        return {
          status: 'failed',
          message: providerErrorMessage(mapped),
          errorCode: mapped.kind,
          retryable: mapped.retryable,
        }
      }

      totalUsage.promptTokens += response.usage.promptTokens
      totalUsage.completionTokens += response.usage.completionTokens
      totalUsage.totalTokens += response.usage.totalTokens

      // Kasus 1: model selesai tanpa tool call → selesai.
      if (response.toolCalls.length === 0) {
        const text = (response.content ?? '').trim()

        if (text === '') {
          childLog.warn({ steps }, 'model tidak mengembalikan teks maupun tool call')
          return {
            status: 'failed',
            message: 'Aku belum bisa memproses itu. Coba ulangi dengan kalimat yang lebih jelas.',
            errorCode: 'EMPTY_RESPONSE',
            retryable: true,
          }
        }

        return {
          status: 'completed',
          message: text,
          steps,
          toolCalls: totalToolCalls,
          usage: totalUsage,
        }
      }

      // Kasus 2: model meminta tool. Lanjut eksekusi.
      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      })

      for (const call of response.toolCalls) {
        totalToolCalls += 1

        if (totalToolCalls > this.maxToolCalls) {
          childLog.warn({ maxToolCalls: this.maxToolCalls }, 'batas tool call tercapai')
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              error: 'Batas jumlah tindakan untuk satu pesan tercapai. Selesaikan dulu bagian yang sudah jalan.',
            }),
          })
          continue
        }

        // Panggilan identik yang sudah GAGAL tidak diulang.
        //
        // Tanpa ini, agent bisa memanggil tool yang sama dengan argumen yang
        // sama berulang kali. Terlihat nyata di pengujian live:
        // `title: Required` diulang 3 kali lalu agent kehabisan langkah tanpa
        // pernah menjawab.
        //
        // Parameter yang sama akan menghasilkan hasil yang sama — mengulang
        // hanya memboroskan waktu dan langkah.
        const sidikJari = failedFingerprint(call)
        if (failedCalls.has(sidikJari)) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              error:
                'Panggilan ini sudah dicoba dan gagal dengan argumen yang sama. ' +
                'Ubah argumennya, atau jawab pengguna apa adanya apa yang bisa dan tidak bisa dilakukan.',
            }),
          })
          continue
        }

        const result = await this.executeTool(call, context)
        if (!result.success) failedCalls.add(sidikJari)
        messages.push({ role: 'tool', tool_call_id: call.id, content: serializeResult(result) })
      }
    }

    // Kasus 3: langkah habis tanpa jawaban final.
    childLog.warn({ maxSteps: this.maxSteps, totalToolCalls }, 'langkah agent habis')
    return {
      status: 'completed',
      message:
        'Ini sudah cukup panjang untuk satu pesan. Ada sebagian yang belum selesai — bilang "lanjut yang tadi" untuk dilanjutkan.',
      steps,
      toolCalls: totalToolCalls,
      usage: totalUsage,
    }
  }

  /** Jalankan satu tool call dengan seluruh lapis pemeriksaan registry. */
  private async executeTool(
    call: ToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolResult<unknown>> {
    // Argument JSON rusak → tolak SEBELUM menyentuh tool apa pun.
    if (call.parseError) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Argumen tool tidak valid.',
          retryable: false,
          details: call.parseError,
        },
      }
    }

    return this.deps.tools.execute(call.name, call.arguments, context)
  }
}

/** Ubah hasil tool jadi teks untuk dikirim balik ke model. */
function serializeResult(result: ToolResult<unknown>): string {
  if (result.success) {
    return JSON.stringify({ ok: true, data: result.data })
  }
  // Sengaja tidak mengirim stack trace — cukup kode + pesan yang aman.
  return JSON.stringify({ ok: false, error: { code: result.error.code, message: result.error.message } })
}

/** Pesan ramah saat provider bermasalah — jangan bocor detail teknis. */
function providerErrorMessage(error: LlmError): string {
  switch (error.kind) {
    case 'rate_limited':
      return 'Lagi ada banyak permintaan ke AI sekarang. Coba lagi sebentar ya.'
    case 'timeout':
      return 'AI-nya kelamaan menjawab. Coba lagi sebentar ya.'
    case 'auth':
      return 'Konfigurasi AI provider bermasalah. Sudah dicatat untuk diperiksa.'
    case 'network':
      return 'Tidak bisa menghubungi AI provider sekarang. Coba lagi nanti ya.'
    case 'server_error':
      return 'AI provider sedang bermasalah. Coba lagi sebentar ya.'
    default:
      return 'Ada kendala saat memproses. Coba lagi sebentar ya.'
  }
}

/** Label tanggal hari ini dalam bahasa Indonesia, mengikuti zona waktu organisasi. */
export function formatToday(timezone: string): string {
  const now = new Date()
  try {
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    })
    return formatter.format(now)
  } catch {
    return now.toISOString()
  }
}

