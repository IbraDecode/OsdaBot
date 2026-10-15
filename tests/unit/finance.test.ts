/**
 * Test layanan keuangan.
 *
 * Fokusnya bukan "uang bisa ditambahkan", tapi "uang yang TIDAK benar
 * DITOLAK". Kesalahan pembukuan halus dan mahal: saldo kas yang salah berarti
 * organisasi mengambil keputusan dengan angka palsu.
 */
import { describe, expect, it } from 'vitest'
import { FinanceError, parseAmount, formatAmount } from '../../src/finance/service.js'

describe('parseAmount', () => {
  it('membaca format rupiah yang biasa diketik orang', () => {
    expect(parseAmount('25000')).toBe(25000)
    expect(parseAmount('25.000')).toBe(25000)
    expect(parseAmount('25,000')).toBe(25000)
    expect(parseAmount('Rp 25.000')).toBe(25000)
    expect(parseAmount('  25000  ')).toBe(25000)
  })

  it('MENOLAK pecahan — bukan membulatkan', () => {
    // Membulatkan diam-diam menghasilkan selisih yang tidak pernah bisa
    // dilacak. Menolak memaksa orang menyelesaikan sendiri.
    for (const salah of ['25.5', '0,5', '1000.01', 25.5]) {
      expect(() => parseAmount(salah), String(salah)).toThrow(FinanceError)
    }
  })

  it('menolak pecahan dengan pesan yang menjelaskan kenapa', () => {
    // "Rp 12,500" ambigu: 12.500 atau 12,5? Menolak lebih aman daripada
    // menebak salah.
    expect(() => parseAmount('12.5')).toThrow(/pecahan|Rupiah/)
  })

  it('MENOLAK input yang tidak bisa dibaca', () => {
    for (const salah of ['', '   ', 'abc', '-', '.', 'Rp']) {
      expect(() => parseAmount(salah), JSON.stringify(salah)).toThrow(FinanceError)
    }
  })

  it('menolak angka yang tidak aman', () => {
    expect(() => parseAmount(Number.MAX_SAFE_INTEGER + 10)).toThrow(FinanceError)
  })

  it('menerima nol sebagai nilai yang valid (rekening kosong mulai dari 0)', () => {
    // Nol bukan error di lapisan ini; pemanggil yang memutuskan boleh atau
    // tidak. Yang penting integer.
    expect(parseAmount('0')).toBe(0)
  })

  it('menerima bilangan bulat sebagai angka', () => {
    expect(parseAmount(150000)).toBe(150000)
  })

  it('tidak(round) diam-diam untuk angka pecahan', () => {
    expect(() => parseAmount(1000.5)).toThrow(/bukan rupiah bulat/)
  })
})

describe('formatAmount', () => {
  it('memformat ribuan tanpa desimal', () => {
    // Output float akan memberi "25.000,00" — itu bukan format rupiah.
    expect(formatAmount(25000)).toBe('25.000')
    expect(formatAmount(1000000)).toBe('1.000.000')
  })

  it('tidak pernah menampilkan desimal', () => {
    for (const n of [1, 999, 25000, 1234567890]) {
      expect(formatAmount(n), String(n)).not.toContain(',00')
    }
  })

  it('format dan parse saling kebalikan', () => {
    for (const n of [1, 25000, 1000000, 123456789]) {
      expect(parseAmount(formatAmount(n)), String(n)).toBe(n)
    }
  })
})

describe('FinanceError', () => {
  it('memakai kode yang bisa dicabang di pemanggil', () => {
    // Kode yang tidak dikenal akan jatuh ke generik dan pesan aslinya hilang.
    const err = new FinanceError('INSUFFICIENT_BALANCE', 'Saldo tidak cukup')
    expect(err.code).toBe('INSUFFICIENT_BALANCE')
    expect(err.message).toBe('Saldo tidak cukup')
    expect(err).toBeInstanceOf(Error)
  })

  it('semua kode keuangan ada dan bermakna', () => {
    const kode = [
      'ACCOUNT_NOT_FOUND',
      'AMOUNT_INVALID',
      'AMOUNT_TOO_LARGE',
      'INSUFFICIENT_BALANCE',
      'INVOICE_NOT_FOUND',
      'PAYMENT_EXCEEDS_INVOICE',
      'ALREADY_PAID',
      'MEMBER_NOT_FOUND',
    ] as const

    for (const c of kode) {
      expect(new FinanceError(c, 'x').code).toBe(c)
    }
  })
})

