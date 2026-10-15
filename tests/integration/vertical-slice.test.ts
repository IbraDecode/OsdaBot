/**
 * Test integrasi alur vertikal — mocked, tapi exercised lewat modul NYATA.
 *
 * Yang dibuktikan di sini:
 *   Pesan masuk → pipeline (dedupe + aktivasi) → identitas → agent runtime
 *   → tool registry (validasi + otorisasi) → AttendanceService → PostgreSQL
 *   → render WhatsApp → respons
 *
 * Yang di-mock (wajib):
 *   - WhatsApp provider (tidak boleh kirim pesan sungguhan)
 *   - LLM (deterministik, supaya bisa menguji pemilihan tool)
 *
 * Yang NYATA:
 *   - PostgreSQL (test database)
 *   - seluruh logika bisnis antara keduanya
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { AgentRuntime } from '../../src/agent/runtime.js'
import type { ChatRequest, ChatResponse, LlmProvider, ToolCall } from '../../src/agent/llm/provider.js'
import { AttendanceService } from '../../src/attendance/service.js'
import { AttendanceStatus } from '@prisma/client'
import { canonicalizeName } from '../../src/identity/name-normalizer.js'
import { IdentityEngine } from '../../src/identity/resolver.js'
import { MessagePipeline } from '../../src/pipeline/message-pipeline.js'
import { AuthorizationService } from '../../src/security/authorization.js'
import { PERMISSIONS } from '../../src/security/permissions.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { buildAttendanceTools } from '../../src/tools/attendance-tools.js'
import { buildOrganizationTools } from '../../src/tools/organization-tools.js'
import type { NormalizedMessage, WhatsAppProvider, WhatsAppProviderEvents } from '../../src/whatsapp/types.js'
import { prisma as sharedPrisma } from '../../src/database/client.js'

const prisma = sharedPrisma as PrismaClient

// ---------------------------------------------------------------------------
// Test double
// ---------------------------------------------------------------------------

/** Skrip respons LLM: setiap call mengembalikan tool call atau teks. */
class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted'
  readonly model = 'scripted-test'

  calls: ChatRequest[] = []

  constructor(private readonly steps: Array<{ toolCalls?: ToolCall[]; content?: string }>) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push(request)
    const step = this.steps[this.calls.length - 1] ?? { content: 'Selesai.' }

    return {
      content: step.content ?? null,
      toolCalls: step.toolCalls ?? [],
      finishReason: (step.toolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }
  }

  async healthCheck() {
    return { ok: true, latencyMs: 1 }
  }
}

