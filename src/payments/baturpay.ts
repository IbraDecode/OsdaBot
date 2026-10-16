/**
 * Adapter pembayaran BaturPay.
 *
 * ── PENTING: sumber kebenaran ini adalah dokumentasi resmi BaturPay ──────────
 * Base URL : https://baturpay.vercel.app
 * Auth     : `Authorization: Bearer bp_live_...`
 * Create   : POST /v1/charge  { amount, order_id?, webhook_url?, description?,
 *                              customer_name?, customer_email?, ref_id?, expiry_minutes? }
 * Status   : GET  /v1/transactions/:order_id
 * QR       : GET  /v1/transactions/:order_id/qr  (publik, tanpa auth)
 * Events   : GET  /v1/transactions/:order_id/events
 *
 * Status transaksi: created | pending | settlement | capture | expire |
 *                    cancel | deny | refund | partial_refund | chargeback
 *
 * Webhook masuk : header `x-baturpay-signature` = hex(HMAC-SHA256(ts + "." + rawBody, secret))
 *                 header `x-baturpay-timestamp` = epoch ms
 *                 header `x-baturpay-attempt` = nomor percobaan
 *
 * Aturan yang TIDAK BOLEH dilanggar:
 *  1. `amount` adalah INTEGER RUPIAH. Tidak ada sen. Tidak boleh float.
 *  2. Status hanya berubah dari data provider. Klaim chat bukan bukti.
 *  3. Webhook duplikat tidak boleh membuat transaksi ganda.
 *  4. API key dan webhook secret TIDAK BOLEH masuk log.
 *  5. `order_id` dipakai sebagai idempotensi — duplikat ditolak 409 ORDER_EXISTS.
 */
import { createHash } from 'node:crypto'
import type { PaymentStatus, PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'baturpay' })

/** Percobaan lain sedang memproses operasi yang sama. */
export class PaymentBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentBusyError'
  }
}

/**
 * Kunci idempotensi, dibatasi per organisasi.
 *
 * `IdempotencyKey.key` adalah primary key GLOBAL. Tanpa awalan organisasi, dua
 * organisasi yang menghasilkan kunci sama akan saling menabrak — dan salah
 * satunya gagal dengan pesan yang tidak ada hubungannya dengan masalah
 * sebenarnya.
 */
function kunciIdempotensi(organizationId: string, operasi: string, kunci: string): string {
  return `${organizationId}:${operasi}:${kunci}`
}

/**
 * Batas umur kunci `IN_PROGRESS`: 5 menit.
 *
 * Kunci ditulis sebelum operasi selesai. Kalau proses mati di tengah jalan,
 * kunci itu tertinggal `IN_PROGRESS` **selamanya** dan operasi yang sama tidak
 * akan pernah bisa diulang lagi — tagihannya menggantung tanpa jalan keluar.
 *
 * Operasinya sendiri (buat charge di penyedia) selesai dalam hitungan detik.
 * Lima menit jauh melampaui itu, jadi kunci yang lebih tua hampir pasti
 * ditinggalkan proses yang mati, bukan masih berjalan.
 */
const UMUR_MAKS_KUNCI_MS = 5 * 60 * 1000

function sudahBasi(dibuatPada: Date): boolean {
  return Date.now() - dibuatPada.getTime() > UMUR_MAKS_KUNCI_MS
}

/** Kode error Prisma, atau null. */
function kodePrisma(error: unknown): string | null {
  const kode = (error as { code?: unknown } | null)?.code
  return typeof kode === 'string' ? kode : null
}

/**
 * Status BaturPay → status internal OSDABOT.
 *
 * ── Kenapa `capture` TIDAK dipetakan ke `SETTLED` ─────────────────────────
 *
 * Dokumentasi BaturPay:
 *
 * > `capture` — Berhasil tapi belum final (mid transit — akan jadi `settlement`)
 *
 * Memetakan `capture` ke `SETTLED` berarti `verifiedAt` terisi pada uang yang
 * **belum final**. Kalau ternyata jadi sengketa, kita sudah mencatat uang masuk
 * yang tidak pernah masuk.
 *
 * Melebihi-native (menunggu `settlement`) lebih aman daripada lebih-native:
 * kurang mencatat bisa diperbaiki manual, lebih mencatat berarti buku kas
 * salah dan kas fisik tidak cocok dengannya.
 *
 * `capture` dipetakan ke `PENDING` — statusnya sudah berubah, tapi uangnya
 * belum dinyatakan masuk.
 */
