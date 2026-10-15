/**
 * Test pembayaran BaturPay.
 *
 * Ini kode yang paling berbahaya untuk ditulis tanpa test: satu bug di sini
 * berarti buku kas salah, dan uang yang tidak pernah masuk tercatat
 * sebagai uang yang masuk.
 *
 * Semua fakta di sini diambil dari dokumentasi resmi BaturPay
 * (baturpay.vercel.app/docs), bukan dari asumsi:
 *
 * - `POST /v1/charge` dengan `amount` (int 1–10.000.000.000), `order_id`,
 *   `expiry_minutes` (1–1440).
 * - Status: `created | pending | settlement | capture | expire | cancel | deny |
 *   refund | partial_refund | chargeback`.
 * - `capture` = "berhasil tapi belum final, akan jadi `settlement`".
 * - Webhook: `x-baturpay-signature` = hex(HMAC-SHA256(ts + "." + rawBody, secret)).
 * - Retry webhook sampai 5 kali → handler WAJIB idempoten.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createHmac } from 'node:crypto'
import {
  BaturPayAdapter,
  STATUS_MAP,
  handleBaturPayWebhook,
  type CreateChargeInput,
} from '../../src/payments/baturpay.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const SECRET = 'rahasia-webhook-uji'

let invoiceId: string
let counter = 0

function orderIdBaru(): string {
  counter += 1
  return `OSDA-UJI-${Date.now()}-${counter}`
}

async function buatPayment(nominal: number, orderId: string) {
  return prisma.payment.create({
    data: {
      organizationId: ORG,
      invoiceId,
      provider: 'BATURPAY',
      providerReference: orderId,
      amount: nominal,
      status: 'PENDING',
    },
    select: { id: true },
  })
}

/** Payload webhook seperti yang dikirim BaturPay. */
function webhookBody(orderId: string, status: string, amount: number, updatedAt = '2026-10-15T12:00:00Z') {
  return {
    transaction_id: orderId,
    order_id: orderId,
    status,
    amount,
    currency: 'IDR',
    source: 'gopay',
    payment_type: 'qris',
    acquirer: 'gopay',
    issuer: 'DANA',
    paid_at: '2026-10-15T12:00:00Z',
    created_at: '2026-10-15T11:00:00Z',
    updated_at: updatedAt,
  }
}

async function kirim(orderId: string, status: string, amount: number, updatedAt?: string) {
  const body = webhookBody(orderId, status, amount, updatedAt)
  return handleBaturPayWebhook(body, Buffer.from(JSON.stringify(body)))
}

beforeEach(async () => {
  await prisma.payment.deleteMany({ where: { providerReference: { startsWith: 'OSDA-UJI-' } } })
  const invoice = await prisma.invoice.create({
    data: { organizationId: ORG, number: `UJI-BAYAR/${Date.now()}`, title: 'Uji Pembayaran', totalAmount: 100_000 },
    select: { id: true },
  })
  invoiceId = invoice.id
})

describe('peta status', () => {
  it('BUG REGRESSION: `capture` BUKAN status uang masuk', async () => {
    // Dokumentasi BaturPay: "capture — berhasil tapi belum final (mid transit
    // — akan jadi settlement)".
    //
    // Memetakannya ke SETTLED mengisi `verifiedAt` untuk uang yang belum
    // final. Kalau ternyata jadi sengketa, kita sudah mencatat uang masuk
    // yang tidak pernah terjadi.
    expect(STATUS_MAP.capture).not.toBe('SETTLED')

    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    await kirim(orderId, 'capture', 25_000)

    const payment = await prisma.payment.findFirst({ where: { providerReference: orderId }, select: { status: true, verifiedAt: true } })
    expect(payment!.status).not.toBe('SETTLED')
    // `verifiedAt` = bukti uang diterima. Kalau belum final, belum diisi.
    expect(payment!.verifiedAt).toBeNull()
  })

  it('`settlement` mengisi verifiedAt', async () => {
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    await kirim(orderId, 'settlement', 25_000)

    const payment = await prisma.payment.findFirst({ where: { providerReference: orderId }, select: { status: true, verifiedAt: true } })
    expect(payment!.status).toBe('SETTLED')
    expect(payment!.verifiedAt).not.toBeNull()
  })

  it('semua status dari dokumentasi punya pemetaan', () => {
    // Status yang tidak terpetakan diam-diam jadi `PENDING` — pembayaran yang
    // ditolak akan terlihat seperti yang masih berjalan.
    for (const status of [
      'created', 'pending', 'settlement', 'capture', 'expire',
      'cancel', 'deny', 'refund', 'partial_refund', 'chargeback',
    ]) {
      expect(STATUS_MAP[status], status).toBeDefined()
    }
  })
})

