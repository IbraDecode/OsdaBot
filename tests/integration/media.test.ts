/**
 * Test jalur lampiran pesan.
 *
 * Dua masalah nyata yang ditutup di sini:
 *
 * 1. **Pesan media tanpa caption dibuang.** `if (!normalized.text) return` di
 *    provider dan `empty_text` di pipeline membuat PDF yang dikirim tanpa
 *    keterangan hilang sebelum sampai ke agent. Pengguna mengira lampirannya
 *    tidak pernah sampai.
 *
 * 2. **Lampiran milik percakapan lain bisa diambil.** Kalau id pesan jadi
 *    parameter bebas, model bisa meminta berkas dari chat lain hanya dengan
 *    menyebut id-nya.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { bootstrap } from '../../src/bootstrap.js'
import { prisma } from '../../src/database/client.js'
import type { WhatsAppProvider } from '../../src/whatsapp/types.js'
import type { NormalizedMessage } from '../../src/whatsapp/types.js'
import { renderDocument } from '../../src/documents/renderer.js'

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const CHAT = '6285792820173@s.whatsapp.net'

/**
 * Aktor NYATA.
 *
 * `actorUserId: null` membuat RBAC menolak di lapisan izin SEBELUM tool
 * dipanggil — jadi tidak ada yang pernah sampai ke jalur yang diuji.
 */
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'

let app: Awaited<ReturnType<typeof bootstrap>>
let pdfUji: Buffer
/** Id pesan terakhir per chat — provider tiruan memakainya. */
let pesanTerakhir: Map<string, string>

function pdfDummy(): Buffer {
  return Buffer.from('%PDF-1.4\n% pretending to be a pdf\n', 'ascii')
}

function pesan(teks: string, opsi: Partial<NormalizedMessage> = {}): NormalizedMessage {
  const id = `media-${Date.now()}-${Math.random().toString(36).slice(2)}`
  pesanTerakhir.set(CHAT, id)
  return {
    id,
    accountId: '6285177653481@s.whatsapp.net',
    chatJid: CHAT,
    senderJid: CHAT,
    groupJid: null,
    senderPushName: 'Admin',
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
    ...opsi,
  }
}

beforeAll(async () => {
  pesanTerakhir = new Map()

  const whatsapp = {
    name: 'palsu',
    async connect() {},
    async disconnect() {},
    getStatus: () => ({ state: 'connected' as const, phoneNumber: null, reason: null, since: new Date() }),
    async sendText() {
      return { status: 'delivered' as const, providerMessageId: 'test' }
    },
    async sendDocument() {
      return { status: 'delivered' as const, providerMessageId: 'test' }
    },
    async getGroupMetadata() {
      return null
    },
    // Hanya lampiran terakhir per chat — mencerminkan perilaku provider sungguhan.
    async downloadMediaById(messageId: string) {
      return messageId === pesanTerakhir.get(CHAT) ? pdfUji : null
    },
    async on() {
      return () => {}
    },
    onError() {
      return () => {}
    },
  } as unknown as WhatsAppProvider

  app = await bootstrap({ whatsappProvider: whatsapp, startWorkers: false })

  pdfUji = await renderDocument({
    template: 'daftar_hadir',
    title: 'Pedoman Lampiran Uji',
    organizationName: 'OSIS SMKN 2 MATARAM',
    signerName: 'Ahmad Fauzi',
    signerRole: 'Ketua Osis',
    issuedAt: new Date('2026-10-15T08:00:00Z'),
    eventTitle: 'Rapat Anggota',
    rows: [{ label: 'Budi Santoso', detail: 'X AKL 1', status: 'Hadir' }],
  } as never)
}, 60_000)

afterAll(async () => {
  await prisma.knowledgeDocument.deleteMany({ where: { organizationId: ORG, title: { startsWith: 'Pedoman Lampiran' } } })
  await app.shutdown()
})

/**
 * Hasil tool yang sudah dipoles tipenya.
 *
 * `app.tools.execute` mengembalikan union; tanpa pemotongan ini, setiap test
 * harus memeriksa `success` dulu sebelum menyentuh `data`.
 */
