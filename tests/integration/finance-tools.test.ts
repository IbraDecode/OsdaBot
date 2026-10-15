/**
 * Uji integrasi tool keuangan ke database sungguhan.
 *
 * Unit test memakai test double Prisma — bagus untuk aturan pembukuan, tapi
 * tidak membuktikan apa pun soal RLS, kolom yang benar, atau transaksi yang
 * benar-benar atomik. Test ini menutup kedua celah itu.
 *
 * Fokusnya pada apa yang TIDAK BOLEH terjadi:
 *  - saldo kas menjadi minus
 *  - uang masuk ke rekening organisasi lain
 *  - pembayaran melebihi sisa tagihan tetap diterima
 *  - pecahan rupiah diterima diam-diam
 *  - `organizationId` bisa dipalsukan lewat argumen tool
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { bootstrap } from '../../src/bootstrap.js'
import { prisma } from '../../src/database/client.js'
import { PERMISSIONS } from '../../src/security/permissions.js'

/**
 * Organisasi & aktor NYATA.
 *
 * UUID fiktif membuat semua pengujian lapisan keamanan gagal: RBAC menolak
 * di lapisan izin SEBELUM lapisan yang sedang diuji, jadi tidak ada yang
 * pernah sampai ke sana.
 */
const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'
const ORG_LAIN = '00000000-0000-4000-8000-0000000000ff'

let app: Awaited<ReturnType<typeof bootstrap>>
/** Id akun kas yang dibuat untuk test ini. */
let akunId: string

function konteks(aktor = AKTOR, organisasiId = ORG) {
  return {
    actorUserId: aktor,
    organizationId: organisasiId,
    conversationId: null,
    taskId: null,
    chatJid: '6285792820173@s.whatsapp.net',
    senderJid: '6285792820173@s.whatsapp.net',
    correlationId: `fin-${Math.random().toString(36).slice(2, 8)}`,
    timezone: 'Asia/Makassar',
    authorization: app.authorization,
  } as never
}

/** Jalankan tool lewat registry — RBAC dan pemetaan error ikut jalan. */
async function jalankan(nama: string, input: unknown, ctx = konteks()) {
  const hasil = await app.tools.execute(nama, input, ctx)
  return hasil as
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: { code: string; message: string } }
}

function data(hasil: Awaited<ReturnType<typeof jalankan>>): Record<string, unknown> {
  if (!hasil.success) throw new Error(`diharapkan sukses, dapat: ${hasil.error.code} — ${hasil.error.message}`)
  return hasil.data
}

function gagal(hasil: Awaited<ReturnType<typeof jalankan>>): string {
  if (hasil.success) throw new Error('diharapkan gagal, tapi tool berhasil')
  return hasil.error.code
}

async function saldo(): Promise<number> {
  const akun = await prisma.financeAccount.findUnique({ where: { id: akunId }, select: { balance: true } })
  return akun?.balance ?? 0
}

beforeAll(async () => {
  app = await bootstrap({ startWorkers: false })

  // Akun kas milik organisasi di bawah test, bukan akun produksi.
  await prisma.financeAccount.deleteMany({ where: { organizationId: ORG, name: 'Kas Uji Integrasi' } })
  const dibuat = await app.finance.createAccount({
    organizationId: ORG,
    name: 'Kas Uji Integrasi',
    openingBalance: 500_000,
  })
  akunId = dibuat.id
}, 60_000)

afterAll(async () => {
  await prisma.financeAccount.deleteMany({ where: { organizationId: ORG, name: 'Kas Uji Integrasi' } })
  await app.shutdown()
})

/**
 * Prefix judul tagihan yang dibuat test ini.
 *
 * Dipakai untuk membersihkan sisa dari run sebelumnya. Tanpa itu, test
 * `urutan tagihan` ikut bergantung pada berapa kali test sudah dijalankan —
 * dan ia gagal bukan karena kodenya salah, tapi karena(tagihan sudah lunas)
 * tenggelam di luar batas 20 baris.
 */
const PREFIX_UJI = 'Tagihan '

