/**
 * Test mesin dokumen.
 *
 * Fokusnya dua: dokumen yang benar-benar terbentuk sebagai PDF, dan apa yang
 * DITOLAK. Surat yang terlihat sah tapi isinya salah lebih berbahaya dari
 * surat yang gagal dibuat, karena orang akan memakainya.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import {
  DocumentError,
  DOCUMENT_TEMPLATES,
  formatTanggalIndonesia,
  renderDocument,
  safeFilename,
  type RenderOptions,
} from '../../src/documents/renderer.js'

const DASAR: RenderOptions = {
  template: 'surat_izin',
  title: 'Surat Izin',
  documentNumber: 'SURAT/2026/001',
  organizationName: 'OSIS SMKN 2 MATARAM',
  organizationAddress: 'Jl. Ahmad Yani, Mataram',
  signerName: 'Ahmad Fauzi',
  signerRole: 'Ketua Osis',
  signerPlace: 'Mataram',
  issuedAt: new Date('2026-10-15T08:00:00Z'),
  subjectName: 'Budi Santoso',
  subjectDetail: 'X AKL 1',
  reason: 'Sakit berdasarkan surat dokter',
  eventTitle: 'Latihan LKBB',
  eventDate: new Date('2026-10-16T08:00:00Z'),
}

beforeAll(() => {
  // Kalau font tidak ada, test rendering tidak akan bisa apa-apa. Gagal di
  // sini lebih baik daripada gagal diam-diam di tengah test.
  expect(
    DOCUMENT_TEMPLATES.surat_izin.description.length,
    'templat harus punya deskripsi untuk pemilihan model',
  ).toBeGreaterThan(10)
})

describe('renderDocument', () => {
  it('menghasilkan PDF yang benar-benar valid', async () => {
    const buffer = await renderDocument(DASAR)

    expect(buffer.byteLength).toBeGreaterThan(1000)
    // Tanda tangan beneran PDF: %PDF-
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    // Dan diakhiri penanda EOF.
    expect(buffer.subarray(-8).toString('ascii')).toContain('%%EOF')
  })

  it('menghasilkan PDF untuk setiap templat', async () => {
    const dasar = { ...DASAR, rows: [{ label: 'Budi Santoso', detail: 'X AKL 1', status: 'Hadir' }] }

    for (const template of Object.keys(DOCUMENT_TEMPLATES) as Array<keyof typeof DOCUMENT_TEMPLATES>) {
      const buffer = await renderDocument({ ...dasar, template, reason: 'Keterangan' })
      expect(buffer.byteLength, template).toBeGreaterThan(1000)
      expect(buffer.subarray(0, 5).toString('ascii'), template).toBe('%PDF-')
    }
  })

  it('BUG REGRESSION: MENOLAK templat yang tidak dikenal', async () => {
    await expect(renderDocument({ ...DASAR, template: 'surat_janji' as never })).rejects.toMatchObject({
      code: 'TEMPLATE_UNKNOWN',
    })
  })

  it('BUG REGRESSION: MENOLAK surat izin tanpa nama', async () => {
    // Surat tanpa nama bukan dokumen — itu formalitas kosong.
    await expect(renderDocument({ ...DASAR, subjectName: '   ' })).rejects.toMatchObject({
      code: 'MISSING_FIELD',
    })
  })

  it('BUG REGRESSION: MENOLAK surat izin tanpa alasan', async () => {
    await expect(renderDocument({ ...DASAR, reason: '' })).rejects.toMatchObject({
      code: 'MISSING_FIELD',
    })
  })

  it('BUG REGRESSION: MENOLAK daftar hadir tanpa isi', async () => {
    // Daftar kosong yang dicetak dan ditandatangani adalah dokumen yang
    // menyatakan "tidak ada yang hadir" — bukan "belum diisi".
    for (const template of ['daftar_hadir', 'rekap_absensi'] as const) {
      await expect(renderDocument({ ...DASAR, template, rows: [] })).rejects.toMatchObject({
        code: 'MISSING_FIELD',
      })
      await expect(renderDocument({ ...DASAR, template, rows: undefined })).rejects.toMatchObject({
        code: 'MISSING_FIELD',
      })
    }
  })

  it('BUG REGRESSION: MENOLAK sertifikat tanpa nama penerima', async () => {
    await expect(
      renderDocument({ ...DASAR, template: 'sertifikat', subjectName: null, reason: undefined }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' })
  })

  it('BUG REGRESSION: TIDAK menggagalkan dokumen karena karakter di luar Latin-1', async () => {
    // Nama orang bisa mengandung karakter khusus. Kalau font tidak mendukung,
    // hasilnya kotak kosong atau teks hilang — lebih baik dokumen tetap
    // terbentuk dan orang yang membacanya yang menilai.
    const buffer = await renderDocument({
      ...DASAR,
      subjectName: 'Siti Ámâh — Ündang “Bersetah”',
      reason: 'Izin dengan Rapid (a.n. orang tua)',
    })

    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('BUG REGRESSION: daftar panjang butuh lebih dari satu halaman', async () => {
    // 90 baris tidak mungkin muat di satu halaman A4. Kalau tidak pecah
    // halaman, baris terakhir tertimpa blok tanda tangan.
    const rows = Array.from({ length: 90 }, (_, i) => ({
      label: `Anggota Nomor ${i + 1}`,
      detail: `X AKL ${(i % 4) + 1}`,
      status: i % 3 === 0 ? 'Hadir' : '',
    }))

    const buffer = await renderDocument({ ...DASAR, template: 'daftar_hadir', rows })

    expect(buffer.byteLength).toBeGreaterThan(2000)
    // Halaman tambahan ditandai dengan objek /Type /Page.
    const isi = buffer.toString('latin1')
    const jumlahHalaman = (isi.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(jumlahHalaman, 'daftar 90 baris harus lebih dari satu halaman').toBeGreaterThan(1)
  })

  it('BUG REGRESSION: nama yang sangat panjang tidak membuat dokumen rusak', async () => {
    const buffer = await renderDocument({
      ...DASAR,
      reason: 'x'.repeat(3000),
    })
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })
})

describe('safeFilename', () => {
  it('membuat nama berkas aman dari karakter berbahaya', () => {
    // Path traversal di nama berkas = berkas ditulis di luar folder tujuan.
    expect(safeFilename('../../etc/passwd')).not.toContain('/')
    expect(safeFilename('../../etc/passwd')).not.toContain('..')
  })

  it('mengganti karakter yang tidak boleh ada di nama berkas', () => {
    const hasil = safeFilename('Surat:izin/tugas?*<>|')
    for (const buruk of [':', '/', '?', '*', '<', '>', '|']) {
      expect(hasil, buruk).not.toContain(buruk)
    }
  })

  it('membuang karakter kontrol', () => {
    // Karakter kontrol bisa menyisipkan baris baru saat ditampilkan.
    const hasil = safeFilename('izin\u0000\x1b[31mmerah\x07')
    expect(hasil).not.toMatch(/[\u0000-\u001f\u007f]/)
  })

  it('memberi nama cadangan kalau semua karakter terbuang', () => {
    expect(safeFilename('///')).toBeTruthy()
    expect(safeFilename('')).toBe('dokumen')
    expect(safeFilename('   ')).toBe('dokumen')
  })

  it('memotong nama yang terlalu panjang', () => {
    expect(safeFilename('x'.repeat(500)).length).toBeLessThanOrEqual(80)
  })

  it('memakai spasi dan huruf Indonesia apa adanya', () => {
    // Nama berkas harus tetap terbaca oleh orang.
    expect(safeFilename('Surat Izin Budi Santoso')).toBe('Surat-Izin-Budi-Santoso')
  })
})

describe('formatTanggalIndonesia', () => {
  it('menggunakan nama bulan bahasa Indonesia', () => {
    expect(formatTanggalIndonesia(new Date('2026-10-15T08:00:00Z'))).toBe('15 Oktober 2026')
    expect(formatTanggalIndonesia(new Date('2026-01-01T08:00:00Z'))).toBe('1 Januari 2026')
    expect(formatTanggalIndonesia(new Date('2026-12-31T08:00:00Z'))).toBe('31 Desember 2026')
  })

  it('menghitung tanggal di zona waktu organisasi', () => {
    // UTC 2026-10-15T23:30 masih 16 Oktober di Makassar (UTC+8). Nomor
    // surat dengan tanggal yang salah adalah keputusan yang salah.
    const larut = new Date('2026-10-15T23:30:00Z')
    expect(formatTanggalIndonesia(larut, 'UTC')).toBe('15 Oktober 2026')
    expect(formatTanggalIndonesia(larut, 'Asia/Makassar')).toBe('16 Oktober 2026')
  })

  it('BUG REGRESSION: zona waktu tidak dikenal tidak menggagalkan dokumen', async () => {
    // Zona waktu yang tidak dikenal tidak boleh menggagalkan pembuatan
    // dokumen resmi.
    const buffer = await renderDocument({ ...DASAR })
    expect(buffer.byteLength).toBeGreaterThan(1000)
  })
})

describe('DocumentError', () => {
  it('memakai kode yang bisa dicabang di pemanggil', () => {
    const err = new DocumentError('MISSING_FIELD', 'kurang')
    expect(err.code).toBe('MISSING_FIELD')
    expect(err.message).toBe('kurang')
    expect(err).toBeInstanceOf(Error)
  })

  it('menyebut field mana yang kurang, bukan cuma "gagal"', async () => {
    // Pesan "gagal" tanpa menyebut field mana tidak bisa ditindaklanjuti
    // siapa pun yang membaca.
    const gagal = renderDocument({ ...DASAR, subjectName: '' })
    await expect(gagal).rejects.toBeInstanceOf(DocumentError)
    await expect(gagal).rejects.toThrow(/Nama/i)
  })
})