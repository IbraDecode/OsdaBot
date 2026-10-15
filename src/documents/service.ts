/**
 * Layanan dokumen.
 *
 * Menggabungkan tiga hal yang harus selalu jalan bersama:
 *
 * 1. **Nomor dokumen berurutan** — `SURAT/2026/001`. Nomor surat yang salah
 *    berarti dokumen resmi dengan identitas yang salah.
 * 2. **Penyimpanan berkas** — driver lokal atau S3, lewat antarmuka yang sama.
 * 3. **Pencatatan** — setiap dokumen tersimpan sebagai `DocumentRecord` supaya
 *    bisa dicari dan diaudit.
 *
 * Yang TIDAK ada di sini: mengirim dokumen ke WhatsApp. Itu urusan tool, bukan
 * service — supaya aturan izin (document.send) tetap di satu tempat.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'
import {
  DocumentError,
  safeFilename,
  renderDocument,
  type DocumentTemplate,
  type RenderOptions,
} from './renderer.js'

const log = logger.child({ module: 'documents' })

export interface StorageDriver {
  /** Simpan berkas dan kembalikan kunci penyimpanannya. */
  put(key: string, data: Buffer, mimeType: string): Promise<void>
  /** Ambil berkas. `null` kalau tidak ada. */
  get(key: string): Promise<Buffer | null>
  /** Hapus berkas. Mengembalikan `true` kalau benar-benar terhapus. */
  delete(key: string): Promise<boolean>
}

