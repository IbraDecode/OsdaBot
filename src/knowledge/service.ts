/**
 * Layanan pengetahuan — menyimpan dokumen organisasi dan menjawab pertanyaan
 * darinya.
 *
 * ── Yang membuat ini berbahaya ──────────────────────────────────────────────
 *
 * Ini adalah kemampuan yang paling rawan mengarang. Kalau pencarian gagal dan
 * sistem diam-diam menjawab dari ingatan model, hasilnya terdengar benar tapi
 * tidak ada sumbernya — dan untuk aturan organisasi ("berapa iuran?", "kapan
 * deadline?"), jawaban salah berarti orang salah bertindak.
 *
 * Karena itu:
 *
 * 1. **Hanya dokumen yang benar-benar ada yang boleh jadi sumber.** Tidak ada
 *    jawaban tanpa potongan teks yang cocok dan sumbernya yang bisa disebut.
 *
 * 2. **Dokumen kedaluwarsa tidak boleh dipakai.** `validUntil` yang sudah lewat
 *    berarti aturannya sudah diganti — menjawab dengan aturan lama sama
 *    berbahaya dengan menjawab tanpa sumber sama sekali.
 *
 * 3. **Offset disimpan, bukan cuma isi potongannya.** Jadi kutipan bisa
 *    ditelusuri kembali ke dokumen aslinya.
 *
 * 4. **Pencarian Bahasa Indonesia native.** PostgreSQL punya konfigurasi
 *    `indonesian` dengan stemming. Tanpa itu, "izin" tidak akan menemukan
 *    "permitted" — atau dalam kasus kita, kata kerja akan tidak cocok dengan
 *    berbagai bentuk turunannya.
 */
import type { PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'knowledge' })

export class KnowledgeError extends Error {
  constructor(
    readonly code: 'DOCUMENT_NOT_FOUND' | 'CONTENT_EMPTY' | 'CONTENT_TOO_LONG' | 'TITLE_REQUIRED' | 'NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'KnowledgeError'
  }
}

/**
 * Batas ukuran satu dokumen.
 *
 * 2 juta karakter ≈ 400 halaman. Di atas itu, penyebutan sumbernya sendiri
 * sudah tidak berguna — pembaca tidak akan pernah membukanya untuk mencocokkan.
 */
const MAKS_KARAKTER = 2_000_000
const MAKS_HASIL = 10

export interface IngestInput {
  organizationId: string
  title: string
  content: string
  documentType: string
  source?: string | null
  validFrom?: Date | null
  validUntil?: Date | null
  actorUserId: string | null
}

export interface SearchHit {
  documentId: string
  title: string
  documentType: string
  /** Potongan teks yang cocok, sudah dipotong agar muat. */
  excerpt: string
  /** Skor relevansi 0–1. */
  score: number
  ordinal: number
}