class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'fake'
  sent: Array<{ chatJid: string; text: string; mentions: string[] }> = []
  private listeners = new Map<keyof WhatsAppProviderEvents, Set<(...args: never[]) => void>>()

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  getStatus() {
    return { state: 'connected' as const, phoneNumber: '628000000000', reason: null, since: new Date() }
  }

  async sendText(chatJid: string, text: string, options: { mentions?: string[] } = {}) {
    this.sent.push({ chatJid, text, mentions: options.mentions ?? [] })
    return { providerMessageId: `msg_${this.sent.length}`, status: 'provider_accepted' as const }
  }

  async sendDocument() {
    return { providerMessageId: null, status: 'provider_accepted' as const }
  }
  async sendImage() {
    return { providerMessageId: null, status: 'provider_accepted' as const }
  }
  async reactToMessage() {
    return { providerMessageId: null, status: 'provider_accepted' as const }
  }
  async getGroupMetadata() {
    return null
  }
  async getGroupParticipants() {
    return []
  }
  /** Grup yang "diikuti" bot tiruan. */
  joinedGroups: Array<{ jid: string; subject: string | null }> = []
  /** Lampiran yang bisa diunduh, dikunci id pesannya. */
  lampiran = new Map<string, Buffer>()

  async downloadMediaById(messageId: string) {
    return this.lampiran.get(messageId) ?? null
  }

  async listJoinedGroups() {
    return this.joinedGroups
  }

  async getAllGroups() {
    return this.joinedGroups.map((g) => ({
      jid: g.jid,
      subject: g.subject,
      description: null,
      ownerJid: null,
      participantCount: null,
      participants: [],
    }))
  }

  on<K extends keyof WhatsAppProviderEvents>(event: K, listener: WhatsAppProviderEvents[K]): () => void {
    const set = (this.listeners.get(event) ?? new Set()) as Set<(...args: never[]) => void>
    set.add(listener as (...args: never[]) => void)
    this.listeners.set(event, set)
    return () => set.delete(listener as (...args: never[]) => void)
  }

  onError() {
    return () => undefined
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let organizationId: string
let attendanceEventId: string
let managerUserId: string
let memberUserId: string
let managerMemberId: string
let targetMemberId: string
let namaTarget: string

/**
 * Fixture sengaja berisi KASUS AMBIGU:
 *  - "Danya" dipakai sebagai nama panggilan Danya Sefti (unambigu) → harus unik.
 *  - "Dany" dipakai oleh Danya Putri DAN Dava Pratama → harus ambiguous.
 *
 * Ini skenario nyata di sekolah: nama panggilan yang sama dipakai >1 orang.
 */
const ANGGOTA = [
  { fullName: 'Danya Sefti Cahyani', className: 'X AKL 3', aliases: ['Danya'] },
  { fullName: 'Danya Putri Rahma', className: 'X MPK 1', aliases: ['Dany'] },
  { fullName: 'Dava Pratama', className: 'X RPL 1', aliases: ['Dany'] },
  { fullName: 'Ibra Ramdan', className: 'X BDG 1', aliases: ['Ibra'] },
]

async function makeMember(fullName: string, className: string, aliases: string[], userId?: string) {
  const created = await prisma.organizationMember.create({
    data: {
      organizationId,
      fullName,
      className,
      searchName: canonicalizeName(fullName),
      userId: userId ?? null,
      ...(aliases.length > 0 ? { aliases: { create: aliases.map((alias) => ({ alias })) } } : {}),
    },
    select: { id: true },
  })
  return created.id
}

beforeAll(async () => {
  const slug = `test-${Date.now()}`

  const org = await prisma.organization.create({
    data: { name: 'Organisasi Uji Integrasi', slug, timezone: 'Asia/Makassar' },
    select: { id: true },
  })
  organizationId = org.id

  // Permission untuk pengelola kehadiran.
  for (const permission of [PERMISSIONS.MEMBERS_READ, PERMISSIONS.ATTENDANCE_READ, PERMISSIONS.ATTENDANCE_CREATE, PERMISSIONS.ATTENDANCE_UPDATE]) {
    await prisma.permission.upsert({
      where: { key: permission },
      create: { key: permission, group: 'Test', description: 'izin uji' },
      update: {},
    })
  }

  const role = await prisma.organizationRole.create({
    data: { organizationId, key: 'pengelola', name: 'Pengelola', description: 'Peran uji' },
    select: { id: true },
  })
  await prisma.rolePermission.createMany({
    data: [PERMISSIONS.MEMBERS_READ, PERMISSIONS.ATTENDANCE_READ, PERMISSIONS.ATTENDANCE_UPDATE].map(
      (permissionId) => ({ roleId: role.id, permissionId }),
    ),
  })

  // Pengguna pengelola.
  const managerUser = await prisma.user.create({ data: { displayName: 'Pengelola Uji' }, select: { id: true } })
  managerUserId = managerUser.id
  managerMemberId = await makeMember('Pengelola Uji', 'X', [], managerUserId)
  await prisma.memberRoleBinding.create({ data: { memberId: managerMemberId, roleId: role.id } })

  // Pengguna biasa (tanpa izin apa pun).
  const memberUser = await prisma.user.create({ data: { displayName: 'Anggota Biasa' }, select: { id: true } })
  memberUserId = memberUser.id
  await makeMember('Anggota Biasa', 'X', [], memberUserId)

  // Anggota target (termasuk yang sengaja membuat ambiguitas alias).
  targetMemberId = await makeMember(ANGGOTA[0]!.fullName, ANGGOTA[0]!.className, ANGGOTA[0]!.aliases)
  namaTarget = ANGGOTA[0]!.fullName
  for (const anggota of ANGGOTA.slice(1)) {
    await makeMember(anggota.fullName, anggota.className, anggota.aliases)
  }

  // Daftar hadir awal.
  const attendance = await prisma.attendanceEvent.create({
    data: {
      organizationId,
      title: 'Latihan Uji',
      eventDate: new Date('2030-01-15T00:00:00.000Z'),
      markdownTemplate: '*LIST YANG HADIR UJI*\n\n1. Danya Sefti Cahyani (X AKL 3)\n\n*IZIN*\n-',
      formatHints: { boldMarker: '*', emptyMarker: '-' },
    },
    select: { id: true },
  })
  attendanceEventId = attendance.id

  await prisma.attendanceEntry.create({
    data: {
      attendanceEventId,
      memberId: targetMemberId,
      displayName: ANGGOTA[0]!.fullName,
      className: ANGGOTA[0]!.className,
      status: AttendanceStatus.PRESENT,
      sortOrder: 0,
    },
  })

  // Percakapan untuk pengirim. Dibuat idempoten supaya test bisa diulang.
  await prisma.conversation.upsert({
    where: { chatJid: '628111111111@s.whatsapp.net' },
    create: { chatJid: '628111111111@s.whatsapp.net', chatType: 'private', organizationId },
    update: { organizationId },
  })
})

afterAll(async () => {
  // Bersihkan hanya data uji organisasi ini.
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
  await prisma.user.deleteMany({ where: { id: { in: [managerUserId, memberUserId] } } }).catch(() => undefined)
  await prisma.permission.deleteMany({ where: { group: 'Test' } }).catch(() => undefined)
  await prisma.$disconnect()
})

/** Bangun seluruh modul nyata dengan provider yang di-mock. */
function buildStack(llm: LlmProvider, whatsapp: WhatsAppProvider) {
  const authorization = new AuthorizationService({ prisma, logger: console as never, cacheTtlMs: 0 })
  const identity = new IdentityEngine({ prisma })
  const attendance = new AttendanceService({ prisma })
  const tools = new ToolRegistry({ prisma })

  tools.registerAll(buildAttendanceTools({ attendance, identity }) as never)
  tools.registerAll(buildOrganizationTools({ prisma, whatsapp }) as never)

  const agent = new AgentRuntime({ llm, tools, authorization, maxSteps: 6, maxToolCalls: 8 })
  const pipeline = new MessagePipeline({ prisma })

  return { authorization, identity, attendance, tools, agent, pipeline, whatsapp }
}

function message(text: string, overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: randomUUID(),
    accountId: 'primary',
    chatJid: '628111111111@s.whatsapp.net',
    senderJid: '628111111111@s.whatsapp.net',
    groupJid: null,
    senderPushName: 'Pengelola Uji',
    type: 'text',
    text,
    fileName: null,
    mimetype: null,
    quotedMessageId: null,
    mentionedJids: [],
    mentionText: [],
    timestamp: new Date(),
    isFromMe: false,
    deliveryStatus: null,
    raw: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------

describe('pipeline: dedupe & filter', () => {
  it('menolak pesan milik sendiri sendiri', async () => {
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const decision = await pipeline.decide(message('osda halo', { isFromMe: true }))
    expect(decision).toEqual({ action: 'skip', reason: 'own_message' })
  })

  it('menolak pesan kosong', async () => {
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const decision = await pipeline.decide(message('   '))
    expect(decision).toEqual({ action: 'skip', reason: 'empty_text' })
  })

  it('memproses pesan private', async () => {
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const decision = await pipeline.decide(message('osda halo'))
    expect(decision.action).toBe('process')
  })

  it('menolak pesan grup yang belum tertaut ke organisasi', async () => {
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const decision = await pipeline.decide(
      message('osda halo', { chatJid: '12036304290123456789@g.us', senderJid: '628111111111@s.whatsapp.net' }),
    )
    expect(decision).toEqual({ action: 'skip', reason: 'group_not_linked' })
  })

  it('DEDUPE: pesan dengan id sama hanya diproses sekali', async () => {
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    pipeline.reset()

    const id = randomUUID()
    const pertama = await pipeline.decide(message('osda halo', { id }))
    const kedua = await pipeline.decide(message('osda halo', { id }))

    expect(pertama.action).toBe('process')
    expect(kedua).toEqual({ action: 'skip', reason: 'duplicate_in_memory' })
  })

  it('dedupeKey hanya bergantung pada account + message id', () => {
    const key1 = MessagePipeline.dedupeKey(message('teks A', { id: 'MSG1' }))
    const key2 = MessagePipeline.dedupeKey(message('teks B Totally Berbeda', { id: 'MSG1' }))
    // Isi pesan tidak memengaruhi kunci — hanya identitas pesan.
    expect(key1).toBe(key2)
  })
})

describe('pipeline: kebijakan aktivasi grup', () => {
  let groupJid: string

  beforeAll(async () => {
    groupJid = `120363${Date.now()}@g.us`
    await prisma.group.upsert({
      where: { jid: groupJid },
      create: { organizationId, jid: groupJid, subject: 'Grup Uji', activation: 'MENTION_OR_REPLY' },
      update: { organizationId },
    })
  })

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { jid: groupJid } }).catch(() => undefined)
  })

  it('mengabaikan pesan grup yang tidak menyebut bot', async () => {
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    pipeline.reset()
    const decision = await pipeline.decide(
      message('halo semua orang', { chatJid: groupJid, groupJid }),
    )
    expect(decision).toEqual({ action: 'skip', reason: 'group_requires_mention' })
  })

  it('merespons saat nama bot dipanggil', async () => {
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    pipeline.reset()
    const decision = await pipeline.decide(message('osda siapa yang hadir', { chatJid: groupJid, groupJid }))
    expect(decision).toEqual({ action: 'process', reason: 'mentioned' })
  })

  it('menghormati grup dengan aktivasi OFF', async () => {
    const offJid = `120364${Date.now()}@g.us`
    await prisma.group.create({ data: { organizationId, jid: offJid, subject: 'Grup OFF', activation: 'OFF' } })
    const { pipeline } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    pipeline.reset()

    const decision = await pipeline.decide(message('osda halo', { chatJid: offJid, groupJid: offJid }))
    expect(decision).toEqual({ action: 'skip', reason: 'group_activation_off' })

    await prisma.group.delete({ where: { jid: offJid } }).catch(() => undefined)
  })
})

