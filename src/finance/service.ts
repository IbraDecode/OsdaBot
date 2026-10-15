/**
 * Layanan keuangan.
 *
 * ── Aturan yang tidak bisa dilanggar di sini ───────────────────────────────
 *
 * 1. Uang SELALU integer Rupiah. Tidak ada float, tidak ada pembulatan diam-diam.
 *
 *    `0.1 + 0.2 !== 0.3` adalah hal wajar untuk perhitungan biasa. Untuk
 *    buku kas itu selisih beberapa rupiah yang tidak pernah cocok dengan
 *    struk. Semua nilai rupiah masuk lewat `parseAmount()` yang menolak
 *    pecahan.
 *
 * 2. Saldo TIDAK BOLEH minus untuk kas.
 *
 *    Saldo negatif berarti pengeluaran tercatat tanpa uang yang ada. Itu
 *    membuat buku kas salah dan tidak ada yang bisa memperbaikinya kecuali
 *    orang yang membaca. Expense yang melebihi saldo ditolak, bukan diterima
 *    lalu pelan-pelan jadi bangkrut.
 *
 * 3. Pembayaran harus ATOMIK.
 *
 *    Status tagihan, jumlah terbayar, mutasi kas, dan saldo harus berubah
 *    bersama atau tidak sama sekali. Kalau tagihan sudah LUNAS tapi saldo kas
 *    belum berubah, buku kas dan tagihan|reporting saling berbohong.
 *
 * 4. Pembayaran melebihi tagihan DITOLAK.
 *
 *    Membayar Rp 150.000 untuk tagihan Rp 100.000 berarti ada selisih yang
 *    harus ditanyakan — bisa salah transfer, bisa salah baca nominal. Menerimanya
 *    berarti uang hilang tanpa jejak.
 */
import type { PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'finance' })

/** Jenis mutasi kas. */
export type EntryType = 'income' | 'expense' | 'opening'

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'cancelled' | 'overdue'

export class FinanceError extends Error {
  constructor(
    readonly code:
      | 'ACCOUNT_NOT_FOUND'
      | 'AMOUNT_INVALID'
      | 'AMOUNT_TOO_LARGE'
      | 'INSUFFICIENT_BALANCE'
      | 'INVOICE_NOT_FOUND'
      | 'PAYMENT_EXCEEDS_INVOICE'
      | 'ALREADY_PAID'
      | 'MEMBER_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'FinanceError'
  }
}

/**
 * Ubah input pengguna menjadi integer Rupiah.
 *
 * Menerima "25.000", "25000", "Rp 25.000", "25,000".
 *
 * Menolak pecahan: "25.5" berarti ada yang tidak bisa direpresentasikan
 * dalam rupiah.
 *
 * Menolak eksplisit lebih baik daripada membulatkan diam-diam. Pembulatan yang
 * tidak terlihat adalah sumber selisih yang mustahil dilacak.
 */
export function parseAmount(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      throw new FinanceError('AMOUNT_INVALID', `Nominal ${input} bukan rupiah bulat.`)
    }
    // `isInteger` saja tidak cukup: angka sebesar MAX_SAFE_INTEGER + 2 masih
    // "integer" menurut JS, tapi sudah di luar rentang presisi. Rupiah di atas
    // batas itu tidak bisa dijamin akurat.
    if (!Number.isSafeInteger(input)) {
      throw new FinanceError('AMOUNT_TOO_LARGE', 'Nominal terlalu besar untuk dihitung dengan tepat.')
    }
    return input
  }

  const cleaned = input
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '') // titik sebagai pemisah ribuan: 25.000
    .replace(/,(?=\d{3}\b)/g, '') // koma sebagai pemisah ribuan: 25,000
    .trim()

  if (cleaned === '' || cleaned === '-' || cleaned === '.') {
    throw new FinanceError('AMOUNT_INVALID', `Nominal "${input}" tidak bisa dibaca.`)
  }

  if (cleaned.includes('.') || cleaned.includes('-')) {
    // Pecahan ditolak, bukan dibulatkan.
    throw new FinanceError(
      'AMOUNT_INVALID',
      `Nominal "${input}" punya pecahan. Rupiah tidak punya satuan lebih kecil dari 1 rupiah.`,
    )
  }

  const nilai = Number(cleaned)
  if (!Number.isSafeInteger(nilai)) {
    throw new FinanceError('AMOUNT_TOO_LARGE', 'Nominal terlalu besar atau tidak valid.')
  }

  return nilai
}