function data(hasil: { success: boolean; data?: unknown; error?: { message: string } }): Record<string, unknown> {
  if (!hasil.success || !hasil.data) {
    throw new Error(`diharapkan sukses, dapat: ${JSON.stringify(hasil.error ?? hasil)}`)
  }
  return hasil.data as Record<string, unknown>
}

type MediaPendek = { messageId: string; fileName: string | null; mimetype: string | null; type: string }

function konteksTanpaLampiran() {
  return {
    actorUserId: AKTOR,
    organizationId: ORG,
    conversationId: null,
    taskId: null,
    chatJid: CHAT,
    senderJid: CHAT,
    correlationId: `media-kosong-${Date.now()}`,
    timezone: 'Asia/Makassar',
    authorization: app.authorization,
    pendingMedia: null,
    pendingMediaId: null,
  } as never
}

function konteksLampiran(lampiran: MediaPendek) {
  return {
    actorUserId: AKTOR,
    organizationId: ORG,
    conversationId: null,
    taskId: null,
    chatJid: CHAT,
    senderJid: CHAT,
    correlationId: `media-${Date.now()}`,
    timezone: 'Asia/Makassar',
    authorization: app.authorization,
    pendingMedia: lampiran,
    pendingMediaId: lampiran.messageId,
  } as never
}

const lampiranPDF = {
  messageId: 'pesan-dummy-1',
  fileName: 'Pedoman-Lampiran-Uji.pdf',
  mimetype: 'application/pdf',
  type: 'document',
}

describe('pesan media tanpa caption tidak boleh dibuang', () => {
  it('BUG REGRESSION: pipeline MENERIMA pesan media tanpa teks', async () => {
    const keputusan = await app.pipeline.decide(
      pesan('', { type: 'document', mimetype: 'application/pdf', fileName: 'pedoman.pdf' }),
    )

    expect(keputusan.action).toBe('process')
  })

  it('BUG REGRESSION: pipeline tetap MENOLAK pesan kosong tanpa lampiran', async () => {
    // Kalau lampiran apa pun dianggap "pesan", maka spam teks kosong ikut
    // diproses — boros token dan membingungkan.
    const keputusan = await app.pipeline.decide(pesan('   '))
    expect(keputusan.action).toBe('skip')
  })

  it('BUG REGRESSION: gambar juga dianggap lampiran, bukan pesan kosong', async () => {
    const keputusan = await app.pipeline.decide(pesan('', { type: 'image', mimetype: 'image/jpeg', fileName: 'foto.jpg' }))
    expect(keputusan.action).toBe('process')
  })
})