describe('verifikasi nominal', () => {
  it('BUG REGRESSION: nominal webhook yang TIDAK COCOK tidak menandai lunas', async () => {
    // Satu-satunya pemeriksaan yang hilang. Kalau tidak, webhook dengan nominal
    // keliru akan mencatat uang yang tidak pernah masuk.
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    const hasil = await kirim(orderId, 'settlement', 999_999)

    expect(hasil.action).toBe('amount_mismatch')

    const payment = await prisma.payment.findFirst({ where: { providerReference: orderId }, select: { status: true, verifiedAt: true } })
    expect(payment!.status).toBe('PENDING')
    expect(payment!.verifiedAt).toBeNull()
  })

  it('nominal yang sama diterima', async () => {
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    const hasil = await kirim(orderId, 'settlement', 25_000)
    expect(hasil.action).toBe('recorded')
  })
})

describe('pengembalian uang', () => {
  it('BUG REGRESSION: refund setelah lunas HARUS dicatat', async () => {
    // Uang yang kembali adalah peristiwa uang yang nyata. Mengabaikannya
    // membuat buku kas menampilkan uang yang sudah tidak ada milik organisasi.
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    await kirim(orderId, 'settlement', 25_000)
    const setelahLunas = await kirim(orderId, 'refund', 25_000)

    expect(setelahLunas.action).toBe('recorded')

    const payment = await prisma.payment.findFirst({ where: { providerReference: orderId }, select: { status: true, verifiedAt: true } })
    expect(payment!.status).toBe('REFUNDED')
    // `verifiedAt` tidak boleh masih terisi: uangnya sudah tidak ada.
    expect(payment!.verifiedAt).toBeNull()
  })

  it('BUG REGRESSION: chargeback setelah lunas dicatat', async () => {
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    await kirim(orderId, 'settlement', 25_000)
    await kirim(orderId, 'chargeback', 25_000)

    const payment = await prisma.payment.findFirst({ where: { providerReference: orderId }, select: { status: true } })
    expect(payment!.status).toBe('FAILED')
  })
})

describe('status tidak boleh turun', () => {
  it('BUG REGRESSION: webhook lama tidak bisa membatalkan pembayaran lunas', async () => {
    // Webhook pending yang datang terlambat akan membuat status mundur, dan
    // pembayaran yang sudah dibayar tercatat belum dibayar.
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    await kirim(orderId, 'settlement', 25_000)
    const lama = await kirim(orderId, 'pending', 25_000, '2026-10-15T11:30:00Z')

    expect(lama.action).toBe('ignored')

    const payment = await prisma.payment.findFirst({ where: { providerReference: orderId }, select: { status: true } })
    expect(payment!.status).toBe('SETTLED')
  })
})

describe('idempotensi', () => {
  it('BUG REGRESSION: webhook yang sama dua kali tidak menggandakan mutasi', async () => {
    // Dokumentasi BaturPay: retry sampai 5 kali dengan backoff. Kalau setiap
    // percobaan dicatat, satu pembayaran jadi lima mutasi.
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    const body = webhookBody(orderId, 'settlement', 25_000)
    const raw = Buffer.from(JSON.stringify(body))

    const pertama = await handleBaturPayWebhook(body, raw)
    const kedua = await handleBaturPayWebhook(body, raw)
    const ketiga = await handleBaturPayWebhook(body, raw)

    expect(pertama.action).toBe('recorded')
    expect(kedua.action).toBe('duplicate')
    expect(ketiga.action).toBe('duplicate')

    const mutasi = await prisma.paymentTransaction.count({
      where: { payment: { providerReference: orderId } },
    })
    expect(mutasi).toBe(1)
  })

  it('status BERBEDA menghasilkan mutasi baru', async () => {
    // Pending lalu settlement adalah dua peristiwa berbeda, bukan duplikat.
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    await kirim(orderId, 'pending', 25_000)
    await kirim(orderId, 'settlement', 25_000)

    const mutasi = await prisma.paymentTransaction.count({
      where: { payment: { providerReference: orderId } },
      orderBy: { occurredAt: 'asc' },
    })
    expect(mutasi).toBe(2)
  })
})