export const STATUS_MAP: Record<string, PaymentStatus> = {
  created: 'PENDING',
  pending: 'PENDING',
  settlement: 'SETTLED',
  capture: 'PENDING',
  expire: 'EXPIRED',
  cancel: 'CANCELLED',
  deny: 'FAILED',
  refund: 'REFUNDED',
  partial_refund: 'REFUNDED',
  chargeback: 'FAILED',
}

/**
 * Status yang berarti "uang sudah benar-benar diterima".
 *
 * Hanya `settlement`. `capture` sengaja tidak termasuk — lihat STATUS_MAP.
 */
const STATUS_MASUK: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>(['SETTLED'])

/**
 * Status yang menandakan uang KEMBALI.
 *
 * Penting: status ini harus diterima bahkan setelah pembayaran tercatat
 * `SETTLED`. Uang yang dikembalikan adalah peristiwa uang yang nyata, dan
 * mengabaikannya membuat buku kas menunjukkan uang yang sudah tidak ada.
 */
const STATUS_ANGKUT: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>(['REFUNDED', 'FAILED'])

/** Status yang terminal — setelah ini tidak berubah lagi. */
const TERMINAL_STATUSES = new Set<PaymentStatus>(['SETTLED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'])

export interface CreateChargeInput {
  organizationId: string
  amount: number
  orderId: string
  description?: string
  customerName?: string
  customerEmail?: string
  refId?: string
  expiryMinutes?: number
  webhookUrl?: string
}

export interface CreateChargeResult {
  orderId: string
  amount: number
  status: PaymentStatus
  qrisUrl: string | null
  expiryTime: string | null
}

export interface BaturPayAdapterDeps {
  prisma: PrismaClient
  baseUrl?: string
  /** Kosongkan untuk memakai `env.BATURPAY_API_KEY`. `null` = tanpa key. */
  apiKey?: string | null
  fetchImpl?: typeof fetch
}

export class BaturPayAdapter {
  private readonly baseUrl: string
  private readonly apiKey: string | null
  private readonly prisma: PrismaClient
  private readonly fetchImpl: typeof fetch

  constructor(deps: BaturPayAdapterDeps) {
    this.prisma = deps.prisma
    this.baseUrl = (deps.baseUrl ?? env.BATURPAY_BASE_URL).replace(/\/$/, '')
    // `undefined` berarti "pakai dari env"; `null` berarti "tepatnya tanpa
    // API key". Dengan `??`, `null` ikut jatuh ke env — jadi tidak ada cara
    // mengatakan "jangan pakai key yang ada", dan test bergantung pada isi
    // berkas .env.
    this.apiKey = deps.apiKey !== undefined ? deps.apiKey : (env.BATURPAY_API_KEY ?? null)
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  /** Apakah integrasi live siap dipakai. */
  get isConfigured(): boolean {
    return this.apiKey !== null
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; data: T | null; errorCode: string | null; errorMessage: string | null }> {
    if (!this.apiKey) {
      // Tanpa API key, permintaan apa pun pasti ditolak. Menolak di sini
      // lebih baik daripada mengirim request yang pasti gagal — dan yang
      // mungkin mencatat transaksi di sisi provider.
      return {
        ok: false,
        status: 0,
        data: null,
        errorCode: 'NOT_CONFIGURED',
        errorMessage:
          'Pembayaran otomatis belum dikonfigurasi di server ini (BATURPAY_API_KEY kosong). ' +
          'Catat pembayaran manual lewat finance_record_payment.',
      }
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: T; error?: { code?: string; message?: string } }
        | null

      if (!response.ok) {
        // Endpoint dan kode error dicatat TANPA secret.
        log.warn(
          { path, status: response.status, errorCode: payload?.error?.code },
          'permintaan BaturPay gagal',
        )
        return {
          ok: false,
          status: response.status,
          data: null,
          errorCode: payload?.error?.code ?? `HTTP_${response.status}`,
          errorMessage: payload?.error?.message ?? 'Permintaan ditolak BaturPay.',
        }
      }

      return { ok: true, status: response.status, data: payload?.data ?? null, errorCode: null, errorMessage: null }
    } catch (error) {
      log.error({ err: error, path }, 'gagal menghubungi BaturPay')
      return {
        ok: false,
        status: 0,
        data: null,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'Tidak bisa menghubungi BaturPay.',
      }
    }
  }