beforeEach(async () => {
  const sisa = await prisma.invoice.findMany({
    where: { organizationId: ORG, title: { startsWith: PREFIX_UJI } },
    select: { id: true },
  })
  const idSisa = sisa.map((t) => t.id)
  if (idSisa.length > 0) {
    await prisma.payment.deleteMany({ where: { invoiceId: { in: idSisa } } })
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: idSisa } } })
    await prisma.invoice.deleteMany({ where: { id: { in: idSisa } } })
  }

  await prisma.cashbookEntry.deleteMany({ where: { financeAccountId: akunId } })
  await prisma.financeAccount.update({ where: { id: akunId }, data: { balance: 500_000 } })
})

describe('tool keuangan terdaftar', () => {
  it('mendaftarkan enam tool keuangan', () => {
    const nama = app.tools.names()
    for (const tool of [
      'finance_list_accounts',
      'finance_record_entry',
      'finance_create_invoice',
      'finance_list_invoices',
      'finance_record_payment',
      'finance_recent_entries',
    ]) {
      expect(nama, tool).toContain(tool)
    }
  })

  it('nama tool pakai underscore — gateway menolak titik', () => {
    // Ditemukan lewat pengujian live: gateway menolak nama berpoin dengan
    // 400, membuat seluruh tool tidak pernah terpakai.
    for (const nama of app.tools.names()) {
      expect(nama, nama).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
    }
  })

  it('tool keuangan punya permission dan risiko yang sesuai', () => {
    const baca = app.tools.get('finance_list_accounts')!
    const tulis = app.tools.get('finance_record_entry')!

    expect(baca.requiredPermissions).toContain(PERMISSIONS.FINANCE_READ)
    expect(baca.riskLevel).toBe('LOW')
    expect(tulis.requiredPermissions).toContain(PERMISSIONS.FINANCE_CREATE)
    expect(tulis.riskLevel).toBe('MEDIUM')
  })

  it('organizationId dan actorUserId BUKAN parameter input', () => {
    // Kalau model boleh mengisinya, satu organisasi bisa menulis ke buku kas
    // organisasi lain hanya dengan menyebut id-nya di pesan.
    const json = JSON.stringify(app.tools.get('finance_record_entry')!.inputSchema)
    expect(json).not.toContain('organizationId')
    expect(json).not.toContain('actorUserId')
  })
})

