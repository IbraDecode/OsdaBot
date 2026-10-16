/**
 * Uji integrasi rekaman jalan agent (`AgentTask` + `AgentStep`).
 *
 * Yang diuji:
 *  - setiap jalan agent menghasilkan baris induk yang bisa ditanyakan
 *  - `ToolExecution.taskId` akhirnya terhubung (sebelumnya selalu null)
 *  - alasan berhenti tercatat: selesai, langkah habis, error penyedia
 *  - pencatatan yang GAGAL tidak boleh mematikan percakapan
 *  - isi pesan tidak diduplikasi ke rekaman
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { AgentRunRecorder } from '../../src/agent/run-recorder.js'
import { AgentRuntime } from '../../src/agent/runtime.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { LlmError, type LlmProvider, type ToolCall } from '../../src/agent/llm/provider.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'

const TANDA = `run-uji-${Date.now()}`

/**
 * Pembersihan memakai awalan korelasi, bukan judul.
 *
 * Judul berisi JID percakapan, bukan tanda unik test — jadi tidak bisa dipakai
 * menyaring. Yang unik per test adalah `correlationId`, dan itu tersimpan di
 * `state`.
 */
async function bersihkan(): Promise<void> {
  const jalan = await prisma.agentTask.findMany({
    where: { state: { path: ['correlationId'], string_contains: TANDA } },
    select: { id: true },
  })
  const ids = jalan.map((j) => j.id)

  if (ids.length > 0) {
    // Anak dihapus lebih dulu: `AgentStep.task` cascade, tapi jadi eksplisit
    // supaya test ini tidak diam-diam bergantung pada aturan cascade.
    await prisma.agentStep.deleteMany({ where: { taskId: { in: ids } } })
    await prisma.agentTask.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.toolExecution.deleteMany({ where: { correlationId: { startsWith: TANDA } } })
}

afterAll(async () => {
  await bersihkan()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await bersihkan()
})

// ── Tumpukan providers ───────────────────────────────────────────────────────

interface Balasan {
  content?: string
  toolCalls?: ToolCall[]
}

/**
 * LLM tiruan: mengembalikan urutan balasan yang sudah ditentukan.
 *
 * Balasan terakhir diulang kalau runtime meminta lebih banyak dari yang
 * disediakan — persis seperti model sungguhan yang diminta berulang dengan
 * pesan yang sama.
 */
function llmDengan(balasan: Balasan[]): LlmProvider {
  let indeks = -1
  return {
    name: 'tiruan',
    model: 'tiruan',
    healthCheck: async () => ({ ok: true, latencyMs: 1 }),
    chat: async () => {
      indeks += 1
      const b = balasanAman(balasan, indeks)
      return {
        content: b.content ?? '',
        toolCalls: b.toolCalls ?? [],
        finishReason: b.toolCalls && b.toolCalls.length > 0 ? 'tool_calls' : 'stop',
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      }
    },
  }
}

/** Ambil balasan ke-`indeks`, atau balasan terakhir kalau indeks melewati daftar. */
function balasanAman(balasan: Balasan[], indeks: number): Balasan {
  const b = balasan[Math.min(indeks, balasan.length - 1)]
  if (!b) throw new Error('balasan tidak tersedia')
  return b
}

function toolPencatat(): ToolRegistry {
  const registry = new ToolRegistry({ prisma: prisma as never })
  registry.register({
    name: 'uji_dasar',
    description: 'Tool uji tanpa efek samping.',
    inputSchema: { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true as const, data: v }) } as never,
    requiredPermissions: [],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute() {
      return { success: true as const, data: { oke: true } }
    },
  } as never)
  return registry
}

function permintaan(overrides: Record<string, unknown> = {}) {
  return {
    correlationId: `${TANDA}-${Math.random().toString(36).slice(2, 8)}`,
    actorUserId: AKTOR,
    organizationId: ORG,
    conversationId: null,
    chatJid: '6280000000000@s.whatsapp.net',
    senderJid: '6280000000000@s.whatsapp.net',
    isGroup: false,
    timezone: 'Asia/Makassar',
    organizationName: 'Organisasi Uji',
    memberName: 'Anggota Uji',
    history: [],
    text: 'halo bot',
    ...overrides,
  } as unknown as Parameters<AgentRuntime['run']>[0]
}

function runtime(llm: LlmProvider, options: { recorder?: AgentRunRecorder; maxSteps?: number } = {}): AgentRuntime {
  return new AgentRuntime({
    llm,
    tools: toolPencatat(),
    authorization: {} as never,
    ...(options.recorder ? { recorder: options.recorder } : {}),
    maxSteps: options.maxSteps ?? 5,
  })
}

