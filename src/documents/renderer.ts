/**
 * Mesin dokumen — membuat PDF dari data organisasi.
 *
 * ── Kenapa PDFKit, bukan Chromium/Puppeteer ─────────────────────────────────
 *
 * Hasil riset, bukan preferensi:
 *
 * | Pilihan            | Biaya                 | Cocok untuk                   |
 * |--------------------|-----------------------|-------------------------------|
 * | Puppeteer/Chromium | ~300 MB + browser     | Layout dari HTML/CSS          |
 * | pdf-lib            | perlu `@pdf-lib/fontkit` | Edit PDF yang sudah ada     |
 * | **PDFKit**         | ~5 MB, tanpa browser  | Layout digambar langsung      |
 *
 * Dokumen kita (surat izin, surat tugas, sertifikat, rekap absensi) layoutnya
 * tetap dan digambar langsung dari data. Menarik Chromium 300 MB hanya untuk
 * menggambar empat paragraf berarti membawa 300 MB yang tidak pernah dipakai.
 *
 * ── Font ────────────────────────────────────────────────────────────────────
 *
 * PDF dengan font standar (Helvetica, Times) **hanya bisa menulis Latin-1**.
 * Nama orang di Indonesia bisa mengandung karakter di luar itu, dan kalau
 * font tidak mendukung, hasilnya kotak kosong atau teks yang hilang tanpa
 * memberi tahu. Itu lebih buruk daripada menolak.
 *
 * Jadi font TrueType (DejaVu Sans) di-embed ke setiap dokumen. PDFKit melakukan
 * subsetting otomatis, jadi ukuran berkas tetap kecil.
 *
 * ── Yang tidak boleh terjadi ────────────────────────────────────────────────
 *
 * 1. **Dokumen resmi tanpa isi bukan dokumen.** Surat izin tanpa nama, alasan,
 *    dan tanggal menghasilkan dokumen yang terlihat sah tapi tidak berisi
 *    keputusan apa pun.
 *
 * 2. **Nomor dokumen tidak boleh dikarang.** Nomor surat harus berurutan dan
 *    tercatat.
 */
import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'documents' })

export class DocumentError extends Error {
  constructor(
    readonly code:
      | 'TEMPLATE_UNKNOWN'
      | 'MISSING_FIELD'
      | 'FONT_UNAVAILABLE'
      | 'RENDER_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'DocumentError'
  }
}

/**
 * Lokasi font DejaVu.
 *
 * Dicek satu per satu karena berbeda antar distro, dan lebih baik gagal dengan
 * pesan yang jelas daripada menghasilkan PDF penuh kotak kosong.
 */