// ── Aturan pembukuan (diuji lewat test double prisma) ──────────────────────

import type { PrismaClient } from '@prisma/client'
import { FinanceService } from '../../src/finance/service.js'

const ORG = '11111111-1111-1111-1111-111111111111'

type Akun = { id: string; name: string; balance: number; currency: string; organizationId: string }
type Mutasi = { id: string; financeAccountId: string; type: string; amount: number; description: string | null; occurredAt: Date }
type Tagihan = {
  id: string; organizationId: string; number: string; title: string
  totalAmount: number; paidAmount: number; status: string; memberId: string | null
}
type Pembayaran = { id: string; organizationId: string; invoiceId: string; amount: number; status: string }

/** Test double Prisma yang cukup untuk menguji aturan pembukuan. */
function buatDb(options: { balance?: number; invoice?: Partial<Tagihan> } = {}) {
  const state = {
    akun: [] as Akun[],
    mutasi: [] as Mutasi[],
    tagihan: [] as Tagihan[],
    pembayaran: [] as Pembayaran[],
    items: [] as Array<Record<string, unknown>>,
  }

  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txDb),
    financeAccount: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const akun: Akun = { id: `akun-${state.akun.length + 1}`, currency: 'IDR', ...data } as Akun
        state.akun.push(akun)
        return akun
      },
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        const a = state.akun.find((x) => !where.organizationId || x.organizationId === where.organizationId)
        return a ?? null
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const a = state.akun.find((x) => x.id === where.id)!
        if (data.balance?.increment !== undefined) a.balance += data.balance.increment
        return a
      },
      findMany: async ({ where }: { where: Record<string, any> }) =>
        state.akun.filter((a) => !where.organizationId || a.organizationId === where.organizationId),
    },
    cashbookEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const m: Mutasi = { id: `mut-${state.mutasi.length + 1}`, occurredAt: new Date(), description: null, ...data } as Mutasi
        state.mutasi.push(m)
        return m
      },
      findMany: async ({ where }: { where: Record<string, any> }) =>
        state.mutasi.filter((m) => !where.financeAccountId || m.financeAccountId === where.financeAccountId),
    },
    organizationMember: {
      findFirst: async () => ({ id: 'anggota-1' }),
    },
    invoice: {
      create: async ({ data }: { data: Record<string, any> }) => {
        const t: Tagihan = {
          id: `tag-${state.tagihan.length + 1}`, paidAmount: 0, status: 'unpaid', memberId: null,
          organizationId: ORG, number: 'INV/2026/001', title: 'x', totalAmount: 0, ...data,
        } as Tagihan
        state.tagihan.push(t)
        if (data.items) state.items.push(...(data.items.create ?? []))
        return { ...t, items: (data.items?.create ?? []).map((_: unknown, i: number) => ({ id: `it-${i}` })) }
      },
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        const t = state.tagihan.find((x) => !where.organizationId || x.organizationId === where.organizationId)
        return t ? { ...t, ...(options.invoice ?? {}) } : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const t = state.tagihan.find((x) => x.id === where.id)!
        Object.assign(t, data)
        return t
      },
    },
    payment: {
      create: async ({ data }: { data: Record<string, any> }) => {
        const p: Pembayaran = { id: `bayar-${state.pembayaran.length + 1}`, status: 'PENDING', ...data } as Pembayaran
        state.pembayaran.push(p)
        return p
      },
    },
  }

  const txDb = db
  return { db: db as unknown as PrismaClient, state }
}

