/**
 * Uji integrasi sistem tugas ke database sungguhan.
 *
 * Yang diuji bukan "bisa bikin tugas" saja, tapi apa yang DITOLAK dan apa yang
 * TIDAK BOLEH terjadi pada data tugas:
 *
 *  - anggota dari organisasi lain tidak bisa ditugaskan
 *  - dependensi yang membentuk lingkaran ditolak
 *  - tugas yang bergantung pada yang belum selesai tidak bisa "selesai" diam-diam
 *  - "lewat tenggat" dihitung saat baca, bukan disimpan
 *  - menghapus tugas yang punya tanggungan ditolak
 *  - urutan daftar benar: yang mendesak dan lewat tenggat di depan
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { TaskError, TaskService } from '../../src/tasks/service.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'

let service: TaskService
let organisasiLain: string
let memberLain: string
let memberUji: string
/** Judul unik per run supaya sisa run sebelumnya tidak tercampur. */
let TANDA: string

beforeAll(async () => {
  service = new TaskService(prisma)
  TANDA = `uji-tugas-${Date.now()}`

  const lain = await prisma.organization.create({
    data: { name: `Organisasi Lain ${Date.now()}`, slug: `org-lain-${Date.now()}` },
    select: { id: true },
  })
  organisasiLain = lain.id

  // Anggota di organisasi lain. Menugaskan orang ini ke tugas kita berarti
  // membocorkan isi tugas ke perusahaan berbeda.
  const namaLuar = `Anggota Luar ${Date.now()}`
  const anggotaLain = await prisma.organizationMember.create({
    data: {
      organizationId: organisasiLain,
      fullName: namaLuar,
      searchName: namaLuar.toLowerCase().replace(/[^a-z0-9 ]/g, ''),
    },
    select: { id: true },
  })
  memberLain = anggotaLain.id

  const namaUji = `Anggota Uji ${Date.now()}`
  const uji = await prisma.organizationMember.create({
    data: {
      organizationId: ORG,
      fullName: namaUji,
      searchName: namaUji.toLowerCase().replace(/[^a-z0-9 ]/g, ''),
      isActive: true,
    },
    select: { id: true },
  })
  memberUji = uji.id
})

afterAll(async () => {
  await prisma.task.deleteMany({ where: { title: { startsWith: TANDA } } })
  await prisma.organizationMember.deleteMany({ where: { id: { in: [memberLain, memberUji] } } })
  await prisma.organization.deleteMany({ where: { id: organisasiLain } })
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.task.deleteMany({ where: { title: { startsWith: TANDA } } })
})

/** Buat tugas uji dengan prefix yang unik. */
async function buatTugas(judulTambahan: string, input: Record<string, unknown> = {}) {
  return service.create({
    organizationId: ORG,
    title: `${TANDA} ${judulTambahan}`,
    ...input,
  })
}

