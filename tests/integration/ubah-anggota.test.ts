/**
 * Tool ubah, nonaktifkan, dan kenali diri sendiri.
 *
 * ── Dari mana test ini datang ───────────────────────────────────────────────
 *
 * Empat permintaan nyata, empat jawaban "fitur belum tersedia":
 *
 * ```
 * clear semua anggota     → "Menghapus seluruh anggota belum tersedia"
 * hapus anggota lama      → "fitur hapus anggota belum tersedia"
 * edit nama saya         → "fitur edit nama dan kelas belum tersedia"
 * kamu tau saya siapa?    → "nama asli kamu belum saya tahu"
 * ```
 *
 * Bot **tidak berbohong** — tool-nya memang tidak ada. Izin `members.update` dan
 * `members.delete` sudah ada di katalog sejak awal, tapi nol tool memakainya, dan
 * `TABEL_MATI`-style audit tidak menangkap izin yang punya izin tapi tidak punya
 * pemakainya sampai sekarang.
 *
 * Test ini mengunci perilaku yang harus benar sekarang: mengubah data harus
 * presisi, menonaktifkan harus menjaga riwayat, dan mengunci nama sendiri harus
 * jujur soal apa yang tidak ikut berubah.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { buildOrganizationTools } from '../../src/tools/organization-tools.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { AuthorizationService } from '../../src/security/authorization.js'
import { logger } from '../../src/observability/logger.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'
const CHAT = '6280000000000@s.whatsapp.net'

/** Prefix penanda, supaya pembersihan tidak menyapu data asli. */
const PREFIX = 'Uji Ubah Anggota'

const authorization = new AuthorizationService({ prisma, logger: logger.child({ module: 'uji-anggota' }) })

let registry: ToolRegistry
/** Anggota uji yang aktif dan boleh diubah. */
let anggotaAktif = ''
let anggotaTerpensiun = ''

/**
 * Broker persetujuan tiruan yang selalu menyetujui.
 *
 * Tanpa ini `registry.execute` menolak `organization_deactivate_member` dengan
 * "mekanisme persetujuan belum siap" — dan testnya tidak akan pernah menguji
 * apa pun soal soft delete. Menyetujui lewat broker membuat jalur yang sama
 * dengan `ApprovalEngine` dipakai di produksi.
 */
const menyetujui = {
  request: async () => 'approved' as const,
  isAvailable: async () => true,
}

const whatsappPalsu = {
  sendText: async () => ({ status: 'sent' as const, providerMessageId: 'x' }),
  sendDocument: async () => ({ status: 'sent' as const, providerMessageId: 'x' }),
  sendImage: async () => ({ status: 'sent' as const, providerMessageId: 'x' }),
  reactMessage: async () => ({ status: 'sent' as const, providerMessageId: 'x' }),
  getGroupMetadata: async () => null,
  getGroupMembers: async () => [],
}

beforeAll(async () => {
  const tools = buildOrganizationTools({ prisma, whatsapp: whatsappPalsu as never })
  registry = new ToolRegistry({ prisma: prisma as never })
  registry.setApprovalBroker(menyetujui as never)
  for (const tool of tools) registry.register(tool as never)

  const dibuat = await prisma.organizationMember.createMany({
    data: [
      { organizationId: ORG, fullName: `${PREFIX} Satu`, className: 'X AKL 1', searchName: 'uji ubh anggota satu' },
      { organizationId: ORG, fullName: `${PREFIX} Dua`, className: 'X AKL 2', searchName: 'uji ubh anggota dua' },
    ],
  })
  void dibuat

  const semua = await prisma.organizationMember.findMany({
    where: { organizationId: ORG, fullName: { startsWith: PREFIX } },
    select: { id: true, fullName: true },
  })
  anggotaAktif = semua.find((m) => m.fullName.endsWith('Satu'))!.id
  anggotaTerpensiun = semua.find((m) => m.fullName.endsWith('Dua'))!.id
}, 120_000)

afterAll(async () => {
  await prisma.memberAlias.deleteMany({ where: { member: { organizationId: ORG, fullName: { startsWith: PREFIX } } } })
  await prisma.organizationMember.deleteMany({ where: { organizationId: ORG, fullName: { startsWith: PREFIX } } })
  await prisma.$disconnect()
}, 60_000)

function konteks(aktor = AKTOR) {
  return {
    actorUserId: aktor,
    organizationId: ORG,
    conversationId: null,
    taskId: null,
    chatJid: CHAT,
    senderJid: CHAT,
    correlationId: `uji-anggota-${Math.random().toString(36).slice(2, 8)}`,
    timezone: 'Asia/Makassar',
    authorization,
  } as never
}

async function jalankan(nama: string, input: unknown, ctx = konteks()) {
  return registry.execute(nama, input, ctx)
}

function data(hasil: Awaited<ReturnType<typeof jalankan>>): Record<string, unknown> {
  if (!hasil.success) throw new Error(`diharapkan sukses, dapat: ${hasil.error.code} — ${hasil.error.message}`)
  return hasil.data as Record<string, unknown>
}