export class KnowledgeService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Simpan dokumen pengetahuan.
   *
   * Dokumen disimpan utuh lalu dipecah jadi potongan. Potongan menyimpan
   * offset ke dokumen asal supaya kutipan bisa ditelusuri kembali.
   */
  async ingest(input: IngestInput): Promise<{
    documentId: string
    title: string
    chunkCount: number
    characterCount: number
  }> {
    const judul = input.title.trim()
    if (judul === '') {
      throw new KnowledgeError('TITLE_REQUIRED', 'Judul dokumen wajib diisi.')
    }

    const isi = input.content.trim()
    if (isi === '') {
      throw new KnowledgeError('CONTENT_EMPTY', 'Dokumen kosong tidak bisa dicari.')
    }
    if (isi.length > MAKS_KARAKTER) {
      throw new KnowledgeError(
        'CONTENT_TOO_LONG',
        `Dokumen ${isi.length} karakter melebihi batas ${MAKS_KARAKTER}. Pecah jadi beberapa dokumen.`,
      )
    }

    const potongan = buatPotongan(isi)

    const doc = await this.prisma.$transaction(async (tx) => {
      const dibuat = await tx.knowledgeDocument.create({
        data: {
          organizationId: input.organizationId,
          title: judul,
          documentType: input.documentType,
          source: input.source ?? 'chat',
          content: isi,
          status: 'verified',
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
        },
        select: { id: true, title: true },
      })

      await tx.knowledgeChunk.createMany({
        data: potongan.map((p) => ({
          documentId: dibuat.id,
          ordinal: p.ordinal,
          content: p.content,
          startOffset: p.startOffset,
          endOffset: p.endOffset,
        })),
      })

      return dibuat
    })

    log.info(
      { organizationId: input.organizationId, chunks: potongan.length, chars: isi.length },
      'dokumen pengetahuan disimpan',
    )

    return {
      documentId: doc.id,
      title: doc.title,
      chunkCount: potongan.length,
      characterCount: isi.length,
    }
  }

  /**
   * Cari potongan yang relevan.
   *
   * Mengembalikan `[]` kalau tidak ada yang cocok. **Tidak pernah**
   * mengembalikan jawaban tanpa sumber.
   *
   * ── Kenapa OR, bukan AND ──────────────────────────────────────────────
   *
   * `websearch_to_tsquery` memakai AND: semua kata kunci harus muncul. Itu
   * benar untuk pencarian yang strict, tapi **selalu gagal untuk pertanyaan
   * natural**.
   *
   * Contoh nyata dari pengujian:
   *
   * ```
   * pertanyaan : "berapa iuran bulanan"
   * tsquery    : 'apa' & 'iur' & 'bulan'
   * dokumen    : "Iuran bulanan sebesar Rp 25.000 dibayar tanggal 10"
   * ```
   *
   * "berapa" tidak ada di dokumen — jadi hasilnya nol, padahal dokumen itu
   * persis yang dicari. Pertanyaan yang lebih baik akan tetap gagal begitu
   * saja.
   *
   * Jadi operand `&` diganti `|`, dan relevansi diurus `ts_rank`. Kata
   * ekstra menurunkan peringkat, bukan menghilangkan hasil.
   */
  async search(
    organizationId: string,
    query: string,
    options: { limit?: number; documentType?: string } = {},
  ): Promise<SearchHit[]> {
    const q = query.trim()
    if (q === '') return []

    const take = Math.min(options.limit ?? 5, MAKS_HASIL)

    // Filter tetap berupa parameter, bukan potongan SQL yang dirakit tangan.
    //
    // Menyusun `AND documentType = '...'` di luar query terdengar lebih
    // sederhana, tapi begitu ada satu nilai yang belum di-escape, itu-hole
    // SQL injection. Pola di bawah aman tanpa perlu memorandum.
    const tipeAda = options.documentType !== undefined
    const tipe = options.documentType ?? ''

    // Query kosong (semua kata adalah stopword) tidak bisa jadi tsquery —
    // `''::tsquery` itu error. Lebih baik kembalikan tidak ada hasil.
    const parsed = await this.prisma.$queryRaw<Array<{ q: string }>>`
      SELECT COALESCE(
        NULLIF(replace(websearch_to_tsquery('indonesian', ${q})::text, '&', '|'), ''),
        ''
      ) AS "q"
    `
    const tsquery = parsed[0]?.q ?? ''
    if (tsquery === '') return []

    // `$queryRaw` harus dipanggil sebagai TAG, bukan fungsi dengan kurung.
    // Kalau dipanggil `(... )`, Prisma menganggapnya salah pakai dan melempar
    // error — padahal SQL-nya sendiri benar.
    const rows = await this.prisma.$queryRaw<
      Array<{
        documentId: string
        title: string
        documentType: string
        content: string
        ordinal: number
        score: number
      }>
    >`
      SELECT
        kc."documentId"   AS "documentId",
        kd."title"        AS "title",
        kd."documentType" AS "documentType",
        kc."content"      AS "content",
        kc."ordinal"      AS "ordinal",
        ts_rank(
          to_tsvector('indonesian', kc."content"),
          ${tsquery}::tsquery
        ) AS "score"
      FROM "KnowledgeChunk" kc
      JOIN "KnowledgeDocument" kd ON kd."id" = kc."documentId"
      WHERE kd."organizationId" = ${organizationId}::uuid
        AND kd."status" = 'verified'
        AND (kd."validUntil" IS NULL OR kd."validUntil" > now())
        AND (kd."validFrom" IS NULL OR kd."validFrom" <= now())
        AND (${tipeAda} = false OR kd."documentType" = ${tipe})
        AND to_tsvector('indonesian', kc."content") @@ ${tsquery}::tsquery
      ORDER BY "score" DESC, kc."ordinal" ASC
      LIMIT ${take}
    `

    const hasil = rows.map((row) => ({
      documentId: row.documentId,
      title: row.title,
      documentType: row.documentType,
      excerpt: potongExcerpt(row.content, q),
      score: Number(row.score.toFixed(4)),
      ordinal: row.ordinal,
    }))

    if (hasil.length > 0) return hasil
    return this.cariCadangan(organizationId, q, take, options.documentType)
  }

  /**
   * Pencarian cadangan: pencocokan substring.
   *
   * Full-text searchuzione andal, tapi stemming Bahasa Indonesia punya
   * batasan nyata. Contoh yang ditemukan lewat pengujian:
   *
   * ```
   * pertanyaan : "gimana kalau tidak hadir"
   * dokumen    : "Ketidakhadiran tanpa keterangan resmi akan dicatat sebagai alfa"
   * ```
   *
   * Stemmer mengubah "hadir" menjadi "hadir" dan "ketidakhadiran" menjadi
   * bentuk lain — keduanya tidak cocok, padahal kata **"hadir" ada sebagai
   * substring** di dalam kata itu.
   *
   * Jadi kalau full-text tidak menemukan apa pun, cari substring. Hasil
   * cadangan diberi skor kecil supaya tidak mengalahkan hasil yang benar-benar
   * cocok — dan kalau ternyata tidak ada juga, jawabannya tetap kosong.
   */
  private async cariCadangan(
    organizationId: string,
    q: string,
    take: number,
    documentType?: string,
  ): Promise<SearchHit[]> {
    // Kata satu dan dua huruf terlalu umum — "di" dan "ke" cocok dengan
    // hampir semua dokumen dan menghasilkan relevansi yang terasa meyakinkan
    // tanpa dasar.
    const kata = q
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((k) => k.length >= 4)

    if (kata.length === 0) return []

    // Filter yang sama persis dengan pencarian utama. Kalau fallback mengabaikan
    // filter, pengguna yang menyaring "hanya peraturan" tetap mendapat dokumen
    // bertipe lain — dan tidak ada yang-upsan penyebabnya.
    const tipeAda = documentType !== undefined
    const tipe = documentType ?? ''

    const hasil: SearchHit[] = []
    const sudahAda = new Set<string>()

    // Satu per kata, bukan satu query dengan banyak LIKE.
    //
    // Menggabungkan jadi satu query butuh pola OR yang dirakit manual, dan
    // pola itu harus di-escape — di situlah SQL injection masuk. Yang di sini
    // selalu berupa parameter Prisma.
    for (const k of kata.slice(0, 5)) {
      const rows = await this.prisma.$queryRaw<
        Array<{ documentId: string; title: string; documentType: string; content: string; ordinal: number }>
      >`
        SELECT
          kc."documentId"   AS "documentId",
          kd."title"        AS "title",
          kd."documentType" AS "documentType",
          kc."content"      AS "content",
          kc."ordinal"      AS "ordinal"
        FROM "KnowledgeChunk" kc
        JOIN "KnowledgeDocument" kd ON kd."id" = kc."documentId"
        WHERE kd."organizationId" = ${organizationId}::uuid
          AND kd."status" = 'verified'
          AND (kd."validUntil" IS NULL OR kd."validUntil" > now())
          AND (kd."validFrom" IS NULL OR kd."validFrom" <= now())
          AND (${tipeAda} = false OR kd."documentType" = ${tipe})
          AND kc."content" ILIKE ${`%${k}%`}
        ORDER BY kc."ordinal" ASC
        LIMIT ${take}
      `

      for (const row of rows) {
        const kunci = `${row.documentId}:${row.ordinal}`
        if (sudahAda.has(kunci)) continue
        sudahAda.add(kunci)

        hasil.push({
          documentId: row.documentId,
          title: row.title,
          documentType: row.documentType,
          excerpt: potongExcerpt(row.content, q),
          // Skor sengaja kecil. Ini hasil cadangan — kalau diberi skor penuh,
          // ia bisa mengalahkan kecocokan yang benar-benar sudah-ranked.
          score: 0.01,
          ordinal: row.ordinal,
        })
      }
    }

    return hasil.slice(0, take)
  }

  /** Daftar dokumen pengetahuan organisasi. */
  async list(
    organizationId: string,
    options: { limit?: number } = {},
  ): Promise<
    Array<{
      id: string
      title: string
      documentType: string
      source: string
      status: string
      validUntil: Date | null
      chunkCount: number
    }>
  > {
    return this.prisma.knowledgeDocument.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 20,
      select: {
        id: true,
        title: true,
        documentType: true,
        source: true,
        status: true,
        validUntil: true,
        _count: { select: { chunks: true } },
      },
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        documentType: row.documentType,
        source: row.source,
        status: row.status,
        validUntil: row.validUntil,
        chunkCount: row._count.chunks,
      })),
    )
  }

  /**
   * Tandai dokumen tidak berlaku lagi.
   *
   * Dokumen TIDAK dihapus — riwayat keputusan penting, dan diam-diam menghapus
   * sumber yang pernah dipakai membuat atribusi lama tidak bisa diverifikasi.
   */
  async archive(documentId: string, organizationId: string): Promise<boolean> {
    const hasil = await this.prisma.knowledgeDocument.updateMany({
      where: { id: documentId, organizationId },
      data: { status: 'archived', validUntil: new Date() },
    })
    return hasil.count > 0
  }
}