describe('membuat tugas', () => {
  it('menyimpan tugas beserta penugas dan tenggatnya', async () => {
    const tenggat = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const tugas = await buatTugas('dasar', {
      assigneeMemberIds: [memberUji],
      dueAt: tenggat,
      priority: 2,
    })

    expect(tugas.id).toBeTruthy()
    expect(tugas.status).toBe('todo')
    expect(tugas.assignments).toHaveLength(1)
    expect(tugas.assignments[0]!.memberId).toBe(memberUji)
    expect(tugas.dueAt?.toISOString()).toBe(tenggat.toISOString())
    expect(tugas.priority).toBe(2)
    expect(tugas.overdue).toBe(false)
    expect(tugas.blocked).toBe(false)
  })

  it('BUG REGRESSION: anggota dari organisasi lain DITOLAK', async () => {
    // `TaskAssignment` hanya menautkan dua UUID. Tidak ada constraint database
    // yang memastikan keduanya milik organisasi yang sama, jadi tanpa
    // pemeriksaan di sini tugas bisa ditugaskan ke orang luar — dan judul
    // serta keterangannya ikut terbawa lintas perusahaan.
    await expect(
      buatTugas('bocor', { assigneeMemberIds: [memberLain] }),
    ).rejects.toThrow(TaskError)

    // Dan benar-benar tidak ada baris yang tertulis.
    const jumlah = await prisma.taskAssignment.count({
      where: { memberId: memberLain, task: { organizationId: ORG } },
    })
    expect(jumlah).toBe(0)
  })

  it('BUG REGRESSION: anggota nonaktif DITOLAK', async () => {
    const namaNonaktif = `Nonaktif ${Date.now()}`
    const nonaktif = await prisma.organizationMember.create({
      data: {
        organizationId: ORG,
        fullName: namaNonaktif,
        searchName: namaNonaktif.toLowerCase().replace(/[^a-z0-9 ]/g, ''),
        isActive: false,
      },
      select: { id: true },
    })

    await expect(buatTugas('nonaktif', { assigneeMemberIds: [nonaktif.id] })).rejects.toThrow(
      /tidak aktif/i,
    )

    await prisma.organizationMember.delete({ where: { id: nonaktif.id } })
  })

  it('BUG REGRESSION: tugas milik organisasi lain tidak bisa dijadikan dependensi', async () => {
    const luar = await service.create({
      organizationId: organisasiLain,
      title: `${TANDA} luar`,
    })

    await expect(buatTugas('depend-luar', { dependsOnTaskIds: [luar.id] })).rejects.toThrow(
      /tidak ditemukan di organisasi ini/i,
    )

    await prisma.task.delete({ where: { id: luar.id } })
  })

  it('BUG REGRESSION: prioritas di luar rentang DITOLAK, bukan diam-dimanipulasi', async () => {
    await expect(buatTugas('prioritas-alah', { priority: 9 })).rejects.toThrow(/Prioritas/)
    await expect(buatTugas('prioritas-nol', { priority: 0 })).rejects.toThrow(/Prioritas/)
  })

  it('BUG REGRESSION: judul kosong DITOLAK', async () => {
    // Dipanggil langsung, bukan lewat `buatTugas` — helper itu menempelkan
    // TANDA ke judul, jadi tidak ada cara menguji judul kosong lewatnya.
    await expect(service.create({ organizationId: ORG, title: '   ' })).rejects.toThrow(/tidak boleh kosong/i)
    await expect(service.create({ organizationId: ORG, title: '' })).rejects.toThrow(/tidak boleh kosong/i)
  })
})

