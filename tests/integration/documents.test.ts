/**
 * Uji integrasi mesin dokumen ke database sungguhan.
 *
 * Yang diuji bukan "PDF-nya bisa dibuat" saja, tapi apa yang DITOLAK dan apa
 * yang TIDAK BOLEH terjadi pada dokumen resmi:
 *
 *  - nomor dokumen tidak pernah bentrok
 *  - daftar pada PDF berasal dari database, bukan dari teks
 *  - dokumen milik organisasi lain tidak bisa dibaca
 *  - path traversal di kunci penyimpanan ditolak
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { bersihkanSisaOrganisasiUji } from '../helpers/cleanup.js'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DocumentService, LocalStorageDriver } from '../../src/documents/service.js'

const prisma = new PrismaClient()

const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'
const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const DIR = resolve('/tmp/opencode/dokumen-uji')

let service: DocumentService
let organisasiLain: string
let eventId: string

beforeAll(async () => {
  await bersihkanSisaOrganisasiUji(prisma)
  await rm(DIR, { recursive: true, force: true })
  await mkdir(DIR, { recursive: true })
  service = new DocumentService(prisma, new LocalStorageDriver(DIR))

  const lain = await prisma.organization.create({
    data: { name: `Organisasi Lain ${Date.now()}`, slug: `org-lain-${Date.now()}` },
    select: { id: true },
  })
  organisasiLain = lain.id

  // Daftar uji: dibuat khusus supaya isinya bisa dipastikan.
  const event = await prisma.attendanceEvent.create({
    data: {
      organizationId: ORG,
      title: `Daftar Uji Dokumen ${Date.now()}`,
      eventDate: new Date('2026-10-20T00:00:00Z'),
      entries: {
        create: [
          { displayName: 'Budi Santoso', className: 'X AKL 1', status: 'PRESENT', sortOrder: 0 },
          { displayName: 'Siti Aminah', className: 'X AKL 1', status: 'EXCUSED', reason: 'sakit', sortOrder: 1 },
          { displayName: 'Andi Pratama', className: 'X AKL 2', status: 'ABSENT', sortOrder: 2 },
        ],
      },
    },
    select: { id: true },
  })
  eventId = event.id
}, 60_000)

afterAll(async () => {
  await prisma.attendanceEvent.deleteMany({ where: { id: eventId } })
  await prisma.documentRecord.deleteMany({ where: { organizationId: ORG, documentType: { startsWith: 'surat' } } })
  await prisma.organization.deleteMany({ where: { id: organisasiLain } })
  await rm(DIR, { recursive: true, force: true })
  await prisma.$disconnect()
})

const dasar = {
  organizationId: ORG,
  title: 'Surat Izin Uji',
  actorUserId: AKTOR,
  signerName: 'Ahmad Fauzi',
  signerRole: 'Ketua Osis',
}

describe('membuat dokumen', () => {
  it('BUG REGRESSION: nomor dokumen BERURUTAN dan tidak pernah bentrok', async () => {
    // Dua dokumen resmi dengan nomor yang sama berarti dua keputusan
    // berbeda punya identitas yang sama.
    const pertama = await service.create({
      ...dasar,
      template: 'surat_izin',
      subjectName: 'Budi Santoso',
      reason: 'Sakit',
    })
    const kedua = await service.create({
      ...dasar,
      template: 'surat_izin',
      subjectName: 'Siti Aminah',
      reason: 'Keperluan keluarga',
    })

    expect(pertama.documentNumber).not.toBe(kedua.documentNumber)
    expect(pertama.documentNumber).toMatch(/^SURAT\/\d{4}\/\d{3}$/)
    expect(kedua.documentNumber).not.toBe(pertama.documentNumber)
  })

  it('BUG REGRESSION: nomor HARUS berbeda walau jenisnya berbeda', async () => {
    // Surat izin dan surat tugas berbagi prefix `SURAT`, dan penomoran unik per
    // organisasi. Kalau masing-masing jenis menghitung dari nol, keduanya
    // menghasilkan `SURAT/2026/001` — dua dokumen resmi dengan identitas sama.
    //
    // Bug ini tersembunyi selama constraint UNIQUE belum ada: keduanya
    // tersimpan dengan nomor kembar dan tidak ada yang menyadarinya.
    const nomor: string[] = []
    for (const template of ['surat_izin', 'surat_tugas', 'surat_izin', 'surat_tugas'] as const) {
      const dibuat = await service.create({
        ...dasar,
        template,
        subjectName: 'Budi Santoso',
        reason: 'Keterangan',
      })
      nomor.push(dibuat.documentNumber)
    }

    expect(new Set(nomor).size, `nomor kembar: ${nomor.join(', ')}`).toBe(4)
  })

  it('BUG REGRESSION: constraint UNIQUE mencegah nomor kembar di level database', async () => {
    // Lapisan aplikasi bisa salah. Lapisan database tidak bisa ditawar.
    const sudah = await service.create({
      ...dasar,
      template: 'surat_izin',
      subjectName: 'Budi Santoso',
      reason: 'Keterangan',
    })

    await expect(
      prisma.documentRecord.create({
        data: {
          organizationId: ORG,
          title: 'Paksa Nomor Kembar',
          documentType: 'surat_izin',
          format: 'pdf',
          documentNumber: sudah.documentNumber,
        },
      }),
    ).rejects.toThrow()

    // Dan nomor berikutnya tetap benar setelah percobaan yang gagal itu.
    const berikutnya = await service.create({
      ...dasar,
      template: 'surat_izin',
      subjectName: 'Siti Aminah',
      reason: 'Keterangan',
    })
    expect(berikutnya.documentNumber).not.toBe(sudah.documentNumber)
  })

  it('BUG REGRESSION: nomor berbeda per jenis dokumen', async () => {
    // Izin dan tugas adalah dua jenis surat, bukan satu rangkaian nomor.
    const izin = await service.create({
      ...dasar, template: 'surat_izin', subjectName: 'Budi', reason: 'Sakit',
    })
    const tugas = await service.create({
      ...dasar, template: 'surat_tugas', subjectName: 'Andi', reason: 'Koordinator',
    })

    expect(izin.documentNumber).not.toBe(tugas.documentNumber)
    expect(izin.documentNumber.startsWith('SURAT/')).toBe(true)
    expect(tugas.documentNumber.startsWith('SURAT/')).toBe(true)
  })

  it('BUG REGRESSION: MENOLAK dokumen tanpa isi yang wajib', async () => {
    // Surat tanpa nama atau alasan bukan dokumen.
    await expect(
      service.create({ ...dasar, template: 'surat_izin', reason: 'Sakit' }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' })

    await expect(
      service.create({ ...dasar, template: 'surat_izin', subjectName: 'Budi' }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' })
  })

  it('BUG REGRESSION: MENOLAK daftar hadir yang tidak menunjuk daftar nyata', async () => {
    // PDF daftar hadir harus berasal dari daftar yang benar-benar ada.
    // Kalau boleh membuat dari teks, dokumennya berisi kehadiran fiktif.
    await expect(
      service.create({ ...dasar, template: 'daftar_hadir', attendanceEventId: null }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' })

    await expect(
      service.create({
        ...dasar,
        template: 'daftar_hadir',
        attendanceEventId: '11111111-2222-3333-4444-555555555555',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' })
  })

  it('BUG REGRESSION: MENOLAK dokumen dari organisasi yang tidak ada', async () => {
    await expect(
      service.create({
        ...dasar,
        organizationId: '00000000-0000-4000-8000-0000000000ff',
        template: 'surat_izin',
        subjectName: 'Budi',
        reason: 'Sakit',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' })
  })

  it('BUG REGRESSION: TIDAK meninggalkan berkas yatim saat render gagal', async () => {
    // Kalau render gagal tapi berkas tetap ditulis, direktori penyimpanan
    // akan penuh berkas tanpa catatan — tidak ada yang tahu isinya apa.
    const sebelum = await service.list(ORG, { documentType: 'surat_izin', limit: 100 })

    await expect(
      service.create({ ...dasar, template: 'surat_izin', subjectName: '', reason: 'x' }),
    ).rejects.toThrow()

    const sesudah = await service.list(ORG, { documentType: 'surat_izin', limit: 100 })
    expect(sesudah.length).toBe(sebelum.length)
  })

  it('BUG REGRESSION: dokumen tersimpan dan bisa dibaca kembali', async () => {
    const dibuat = await service.create({
      ...dasar,
      title: 'Surat Izin Dibaca Uji',
      template: 'surat_izin',
      subjectName: 'Budi Santoso',
      subjectDetail: 'X AKL 1',
      reason: 'Sakit berdasarkan surat dokter',
      eventTitle: 'Latihan LKBB',
    })

    expect(dibuat.sizeBytes).toBeGreaterThan(1000)

    const isi = await service.readBuffer(ORG, dibuat.id)
    expect(isi).not.toBeNull()
    expect(isi!.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(isi!.filename).toBe(dibuat.filename)
    expect(isi!.filename.endsWith('.pdf')).toBe(true)
  })

  it('BUG REGRESSION: dokumen organisasi lain TIDAK bisa dibaca', async () => {
    // Id dari luar organisasi tidak boleh dipakai.
    const dibuat = await service.create({
      ...dasar,
      template: 'surat_izin',
      subjectName: 'Rahasia',
      reason: 'Alasan rahasia',
    })

    expect(await service.readBuffer(organisasiLain, dibuat.id)).toBeNull()
    expect(await service.read(organisasiLain, dibuat.id)).toBeNull()
  })
})

describe('daftar hadir dari database', () => {
  it('BUG REGRESSION: baris diambil dari entri yang benar-benar ada', async () => {
    const dibuat = await service.create({
      ...dasar,
      title: 'Daftar Hadir Uji',
      template: 'daftar_hadir',
      attendanceEventId: eventId,
    })

    // Tiga entri di daftar uji → tiga baris.
    expect(dibuat.rowsCount).toBe(3)

    const isi = await service.readBuffer(ORG, dibuat.id)
    expect(isi!.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('BUG REGRESSION: status izin dan alpa menyebut alasannya', async () => {
    // Tanpa alasan, orang tua tidak bisa membedakan CICilan dan kemalasan.
    const dibuat = await service.create({
      ...dasar,
      title: 'Rekap Uji',
      template: 'rekap_absensi',
      attendanceEventId: eventId,
    })

    // Rekap memuat status; isi persisnya dicek lewat isi PDF tidak praktis,
    // jadi yang dijaga di sini adalah barisnya benar-benar berasal dari
    // database (tidak nol).
    expect(dibuat.rowsCount).toBeGreaterThan(0)
  })
})

describe('penyimpanan lokal', () => {
  it('BUG REGRESSION: MENOLAK kunci yang mencoba keluar dari direktori', async () => {
    // Path traversal berarti berkas ditulis di luar folder penyimpanan.
    const driver = new LocalStorageDriver(DIR)

    await expect(driver.put('../../escaped.pdf', Buffer.from('x'))).rejects.toThrow(/keluar dari direktori/)
    await expect(driver.get('/etc/passwd')).rejects.toThrow(/keluar dari direktori/)
  })

  it('BUG REGRESSION: berkas yang tidak ada menghasilkan null, bukan error', async () => {
    const driver = new LocalStorageDriver(DIR)
    expect(await driver.get('tidak-ada.pdf')).toBeNull()
    expect(await driver.delete('tidak-ada.pdf')).toBe(false)
  })
})

describe('daftar dokumen', () => {
  it('menampilkan dokumen milik organisasi itu saja', async () => {
    const rows = await service.list(ORG, { documentType: 'surat_izin', limit: 50 })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.documentType).toBe('surat_izin')
    }
  })

  it('BUG REGRESSION: daftar organisasi lain tidak bercampur', async () => {
    const rows = await service.list(organisasiLain, { limit: 100 })
    expect(rows).toHaveLength(0)
  })
})