describe('pembukuan kas', () => {
  async function akunDenganSaldo(saldo: number) {
    const { db, state } = buatDb()
    await state.akun.push({ id: 'akun-1', name: 'Kas', balance: saldo, currency: 'IDR', organizationId: ORG })
    return { service: new FinanceService(db), state }
  }

  it('menambah saldo saat pemasukan dicatat', async () => {
    const { service, state } = await akunDenganSaldo(0)

    const hasil = await service.recordEntry({
      accountId: 'akun-1', organizationId: ORG, type: 'income',
      amount: 500000, description: 'Iuran anggota', actorUserId: null,
    })

    expect(hasil.balance).toBe(500000)
    expect(state.mutasi).toHaveLength(1)
    expect(state.akun[0]!.balance).toBe(500000)
  })

  it('mengurangi saldo saat pengeluaran dicatat', async () => {
    const { service, state } = await akunDenganSaldo(500000)

    const hasil = await service.recordEntry({
      accountId: 'akun-1', organizationId: ORG, type: 'expense',
      amount: 150000, description: 'Beli spanduk', actorUserId: null,
    })

    expect(hasil.balance).toBe(350000)
    expect(state.akun[0]!.balance).toBe(350000)
  })

  it('BUG REGRESSION: Saldo kas TIDAK BOLEH minus', async () => {
    // Saldo negatif berarti pengeluaran tercatat tanpa uang yang ada. Buku
    // jadi salah dan tidak ada yang bisa memperbaikinya tanpa investigasi.
    const { service, state } = await akunDenganSaldo(100000)

    await expect(
      service.recordEntry({
        accountId: 'akun-1', organizationId: ORG, type: 'expense',
        amount: 150000, actorUserId: null,
      }),
    ).rejects.toThrow(/Saldo tidak cukup/)

    // Tidak ada mutasi yang tercatat — penolakan harus benar-benar membatalkan.
    expect(state.mutasi).toHaveLength(0)
    expect(state.akun[0]!.balance).toBe(100000)
  })

  it('menolak nominal nol dan negatif', async () => {
    const { service } = await akunDenganSaldo(100000)

    for (const amount of [0, -100]) {
      await expect(
        service.recordEntry({ accountId: 'akun-1', organizationId: ORG, type: 'income', amount, actorUserId: null }),
      ).rejects.toThrow()
    }
  })

  it('MENOLAK akun dari organisasi lain', async () => {
    // id dari luar organisasi tidak boleh dipakai — itu akses lintas data.
    const { service } = await akunDenganSaldo(100000)

    await expect(
      service.recordEntry({
        accountId: 'akun-1', organizationId: 'organisasi-lain', type: 'income',
        amount: 1000, actorUserId: null,
      }),
    ).rejects.toThrow(/tidak ditemukan/)
  })
})

describe('verifikasi saldo', () => {
  it('menghitung ulang saldo dari mutasi dan mencocokkan', async () => {
    const { db, state } = buatDb()
    state.akun.push({ id: 'akun-1', name: 'Kas', balance: 350000, currency: 'IDR', organizationId: ORG })
    state.mutasi.push(
      { id: 'm1', financeAccountId: 'akun-1', type: 'opening', amount: 500000, description: null, occurredAt: new Date() },
      { id: 'm2', financeAccountId: 'akun-1', type: 'expense', amount: 150000, description: null, occurredAt: new Date() },
    )

    const hasil = await new FinanceService(db).verifyBalance('akun-1')
    expect(hasil.computed).toBe(350000)
    expect(hasil.consistent).toBe(true)
  })

  it('MENDETEKSI saldo yang tidak cocok dengan mutasi', async () => {
    // Kalau hasil hitung ulang beda, ada bug. Saldo TIDAK boleh "diperbaiki"
    // dengan menyalin hasil hitung — itu menutupi penyebabnya.
    const { db, state } = buatDb()
    state.akun.push({ id: 'akun-1', name: 'Kas', balance: 999999, currency: 'IDR', organizationId: ORG })
    state.mutasi.push(
      { id: 'm1', financeAccountId: 'akun-1', type: 'opening', amount: 500000, description: null, occurredAt: new Date() },
    )

    const hasil = await new FinanceService(db).verifyBalance('akun-1')
    expect(hasil.consistent).toBe(false)
    expect(hasil.recorded).toBe(999999)
    expect(hasil.computed).toBe(500000)
  })
})

