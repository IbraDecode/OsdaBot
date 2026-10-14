/**
 * Adapter LLM OpenAI-compatible.
 *
 * ── Temuan dari pengujian langsung ke gateway yang dipakai ────────────────
 * 1. Kita HARUS mengirim `"stream": false` secara eksplisit.
 *    Tanpa itu, beberapa gateway mengembalikan SSE (`data: {...}`) walaupun
 *    client tidak meminta streaming — respons jadi tidak bisa di-parse sebagai
 *    JSON dan tool call hilang.
 * 2. Nama model yang dikonfigurasi (`ibrax`) adalah ALIAS. Serverresolve ke
 *    model aslinya dan mengembalikannya di `response.model`. Itu yang kita
 *    pakai untuk audit, bukan alias yang diketik user.
 * 3. Field `reasoning_content` bisa berisi penalaran model. Kita simpan untuk
 *    diagnostik, TIDAK pernah kirim balik ke pengguna.
 */
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from '../../config/env.js'
import { logger } from '../../observability/logger.js'
import {
  LlmError,
  type ChatRequest,
  type ChatResponse,
  type LlmProvider,
  type ToolCall,
} from './provider.js'

const log = logger.child({ module: 'llm' })

export interface OpenAiCompatibleOptions {
  baseUrl?: string
  apiKey?: string
  model?: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  /** Dipakai test double. */
  client?: OpenAI
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible'
  readonly model: string

  private readonly client: OpenAI
  private readonly temperature: number
  private readonly maxOutputTokens: number

  constructor(options: OpenAiCompatibleOptions = {}) {
    this.model = options.model ?? env.AI_MODEL
    this.temperature = options.temperature ?? env.AI_TEMPERATURE
    this.maxOutputTokens = options.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS

    this.client =
      options.client ??
      new OpenAI({
        baseURL: options.baseUrl ?? env.AI_BASE_URL,
        apiKey: options.apiKey ?? env.AI_API_KEY,
        timeout: options.timeoutMs ?? env.AI_TIMEOUT_MS,
        maxRetries: 0, // Retry dikelola agent supaya bisa dihitung & dibatasi.
      })
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const mulai = Date.now()

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        // WAJIB eksplisit — lihat catatan di header file ini.
        stream: false,
        messages: request.messages,
        temperature: request.temperature ?? this.temperature,
        max_tokens: request.maxOutputTokens ?? this.maxOutputTokens,
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function' as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: request.toolChoice ?? 'auto',
            }
          : {}),
      })

      const choice = response.choices[0]
      if (!choice) {
        throw new LlmError('unknown', 'Provider tidak mengembalikan pilihan apa pun.', true)
      }

      const message = choice.message
      const toolCalls = normalizeToolCalls(message.tool_calls)

      return {
        content: typeof message.content === 'string' && message.content.trim() !== '' ? message.content : null,
        toolCalls,
        finishReason: mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        reasoning: readReasoningContent(message),
        resolvedModel: response.model,
      }
    } catch (error) {
      throw wrapError(error)
    } finally {
      log.debug({ model: this.model, durationMs: Date.now() - mulai }, 'permintaan LLM selesai')
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const mulai = Date.now()
    try {
      // Panggilan paling murah yang tetap membuktikan kredensial benar.
      await this.client.models.list()
      return { ok: true, latencyMs: Date.now() - mulai }
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - mulai,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/**
 * Ubah tool call dari SDK jadi bentuk internal.
 *
 * Argument bisa berupa string JSON. Kalau JSON-nya rusak, TIDAK BOLEH diam-diam
 * dieksekusi — tandai `parseError` supaya registry menolaknya dengan pesan jelas.
 */
export function normalizeToolCalls(
  raw: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string | null } }> | null | undefined,
): ToolCall[] {
  if (!raw || raw.length === 0) return []

  const hasil: ToolCall[] = []

  for (const call of raw) {
    const name = call.function?.name
    if (!name) continue

    const rawArgs = call.function?.arguments

    if (rawArgs === undefined || rawArgs === null || rawArgs === '') {
      hasil.push({ id: call.id ?? `call_${name}`, name, arguments: {} })
      continue
    }

    if (typeof rawArgs !== 'string') {
      hasil.push({ id: call.id ?? `call_${name}`, name, arguments: rawArgs })
      continue
    }

    try {
      const parsed: unknown = JSON.parse(rawArgs)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        hasil.push({ id: call.id ?? `call_${name}`, name, arguments: parsed as Record<string, unknown> })
      } else {
        hasil.push({
          id: call.id ?? `call_${name}`,
          name,
          arguments: {},
          parseError: 'Argumen tool bukan objek JSON.',
        })
      }
    } catch {
      hasil.push({
        id: call.id ?? `call_${name}`,
        name,
        arguments: {},
        parseError: 'Argumen tool bukan JSON yang valid.',
      })
    }
  }

  return hasil
}

function mapFinishReason(reason: string | null | undefined): ChatResponse['finishReason'] {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls'
    case 'stop':
    case 'end_turn':
      return 'stop'
    case 'length':
      return 'length'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'stop'
  }
}

/** Ubah error SDK jadi LlmError yang bisa diputuskan retry/tidak. */
export function wrapError(error: unknown): LlmError {
  if (error instanceof LlmError) return error

  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? undefined

    if (status === 429) {
      return new LlmError('rate_limited', 'Provider sedang membatasi permintaan.', true, 429)
    }
    if (status === 401 || status === 403) {
      return new LlmError('auth', 'Kredensial AI provider ditolak.', false, status)
    }
    if (status === 400 || status === 422) {
      return new LlmError('bad_request', `Permintaan ditolak provider: ${error.message}`, false, status)
    }
    if (typeof status === 'number' && status >= 500) {
      return new LlmError('server_error', `Provider bermasalah (${status}).`, true, status)
    }

    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new LlmError('timeout', 'Provider tidak menjawab dalam batas waktu.', true, status)
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return new LlmError('network', 'Tidak bisa menghubungi AI provider.', true, status)
    }

    return new LlmError('unknown', error.message, true, status)
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
    return new LlmError('timeout', 'Provider tidak menjawab dalam batas waktu.', true)
  }

  return new LlmError('unknown', message, true)
}

/** Penyedia model berbasis Gemini mengembalikan penalaran di `reasoning_content`. */
function readReasoningContent(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null
  const value = (message as Record<string, unknown>).reasoning_content
  return typeof value === 'string' ? value : null
}

/** Bangun pesan percakapan dari riwayat ringkas. */
export type ConversationTurn = {
  role: 'user' | 'assistant'
  content: string
}

export function buildMessages(
  systemPrompt: string,
  history: ConversationTurn[],
  latestUserMessage: string,
  toolResults: Array<{ toolCallId: string; name: string; content: string }>,
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }]

  for (const turn of history) {
    messages.push(
      turn.role === 'user'
        ? { role: 'user', content: turn.content }
        : { role: 'assistant', content: turn.content },
    )
  }

  messages.push({ role: 'user', content: latestUserMessage })

  for (const result of toolResults) {
    messages.push({
      role: 'tool',
      tool_call_id: result.toolCallId,
      content: result.content,
    })
  }

  return messages
}