  /**
   * Buat QRIS dinamis.
   *
   * `orderId` WAJIB unik — BaturPay menolak duplikat dengan `409 ORDER_EXISTS`.
   * That's exactly the idempotency we want.
   */
  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult | { error: string; code: string }> {
    // Validasi uang: integer Rupiah, wajar.
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      return { error: 'Nominal harus bilangan bulat Rupiah lebih besar dari nol.', code: 'INVALID_AMOUNT' }
    }
    if (input.amount > 10_000_000_000) {
      return { error: 'Nominal melebihi batas maksimum BaturPay (Rp10.000.000.000).', code: 'INVALID_AMOUNT' }
    }
    if (!Number.isInteger(input.expiryMinutes) && input.expiryMinutes !== undefined) {
      return { error: 'expiry_minutes harus bilangan bulat.', code: 'VALIDATION_ERROR' }
    }
    if (input.expiryMinutes !== undefined && (input.expiryMinutes < 1 || input.expiryMinutes > 1440)) {
      return { error: 'expiry_minutes harus antara 1 dan 1440.', code: 'VALIDATION_ERROR' }
    }

    const response = await this.request<{
      order_id: string
      amount: number
      status: string
      qris_url?: string
      expiry_time?: string
    }>('POST', '/v1/charge', {
      amount: input.amount,
      order_id: input.orderId,
      // `webhook_url` dikirim kalau ada yang bisa dipakai.
      //
      // Versi sebelumnya menulis `input.webhookUrl ?? env.BATURPAY_WEBHOOK_SECRET`
      // sebagai kondisi — jadi URL webhook ikut terkirim kalau secret-nya
      // terisi, dan `undefined` terkirim kalau host-nya localhost. Saat
      // `webhook_url: undefined` masuk ke JSON, propertinya hilang — jadi
      // perilakunya kebetulan benar, tapi lewat jalur yang tidak_dimengerti.
      ...(() => {
        const url = input.webhookUrl ?? defaultWebhookUrl()
        return url ? { webhook_url: url } : {}
      })(),
      ...(input.description ? { description: input.description } : {}),
      ...(input.customerName ? { customer_name: input.customerName } : {}),
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      ...(input.refId ? { ref_id: input.refId } : {}),
      ...(input.expiryMinutes ? { expiry_minutes: input.expiryMinutes } : {}),
    })

    if (!response.ok || !response.data) {
      return {
        error: response.errorMessage ?? 'Gagal membuat charge.',
        code: response.errorCode ?? 'UNKNOWN',
      }
    }

    return {
      orderId: response.data.order_id,
      amount: response.data.amount,
      status: STATUS_MAP[response.data.status] ?? 'PENDING',
      qrisUrl: response.data.qris_url ?? null,
      expiryTime: response.data.expiry_time ?? null,
    }
  }

  /** Ambil status transaksi dari provider. */
  async getTransactionStatus(orderId: string): Promise<{
    status: PaymentStatus
    amount: number
    settledAt: string | null
    raw: unknown
  } | null> {
    const response = await this.request<{
      order_id: string
      amount: number
      status: string
      settled_at?: string | null
    }>('GET', `/v1/transactions/${encodeURIComponent(orderId)}`)

    if (!response.ok || !response.data) return null

    return {
      status: STATUS_MAP[response.data.status] ?? 'PENDING',
      amount: response.data.amount,
      settledAt: response.data.settled_at ?? null,
      raw: response.data,
    }
  }

  /**
   * Tagihan milik organisasi, beserta sisa pembayarannya.
   *
   * Sisa dihitung di sini, bukan disimpan — supaya tidak bisa basi.
   */
  async getInvoice(
    organizationId: string,
    invoiceId: string,
  ): Promise<{ id: string; number: string; title: string; totalAmount: number; paidAmount: number } | null> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, number: true, title: true, totalAmount: true, paidAmount: true },
    })
    return invoice
  }

  /** URL gambar QR (publik, tanpa auth). */
  qrUrl(orderId: string): string {
    return `${this.baseUrl}/v1/transactions/${encodeURIComponent(orderId)}/qr`
  }

  /**
   * Tautan QRIS untuk satu transaksi.
   *
   * Deterministik dari `orderId` — tidak perlu memanggil penyedia. Dipakai
   * `payment_list`, yang sudah tahu transaksi mana yang ada.
   *
   * Untuk kasus "yang mana?", pakai `qrUrlUntukOrder()`: dia menanyakan
   * database dulu, jadi transaksi yang sudah dihapus tidak menghasilkan tautan
   * yang berakhir di 404.
   */
  qrUrlUntuk(orderId: string): string {
    return this.qrUrl(orderId)
  }

  /** Sama seperti di atas, tapi hanya kalau transaksi benar-benar ada di database. */
  async qrUrlUntukOrder(orderId: string): Promise<string | null> {
    const payment = await this.prisma.payment.findFirst({
      where: { providerReference: orderId },
      select: { metadata: true },
    })
    const dariMetadata = (payment?.metadata as { qrisUrl?: unknown } | undefined)?.qrisUrl
    if (typeof dariMetadata === 'string' && dariMetadata !== '') return dariMetadata
    return payment ? this.qrUrl(orderId) : null
  }