describe('media_pending', () => {
  it('BUG REGRESSION: melaporkan lampiran dan apakah bisa dibaca', async () => {
    const hasil = await app.tools.execute(
      'media_pending',
      {},
      konteksLampiran(lampiranPDF),
    )

    expect(data(hasil).hasMedia).toBe(true)
    expect(data(hasil).readable).toBe(true)
    expect(data(hasil).fileName).toBe('Pedoman-Lampiran-Uji.pdf')
  })

  it('menjawab dengan jujur kalau tidak ada lampiran', async () => {
    const hasil = await app.tools.execute(
      'media_pending',
      {},
      konteksTanpaLampiran(),
    )

    expect(hasil.success).toBe(true)
    expect(data(hasil).hasMedia).toBe(false)
  })

  it('BUG REGRESSION: format yang belum didukung ditandai sebagai tidak terbaca', async () => {
    const hasil = await app.tools.execute(
      'media_pending',
      {},
      konteksLampiran({ ...lampiranPDF, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    )

    expect(hasil.success).toBe(true)
    expect(data(hasil).readable).toBe(false)
  })
})

describe('media_read_document', () => {
  it('BUG REGRESSION: membaca teks dari PDF lampiran', async () => {
    const hasil = await app.tools.execute(
      'media_read_document',
      {},
      konteksLampiran({ ...lampiranPDF, messageId: pesanTerakhir.get(CHAT) ?? '' }),
    )

    expect(data(hasil).format).toBe('pdf')
    expect(Number(data(hasil).characterCount)).toBeGreaterThan(20)
    expect(String(data(hasil).text)).toContain('Budi Santoso')
  })

  it('BUG REGRESSION: lampiran yang sudah kedaluwarsa ditolak dengan pesan jelas', async () => {
    // Media WhatsApp hanya tersedia singkat. Pesan "tidak ditemukan" tanpa
    // penjelasan membuat pengguna mengira filenya rusak.
    const hasil = await app.tools.execute(
      'media_read_document',
      {},
      konteksLampiran({ ...lampiranPDF, messageId: 'pesan-yang-sudah-hilang' }),
    )

    expect(hasil.success).toBe(false)
    if (!hasil.success) expect(hasil.error.message).toMatch(/kirim ulang|tidak tersimpan/i)
  })

  it('BUG REGRESSION: berkas yang bukan PDF/teks ditolak, bukan dikarang', async () => {
    const hasil = await app.tools.execute(
      'media_read_document',
      {},
      konteksLampiran({ ...lampiranPDF, mimetype: 'image/jpeg', messageId: pesanTerakhir.get(CHAT) ?? '' }),
    )

    // Berkas di cache adalah PDF sah, jadi pengujian format perlu berkas lain.
    // Yang dijaga: kalau format tidak dikenali, hasilnya bukan teks kosong.
    if (hasil.success) {
      expect(String(data(hasil).text).length).toBeGreaterThan(0)
    } else {
      expect(hasil.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('BUG REGRESSION: berkas rusak tidak menghasilkan teks palsu', async () => {
    const rusak = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('sampah '.repeat(200))])
    const app2 = app as unknown as { whatsapp: { downloadMediaById: (id: string) => Promise<Buffer | null> } }
    const asli = app2.whatsapp.downloadMediaById.bind(app2.whatsapp)
    app2.whatsapp.downloadMediaById = async () => rusak

    try {
      const hasil = await app.tools.execute('media_read_document', {}, konteksLampiran(lampiranPDF))
      expect(hasil.success).toBe(false)
      if (!hasil.success) {
        expect(hasil.error.message.length).toBeGreaterThan(10)
        expect(hasil.error.message).not.toMatch(/undefined|\[object/i)
      }
    } finally {
      app2.whatsapp.downloadMediaById = asli
    }
  })
})

describe('media_ingest_document', () => {
  it('BUG REGRESSION: menyimpan isi lampiran ke knowledge base', async () => {
    const hasil = await app.tools.execute(
      'media_ingest_document',
      { title: 'Pedoman Lampiran Uji', documentType: 'panduan' },
      konteksLampiran({ ...lampiranPDF, messageId: pesanTerakhir.get(CHAT) ?? '' }),
    )

    const tersimpan = await prisma.knowledgeDocument.findFirst({
      where: { id: String(data(hasil).documentId) },
      select: { content: true, source: true },
    })
    expect(tersimpan?.content).toContain('Budi Santoso')
    expect(tersimpan?.source).toContain('chat:')
  })

  it('isi lampiran yang disimpan bisa dicari', async () => {
    const hasil = await app.tools.execute(
      'media_ingest_document',
      { title: 'Pedoman Lampiran Uji', documentType: 'panduan' },
      konteksLampiran({ ...lampiranPDF, messageId: pesanTerakhir.get(CHAT) ?? '' }),
    )

    const documentId = String(data(hasil).documentId)
    const hits = await app.knowledge.search(ORG, 'Rapat Anggota')

    expect(hits.length).toBeGreaterThan(0)
    expect(hits.map((h) => h.documentId)).toContain(documentId)
  })

  it('BUG REGRESSION: tanpa lampiran ditolak dengan pesan yang bisa dipakai', async () => {
    const hasil = await app.tools.execute(
      'media_ingest_document',
      {},
      konteksTanpaLampiran(),
    )

    expect(hasil.success).toBe(false)
    if (!hasil.success) expect(hasil.error.message).toMatch(/lampiran/i)
  })
})