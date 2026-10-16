/**
 * Koneksi data tool → model.
 *
 * ── Dari mana test ini datang ───────────────────────────────────────────────
 *
 * Audit kode, bukan pemeriksaan langsung. Empat tool mengembalikan data yang TIDAK LENGKAP:
 * ada di database, tapi tidak masuk ke keluaran tool. Akibatnya bot menjawab
 * **benar secara harfiah, salah secara faktual** — dan tidak ada yang gagal:
 * tidak ada error, tidak ada log, test tetap hijau.
 *
 * Polanya sama di keempatnya: bot melaporkan tepat apa yang tool berikan, dan
 * tool itu tidak memberi cukup. Bug seperti ini tidak bisa ketahuan dari sisi
 * user, karena user hanya melihat jawaban yang terdengar meyakinkan.
 *
 * 1. `finance_list_invoices` menawarkan saringan `overdue`, tapi `Invoice.status`
 *    tidak pernah bernilai `'overdue'`. Saringannya selalu kosong.
 * 2. `organization_list_members` tidak pernah mengembalikan nomor WhatsApp, jadi
 *    "kirim tagihan ke Budi" tidak bisa dijawab tanpa menebak.
 * 3. `payment_list` tidak mengembalikan nama anggota, padahal deskripsi tool-nya
 *    adalah "siapa yang belum bayar".
 * 4. `attendance_get` menulis `entryId: null`, padahal `attendance_update`
 *    memperlakukannya sebagai paling presisi.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { bootstrap } from '../../src/bootstrap.js'
import { prisma } from '../../src/database/client.js'

/**
 * Organisasi & aktor NYATA.
 *
 * UUID fiktif membuat pengujian RBAC gagal lebih dulu di lapisan izin, sebelum
 * sampai ke lapisan yang sedang diuji — test jadi lulus hampa.
 */
const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'
const CHAT = '6285792820173@s.whatsapp.net'

let app: Awaited<ReturnType<typeof bootstrap>>

/** Prefix penanda baris uji, supaya pembersihan tidak menyapu data asli. */
const PREFIX = 'KONEKSI-DATA'

/** Anggota yang sengaja ditautkan ke identitas terverifikasi. */
let anggotaTerverifikasi: { id: string; fullName: string } | null = null
let identitasUji: { id: string } | null = null
/** Tagihan yang menempel ke anggota — dipakai untuk menguji `payment_list`. */
let tagihanAnggotaId = ''
let pembayaranAnggotaOrderId = ''

beforeAll(async () => {
  app = await bootstrap()

  // ── Fixture: anggota dengan identitas TERVERIFIKASI ────────────────────────
  //
  // Tanpa ini, `organization_list_members` tidak punya satu pun baris
  // `whatsappVerified: true` di organisasi uji, dan testnya lulus hampa —
  // asserts apa pun soal nomor WhatsApp akan benar tanpa pernah mengujinya.
  const anggota = await prisma.organizationMember.findFirst({
    where: { organizationId: ORG, isActive: true },
    select: { id: true, fullName: true },
  })
  if (!anggota) throw new Error('organisasi uji tidak punya anggota aktif')

  const jidUji = `${PREFIX.replace(/-/g, '')}${Date.now()}@s.whatsapp.net`.toLowerCase()
  const identitas = await prisma.whatsAppIdentity.create({
    data: {
      pnJid: jidUji,
      phoneNumber: jidUji.split('@')[0],
      pushName: anggota.fullName,
      verifiedAt: new Date(),
      verificationMethod: 'UJI_KONEKSI_DATA',
    },
    select: { id: true },
  })
  await prisma.memberIdentityLink.create({
    data: {
      memberId: anggota.id,
      identityId: identitas.id,
      organizationId: ORG,
      verifiedAt: new Date(),
      method: 'UJI_KONEKSI_DATA',
    },
  })
  anggotaTerverifikasi = anggota
  identitasUji = identitas

  // ── Fixture: pembayaran yang tertaut ke anggota ────────────────────────────
  //
  // Sama alasannya: `payment_list` tanpa nama anggota tidak bisa dibedakan dari
  // yang benar kalau tidak ada baris yang namanya HARUS muncul.
  const tagihan = await buatTagihan({ judul: `${PREFIX} — tagihan anggota`, tempo: new Date() })
  await prisma.invoice.update({ where: { id: tagihan.id }, data: { memberId: anggota.id } })
  tagihanAnggotaId = tagihan.id

  pembayaranAnggotaOrderId = `${PREFIX}-ORDER-${Date.now()}`
  await prisma.payment.create({
    data: {
      organizationId: ORG,
      invoiceId: tagihan.id,
      provider: 'BATURPAY',
      providerReference: pembayaranAnggotaOrderId,
      amount: 25_000,
      status: 'PENDING',
      metadata: { qrisUrl: 'https://baturpay.test/v1/transactions/uji/qr' },
    },
  })
}, 120_000)

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { organizationId: ORG, providerReference: { startsWith: PREFIX } } })
  await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: PREFIX } } })
  if (identitasUji) {
    await prisma.memberIdentityLink.deleteMany({ where: { identityId: identitasUji.id } })
    await prisma.whatsAppIdentity.deleteMany({ where: { id: identitasUji.id } })
  }
  await prisma.invoiceItem.deleteMany({ where: { invoice: { organizationId: ORG, title: { startsWith: PREFIX } } } })
  await prisma.invoice.deleteMany({ where: { organizationId: ORG, title: { startsWith: PREFIX } } })

  const acaraUji = await prisma.attendanceEvent.findMany({
    where: { organizationId: ORG, title: { startsWith: PREFIX } },
    select: { id: true },
  })
  const idAcara = acaraUji.map((a) => a.id)
  if (idAcara.length > 0) {
    await prisma.attendanceEntry.deleteMany({ where: { attendanceEventId: { in: idAcara } } })
    await prisma.attendanceEvent.deleteMany({ where: { id: { in: idAcara } } })
  }

  await app.shutdown()
}, 120_000)

