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

beforeAll(async () => {
  app = await bootstrap()
}, 120_000)

afterAll(async () => {
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