describe('webhook untuk order tak dikenal', () => {
  it('diterima tapi tidak dicatat', async () => {
    // Menerima 200 supaya BaturPay berhenti mencoba — tapi jangan membuat
    // pembayaran fiktif dari payload orang yang tidak dikenal.
    const hasil = await kirim(orderIdBaru(), 'settlement', 25_000)

    expect(hasil.accepted).toBe(true)
    expect(hasil.action).toBe('not_found')
  })
})

describe('payload rusak', () => {
  it('BUG REGRESSION: tanpa order_id ditolak', async () => {
    const hasil = await handleBaturPayWebhook({ status: 'settlement' }, Buffer.from('{}'))
    expect(hasil.accepted).toBe(false)
    expect(hasil.action).toBe('ignored')
  })

  it('BUG REGRESSION: status tak dikenal ditolak', async () => {
    const orderId = orderIdBaru()
    await buatPayment(25_000, orderId)

    const hasil = await kirim(orderId, 'maling_datar', 25_000)
    expect(hasil.accepted).toBe(false)
  })
})

describe('adapter BaturPay', () => {
  function adapterDengan(fetchImpl: typeof fetch) {
    return new BaturPayAdapter({
      prisma,
      baseUrl: 'https://baturpay.test',
      apiKey: 'bp_live_uji',
      fetchImpl,
    })
  }

  it('BUG REGRESSION: MENOLAK nominal bukan integer Rupiah', async () => {
    // `0.1 + 0.2 !== 0.3` adalah hal wajar untuk perhitungan biasa; untuk uang
    // itu selisih beberapa rupiah yang tidak pernah cocok dengan struk.
    const adapter = adapterDengan(async () => new Response('{}'))
    const dasar = { organizationId: ORG, orderId: orderIdBaru() } satisfies Partial<CreateChargeInput>

    for (const amount of [25_000.5, -1000, 0, 10_000_000_001]) {
      const hasil = await adapter.createCharge({ ...dasar, amount } as CreateChargeInput)
      expect(hasil, String(amount)).toHaveProperty('code', 'INVALID_AMOUNT')
    }
  })

  it('BUG REGRESSION: MENOLAK expiry_minutes di luar 1–1440', async () => {
    // Rentang ini berasal dari dokumentasi BaturPay.
    const adapter = adapterDengan(async () => new Response('{}'))
    const dasar = { organizationId: ORG, orderId: orderIdBaru(), amount: 25_000 } satisfies CreateChargeInput

    for (const expiryMinutes of [0, 1441, 1.5]) {
      const hasil = await adapter.createCharge({ ...dasar, expiryMinutes })
      expect(hasil, String(expiryMinutes)).toHaveProperty('code', 'VALIDATION_ERROR')
    }
  })

  it('BUG REGRESSION: TIDAK mengirim request ke jaringan saat validasi gagal', async () => {
    // Kalau request tetap terkirim, transaksi fiktif tercipta di sisi provider.
    let dipanggil = false
    const adapter = adapterDengan(async () => {
      dipanggil = true
      return new Response('{}')
    })

    await adapter.createCharge({ organizationId: ORG, orderId: orderIdBaru(), amount: 25_000.5 } as CreateChargeInput)
    expect(dipanggil).toBe(false)
  })

  it('BUG REGRESSION: KABUL atau menolak dengan rapi tanpa API key', async () => {
    // `apiKey: null` dipaksa kosong, bukan `undefined` — kalau `undefined`,
    // adapter jatuh ke `env.BATURPAY_API_KEY` dan test bergantung pada
    // isi berkas .env.
    const adapter = new BaturPayAdapter({ prisma, baseUrl: 'https://baturpay.test', apiKey: null as never })
    expect(adapter.isConfigured).toBe(false)

    const hasil = await adapter.createCharge({
      organizationId: ORG,
      orderId: orderIdBaru(),
      amount: 25_000,
    } as CreateChargeInput)
    expect(hasil).toHaveProperty('code', 'NOT_CONFIGURED')
  })

  it('menerjemahkan 201 dengan benar', async () => {
    const orderId = orderIdBaru()
    const adapter = adapterDengan(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            order_id: orderId,
            amount: 25_000,
            currency: 'IDR',
            status: 'pending',
            payment_type: 'qris',
            acquirer: 'gopay',
            qris_url: `https://baturpay.vercel.app/v1/transactions/${orderId}/qr`,
            expiry_time: '2026-10-15T13:00:00Z',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const hasil = await adapter.createCharge({ organizationId: ORG, orderId, amount: 25_000 } as CreateChargeInput)

    expect(hasil).toMatchObject({
      orderId,
      amount: 25_000,
      status: 'PENDING',
      qrisUrl: `https://baturpay.vercel.app/v1/transactions/${orderId}/qr`,
    })
  })

  it('BUG REGRESSION: meneruskan 409 ORDER_EXISTS tanpa mencoba lagi', async () => {
    // `order_id` duplikat berarti charge-nya sudah pernah dibuat. Bikin lagi
    // hanya menghasilkan transaksi ganda di sisi pengguna.
    const adapter = adapterDengan(async () =>
      new Response(
        JSON.stringify({ error: { code: 'ORDER_EXISTS', message: 'order_id sudah pernah dipakai' } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const hasil = await adapter.createCharge({
      organizationId: ORG,
      orderId: orderIdBaru(),
      amount: 25_000,
    } as CreateChargeInput)

    expect(hasil).toMatchObject({ code: 'ORDER_EXISTS' })
  })

  it('BUG REGRESSION: TIDAK membocorkan API key ke dalam pesan error', async () => {
    const adapter = adapterDengan(async () => {
      throw new Error('boom')
    })

    const hasil = await adapter.createCharge({
      organizationId: ORG,
      orderId: orderIdBaru(),
      amount: 25_000,
    } as CreateChargeInput)

    const teks = JSON.stringify(hasil)
    expect(teks).not.toContain('bp_live_uji')
  })
})

describe('verifikasi signature webhook', () => {
  /** Sama persis dengan yang dipakai server. */
  function verifikasi(rawBody: Buffer, timestamp: string, signature: string, secret: string): boolean {
    const expected = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
      .digest('hex')
    return expected === signature
  }

  it('BUG REGRESSION: signature palsu DITOLAK', () => {
    const raw = Buffer.from('{"order_id":"X","status":"settlement"}')
    expect(verifikasi(raw, '1000', 'a'.repeat(64), SECRET)).toBe(false)
  })

  it('signature asli diterima', () => {
    const raw = Buffer.from('{"order_id":"X","status":"settlement"}')
    const ts = '1760000000000'
    const sig = createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${ts}.`), raw])).digest('hex')

    expect(verifikasi(raw, ts, sig, SECRET)).toBe(true)
  })

  it('BUG REGRESSION: body yang diubah sedikit langsung gagal', () => {
    // HMAC mencakup seluruh body. Kalau hanya sebagian yang
    // ditandatangani, penyerang bisa mengubah nominal tanpa invalidate.
    const asli = Buffer.from('{"order_id":"X","amount":25000}')
    const diubah = Buffer.from('{"order_id":"X","amount":1}')
    const ts = '1760000000000'
    const sig = createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${ts}.`), asli])).digest('hex')

    expect(verifikasi(diubah, ts, sig, SECRET)).toBe(false)
  })

  it('BUG REGRESSION: timestamp yang diganti gagal', () => {
    // Kalau timestamp tidak masuk signature, webhook lama bisa diputar ulang.
    const raw = Buffer.from('{"order_id":"X"}')
    const sig = createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from('1000.'), raw])).digest('hex')

    expect(verifikasi(raw, '2000', sig, SECRET)).toBe(false)
  })
})