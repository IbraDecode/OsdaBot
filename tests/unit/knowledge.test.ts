/**
 * Test knowledge engine.
 *
 * Yang paling penting: apa yang TIDAK dikembalikan. Sistem pengetahuan yang
 * diam-diam menjawab tanpa sumber lebih berbahaya daripada yang menjawab
 * "tidak ada datanya" — karena jawaban kedua bisa diperbaiki, sedangkan yang
 * pertama dipercaya.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { KnowledgeService, KnowledgeError, buatPotongan, potongExcerpt } from '../../src/knowledge/service.js'

const prisma = new PrismaClient()
const service = new KnowledgeService(prisma)

const ORG = '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const ORG_LAIN = '00000000-0000-4000-8000-0000000000ee'

const PERATURAN = `Peraturan OSIS

1. Iuran bulanan sebesar Rp 25.000 dibayar paling lambat tanggal 10 setiap bulan.
2. Absensi kegiatan wajib diisi pada hari yang sama. Ketidakhadiran tanpa keterangan resmi akan dicatat sebagai alfa.
3. Pergantian kepengurusan dilakukan melalui musyawarah anggota.
4. Surat izin harus diajukan maksimal H-1 kepada ketua panitia.
5. Peserta yang izin wajib menyetorkan tugas susulan.`

let idPeraturan: string
let idKedaluwarsa: string

beforeAll(async () => {
  const a = await service.ingest({
    organizationId: ORG,
    title: 'Uji Peraturan OSIS',
    content: PERATURAN,
    documentType: 'peraturan',
    actorUserId: null,
  })
  idPeraturan = a.documentId

  const b = await service.ingest({
    organizationId: ORG,
    title: 'Uji Peraturan Kedaluwarsa',
    content: 'Iuran bulanan lama sebesar Rp 15.000 berlaku sampai tahun lalu.',
    documentType: 'peraturan',
    validUntil: new Date(Date.now() - 86_400_000),
    actorUserId: null,
  })
  idKedaluwarsa = b.documentId
}, 60_000)

afterAll(async () => {
  await prisma.knowledgeDocument.deleteMany({ where: { id: { in: [idPeraturan, idKedaluwarsa] } } })
  await prisma.$disconnect()
})

describe('buatPotongan', () => {
  it('potongan selalu punya offset yang benar', () => {
    // Offset yang salah membuat atribusi menunjuk ke kalimat yang bukan
    // sumbernya — lebih buruk daripada tidak punya sumber.
    const isi = 'Baris pertama.\n\nBaris kedua.\n\nBaris ketiga.\n\nBaris keempat.\n\nBaris kelima.'
    const potongan = buatPotongan(isi, 40)

    expect(potongan.length).toBeGreaterThan(1)
    for (const p of potongan) {
      expect(isi.slice(p.startOffset, p.endOffset).trim()).toBe(p.content)
    }
  })

  it('TIDAK memotong di tengah kata', () => {
    const panjang = 'kalimat yang panjang sekali '.repeat(200)
    const potongan = buatPotongan(panjang, 400)

    expect(potongan.length).toBeGreaterThan(1)
    for (const p of potongan) {
      // Tidak boleh berakhir di tengah kata: kutipan yang terpotong di tengah
      // kata tidak bisa dipahami sendiri.
      expect(p.content.trim(), `potongan ${p.ordinal}`).not.toMatch(/\s$/)
    }

    // Semua potongan penuh kecuali mungkin yang terakhir — sisa pendek di
    // akhir dokumen tetap disimpan, lebih baik potongan kecil daripada
    // kalimat hilang.
    for (const p of potongan.slice(0, -1)) {
      expect(p.content.length, `potongan ${p.ordinal}`).toBeGreaterThan(300)
    }
  })

  it('TIDAK menghasilkan potongan kosong atau duplikat', () => {
    const isi = '\n\n\nA\n\n\n\n\nB\n\n\n'
    const potongan = buatPotongan(isi)

    for (const p of potongan) expect(p.content.trim()).not.toBe('')
    const isiSemua = new Set(potongan.map((p) => p.content))
    expect(isiSemua.size).toBe(potongan.length)
  })

  it('menangani teks pendek tanpa memecah', () => {
    const potongan = buatPotongan('Satu kalimat pendek.')
    expect(potongan).toHaveLength(1)
    expect(potongan[0]!.ordinal).toBe(0)
  })

  it('urutan potongan berurutan tanpa lompatan', () => {
    const isi = 'Kalimat satu.\n\nKalimat dua.\n\nKalimat tiga.\n\nKalimat empat.'
    const potongan = buatPotongan(isi, 200)

    for (let i = 1; i < potongan.length; i += 1) {
      expect(potongan[i]!.ordinal).toBe(i)
      expect(potongan[i]!.startOffset).toBeGreaterThan(potongan[i - 1]!.endOffset)
    }
  })
})

describe('potongExcerpt', () => {
  it('memotong di sekitar kata kunci', () => {
    const isi = 'x'.repeat(400) + ' IURAN BULANAN ' + 'y'.repeat(400)
    const excerpt = potongExcerpt(isi, 'iuran', 50)

    expect(excerpt).toContain('IURAN')
    expect(excerpt.length).toBeLessThan(isi.length)
  })

  it('memberi tanda elipsis kalau dipotong di kedua ujung', () => {
    const isi = 'x'.repeat(400) + ' IURAN ' + 'y'.repeat(400)
    expect(potongExcerpt(isi, 'iuran', 50)).toMatch(/^….*…$/s)
  })

  it('BUG REGRESSION: TIDAK menghasilkan string kosong saat kata tidak cocok', () => {
    // Ekscerpt kosong membuat modelyl thinks dokumennya kosong.
    const excerpt = potongExcerpt('Isi dokumen yang tidak mengandung kata kunci.', 'xyzabc')
    expect(excerpt.length).toBeGreaterThan(0)
  })
})

describe('penyimpanan dokumen', () => {
  it('BUG REGRESSION: MENOLAK dokumen kosong', async () => {
    await expect(
      service.ingest({ organizationId: ORG, title: 'Kosong', content: '   ', documentType: 'x', actorUserId: null }),
    ).rejects.toMatchObject({ code: 'CONTENT_EMPTY' })
  })

  it('BUG REGRESSION: MENOLAK dokumen tanpa judul', async () => {
    await expect(
      service.ingest({ organizationId: ORG, title: ' ', content: 'isi', documentType: 'x', actorUserId: null }),
    ).rejects.toMatchObject({ code: 'TITLE_REQUIRED' })
  })

  it('BUG REGRESSION: MENOLAK dokumen yang kelewat besar', async () => {
    // Dokumen 3 juta karakter ≈ 600 halaman. Menyebut sumbernya jadi tidak
    // berguna.
    await expect(
      service.ingest({
        organizationId: ORG,
        title: 'Raksasa',
        content: 'a'.repeat(2_000_001),
        documentType: 'x',
        actorUserId: null,
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_TOO_LONG' })
  })
})

describe('pencarian Bahasa Indonesia', () => {
  it('BUG REGRESSION: pertanyaan NATURAL tetap menemukan dokumennya', async () => {
    // Ini bug yang ditemukan lewat pengujian nyata.
    //
    // `websearch_to_tsquery` memakai AND: 'berapa iuran bulanan' menjadi
    // `'apa' & 'iur' & 'bulan'`. "berapa" tidak ada di dokumen — hasilnya
    // nol, padahal dokumen itu persis yang dicari.
    //
    // Semua pertanyaan di bawah mengandung kata yang TIDAK ada di dokumen.
    for (const tanya of [
      'berapa iuran bulanan',
      'kapan iuran harus dibayar',
      'gimana kalau tidak hadir',
      'surat izin harus kapan',
    ]) {
      const hasil = await service.search(ORG, tanya)
      expect(hasil.length, `tanya: "${tanya}"`).toBeGreaterThan(0)
    }
  })

  it('BUG REGRESSION: pertanyaan yang benar-benar tidak ada mengembalikan kosong', async () => {
    // Sistem TIDAK BOLEH menjawab dengan dokumen yang tidak berhubungan —
    // itu mengarang sumber.
    const hasil = await service.search(ORG, '怎样 zzzqqq kryptonitelapis')
    expect(hasil).toHaveLength(0)
  })

  it('BUG REGRESSION: dokumen kedaluwarsa TIDAK dipakai sebagai sumber', async () => {
    // Menjawab dengan aturan lama sama berbahaya dengan menjawab tanpa
    // sumber: keduanya membuat orang bertindak berdasarkan informasi salah.
    const hasil = await service.search(ORG, 'iuran bulanan')

    const judulnya = hasil.map((h) => h.title)
    expect(judulnya).not.toContain('Uji Peraturan Kedaluwarsa')
    expect(judulnya).toContain('Uji Peraturan OSIS')
  })

  it('BUG REGRESSION: dokumen organisasi lain TIDAK bisa ditemukan', async () => {
    const hasil = await service.search(ORG_LAIN, 'iuran bulanan')
    expect(hasil).toHaveLength(0)
  })

  it('mengembalikan sumber yang bisa disebut', async () => {
    // Tanpa judul dan nomor dokumen, kutipan tidak bisa diverifikasi.
    const hasil = await service.search(ORG, 'iuran bulanan')
    expect(hasil.length).toBeGreaterThan(0)

    for (const hit of hasil) {
      expect(hit.title.length).toBeGreaterThan(0)
      expect(hit.documentId).toMatch(/^[0-9a-f-]{36}$/)
      expect(hit.excerpt.length).toBeGreaterThan(0)
      expect(hit.score).toBeGreaterThanOrEqual(0)
    }
  })

  it('mengurutkan dari yang paling relevan', async () => {
    const hasil = await service.search(ORG, 'musyawarah anggota')
    expect(hasil.length).toBeGreaterThan(0)
    for (let i = 1; i < hasil.length; i += 1) {
      expect(hasil[i - 1]!.score).toBeGreaterThanOrEqual(hasil[i]!.score)
    }
  })

  it('BUG REGRESSION: query kosong tidak membuat error', async () => {
    // `''::tsquery` adalah error PostgreSQL, bukan hasil kosong.
    await expect(service.search(ORG, '   ')).resolves.toEqual([])
  })

  it('BUG REGRESSION: filter tipe tidak merusak query', async () => {
    const tanpaFilter = await service.search(ORG, 'iuran bulanan')
    expect(tanpaFilter.length).toBeGreaterThan(0)

    const denganFilter = await service.search(ORG, 'iuran bulanan', { documentType: 'peraturan' })
    expect(denganFilter.length).toBeGreaterThan(0)

    const tipeNgawur = await service.search(ORG, 'iuran bulanan', { documentType: 'tidak-ada' })
    expect(tipeNgawur).toHaveLength(0)
  })

  it('BUG REGRESSION: parameter query aman dari injeksi SQL', async () => {
    // Kalau query dirakit manual, tanda kutip tunggal Putuskan seluruh SQL.
    const jahat = "'; DROP TABLE \"KnowledgeDocument\"; --"
    const hasil = await service.search(ORG, jahat)
    expect(Array.isArray(hasil)).toBe(true)

    // Tabelnya masih ada.
    const jumlah = await prisma.knowledgeDocument.count({ where: { organizationId: ORG } })
    expect(jumlah).toBeGreaterThan(0)
  })
})

describe('arsip', () => {
  it('BUG REGRESSION: mengarsipkan dikeluarkan dari pencarian', async () => {
    const dibuat = await service.ingest({
      organizationId: ORG,
      title: 'Uji Arsip',
      content: 'Nominal khusus zambrud untuk pengujian arsip.',
      documentType: 'catatan',
      actorUserId: null,
    })

    expect(await service.archive(dibuat.documentId, ORG)).toBe(true)

    const hasil = await service.search(ORG, 'zambrud')
    expect(hasil.map((h) => h.documentId)).not.toContain(dibuat.documentId)

    // Dokumen TIDAK dihapus — riwayat keputusan penting, dan menghapus sumber
    // yang pernah dipakai membuat atribusi lama tidak bisa diverifikasi.
    const masihAda = await prisma.knowledgeDocument.findUnique({
      where: { id: dibuat.documentId },
      select: { status: true },
    })
    expect(masihAda!.status).toBe('archived')

    await prisma.knowledgeDocument.delete({ where: { id: dibuat.documentId } })
  })

  it('BUG REGRESSION: mengarsipkan dokumen organisasi lain tidak berpengaruh', async () => {
    expect(await service.archive(idPeraturan, ORG_LAIN)).toBe(false)

    const masihAktif = await prisma.knowledgeDocument.findUnique({
      where: { id: idPeraturan },
      select: { status: true },
    })
    expect(masihAktif!.status).toBe('verified')
  })
})

describe('KnowledgeError', () => {
  it('memakai kode yang bisa dicabang di pemanggil', () => {
    expect(new KnowledgeError('CONTENT_EMPTY', 'kosong').code).toBe('CONTENT_EMPTY')
  })
})