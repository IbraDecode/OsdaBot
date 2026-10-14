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

/** Status BaturPay → status internal OSDABOT. */
export const STATUS_MAP: Record<string, PaymentStatus> = {
  created: 'PENDING',
  pending: 'PENDING',
  settlement: 'SETTLED',
  capture: 'SETTLED',
  expire: 'EXPIRED',
  cancel: 'CANCELLED',
  deny: 'FAILED',
  refund: 'REFUNDED',
  partial_refund: 'REFUNDED',
  chargeback: 'FAILED',
}

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
  apiKey?: string
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
    this.apiKey = deps.apiKey ?? env.BATURPAY_API_KEY ?? null
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
      return {
        ok: false,
        status: 0,
        data: null,
        errorCode: 'NOT_CONFIGURED',
        errorMessage: 'BaturPay belum dikonfigurasi (BATURPAY_API_KEY kosong).',
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
      ...(input.webhookUrl ?? env.BATURPAY_WEBHOOK_SECRET
        ? { webhook_url: input.webhookUrl ?? defaultWebhookUrl() }
        : {}),
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

  /** URL gambar QR (publik, tanpa auth). */
  qrUrl(orderId: string): string {
    return `${this.baseUrl}/v1/transactions/${encodeURIComponent(orderId)}/qr`
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
  action: 'recorded' | 'duplicate' | 'ignored' | 'not_found'
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
    select: { id: true, status: true, organizationId: true },
  })

  if (!payment) {
    log.warn({ orderId }, 'webhook untuk order yang tidak dikenal di sistem')
    return { accepted: true, orderId, status, action: 'not_found' }
  }

  // Status terminal tidak boleh diturunkan (mis. refund lalu settlement).
  if (TERMINAL_STATUSES.has(payment.status) && payment.status !== status) {
    log.warn(
      { orderId, current: payment.status, incoming: status },
      'status final tidak diubah oleh webhook berikutnya',
    )
    return { accepted: true, orderId, status: payment.status, action: 'ignored' }
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
          ...(status === 'SETTLED' ? { verifiedAt: new Date() } : {}),
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

function defaultWebhookUrl(): string | undefined {
  if (!env.BATURPAY_WEBHOOK_SECRET) return undefined
  const host = env.SERVER_HOST
  // Host 0.0.0.0 atau localhost tidak bisa dijangkau BaturPay (serverless).
  if (host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost') return undefined
  return `https://${host}/webhooks/baturpay`
}