describe('rekaman jalan normal', () => {
  it('setiap jalan agent menghasilkan baris AgentTask', async () => {
    const recorder = new AgentRunRecorder(prisma)
    const agent = runtime(llmDengan([{ content: 'Halo, ada yang bisa kubantu?' }]), { recorder })

    const req = permintaan()
    await agent.run(req)

    const baris = await prisma.agentTask.findFirst({
      where: { state: { path: ['correlationId'], equals: req.correlationId } },
      include: { steps: { orderBy: { ordinal: 'asc' } } },
    })

    expect(baris).toBeTruthy()
    expect(baris!.status).toBe('COMPLETED')
    expect(baris!.errorCode).toBe('JAWABAN_FINAL')
    expect(baris!.endedAt).toBeTruthy()
    expect(baris!.steps).toHaveLength(1)
  })
  it('BUG REGRESSION: ToolExecution akhirnya TERHUBUNG ke jalan agent', async () => {
    // Sebelum modul ini, `ToolExecution.taskId` selalu null. Data di produksi
    // sebelum perubahan: 2232 baris eksekusi, 0 yang terhubung ke apa pun.
    // Akibatnya tidak ada cara menjawab "kenapa agent ini memanggil tool itu".
    const recorder = new AgentRunRecorder(prisma)
    const agent = runtime(
      llmDengan([
        { toolCalls: [{ id: 'call-1', name: 'uji_dasar', arguments: {} }] },
        { content: 'Sudah selesai.' },
      ]),
      { recorder },
    )

    const req = permintaan()
    await agent.run(req)

    const jejak = await prisma.toolExecution.findFirst({
      where: { correlationId: req.correlationId },
      select: { taskId: true, toolName: true },
    })

    expect(jejak?.toolName).toBe('uji_dasar')
    expect(jejak?.taskId).toBeTruthy()

    // Dan id itu benar-benar menunjuk ke baris induk yang ada.
    const induk = await prisma.agentTask.findUnique({
      where: { id: jejak!.taskId! },
      select: { id: true, title: true },
    })
    expect(induk).toBeTruthy()
    expect(induk!.id).toBe(recorder.id)
  })

  it('menyimpan tool yang dipanggil sebagai langkah', async () => {
    const recorder = new AgentRunRecorder(prisma)
    const agent = runtime(
      llmDengan([
        { toolCalls: [{ id: 'c1', name: 'uji_dasar', arguments: {} }] },
        { content: 'Selesai.' },
      ]),
      { recorder },
    )

    const req = permintaan()
    await agent.run(req)

    const baris = await prisma.agentTask.findFirst({
      where: { state: { path: ['correlationId'], equals: req.correlationId } },
      include: { steps: { orderBy: { ordinal: 'asc' } } },
    })

    expect(baris!.steps).toHaveLength(2)
    expect(baris!.steps[0]!.toolName).toBe('uji_dasar')
    expect(baris!.steps[0]!.ordinal).toBe(1)
    // Putaran tanpa tool dicatat sebagai jawaban akhir, supaya rekaman bisa
    // membedakan "berhenti karena selesai" dari "berhenti tanpa gunanya".
    expect(baris!.steps[1]!.toolName).toBeNull()
    expect(baris!.steps[1]!.description).toMatch(/jawaban akhir/i)
  })
})

describe('alasan berhenti', () => {
  it('BUG REGRESSION: langkah habis tercatat sebagai MAX_STEPS, bukan "beres"', async () => {
    // Kelihatannya berhasil — status `completed`, dan pengguna tetap
    // menerima balasan. Tapi sebenarnya agent tidak pernah menjawab, hanya
    // kehabisan kesempatan.
    //
    // Tanpa `errorCode`, rekaman ini terlihat sama dengan jalan yang berhasil
    // sempurna, dan "kenapa bot ini selalu bilang belum selesai?" tidak punya
    // jawaban.
    const recorder = new AgentRunRecorder(prisma)
    const agent = runtime(
      llmDengan([{ toolCalls: [{ id: 'c1', name: 'uji_dasar', arguments: {} }] }]),
      { recorder, maxSteps: 2 },
    )

    const req = permintaan()
    const hasil = await agent.run(req)

    expect(hasil.status).toBe('completed')

    const baris = await prisma.agentTask.findFirst({ where: { state: { path: ['correlationId'], equals: req.correlationId } } })
    expect(baris!.errorCode).toBe('MAX_STEPS')
    expect(baris!.status).toBe('COMPLETED')
  })

  it('BUG REGRESSION: error penyedia tercatat sebagai FAILED, bukan "beres"', async () => {
    const recorder = new AgentRunRecorder(prisma)
    const req = permintaan()
    const agent = runtime(
      {
        name: 'tiruan',
        model: 'tiruan',
        healthCheck: async () => ({ ok: true, latencyMs: 1 }),
        chat: async () => {
          throw new LlmError('rate_limited', 'kena rate limit', true)
        },
      },
      { recorder },
    )

    await agent.run(req)

    const baris = await prisma.agentTask.findFirst({ where: { state: { path: ['correlationId'], equals: req.correlationId } } })
    expect(baris!.status).toBe('FAILED')
    expect(baris!.errorCode).toBe('LLM_ERROR')
  })

  it('respons kosong tercatat sebagai EMPTY_RESPONSE', async () => {
    const recorder = new AgentRunRecorder(prisma)
    const agent = runtime(llmDengan([{ content: '   ' }]), { recorder })

    const req = permintaan()
    await agent.run(req)

    const baris = await prisma.agentTask.findFirst({ where: { state: { path: ['correlationId'], equals: req.correlationId } } })
    expect(baris!.errorCode).toBe('EMPTY_RESPONSE')
    expect(baris!.status).toBe('FAILED')
  })
})