const TARGET_POTONGAN = 1200
const MAKS_POTONGAN = 2000

/**
 * Pecah dokumen jadi potongan yang bisa dicari.
 *
 * Dipotong pada batas paragraf, bukan karakter sembarang: potongan yang
 * terpotong di tengah kalimat membuat kutipannya tidak bisa dipahami sendiri,
 * dan kutipan yang tidak dipahami tidak berguna untuk atribusi.
 */
export function buatPotongan(
  isi: string,
  target = TARGET_POTONGAN,
): Array<{ ordinal: number; content: string; startOffset: number; endOffset: number }> {
  const hasil: Array<{ ordinal: number; content: string; startOffset: number; endOffset: number }> = []
  let offset = 0
  let ordinal = 0

  // Batas potong Effective adalah yang lebih kecil dari `target` dan
  // MAKS_POTONGAN. Kalau hanya MAKS_POTONGAN yang dipakai, `target` jadi
  // tidak berpengaruh sama sekali untuk dokumen pendek — dan pemanggil yang
  // meminta potongan kecilnya dapat satu potongan besar.
  const batasPotong = Math.max(1, Math.min(target, MAKS_POTONGAN))

  while (offset < isi.length) {
    const sisa = isi.length - offset
    if (sisa <= batasPotong) {
      const content = isi.slice(offset).trim()
      if (content !== '') {
        hasil.push({ ordinal, content, startOffset: offset, endOffset: isi.length })
      }
      break
    }

    // Cari batas paragraf terdekat dalam rentang yang masuk akal.
    const jendela = isi.slice(offset, offset + target)
    const batas = findLastBreak(jendela, target)

    let content = jendela.slice(0, batas).trim()
    let panjang = content.length

    // Kalau tidak ada batas paragraf yang masuk akal, potong di whitespace
    // terdekat supaya kata tidak terpotong.
    if (batas <= 0) {
      const spasi = findLastBreakSpaces(jendela, target)
      content = jendela.slice(0, spasi).trim()
      panjang = content.length
    }

    if (content !== '') {
      hasil.push({ ordinal, content, startOffset: offset, endOffset: offset + panjang })
      ordinal += 1
    }

    offset += panjang
    // Lewati whitespace di antara potongan supaya tidak ada potongan kosong.
    while (offset < isi.length && /\s/.test(isi[offset]!)) offset += 1
  }

  return hasil
}