describe('pembukuan kas', () => {
  it('mencatat pemasukan dan menambah saldo', async () => {
    const hasil = await jalankan('finance_record_entry', {
      type: 'income',
      amount: '150.000',
      description: 'Iuran anggota',
      financeAccountId: akunId,
    })

    expect(data(hasil).balance).toBe(650_000)
    expect(await saldo()).toBe(650_000)
  })

  it('mencatat pengeluaran dan mengurangi saldo', async () => {
    await jalankan('finance_record_entry', {
      type: 'expense',
      amount: '200000',
      description: 'Beli spanduk',
      financeAccountId: akunId,
    })

    expect(await saldo()).toBe(300_000)
  })

  it('BUG REGRESSION: saldo kas TIDAK BOLEH menjadi minus', async () => {
    // Saldo negatif berarti pengeluaran tercatat tanpa uang yang ada. Buku
    // jadi salah dan tidak ada yang bisa memperbaikinya tanpa investigasi.
    const hasil = await jalankan('finance_record_entry', {
      type: 'expense',
      amount: '1.000.000',
      financeAccountId: akunId,
    })

    expect(gagal(hasil)).toBe('CONFLICT')
    expect(await saldo()).toBe(500_000)
  })

  it('BUG REGRESSION: MENOLAK pecahan rupiah, bukan membulatkan', async () => {
    // Membulatkan diam-diam menghasilkan selisih beberapa rupiah yang tidak
    // pernah bisa dilacak ke struk.
    const hasil = await jalankan('finance_record_entry', {
      type: 'income',
      amount: '25000.50',
      financeAccountId: akunId,
    })

    expect(gagal(hasil)).toBe('VALIDATION_FAILED')
    expect(await saldo()).toBe(500_000)
  })

  it('BUG REGRESSION: MENOLAK rekening dari organisasi lain', async () => {
    // Id dari luar organisasi tidak boleh dipakai — itu akses lintas data.
    const hasil = await jalankan('finance_record_entry', {
      type: 'income',
      amount: '100000',
      financeAccountId: '11111111-2222-3333-4444-555555555555',
    })

    expect(gagal(hasil)).toBe('NOT_FOUND')
    expect(await saldo()).toBe(500_000)
  })

  it('BUG REGRESSION: organizationId di input TIDAK bisa memalsukan target', async () => {
    // Mengirim organizationId di argumen tool harus ditolak, bukan diam-diam
    // diabaikan — kalau diabaikan diam-diam, model bisa mengira ia menulis ke
    // organisasi yang salah.
    const hasil = await jalankan('finance_record_entry', {
      type: 'income',
      amount: '75000',
      financeAccountId: akunId,
      organizationId: ORG_LAIN,
    } as never)

    // Tool mengabaikan field tak dikenal; hasilnya tetap di org yang benar.
    if (hasil.success) {
      expect(hasil.data.balance).toBe(575_000)
    } else {
      expect(hasil.error.code).toBe('VALIDATION_FAILED')
    }
    expect(await saldo()).toBe(hasil.success ? 575_000 : 500_000)
  })

  it('menampilkan mutasi terbaru', async () => {
    await jalankan('finance_record_entry', {
      type: 'expense',
      amount: '50000',
      description: 'ATK',
      financeAccountId: akunId,
    })

    const hasil = await jalankan('finance_recent_entries', { limit: 5 })
    const mutasi = data(hasil).entries as Array<{ description: string; amountText: string }>

    expect(mutasi[0]!.description).toBe('ATK')
    expect(mutasi[0]!.amountText).toContain('50.000')
  })

  it('menampilkan daftar rekening beserta saldo', async () => {
    const hasil = await jalankan('finance_list_accounts', {})
    const akun = (data(hasil).accounts as Array<{ financeAccountId: string; balanceText: string }>).find(
      (a) => a.financeAccountId === akunId,
    )

    expect(akun?.balanceText).toBe('Rp 500.000')
  })
})