describe('isi pesan tidak diduplikasi', () => {
  it('BUG REGRESSION: isi pesan tidak ikut tersimpan di rekaman', async () => {
    // Isi pesan sudah ada di `Message`. Menyalinnya berarti dua tempat harus
    // ikut dihapus kalau ada permintaan penghapusan data — dan biasanya hanya
    // satu yang terlupakan.
    const rahasia = 'Nomor rekening saya 1234567890 jangan dibagikan'
    const recorder = new AgentRunRecorder(prisma)
    const agent = runtime(llmDengan([{ content: 'Siap.' }]), { recorder })

    const req = permintaan({ text: rahasia })
    await agent.run(req)

    const baris = await prisma.agentTask.findFirst({
      where: { state: { path: ['correlationId'], equals: req.correlationId } },
      include: { steps: true },
    })

    const seluruhRekaman = JSON.stringify({
      title: baris!.title,
      state: baris!.state,
      goal: baris!.goal,
      steps: baris!.steps,
    })

    expect(seluruhRekaman).not.toContain(rahasia)
    expect(seluruhRekaman).not.toContain('1234567890')
  })
})

describe('pencatatan tidak boleh mematikan percakapan', () => {
  it('BUG REGRESSION: database gagal, percakapan tetap dijawab', async () => {
    // Ini jalur terpanas sistem. Kalau pencatatan error ikut menggagalkan,
    // bot mati sepenuhnya karena masalah audit — dan orang tidak menerima
    // balasan apa pun.
    const rusak = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === 'agentTask') {
          return {
            create: async () => {
              throw new Error('database tidak bisa ditulis')
            },
            update: async () => {
              throw new Error('database tidak bisa ditulis')
            },
          }
        }
        if (prop === 'agentStep') {
          return { createMany: async () => { throw new Error('database tidak bisa ditulis') } }
        }
        return Reflect.get(target, prop, receiver)
      },
    })

    const recorder = new AgentRunRecorder(rusak as never)
    const agent = runtime(llmDengan([{ content: 'Halo, ini jawaban utamanya.' }]), { recorder })

    const hasil = await agent.run(permintaan())

    expect(hasil.status).toBe('completed')
    expect(hasil.message).toContain('jawaban utamanya')
  })

  it('BUG REGRESSION: tool tetap jalan meski rekaman gagal dibuka', async () => {
    // Kalau `mulai()` gagal dan `taskId` jadi null, `context.taskId` harus
    // jadi null juga — bukan UUID ngawur yang membuat ToolExecution gagal
    // ditulis karena pelanggaran foreign key.
    const rusak = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === 'agentTask') {
          return {
            create: async () => {
              throw new Error('database tidak bisa ditulis')
            },
            update: async () => ({}),
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })

    const recorder = new AgentRunRecorder(rusak as never)
    const agent = runtime(
      llmDengan([
        { toolCalls: [{ id: 'c1', name: 'uji_dasar', arguments: {} }] },
        { content: 'Selesai.' },
      ]),
      { recorder },
    )

    const hasil = await agent.run(permintaan())

    expect(hasil.status).toBe('completed')
    expect(recorder.id).toBeNull()
  })

  it('tanpa recorder, agent tetap berfungsi', async () => {
    const agent = runtime(llmDengan([{ content: 'Halo.' }]))
    const reqTanpaRecorder = permintaan()
    const hasil = await agent.run(reqTanpaRecorder)
    expect(hasil.status).toBe('completed')

    const jumlah = await prisma.agentTask.count({
      where: { state: { path: ['correlationId'], equals: reqTanpaRecorder.correlationId } },
    })
    expect(jumlah).toBe(0)
  })
})

/** Bantu: prefix korelasi uji (dipakai hanya untuk query yang longgar). */
function correlationTerakhir(_prefix: string): string {
  return 'tidak-ada-yang-cocok-'
}