function konteks() {
  return {
    actorUserId: AKTOR,
    organizationId: ORG,
    conversationId: null,
    taskId: null,
    chatJid: CHAT,
    senderJid: CHAT,
    correlationId: `koneksi-${Math.random().toString(36).slice(2, 8)}`,
    timezone: 'Asia/Makassar',
    authorization: app.authorization,
  } as never
}

async function jalankan(nama: string, input: unknown) {
  return app.tools.execute(nama, input, konteks())
}

function data(hasil: Awaited<ReturnType<typeof jalankan>>): Record<string, unknown> {
  if (!hasil.success) throw new Error(`diharapkan sukses, dapat: ${hasil.error.code} — ${hasil.error.message}`)
  return hasil.data as Record<string, unknown>
}

async function buatTagihan(opts: { judul: string; tempo: Date | null; status?: string; nominal?: number }) {
  return prisma.invoice.create({
    data: {
      organizationId: ORG,
      number: `${PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: opts.judul,
      status: opts.status ?? 'unpaid',
      totalAmount: opts.nominal ?? 25_000,
      paidAmount: 0,
      dueAt: opts.tempo,
      items: {
        create: [{ description: 'Uji koneksi data', quantity: 1, unitAmount: opts.nominal ?? 25_000, amount: opts.nominal ?? 25_000 }],
      },
    },
    select: { id: true },
  })
}

describe('BUG REGRESSION: saringan `overdue` benar-benar menemukan tagihan lewat tenggat', () => {
  it('tagihan lewat tenggat TERASA oleh saringan overdue', async () => {
    const lewat = await buatTagihan({
      judul: `${PREFIX} — lewat tenggat`,
      tempo: new Date(Date.now() - 5 * 86_400_000),
    })
    const belumLewat = await buatTagihan({
      judul: `${PREFIX} — masih punya waktu`,
      tempo: new Date(Date.now() + 5 * 86_400_000),
    })

    const hasil = data(await jalankan('finance_list_invoices', { status: 'overdue', limit: 50 }))

    const ditemukan = (hasil.invoices as Array<{ invoiceId: string }>).map((t) => t.invoiceId)

    // INI inti bugnya: `Invoice.status` tidak pernah bernilai `'overdue'`, jadi
    // saringan lama mengirimnya sebagai `status` dan database mengembalikan nol
    // baris — padahal tagihannya ada dan memang lewat tenggat.
    expect(ditemukan, 'tagihan lewat tenggat tidak ditemukan oleh saringan overdue').toContain(lewat.id)

    // Dan yang BELUM lewat tenggat tidak boleh ikut terbawa.
    expect(ditemukan).not.toContain(belumLewat.id)
  }, 60_000)

  it('baris yang lewat tenggat melaporkan KEDUANYA: status nyata dan hitungan hari', async () => {
    await buatTagihan({ judul: `${PREFIX} — terlambat 3 hari`, tempo: new Date(Date.now() - 3 * 86_400_000) })

    const hasil = data(await jalankan('finance_list_invoices', { status: 'all', limit: 50 }))
    const baris = (hasil.invoices as Array<{
      title: string
      status: string
      statusTersimpan: string
      overdue: boolean
      terlamaHari: number | null
    }>).find((t) => t.title === `${PREFIX} — terlambat 3 hari`)

    expect(baris, 'tagihan uji tidak muncul di daftar').toBeTruthy()
    expect(baris!.status).toBe('overdue')
    expect(baris!.statusTersimpan, 'status di database harus ikut dilaporkan').toBe('unpaid')
    expect(baris!.overdue).toBe(true)
    expect(baris!.terlamaHari).toBeGreaterThanOrEqual(3)
  }, 60_000)

  it('tanpa tenggat BUKAN berarti "terlambat 0 hari"', async () => {
    await buatTagihan({ judul: `${PREFIX} — tanpa tenggat`, tempo: null })

    const hasil = data(await jalankan('finance_list_invoices', { status: 'all', limit: 50 }))
    const baris = (hasil.invoices as Array<{ title: string; terlamaHari: number | null; overdue: boolean }>).find(
      (t) => t.title === `${PREFIX} — tanpa tenggat`,
    )

    expect(baris, 'tagihan uji tidak muncul di daftar').toBeTruthy()
    // `null` berarti "tidak ada tenggat". `0` akan berarti "tepat waktu", dan
    // itu informasi yang salah.
    expect(baris!.terlamaHari).toBeNull()
    expect(baris!.overdue).toBe(false)
  }, 60_000)

  it('tagihan yang sudah lunas TIDAK dihitung lewat tenggat', async () => {
    // Kalimat "tunggakan 30 hari" untuk tagihan yang sudah dibayar adalah
    // kebohongan, dan koordinator inilah yang membuatnya.
    await buatTagihan({ judul: `${PREFIX} — lunas`, tempo: new Date(Date.now() - 30 * 86_400_000), status: 'paid' })

    const hasil = data(await jalankan('finance_list_invoices', { status: 'overdue', limit: 50 }))
    const judulLunas = (hasil.invoices as Array<{ title: string }>).map((t) => t.title)

    expect(judulLunas).not.toContain(`${PREFIX} — lunas`)
  }, 60_000)
})

describe('BUG REGRESSION: nomor WhatsApp anggota bisa dibaca model', () => {
  it('organization_list_members melaporkan nomor HANYA untuk yang terverifikasi', async () => {
    const hasil = data(await jalankan('organization_list_members', { limit: 50 }))
    const anggota = hasil.members as Array<{
      memberId: string
      name: string
      whatsappVerified: boolean
      whatsappJid: string | null
    }>

    expect(anggota.length).toBeGreaterThan(0)

    for (const orang of anggota) {
      // `whatsappVerified: true` tanpa JID = data yang saling bertentangan.
      if (orang.whatsappVerified) {
        expect(orang.whatsappJid, `${orang.name} ditandai terverifikasi tapi nomornya kosong`).toBeTruthy()
      } else {
        // `null` berarti "tidak tahu", bukan "tidak punya nomor". Kalau model
        // membaca `null` sebagai "belum punya", ia akan berjanji sesuatu yang tidak benar.
        expect(orang.whatsappJid).toBeNull()
      }
    }
  }, 60_000)

  it('BUG REGRESSION: anggota yang tertaut TERMUAT dan nomornya dikembalikan', async () => {
    // Tanpa baris ini, seluruh test di blok ini lulus hampa: di organisasi uji
    // tidak ada satu pun anggota yang punya tautan terverifikasi, jadi
    // `whatsappVerified` selalu `false` dan asserts apa pun soal nomor akan
    // benar tanpa pernah mengujinya.
    const hasil = data(await jalankan('organization_list_members', { limit: 50 }))
    const anggota = hasil.members as Array<{
      memberId: string
      name: string
      whatsappVerified: boolean
      whatsappJid: string | null
    }>

    const tertuang = anggota.find((a) => a.memberId === anggotaTerverifikasi!.id)
    expect(
      tertuang,
      `anggota uji "${anggotaTerverifikasi!.fullName}" tidak muncul di daftar`,
    ).toBeTruthy()
    expect(tertuang!.whatsappVerified).toBe(true)
    // Nomor harus benar-benar bisa dipakai — model butuh ini untuk menyebut
    // siapa yang belum bayar lewat `whatsapp_send_message`.
    expect(tertuang!.whatsappJid).toContain('@')
  }, 60_000)

  it('organization_search_members juga melaporkan status tertaut', async () => {
    const hasil = data(await jalankan('organization_search_members', { query: 'Budi' }))
    const anggota = hasil.members as Array<{ whatsappVerified: boolean; whatsappJid: string | null }> | undefined

    if (anggota && anggota.length > 0) {
      for (const orang of anggota) {
        if (orang.whatsappVerified) expect(orang.whatsappJid).toBeTruthy()
        else expect(orang.whatsappJid).toBeNull()
      }
    }
  }, 60_000)
})

describe('BUG REGRESSION: `payment_list` bisa menjawab "siapa yang belum bayar"', () => {
  it('BUG REGRESSION: nama anggota ikut dikembalikan', async () => {
    // Deskripsi tool ini adalah "siapa yang belum bayar". Tanpa nama, jawaban
    // yang keluar cuma "1 pembayaran menunggu" — dan itu tidak bisa dipakai
    // untuk menagih siapa pun.
    const hasil = data(await jalankan('payment_list', { status: 'PENDING', limit: 50 }))
    const baris = (hasil.payments as Array<{ orderId: string; memberName: string | null; qrisUrl: string }>).find(
      (p) => p.orderId === pembayaranAnggotaOrderId,
    )

    expect(baris, 'pembayaran uji tidak muncul di payment_list').toBeTruthy()
    expect(baris!.memberName, 'payment_list tidak mengembalikan nama anggota').toBe(anggotaTerverifikasi!.fullName)
    // Tiga hal harus bisa muncul sekaligus untuk satu baris — kalau salah satu
    // hilang, "tagih ke Budi, scan ini" tidak bisa dijawab.
    expect(baris!.qrisUrl, 'baris tanpa tautan QRIS tidak bisa dipakai menagih').toContain(
      encodeURIComponent(pembayaranAnggotaOrderId),
    )
  }, 60_000)

  it('jumlah dan nominal yang belum dibayar ikut dilaporkan', async () => {
    const hasil = data(await jalankan('payment_list', { status: 'PENDING', limit: 50 }))
    const baris = (hasil.payments as Array<{ orderId: string }>).find(
      (p) => p.orderId === pembayaranAnggotaOrderId,
    )

    expect(hasil.belumBayar, 'payment_list tidak melaporkan berapa yang belum dibayar').toBeGreaterThanOrEqual(1)
    expect(hasil.totalOutstandingText).toMatch(/^Rp /)
    expect(baris).toBeTruthy()
  }, 60_000)
})

describe('BUG REGRESSION: `attendance_get` mengembalikan ID entri asli', () => {
  it('setiap baris yang sudah tersimpan punya entryId yang bisa dipakai update', async () => {
    const acara = await prisma.attendanceEvent.create({
      data: {
        organizationId: ORG,
        title: `${PREFIX} — acara`,
        eventDate: new Date(),
      },
      select: { id: true },
    })

    const anggota = await prisma.organizationMember.findFirst({
      where: { organizationId: ORG, isActive: true },
      select: { id: true },
    })

    if (!anggota) {
      // Organisasi uji tanpa anggota: tidak ada yang bisa dibuktikan.
      return
    }

    const entri = await prisma.attendanceEntry.create({
      data: {
        attendanceEventId: acara.id,
        memberId: anggota.id,
        displayName: 'Anggota Uji Koneksi',
        status: 'PRESENT',
      },
      select: { id: true },
    })

    const hasil = data(await jalankan('attendance_get', { attendanceEventId: acara.id }))
    const baris = (hasil.entries as Array<{ entryId: string | null; memberId: string | null }>).find(
      (e) => e.memberId === anggota.id,
    )

    expect(baris, 'entri uji tidak muncul di attendance_get').toBeTruthy()

    // Versi pertama tool ini menulis `entryId: null` secara harfiah. Akibatnya
    // `attendance_update` — yang memperlakukan `entryId` sebagai paling presisi
    // — tidak pernah bisa dipakai, dan anggota yang punya lebih dari satu entri
    // (hadir lalu izin, misalnya) tidak bisa diperbaiki dengan tepat.
    expect(baris!.entryId, 'attendance_get menulis entryId null padahal ID-nya ada').toBe(entri.id)
  }, 60_000)
})