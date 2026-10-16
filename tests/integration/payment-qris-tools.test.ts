/**
 * Uji integrasi tool pembayaran — QRIS.
 *
 * Ketiga test di sini berasal dari **pemakaian nyata**, bukan dari review kode:
 * pengguna membuat QRIS Rp 100 lewat WhatsApp, lalu bertanya "mana linknya" dan
 * "kasi gambarnya". Bot menjawab jujur bahwa tautannya tidak tersedia — dan itu
 * benar, karena memang tidak ada yang mengembalikannya.
 *
 * Yang membuat bug ini bertahan: bot **tidak berbohong**. Ia melaporkan tepat
 * apa yang tool berikan. Yang tidak lengkap adalah tool-nya, jadi tidak ada
 * pesan error, tidak ada log, dan tidak ada yang gagal.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { buildPaymentTools } from '../../src/tools/payment-tools.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { BaturPayAdapter } from '../../src/payments/baturpay.js'
import { AuthorizationService } from '../../src/security/authorization.js'
import { logger } from '../../src/observability/logger.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'
const CHAT = '6280000000000@s.whatsapp.net'

const ORDER_ID_UJI = `UJI-QRIS-${Date.now()}`

const ADAPTER = new BaturPayAdapter({
  prisma,
  baseUrl: 'https://baturpay.test',
  apiKey: 'bp_live_uji',
  // Bentuk respons BaturPay adalah amplop `{ ok, data }` — `request()` membaca
  // `payload.data`. Mock polos akan menghasilkan `data: null` dan tool
  // melaporkan transaksi "tidak ditemukan", yang.bohong.
  // Order yang tidak dikenal dibalas 404, seperti penyedia sungguhan. Mock yang
  // selalu mengembalikan data sama akan membuat test "tidak mengarang tautan"
  // lulus hampa.
  fetchImpl: async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes(encodeURIComponent(ORDER_ID_UJI))) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(
      JSON.stringify({
        ok: true,
        data: { order_id: ORDER_ID_UJI, amount: 25_000, status: 'pending', settled_at: null },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  },
})

/** Gambar yang "terkirim" selama test. */
let terkirim: Array<{ chatJid: string; url: string; caption?: string }> = []

const whatsappTiruan = {
  sendImage: async (chatJid: string, image: { url: string; caption?: string }) => {
    terkirim.push({ chatJid, url: image.url, ...(image.caption ? { caption: image.caption } : {}) })
    return { status: 'sent', providerMessageId: 'uji' }
  },
}

const authorization = new AuthorizationService({ prisma, logger: logger.child({ module: 'uji' }) })

let registry: ToolRegistry
let orderIdUji = ''
let invoiceIdUji = ''

beforeAll(async () => {
  const tools = buildPaymentTools({
    payments: ADAPTER,
    identity: { resolveMemberByName: async () => ({ certainty: 'none' }) } as never,
    whatsapp: whatsappTiruan as never,
  })

  registry = new ToolRegistry({ prisma: prisma as never })
  for (const tool of tools) registry.register(tool as never)

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: ORG,
      number: `UJI-QRIS/${Date.now()}`,
      title: 'Uji QRIS Tool',
      totalAmount: 25_000,
      items: { create: [{ description: 'Uji', quantity: 1, unitAmount: 25_000, amount: 25_000 }] },
    },
    select: { id: true },
  })
  invoiceIdUji = invoice.id

  orderIdUji = ORDER_ID_UJI
  await ADAPTER.recordPayment({
    organizationId: ORG,
    invoiceId: invoiceIdUji,
    amount: 25_000,
    orderId: orderIdUji,
    qrisUrl: ADAPTER.qrUrl(orderIdUji),
    idempotencyKey: `uji-tool-${orderIdUji}`,
  })
})

afterAll(async () => {
  await prisma.idempotencyKey.deleteMany({ where: { key: { contains: 'uji-tool-' } } })
  await prisma.payment.deleteMany({ where: { providerReference: orderIdUji } })
  await prisma.invoice.deleteMany({ where: { id: invoiceIdUji } })
  await prisma.$disconnect()
})

const konteks = {
  actorUserId: AKTOR,
  organizationId: ORG,
  conversationId: null,
  taskId: null,
  chatJid: CHAT,
  senderJid: CHAT,
  correlationId: 'uji-qris',
  timezone: 'Asia/Makassar',
  // Aktor sungguhan dengan izin sungguhan lewat `AuthorizationService` asli.
  //
  // Tiruan tidak bisa: `registry.execute` memanggil `check` (untuk resource
  // scope) selain `checkMany`, dan tiruan yang hanya punya satu metode akan
  // gagal di tengah — bukan karena kodenya salah, karena testnya.
  //
  // Karena itu test ini memakai bootstrap penuh, seperti `approval-flow.test.ts`.
  authorization,
}

