/**
 * Test retry LLM untuk error transien.
 *
 * Gateway yang dipakai adalah Cloudflare Tunnel dan memang tidak stabil:
 * pengukuran nyata menunjukkan HTTP 530 "origin unreachable" lalu pulih
 * beberapa saat kemudian. Tanpa retry, satu kedip tunnel langsung menjadi
 * jawaban "AI provider bermasalah" untuk pengguna.
 *
 * Yang TIDAK boleh di-retry: auth dan bad_request. Keduanya bukan transien —
 * mencoba ulang hanya memperpanjang masalah.
 */
import { describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleProvider, wrapError } from '../../src/agent/llm/openai-compatible.js'
import { LlmError } from '../../src/agent/llm/provider.js'

/** Client tiruan yang gagal sebanyak N kali lalu berhasil. */
function buatClient(perilaku: (percobaan: number) => unknown) {
  let n = 0
  return {
    chat: {
      completions: {
        create: async () => {
          n += 1
          const hasil = perilaku(n)
          if (hasil instanceof Error) throw hasil
          return hasil
        },
      },
    },
    models: { list: async () => ({ data: [] }) },
    __jumlah: () => n,
  }
}

const jawabanValid = {
  choices: [{ message: { role: 'assistant', content: 'halo' }, finish_reason: 'stop' }],
  model: 'test-model',
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

function buatProvider(perilaku: (percobaan: number) => unknown, maxRetries = 2) {
  const client = buatClient(perilaku)
  const provider = new OpenAiCompatibleProvider({ client: client as never, maxRetries })
  return { provider, client }
}

const request = { messages: [{ role: 'user' as const, content: 'halo' }] }

describe('retry LLM', () => {
  it('BERHASIL di percobaan pertama tanpa retry', async () => {
    const { provider, client } = buatProvider(() => jawabanValid)

    const hasil = await provider.chat(request)

    expect(hasil.content).toBe('halo')
    expect(client.__jumlah()).toBe(1)
  })

  it('MENCoba lagi setelah error transien', async () => {
    const { provider, client } = buatProvider((n) =>
      n === 1 ? new LlmError('timeout', 'timeout', true) : jawabanValid,
    )

    const hasil = await provider.chat(request)

    expect(hasil.content).toBe('halo')
    expect(client.__jumlah()).toBe(2)
  })

  it('BERHENTI setelah batas retry dan melempar error asli', async () => {
    const { provider, client } = buatProvider(() => new LlmError('timeout', 'timeout', true), 2)

    await expect(provider.chat(request)).rejects.toThrow('timeout')
    // 1 percobaan awal + 2 retry.
    expect(client.__jumlah()).toBe(3)
  })

  it('TIDAK retry untuk error auth', async () => {
    // Kredensial ditolak akan tetap ditolak. Retry cuma memperpanjang masalah
    // dan bisa membuat kunci dikunci lebih lama.
    const { provider, client } = buatProvider(() => new LlmError('auth', 'kredensial ditolak', false))

    await expect(provider.chat(request)).rejects.toThrow('kredensial ditolak')
    expect(client.__jumlah()).toBe(1)
  })

  it('TIDAK retry untuk bad_request', async () => {
    const { provider, client } = buatProvider(() => new LlmError('bad_request', 'ditolak', false))

    await expect(provider.chat(request)).rejects.toThrow('ditolak')
    expect(client.__jumlah()).toBe(1)
  })

  it('respect maxRetries = 0 (tanpa retry)', async () => {
    const { provider, client } = buatProvider(() => new LlmError('server_error', 'x', true), 0)

    await expect(provider.chat(request)).rejects.toThrow('x')
    expect(client.__jumlah()).toBe(1)
  })

  it('retry lalu berhasil di percobaan ketiga', async () => {
    const { provider, client } = buatProvider((n) =>
      n < 3 ? new LlmError('server_error', 'tunnel padam', true) : jawabanValid,
    )

    const hasil = await provider.chat(request)

    expect(hasil.content).toBe('halo')
    expect(client.__jumlah()).toBe(3)
  })
})

describe('retryable menurut jenis error', () => {
  it('5xx dan rate limit boleh di-retry', () => {
    // 530 = Cloudflare "origin unreachable" — persis yang terjadi pada
    // gateway yang dipakai.
    expect(wrapError(new LlmError('server_error', 'x', true)).retryable).toBe(true)
    expect(wrapError(new LlmError('rate_limited', 'x', true)).retryable).toBe(true)
    expect(wrapError(new LlmError('network', 'x', true)).retryable).toBe(true)
  })

  it('auth dan bad_request tidak boleh di-retry', () => {
    expect(wrapError(new LlmError('auth', 'x', false)).retryable).toBe(false)
    expect(wrapError(new LlmError('bad_request', 'x', false)).retryable).toBe(false)
  })
})