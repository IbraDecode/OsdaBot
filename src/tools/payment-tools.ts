/**
 * Tool pembayaran BaturPay.
 *
 * ── Batas yang paling menentukan desain tool ini ───────────────────────────
 *
 * 1. **Klaim chat BUKAN pembayaran.** Tidak ada tool yang menerima "sudah
 *    bayar". Satu-satunya jalan menuju `SETTLED` adalah webhook BaturPay yang
 *    signature-nya sudah diverifikasi. Kalau pembayaran bisa dicatat dari chat,
 *    siapa pun bisa menandai iuran lunas tanpa membayar sepeser pun.
 *
 * 2. **Uang hanya seit `settlement`.** `capture` berarti "berhasil tapi belum
 *    final" — dana yang dicatat dari `capture` bisa ternyata tidak pernah masuk.
 *
 * 3. **Meminta pembayaran MEMBUTUHKAN persetujuan.** Mengirim QRIS ke orang
 *    adalah tindakan yang terlihat dan mendorong orang transfer.
 *
 * Semua nilai HTTP dan nama field di sini diambil dari dokumentasi resmi
 * BaturPay (`baturpay.vercel.app/docs`), bukan dari asumsi.
 */
import { z } from 'zod'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'
import { PERMISSIONS } from '../security/permissions.js'
import { PaymentBusyError, type BaturPayAdapter } from '../payments/baturpay.js'
import type { PaymentStatus } from '@prisma/client'
import { formatAmount, parseAmount } from '../finance/service.js'
import type { IdentityEngine } from '../identity/resolver.js'

export interface PaymentToolsDeps {
  payments: BaturPayAdapter
  identity: IdentityEngine
}

/** Nominal rupiah bulat. */
const nominal = z
  .union([z.string().max(40), z.number().int()])
  .describe('Nominal RUPIAH bulat, boleh "25.000" atau 25000. Tidak ada pecahan.')

