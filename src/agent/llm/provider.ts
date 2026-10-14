/**
 * Kontrak LLM provider.
 *
 * OSDABOT memakai endpoint OpenAI-compatible yang bisa dikonfigurasi. Nama model
 * TIDAK pernah di-hardcode — semuanya lewat `AI_MODEL`.
 *
 * Catatan penting soal "tool call": argumen tool yang dihasilkan model adalah
 * INPUT TAK TERPERCAYA. Wajib lewat Zod + otorisasi backend sebelum jalan.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

/** Satu tool yang dikirim ke model. */
export interface ToolDefinitionForModel {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** Panggilan tool yang diminta model. */
export interface ToolCall {
  id: string
  name: string
  /** Sudah di-parse JSON. Jika JSON rusak, `parseError` terisi. */
  arguments: Record<string, unknown>
  parseError?: string
}

export interface ChatRequest {
  messages: ChatCompletionMessageParam[]
  tools?: ToolDefinitionForModel[]
  temperature?: number
  maxOutputTokens?: number
  /** Cara penggunaan tool: auto, none (matikan), atau required (wajib). */
  toolChoice?: 'auto' | 'none' | 'required'
}

export interface ChatResponse {
  /** Isi teks. Null kalau model hanya memanggil tool. */
  content: string | null
  toolCalls: ToolCall[]
  /** Alasan model berhenti. */
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error'
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Reasoning internal model, kalau ada. Berguna untuk diagnostik. */
  reasoning?: string | null
  /** Model yang benar-benar dipakai oleh server (bisa berbeda dari alias). */
  resolvedModel?: string
}

export interface LlmProvider {
  readonly name: string
  readonly model: string

  /**
   * Chat completion dengan dukungan tool calling.
   * Tidak boleh melempar error ke pemanggil tanpa membungkus jadi
   * `LlmError` supaya agent bisa memutuskan retry atau tidak.
   */
  chat(request: ChatRequest): Promise<ChatResponse>

  /** Cek apakah provider bisa dihubungi. Untuk health check. */
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }>
}

export type LlmErrorKind =
  | 'rate_limited'
  | 'timeout'
  | 'auth'
  | 'server_error'
  | 'bad_request'
  | 'network'
  | 'unknown'

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}