describe('tagihan', () => {
  it('menghitung total dari rincian, bukan dari input terpisah', async () => {
    // Kalau total diinput sendiri, rincian dan total bisa berbeda sejak awal.
    const { db, state } = buatDb()

    const invoice = await new FinanceService(db).createInvoice({
      organizationId: ORG,
      title: 'Iuran LKBB',
      items: [
        { description: 'Formulir', quantity: 6, unitAmount: 25000 },
        { description: 'Kain', quantity: 2, unitAmount: 150000 },
      ],
      actorUserId: null,
    })

    expect(invoice.totalAmount).toBe(6 * 25000 + 2 * 150000)
    expect(state.tagihan[0]!.totalAmount).toBe(450000)
    expect(state.items).toHaveLength(2)
  })

  it('MENOLAK tagihan tanpa rincian', async () => {
    const { db } = buatDb()

    await expect(
      new FinanceService(db).createInvoice({ organizationId: ORG, title: 'Kosong', items: [], actorUserId: null }),
    ).rejects.toThrow(/minimal satu rincian/)
  })

  it('MENOLAK total nol', async () => {
    const { db } = buatDb()

    await expect(
      new FinanceService(db).createInvoice({
        organizationId: ORG, title: 'Nol',
        items: [{ description: 'Gratis', quantity: 1, unitAmount: 0 }],
        actorUserId: null,
      }),
    ).rejects.toThrow(/lebih dari nol/)
  })

  it('menolak pecahan di rincian', async () => {
    const { db } = buatDb()

    await expect(
      new FinanceService(db).createInvoice({
        organizationId: ORG, title: 'Pecahan',
        items: [{ description: 'x', quantity: 1.5, unitAmount: 1000 }],
        actorUserId: null,
      }),
    ).rejects.toThrow(FinanceError)
  })

  it('menolak jumlah negatif', async () => {
    const { db } = buatDb()

    await expect(
      new FinanceService(db).createInvoice({
        organizationId: ORG, title: 'Minus',
        items: [{ description: 'x', quantity: -1, unitAmount: 1000 }],
        actorUserId: null,
      }),
    ).rejects.toThrow(FinanceError)
  })

  it('memberi nomor tagihan berurutan per tahun', async () => {
    const { db, state } = buatDb()
    const service = new FinanceService(db)
    const tahun = new Date().getFullYear()

    await service.createInvoice({ organizationId: ORG, title: 'A', items: [{ description: 'x', quantity: 1, unitAmount: 1000 }], actorUserId: null })
    const kedua = await service.createInvoice({ organizationId: ORG, title: 'B', items: [{ description: 'x', quantity: 1, unitAmount: 1000 }], actorUserId: null })

    expect(state.tagihan[0]!.number).toBe(`INV/${tahun}/001`)
    expect(kedua.number).toBe(`INV/${tahun}/002`)
  })
})