export function buildPaymentTools(deps: PaymentToolsDeps): Array<ToolDefinition<never, never>> {
  const { payments, identity } = deps

  const createCharge: ToolDefinition<
    {
      invoiceId: string
      amount?: string | number
      memberName?: string
      expiryMinutes?: number
      description?: string
    },
    unknown
  > = {
    name: 'payment_create_charge',
    description:
      'Buat QRIS pembayaran untuk sebuah tagihan. WAJIB panggil finance_list_invoices lebih dulu untuk tahu tagihan yang mana. ' +
      'Nominal diambil dari sisa tagihan; kalau pengguna menyebut nominal lain yang lebih kecil, itu boleh — tapi kalau LEBIH BESAR dari sisa, tanyakan dulu, jangan diam-diam. ' +
      'Ini hanya meminta pembayaran. Pembayaran dianggap sah HANYA setelah penyedia mengonfirmasi lewat webhook — jangan menyatakan sudah masuk karena QRIS dikirim.',
    inputSchema: z
      .object({
        invoiceId: z.string().uuid().describe('Id tagihan dari finance_list_invoices.'),
        amount: nominal.optional().describe('Nominal yang diminta. Kosongkan untuk memakai seluruh sisa tagihan.'),
        memberName: z
          .string()
          .max(120)
          .optional()
          .describe('Nama anggota yang akan membayar, sesuai yang disebut pengguna.'),
        expiryMinutes: z
          .number()
          .int()
          .min(1)
          .max(1440)
          .optional()
          .describe('Masa berlaku QRIS dalam menit. Default 60. Maks 1440.'),
        description: z.string().max(200).optional().describe('Keterangan yang tampil di QRIS.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      if (!payments.isConfigured) {
        throw new ToolError(
          'PROVIDER_UNAVAILABLE',
          'Pembayaran otomatis belum dikonfigurasi di server ini. Catat pembayaran manual lewat finance_record_payment.',
        )
      }

      const tagihan = await payments.getInvoice(organizationId, input.invoiceId)
      if (!tagihan) {
        throw new ToolError('NOT_FOUND', 'Tagihan tidak ditemukan di organisasi ini.')
      }

      const sisa = tagihan.totalAmount - tagihan.paidAmount
      if (sisa <= 0) {
        throw new ToolError('CONFLICT', `Tagihan ${tagihan.number} sudah lunas.`)
      }

      // Nominal melebihi sisa berarti ada selisih yang harus ditanyakan.
      const diminta = input.amount === undefined ? sisa : parseAmount(input.amount)
      if (diminta > sisa) {
        throw new ToolError(
          'VALIDATION_FAILED',
          `Nominal Rp ${formatAmount(diminta)} melebihi sisa tagihan ${tagihan.number} yang Rp ${formatAmount(sisa)}. ` +
            'Tanyakan ke pengguna dulu — jangan buat pembayaran melebihi tagihan.',
        )
      }

      let customerName: string | undefined
      if (input.memberName) {
        const resolution = await identity.resolveMemberByName(organizationId, input.memberName)
        if (resolution.certainty === 'unique') customerName = resolution.memberName
      }

      // ── Idempotensi ───────────────────────────────────────────────────────
      //
      // Kunci diturunkan dari tagihan + nominal + menit berjalan, BUKAN acak.
      //
      // Kunci acak membuat setiap percobaan berbeda, sehingga percobaan ulang
      // setelah kegagalan membuat QRIS kedua untuk tagihan yang sama — dua
      // permintaan transfer untuk satu tagihan, dan orang tidak tahu mana
      // yang benar.
      //
      // Kunci berbasis waktu punya batas: kalau charge gagal lalu dicoba lagi
      // satu menit kemudian, kunci baru dan charge kedua memang terjadi.
      // Itu trade-off yang diterima, dan lebih baik daripada charge ganda dalam
      // hitungan detik.
      const bucketMenit = Math.floor(Date.now() / 60_000)
      const idempotencyKey = `${input.invoiceId}:${diminta}:${bucketMenit}`

      // Kalau masih ada QRIS yang menunggu pada tagihan ini, jangan buat yang
      // kedua. Dua QRIS untuk satu tagihan membuat penerima bingung dan bisa
      // menghasilkan pembayaran ganda.
      const menunggu = await payments.listPayments(organizationId, {
        status: 'PENDING',
        limit: 50,
      })
      const bentrok = menunggu.find(
        (row) => row.invoiceNumber === tagihan.number && row.amount === diminta,
      )
      if (bentrok) {
        throw new ToolError(
          'CONFLICT',
          `Sudah ada permintaan pembayaran Rp ${formatAmount(diminta)} yang masih menunggu pada tagihan ${tagihan.number}. ` +
            'Jangan buat QRIS kedua — cek statusnya dulu, atau tunggu sampai kedaluwarsa.',
        )
      }

      const orderId = `OSDA-${input.invoiceId.replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36).toUpperCase()}`

      const hasil = await payments.createCharge({
        organizationId,
        amount: diminta,
        orderId,
        description: input.description ?? tagihan.title,
        ...(customerName ? { customerName } : {}),
        ...(input.expiryMinutes ? { expiryMinutes: input.expiryMinutes } : {}),
      })

      if ('error' in hasil) {
        // `ORDER_EXISTS` berarti charge-nya sudah pernah dibuat — jangan
        // mencoba lagi dengan id lain, itu hanya menghasilkan transaksi ganda.
        const kode =
          hasil.code === 'INVALID_AMOUNT' || hasil.code === 'VALIDATION_ERROR'
            ? 'VALIDATION_FAILED'
            : hasil.code === 'ORDER_EXISTS'
              ? 'CONFLICT'
              : 'PROVIDER_UNAVAILABLE'
        throw new ToolError(kode, `${hasil.error} (kode: ${hasil.code})`)
      }

      let payment: { id: string; duplikat: boolean }
      try {
        payment = await payments.recordPayment({
          organizationId,
          invoiceId: tagihan.id,
          amount: hasil.amount,
          orderId: hasil.orderId,
          qrisUrl: hasil.qrisUrl,
          idempotencyKey,
        })
      } catch (error) {
        // Percobaan lain sedang jalan untuk operasi yang sama. Itu bukan
        // kegagalan — jawabannya sudah ada, tinggal belum selesai.
        if (error instanceof PaymentBusyError) {
          throw new ToolError('CONFLICT', error.message)
        }
        throw error
      }

      return {
        paymentId: payment.id,
        orderId: hasil.orderId,
        invoiceNumber: tagihan.number,
        amount: hasil.amount,
        amountText: `Rp ${formatAmount(hasil.amount)}`,
        qrisUrl: hasil.qrisUrl,
        expiryTime: hasil.expiryTime,
        reusedPayment: payment.duplikat,
        message:
          `QRIS untuk tagihan ${tagihan.number} sudah dibuat: Rp ${formatAmount(hasil.amount)}. ` +
          'Kirim link QR-nya ke anggota. Pembayaran baru dianggap sah setelah penyedia mengonfirmasi — jangan menyatakan sudah masuk.',
      }
    },
  }

  const checkStatus: ToolDefinition<{ orderId?: string }, unknown> = {
    name: 'payment_check_status',
    description:
      'Cek status pembayaran ke penyedia. Pakai kalau pengguna menanyakan "sudah masuk belum?". ' +
      'Hanya status `settlement` yang berarti uang benar-benar diterima. `capture` berarti berhasil tapi BELUM final — jangan bilang sudah masuk.',
    inputSchema: z
      .object({
        orderId: z.string().max(64).optional().describe('Kode order dari payment_create_charge.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      if (!payments.isConfigured) {
        throw new ToolError('PROVIDER_UNAVAILABLE', 'Pembayaran otomatis belum dikonfigurasi di server ini.')
      }
      if (!input.orderId) {
        throw new ToolError(
          'VALIDATION_FAILED',
          'Kode order belum disebut. Ambil dari hasil payment_create_charge atau payment_list_pending.',
        )
      }

      const hasil = await payments.getTransactionStatus(input.orderId)
      if (!hasil) {
        throw new ToolError('NOT_FOUND', `Transaksi "${input.orderId}" tidak ditemukan di penyedia.`)
      }

      return {
        orderId: input.orderId,
        status: hasil.status,
        amount: hasil.amount,
        amountText: `Rp ${formatAmount(hasil.amount)}`,
        settledAt: hasil.settledAt,
        interpretation: interpretasi(hasil.status),
      }
    },
  }

  const list: ToolDefinition<{ status?: string; limit?: number }, unknown> = {
    name: 'payment_list',
    description:
      'Tampilkan pembayaran yang tercatat untuk organisasi ini beserta tagihannya. ' +
      'Pakai kalau pengguna menanyakan "siapa yang belum bayar" atau "transaksi yang mana".',
    inputSchema: z
      .object({
        status: z
          .enum(['PENDING', 'SETTLED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'all'])
          .optional()
          .describe('Saring status. Default PENDING (yang belum dibayar).'),
        limit: z.number().int().positive().max(50).optional().describe('Jumlah maksimal. Default 20.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const status = input.status && input.status !== 'all' ? (input.status as PaymentStatus) : undefined

      const rows = await payments.listPayments(organizationId, {
        ...(status ? { status } : {}),
        limit: input.limit ?? 20,
      })

      return {
        payments: rows.map((row) => ({
          orderId: row.orderId,
          amount: row.amount,
          amountText: `Rp ${formatAmount(row.amount)}`,
          status: row.status,
          interpretation: interpretasi(row.status),
          invoiceNumber: row.invoiceNumber,
          createdAt: row.createdAt.toISOString().slice(0, 10),
        })),
        message: `${rows.length} pembayaran${status ? ` dengan status ${status}` : ''}.`,
      }
    },
  }

  return [createCharge, checkStatus, list] as never
}

/**
 * Kalimat yang boleh dianggap benar oleh model.
 *
 * Diberikan eksplisit supaya model tidak menebak: "PENDING" bisa berarti
 * sudah dibayar tapi belum dikonfirmasi, atau belum dibayar sama sekali.
 */
function interpretasi(status: string): string {
  switch (status) {
    case 'SETTLED':
      return 'Uang sudah diterima penyedia.'
    case 'PENDING':
      return 'Belum dikonfirmasi lunas. Jangan menyatakan sudah masuk.'
    case 'EXPIRED':
      return 'Kedaluwarsa tanpa dibayar. Buat QRIS baru kalau perlu.'
    case 'REFUNDED':
      return 'Sudah dikembalikan ke pembayar.'
    case 'FAILED':
      return 'Ditolak atau tersengketa.'
    case 'CANCELLED':
      return 'Dibatalkan.'
    default:
      return 'Status tidak dikenali.'
  }
}

function requireOrg(context: ToolExecutionContext): string {
  if (!context.organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum terdeteksi untuk percakapan ini.')
  }
  return context.organizationId
}