describe('identity: resolusi nama & ambiguitas', () => {
  it('menemukan anggota unik', async () => {
    const { identity } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const result = await identity.resolveMemberByName(organizationId, 'Ibra Ramdan')
    expect(result.certainty).toBe('unique')
  })

  it('ALIAS TUNGGAL membuat nama jelas — tidak boleh jadi ambigu', async () => {
    const { identity } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    // Hanya Danya Sefti Cahyani yang punya alias persis "Danya".
    const result = await identity.resolveMemberByName(organizationId, 'Danya')
    expect(result.certainty).toBe('unique')
    if (result.certainty === 'unique') expect(result.memberName).toBe('Danya Sefti Cahyani')
  })

  it('ALIAS YANG DIPAKAI BEBERAPA ORANG → wajib minta klarifikasi', async () => {
    const { identity } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    // "Dany" dipakai oleh Danya Putri Rahma dan Dava Pratama.
    const result = await identity.resolveMemberByName(organizationId, 'Dany')
    expect(result.certainty).toBe('ambiguous')
    if (result.certainty === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2)
      const nama = result.candidates.map((c) => c.name)
      expect(nama).toContain('Danya Putri Rahma')
      expect(nama).toContain('Dava Pratama')
    }
  })

  it('memberi null untuk anggota yang tidak ada', async () => {
    const { identity } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const result = await identity.resolveMemberByName(organizationId, 'Zainal Muttaqqin')
    expect(result.certainty).toBe('none')
  })

  it('menyelesaikan nama dengan gelar', async () => {
    const { identity } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const result = await identity.resolveMemberByName(organizationId, 'Bapak Ibra Ramdan')
    expect(result.certainty).toBe('unique')
  })
})