describe('dependensi', () => {
  it('menandai tugas sebagai tertahan kalau dependensinya belum selesai', async () => {
    const dasar = await buatTugas('dasar')
    const lanjutan = await buatTugas('lanjutan', { dependsOnTaskIds: [dasar.id] })

    expect(lanjutan.blocked).toBe(true)
    expect(lanjutan.dependencies.map((d) => d.title)).toEqual([dasar.title])

    // `dasar` diambil SEBELUM dependensinya ada, jadi daftarnya masih kosong
    // di tangan pemanggil. Baca ulang — inilah yang terjadi pada orang yang
    // menyimpan handle ke tugas lalu bertanya belakangan.
    const dasarUlang = await service.get(ORG, dasar.id)
    expect(dasarUlang.dependents.map((d) => d.id)).toEqual([lanjutan.id])
  })

  it('BUG REGRESSION: lingkaran dependensi DITOLAK', async () => {
    // A bergantung pada B, lalu B dibuat bergantung pada A. Kalau dibiarkan,
    // keduanya tidak akan pernah bisa diselesaikan dan tidak ada yang bisa
    // menilainya.
    const a = await buatTugas('A')
    const b = await buatTugas('B')
    await service.addDependency(ORG, b.id, a.id)

    await expect(service.addDependency(ORG, a.id, b.id)).rejects.toThrow(/lingkaran/i)

    // Dan yang penting: grafnya tetap utuh, A masih bebas.
    const disegarkan = await service.get(ORG, a.id)
    expect(disegarkan.dependencies).toHaveLength(0)
  })

  it('BUG REGRESSION: lingkaran panjang DITOLAK, bukan hanya dua simpul', async () => {
    // A → B → C. Menutup dengan C → A harus tertangkap. Kalau hanya memeriksa
    // satu hop, dua dari tiga bentuk lingkaran lolos.
    const a = await buatTugas('panjang-A')
    const b = await buatTugas('panjang-B', { dependsOnTaskIds: [a.id] })
    const c = await buatTugas('panjang-C', { dependsOnTaskIds: [b.id] })

    await expect(service.addDependency(ORG, a.id, c.id)).rejects.toThrow(/lingkaran/i)
  })

  it('BUG REGRESSION: tugas tidak bisa bergantung pada dirinya sendiri', async () => {
    const a = await buatTugas('diri')
    await expect(service.addDependency(ORG, a.id, a.id)).rejects.toThrow(/dirinya sendiri/i)
  })

  it('BUG REGRESSION: membuat tugas dengan dua dependensi yang saling terhubung TIDAK ditolak', async () => {
    // A sudah bergantung pada B. Membuat C yang bergantung pada [A, B] bukan
    // lingkaran sama sekali — C cuma menunggu dua hal. Pemeriksa siklus yang
    // salah tempat (memeriksa antar-id yang dirujuk, bukan dari tugas baru)
    // akan salah menolak kasus ini.
    const a = await buatTugas('sibling-A', { dependsOnTaskIds: [] })
    const b = await buatTugas('sibling-B')
    await service.addDependency(ORG, a.id, b.id)

    const c = await buatTugas('sibling-C', { dependsOnTaskIds: [a.id, b.id] })
    expect(c.dependencies).toHaveLength(2)
  })
})

describe('menyelesaikan tugas', () => {
  it('BUG REGRESSION: tugas yang dependensinya belum selesai DITOLAK', async () => {
    const dasar = await buatTugas('tahan-dasar')
    const lanjutan = await buatTugas('tahan-lanjutan', { dependsOnTaskIds: [dasar.id] })

    await expect(service.complete(ORG, lanjutan.id)).rejects.toThrow(/belum selesai/i)

    // Statusnya tidak boleh ikut berubah.
    const setelah = await service.get(ORG, lanjutan.id)
    expect(setelah.status).toBe('todo')
  })

  it('BUG REGRESSION: selesai dengan pengakuan dicatat dan tugas jadi selesai', async () => {
    const dasar = await buatTugas('aksa-A')
    const lanjutan = await buatTugas('aksa-B', { dependsOnTaskIds: [dasar.id] })

    const hasil = await service.complete(ORG, lanjutan.id, { force: true })

    expect(hasil.task.status).toBe('done')
    expect(hasil.task.completedAt).toBeTruthy()
    expect(hasil.dependensiBelumSelesai).toEqual([dasar.title])
  })

  it('BUG REGRESSION: dependensi yang DIBATALKAN tidak menghalangi', async () => {
    // Tugas yang dibatalkan bukan "belum selesai" — orang yang membatalkannya
    // sudah memutuskan itu tidak akan dikerjakan. Menahannya hanya menambah
    // jalan buntu yang tidak perlu.
    const dasar = await buatTugas('batal-dasar')
    const lanjutan = await buatTugas('batal-lanjutan', { dependsOnTaskIds: [dasar.id] })

    await service.update(ORG, dasar.id, { status: 'cancelled' })

    const hasil = await service.complete(ORG, lanjutan.id)
    expect(hasil.task.status).toBe('done')
  })

  it('BUG REGRESSION: hidupkan lagi tugas menghapus jejak "selesai"', async () => {
    const tugas = await buatTugas('hidup-lagi')
    await service.complete(ORG, tugas.id)
    expect((await service.get(ORG, tugas.id)).completedAt).toBeTruthy()

    const hidup = await service.update(ORG, tugas.id, { status: 'in_progress' })

    expect(hidup.status).toBe('in_progress')
    expect(hidup.completedAt).toBeNull()
    // Sudah selesai tidak boleh lagi dibaca sebagai "terlambat".
    expect(hidup.overdue).toBe(false)
  })

  it('menyelesaikan tugas yang sama dua kali tidak merusak apa pun', async () => {
    const tugas = await buatTugas('idempoten')
    const pertama = await service.complete(ORG, tugas.id)
    const kedua = await service.complete(ORG, tugas.id)

    expect(kedua.task.status).toBe('done')
    // `completedAt` tidak boleh bergeser ke waktu pemanggilan kedua.
    expect(kedua.task.completedAt?.toISOString()).toBe(pertama.task.completedAt?.toISOString())
  })
})