/**
 * Daftar transaksi dari penyedia.
 *
 * `GET /v1/transactions?status=&from=&to=&limit=&offset=` — default 25 baris.
 * `offset` dipakai, bukan hanya `limit`, supaya halaman berikutnya tidak
 * mengulang isi halaman pertama.
 */
async listRemoteTransactions(
  options: { status?: string; limit?: number; offset?: number } = {},
): Promise<Array<{ orderId: string; amount: number; status: PaymentStatus; raw: unknown }>> {
  const param = new URLSearchParams()
  if (options.status) param.set('status', options.status)
  param.set('limit', String(options.limit ?? 25))
  param.set('offset', String(options.offset ?? 0))

  const response = await this.request<Array<Record<string, unknown>>>(
    'GET',
    `/v1/transactions?${param.toString()}`,
  )

  if (!response.ok || !Array.isArray(response.data)) return []

  return response.data.map((row) => ({
    orderId: String(row.order_id ?? ''),
    amount: Number(row.amount ?? 0),
    status: STATUS_MAP[String(row.status)] ?? 'PENDING',
    raw: row,
  }))
}

/**
 * Daftar pembayaran yang tercatat di sistem kita.
 *
 * Sengaja membaca dari database, bukan dari penyedia: yang perlu dijawab
 * pengguna adalah pembayaran milik tagsihan yang mana di organisasi ini, dan
 * itu hanya ada di sini.
 */
async listPayments(
  organizationId: string,
  options: { status?: PaymentStatus; limit?: number } = {},
): Promise<
  Array<{
    orderId: string
    amount: number
    status: PaymentStatus
    invoiceNumber: string | null
    /** Judul tagihan — "Iuran Agustus". */
    invoiceTitle: string | null
    /**
     * Nama anggota yang ditagih.
     *
     * `null` untuk tagihan tingkat organisasi, bukan "tidak diketahui" — jadi
     * pembedaannya jelas.
     */
    memberName: string | null
    createdAt: Date
  }>