const CANDIDATE_FONTS = {
  normal: [
    '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ],
  bold: [
    '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  ],
} as const

export type FontRole = keyof typeof CANDIDATE_FONTS

const fontCache = new Map<FontRole, string>()

/** Cari path font yang benar-benar ada di sistem. */
export function fontPath(role: FontRole): string | null {
  const cached = fontCache.get(role)
  if (cached) return cached

  for (const candidate of CANDIDATE_FONTS[role]) {
    if (existsSync(candidate)) {
      fontCache.set(role, candidate)
      return candidate
    }
  }
  return null
}

/** Nama berkas PDF yang aman dan informatif. */
export function safeFilename(input: string, maxLength = 80): string {
  const cleaned = input
    .normalize('NFKD')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .trim()

  const hasil = cleaned.slice(0, maxLength)
  // Nama berkas kosong (semua karakter terbuang) tidak berguna.
  return hasil === '' ? 'dokumen' : hasil
}

export type DocumentTemplate =
  | 'surat_izin'
  | 'surat_tugas'
  | 'sertifikat'
  | 'rekap_absensi'
  | 'daftar_hadir'

export const DOCUMENT_TEMPLATES: Record<DocumentTemplate, { label: string; description: string }> = {
  surat_izin: {
    label: 'Surat Izin',
    description: 'Surat izin tidak mengikuti kegiatan untuk satu anggota.',
  },
  surat_tugas: {
    label: 'Surat Tugas',
    description: 'Surat tugas untuk anggota yang mengerjakan tugas kegiatan.',
  },
  sertifikat: {
    label: 'Sertifikat',
    description: 'Sertifikat untuk orang yang mengikuti kegiatan.',
  },
  rekap_absensi: {
    label: 'Rekap Absensi',
    description: 'Rekapitulasi daftar hadir satu kegiatan dalam PDF.',
  },
  daftar_hadir: {
    label: 'Daftar Hadir',
    description: 'Daftar hadir satu kegiatan yang bisa dicetak dan ditandatangani.',
  },
}

/** Satu baris data untuk dokumen tabular. */
export interface TableRow {
  label: string
  detail?: string | null
  status?: string | null
}

export interface RenderOptions {
  template: DocumentTemplate
  title: string
  documentNumber?: string | null
  organizationName: string
  organizationAddress?: string | null
  signerName: string
  signerRole?: string | null
  signerPlace?: string | null
  issuedAt: Date
  subjectName?: string | null
  subjectDetail?: string | null
  reason?: string | null
  eventTitle?: string | null
  eventDate?: Date | null
  rows?: TableRow[]
  notes?: string | null
}

const MARGIN = 56
const PAGE_WIDTH = 595.28 // A4 dalam poin
const PAGE_HEIGHT = 841.89

/** Render dokumen ke buffer PDF. */
export async function renderDocument(options: RenderOptions): Promise<Buffer> {
  if (!DOCUMENT_TEMPLATES[options.template]) {
    throw new DocumentError('TEMPLATE_UNKNOWN', `Templat "${options.template}" tidak dikenal.`)
  }

  // Dokumen resmi tanpa isi bukan dokumen.
  if (options.template === 'surat_izin' || options.template === 'surat_tugas') {
    if (!options.subjectName?.trim()) {
      throw new DocumentError('MISSING_FIELD', 'Nama yang menjadi objek surat wajib diisi.')
    }
    if (!options.reason?.trim()) {
      throw new DocumentError('MISSING_FIELD', 'Alasan atau keterangan wajib diisi.')
    }
  }

  if (options.template === 'sertifikat' && !options.subjectName?.trim()) {
    throw new DocumentError('MISSING_FIELD', 'Nama penerima sertifikat wajib diisi.')
  }

  if (
    (options.template === 'daftar_hadir' || options.template === 'rekap_absensi') &&
    (!options.rows || options.rows.length === 0)
  ) {
    throw new DocumentError('MISSING_FIELD', 'Daftar tanpa isi tidak berguna sebagai dokumen.')
  }

  const fontNormal = fontPath('normal')
  const fontBold = fontPath('bold')
  if (!fontNormal) {
    throw new DocumentError(
      'FONT_UNAVAILABLE',
      'Font DejaVu Sans tidak ditemukan. PDF dengan font standar hanya bisa menulis Latin-1, ' +
        'jadi nama dengan karakter lain akan hilang. Pasang paket fonts-dejavu.',
    )
  }

  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        info: {
          Title: options.title,
          Author: options.organizationName,
          Creator: 'OSDABOT',
        },
      })

      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (error: Error) => reject(error))

      doc.registerFont('normal', fontNormal)
      if (fontBold) doc.registerFont('bold', fontBold)
      const bold = fontBold ? 'bold' : 'normal'

      try {
        gambarKop(doc, options)
        gambarJudul(doc, options, bold)

        switch (options.template) {
          case 'surat_izin':
            gambarSurat(doc, options, bold, 'IZIN', 'tidak dapat mengikuti')
            break
          case 'surat_tugas':
            gambarSurat(doc, options, bold, 'TUGAS', 'melaksanakan tugas')
            break
          case 'sertifikat':
            gambarSertifikat(doc, options, bold)
            break
          case 'daftar_hadir':
            gambarTabel(doc, options, bold, 'Daftar Hadir')
            break
          case 'rekap_absensi':
            gambarTabel(doc, options, bold, 'Rekap Absensi')
            break
        }

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  } catch (error) {
    log.error({ err: error, template: options.template }, 'gagal merender dokumen')
    throw new DocumentError('RENDER_FAILED', 'Gagal membuat dokumen. Coba lagi sebentar.')
  }
}

/** Kop surat: nama organisasi, alamat, garis pemisah. */
function gambarKop(doc: PDFKit.PDFDocument, options: RenderOptions): void {
  doc.font('normal').fontSize(14).fillColor('#111111').text(options.organizationName, { align: 'center' })
  if (options.organizationAddress) {
    doc.fontSize(8).fillColor('#555555').text(options.organizationAddress, { align: 'center' })
  }
  doc.moveDown(0.8)
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .lineWidth(0.8)
    .strokeColor('#111111')
    .stroke()
  doc.moveDown(0.8)
}