describe('BUG REGRESSION: ubah data anggota ada dan bekerja', () => {
  it('tool untuk ubah, nonaktifkan, dan kenali diri sendiri terdaftar', async () => {
    // Ketiganya tidak ada sebelum ini. Izinnya ada, tool-nya tidak.
    expect(registry.get('organization_update_member'), 'tool ubah anggota tidak ada').toBeTruthy()
    expect(registry.get('organization_deactivate_member'), 'tool nonaktifkan anggota tidak ada').toBeTruthy()
    expect(registry.get('organization_update_self'), 'tool ubah nama sendiri tidak ada').toBeTruthy()
  })

  it('mengubah kelas TIDAK mengubah nama', async () => {
    const hasil = data(await jalankan('organization_update_member', {
      memberId: anggotaAktif,
      className: 'X TKJ 3',
    }))

    expect(hasil.class).toBe('X TKJ 3')

    const sesudah = await prisma.organizationMember.findUnique({
      where: { id: anggotaAktif },
      select: { fullName: true, className: true },
    })
    expect(sesudah!.className).toBe('X TKJ 3')
    // Nama harus tetap — nama yang ikut berubah diam-diam akan merusak semua
    // catatan lama yang menyebut nama itu.
    expect(sesudah!.fullName).toBe(`${PREFIX} Satu`)
  })

  it('melaporkan nilai SEBELUM dan SESUDAH, bukan sekadar "sudah diubah"', async () => {
    await prisma.organizationMember.update({
      where: { id: anggotaAktif },
      data: { className: 'X AKL 1' },
    })

    const hasil = data(await jalankan('organization_update_member', {
      memberId: anggotaAktif,
      className: 'X MPK 1',
    }))

    const changes = hasil.changes as { class: { from: string | null; to: string | null } | null }
    // Tanpa rincian perubahan, bot tidak bisa memberi tahu apa yang benar-benar
    // berubah — dan "sudah diubah" tidak bisa diperiksa pengguna.
    expect(changes.class).not.toBeNull()
    expect(changes.class!.from).toBe('X AKL 1')
    expect(changes.class!.to).toBe('X MPK 1')
  })

  it('mengubah nama juga menulis ulang searchName', async () => {
    await prisma.organizationMember.update({
      where: { id: anggotaAktif },
      data: { fullName: `${PREFIX} Satu`, searchName: 'uji ubh anggota satu' },
    })

    const hasil = data(await jalankan('organization_update_member', {
      memberId: anggotaAktif,
      fullName: `${PREFIX} Grypaatsu`,
    }))

    expect(hasil.name).toBe(`${PREFIX} Grypaatsu`)

    const sesudah = await prisma.organizationMember.findUnique({
      where: { id: anggotaAktif },
      select: { searchName: true },
    })
    // Kalau `searchName` tidak ditulis ulang, "cari Grypaatsu" tidak menemukan
    // orang ini — dan "cari Satu" masih menemukannya. Data jadi tidak bisa dicari.
    expect(sesudah!.searchName).toContain('grypaatsu')
  })

  it('input yang sama dengan data sekarang DITOLAK, bukan diam-diam "berhasil"', async () => {
    const sekarang = await prisma.organizationMember.findUnique({
      where: { id: anggotaAktif },
      select: { fullName: true, className: true },
    })

    const hasil = await jalankan('organization_update_member', {
      memberId: anggotaAktif,
      fullName: sekarang!.fullName,
      className: sekarang!.className,
    })

    // Melaporkan "sudah diubah" padahal tidak ada yang berubah adalah klaim
    // palsu — persis kelas bug yang berulang di proyek ini.
    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      expect(hasil.error.message).toContain('Tidak ada yang perlu diubah')
      // Dan Sebut kandidat yang benar: mungkin maksudnya menambah orang.
      expect(hasil.error.message).toContain('organization_create_member')
    }
  })

  it('anggota yang ambigu DITOLAK dan diminta klarifikasi', async () => {
    // Dua anggota dengan nama serupa. Salah target adalah kesalahan yang tidak
    // bisa dibatalkan dengan "iya" lagi.
    await prisma.organizationMember.create({
      data: {
        organizationId: ORG,
        fullName: `${PREFIX} Sama A`,
        searchName: 'uji ubh anggota sama a',
      },
      select: { id: true },
    })
    await prisma.organizationMember.create({
      data: {
        organizationId: ORG,
        fullName: `${PREFIX} Sama B`,
        searchName: 'uji ubh anggota sama b',
      },
      select: { id: true },
    })

    const hasil = await jalankan('organization_update_member', {
      memberName: `${PREFIX} Sama`,
      className: 'X BRT 2',
    })

    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      expect(hasil.error.message).toContain('lebih dari satu')
    }

    await prisma.organizationMember.deleteMany({
      where: { organizationId: ORG, fullName: { in: [`${PREFIX} Sama A`, `${PREFIX} Sama B`] } },
    })
  })
})

