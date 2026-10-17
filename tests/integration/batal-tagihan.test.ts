/**
 * Pembatalan tagihan.
 *
 * ── Dari mana test ini datang ───────────────────────────────────────────────
 *
 * Permintaan nyata: *"batalkan itu"* — dijawab *"pembatalan tagihan belum
 * tersedia dari sini"*.
 *
 * Yang tersembunyi: `'cancelled'` **sudah ada** di `InvoiceStatus` sejak awal,
 * dan `listInvoices` **sudah punya** prioritas urutannya. Yang tidak ada adalah
 * satu pun tempat yang menulisnya.
 *
 * Pola yang sama seperti `overdue` yang dulu membuat "tagihan lewat tenggat
 * mana?" selalu dijawab nol baris: **nilai disiapkan, tidak pernah ditulis**.
 * Status yang tidak bisa dicapai adalah status yang tidak ada.
 *
 * Test ini mengunci tiga hal yang paling mudah salah di sini, semuanya uang:
 * membatalkan tagihan **tidak** menyentuh kas, tagihan **lunas** tidak bisa
 * dibatalkan, dan pembatalan bisa **dibatalkan** (tidak permanen).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { FinanceService } from '../../src/finance/service.js'
import { buildFinanceTools } from '../../src/tools/finance-tools.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { AuthorizationService } from '../../src/security/authorization.js'
import { logger } from '../../src/observability/logger.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'
const CHAT = '6280000000000@s.whatsapp.net'

const PREFIX = 'Uji Batal Tagihan'

const authorization = new AuthorizationService({ prisma, logger: logger.child({ module: 'uji-batal' }) })
const finance = new FinanceService(prisma)

let registry: ToolRegistry
const nomorUji: string[] = []
const idUji = new Map<string, string>()

/** Rekening kas supaya bisa menguji bahwa uang tidak bergerak. */
let akunId = ''