describe('attendance service', () => {
  it('menampilkan daftar dengan format yang dipertahankan', async () => {
    const { attendance } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const rendered = await attendance.renderList(organizationId, attendanceEventId)
    expect(rendered).toContain('*LIST YANG HADIR UJI*')
    expect(rendered).toContain('Danya Sefti Cahyani (X AKL 3)')
  })

  it('IDEMPOTEN: menambahkan anggota dua kali tidak menghasilkan dua entri', async () => {
    const { attendance, identity } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())

    const resolution = await identity.resolveMemberByName(organizationId, 'Ibra Ramdan')
    expect(resolution.certainty).toBe('unique')
    if (resolution.certainty !== 'unique') return

    const pertama = await attendance.addMember({ organizationId, attendanceEventId, memberId: resolution.memberId })
    const kedua = await attendance.addMember({ organizationId, attendanceEventId, memberId: resolution.memberId })

    expect(kedua.alreadyPresent).toBe(true)

    const { entries } = await attendance.getEntries(organizationId, attendanceEventId)
    const jumlahIbra = entries.filter((entry) => entry.memberId === resolution.memberId).length
    expect(jumlahIbra).toBe(1)
    void pertama
  })

  it('mengubah hanya field yang diberikan', async () => {
    const { attendance } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())

    const updated = await attendance.updateEntry({
      organizationId,
      attendanceEventId,
      memberId: targetMemberId,
      status: AttendanceStatus.EXCUSED,
      reason: 'ada meeting',
    })

    expect(updated.status).toBe('EXCUSED')
    expect(updated.reason).toBe('ada meeting')
    expect(updated.displayName).toBe(namaTarget)
    expect(updated.className).toBe(ANGGOTA[0]!.className)
  })

  it('"ganti alasannya" tidak menghapus status', async () => {
    const { attendance } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())

    // Set status dulu kalau perlu.
    await attendance.updateEntry({
      organizationId,
      attendanceEventId,
      memberId: targetMemberId,
      status: AttendanceStatus.EXCUSED,
    })

    const updated = await attendance.updateEntry({
      organizationId,
      attendanceEventId,
      memberId: targetMemberId,
      reason: 'ada urusan mendadak',
    })

    // Field yang tidak disebut harus tetap.
    expect(updated.reason).toBe('ada urusan mendadak')
    expect(updated.status).toBe('EXCUSED')
  })

  it('MENOLAK entri dari organisasi lain', async () => {
    const slugLain = `test-isolated-${Date.now()}`
    const orgLain = await prisma.organization.create({
      data: { name: 'Org Isolated', slug: slugLain },
      select: { id: true },
    })

    const { attendance } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())

    // ID kegiatan dari org A, organizationId org B → harus ditolak.
    await expect(
      attendance.getEvent(orgLain.id, attendanceEventId),
    ).rejects.toThrow(/tidak ditemukan/)

    await prisma.organization.delete({ where: { id: orgLain.id } }).catch(() => undefined)
  })

  it('menghitung rekap per status', async () => {
    const { attendance } = buildStack(new ScriptedLlmProvider([{ content: 'x' }]), new FakeWhatsAppProvider())
    const ringkasan = await attendance.summarize(organizationId, attendanceEventId)
    expect(ringkasan.total).toBeGreaterThan(0)
    expect(ringkasan.byStatus.PRESENT).toBeDefined()
  })
})