/**
 * Penyimpanan lokal.
 *
 * Path selalu di-resolve lalu diperiksa tetap di dalam akar. Kunci yang
 * mengandung `../` akan keluar dari direktori yangрито disalin dari luar —
 * jadi dicek, bukan dipercaya.
 */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string

  constructor(baseDir: string) {
    this.root = resolve(baseDir)
  }

  private resolveKey(key: string): string {
    const target = resolve(this.root, key)
    const withSeparator = this.root.endsWith('/') ? this.root : `${this.root}/`
    if (target !== this.root && !target.startsWith(withSeparator)) {
      throw new DocumentError('RENDER_FAILED', 'Kunci penyimpanan mencoba keluar dari direktori penyimpanan.')
    }
    return target
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }

  async get(key: string): Promise<Buffer | null> {
    const { readFile } = await import('node:fs/promises')
    // Validasi dilakukan DI LUAR try. Kalau di dalam, `catch` menelan
    // penolakan path traversal dan mengembalikan null — jadi kunci berbahaya
    // lolos dengan diam-diam.
    const target = this.resolveKey(key)
    try {
      return await readFile(target)
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<boolean> {
    const { unlink } = await import('node:fs/promises')
    try {
      await unlink(this.resolveKey(key))
      return true
    } catch {
      return false
    }
  }
}

export interface CreateDocumentInput {
  organizationId: string
  template: DocumentTemplate
  title: string
  actorUserId: string | null
  timezone?: string
  signerName: string
  signerRole?: string | null
  signerPlace?: string | null
  organizationAddress?: string | null
  subjectName?: string | null
  subjectDetail?: string | null
  reason?: string | null
  eventTitle?: string | null
  eventDate?: Date | null
  attendanceEventId?: string | null
  notes?: string | null
}

export class DocumentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageDriver,
  ) {}

  /**
   * Buat dokumen dan simpan.
   *
   * Render dan penyimpanan tetap dipisah supaya kegagalan di salah satu tidak
   * meninggalkan dokumen yatim: kalau render gagal, tidak ada yang tersimpan;
   * kalau penyimpanan gagal, tidak ada `DocumentRecord` yang menunjuk berkas
   * yang tidak ada.
   */
  async create(input: CreateDocumentInput): Promise<{
    id: string
    documentNumber: string
    title: string
    storageKey: string
    sizeBytes: number
    mimeType: string
    filename: string
    rowsCount: number
  }> {
    const organisasi = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true },
    })
    if (!organisasi) {
      throw new DocumentError('MISSING_FIELD', 'Organisasi tidak ditemukan.')
    }

    let rows: RenderOptions['rows'] = undefined

    // Daftar hadir & rekap absensi diambil dari daftar yang benar-benar ada,
    // bukan dari angka yang diketik model.
    if (input.template === 'daftar_hadir' || input.template === 'rekap_absensi') {
      rows = await this.barisDariAbsensi(input)
    }

    const documentNumber = await this.nomorBerikutnyaDenganRetry(input.organizationId, input.template)

    const buffer = await renderDocument({
      template: input.template,
      title: input.title,
      documentNumber,
      organizationName: organisasi.name,
      organizationAddress: input.organizationAddress ?? null,
      signerName: input.signerName,
      signerRole: input.signerRole ?? null,
      signerPlace: input.signerPlace ?? null,
      issuedAt: new Date(),
      subjectName: input.subjectName ?? null,
      subjectDetail: input.subjectDetail ?? null,
      reason: input.reason ?? null,
      eventTitle: input.eventTitle ?? null,
      eventDate: input.eventDate ?? null,
      ...(rows ? { rows } : {}),
      notes: input.notes ?? null,
    })

    const filename = `${safeFilename(input.title)}.pdf`
    // Kunci penyimpanan memuat id organisasi supaya berkas dua organisasi
    // dengan judul sama tidak saling menimpa.
    const storageKey = join(
      input.organizationId,
      'documents',
      `${documentNumber}-${filename}`,
    )

    await this.storage.put(storageKey, buffer, 'application/pdf')

    const record = await this.prisma.documentRecord.create({
      data: {
        organizationId: input.organizationId,
        title: input.title,
        documentType: input.template,
        format: 'pdf',
        documentNumber,
        storageKey,
        mimeType: 'application/pdf',
        sizeBytes: buffer.byteLength,
        status: 'final',
      },
      select: { id: true, storageKey: true, sizeBytes: true },
    })

    log.info(
      { organizationId: input.organizationId, template: input.template, sizeBytes: buffer.byteLength },
      'dokumen dibuat',
    )

    // `sizeBytes` selalu diisi saat penulisan; `?? 0` hanya menjaga tipe
    // kalau baris lama dibuat sebelum kolom ini ada.
    return {
      id: record.id,
      documentNumber,
      title: input.title,
      storageKey: record.storageKey ?? storageKey,
      sizeBytes: record.sizeBytes ?? buffer.byteLength,
      mimeType: 'application/pdf',
      filename,
      rowsCount: rows?.length ?? 0,
    }
  }

  /** Ambil isi dokumen. Hanya dari organisasi yang benar. */
  async read(organizationId: string, documentId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const record = await this.prisma.documentRecord.findFirst({
      where: { id: documentId, organizationId },
      select: { storageKey: true, mimeType: true },
    })
    // Id dari luar organisasi tidak boleh dipakai.
    if (!record?.storageKey) return null

    const buffer = await this.storage.get(record.storageKey)
    if (!buffer) {
      log.warn({ documentId, storageKey: record.storageKey }, 'catatan dokumen ada tapi berkasnya hilang')
      return null
    }

    return { buffer, mimeType: record.mimeType ?? 'application/pdf' }
  }

  /**
   * Ambil isi dokumen beserta nama berkas dan tipe MIME-nya.
   *
   * Dipisah dari `read()` supaya pemanggil tidak perlu menyusun nama berkas
   * sendiri — nama berkas yang ditebak caller bisa tidak cocok dengan yang
   * tercatat, dan WhatsApp akan menampilkan nama yang salah.
   */
  async readBuffer(
    organizationId: string,
    documentId: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
    const record = await this.prisma.documentRecord.findFirst({
      where: { id: documentId, organizationId },
      select: { storageKey: true, mimeType: true, title: true },
    })
    if (!record?.storageKey) return null

    const buffer = await this.storage.get(record.storageKey)
    if (!buffer) {
      log.warn({ documentId, storageKey: record.storageKey }, 'catatan dokumen ada tapi berkasnya hilang')
      return null
    }

    // Nama berkas yang dilihat pengguna bukan nama di storage key: storage
    // key memuat nomor dokumen supaya tidak bentrok, nama berkas tidak perlu.
    const extension = record.storageKey.split('.').pop() ?? 'pdf'
    return {
      buffer,
      filename: `${safeFilename(record.title)}.${extension}`,
      mimeType: record.mimeType ?? 'application/pdf',
    }
  }

  /** Daftar dokumen organisasi. */
  async list(
    organizationId: string,
    options: { documentType?: DocumentTemplate; limit?: number } = {},
  ): Promise<Array<{ id: string; title: string; documentType: string; createdAt: Date }>> {
    return this.prisma.documentRecord.findMany({
      where: {
        organizationId,
        ...(options.documentType ? { documentType: options.documentType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 20,
      select: { id: true, title: true, documentType: true, createdAt: true },
    })
  }

  /**
   * Nomor dokumen berikutnya.
   *
   * `SURAT/2026/001`, `SERTIFIKAT/2026/001`, dan seterusnya per template.
   * Prefix template penting: izin dan tugas adalah dua jenis surat yang
   * berbeda, bukan satu rangkaian nomor.
   */
  /**
   * Nomor dokumen berikutnya.
   *
   * ── Balapan yang ditutup di sini ──────────────────────────────────────────
   *
   * "Baca nomor terbesar, tambah satu, tulis" punya celah di antara baca dan
   * tulis. Dua permintaan bersamaan bisa sama-sama membaca `SURAT/2026/012`,
   * lalu sama-sama menulis `SURAT/2026/012`.
   *
   * Dua dokumen resmi berbeda dengan identitas yang sama bukan masalah
   * kosmetik: yang dirujuk orang adalah nomor itu, dan dua nomor yang sama
   * membuat rujukan itu tidak bisa dipercaya.
   *
   * Penutupannya: constraint UNIQUE di database (`organizationId`,
   * `documentNumber`). Pembacaan tetap perlu, tapi sekarang konfliknya
   * terlihat — dan nomor berikutnya dicoba lagi, bukan diterima apa adanya.
   *
   * Bandingkan nomor yang tersimpan sebagai TEKS lalu ambil bagian angkanya.
   * Cari angka terbesar, bukan `findFirst` berurutan — nomor bisa dihapus, jadi
   * baris terakhir yang tersisa belum tentu yang terbesar.
   */
  private async nomorBerikutnya(organizationId: string, template: DocumentTemplate): Promise<string> {
    const tahun = new Date().getFullYear()
    const prefix = `${PREFIX_TEMPLATE[template]}/${tahun}/`

    // Sengaja TIDAK menyaring `documentType`.
    //
    // Penomoran unik per ORGANISASI, bukan per jenis dokumen. Surat izin dan
    // surat tugas berbagi prefix `SURAT`, jadi keduanya harus menghitung dari
    // angka terbesar di antara keduanya — kalau masing-masing menghitung dari
    // nol, keduanya sama-sama menghasilkan `SURAT/2026/001`.
    //
    // Bug ini tersembunyi selama constraint UNIQUE belum ada: kedua dokumen
    // tersimpan dengan nomor yang sama dan tidak ada yang sederhana.
    const rows = await this.prisma.documentRecord.findMany({
      where: {
        organizationId,
        documentNumber: { startsWith: prefix },
      },
      select: { documentNumber: true },
    })

    let terbesar = 0
    for (const row of rows) {
      const cocok = row.documentNumber?.slice(prefix.length).match(/^(\d+)$/)
      if (!cocok) continue
      const angka = Number(cocok[1])
      if (Number.isSafeInteger(angka) && angka > terbesar) terbesar = angka
    }

    return `${prefix}${String(terbesar + 1).padStart(3, '0')}`
  }

  /**
   * Nomor berikutnya, diulang sampai konsisten.
   *
   * Percobaan dibatasi: kalau lima kali berturut-turut semuanya bentrok,
   * berarti ada masalah lain — mengulang tanpa batas hanya menyembunyikannya
   * di balik timeout.
   */
  private async nomorBerikutnyaDenganRetry(organizationId: string, template: DocumentTemplate): Promise<string> {
    let kandidat = await this.nomorBerikutnya(organizationId, template)

    for (let percobaan = 0; percobaan < MAKS_PERCOBAAN_NOMOR; percobaan += 1) {
      // Cek tanpa menyaring jenis dokumen — sama seperti perhitungannya.
      // Kalau dicek per jenis, dokumen lain dengan nomor sama lolos dari cek
      // lalu ditolak database dengan P2002 yang tidak enak dibaca.
      const bentrok = await this.prisma.documentRecord.findUnique({
        where: {
          organizationId_documentNumber: { organizationId, documentNumber: kandidat },
        },
        select: { id: true },
      })

      if (!bentrok) return kandidat

      log.warn({ organizationId, template, kandidat }, 'nomor dokumen bentrok, mencoba nomor berikutnya')
      kandidat = await this.nomorBerikutnya(organizationId, template)
    }

    throw new DocumentError(
      'RENDER_FAILED',
      `Tidak bisa mendapat nomor dokumen yang kosong setelah ${MAKS_PERCOBAAN_NOMOR} percobaan. ` +
        'Coba lagi sebentar.',
    )
  }

  /** Baris tabel dari daftar hadir yang benar-benar ada. */
  private async barisDariAbsensi(input: CreateDocumentInput): Promise<
    Array<{ label: string; detail: string | null; status: string | null }>
  > {
    if (!input.attendanceEventId) {
      throw new DocumentError(
        'MISSING_FIELD',
        'Daftar hadir harus menunjuk daftar yang sudah ada. Ambil daftar lebih dulu lewat attendance_get.',
      )
    }

    const event = await this.prisma.attendanceEvent.findFirst({
      where: { id: input.attendanceEventId, organizationId: input.organizationId },
      select: { id: true, title: true, eventDate: true },
    })
    if (!event) {
      throw new DocumentError('MISSING_FIELD', 'Daftar yang dimaksud tidak ditemukan di organisasi ini.')
    }

    const entries = await this.prisma.attendanceEntry.findMany({
      where: { attendanceEventId: event.id },
      orderBy: { sortOrder: 'asc' },
      select: { displayName: true, className: true, status: true, reason: true },
    })

    const LABEL_STATUS: Record<string, string> = {
      PRESENT: 'Hadir',
      ABSENT: 'Alpa',
      EXCUSED: 'Izin',
      UNCONFIRMED: '',
    }

    return entries.map((entry) => ({
      label: entry.displayName,
      detail: entry.className,
      // Alpa dan izin wajib menyebut alasannya — tanpa alasan, orang tua
      // tidak bisa membedakan CICilan dan kemalasan.
      status: [LABEL_STATUS[entry.status] ?? entry.status, entry.reason].filter(Boolean).join(' — '),
    }))
  }
}

/** Batas percobaan mencari nomor dokumen yang belum dipakai. */
const MAKS_PERCOBAAN_NOMOR = 5

const PREFIX_TEMPLATE: Record<DocumentTemplate, string> = {
  surat_izin: 'SURAT',
  surat_tugas: 'SURAT',
  sertifikat: 'SERTIFIKAT',
  rekap_absensi: 'REKAP',
  daftar_hadir: 'DAFTAR',
}

/** Sidik jari isi berkas — untuk memastikan berkas tidak tertukar. */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16)
}