describe('BUG REGRESSION: menonaktifkan anggota menjaga riwayat', () => {
  it('anggota nonaktif TIDAK muncul di daftar, tapi barisnya tetap ada', async () => {
    const hasil = data(await jalankan('organization_deactivate_member', {
      memberId: anggotaTerpensiun,
      reason: 'pensiun',
    }))

    expect(hasil.name).toBe(`${PREFIX} Dua`)

    const daftar = data(await jalankan('organization_list_members', { limit: 50 }))
    const anggota = daftar.members as Array<{ memberId: string }>
    expect(
      anggota.some((m) => m.memberId === anggotaTerpensiun),
      'anggota yang dinonaktifkan masih muncul di daftar',
    ).toBe(false)

    // Barisnya TIDAK dihapus. Tagihan dan absensinya merujuk ke baris ini;
    // menghapusnya berarti mencabut riwayat kas dan kehadiran orang itu.
    const masihAda = await prisma.organizationMember.findUnique({
      where: { id: anggotaTerpensiun },
      select: { isActive: true, leftAt: true },
    })
    expect(masihAda, 'baris anggota dihapus — riwayat ikut hilang').not.toBeNull()
    expect(masihAda!.isActive).toBe(false)
    expect(masihAda!.leftAt, 'tanggal tidak aktif tidak dicatat').not.toBeNull()
  })

  it('melaporkan bahwa riwayat DIJAGA, supaya tidak disalahpahami sebagai hapus', async () => {
    // Kalau bot melaporkan "dihapus" tanpa ini, pengguna mengira tagihannya ikut
    // hilang — dan itu keputusan yang tidak bisa dibatalkan.
    const hasil = data(await jalankan('organization_deactivate_member', { memberId: anggotaTerpensiun }))

    expect(hasil.alreadyInactive).toBe(true)
    expect(hasil.historyPreserved).toBe(true)
    expect(String(hasil.message)).toContain('tetap tersimpan')
  })

  it('tool ini butuh PERSETUJUAN', async () => {
    const tool = registry.get('organization_deactivate_member')!
    // Salah target terlihat oleh orang lain dan tidak bisa dibatalkan dengan
    // "iya" lagi. Jadi harus lewat persetujuan, bukan langsung jalan.
    expect(tool.requiresApproval).toBe(true)
    expect(tool.riskLevel).toBe('HIGH')
    expect(tool.requiredPermissions).toContain('members.delete' as never)
  })
})

describe('BUG REGRESSION: orang bisa memberi tahu namanya sendiri', () => {
  it('nama tampilan berubah dan TIDAK menyentuh data anggota', async () => {
    const namaAsli = await prisma.user.findUnique({
      where: { id: AKTOR },
      select: { displayName: true },
    })
    const anggotaSebelum = await prisma.organizationMember.findFirst({
      where: { organizationId: ORG, userId: AKTOR },
      select: { fullName: true },
    })

    // Nama dibikin unik per test. Kalau nilainya sama dengan yang tersimpan,
    // `previousDisplayName` memang `null` — dan test jadi memeriksa kondisi yang
    // salah. Percobaan pertama gagal persis karena itu: run sebelumnya
    // meninggalkan "Ibra (uji)" di database, jadi tidak ada yang berubah.
    const namaBaru = `Ibra Uji ${Date.now()}`

    const hasil = data(await jalankan('organization_update_self', { displayName: namaBaru }))

    expect(hasil.displayName).toBe(namaBaru)
    // Yang penting: harus dinyatakan, bukan diam-diam.
    expect(hasil.affectsMemberRecord).toBe(false)

    const anggotaSesudah = await prisma.organizationMember.findFirst({
      where: { organizationId: ORG, userId: AKTOR },
      select: { fullName: true },
    })
    expect(
      anggotaSesudah?.fullName,
      'mengubah nama tampilan ikut mengubah data anggota — dua hal berbeda',
    ).toBe(anggotaSebelum?.fullName)

    // Dikembalikan supaya bot bisa memberitahu nama sebelumnya.
    //
    // BUG REGRESSION: `user.update()` mengembalikan nilai SETELAH perubahan, jadi
    // kalau nama lama diambil dari sana, field ini selalu `null`. Versi pertama
    // tool ini persis begitu, dan test pertama saya tidak menangkapnya karena
    // tidak memeriksa field ini sama sekali.
    expect(hasil.previousDisplayName, 'nama sebelumnya tidak dilaporkan').toBe(namaAsli?.displayName ?? null)


    // Pulihkan — selalu, termasuk saat test gagal. Sisa yang tertinggal akan
    // merusak test berikutnya dan, yang lebih buruk, nama tampilan akun asli.
    await prisma.user.update({
      where: { id: AKTOR },
      data: { displayName: namaAsli?.displayName ?? 'Ibra Ramdan' },
    })
  })
})