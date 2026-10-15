/**
 * Ekstraksi teks dari PDF.
 *
 * ── Kenapa `unpdf` ──────────────────────────────────────────────────────────
 *
 * Hasil riset, bukan preferensi:
 *
 * | Library     | Masalah                                                |
 * |-------------|--------------------------------------------------------|
 * | pdf-parse   | menarik `canvas` (native). Gagal build di serverless, dan gagalnya muncul saat runtime produksi. |
 * | pdfjs-dist  | ~2 MB, API tingkat rendah; harus memanggil `getTextContent` sendiri. |
 * | **unpdf**   | Nol dependency, tanpa native, API satu fungsi.         |
 *
 * ── Batas yang harus diketahui ──────────────────────────────────────────────
 *
 * Ekstraksi teks PDF **tidak pernah sempurna**. Yang perlu dijaga:
 *
 * 1. **Dokumen hasil pindai tidak punya teks.** PDF hasil scan adalah gambar.
 *    PDF.js tidak bisa membacanya, dan tidak ada yang akan mengarang isi dari
 *    dokumen yang tidak bisa dibaca — hasilnya harus "tidak ada teks", bukan
 *    tebakan.
 *
 * 2. **Urutan teks bisa kacau** pada dokumen dua kolom. Isi tetap terbaca, tapi
 *    urutan barisnya tidak dijamin benar.
 *
 * 3. **PDF rusak atau bermasalah** harus ditolak dengan pesan jelas, bukan
 *    menjatuhkan proses.
 */
import { extractText, getDocumentProxy } from 'unpdf'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'extract' })

export class ExtractionError extends Error {
  constructor(
    readonly code: 'NOT_A_PDF' | 'ENCRYPTED' | 'MALFORMED' | 'NO_TEXT' | 'TOO_MANY_PAGES' | 'PARSE_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

/**
 * Tutup proxy dokumen.
 *
 * `destroy()` ada di sebagian versi PDF.js dan tidak di yang lain, jadi
 * dipanggil lewat pemeriksaan. PDF yang tidak ditutup menahan memori untuk
 * seluruh proses.
 */
async function tutup(dokumen: { cleanup?: () => Promise<void>; destroy?: () => Promise<void> }): Promise<void> {
  try {
    if (typeof dokumen.destroy === 'function') await dokumen.destroy()
    else if (typeof dokumen.cleanup === 'function') await dokumen.cleanup()
  } catch {
    // Kegagalan menutup dokumen tidak boleh menggagalkan pembacaan yang
    // sudah berhasil.
  }
}

/** Batas halaman. PDF 500 halaman butuh waktu dan memori yang tidak sebanding dengan nilainya. */
const MAKS_HALAMAN = 200

export interface ExtractResult {
  text: string
  pageCount: number
  characterCount: number
}

export async function extractPdfText(buffer: Buffer, options: { maxPages?: number } = {}): Promise<ExtractResult> {
  // Deteksi lewat magic bytes, bukan ekstensi berkas — nama berkas datang dari
  // luar dan tidak bisa dipercaya.
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ExtractionError('NOT_A_PDF', 'Berkas ini bukan PDF (tanda tangan %PDF- tidak ditemukan).')
  }

  const maksHalaman = options.maxPages ?? MAKS_HALAMAN

  try {
    // `Buffer` Node harus dikonversi ke `Uint8Array` polos.
    //
    // Buffer adalah subclass Uint8Array dengan offset dan panjang sendiri,
    // dan PDF.js membaca `byteOffset`/`byteLength` — kalau tidak dikonversi,
    // ia membaca dari offset yang salah dan hasilnya rusak.
    const data = new Uint8Array(buffer)

    const dokumen = await getDocumentProxy(data)
    const totalHalaman = dokumen.numPages

    if (totalHalaman > maksHalaman) {
      await tutup(dokumen)
      throw new ExtractionError(
        'TOO_MANY_PAGES',
        `Dokumen punya ${totalHalaman} halaman, melebihi batas ${maksHalaman}. Pecah jadi beberapa dokumen.`,
      )
    }

    const hasil = await extractText(dokumen, { mergePages: true })
    await tutup(dokumen)

    const teks = (Array.isArray(hasil.text) ? hasil.text.join('\n\n') : (hasil.text ?? '')).trim()

    // PDF hasil pindai = sekumpulan gambar. PDF.js mengembalikan string kosong,
    // dan itu informasi yang berguna — bukan kegagalan.
    if (teks === '') {
      throw new ExtractionError(
        'NO_TEXT',
        'PDF ini tidak punya lapisan teks (kemungkinan hasil pindai/foto). ' +
          'Isinya tidak bisa dibaca tanpa OCR, dan sistem tidak akan mengarang isinya.',
      )
    }

    log.info({ pages: totalHalaman, chars: teks.length }, 'teks PDF diekstraksi')

    return {
      text: teks,
      pageCount: totalHalaman,
      characterCount: teks.length,
    }
  } catch (error) {
    if (error instanceof ExtractionError) throw error

    const pesan = error instanceof Error ? error.message : String(error)
    // PDF.js meng Throw dengan pesan yang berbeda untuk dokumen terenkripsi.
    if (/password|encrypt/i.test(pesan)) {
      throw new ExtractionError(
        'ENCRYPTED',
        'PDF ini dilindungi kata sandi. Sistem belum bisa membuka dokumen berkunci.',
      )
    }

    log.warn({ err: error }, 'gagal mengekstraksi PDF')
    throw new ExtractionError('PARSE_FAILED', 'Gagal membaca PDF. Berkas mungkin rusak atau tidak lengkap.')
  }
}