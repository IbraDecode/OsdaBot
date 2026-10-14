/**
 * Uji smoke terhadap AI provider NYATA.
 *
 * Test ini DILEWATI kalau kredensial tidak tersedia — supaya `pnpm test`
 * di CI tidak pernah bergantung pada API berbayar.
 *
 * Jalankan eksplisit untuk memeriksa integrasi:
 *   RUN_LIVE_TESTS=true pnpm vitest run tests/live/ai-provider.live.test.ts
 */
import { describe, expect, it } from 'vitest'
import { OpenAiCompatibleProvider, normalizeToolCalls, wrapError } from '../../src/agent/llm/openai-compatible.js'
import { LlmError } from '../../src/agent/llm/provider.js'

/**
 * Test live HANYA jalan kalau diminta secara eksplisit.
 *
 * Alasannya: `pnpm test` di CI tidak boleh bergantung pada API berbayar,
 * dan kredensial di dalam repository bisa jadi dummy yang tidak terhubung.
 */
const JALAN = process.env.RUN_LIVE_TESTS === 'true'
const punyaKredensial =
  JALAN && Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL)

describe.skipIf(!punyaKredensial)('AI provider — integrasi langsung', () => {
  const provider = new OpenAiCompatibleProvider()

  // Model reasoning butuh waktu lebih lama daripada default 30 detik.
  // Timeout yang terlalu pendek akan menghasilkan kegagalan palsu.
  const TIMEOUT = 120_000

  it('bisa menghubungi provider', { timeout: TIMEOUT }, async () => {
    const health = await provider.healthCheck()
    expect(health.ok, `provider bermasalah: ${health.error}`).toBe(true)
  })

  it('menjawab chat sederhana dalam bahasa Indonesia', { timeout: TIMEOUT }, async () => {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'Kamu asisten AI berbahasa Indonesia. Jawab singkat.' },
        { role: 'user', content: 'Sebutkan satu kecamatan yang ada di Kabupaten Lombok Timur.' },
      ],
      temperature: 0.2,
      maxOutputTokens: 300,
    })

    expect(response.content).toBeTruthy()
    expect(response.usage.totalTokens).toBeGreaterThan(0)
  })

  it('memilih tool yang benar untuk perintah perubahan kehadiran', { timeout: TIMEOUT }, async () => {
    // Dua tool sengaja dibuat mirip supaya model HARUS memilih yang tepat,
    // bukan sekadar mengambil tool pertama yang cocok.
    const response = await provider.chat({
      messages: [
        {
          role: 'system',
          content:
            'Kamu sekolah yang membantu mengelola kehadiran organisasi. Pakai tool yang sesuai permintaan. Jangan mengarang data.',
        },
        { role: 'user', content: 'osda ubah Danya jadi izin karena ada meeting' },
      ],
      tools: [
        {
          name: 'attendance.update',
          description: 'Ubah status kehadiran anggota yang sudah ada di daftar',
          parameters: {
            type: 'object',
            properties: {
              memberName: { type: 'string' },
              status: { type: 'string', enum: ['PRESENT', 'EXCUSED', 'SICK', 'ABSENT'] },
              reason: { type: 'string' },
            },
            required: ['memberName', 'status'],
          },
        },
        {
          name: 'attendance.create',
          description: 'Buat daftar kehadiran baru untuk kegiatan',
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      ],
    })

    expect(response.toolCalls.length).toBeGreaterThan(0)
    const call = response.toolCalls[0]!

    expect(call.name).toBe('attendance.update')
    expect(call.parseError).toBeUndefined()
    expect(call.arguments.status).toBe('EXCUSED')
    expect(String(call.arguments.reason ?? '')).toContain('meeting')
  })
})

describe('normalizeToolCalls (tanpa jaringan)', () => {
  it('membaca argument JSON yang valid', () => {
    const hasil = normalizeToolCalls([
      { id: '1', function: { name: 'attendance.update', arguments: '{"status":"EXCUSED"}' } },
    ])
    expect(hasil[0]?.arguments).toEqual({ status: 'EXCUSED' })
  })

  it('menandai JSON rusak, BUKAN mengabaikannya diam-diam', () => {
    const hasil = normalizeToolCalls([
      { id: '1', function: { name: 'attendance.update', arguments: '{bukan json' } },
    ])
    expect(hasil[0]?.parseError).toBeDefined()
    expect(hasil[0]?.arguments).toEqual({})
  })

  it('menangani argument kosong', () => {
    const hasil = normalizeToolCalls([{ id: '1', function: { name: 'x', arguments: '' } }])
    expect(hasil[0]?.arguments).toEqual({})
    expect(hasil[0]?.parseError).toBeUndefined()
  })

  it('melewatkan tool tanpa nama', () => {
    const hasil = normalizeToolCalls([{ id: '1', function: {} }])
    expect(hasil).toEqual([])
  })

  it('menandai array sebagai argument tidak valid', () => {
    const hasil = normalizeToolCalls([{ id: '1', function: { name: 'x', arguments: '[1,2]' } }])
    expect(hasil[0]?.parseError).toBeDefined()
  })
})

describe('wrapError', () => {
  it('mempertahankan status retryable dari LlmError', () => {
    const error = wrapError(new LlmError('rate_limited', 'kena limit', true, 429))
    expect(error.retryable).toBe(true)
  })

  it('menandai error auth sebagai tidak retryable', () => {
    const error = wrapError(new LlmError('auth', 'kredensial salah', false, 401))
    expect(error.retryable).toBe(false)
  })
})