function findLastBreak(teks: string, minimal: number): number {
  for (let i = teks.length; i > minimal * 0.5; i -= 1) {
    const c = teks[i - 1]
    if (c === '\n' && teks[i - 2] === '\n') return i
  }
  return -1
}

function findLastBreakSpaces(teks: string, minimal: number): number {
  for (let i = teks.length; i > minimal * 0.5; i -= 1) {
    if (/\s/.test(teks[i - 1]!)) return i
  }
  return teks.length
}

/**
 * Potongan kutipan di sekitar kata kunci.
 *
 * Kalau tidak ada kata kunci yang cocok persis ( stemming berbeda, dll),
 * potongan awal dipakai — tidak pernah mengembalikan string kosong.
 */
export function potongExcerpt(content: string, query: string, radius = 220): string {
  const rendah = content.toLowerCase()
  const kunci = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 2)
    .sort((a, b) => b.length - a.length)

  let posisi = -1
  for (const k of kunci) {
    posisi = rendah.indexOf(k)
    if (posisi >= 0) break
  }

  if (posisi < 0) {
    return content.slice(0, radius * 2).trim()
  }

  const mulai = Math.max(0, posisi - radius)
  const selesai = Math.min(content.length, posisi + radius)
  const potong = content.slice(mulai, selesai).trim()
  return `${mulai > 0 ? '…' : ''}${potong}${selesai < content.length ? '…' : ''}`
}