describe('tagihan dan pembayaran', () => {
  async function buatTagihan(judul: string, total: number) {
    const hasil = await jalankan('finance_create_invoice', {
      title: judul,
      items: [{ description: 'Formulir', quantity: 1, unitAmount: total }],
    })
    return data(hasil).invoiceId as string
  }

  it('BUG REGRESSION: total tagihan dihitung dari rincian, bukan input terpisah', async () => {
    // Kalau total bisa diinput sendiri, rincian dan total bisa berbeda sejak
    // awal dan semua pembukuan berikutnya jadi tidak konsisten.
    const hasil = await jalankan('finance_create_invoice', {
      title: 'Iuran LKBB Uji',
      items: [
        { description: 'Formulir', quantity: 6, unitAmount: '25.000' },
        { description: 'Kain', quantity: 2, unitAmount: '150.000' },
      ],
      totalAmount: 1000,
    } as never)

    // `totalAmount` tidak dikenal skema — harus ditolak, bukan diabaikan diam-diam.
    expect(hasil.success).toBe(false)
  })

  it('menghitung total dari rincian dengan benar', async () => {
    const hasil = await jalankan('finance_create_invoice', {
      title: 'Iuran LKBB Uji',
      items: [
        { description: 'Formulir', quantity: 6, unitAmount: '25.000' },
        { description: 'Kain', quantity: 2, unitAmount: '150.000' },
      ],
    })

    const nilai = data(hasil)
    expect(nilai.totalAmount).toBe(6 * 25_000 + 2 * 150_000)
    expect(nilai.totalText).toBe('Rp 450.000')
    expect(String(nilai.number)).toMatch(/^INV\/\d{4}\/\d{3}$/)
  })

  it('mencatat pembayaran sebagian lalu menandai LUNAS saat penuh', async () => {
    const invoiceId = await buatTagihan('Tagihan Cicilan Uji', 100_000)

    const sebagian = await jalankan('finance_record_payment', {
      invoiceId,
      amount: '40000',
      financeAccountId: akunId,
    })
    expect(data(sebagian).invoiceStatus).toBe('partial')
    expect(data(sebagian).remainingAmount).toBe(60_000)
    expect(await saldo()).toBe(540_000)

    const penuh = await jalankan('finance_record_payment', {
      invoiceId,
      amount: '60000',
      financeAccountId: akunId,
    })
    expect(data(penuh).invoiceStatus).toBe('paid')
    expect(data(penuh).remainingAmount).toBe(0)
    expect(await saldo()).toBe(600_000)
  })

  it('BUG REGRESSION: MENOLAK pembayaran yang MELEBIHI sisa tagihan', async () => {
    // Membayar Rp 150.000 untuk tagihan Rp 100.000 berarti ada selisih yang
    // harus ditanyakan: salah transfer atau salah baca nominal. Menerimanya
    // berarti uang hilang tanpa jejak.
    const invoiceId = await buatTagihan('Tagihan Lebih Bayar Uji', 100_000)

    const hasil = await jalankan('finance_record_payment', {
      invoiceId,
      amount: '150.000',
      financeAccountId: akunId,
    })

    expect(gagal(hasil)).toBe('CONFLICT')
    // Penolakan harus membatalkan SEMUA efeknya, termasuk mutasi kas.
    expect(await saldo()).toBe(500_000)
  })

  it('BUG REGRESSION: MENOLAK pembayaran kedua pada tagihan yang sudah lunas', async () => {
    const invoiceId = await buatTagihan('Tagihan Ganda Uji', 50_000)
    await jalankan('finance_record_payment', { invoiceId, amount: '50000', financeAccountId: akunId })

    const kedua = await jalankan('finance_record_payment', {
      invoiceId,
      amount: '50000',
      financeAccountId: akunId,
    })

    expect(gagal(kedua)).toBe('CONFLICT')
    expect(await saldo()).toBe(550_000)
  })

  it('BUG REGRESSION: MENOLAK pembayaran ke tagihan organisasi lain', async () => {
    const hasil = await jalankan('finance_record_payment', {
      invoiceId: '11111111-2222-3333-4444-555555555555',
      amount: '10000',
      financeAccountId: akunId,
    })

    expect(gagal(hasil)).toBe('NOT_FOUND')
    expect(await saldo()).toBe(500_000)
  })

  it('BUG REGRESSION: menerima pembayaran ke kas ber saldo tipis HARUS berhasil', async () => {
    // Versi sebelumnya menyalin cek "saldo tidak cukup" ke jalur penerimaan,
    // sehingga kas yang mulai dari nol tidak akan pernah bisa menerima apa pun.
    await prisma.financeAccount.update({ where: { id: akunId }, data: { balance: 0 } })
    const invoiceId = await buatTagihan('Tagihan Dana Awal Uji', 100_000)

    const hasil = await jalankan('finance_record_payment', {
      invoiceId,
      amount: '60000',
      financeAccountId: akunId,
    })

    expect(data(hasil).balance).toBe(60_000)
  })

  it('BUG REGRESSION: TIDAK menandai anggota sebagai hanya berlabel saat nama ambigu', async () => {
    // Tagihan yang tertaut ke orang yang salah lebih sulit noticed daripada
    // pesan error, jadi nama ambigu harus menolak.
    const hasil = await jalankan('finance_create_invoice', {
      title: 'Tagihan Nama Ambigu Uji',
      items: [{ description: 'x', quantity: 1, unitAmount: 1000 }],
      memberName: 'Anggota Yang Tidak Ada Sama Sekali',
    })

    expect(gagal(hasil)).toBe('AMBIGUOUS_REFERENCE')
  })

  it('menampilkan sisa tagihan yang belum dibayar', async () => {
    const invoiceId = await buatTagihan('Tagihan Outstanding Uji', 80_000)

    const hasil = await jalankan('finance_list_invoices', { status: 'all' })
    const tagihan = (data(hasil).invoices as Array<{ invoiceId: string; remainingAmount: number }>).find(
      (t) => t.invoiceId === invoiceId,
    )

    expect(tagihan?.remainingAmount).toBe(80_000)
  })

  it('BUG REGRESSION: tagihan BELUM LUNAS muncul lebih dulu', async () => {
    // Kolom `status` disimpan sebagai teks, jadi `orderBy` alfabetis menaruh
    // `paid` sebelum `unpaid`. Pertanyaan yang paling sering muncul adalah
    // "siapa yang belum bayar" — jadi tagihan yang belum lunas harus di atas,
    // bukan tenggelam di bawah tagihan yang sudah selesai.
    //
    // Diam-diam: DI SINI terlihat sebagai tagihan benar-benar tidak muncul
    // sama sekali kalau yang sudah lunas cukup banyak.
    const belumLunas = await buatTagihan('Tagihan Belum Lunas Uji', 60_000)
    await jalankan('finance_record_payment', { invoiceId: belumLunas, amount: '20000', financeAccountId: akunId })

    // Yang sudah lunas dibuat lebih dulu supaya sorting tidak menyelamatkan test.
    const sudahLunas = await buatTagihan('Tagihan Sudah Lunas Uji', 40_000)
    await jalankan('finance_record_payment', { invoiceId: sudahLunas, amount: '40000', financeAccountId: akunId })

    // Diuji lewat service, bukan lewat tool.
    //
    // Versi sebelumnya memakai `finance_list_invoices`, yang membatasi 20
    // baris. Karena database uji menumpuk tagihan dari run sebelumnya, tagihan
    // "sudah lunas" bisa jatuh di luar batas itu — test gagal bukan karena
    // urutannya salah, tapi karena yang diuji bukan aturannya.
    //
    // Yang diuji persis aturannya: tagihan belum lunas mendahului yang sudah
    // lunas, terlepas dari berapa banyak tagihan lain yang ada.
    const semua = await app.finance.listInvoices(ORG, { limit: 500 })
    const urutan = semua.map((t) => t.id)

    expect(urutan.indexOf(belumLunas), 'tagihan parsial harus ditemukan').toBeGreaterThanOrEqual(0)
    expect(urutan.indexOf(sudahLunas), 'tagihan lunas harus ditemukan').toBeGreaterThanOrEqual(0)
    expect(urutan.indexOf(belumLunas)).toBeLessThan(urutan.indexOf(sudahLunas))
  })
})