describe('agent runtime dengan tool nyata', () => {
  it('menjalankan tool pencarian anggota lalu menjawab', async () => {
    const llm = new ScriptedLlmProvider([
      {
        toolCalls: [
          {
            id: 'call_1',
            name: 'organization_search_members',
            arguments: { query: 'Ibra Ramdan' },
          },
        ],
      },
      { content: 'Ibra Ramdan, kelas X BDG 1, sudah ketemu.' },
    ])

    const { agent, pipeline } = buildStack(llm, new FakeWhatsAppProvider())
    pipeline.reset()

    const response = await agent.run({
      correlationId: randomUUID(),
      actorUserId: managerUserId,
      organizationId,
      conversationId: null,
      chatJid: '628111111111@s.whatsapp.net',
      senderJid: '628111111111@s.whatsapp.net',
      isGroup: false,
      timezone: 'Asia/Makassar',
      organizationName: 'Organisasi Uji Integrasi',
      memberName: 'Pengelola Uji',
      text: 'carikan Ibra Ramdan',
      history: [],
      capabilities: [],
    })

    expect(response.status).toBe('completed')
    if (response.status === 'completed') {
      expect(response.toolCalls).toBe(1)
      expect(response.message).toContain('Ibra Ramdan')
    }
  })

  it('MENOLAK tool yang tidak diizinkan — meski model memintanya', async () => {
    const llm = new ScriptedLlmProvider([
      {
        toolCalls: [
          {
            id: 'call_denied',
            name: 'organization_create_member',
            arguments: { fullName: 'Orang Ilegal' },
          },
        ],
      },
      { content: 'Maaf, saya tidak bisa menambah anggota.' },
    ])

    const { agent } = buildStack(llm, new FakeWhatsAppProvider())

    // Aktor = anggota biasa (tanpa izin members.create).
    const response = await agent.run({
      correlationId: randomUUID(),
      actorUserId: memberUserId,
      organizationId,
      conversationId: null,
      chatJid: '628222222222@s.whatsapp.net',
      senderJid: '628222222222@s.whatsapp.net',
      isGroup: false,
      timezone: 'Asia/Makassar',
      organizationName: 'Organisasi Uji Integrasi',
      memberName: 'Anggota Biasa',
      text: 'tambahkan orang baru',
      history: [],
      capabilities: [],
    })

    expect(response.status).toBe('completed')

    // Yang penting: orang TIDAK berhasil dibuat di database.
    const dibuat = await prisma.organizationMember.findFirst({
      where: { organizationId, searchName: 'orang ilegal' },
    })
    expect(dibuat).toBeNull()
  })

  it('membatasi jumlah tool call per pesan', async () => {
    // Model selalu minta tool → harus dihentikan oleh batas.
    const llm = new ScriptedLlmProvider(
      Array.from({ length: 20 }, (_, index) => ({
        toolCalls: [{ id: `call_${index}`, name: 'organization_list_members', arguments: {} }],
      })),
    )

    const { agent } = buildStack(llm, new FakeWhatsAppProvider())

    const response = await agent.run({
      correlationId: randomUUID(),
      actorUserId: managerUserId,
      organizationId,
      conversationId: null,
      chatJid: '628111111111@s.whatsapp.net',
      senderJid: '628111111111@s.whatsapp.net',
      isGroup: false,
      timezone: 'Asia/Makassar',
      organizationName: 'Organisasi Uji Integrasi',
      memberName: 'Pengelola Uji',
      text: 'loop terus',
      history: [],
      capabilities: [],
    })

    // Tetap selesai, tidak hang.
    expect(response.status).toBe('completed')
    if (response.status === 'completed') {
      expect(response.toolCalls).toBeLessThanOrEqual(8)
    }
  })

  it('menolak tool call dengan JSON rusak', async () => {
    const llm = new ScriptedLlmProvider([
      {
        toolCalls: [
          {
            id: 'call_bad',
            name: 'organization_list_members',
            arguments: {},
            parseError: 'Argumen tool bukan JSON yang valid.',
          },
        ],
      },
      { content: 'Maaf ada masalah teknis.' },
    ])

    const { agent } = buildStack(llm, new FakeWhatsAppProvider())
    const response = await agent.run({
      correlationId: randomUUID(),
      actorUserId: managerUserId,
      organizationId,
      conversationId: null,
      chatJid: '628111111111@s.whatsapp.net',
      senderJid: '628111111111@s.whatsapp.net',
      isGroup: false,
      timezone: 'Asia/Makassar',
      organizationName: 'Organisasi Uji Integrasi',
      memberName: 'Pengelola Uji',
      text: 'test',
      history: [],
      capabilities: [],
    })

    expect(response.status).toBe('completed')
  })

  it('hanya mengirim tool yang sesuai izin aktor ke model', async () => {
    const llm = new ScriptedLlmProvider([{ content: 'halo' }])
    const { agent } = buildStack(llm, new FakeWhatsAppProvider())

    await agent.run({
      correlationId: randomUUID(),
      actorUserId: memberUserId,
      organizationId,
      conversationId: null,
      chatJid: '628222222222@s.whatsapp.net',
      senderJid: '628222222222@s.whatsapp.net',
      isGroup: false,
      timezone: 'Asia/Makassar',
      organizationName: 'Organisasi Uji Integrasi',
      memberName: 'Anggota Biasa',
      text: 'halo',
      history: [],
      capabilities: [],
    })

    const toolNames = (llm.calls[0]?.tools ?? []).map((tool) => tool.name)
    // Anggota biasa tanpa izin apa pun → tidak boleh ada tool yang dikirim.
    expect(toolNames).toEqual([])
  })
})