describe('tautan QRIS yang bisa dibaca pengguna', () => {
  it('BUG REGRESSION: payment_check_status MENGEMBALIKAN tautan QRIS', async () => {
    // Tanpa ini, pengguna bertanya "mana linknya" dan bot menjawab jujur
    // bahwa tautannya tidak ada — padahal ada di `Payment.metadata`.
    const hasil = await registry.execute('payment_check_status', { orderId: orderIdUji }, konteks)

    expect(hasil.success).toBe(true)
    if (!hasil.success) return

    const data = hasil.data as { qrisUrl?: string; qrTersedia?: boolean; orderId: string }
    expect(data.orderId).toBe(orderIdUji)
    expect(data.qrisUrl, 'payment_check_status tidak mengembalikan tautan QRIS').toBeTruthy()
    expect(data.qrisUrl).toContain(encodeURIComponent(orderIdUji))
    expect(data.qrTersedia).toBe(true)
  })

  it('BUG REGRESSION: payment_list MENGEMBALIKAN tautan QRIS per baris', async () => {
    // "Transaksi yang mana?" harus bisa dijawab lengkap. Kalau hanya status,
    // pengguna harus bertanya satu per satu untuk setiap tagihan.
    const hasil = await registry.execute('payment_list', { status: 'PENDING' }, konteks)

    expect(hasil.success).toBe(true)
    if (!hasil.success) return

    const data = hasil.data as { payments: Array<{ orderId: string; qrisUrl?: string }> }
    const milikUji = data.payments.find((p) => p.orderId === orderIdUji)

    expect(milikUji, 'transaksi uji tidak muncul di payment_list').toBeTruthy()
    expect(milikUji!.qrisUrl, 'payment_list tidak mengembalikan tautan QRIS').toBeTruthy()
  })

  it('payment_check_status untuk order yang tidak ada TIDAK mengarang tautan', async () => {
    // Mengembalikan URL turunan untuk order yang tidak ada menghasilkan tautan
    // yang berakhir di 404 — lebih buruk daripada tidak menjawab.
    const hasil = await registry.execute(
      'payment_check_status',
      { orderId: 'ORD-TIDAK-ADA-SAMA-SEKALI' },
      konteks,
    )

    expect(hasil.success).toBe(false)
  })
})

describe('mengirim gambar QRIS', () => {
  it('BUG REGRESSION: ada tool yang bisa mengirim GAMBAR QRIS', async () => {
    // `WhatsAppProvider.sendImage` sudah ada sejak awal dan tidak pernah dipakai
    // tool mana pun. Jadi "kasi gambarnya" tidak bisa dipenuhi — bukan karena
    // datanya tidak ada, tapi karena tidak ada jalan untuk mengirimnya.
    expect(registry.get('payment_send_qris')).toBeTruthy()

    terkirim = []
    const hasil = await registry.execute('payment_send_qris', { orderId: orderIdUji }, konteks)

    expect(hasil.success, 'payment_send_qris gagal').toBe(true)
    expect(terkirim).toHaveLength(1)
    expect(terkirim[0]!.chatJid).toBe(CHAT)
    expect(terkirim[0]!.url).toContain(encodeURIComponent(orderIdUji))
  })

  it('BUG REGRESSION: gambar dikirim ke percakapan ASAL, tidak ke nomor dari argumen', async () => {
    // QRIS menautkan orang ke tagihan tertentu. Meneruskannya ke nomor yang
    // salah berarti orang yang salah bisa membayar tagihan yang bukan miliknya.
    //
    // Skema inputnya `strict()` tanpa parameter `to`, jadi tidak ada cara
    // memintanya — dan permintaan yang tetap menyertakan `to` harus ditolak.
    terkirim = []
    const hasil = await registry.execute(
      'payment_send_qris',
      { orderId: orderIdUji, to: '628999999999@s.whatsapp.net' } as never,
      konteks,
    )

    // `to` di luar skema harus ditolak, bukan diabaikan diam-diam.
    expect(hasil.success).toBe(false)
    expect(terkirim).toHaveLength(0)
  })

  it('BUG REGRESSION: order yang tidak ada DITOLAK, tidak membuat transaksi baru', async () => {
    // Kalau tool membuat order baru diam-diam, hasilnya dua permintaan transfer
    // untuk satu tagihan — dan pengguna tidak tahu mana yang benar.
    terkirim = []
    const hasil = await registry.execute(
      'payment_send_qris',
      { orderId: 'ORD-TIDAK-ADA-SAMA-SEKALI' },
      konteks,
    )

    expect(hasil.success).toBe(false)
    expect(terkirim).toHaveLength(0)
  })

  it('mengirim gambar TIDAK mengubah status pembayaran', async () => {
    const sebelum = await prisma.payment.findFirst({
      where: { providerReference: orderIdUji },
      select: { status: true },
    })

    terkirim = []
    await registry.execute('payment_send_qris', { orderId: orderIdUji }, konteks)

    const sesudah = await prisma.payment.findFirst({
      where: { providerReference: orderIdUji },
      select: { status: true },
    })

    // Status hanya berubah lewat webhook penyedia. Mengirim gambar bukan bukti
    // pembayaran — kalau ini mengubah status, bot akan bisa bilang "sudah bayar"
    // tanpa satu rupiah pun masuk.
    expect(sesudah!.status).toBe(sebelum!.status)
    expect(sesudah!.status).toBe('PENDING')
  })
})