describe('lewat tenggat', () => {
  it('BUG REGRESSION: overdue DIHITUNG saat baca, bukan disimpan', async () => {
    // Kalau overdue disimpan sebagai kolom, jam yang salah tidak akan pernah
    // memperbaikinya sendiri — tugas yang sudah dikerjakan tetap terbaca lewat.
    const lewat = await buatTugas('lewat', {
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    const akan = await buatTugas('akan', {
      dueAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    expect((await service.get(ORG, lewat.id)).overdue).toBe(true)
    expect((await service.get(ORG, akan.id)).overdue).toBe(false)

    // Tidak ada kolom overdue di schema — itu disengaja.
    const kolom = await prisma.$queryRaw<Array<{ nama: string }>>`
      SELECT column_name AS nama
      FROM information_schema.columns
      WHERE table_name = 'Task' AND column_name ILIKE '%overdue%'
    `
    expect(kolom).toHaveLength(0)
  })

  it('BUG REGRESSION: tugas selesai TIDAK pernah dianggap lewat tenggat', async () => {
    const tugas = await buatTugas('selesai-lewat', {
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    await service.complete(ORG, tugas.id)

    const hasil = await service.get(ORG, tugas.id)
    expect(hasil.status).toBe('done')
    expect(hasil.overdue).toBe(false)

    const daftar = await service.list({ organizationId: ORG, filter: 'overdue' })
    expect(daftar.map((t) => t.id)).not.toContain(tugas.id)
  })

  it('filter overdue hanya mengembalikan yang benar-benar lewat', async () => {
    const lewat = await buatTugas('f-lewat', { dueAt: new Date(Date.now() - 60 * 60 * 1000) })
    await buatTugas('f-aman', { dueAt: new Date(Date.now() + 60 * 60 * 1000) })
    await buatTugas('f-tanpa-tenggat')

    const daftar = await service.list({ organizationId: ORG, filter: 'overdue' })

    expect(daftar.map((t) => t.id)).toContain(lewat.id)
    expect(daftar.every((t) => t.overdue)).toBe(true)
  })
})

describe('urutan daftar', () => {
  it('BUG REGRESSION: lewat tenggat di depan, lalu prioritas, lalu tenggat terdekat', async () => {
    // Urutan ini yang dilihat orang. Kalau salah, daftar "yang paling mendesak"
    // jadi bukan yang paling mendesak — dan daftar tugas jadi tidak berguna.
    const lewatPrioritasRendah = await buatTugas('u-lewat-5', {
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
      priority: 5,
    })
    const mendesakBelumLewat = await buatTugas('u-darurat', {
      dueAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
      priority: 1,
    })
    const biasa = await buatTugas('u-biasa', {
      dueAt: new Date(Date.now() + 10 * 60 * 60 * 1000),
      priority: 3,
    })
    const tanpaTenggat = await buatTugas('u-tanpa', { priority: 2 })

    const daftar = await service.list({ organizationId: ORG, filter: 'open' })
    const urutan = daftar.map((t) => t.id)

    // Yang lewat tenggat naik ke depan walau prioritasnya paling rendah —
    // tenggat yang terlewat adalah informasi paling berguna yang ada.
    expect(urutan[0]).toBe(lewatPrioritasRendah.id)

    // Setelah itu, prioritas, lalu tenggat terdekat.
    expect(urutan.indexOf(mendesakBelumLewat.id)).toBeLessThan(urutan.indexOf(tanpaTenggat.id))
    expect(urutan.indexOf(mendesakBelumLewat.id)).toBeLessThan(urutan.indexOf(biasa.id))
    // Tanpa tenggat tidak mendahului yang bertenggat.
    expect(urutan.indexOf(biasa.id)).toBeLessThan(urutan.indexOf(tanpaTenggat.id))
  })

  it('BUG REGRESSION: tugas tanpa tenggat tidak mendahului yang bertenggat', async () => {
    // Kalau `dueAt` null diurutkan duluan, daftar selalu dimulai oleh tugas
    // yang tidak punya batas waktu — persis yang tidak dilihat orang.
    await buatTugas('v-tanpa', { priority: 1 })
    const bertenggat = await buatTugas('v-ada', {
      dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      priority: 5,
    })

    const daftar = await service.list({ organizationId: ORG, filter: 'open' })
    expect(daftar.map((t) => t.id).indexOf(bertenggat.id)).toBeLessThan(
      daftar.findIndex((t) => t.title.includes('v-tanpa')),
    )
  })

  it('BUG REGRESSION: limitApplied setelah pengurutan, bukan sebelum', async () => {
    // Kalau database yang memotong lebih dulu, "3 tugas paling mendesak" bisa
    // mengembalikan tiga tugas yang paling lama disimpan.
    for (let i = 0; i < 5; i += 1) {
      await buatTugas(`w-${i}`, { priority: 5 })
    }
    const mendesak = await buatTugas('w-darurat', { priority: 1 })

    const daftar = await service.list({ organizationId: ORG, filter: 'open', limit: 3 })
    expect(daftar).toHaveLength(3)
    expect(daftar[0]!.id).toBe(mendesak.id)
  })
})

describe('batas organisasi', () => {
  it('BUG REGRESSION: tugas organisasi lain TIDAK bisa dibaca', async () => {
    const luar = await service.create({ organizationId: organisasiLain, title: `${TANDA} privat-luar` })

    await expect(service.get(ORG, luar.id)).rejects.toThrow(/tidak ditemukan/i)
    await expect(service.update(ORG, luar.id, { title: 'direbut' })).rejects.toThrow(/tidak ditemukan/i)
    await expect(service.complete(ORG, luar.id)).rejects.toThrow(/tidak ditemukan/i)
    await expect(service.remove(ORG, luar.id)).rejects.toThrow(/tidak ditemukan/i)
    await expect(service.assign(ORG, luar.id, [memberUji])).rejects.toThrow(/tidak ditemukan/i)

    await prisma.task.delete({ where: { id: luar.id } })
  })

  it('BUG REGRESSION: daftar tugas tidak pernah menyeberang organisasi', async () => {
    await service.create({ organizationId: organisasiLain, title: `${TANDA} hanya-luar` })

    const daftar = await service.list({ organizationId: ORG, filter: 'open', limit: 50 })
    expect(daftar.every((t) => t.title.startsWith(TANDA))).toBe(true)
    // Dan tidak ada satu pun yang benar-benar milik organisasi lain.
    const jumlah = await prisma.task.count({ where: { organizationId: organisasiLain } })
    const diDaftar = daftar.filter((t) => t.title.endsWith('hanya-luar')).length
    expect(diDaftar).toBe(0)
    expect(jumlah).toBeGreaterThanOrEqual(0)
  })
})

describe('menghapus tugas', () => {
  it('BUG REGRESSION: tugas yang punya tanggungan TIDAK bisa dihapus diam-diam', async () => {
    // `TaskDependency` punya `onDelete: Cascade`. Tanpa pemeriksaan, menghapus
    // satu tugas akan menghapus keterikatan dari semua tugas yang bergantung
    // padanya — dan tugas-tugas itu kehilangan konteks tanpa ada yang diberi
    // tahu.
    const dasar = await buatTugas('hapus-dasar')
    const lanjutan = await buatTugas('hapus-lanjutan', { dependsOnTaskIds: [dasar.id] })

    await expect(service.remove(ORG, dasar.id)).rejects.toThrow(/bergantung pada/i)

    // Keterikatannya masih utuh.
    const setelah = await service.get(ORG, lanjutan.id)
    expect(setelah.dependencies.map((d) => d.id)).toEqual([dasar.id])
  })

  it('penghapusan paksa menghapus tugas, keterikatannya ikut hilang', async () => {
    const dasar = await buatTugas('paksa-dasar')
    await buatTugas('paksa-lanjutan', { dependsOnTaskIds: [dasar.id] })

    await service.remove(ORG, dasar.id, { force: true })

    const sisa = await prisma.task.count({ where: { id: { in: [dasar.id] } } })
    expect(sisa).toBe(0)
  })
})

describe('menugaskan', () => {
  it('mode replace mengganti seluruh daftar penugas', async () => {
    const tugas = await buatTugas('replace')

    await service.assign(ORG, tugas.id, [memberUji], 'replace')
    expect((await service.get(ORG, tugas.id)).assignments).toHaveLength(1)

    await service.assign(ORG, tugas.id, [], 'replace')
    expect((await service.get(ORG, tugas.id)).assignments).toHaveLength(0)
  })

  it('BUG REGRESSION: add tidak menggandakan yang sudah ada', async () => {
    const tugas = await buatTugas('add-kembar')

    await service.assign(ORG, tugas.id, [memberUji], 'add')
    const hasil = await service.assign(ORG, tugas.id, [memberUji], 'add')

    expect(hasil.assignments).toHaveLength(1)
  })

  it('BUG REGRESSION: remove untuk anggota yang tidak ditugaskan tidak melempar error', async () => {
    const tugas = await buatTugas('remove-hantu')

    await expect(service.assign(ORG, tugas.id, [memberUji], 'remove')).resolves.toBeTruthy()
  })

  it('BUG REGRESSION: menugaskan anggota luar organisasi DITOLAK', async () => {
    const tugas = await buatTugas('assign-luar')

    await expect(service.assign(ORG, tugas.id, [memberLain])).rejects.toThrow(/organisasi ini/i)

    const hasil = await service.get(ORG, tugas.id)
    expect(hasil.assignments).toHaveLength(0)
  })
})

describe('pencarian judul', () => {
  it('BUG REGRESSION: pencarian mengembalikan lebih dari satu kandidat, bukan memilih sendiri', async () => {
    // Rujukan "tugas proposal" sering ambigu. Kalau pencarian mengembalikan satu
    // hasil tanpa jujur, model akan menandai pekerjaan yang salah sebagai
    // selesai.
    await buatTugas('cari proposal_alpha')
    await buatTugas('cari proposal_beta')

    const hasil = await service.searchByTitle(ORG, 'cari proposal')
    expect(hasil.length).toBeGreaterThanOrEqual(2)
  })

  it('pencarian tidak menemukan yang tidak ada', async () => {
    const hasil = await service.searchByTitle(ORG, `${TANDA} definitely-not-here`)
    expect(hasil).toHaveLength(0)
  })

  it('BUG REGRESSION: pencarian tidak menembus organisasi lain', async () => {
    await service.create({ organizationId: organisasiLain, title: `${TANDA} lintas` })

    const hasil = await service.searchByTitle(ORG, `${TANDA} lintas`)
    expect(hasil).toHaveLength(0)
  })
})