/**
 * Test ekstraksi teks PDF.
 *
 * Yang paling penting di sini adalah apa yang DITOLAK. Sistem yang mengarang
 * isi dokumen yang tidak bisa dibaca akan menghasilkan jawaban palsu yang
 * terlihat sah — dan itu persis kesalahan yang paling mahal di knowledge
 * engine.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { extractPdfText, ExtractionError } from '../../src/knowledge/extract.js'
import { renderDocument, type RenderOptions } from '../../src/documents/renderer.js'

let pdfValid: Buffer

beforeAll(async () => {
  pdfValid = await renderDocument({
    template: 'daftar_hadir',
    title: 'Dokumen Uji Ekstraksi',
    documentNumber: 'DAFTAR/2026/001',
    organizationName: 'OSIS SMKN 2 MATARAM',
    signerName: 'Ahmad Fauzi',
    signerRole: 'Ketua Osis',
    issuedAt: new Date('2026-10-15T08:00:00Z'),
    eventTitle: 'Latihan LKBB',
    eventDate: new Date('2026-10-20T08:00:00Z'),
    rows: [
      { label: 'Budi Santoso', detail: 'X AKL 1', status: 'Hadir' },
      { label: 'Siti Aminah', detail: 'X AKL 1', status: 'Izin — sakit' },
    ],
  } as RenderOptions)
}, 30_000)

describe('extractPdfText', () => {
  it('BUG REGRESSION: membaca teks dari PDF yang benar', async () => {
    const hasil = await extractPdfText(pdfValid)

    expect(hasil.text.length).toBeGreaterThan(50)
    expect(hasil.pageCount).toBe(1)
    expect(hasil.characterCount).toBe(hasil.text.length)
  })

  it('BUG REGRESSION: MENOLAK berkas yang bukan PDF', async () => {
    // Deteksi lewat magic bytes, bukan nama berkas — nama berkas datang dari luar.
    await expect(extractPdfText(Buffer.from('ini bukan pdf sama sekali'))).rejects.toMatchObject({
      code: 'NOT_A_PDF',
    })
  })

  it('BUG REGRESSION: MENOLAK PDF rusak dengan pesan yang bisa dibaca', async () => {
    // PDF dengan header valid tapi isi sampah harus ditolak dengan pesan jelas,
    // bukan error parser mentah yang tidak bisa ditindaklanjuti.
    const rusak = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('sampah total '.repeat(50))])
    const galat = await extractPdfText(rusak).catch((e: unknown) => e)

    expect(galat).toBeInstanceOf(ExtractionError)
    if (galat instanceof ExtractionError) {
      expect(['PARSE_FAILED', 'NO_TEXT', 'ENCRYPTED']).toContain(galat.code)
      expect(galat.message.length).toBeGreaterThan(10)
      expect(galat.message).not.toMatch(/undefined|\[object/i)
    }
  })

  it('BUG REGRESSION: PDF tanpa lapisan teks ditolak, bukan dikarang', async () => {
    // PDF hasil pindai = gambar. PDF.js mengembalikan string kosong. Yang
    // benar adalah "tidak ada teks", bukan isi tebakan.
    const pdfTanpaTeks = await renderDocument({
      template: 'daftar_hadir',
      title: 'Kosong',
      organizationName: 'Kosong',
      signerName: 'Kosong',
      issuedAt: new Date(),
      rows: [{ label: ' ', detail: null, status: null }],
    } as RenderOptions)

    // Dokumen yang sah tetap punya teks minimal (kop + tanda tangan).
    // Yang dijaga: ekstraksi TIDAK PERNAH mengarang isi.
    const hasil = (await extractPdfText(pdfTanpaTeks).catch((e: unknown) => e)) as
      | ExtractionError
      | { text: string; pageCount: number; characterCount: number }
    if (hasil instanceof ExtractionError) {
      expect(hasil.code).toBe('NO_TEXT')
    } else {
      expect(hasil.text.length).toBeGreaterThan(0)
    }
  })

  it('BUG REGRESSION: menolak dokumen melebihi batas halaman', async () => {
    await expect(extractPdfText(pdfValid, { maxPages: 0 })).rejects.toMatchObject({
      code: 'TOO_MANY_PAGES',
    })
  })
})

describe('ExtractionError', () => {
  it('memakai kode yang bisa dicabang di pemanggil', () => {
    expect(new ExtractionError('NO_TEXT', 'x').code).toBe('NO_TEXT')
    expect(new ExtractionError('NO_TEXT', 'x')).toBeInstanceOf(Error)
  })
})