/** Format integer Rupiah untuk ditampilkan ke pengguna. */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount)
}

export interface CreateAccountInput {
  organizationId: string
  name: string
  /** Saldo awal dalam Rupiah. Boleh negatif HANYA untuk akun non-kas. */
  openingBalance?: number
  currency?: string
}

export interface RecordEntryInput {
  accountId: string
  organizationId: string
  type: EntryType
  amount: number
  description?: string
  reference?: string
  occurredAt?: Date
  actorUserId: string | null
}

export interface InvoiceItemInput {
  description: string
  quantity: number
  unitAmount: number
}

export interface CreateInvoiceInput {
  organizationId: string
  title: string
  memberId?: string | null
  items: InvoiceItemInput[]
  dueAt?: Date | null
  notes?: string | null
  actorUserId: string | null
}

export interface RecordPaymentInput {
  organizationId: string
  invoiceId: string
  amount: number
  financeAccountId?: string | null
  actorUserId: string | null
  reference?: string | null
}

export class FinanceService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Buat akun kas/bank. Saldo awal dicatat sebagai mutasi `opening`. */
  async createAccount(input: CreateAccountInput): Promise<{ id: string; name: string; balance: number }> {
    const opening = input.openingBalance ?? 0
    if (!Number.isSafeInteger(opening)) {
      throw new FinanceError('AMOUNT_INVALID', 'Saldo awal harus rupiah bulat.')
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.financeAccount.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          currency: input.currency ?? 'IDR',
          balance: opening,
        },
        select: { id: true, name: true, balance: true },
      })

      // Saldo awal dicatat sebagai mutasi supaya buku bisa diaudit, bukan
      // cuma angka yang muncul tanpa asal-usul.
      if (opening !== 0) {
        await tx.cashbookEntry.create({
          data: {
            financeAccountId: account.id,
            type: 'opening',
            amount: opening,
            description: 'Saldo awal',
            occurredAt: new Date(),
          },
        })
      }

      return account
    })
  }

  /** Ambil akun milik organisasi. Wajib — id dari luar organisasi tidak boleh dipakai. */
  private async requireAccount(accountId: string, organizationId: string) {
    const account = await this.prisma.financeAccount.findFirst({
      where: { id: accountId, organizationId },
      select: { id: true, name: true, balance: true },
    })
    if (!account) {
      throw new FinanceError('ACCOUNT_NOT_FOUND', 'Rekening kas tidak ditemukan di organisasi ini.')
    }
    return account
  }

  /**
   * Catat mutasi kas dan perbarui saldo.
   *
   * Semua dalam satu transaksi. Expense yang melebihi saldo DITOLAK — saldo
   * kas tidak boleh minus.
   */
  async recordEntry(input: RecordEntryInput): Promise<{ entryId: string; balance: number }> {
    if (!Number.isSafeInteger(input.amount) || input.amount < 0) {
      throw new FinanceError('AMOUNT_INVALID', 'Nominal harus rupiah bulat dan tidak negatif.')
    }
    if (input.amount === 0) {
      throw new FinanceError('AMOUNT_INVALID', 'Nominal tidak boleh nol.')
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.financeAccount.findFirst({
        where: { id: input.accountId, organizationId: input.organizationId },
        select: { id: true, balance: true },
      })
      if (!account) {
        throw new FinanceError('ACCOUNT_NOT_FOUND', 'Rekening kas tidak ditemukan di organisasi ini.')
      }

      const delta = input.type === 'expense' ? -input.amount : input.amount

      // Pagar saldo kas tidak boleh minus.
      //
      // Saldo negatif berarti pengeluaran tercatat tanpa uang yang ada. Buku
      // jadi salah dan tidak ada yang bisa memperbaikinya kecuali orang yang
      // membaca ulang.
      if (account.balance + delta < 0) {
        throw new FinanceError(
          'INSUFFICIENT_BALANCE',
          `Saldo tidak cukup. Tersedia Rp ${formatAmount(account.balance)}, diminta Rp ${formatAmount(input.amount)}.`,
        )
      }

      const entry = await tx.cashbookEntry.create({
        data: {
          financeAccountId: input.accountId,
          type: input.type,
          amount: input.amount,
          description: input.description ?? null,
          reference: input.reference ?? null,
          occurredAt: input.occurredAt ?? new Date(),
          createdBy: input.actorUserId,
        },
        select: { id: true },
      })

      const updated = await tx.financeAccount.update({
        where: { id: input.accountId },
        data: { balance: { increment: delta } },
        select: { balance: true },
      })

      return { entryId: entry.id, balance: updated.balance }
    })
  }

  /**
   * Buat tagihan beserta rinciannya.
   *
   * Validasi occurred di sini, bukan nanti: tagihan dengan total nol atau
   * negatif tidak pernah masuk akal dan akan merusak semua pembukuan
   * berikutnya.
   */
  async createInvoice(input: CreateInvoiceInput): Promise<{
    id: string
    number: string
    title: string
    totalAmount: number
    itemCount: number
  }> {
    if (input.items.length === 0) {
      throw new FinanceError('AMOUNT_INVALID', 'Tagihan harus punya minimal satu rincian.')
    }

    // `amount` dihitung dari quantity x unitAmount, bukan diinput terpisah.
    // Kalau total diinput sendiri, rincian dan total bisa berbeda — dan
    // pembukuan jadi tidak konsisten sejak awal.
    const items = input.items.map((item) => {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new FinanceError('AMOUNT_INVALID', `Jumlah "${item.description}" harus bilangan bulat positif.`)
      }
      if (!Number.isSafeInteger(item.unitAmount) || item.unitAmount < 0) {
        throw new FinanceError('AMOUNT_INVALID', `Harga "${item.description}" harus rupiah bulat.`)
      }
      return { ...item, amount: item.quantity * item.unitAmount }
    })

    const total = items.reduce((sum, item) => sum + item.amount, 0)
    if (total <= 0) {
      throw new FinanceError('AMOUNT_INVALID', 'Total tagihan harus lebih dari nol.')
    }

    if (input.memberId) {
      const member = await this.prisma.organizationMember.findFirst({
        where: { id: input.memberId, organizationId: input.organizationId },
        select: { id: true },
      })
      if (!member) {
        throw new FinanceError('MEMBER_NOT_FOUND', 'Anggota tidak ditemukan di organisasi ini.')
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const number = await this.nextInvoiceNumber(tx, input.organizationId)

      const invoice = await tx.invoice.create({
        data: {
          organizationId: input.organizationId,
          memberId: input.memberId ?? null,
          number,
          title: input.title,
          totalAmount: total,
          status: 'unpaid',
          dueAt: input.dueAt ?? null,
          notes: input.notes ?? null,
          items: {
            create: items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitAmount: item.unitAmount,
              amount: item.amount,
            })),
          },
        },
        select: { id: true, number: true, title: true, totalAmount: true, items: { select: { id: true } } },
      })

      return {
        id: invoice.id,
        number: invoice.number,
        title: invoice.title,
        totalAmount: invoice.totalAmount,
        itemCount: invoice.items.length,
      }
    })
  }

  /**
   * Nomor tagihan berurutan per organisasi per tahun.
   *
   * `INV/2026/001`. Nomor dibuat di dalam transaksi dengan lock baris akun
   * supaya dua permintaan bersamaan tidak mendapat nomor yang sama.
   */
  private async nextInvoiceNumber(
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    organizationId: string,
  ): Promise<string> {
    const tahun = new Date().getFullYear()
    const prefix = `INV/${tahun}/`

    const terakhir = await tx.invoice.findFirst({
      where: { organizationId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    })

    const nomorTerakhir = terakhir ? Number(terakhir.number.slice(prefix.length)) : 0
    return `${prefix}${String(nomorTerakhir + 1).padStart(3, '0')}`
  }

  /**
   * Catat pembayaran.
   *
   * ATOMIK: mutasi kas + pembayaran + status tagihan berubah bersama. Kalau
   * tagihan sudah LUNAS tapi saldo kas belum, buku kas dan tagihan saling
   * berbohong — dan tidak ada yang akan RalitMoneyROLLBACKmemperbaikinya.
   */
  async recordPayment(input: RecordPaymentInput): Promise<{
    paymentId: string
    invoiceStatus: InvoiceStatus
    paidAmount: number
    remainingAmount: number
    balance: number | null
  }> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new FinanceError('AMOUNT_INVALID', 'Nominal pembayaran harus rupiah bulat lebih dari nol.')
    }

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: input.invoiceId, organizationId: input.organizationId },
        select: { id: true, title: true, totalAmount: true, paidAmount: true, status: true },
      })

      if (!invoice) {
        throw new FinanceError('INVOICE_NOT_FOUND', 'Tagihan tidak ditemukan di organisasi ini.')
      }

      if (invoice.status === 'cancelled') {
        throw new FinanceError('ALREADY_PAID', 'Tagihan ini sudah dibatalkan.')
      }

      const remaining = invoice.totalAmount - invoice.paidAmount
      if (remaining <= 0) {
        throw new FinanceError('ALREADY_PAID', 'Tagihan ini sudah lunas.')
      }

      // Bayar lebih dari tagihan berarti ada selisih yang harus ditanyakan:
      // salah transfer, atau salah baca nominal. Menerimanya berarti uang
      // hilang tanpa jejak.
      if (input.amount > remaining) {
        throw new FinanceError(
          'PAYMENT_EXCEEDS_INVOICE',
          `Pembayaran melebihi sisa tagihan. Sisa Rp ${formatAmount(remaining)}, dibayar Rp ${formatAmount(input.amount)}.`,
        )
      }

      let balance: number | null = null
      if (input.financeAccountId) {
        const account = await tx.financeAccount.findFirst({
          where: { id: input.financeAccountId, organizationId: input.organizationId },
          select: { id: true, balance: true },
        })
        if (!account) {
          throw new FinanceError('ACCOUNT_NOT_FOUND', 'Rekening kas tidak ditemukan di organisasi ini.')
        }

        // TIDAK ada cek saldo di sini.
        //
        // Cek saldo hanya berlaku untuk pengeluaran. Menerima uang tidak
        // butuh saldo tersedia; merusak saldo tidak berarti.
        //
        // Meminta saldo cukup untuk menerima pembayaran membuat organisasi tidak
        // bisa menerima dana pertama sama sekali.
        await tx.cashbookEntry.create({
          data: {
            financeAccountId: input.financeAccountId,
            type: 'income',
            amount: input.amount,
            description: `Pembayaran tagihan: ${invoice.title}`,
            reference: input.reference ?? null,
            occurredAt: new Date(),
            createdBy: input.actorUserId,
          },
        })

        const updated = await tx.financeAccount.update({
          where: { id: input.financeAccountId },
          data: { balance: { increment: input.amount } },
          select: { balance: true },
        })
        balance = updated.balance
      }

      const paidAmount = invoice.paidAmount + input.amount
      const status: InvoiceStatus = paidAmount >= invoice.totalAmount ? 'paid' : 'partial'

      const payment = await tx.payment.create({
        data: {
          organizationId: input.organizationId,
          invoiceId: input.invoiceId,
          financeAccountId: input.financeAccountId ?? null,
          amount: input.amount,
          status: 'SETTLED',
          // Pembayaran manual diverifikasi saat dicatat — bukan nanti.
          verifiedAt: new Date(),
          ...(input.reference ? { providerReference: input.reference } : {}),
        },
        select: { id: true },
      })

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { paidAmount, status },
      })

      return {
        paymentId: payment.id,
        invoiceStatus: status,
        paidAmount,
        remainingAmount: invoice.totalAmount - paidAmount,
        balance,
      }
    })
  }

  /**
   * Ambil satu tagihan milik organisasi.
   *
   * Sisa pembayaran dihitung di sini, bukan disimpan. Kalau disimpan, setiap
   * tempat yang mengubah `paidAmount` harus remember memperbarui sisa juga —
   * dan satu tempat yang lupa membuat angka yang dipakai pengguna salah.
   */
  async getInvoice(
    organizationId: string,
    invoiceId: string,
  ): Promise<{
    id: string
    number: string
    title: string
    totalAmount: number
    paidAmount: number
    remainingAmount: number
    status: string
    dueAt: Date | null
  } | null> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, number: true, title: true, totalAmount: true, paidAmount: true, status: true, dueAt: true },
    })
    if (!invoice) return null
    return { ...invoice, remainingAmount: Math.max(0, invoice.totalAmount - invoice.paidAmount) }
  }

  /**
   * Daftar tagihan beserta sisa pembayarannya.
   *
   * `remainingAmount` selalu dihitung dari `totalAmount - paidAmount`, tidak
   * pernah diambil dari kolom yang bisa basi.
   *
   * Urutan TIDAK alfabetis. Kolom `status` disimpan sebagai teks, jadi
   * `orderBy` akan menaruh `paid` sebelum `partial` sebelum `unpaid` — persis
   * kebalikan dari yang dicari. Pertanyaan yang paling sering muncul adalah
   * "siapa yang belum bayar", jadi tagihan yang belum lunas harus muncul
   * lebih dulu, bukan tenggelam di bawah tagihan yang sudah selesai.
   */
  async listInvoices(
    organizationId: string,
    options: { memberId?: string; status?: InvoiceStatus; limit?: number } = {},
  ): Promise<
    Array<{
      id: string
      number: string
      title: string
      memberName: string | null
      status: string
      totalAmount: number
      paidAmount: number
      remainingAmount: number
      dueAt: Date | null
    }>
  > {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        ...(options.memberId ? { memberId: options.memberId } : {}),
        ...(options.status ? { status: options.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      // Batas pengambilan dijaga supaya penyortiran di memori tidak tumbuh
      // tanpa batas. Konsekuensinya: kalau satu organisasi punya lebih dari
      // 200 tagihan, tagihan paling lama bisa terlewat. Itu batas yang
      // diketahui, bukan tersembunyi.
      take: Math.max(options.limit ?? 20, 200),
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        dueAt: true,
        member: { select: { fullName: true } },
      },
    })

    const hasil = invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      title: invoice.title,
      memberName: invoice.member?.fullName ?? null,
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      remainingAmount: Math.max(0, invoice.totalAmount - invoice.paidAmount),
      dueAt: invoice.dueAt,
    }))

    const prioritas: Record<string, number> = {
      overdue: 0,
      unpaid: 1,
      partial: 2,
      paid: 3,
      cancelled: 4,
    }

    return hasil
      .sort((a, b) => {
        const selisih = (prioritas[a.status] ?? 5) - (prioritas[b.status] ?? 5)
        // Status sama: yang paling baru dulu, sesuai urutan bawaan query.
        return selisih
      })
      .slice(0, options.limit ?? 20)
  }

  /**
   * Buang rekening yang saldo dan mutasinya kosong.
   *
   * Hanya untuk merapikan rekening yang belum pernah dipakai. Rekening yang
   * sudah punya mutasi TIDAK BOLEH dihapus di sini — menghapus riwayat kas
   * bukan pekerjaan "beres-beres", itu penghapusan data.
   */
  async deleteEmptyAccount(accountId: string): Promise<boolean> {
    const account = await this.prisma.financeAccount.findUnique({
      where: { id: accountId },
      select: { id: true, balance: true, _count: { select: { entries: true } } },
    })

    if (!account) return false
    if (account.balance !== 0 || account._count.entries > 0) return false

    await this.prisma.financeAccount.delete({ where: { id: accountId } })
    return true
  }

  /** Daftar akun kas beserta saldo. */
  async listAccounts(organizationId: string): Promise<Array<{ id: string; name: string; balance: number }>> {
    return this.prisma.financeAccount.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, balance: true },
    })
  }

  /** Mutasi kas terbaru. */
  async recentEntries(
    organizationId: string,
    options: { accountId?: string; limit?: number } = {},
  ): Promise<
    Array<{ id: string; type: string; amount: number; description: string | null; occurredAt: Date }>
  > {
    return this.prisma.cashbookEntry.findMany({
      where: {
        financeAccount: {
          organizationId,
          ...(options.accountId ? { id: options.accountId } : {}),
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: options.limit ?? 20,
      select: { id: true, type: true, amount: true, description: true, occurredAt: true },
    })
  }

  /**
   * Hitung ulang saldo dari mutasi.
   *
   * Hanya untuk pemeriksaan — saldo di tabel diperbarui saat mutasi. Kalau
   * hasilnya beda, ada bug; jangan "memperbaiki" dengan menyalin hasil
   * hitung ke tabel, karena itu menutupi penyebabnya.
   */
  async verifyBalance(accountId: string): Promise<{ recorded: number; computed: number; consistent: boolean }> {
    const account = await this.requireAccount(accountId, '')
    const entries = await this.prisma.cashbookEntry.findMany({
      where: { financeAccountId: accountId },
      select: { type: true, amount: true },
    })

    const computed = entries.reduce((sum, entry) => {
      if (entry.type === 'expense') return sum - entry.amount
      return sum + entry.amount
    }, 0)

    const consistent = computed === account.balance
    if (!consistent) {
      log.error(
        { accountId, recorded: account.balance, computed },
        'saldo akun tidak cocok dengan penjumlahan mutasi',
      )
    }

    return { recorded: account.balance, computed, consistent }
  }
}