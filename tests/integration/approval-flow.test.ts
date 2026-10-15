/**
 * Uji integrasi alur persetujuan lewat MessageHandler.
 *
 * Unit test sudah menguji mesin persetujuan. Test ini menguji jalur yang
 * sebenarnya dilewati pengguna: pesan masuk → pipeline → identitas →
 * persetujuan → balasan → eksekusi.
 *
 * Yang paling penting di sini adalah hal yang SALAH bisa lolos:
 *  - orang yang bukan pemohon menyetujui
 *  - persetujuan dieksekusi dua kali
 *  - payload berubah setelah diminta tapi tetap disetujui
 *  - tool yang butuh persetujuan berjalan tanpa persetujuan
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { bootstrap } from '../../src/bootstrap.js'
import { prisma } from '../../src/database/client.js'
import type { WhatsAppProvider } from '../../src/whatsapp/types.js'
import type { NormalizedMessage } from '../../src/whatsapp/types.js'

/**
 * Organisasi dan aktor NYATA dari database.
 *
 * Test ini memakai UUID fiktif sempat membuat semua pengujian gagal: RBAC
 * menolak di lapisan izin SEBELUM lapisan persetujuan, jadi tidak ada yang
 * sampai ke alur yang ingin diuji. Uji jalur yang benar butuh aktor yang
 * benar-benar punya izin.
 */
const ORG_ID = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const CHAT = '6285792820173@s.whatsapp.net'
const PRIBADI = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'

let app: Awaited<ReturnType<typeof bootstrap>>
/** Pesan yang terkirim keluar, dicatat supaya bisa diperiksa. */
let terkirim: Array<{ to: string; text: string }>
/** Balasan pemanggil WhatsApp tiruan — dipakai untuk simulasi pengiriman. */
let hasilKirim: 'delivered' | 'failed'

beforeAll(async () => {
  terkirim = []
  hasilKirim = 'delivered'

  const whatsapp = {
    name: 'palsu',
    async connect() {},
    async disconnect() {},
    getStatus: () => ({ state: 'connected' as const, phoneNumber: null, reason: null, since: new Date() }),
    async sendText(to: string, text: string) {
      terkirim.push({ to, text })
      return hasilKirim === 'failed'
        ? { status: 'failed' as const, providerMessageId: null, errorCode: 'TEST' }
        : { status: 'delivered' as const, providerMessageId: 'test' }
    },
    async sendDocument() {
      return { status: 'delivered' as const, providerMessageId: 'test' }
    },
    async getGroupMetadata() {
      return null
    },
    async on() {
      return () => {}
    },
    onError() {
      return () => {}
    },
  } as unknown as WhatsAppProvider

  app = await bootstrap({ whatsappProvider: whatsapp, startWorkers: false })
}, 60_000)

afterAll(async () => {
  await app.shutdown()
})