describe('pembayaran tagihan', () => {
  it('menghitung sisa dengan benar', async () => {
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    const hasil = await new FinanceService(db).recordPayment({
      organizationId: ORG, invoiceId: 'tag-1', amount: 40000, actorUserId: null,
    })

    expect(hasil.paidAmount).toBe(40000)
    expect(hasil.remainingAmount).toBe(60000)
    expect(hasil.invoiceStatus).toBe('partial')
    expect(state.pembayaran).toHaveLength(1)
  })

  it('menandai LUNAS saat pembayaran penuh', async () => {
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    const hasil = await new FinanceService(db).recordPayment({
      organizationId: ORG, invoiceId: 'tag-1', amount: 100000, actorUserId: null,
    })

    expect(hasil.invoiceStatus).toBe('paid')
    expect(hasil.remainingAmount).toBe(0)
  })

  it('BUG REGRESSION: MENOLAK pembayaran yang MELEBIHI sisa tagihan', async () => {
    // Membayar Rp 150.000 untuk tagihan Rp 100.000 berarti ada selisih yang
    // harus ditanyakan: salah transfer atau salah baca nominal.
    // Menerimanya berarti uang hilang tanpa jejak.
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    await expect(
      new FinanceService(db).recordPayment({
        organizationId: ORG, invoiceId: 'tag-1', amount: 150000, actorUserId: null,
      }),
    ).rejects.toThrow(/melebihi sisa/)

    // Penolakan harus benar-benar membatalkan: tidak ada pembayaran tercatat.
    expect(state.pembayaran).toHaveLength(0)
    expect(state.tagihan[0]!.paidAmount).toBe(0)
  })

  it('MENOLAK pembayaran kedua pada tagihan yang sudah lunas', async () => {
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 100000, status: 'paid', memberId: null,
    })

    await expect(
      new FinanceService(db).recordPayment({
        organizationId: ORG, invoiceId: 'tag-1', amount: 50000, actorUserId: null,
      }),
    ).rejects.toThrow(/sudah lunas/)
  })

  it('MENOLAK pembayaran ke tagihan yang sudah dibatalkan', async () => {
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'cancelled', memberId: null,
    })

    await expect(
      new FinanceService(db).recordPayment({
        organizationId: ORG, invoiceId: 'tag-1', amount: 10000, actorUserId: null,
      }),
    ).rejects.toThrow(/dibatalkan/)
  })

  it('MENOLAK tagihan dari organisasi lain', async () => {
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: 'org-lain', number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    await expect(
      new FinanceService(db).recordPayment({
        organizationId: ORG, invoiceId: 'tag-1', amount: 10000, actorUserId: null,
      }),
    ).rejects.toThrow(/tidak ditemukan/)
  })

  it('menolak nominal pembayaran yang tidak valid', async () => {
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    for (const amount of [0, -1000]) {
      await expect(
        new FinanceService(db).recordPayment({
          organizationId: ORG, invoiceId: 'tag-1', amount, actorUserId: null,
        }),
      ).rejects.toThrow(FinanceError)
    }
  })

  it('menambah saldo kas saat pembayaran dicatat ke rekening', async () => {
    const { db, state } = buatDb()
    state.akun.push({ id: 'akun-1', name: 'Kas', balance: 0, currency: 'IDR', organizationId: ORG })
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    const hasil = await new FinanceService(db).recordPayment({
      organizationId: ORG, invoiceId: 'tag-1', amount: 60000, financeAccountId: 'akun-1', actorUserId: null,
    })

    expect(hasil.balance).toBe(60000)
    // Mutasi kas DAN pembayaran harus tercatat bersamaan.
    expect(state.mutasi).toHaveLength(1)
    expect(state.pembayaran).toHaveLength(1)
    expect(state.tagihan[0]!.paidAmount).toBe(60000)
  })

  it('BUG REGRESSION: menerima pembayaran ke kas ber saldo tipis HARUS berhasil', async () => {
    // Versi sebelumnya menyalin cek "saldo tidak cukup" ke jalur penerimaan.
    // Akibatnya organisasi tidak bisa menerima dana pertama sama sekali —
    // kas mulai dari nol, jadi tidak akan pernah bisa menerima apa pun.
    const { db, state } = buatDb()
    state.akun.push({ id: 'akun-1', name: 'Kas', balance: 10000, currency: 'IDR', organizationId: ORG })
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    const hasil = await new FinanceService(db).recordPayment({
      organizationId: ORG, invoiceId: 'tag-1', amount: 60000,
      financeAccountId: 'akun-1', actorUserId: null,
    })

    expect(hasil.balance).toBe(70000)
    expect(hasil.paidAmount).toBe(60000)
    expect(state.akun[0]!.balance).toBe(70000)
  })

  it('menolak rekening kas yang tidak ada', async () => {
    const { db, state } = buatDb()
    state.tagihan.push({
      id: 'tag-1', organizationId: ORG, number: 'INV/2026/001', title: 'Iuran',
      totalAmount: 100000, paidAmount: 0, status: 'unpaid', memberId: null,
    })

    await expect(
      new FinanceService(db).recordPayment({
        organizationId: ORG, invoiceId: 'tag-1', amount: 10000,
        financeAccountId: 'tidak-ada', actorUserId: null,
      }),
    ).rejects.toThrow(/tidak ditemukan/)
  })
})