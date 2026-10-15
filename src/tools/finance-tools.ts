/**
 * Tool keuangan untuk AI agent.
 *
 * ── Batas yang dijaga di sini ───────────────────────────────────────────────
 *
 * 1. `organizationId` dan `actorUserId` TIDAK PERNAH jadi parameter.
 *
 *    Keduanya diambil dari `context`, yang sudah diverifikasi backend. Kalau
 *    model boleh mengisinya, satu organisasi bisa menulis ke buku kas
 *    organisasi lain hanya dengan menyebut id-nya di pesan.
 *
 * 2. Nominal SELALU integer Rupiah.
 *
 *    Parameter menerima string ("Rp 25.000") lalu `parseAmount()` mengubahnya
 *    jadi integer, dan MENOLAK pecahan. Parameter bertipe `number` yang dikirim
 *    model cenderung menghasilkan `25000.0` atau `2.5e4` yang meragukan.
 *
 * 3. Tool yang menyentuh saldo tidak pernah menebak.
 *
 *    Rekening yang tidak disebut, nominal yang tidak terbaca, nama anggota
 *    yang ambigu — semuanya ditolak dengan pesan yang bisa ditindaklanjuti,
 *    bukan diisi dengan tebakan.
 */
import { z } from 'zod'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'
import { PERMISSIONS } from '../security/permissions.js'
import { FinanceError, formatAmount, parseAmount, type FinanceService, type InvoiceStatus } from '../finance/service.js'
import type { IdentityEngine } from '../identity/resolver.js'

export interface FinanceToolsDeps {
  finance: FinanceService
  identity: IdentityEngine
}

/** Skema nominal rupiah — menerima format yang biasa diketik orang. */
const nominal = z
  .union([z.string().max(40), z.number().int()])
  .describe(
    'Nominal dalam RUPIAH bulat, tanpa pecahan. Boleh ditulis "25.000", "25000", atau "Rp 25.000". ' +
      'Jangan pernah mengirim angka pecahan seperti 25000.50 — sistem akan menolak.',
  )