> {
  return this.prisma.payment.findMany({
    where: {
      organizationId,
      provider: 'BATURPAY',
      ...(options.status ? { status: options.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 20,
    select: {
      providerReference: true,
      amount: true,
      status: true,
      createdAt: true,
      invoice: {
        select: {
          number: true,
          title: true,
          // Nama ikut diambil karena use case utama `payment_list` adalah
          // "siapa yang belum bayar". Tanpa nama, tool hanya menjawab "3 tagihan
          // menunggu" — dan itu tidak bisa dipakai untuk menagih siapa pun.
          member: { select: { fullName: true } },
        },
      },
    },
  }).then((rows) =>
    rows.map((row) => ({
      orderId: row.providerReference ?? '',
      amount: row.amount,
      status: row.status,
      invoiceNumber: row.invoice?.number ?? null,
      invoiceTitle: row.invoice?.title ?? null,
      memberName: row.invoice?.member?.fullName ?? null,
      createdAt: row.createdAt,
    })),
  )
}

/** Catat pembayaran yang Charge-nya sudah dibuat di penyedia. */
/**
 * Catat pembayaran yang charge-nya sudah dibuat di penyedia.
 *
 * Idempoten lewat `IdempotencyKey`.
 *
 * `order_id` BaturPay menolak duplikat dengan `409 ORDER_EXISTS`, jadi di sisi
 * penyedia sudah aman. Tapi kalau percobaan pertama berhasil di penyedia lalu
 * gagal di sini, percobaan ulang dengan `order_id` baru akan membuat dua QRIS
 * untuk satu tagihan — dan orang tidak tahu mana yang benar.
 *
 * Kunci idempotensi ditulis **sebelum** pencatatan, jadi percobaan ulang melihat
 * operasi yang sama. Kalau sedang berjalan, pemanggil diberi tahu alih-alih
 * dibuatkan charge kedua.
 */
async recordPayment(input: {
  organizationId: string
  invoiceId: string
  amount: number
  orderId: string
  qrisUrl?: string | null
  idempotencyKey?: string
}): Promise<{ id: string; duplikat: boolean }> {
  const kunci = kunciIdempotensi(input.organizationId, 'payment.create', input.idempotencyKey ?? input.orderId)

  // Percobaan ulang: kembalikan hasil yang sudah ada.
  const ada = await this.prisma.idempotencyKey.findUnique({
    where: { key: kunci },
    select: { status: true, responseHash: true, createdAt: true },
  })

  if (ada?.status === 'COMPLETED' && ada.responseHash) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: ada.responseHash, organizationId: input.organizationId },
      select: { id: true },
    })
    if (payment) {
      log.info({ kunci }, 'charge ulang memakai hasil yang sudah ada')
      return { id: payment.id, duplikat: true }
    }
  }

  // Kunci yang sudah basi berasal dari proses yang mati di tengah jalan.
  // Menolaknya berarti operasi itu tidak akan pernah bisa diulang.
  if (ada?.status === 'IN_PROGRESS' && !sudahBasi(ada.createdAt)) {
    throw new PaymentBusyError('Permintaan pembayaran untuk tagihan ini sedang diproses. Coba lagi sebentar.')
  }

  // Kunci basi dipakai ULANG, bukan dibuat ulang.
  //
  // `create` di sini akan bentrok dengan baris basi yang sudah ada — dan
  // memperlakukannya sebagai "sedang diproses" berubah menjadi blokir
  // selamanya, persis yang ingin dihindari.
  if (!ada) {
    try {
      await this.prisma.idempotencyKey.create({ data: { key: kunci, operation: 'payment.create' } })
    } catch (error) {
      // Kunci bentrok = percobaan lain baru saja mengambilnya di antara
      // pembacaan dan penulisan ini.
      if (kodePrisma(error) === 'P2002') {
        throw new PaymentBusyError('Permintaan pembayaran untuk tagihan ini sedang diproses. Coba lagi sebentar.')
      }
      throw error
    }
  }

  const payment = await this.prisma.payment.create({
    data: {
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      provider: 'BATURPAY',
      providerReference: input.orderId,
      amount: input.amount,
      status: 'PENDING',
      metadata: input.qrisUrl ? { qrisUrl: input.qrisUrl } : {},
    },
    select: { id: true },
  })

  await this.prisma.idempotencyKey.update({
    where: { key: kunci },
    data: { status: 'COMPLETED', responseHash: payment.id, completedAt: new Date() },
  })

  return { id: payment.id, duplikat: false }
}

}

/**
 * Proses webhook BaturPay yang sudah signature-nya tervalidasi.
 *
 * Idempotensi: setiap event dicatat di `PaymentTransaction` dengan unik
 * `(provider, providerEventId)`. Kalau event sama datang lagi, unique
 * constraint menolaknya — jadi tidak ada mutasi ganda.
 */
export interface WebhookOutcome {
  accepted: boolean
  orderId: string | null
  status: PaymentStatus | null
  action: 'recorded' | 'duplicate' | 'ignored' | 'not_found' | 'amount_mismatch'
}