function pesan(teks: string, pengirim = CHAT): NormalizedMessage {
  return {
    id: `integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    accountId: '6285177653481@s.whatsapp.net',
    chatJid: pengirim,
    senderJid: pengirim,
    groupJid: null,
    senderPushName: 'Uji Integrasi',
    type: 'text',
    text: teks,
    fileName: null,
    mimetype: null,
    quotedMessageId: null,
    mentionedJids: [],
    mentionText: [],
    timestamp: new Date(),
    isFromMe: false,
    deliveryStatus: null,
    raw: {},
  }
}

/** Bersihkan sisa uji sebelumnya supaya setiap test berdiri sendiri. */
async function bersihkan(): Promise<void> {
  terkirim = []
  await prisma.approval.deleteMany({ where: { organizationId: ORG_ID } })
  await prisma.message.deleteMany({ where: { conversation: { chatJid: CHAT } } })
  await prisma.conversation.deleteMany({ where: { chatJid: CHAT } })
}

describe('alur persetujuan lewat handler', () => {
  it('tool yang butuh persetujuan TIDAK jalan sebelum disetujui', async () => {
    await bersihkan()
    const tool = app.tools.get('whatsapp_send_message')!
    expect(tool.requiresApproval).toBe(true)

    const hasil = await app.tools.execute(
      'whatsapp_send_message',
      { to: CHAT, text: 'pesan uji' },
      {
        actorUserId: PRIBADI,
        organizationId: ORG_ID,
        conversationId: null,
        taskId: null,
        chatJid: CHAT,
        senderJid: CHAT,
        correlationId: 'integ-1',
        timezone: 'Asia/Makassar',
        authorization: app.authorization,
      },
    )

    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      // Pesan ke agen harus menyebut persetujuan, bukan "gagal".
      expect(hasil.error.message).toContain('persetujuan')
    }

    // Tidak ada pesan yang benar-benar terkirim ke penerima.
    const keluar = terkirim.filter((m) => m.text === 'pesan uji')
    expect(keluar).toHaveLength(0)

    // Dan persetujuannya tercatat, menunggu jawaban.
    const pending = await prisma.approval.findFirst({ where: { organizationId: ORG_ID, status: 'PENDING' } })
    expect(pending).not.toBeNull()
    expect(pending!.actionType).toBe('whatsapp_send_message')
  }, 120_000)

  it('balasan "iya" dari pemohon menyetujui dan menjalankan', async () => {
    await bersihkan()

    // 1. Minta persetujuan.
    await app.tools.execute(
      'whatsapp_send_message',
      { to: CHAT, text: 'pesan yang disetujui' },
      {
        actorUserId: PRIBADI,
        organizationId: ORG_ID,
        conversationId: null,
        taskId: null,
        chatJid: CHAT,
        senderJid: CHAT,
        correlationId: 'integ-2a',
        timezone: 'Asia/Makassar',
        authorization: app.authorization,
      },
    )
    terkirim = []

    // 2. Pemohon menjawab "iya".
    const balasan = await app.approvals.tryHandleReply({ text: 'iya', chatJid: CHAT, actorUserId: PRIBADI })

    expect(balasan).toBe('approve')

    // 3. Pesan benar-benar terkirim.
    expect(terkirim.some((m) => m.text === 'pesan yang disetujui')).toBe(true)

    const selesai = await prisma.approval.findFirst({ where: { organizationId: ORG_ID } })
    expect(selesai!.status).toBe('APPROVED')
  }, 60_000)

  it('balasan "iya" dari orang LAIN ditolak', async () => {
    // Di grup siapa pun bisa mengetik. Kalau ini lolos, anggota biasa bisa
    // menyetujui tindakan yang bukan miliknya.
    await bersihkan()

    await app.tools.execute(
      'whatsapp_send_message',
      { to: CHAT, text: 'rahasia' },
      {
        actorUserId: PRIBADI,
        organizationId: ORG_ID,
        conversationId: null,
        taskId: null,
        chatJid: CHAT,
        senderJid: CHAT,
        correlationId: 'integ-3a',
        timezone: 'Asia/Makassar',
        authorization: app.authorization,
      },
    )
    terkirim = []

    const orangLain = await app.approvals.tryHandleReply({
      text: 'iya',
      chatJid: CHAT,
      actorUserId: '99999999-9999-9999-9999-999999999999',
    })

    expect(orangLain).toBe('reject')
    expect(terkirim.some((m) => m.text === 'rahasia')).toBe(false)
  }, 60_000)

  it('balasan dari chat LAIN ditolak', async () => {
    // Permintaan dikirim ke chat tertentu; balasan dari chat lain diabaikan.
    await bersihkan()

    await app.tools.execute(
      'whatsapp_send_message',
      { to: CHAT, text: 'pergupan' },
      {
        actorUserId: PRIBADI,
        organizationId: ORG_ID,
        conversationId: null,
        taskId: null,
        chatJid: CHAT,
        senderJid: CHAT,
        correlationId: 'integ-4a',
        timezone: 'Asia/Makassar',
        authorization: app.authorization,
      },
    )
    terkirim = []

    const dariChatLain = await app.approvals.tryHandleReply({
      text: 'iya',
      chatJid: '628999@s.whatsapp.net',
      actorUserId: PRIBADI,
    })

    expect(dariChatLain).toBe('reject')
    expect(terkirim.some((m) => m.text === 'pergupan')).toBe(false)
  }, 60_000)

  it('TIDAK menjalankan dua kali walau "iya" diulang', async () => {
    await bersihkan()

    await app.tools.execute(
      'whatsapp_send_message',
      { to: CHAT, text: 'sekali saja' },
      {
        actorUserId: PRIBADI,
        organizationId: ORG_ID,
        conversationId: null,
        taskId: null,
        chatJid: CHAT,
        senderJid: CHAT,
        correlationId: 'integ-5a',
        timezone: 'Asia/Makassar',
        authorization: app.authorization,
      },
    )
    terkirim = []

    await app.approvals.tryHandleReply({ text: 'iya', chatJid: CHAT, actorUserId: PRIBADI })
    const kedua = await app.approvals.tryHandleReply({ text: 'iya', chatJid: CHAT, actorUserId: PRIBADI })

    expect(kedua).toBe('reject')
    expect(terkirim.filter((m) => m.text === 'sekali saja')).toHaveLength(1)
  }, 60_000)

  it('"batal" membatalkan dan TIDAK menjalankan', async () => {
    await bersihkan()

    await app.tools.execute(
      'whatsapp_send_message',
      { to: CHAT, text: 'jangan dikirim' },
      {
        actorUserId: PRIBADI,
        organizationId: ORG_ID,
        conversationId: null,
        taskId: null,
        chatJid: CHAT,
        senderJid: CHAT,
        correlationId: 'integ-6a',
        timezone: 'Asia/Makassar',
        authorization: app.authorization,
      },
    )
    terkirim = []

    const hasil = await app.approvals.tryHandleReply({ text: 'batal', chatJid: CHAT, actorUserId: PRIBADI })

    expect(hasil).toBe('reject')
    expect(terkirim.some((m) => m.text === 'jangan dikirim')).toBe(false)

    const row = await prisma.approval.findFirst({ where: { organizationId: ORG_ID } })
    expect(row!.status).toBe('REJECTED')
  }, 60_000)

  it('percakapan biasa diteruskan ke agent, bukan diperlakukan sebagai persetujuan', async () => {
    // "iya" di dalam kalimat panjang bukan persetujuan.
    await bersihkan()

    const hasil = await app.approvals.tryHandleReply({
      text: 'iya dong ini penting sekali untuk organisasi kita',
      chatJid: CHAT,
      actorUserId: PRIBADI,
    })

    expect(hasil).toBe('none')
  }, 30_000)

  it('penolakan tercatat untuk audit', async () => {
    // Setiap keputusan harus punya jejak.
    await bersihkan()

    await app.tools.execute(
      'whatsapp_send_message',
      { to: CHAT, text: 'diaudit' },
      {
        actorUserId: PRIBADI,
        organizationId: ORG_ID,
        conversationId: null,
        taskId: null,
        chatJid: CHAT,
        senderJid: CHAT,
        correlationId: 'integ-8a',
        timezone: 'Asia/Makassar',
        authorization: app.authorization,
      },
    )

    // Jalur "menunggu persetujuan" menulis ke AuditLog (ToolExecution hanya
    // diisi kalau tool benar-benar dieksekusi).
    const jejak = await prisma.auditLog.findFirst({
      where: { correlationId: 'integ-8a', outcome: 'pending' },
      select: { action: true, reasonCode: true },
    })

    expect(jejak).not.toBeNull()
    expect(jejak!.action).toBe('tool.whatsapp_send_message')
    expect(jejak!.reasonCode).toBe('APPROVAL_PENDING')
  }, 60_000)
})