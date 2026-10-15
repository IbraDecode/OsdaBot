/**
 * Test pengisian daftar hadir sekaligus.
 *
 * Masalah yang dipecahkan: menambah anggota lewat `attendance_add_member`
 * satu per satu butuh satu putaran agent per orang. Untuk organisasi dengan
 * puluhan anggota, agent kehabisan langkah di tengah jalan dan daftar tetap
 * kosong.
 *
 * Yang dijaga di sini:
 *  1. Tidak ada yang otomatis ditandai HADIR. Kehadiran adalah keputusan
 *     manusia; sistem tidak boleh mengarangnya.
 *  2. Nama ambigu tidak ditebak. Salah pilih berarti data kehadiran salah orang.
 *  3. Nama yang tidak ditemukan dilaporkan, bukan diabaikan diam-diam.
 */
import { describe, expect, it } from 'vitest'
import { AttendanceService, AttendanceError } from '../../src/attendance/service.js'

const ORG = '11111111-1111-1111-1111-111111111111'
const EVENT = '22222222-2222-2222-2222-222222222222'

type Member = { id: string; fullName: string; className: string | null; searchName: string }
type Alias = { alias: string; memberId: string }

function buatService(options: { members?: Member[]; aliases?: Alias[]; existing?: string[] } = {}) {
  const anggota: Member[] = options.members ?? [
    { id: 'm1', fullName: 'Budi Santoso', className: 'X AKL 1', searchName: 'budi santoso' },
    { id: 'm2', fullName: 'Siti Aminah', className: 'X AKL 1', searchName: 'siti aminah' },
    { id: 'm3', fullName: 'Andi Pratama', className: 'X AKL 2', searchName: 'andi pratama' },
  ]
  const sudahAda = options.existing ?? []
  const dibuat: Array<Record<string, unknown>> = []

  const prisma = {
    organizationMember: {
      findMany: async () => anggota,
    },
    memberAlias: {
      findMany: async () => options.aliases ?? [],
    },
    attendanceEntry: {
      findMany: async () => sudahAda.map((memberId) => ({ memberId })),
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        dibuat.push(...data)
        return { count: data.length }
      },
    },
  }

  const service = new AttendanceService({ prisma: prisma as never })
  return { service, dibuat, anggota }
}

describe('seedMembers', () => {
  it('menambahkan SEMUA anggota aktif', async () => {
    const { service, dibuat } = buatService()

    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: [],
      includeAll: true,
    })

    expect(hasil.added).toHaveLength(3)
    expect(dibuat).toHaveLength(3)
  })

  it('TIDAK PERNAH menandai siapa pun sebagai HADIR', async () => {
    // Ini yang paling penting. Menandai hadir otomatis berarti mengarang
    // kehadiran orang — dan daftar kehadiran adalah dokumen resmi.
    const { service, dibuat } = buatService()

    await service.seedMembers({ organizationId: ORG, attendanceEventId: EVENT, names: [], includeAll: true })

    for (const entry of dibuat) {
      expect(entry.status).toBe('UNCONFIRMED')
    }
  })

  it('menambahkan berdasarkan nama yang disebut', async () => {
    const { service, dibuat } = buatService()

    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: ['Budi Santoso', 'Siti Aminah'],
    })

    expect(hasil.added.map((m) => m.fullName)).toEqual(['Budi Santoso', 'Siti Aminah'])
    expect(dibuat).toHaveLength(2)
  })

  it('mengenali nama panggilan dan alias', async () => {
    // Di chat orang tidak sebut nama lengkap.
    const { service } = buatService({ aliases: [{ alias: 'budi', memberId: 'm1' }] })

    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: ['Budi'],
    })

    expect(hasil.added).toHaveLength(1)
    expect(hasil.added[0]!.fullName).toBe('Budi Santoso')
  })

  it('melaporkan nama yang tidak ditemukan', async () => {
    // Diam-diam tidak menambahkan orang lebih buruk daripada melaporkan.
    const { service, dibuat } = buatService()

    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: ['Budi Santoso', 'Orang Yang Tidak Ada'],
    })

    expect(hasil.added).toHaveLength(1)
    expect(hasil.notFound).toEqual(['orang yang tidak ada'])
    expect(dibuat).toHaveLength(1)
  })

  it('TIDAK menebak saat nama ambigu', async () => {
    // Dua anggota bernama sama di satu organisasi itu sah. Menebak berarti
    // data kehadiran salah orang.
    const { service, dibuat } = buatService({
      members: [
        { id: 'm1', fullName: 'Budi Santoso', className: 'X AKL 1', searchName: 'budi santoso' },
        { id: 'm2', fullName: 'Budi Santoso', className: 'X AKL 2', searchName: 'budi santoso' },
      ],
    })

    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: ['Budi Santoso'],
    })

    expect(hasil.added).toHaveLength(0)
    expect(hasil.ambiguous).toHaveLength(1)
    expect(hasil.ambiguous[0]).toContain('Budi Santoso')
    expect(dibuat).toHaveLength(0)
  })

  it('TIDAK menambahkan anggota yang sudah ada di daftar', async () => {
    const { service, dibuat } = buatService({ existing: ['m1'] })

    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: [],
      includeAll: true,
    })

    expect(hasil.added.map((m) => m.memberId)).toEqual(['m2', 'm3'])
    expect(dibuat).toHaveLength(2)
  })

  it('mengurutkan mengikuti daftar organisasi', async () => {
    // Urutan här yang disebut pengguna bisa acak; daftar harus rapi.
    const { service, dibuat } = buatService()

    await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: ['Siti Aminah', 'Budi Santoso'],
    })

    expect(dibuat.map((e) => e.displayName)).toEqual(['Budi Santoso', 'Siti Aminah'])
    expect(dibuat.map((e) => e.sortOrder)).toEqual([0, 1])
  })

  it('menyimpan nama dan kelas saat pengisian', async () => {
    // Kalau kosong, daftar yang dirender jadi tidak punya identitas.
    const { service, dibuat } = buatService()

    await service.seedMembers({ organizationId: ORG, attendanceEventId: EVENT, names: ['Budi Santoso'] })

    expect(dibuat[0]).toMatchObject({
      attendanceEventId: EVENT,
      memberId: 'm1',
      displayName: 'Budi Santoso',
      className: 'X AKL 1',
    })
  })

  it('mengembalikan total anggota aktif untuk konteks', async () => {
    const { service } = buatService()
    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: ['Budi Santoso'],
    })

    expect(hasil.totalActive).toBe(3)
  })

  it('tidak menambah apa pun kalau daftar sudah penuh', async () => {
    const { service, dibuat } = buatService({ existing: ['m1', 'm2', 'm3'] })

    const hasil = await service.seedMembers({
      organizationId: ORG,
      attendanceEventId: EVENT,
      names: [],
      includeAll: true,
    })

    expect(hasil.added).toHaveLength(0)
    expect(dibuat).toHaveLength(0)
  })
})

describe('AttendanceError', () => {
  it('memakai kode yang dikenali pemetaan error', () => {
    // Kode yang tidak dikenali akan jatuh ke INTERNAL_ERROR dan pesan aslinya
    // hilang — persis bug yang sudah pernah terjadi.
    const err = new AttendanceError('MEMBER_AMBIGUOUS', 'ambigu')
    expect(err.code).toBe('MEMBER_AMBIGUOUS')
    expect(err.message).toBe('ambigu')
  })
})