/** Judul dokumen dan nomornya. */
function gambarJudul(doc: PDFKit.PDFDocument, options: RenderOptions, bold: string): void {
  doc.font(bold).fontSize(15).fillColor('#111111').text(options.title, { align: 'center' })
  doc.moveDown(0.4)
  if (options.documentNumber) {
    doc.font('normal').fontSize(10).fillColor('#333333').text(`Nomor: ${options.documentNumber}`, { align: 'center' })
  }
  doc.moveDown(1)
}

/** Surat izin dan surat tugas berbagi bentuk; hanya kata kerjanya berbeda. */
function gambarSurat(
  doc: PDFKit.PDFDocument,
  options: RenderOptions,
  bold: string,
  kolom: string,
  keterangan: string,
): void {
  doc.font('normal').fontSize(11).fillColor('#111111')

  const paragraf = (teks: string): void => {
    doc.text(teks, { align: 'justify', lineGap: 2 })
    doc.moveDown(0.7)
  }

  paragraf(
    `Sehubungan dengan rencana kegiatan ${options.eventTitle ?? 'organisasi'}, kami memberitahukan kepada:`,
  )
  paragraf(`Nama           : ${options.subjectName}`)
  if (options.subjectDetail) paragraf(`Kelas / NIP    : ${options.subjectDetail}`)
  paragraf(`${kolom.padEnd(14)}: ${options.reason}`)
  paragraf(`Keterangan     : ${keterangan} pada kegiatan tersebut.`)
  if (options.eventDate) paragraf(`Tanggal kegiatan: ${formatTanggalIndonesia(options.eventDate)}`)
  doc.moveDown(0.3)
  paragraf(
    ' Seederhana ini kami sampaikan untuk dipergunakan sebagaimana mestanya. ' +
      'Terima kasih atas kerja sama dan ketapatannya.',
  )

  if (options.notes) {
    doc.moveDown(0.3)
    doc.font('normal').fontSize(10).fillColor('#444444').text(`Catatan: ${options.notes}`)
  }

  gambarTandaTangan(doc, options, bold)
}

/** Sertifikat: banyak ruang kosong supaya nama terbaca jelas. */
function gambarSertifikat(doc: PDFKit.PDFDocument, options: RenderOptions, bold: string): void {
  doc.moveDown(1.5)
  doc.font(bold).fontSize(13).fillColor('#111111').text('SERTIFIKAT', { align: 'center' })
  doc.moveDown(0.6)
  doc.font('normal').fontSize(11).fillColor('#333333').text('Diberikan kepada:', { align: 'center' })
  doc.moveDown(0.8)

  doc.font(bold).fontSize(18).fillColor('#111111').text(options.subjectName ?? '', { align: 'center' })
  doc.moveDown(0.2)
  doc.font('normal').fontSize(8).fillColor('#555555').text('_'.repeat(48), { align: 'center' })
  if (options.subjectDetail) {
    doc.fontSize(10).text(options.subjectDetail, { align: 'center' })
  }
  doc.moveDown(0.8)

  const kegiatan = options.eventTitle ?? 'kegiatan organisasi'
  const tanggal = formatTanggalIndonesia(options.issuedAt)

  doc.font('normal').fontSize(11).fillColor('#111111').text(
    `atas kehadirannya serta ketekunan dalam mengikuti ${kegiatan} yang berlangsung pada ${tanggal}.`,
    { align: 'center', lineGap: 3 },
  )
  doc.moveDown(1)

  if (options.notes) {
    doc.fontSize(10).fillColor('#444444').text(options.notes, { align: 'center' })
    doc.moveDown(1)
  }

  gambarTandaTangan(doc, options, bold, true)
}