export async function handleBaturPayWebhook(
  payload: Record<string, unknown>,
  rawBody: Buffer,
): Promise<WebhookOutcome> {
  const orderId = typeof payload.order_id === 'string' ? payload.order_id : null
  const rawStatus = typeof payload.status === 'string' ? payload.status.toLowerCase() : null

  if (!orderId || !rawStatus) {
    log.warn('webhook BaturPay tanpa order_id atau status')
    return { accepted: false, orderId, status: null, action: 'ignored' }
  }

  const status = STATUS_MAP[rawStatus]
  if (!status) {
    log.warn({ rawStatus }, 'status transaksi BaturPay tidak dikenal')
    return { accepted: false, orderId, status: null, action: 'ignored' }
  }

  // Event id: BaturPay tidak mengirim id eksplisit, jadi kita turunkan dari
  // kombinasi order + status + timestamp. Kalau webhook yang sama diulang,
  // nilainya sama → terdeteksi duplikat.
  const eventId = createHash('sha256')
    .update(`${orderId}|${rawStatus}|${String(payload.updated_at ?? payload.paid_at ?? '')}`)
    .digest('hex')
    .slice(0, 32)

  const { prisma } = await import('../database/client.js')

  const payment = await prisma.payment.findFirst({
    where: { provider: 'BATURPAY', providerReference: orderId },
    select: { id: true, status: true, organizationId: true, amount: true },
  })

  if (!payment) {
    log.warn({ orderId }, 'webhook untuk order yang tidak dikenal di sistem')
    return { accepted: true, orderId, status, action: 'not_found' }
  }

  // ── Verifikasi nominal ───────────────────────────────────────────────────
  //
  // Webhook membawa `amount`. Kalau berbeda dari yang kita catat, ada yang
  // salah — dan menandai `SETTLED` di nominal yang keliru berarti mencatat
  // uang yang tidak pernah masuk.
  //
  // BaturPay melakukan pemeriksaan yang sama pada webhook masuknya
  // (`AMOUNT_MISMATCH`). Kalau kita tidak, satu-satunya pemeriksaan hilang.
  if (typeof payload.amount === 'number' && payload.amount !== payment.amount) {
    log.error(
      { orderId,expected: payment.amount, received: payload.amount },
      'nominal webhook tidak cocok dengan pembayaran yang tercatat',
    )
    return { accepted: true, orderId, status: payment.status, action: 'amount_mismatch' as never }
  }

  // ── Aturan perubahan status ──────────────────────────────────────────────
  //
  // Yang TIDAK boleh: status final turun ke non-terminal. Contohnya webhook
  // lama (pending) datang setelah settlement — abide itu statusnya bisa
  // mundur dan pembayaran yang sudah lunas tercatat belum dibayar.
  //
  // Yang WAJIB boleh: pengembalian uang setelah status SETTLED. `refund` dan
  // `chargeback` adalah peristiwa uang yang nyata; mengabaikannya membuat
  // buku kas menampilkan uang yang sudah tidak ada milik organisasi.
  if (TERMINAL_STATUSES.has(payment.status) && payment.status !== status) {
    const angutBaru = STATUS_ANGKUT.has(status) && !STATUS_ANGKUT.has(payment.status)
    if (!angutBaru) {
      log.warn(
        { orderId, current: payment.status, incoming: status },
        'status final tidak diturunkan oleh webhook berikutnya',
      )
      return { accepted: true, orderId, status: payment.status, action: 'ignored' }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Unik constraint di sini yang mencegah webhook ganda.
      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          provider: 'BATURPAY',
          status,
          providerEventId: eventId,
          rawPayload: JSON.parse(rawBody.toString('utf8')) as never,
          occurredAt: new Date(),
        },
      })

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          // `verifiedAt` hanya terisi saat uang benar-benar diterima.
          // Status yang berubah tidak otomatis berarti uang masuk.
          ...(STATUS_MASUK.has(status) ? { verifiedAt: new Date() } : {}),
          ...(status === 'REFUNDED' ? { verifiedAt: null } : {}),
        },
      })
    })

    log.info({ orderId, status }, 'status pembayaran diperbarui dari webhook')
    return { accepted: true, orderId, status, action: 'recorded' }
  } catch (error) {
    // Pelanggaran unique constraint = webhook duplikat.
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Unique constraint')) {
      log.info({ orderId }, 'webhook duplikat diabaikan')
      return { accepted: true, orderId, status, action: 'duplicate' }
    }
    throw error
  }
}

/**
 * URL webhook yang dipakai kalau pemanggil tidak memberikan.
 *
 * Tanpa secret, verifikasi signature tidak bisa jalan — jadi webhook tidak
 * dikirim sama sekali, karena webhook tanpa verifikasi lebih berbahaya daripada
 * tidak ada: uang akan dicatat dari payload yang bisa dibuat siapa saja.
 */
function defaultWebhookUrl(): string | undefined {
  if (!env.BATURPAY_WEBHOOK_SECRET) return undefined
  const host = env.SERVER_HOST
  // Host 0.0.0.0 atau localhost tidak bisa dijangkau BaturPay (serverless).
  if (host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost') return undefined
  return `https://${host}/webhooks/baturpay`
}