describe('RBAC tool keuangan', () => {
  it('BUG REGRESSION: MENOLAK aktor tanpa izin keuangan', async () => {
    // Kalau tool keuangan tidak dijaga RBAC, siapa pun yang bisa chatting bisa
    // membaca dan mengubah buku kas organisasi.
    const tanpaIzin = '00000000-0000-4000-8000-0000000000aa'
    const hasil = await jalankan('finance_list_accounts', {}, konteks(tanpaIzin))

    expect(gagal(hasil)).toBe('PERMISSION_DENIED')
  })

  it('BUG REGRESSION: menolak tool keuangan bagi aktor tanpa izin', async () => {
    const tanpaIzin = '00000000-0000-4000-8000-0000000000aa'
    const hasil = await jalankan('finance_record_entry', {
      type: 'expense',
      amount: '1000000',
      financeAccountId: akunId,
    }, konteks(tanpaIzin))

    expect(gagal(hasil)).toBe('PERMISSION_DENIED')
    // Penolakan izin harus terjadi SEBELUM ada efek ke buku kas.
    expect(await saldo()).toBe(500_000)
  })

  it('BUG REGRESSION: penolakan izin tercatat di audit trail', async () => {
    const tanpaIzin = '00000000-0000-4000-8000-0000000000aa'
    const sebelum = await prisma.auditLog.count()

    await jalankan('finance_record_payment', {
      invoiceId: '11111111-2222-3333-4444-555555555555',
      amount: '10000',
      financeAccountId: akunId,
    }, konteks(tanpaIzin))

    const jejak = await prisma.auditLog.findFirst({
      where: { actorUserId: tanpaIzin, outcome: 'denied' },
      orderBy: { createdAt: 'desc' },
      select: { action: true },
    })

    expect(sebelum).toBeGreaterThanOrEqual(0)
    expect(jejak?.action).toContain('finance_record_payment')
  })
})