/** Tabel daftar hadir atau rekap absensi. */
function gambarTabel(
  doc: PDFKit.PDFDocument,
  options: RenderOptions,
  bold: string,
  judul: string,
): void {
  doc.font(bold).fontSize(12).fillColor('#111111').text(judul)
  if (options.eventTitle) {
    doc.font('normal').fontSize(10).fillColor('#333333').text(`Kegiatan: ${options.eventTitle}`)
  }
  if (options.eventDate) {
    doc.font('normal').fontSize(10).fillColor('#333333').text(`Tanggal: ${formatTanggalIndonesia(options.eventDate)}`)
  }
  doc.moveDown(0.8)

  const awal = doc.y
  const lebarNo = 28
  const lebarNama = 300
  const lebarStatus = 100

  doc.font(bold).fontSize(9).fillColor('#111111')
  doc.text('NO', MARGIN, awal, { width: lebarNo, align: 'center' })
  doc.text('NAMA', MARGIN + lebarNo, awal, { width: lebarNama })
  doc.text('KELAS', MARGIN + lebarNo + lebarNama, awal, { width: lebarStatus })
  doc.text('TANDA TANGAN', MARGIN + lebarNo + lebarNama + lebarStatus, awal, {
    width: PAGE_WIDTH - MARGIN - (MARGIN + lebarNo + lebarNama + lebarStatus),
  })

  const bawahHeader = doc.y + 4
  doc
    .moveTo(MARGIN, bawahHeader)
    .lineTo(PAGE_WIDTH - MARGIN, bawahHeader)
    .lineWidth(0.6)
    .strokeColor('#333333')
    .stroke()

  let barisY = bawahHeader + 6
  let nomor = 0

  for (const row of options.rows ?? []) {
    // Baris baru saat melewati batas bawah halaman, supaya tanda tangan
    // tidak tertimpa isi tabel.
    if (barisY > PAGE_HEIGHT - MARGIN - 80) {
      doc.addPage()
      barisY = MARGIN
    }

    nomor += 1
    doc.font('normal').fontSize(9).fillColor('#111111')

    const tinggiNama = doc.heightOfString(row.label, { width: lebarNama + lebarStatus })
    doc.text(row.label, MARGIN + lebarNo, barisY + 4, { width: lebarNama + lebarStatus })

    if (row.detail) {
      doc.fontSize(7.5).fillColor('#666666')
      doc.text(row.detail, MARGIN + lebarNo, barisY + 8 + tinggiNama, { width: lebarNama + lebarStatus })
    }

    if (row.status) {
      doc.font('normal').fontSize(8).fillColor('#333333')
      doc.text(row.status, MARGIN + lebarNo + lebarNama, barisY + 4, { width: lebarStatus })
    }

    barisY += Math.max(24, tinggiNama + 16)
    doc
      .moveTo(MARGIN, barisY)
      .lineTo(PAGE_WIDTH - MARGIN, barisY)
      .lineWidth(0.2)
      .strokeColor('#CCCCCC')
      .stroke()
  }

  doc.moveDown(1)
  gambarTandaTangan(doc, options, bold)
}

/** Blok tanda tangan, rata kanan (atau tengah untuk sertifikat). */
function gambarTandaTangan(
  doc: PDFKit.PDFDocument,
  options: RenderOptions,
  bold: string,
  tengah = false,
): void {
  doc.moveDown(1)
  const lebarBlok = 200
  const x = tengah ? (PAGE_WIDTH - lebarBlok) / 2 : PAGE_WIDTH - MARGIN - lebarBlok

  doc.font('normal').fontSize(10).fillColor('#111111')
  doc.text(`${options.signerPlace ?? options.organizationName}, ${formatTanggalIndonesia(options.issuedAt)}`, x, doc.y, {
    width: lebarBlok,
    align: 'center',
  })
  doc.moveDown(2.2)
  doc.font(bold).text(options.signerName, x, doc.y, { width: lebarBlok, align: 'center' })
  doc.font('normal').fontSize(9).fillColor('#333333').text(options.signerRole ?? '', x, doc.y, {
    width: lebarBlok,
    align: 'center',
  })
}

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

/** Tanggal dalam format Indonesia, dihitung di zona waktu organisasi. */
export function formatTanggalIndonesia(date: Date, timezone?: string): string {
  const bagian = bagianTanggal(date, timezone)
  return `${bagian.day} ${NAMA_BULAN[bagian.month - 1]} ${bagian.year}`
}

/** Pecah tanggal menjadi hari/bulan/tahun di zona waktu tertentu. */
function bagianTanggal(date: Date, timezone?: string): { day: number; month: number; year: number } {
  if (timezone) {
    try {
      // en-CA menghasilkan format YYYY-MM-DD.
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      const [year, month, day] = formatter.format(date).split('-').map(Number)
      if (year && month && day) return { day, month, year }
    } catch {
      // Zona waktu tidak dikenal — jatuh ke UTC, jangan gagalkan dokumen.
    }
  }

  return { day: date.getUTCDate(), month: date.getUTCMonth() + 1, year: date.getUTCFullYear() }
}