async function buatTagihan(judul: string, opts: { total: number; bayar?: number }): Promise<string> {
  const nomor = `${PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const tagihan = await prisma.invoice.create({
    data: {
      organizationId: ORG,
      number: nomor,
      title: judul,
      totalAmount: opts.total,
      paidAmount: opts.bayar ?? 0,
      status: opts.bayar && opts.bayar >= opts.total ? 'paid' : opts.bayar ? 'partial' : 'unpaid',
      items: {
        create: [{ description: 'Uji pembatalan', quantity: 1, unitAmount: opts.total, amount: opts.total }],
      },
    },
    select: { id: true },
  })
  nomorUji.push(nomor)
  idUji.set(nomor, tagihan.id)
  return tagihan.id
}

beforeAll(async () => {
  const tools = buildFinanceTools({ finance, identity: { resolveMemberByName: async () => ({ certainty: 'none' }) } as never })
  registry = new ToolRegistry({ prisma: prisma as never, logger: logger.child({ module: 'uji-batal' }) })
  // Menyetujui otomatis: supaya test menguji pembatalannya, bukan gerbangnya.
  registry.setApprovalBroker({ request: async () => 'approved' } as never)
  for (const tool of tools) registry.register(tool as never)

  akunId = (
    await prisma.financeAccount.create({
      data: { organizationId: ORG, name: `${PREFIX} — Kas`, balance: 500_000 },
      select: { id: true },
    })
  ).id
}, 120_000)

afterAll(async () => {
  const id = [...idUji.values()]
  await prisma.payment.deleteMany({ where: { invoiceId: { in: id } } })
  await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: id } } })
  await prisma.invoice.deleteMany({ where: { id: { in: id } } })
  await prisma.financeAccount.deleteMany({ where: { id: akunId } })
  await prisma.$disconnect()
}, 60_000)

function konteks() {
  return {
    actorUserId: AKTOR,
    organizationId: ORG,
    conversationId: null,
    taskId: null,
    chatJid: CHAT,
    senderJid: CHAT,
    correlationId: `uji-batal-${Math.random().toString(36).slice(2, 8)}`,
    timezone: 'Asia/Makassar',
    authorization,
  } as never
}

async function jalankan(nama: string, input: unknown) {
  return registry.execute(nama, input, konteks())
}

function data(hasil: Awaited<ReturnType<typeof jalankan>>): Record<string, unknown> {
  if (!hasil.success) throw new Error(`diharapkan sukses, dapat: ${hasil.error.code} — ${hasil.error.message}`)
  return hasil.data as Record<string, unknown>
}

describe('BUG REGRESSION: status cancelled akhirnya bisa ditulis', () => {
  it('tool pembatalan dan pemulihan terdaftar', async () => {
    expect(registry.get('finance_cancel_invoice')).toBeTruthy()
    expect(registry.get('finance_restore_invoice')).toBeTruthy()
  })

  it('membatalkan tagihan menulis status cancelled yang BENAR-BENAR bisa dibaca', async () => {
    const invoiceId = await buatTagihan(`${PREFIX} — batal`, { total: 50_000 })

    // SEBELUM: `listInvoices` dengan `status: 'cancelled'` selalu nol baris.
    const sebelum = data(await jalankan('finance_list_invoices', { status: 'cancelled', limit: 50 }))
    expect((sebelum.invoices as unknown[]).length, 'ada tagihan batal dari run sebelumnya').toBe(0)

    const hasil = data(await jalankan('finance_cancel_invoice', { invoiceId, reason: 'kegiatan dibatalkan' }))

    expect(hasil.cancelled).toBe(true)
    expect(hasil.previousStatus).toBe('unpaid')

    // Dan sekarang saringan itu benar-benar menemukan sesuatu.
    const sesudah = data(await jalankan('finance_list_invoices', { status: 'cancelled', limit: 50 }))
    const baris = (sesudah.invoices as Array<{ invoiceId: string }>).map((t) => t.invoiceId)
    expect(
      baris,
      'status cancelled ditulis tapi saringan tidak bisa membacanya — bug yang sama berulang',
    ).toContain(invoiceId)
  }, 60_000)

  it('alasan kosong DITOLAK', async () => {
    const invoiceId = await buatTagihan(`${PREFIX} — tanpa alasan`, { total: 10_000 })

    const hasil = await jalankan('finance_cancel_invoice', { invoiceId, reason: '' })
    expect(hasil.success).toBe(false)

    // Statusnya harus tetap utuh.
    const sesudah = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true },
    })
    expect(sesudah!.status).toBe('unpaid')
  }, 60_000)
})

describe('BUG REGRESSION: pembatalan tidak menyentuh uang', () => {
  it('saldo kas TIDAK bergerak saat tagihan dibatalkan', async () => {
    const sebelum = await prisma.financeAccount.findUnique({ where: { id: akunId }, select: { balance: true } })
    const invoiceId = await buatTagihan(`${PREFIX} — saldo`, { total: 75_000 })

    await jalankan('finance_cancel_invoice', { invoiceId, reason: 'uji saldo' })

    const sesudah = await prisma.financeAccount.findUnique({ where: { id: akunId }, select: { balance: true } })
    expect(
      sesudah!.balance,
      'pembatalan tagihan mengubah saldo kas — itu tidak boleh terjadi',
    ).toBe(sebelum!.balance)
  }, 60_000)

  it('pembayaran yang sudah masuk TETAP tercatat setelah pembatalan', async () => {
    const invoiceId = await buatTagihan(`${PREFIX} — sudah bayar sebagian`, { total: 100_000, bayar: 40_000 })

    const hasil = data(await jalankan('finance_cancel_invoice', { invoiceId, reason: 'uji parsial' }))

    // Kalau bot melaporkan "Rp 40.000 hilang", pengguna akan panik dan salah
    // melapor. Uang ada; yang ditutup hanya haknya untuk membayar.
    expect(hasil.moneyUnchanged).toBe(true)
    expect(hasil.paidAmount).toBe(40_000)

    const sesudah = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, paidAmount: true },
    })
    expect(sesudah!.status).toBe('cancelled')
    expect(sesudah!.paidAmount, 'pembayaran parsial hilang saat pembatalan').toBe(40_000)

    // Dan pesannya harus menyebutnya, supaya tidak disalahpahami.
    expect(String(hasil.message)).toContain('TIDAK hilang')
  }, 60_000)

  it('tagihan yang sudah LUNAS TIDAK bisa dibatalkan', async () => {
    const invoiceId = await buatTagihan(`${PREFIX} — lunas`, { total: 20_000, bayar: 20_000 })

    const hasil = await jalankan('finance_cancel_invoice', { invoiceId, reason: 'uji lunas' })

    // Membatalkan tagihan yang uangnya sudah masuk berarti uang hilang tanpa
    // jejak. Itu harus lewat koreksi kas, bukan pembatalan.
    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      expect(hasil.error.code).toBe('CONFLICT')
      expect(hasil.error.message).toContain('lunas')
      // Dan harus menawarkan jalan yang benar.
      expect(hasil.error.message).toContain('koreksi')
    }

    const sesudah = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } })
    expect(sesudah!.status).toBe('paid')
  }, 60_000)
})

describe('BUG REGRESSION: pembatalan tidak permanen', () => {
  it('salah batal bisa diperbaiki, dan statusnya dihitung dari data pembayaran', async () => {
    // Tanpa jalur keluar, satu pesan "batal" yang tidak sengaja menghapus
    // tagihan secara permanen — dan tidak ada jalan lain selain membuat tagihan
    // baru dengan nomor berbeda yang mengotori daftar.
    const invoiceId = await buatTagihan(`${PREFIX} — salah batal`, { total: 60_000, bayar: 20_000 })

    await jalankan('finance_cancel_invoice', { invoiceId, reason: 'salah ketik' })
    const hasil = data(await jalankan('finance_restore_invoice', { invoiceId }))

    // Dipulihkan ke `partial`, bukan `unpaid` — uang 20.000 sudah masuk.
    // Kalau dikembalikan ke `unpaid`, tagihan akan menampilkan "belum bayar"
    // padahal ada pembayaran.
    expect(hasil.restoredStatus).toBe('partial')

    const sesudah = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, paidAmount: true },
    })
    expect(sesudah!.status).toBe('partial')
    expect(sesudah!.paidAmount).toBe(20_000)
  }, 60_000)

  it('tagihan tanpa pembayaran dipulihkan ke unpaid', async () => {
    const invoiceId = await buatTagihan(`${PREFIX} — kosong`, { total: 30_000 })
    await jalankan('finance_cancel_invoice', { invoiceId, reason: 'uji kosong' })

    const hasil = data(await jalankan('finance_restore_invoice', { invoiceId }))
    expect(hasil.restoredStatus).toBe('unpaid')
  }, 60_000)

  it('tagihan yang TIDAK dibatalkan tidak bisa "dipulihkan"', async () => {
    const invoiceId = await buatTagihan(`${PREFIX} — normal`, { total: 15_000 })

    const hasil = await jalankan('finance_restore_invoice', { invoiceId })

    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      // Harus `CONFLICT`, bukan `VALIDATION_FAILED`.
      //
      // Bedanya penting bagi model: `VALIDATION_FAILED` berarti "perbaiki
      // argumenmu", yang tidak akan menolong sama sekali di sini.
      expect(hasil.error.code).toBe('CONFLICT')
    }
  }, 60_000)
})

describe('BUG REGRESSION: pembatalan butuh persetujuan dan alasan', () => {
  it('tool pembatalan risiko TINGGI dan butuh persetujuan', async () => {
    const tool = registry.get('finance_cancel_invoice')!
    // Membatalkan tagihan menutup hak orang untuk membayar, dan itu keliru
    // besar kalau terjadi karena salah baca.
    expect(tool.riskLevel).toBe('HIGH')
    expect(tool.requiresApproval).toBe(true)
    expect(tool.requiredPermissions).toContain('finance.create' as never)
  })

  it('skema menolak field yang tidak dikenal', async () => {
    // Tanpa `strict()`, `organizationId` bisa determination lewat argumen
    // — itu dilarang keras di aturan proyek.
    const hasil = await jalankan('finance_cancel_invoice', {
      invoiceId: '00000000-0000-4000-8000-000000000001',
      reason: 'uji',
      organizationId: '00000000-0000-4000-8000-0000000000ee',
    })
    expect(hasil.success).toBe(false)
  }, 60_000)
})