export function buildFinanceTools(deps: FinanceToolsDeps): Array<ToolDefinition<never, never>> {
  const { finance, identity } = deps

  const listAccounts: ToolDefinition<Record<string, never>, unknown> = {
    name: 'finance_list_accounts',
    description:
      'Tampilkan daftar rekening kas beserta saldonya. Pakai ini sebelum mencatat pengeluaran atau menerima pembayaran, supaya tahu rekening mana yang tersedia dan berapa saldonya.',
    inputSchema: z.object({}).strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(_input, context) {
      const organizationId = requireOrg(context)
      const accounts = await finance.listAccounts(organizationId)

      return {
        accounts: accounts.map((account) => ({
          financeAccountId: account.id,
          name: account.name,
          balance: account.balance,
          balanceText: `Rp ${formatAmount(account.balance)}`,
        })),
        message:
          accounts.length === 0
            ? 'Belum ada rekening kas. Buat dulu lewat pemanggil yang punya izin.'
            : `${accounts.length} rekening tersedia.`,
      }
    },
  }

  const createAccount: ToolDefinition<{ name: string; openingBalance?: string | number }, unknown> = {
    name: 'finance_create_account',
    description:
      'Buat rekening kas baru (Kas tunai atau Bank) dengan saldo awal. WAJIB dipanggil lebih dulu sebelum mencatat mutasi atau menerima pembayaran, karena tanpa rekening tidak ada tempat mencatat uang. ' +
      'Jangan buat rekening kedua kalau organisasi sudah punya satu — cek dengan finance_list_accounts dulu.',
    inputSchema: z
      .object({
        name: z.string().max(80).describe('Nama rekening, diambil dari yang disebut pengguna. Contoh: "Kas Tunai", "Bank BCA".'),
        openingBalance: nominal
          .optional()
          .describe('Saldo awal dalam rupiah bulat. Default 0 kalau tidak disebut.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const opening = input.openingBalance === undefined ? 0 : parseAmount(input.openingBalance)

      // Satu rekening baru ketika yang lama masih dipakai bikin buku kas
      // bercabang dan tidak ada yang tahu mana yang benar. Kalau yang ada
      // masih kosong, buang saja supaya tidak menumpuk.
      const sudahAda = await finance.listAccounts(organizationId)
      const kosong = sudahAda.filter((account) => account.balance === 0)
      if (kosong.length > 0) {
        for (const account of kosong) {
          await finance.deleteEmptyAccount(account.id)
        }
      }

      const account = await finance.createAccount({
        organizationId,
        name: input.name,
        openingBalance: opening,
      })

      return {
        financeAccountId: account.id,
        name: account.name,
        balance: account.balance,
        balanceText: `Rp ${formatAmount(account.balance)}`,
        replacedEmptyAccounts: kosong.length,
        message: `Rekening "${account.name}" dibuat dengan saldo awal Rp ${formatAmount(opening)}.${kosong.length > 0 ? ` ${kosong.length} rekening kosong lama dibuang.` : ''}`,
      }
    },
  }

  const recordEntry: ToolDefinition<
    { type: 'income' | 'expense'; amount: string | number; description?: string; financeAccountId?: string },
    unknown
  > = {
    name: 'finance_record_entry',
    description:
      'Catat pemasukan atau pengeluaran kas. Gunakan `income` untuk uang masuk (iuran, donasi, pemasukan acara) dan `expense` untuk uang keluar (belanja, biaya acara). ' +
      'Pengeluaran yang melebihi saldo akan DITOLAK — jadi cek saldo lewat finance_list_accounts dulu kalau tidak yakin.',
    inputSchema: z.object({
      type: z
        .enum(['income', 'expense'])
        .describe('`income` untuk uang masuk, `expense` untuk uang keluar.'),
      amount: nominal,
      description: z.string().max(200).optional().describe('Keterangan mutasi, mis. "Iuran anggota Oktober".'),
      financeAccountId: z
        .string()
        .uuid()
        .optional()
        .describe('Rekening tujuan. WAJIB diisi kalau organisasi punya lebih dari satu rekening.'),
    }).strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const accounts = await finance.listAccounts(organizationId)
      const account = pilihRekening(accounts, input.financeAccountId, 'mencatat mutasi')

      const amount = parseAmount(input.amount)
      const hasil = await finance.recordEntry({
        accountId: account.id,
        organizationId,
        type: input.type,
        amount,
        ...(input.description ? { description: input.description } : {}),
        actorUserId: context.actorUserId,
      })

      return {
        entryId: hasil.entryId,
        financeAccountId: account.id,
        accountName: account.name,
        type: input.type,
        amount,
        amountText: `Rp ${formatAmount(amount)}`,
        balance: hasil.balance,
        balanceText: `Rp ${formatAmount(hasil.balance)}`,
        message: `${input.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} Rp ${formatAmount(amount)} tercatat di "${account.name}". Saldo sekarang Rp ${formatAmount(hasil.balance)}.`,
      }
    },
  }

  const createInvoice: ToolDefinition<
    {
      title: string
      items: Array<{ description: string; quantity: number | string; unitAmount: string | number }>
      memberName?: string
      dueAt?: string
      notes?: string
    },
    unknown
  > = {
    name: 'finance_create_invoice',
    description:
      'Buat tagihan beserta rinciannya. Total OTOMATIS dihitung dari rincian (jumlah x harga satuan) — jangan pernah menyebut total sendiri, dan jangan mengirim `totalAmount`. ' +
      'Kalau tagihan untuk satu anggota, isi `memberName` dengan namanya. Untuk iuran semua orang di satu kegiatan, buat tagihan tanpa anggota lalu catat pembayaran per orang.',
    inputSchema: z.object({
      title: z
        .string()
        .max(200)
        .describe('Judul tagihan, diambil dari yang disebut pengguna. WAJIB diisi.'),
      items: z
        .array(
          z.object({
            description: z.string().max(200).describe('Nama rincian, mis. "Formulir pendaftaran".'),
            quantity: z
              .union([z.number().int().positive(), z.string().max(20)])
              .describe('Jumlah item. Bilangan bulat positif.'),
            unitAmount: nominal.describe('Harga per item dalam rupiah bulat.'),
          }),
        )
        .min(1)
        .max(100)
        .describe('Rincian tagihan. Minimal satu. Total dihitung dari sini.'),
      memberName: z
        .string()
        .max(120)
        .optional()
        .describe('Nama anggota yang owes tagihan ini, persis seperti disebut pengguna.'),
      dueAt: z
        .string()
        .optional()
        .describe('Jatuh tempo format YYYY-MM-DD, dihitung di zona waktu organisasi.'),
      notes: z.string().max(1000).optional().describe('Catatan tambahan pada tagihan.'),
    }).strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      // Resolusi anggota dilakukan SEBELUM membuat tagihan. Tagihan yang
      // tertaut ke orang yang salah lebih sulit diperbaiki daripada pesan error.
      let memberId: string | null = null
      let memberName: string | null = null
      if (input.memberName) {
        const resolution = await identity.resolveMemberByName(organizationId, input.memberName)
        if (resolution.certainty !== 'unique') {
          throw new ToolError(
            'AMBIGUOUS_REFERENCE',
            resolution.certainty === 'none'
              ? `Anggota "${input.memberName}" tidak ditemukan. Jangan menebak nama — coba organization_search_members dulu.`
              : `"${input.memberName}" cocok dengan lebih dari satu anggota: ${resolution.candidates.map((c) => c.name).join(' / ')}. Tanya pengguna mana yang dimaksud.`,
          )
        }
        memberId = resolution.memberId
        memberName = resolution.memberName
      }

      const items = input.items.map((item) => ({
        description: item.description,
        quantity: typeof item.quantity === 'number' ? item.quantity : parseAmount(item.quantity),
        unitAmount: parseAmount(item.unitAmount),
      }))

      const invoice = await finance.createInvoice({
        organizationId,
        title: input.title,
        items,
        memberId,
        dueAt: input.dueAt ? new Date(`${input.dueAt}T00:00:00`) : null,
        notes: input.notes ?? null,
        actorUserId: context.actorUserId,
      })

      return {
        invoiceId: invoice.id,
        number: invoice.number,
        title: invoice.title,
        memberName,
        totalAmount: invoice.totalAmount,
        totalText: `Rp ${formatAmount(invoice.totalAmount)}`,
        itemCount: invoice.itemCount,
        message: `Tagihan ${invoice.number} "${invoice.title}" dibuat${memberName ? ` untuk ${memberName}` : ''}, total Rp ${formatAmount(invoice.totalAmount)}. Status: belum dibayar.`,
      }
    },
  }

  const listInvoices: ToolDefinition<
    { memberName?: string; limit?: number; status?: InvoiceStatus | 'all' },
    unknown
  > = {
    name: 'finance_list_invoices',
    description:
      'Tampilkan daftar tagihan beserta sisa pembayarannya. Pakai ini saat pengguna menanyakan "siapa yang belum bayar" atau "berapa tagihan yang outstanding".',
    inputSchema: z.object({
      memberName: z
        .string()
        .max(120)
        .optional()
        .describe('Saring hanya tagihan anggota ini. Nama panggilan boleh.'),
      status: z
        .enum(['unpaid', 'partial', 'paid', 'cancelled', 'overdue', 'all'])
        .optional()
        .describe('Saring status. Default semua.'),
      limit: z.number().int().positive().max(50).optional().describe('Jumlah maksimal. Default 20.'),
    }).strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      let memberId: string | undefined
      if (input.memberName) {
        const resolution = await identity.resolveMemberByName(organizationId, input.memberName)
        if (resolution.certainty !== 'unique') {
          throw new ToolError('NOT_FOUND', `Anggota "${input.memberName}" tidak ditemukan atau ambigu.`)
        }
        memberId = resolution.memberId
      }

      const invoices = await finance.listInvoices(organizationId, {
        ...(memberId ? { memberId } : {}),
        ...(input.status && input.status !== 'all' ? { status: input.status } : {}),
        limit: input.limit ?? 20,
      })

      const totalSisa = invoices.reduce((sum, invoice) => sum + invoice.remainingAmount, 0)

      return {
        invoices: invoices.map((invoice) => ({
          invoiceId: invoice.id,
          number: invoice.number,
          title: invoice.title,
          memberName: invoice.memberName,
          status: invoice.status,
          totalAmount: invoice.totalAmount,
          paidAmount: invoice.paidAmount,
          remainingAmount: invoice.remainingAmount,
          totalText: `Rp ${formatAmount(invoice.totalAmount)}`,
          remainingText: `Rp ${formatAmount(invoice.remainingAmount)}`,
          dueAt: invoice.dueAt,
        })),
        totalOutstanding: totalSisa,
        totalOutstandingText: `Rp ${formatAmount(totalSisa)}`,
        message: `${invoices.length} tagihan, total sisa Rp ${formatAmount(totalSisa)}.`,
      }
    },
  }

  const recordPayment: ToolDefinition<
    { invoiceId: string; amount: string | number; financeAccountId?: string; reference?: string },
    unknown
  > = {
    name: 'finance_record_payment',
    description:
      'Catat pembayaran tagihan. Pembayaran yang MELEBIHI sisa tagihan akan DITOLAK — kalau pengguna paying lebih, tanya dulu selisihnya, jangan langsung dicatat. ' +
      'Status tagihan berubah jadi `partial` (belum lunas) atau `paid` (lunas) otomatis. ' +
      'TIDAK boleh dipakai berdasarkan klaim chat saja: kalau sumber pembayarannya belum jelas, konfirmasi dulu ke pengguna.',
    inputSchema: z.object({
      invoiceId: z.string().uuid().describe('Id tagihan. Ambil dari finance_list_invoices.'),
      amount: nominal.describe('Nominal yang DIBAYAR, dalam rupiah bulat.'),
      financeAccountId: z
        .string()
        .uuid()
        .optional()
        .describe('Rekening kas tempat uang diterima. WAJIB diisi kalau organisasi punya lebih dari satu rekening.'),
      reference: z
        .string()
        .max(120)
        .optional()
        .describe('Bukti transfer atau catatan, mis. "Transfer BCA a.n. Budi".'),
    }).strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_UPDATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      // Baca tagihan lebih dulu supaya pesan penolakan menyebut nominal yang
      // benar, bukan sekadar "gagal".
      const invoice = await finance.getInvoice(organizationId, input.invoiceId)
      if (!invoice) {
        throw new ToolError('NOT_FOUND', 'Tagihan tidak ditemukan di organisasi ini.')
      }

      const amount = parseAmount(input.amount)

      // Rekening wajib saat menerima uang. Kalau organisasi punya satu saja,
      // pilih otomatis; kalau lebih dari satu, `pilihRekening` menolak supaya
      // uang tidak masuk ke rekening yang salah.
      const accounts = await finance.listAccounts(organizationId)
      const account = pilihRekening(accounts, input.financeAccountId, 'menerima pembayaran')

      const hasil = await finance.recordPayment({
        organizationId,
        invoiceId: input.invoiceId,
        amount,
        financeAccountId: account.id,
        reference: input.reference ?? null,
        actorUserId: context.actorUserId,
      })

      const lunas = hasil.invoiceStatus === 'paid'

      return {
        paymentId: hasil.paymentId,
        invoiceId: input.invoiceId,
        invoiceNumber: invoice.number,
        amount,
        amountText: `Rp ${formatAmount(amount)}`,
        invoiceStatus: hasil.invoiceStatus,
        paidAmount: hasil.paidAmount,
        remainingAmount: hasil.remainingAmount,
        remainingText: `Rp ${formatAmount(hasil.remainingAmount)}`,
        balance: hasil.balance,
        message: lunas
          ? `Pembayaran Rp ${formatAmount(amount)} tercatat. Tagihan ${invoice.number} LUNAS.`
          : `Pembayaran Rp ${formatAmount(amount)} tercatat. Sisa tagihan ${invoice.number}: Rp ${formatAmount(hasil.remainingAmount)}.`,
      }
    },
  }

  const recentEntries: ToolDefinition<{ financeAccountId?: string; limit?: number }, unknown> = {
    name: 'finance_recent_entries',
    description:
      'Tampilkan mutasi kas terbaru (pemasukan dan pengeluaran) supaya pengguna bisa cek riwayat buku kas.',
    inputSchema: z.object({
      financeAccountId: z.string().uuid().optional().describe('Saring satu rekening. Kosongkan untuk semua.'),
      limit: z.number().int().positive().max(50).optional().describe('Jumlah maksimal. Default 20.'),
    }).strict() as never,
    requiredPermissions: [PERMISSIONS.FINANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const entries = await finance.recentEntries(organizationId, {
        ...(input.financeAccountId ? { accountId: input.financeAccountId } : {}),
        limit: input.limit ?? 20,
      })

      return {
        entries: entries.map((entry) => ({
          type: entry.type,
          amount: entry.amount,
          amountText: `${entry.type === 'expense' ? '-' : '+'}Rp ${formatAmount(entry.amount)}`,
          description: entry.description,
          occurredAt: entry.occurredAt.toISOString().slice(0, 10),
        })),
        message: `${entries.length} mutasi terakhir.`,
      }
    },
  }

  // Setiap tool dibungkus supaya `FinanceError` dipetakan ke ToolError yang
  // bermakna. Tanpa ini semua penolakan jatuh ke INTERNAL_ERROR dan model
  // diberi jawaban generik yang tidak bisa ditindaklanjuti.
  type ToolApaSaja = ToolDefinition<never, unknown>
  const bungkus = (tool: ToolDefinition<never, unknown>): ToolApaSaja => ({
    ...tool,
    async execute(input, context) {
      try {
        return await tool.execute(input, context)
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw mapFinanceError(error)
      }
    },
  })

  const semua = [
    listAccounts,
    createAccount,
    recordEntry,
    createInvoice,
    listInvoices,
    recordPayment,
    recentEntries,
  ]
  return semua.map((tool) => bungkus(tool as unknown as ToolDefinition<never, unknown>)) as never
}

/**
 * Pilih rekening tujuan.
 *
 * Kalau organisasi punya satu rekening, itu dipilih otomatis. Kalau lebih dari
 * satu dan tidak disebut, tool menolak — supaya uang tidak masuk ke rekening
 * yang salah dan baru ketahuan saat rekonsiliasi.
 */
function pilihRekening(
  accounts: Array<{ id: string; name: string; balance: number }>,
  requestedId: string | undefined,
  aksi: string,
): { id: string; name: string; balance: number } {
  if (requestedId) {
    const found = accounts.find((account) => account.id === requestedId)
    if (!found) {
      throw new ToolError(
        'NOT_FOUND',
        `Rekening "${requestedId}" tidak ditemukan. Panggil finance_list_accounts untuk melihat id yang benar.`,
      )
    }
    return found
  }

  if (accounts.length === 0) {
    throw new ToolError('NOT_FOUND', `Belum ada rekening kas di organisasi ini, jadi ${aksi} belum bisa dilakukan.`)
  }

  if (accounts.length > 1) {
    throw new ToolError(
      'VALIDATION_FAILED',
      `Organisasi punya ${accounts.length} rekening (${accounts.map((a) => a.name).join(', ')}). Sebutkan rekening yang dipakai dengan financeAccountId — jangan menebak.`,
    )
  }

  return accounts[0]!
}

function requireOrg(context: ToolExecutionContext): string {
  const organizationId = context.organizationId
  if (!organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum terdeteksi untuk percakapan ini.')
  }
  return organizationId
}

/** Ubah FinanceError jadi ToolError dengan kode yang bisa ditindaklanjuti model. */
export function mapFinanceError(error: unknown): ToolError {
  if (error instanceof FinanceError) {
    switch (error.code) {
      case 'ACCOUNT_NOT_FOUND':
      case 'INVOICE_NOT_FOUND':
      case 'MEMBER_NOT_FOUND':
        return new ToolError('NOT_FOUND', error.message)
      case 'AMOUNT_INVALID':
      case 'AMOUNT_TOO_LARGE':
        return new ToolError('VALIDATION_FAILED', error.message)
      case 'INSUFFICIENT_BALANCE':
      case 'PAYMENT_EXCEEDS_INVOICE':
      case 'ALREADY_PAID':
        return new ToolError('CONFLICT', error.message)
    }
  }
  return new ToolError('INTERNAL_ERROR', 'Gagal memproses data keuangan.')
}