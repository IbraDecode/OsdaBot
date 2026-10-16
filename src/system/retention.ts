/**
 * Retensi data.
 *
 * ── Masalah yang diselesaikan ───────────────────────────────────────────────
 *
 * Dua modul terakhir sama-sama menambah baris tanpa batas:
 *
 * - **Rekaman jalan agent**: satu `AgentTask` + beberapa `AgentStep`, plus satu
 *   `ToolExecution` per pemanggilan tool, untuk **setiap** pesan.
 * - **Outbox**: satu baris per pesan keluar, tidak pernah dihapus.
 *
 * Untuk pilot terbatas ini aman. Berjalan berbulan-bulan, tabel-tabel ini
 * tumbuh tanpa henti dan tidak ada yang memperingatkan — termasuk operatornya.
 *
 * ── Aturan yang TIDAK bisa dilanggar ─────────────────────────────────────────
 *
 * 1. **Daftar putih, bukan daftar hitam.** Hanya tabel yang **tertulis** di
 *    `KEBIJAKAN` yang boleh dihapus. Tabel baru yang ditambahkan kemudian
 *    terlindungi secara bawaan.
 *
 *    Alasannya sederhana: penghapusan yang salah pada data bisnis tidak bisa
 *    dibatalkan. `Invoice` di repo ini sudah berisi 1276 baris transaksi
 *    nyata.
 *
 * 2. **Data bisnis mustahil masuk daftar.** `TABEL_BISNIS` dipakai `test`
 *    untuk memverifikasi tidak ada kebijakan yang menyentuh tabel itu — dan
 *    memverifikasi bahwa menjalankan pembersihan tidak mengubah satu baris pun
 *    dari tabel itu.
 *
 * 3. **Hanya yang selesai yang dihapus.** Outbox hanya boleh dibersihkan
 *    event yang sudah `DELIVERED`/`FAILED`/`UNKNOWN`. `PENDING` dan `SENDING`
 *    adalah pesan yang **masih harus terkirim**.
 *
 * 4. **Jumlah yang dihapus dicatat, isinya tidak.** Audit menyimpan hitungan
 *    dan rentang waktu. Menghapus data lalu menyalinnya ke audit berlawanan
 *    dengan tujuannya.
 *
 * ── Kenapa `Message` tidak boleh dihapus ────────────────────────────────────
 *
 * `Message` adalah konteks percakapan. Menghapusnya berarti bot lupa pernah
 * berbicara dengan orang itu — dan pengguna yang mengulang pertanyaannya akan
 * melihat bot yang kehilangan ingatan setiap beberapa menit.
 *
 * Ini bukan keputusan sementara. Kalau nanti diperlukan, itu keputusan produk
 * dengan persetujuan pengguna, bukan sekadar kebijakan retensi.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'retensi' })

export type NamaTabel = 'AgentTask' | 'AgentStep' | 'ToolExecution' | 'AuditLog' | 'OutboxEvent'

/**
 * Tabel yang **tidak boleh** pernah dihapus oleh modul ini.
 *
 * Dipakai `test` sebagai daftar yang diuji, dan dipakai saat runtime sebagai
 * pengaman kedua — kalau kebijakan baru memuat tabel
 * bisnis, proses berhenti daripada menghapus.
 */
export const TABEL_BISNIS = [
  'Organization',
  'OrganizationMember',
  'MemberAlias',
  'MemberIdentityLink',
  'User',
  'WhatsAppIdentity',
  'Conversation',
  'Message',
  'Event',
  'AttendanceEvent',
  'AttendanceEntry',
  'Task',
  'TaskAssignment',
  'TaskDependency',
  'FinanceAccount',
  'CashbookEntry',
  'Invoice',
  'InvoiceItem',
  'Payment',
  'PaymentTransaction',
  'DocumentRecord',
  'KnowledgeDocument',
  'KnowledgeChunk',
  'Group',
  'Approval',
] as const

/**
 * Bukti pada level tipe bahwa daftar kebijakan dan data bisnis tidak pernah
 * beririsan.
 *
 * Kalau ada `NamaTabel` yang sekaligus ada di `TABEL_BISNIS`, tipe di bawah
 * berubah jadi `never` dan baris deklarasi gagal build. Jadi "tidak bisa
 * menimpa data bisnis" dijamin oleh compiler, bukan oleh konvensi.
 *
 * Bentuknya `Extract` lalu `[never]`, bukan `[A] extends [B]`. Yang terakhir
 * adalah pemeriksaan **subtipe**, bukan kesamaan — `'AgentTask'` tetap
 * assignable ke `'Invoice' | 'AgentTask'`, jadi guard-nya lolos begitu saja.
 * Bug itu baru ketahuan karena bentuknya diuji terpisah dulu: `Exclude<X, Y>`
 * ternyata selalu mengembalikan `X` utuh kalau tidak ada tumpang tindih, jadi
 * tidak bisa dipakai sebagai bukti apa pun.
 */
type IrisanKebijakanDanBisnis = Extract<NamaTabel, (typeof TABEL_BISNIS)[number]>
type TumpangTindih = [IrisanKebijakanDanBisnis] extends [never] ? true : never

// Baris ini gagal build kalau kebijakan pernah menyentuh tabel bisnis.
const _buktiTidakTumpangTindih: TumpangTindih = true
void _buktiTidakTumpangTindih

export interface Kebijakan {
  tabel: NamaTabel
  /** Umur maksimum dalam hari. */
  hari: number
  /**
   * Hanya baris dengan nilai `status` ini yang boleh dihapus.
   *
   * Wajib untuk tabel antrean: pesan yang belum dikirim bukan sampah.
   */
  hanyaStatus?: readonly string[]
  /** Kenapa kebijakan ini ada. Wajib — kebijakan tanpa alasan akan kedaluwarsa tanpa terlihat. */
  alasan: string
}

export const KEBIJAKAN: readonly Kebijakan[] = [
  {
    tabel: 'AgentTask',
    hari: 30,
    alasan:
      'Rekaman operasional, bukan bukti. Gunanya untuk menjawab "kenapa bot ini salah" ' +
      'beberapa minggu terakhir; setelah itu tidak pernah ditanyakan.',
  },
  {
    tabel: 'AgentStep',
    hari: 30,
    alasan:
      'Selalu ikut induknya, dan punya batas sendiri supaya tidak bergantung pada aturan cascade.',
  },
  {
    tabel: 'ToolExecution',
    hari: 90,
    alasan:
      'Lebih halus dari AgentTask dan justru itu yang membuatnya berguna lebih lama: ' +
      'ToolExecution menjawab "tool apa yang gagal" bahkan setelah rekaman jalannya dihapus.',
  },
  {
    tabel: 'AuditLog',
    hari: 365,
    alasan:
      'Jejak kepatuhan. Paling panjang dari semua kebijakan — bukan berarti selamanya, tapi ' +
      'satu tahun bukan keputusan yang bisa diambil sepihak.',
  },
  {
    tabel: 'OutboxEvent',
    hari: 30,
    hanyaStatus: ['DELIVERED', 'FAILED', 'UNKNOWN'],
    alasan:
      'Hanya yang sudah selesai. PENDING dan SENDING adalah pesan yang masih harus terkirim, ' +
      'dan menghapusnya berarti membatalkan pengiriman tanpa ada yang diberi tahu.',
  },
]

/** Batas baris per tabel per siklus. Pengaturan yang salah tidak boleh fatal. */
const BATAS_PER_SIKLUS = 5_000

/** Ukuran satu potongan penghapusan. */
const UKURAN_POTONG = 500

export interface HasilPerTabel {
  tabel: NamaTabel
  /** Berapa yang akan/sebenarnya dihapus. */
  jumlah: number
  /** True kalau penghapusan terhenti di `BATAS_PER_SIKLUS` — sisanya masih ada. */
  kenaBatas: boolean
  alasan: string
}

export interface HasilKebersihan {
  dryRun: boolean
  perTabel: HasilPerTabel[]
  totalDihapus: number
  /** Tabel yang dilewati karena tidak punya kebijakan. */
  dilewati: string[]
}

export class RetentionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sekarang: () => Date = () => new Date(),
  ) {}

  /** Hitung dulu tanpa menghapus. Ini yang dipakai sebelum menjalankan sungguhan. */
  async perkiraan(kebijakan: readonly Kebijakan[] = KEBIJAKAN): Promise<HasilKebersihan> {
    return this.proses(true, kebijakan)
  }

  async jalankan(kebijakan: readonly Kebijakan[] = KEBIJAKAN): Promise<HasilKebersihan> {
    return this.proses(false, kebijakan)
  }

  private async proses(dryRun: boolean, kebijakan: readonly Kebijakan[]): Promise<HasilKebersihan> {
    const perTabel: HasilPerTabel[] = []
    let total = 0

    for (const k of kebijakan) {
      // Pengaman kedua, selain `test`. Kalau tabel bisnis entah bagaimana
      // masuk ke kebijakan, berhenti — jangan percaya caller.
      if ((TABEL_BISNIS as readonly string[]).includes(k.tabel as string)) {
        throw new Error(
          `Tabel "${k.tabel}" berisi data bisnis dan tidak boleh punya kebijakan retensi. ` +
            'Kalau ini muncul, seseorang salah menambah kebijakan.',
        )
      }

      const hasil = await this.prosesSatu(k, dryRun)
      perTabel.push(hasil)
      total += dryRun ? 0 : hasil.jumlah
    }

    if (!dryRun && total > 0) {
      // Yang dicatat: berapa, bukan apa. Isi baris yang dihapus tidak pernah
      // masuk ke log — tidak ada gunanya, dan mengambilnya berarti menyimpan
      // data yang sengaja dihapus.
      log.warn({ total, tabel: perTabel.map((p) => p.tabel) }, 'pembersihan retensi selesai')
    }

    return {
      dryRun,
      perTabel,
      totalDihapus: total,
      dilewati: TABEL_BISNIS.filter((t) =>
        !kebijakan.some((k) => k.tabel === (t as unknown as NamaTabel)),
      ),
    }
  }

  private async prosesSatu(k: Kebijakan, dryRun: boolean): Promise<HasilPerTabel> {
    const batasWaktu = new Date(this.sekarang().getTime() - k.hari * 24 * 60 * 60 * 1000)
    const jumlah = await this.hitungBaris(k.tabel, batasWaktu, k.hanyaStatus)

    if (dryRun) {
      return {
        tabel: k.tabel,
        jumlah,
        kenaBatas: jumlah > BATAS_PER_SIKLUS,
        alasan: k.alasan,
      }
    }

    const dihapus = await this.hapus(k.tabel, batasWaktu, k.hanyaStatus)
    return {
      tabel: k.tabel,
      jumlah: dihapus,
      kenaBatas: dihapus >= BATAS_PER_SIKLUS,
      alasan: k.alasan,
    }
  }

  // ── Per tabel ──────────────────────────────────────────────────────────
  //
  // Dispatcher eksplisit, bukan `prisma[tabel]`. Prisma tidak punya API
  // seragam "hapus yang lebih tua dari X" di seluruh model, dan akses
  // dinamis lewat `any` di sini berarti satu salah ketik menghapus dari
  // tabel yang salah — persis kesalahan yang paling mahal.

  private async hitungBaris(
    tabel: NamaTabel,
    batasWaktu: Date,
    hanyaStatus?: readonly string[],
  ): Promise<number> {
    switch (tabel) {
      case 'AgentTask':
        return this.prisma.agentTask.count({ where: { createdAt: { lt: batasWaktu } } })
      case 'AgentStep':
        return this.prisma.agentStep.count({ where: { createdAt: { lt: batasWaktu } } })
      case 'ToolExecution':
        return this.prisma.toolExecution.count({ where: { createdAt: { lt: batasWaktu } } })
      case 'AuditLog':
        return this.prisma.auditLog.count({ where: { createdAt: { lt: batasWaktu } } })
      case 'OutboxEvent':
        return this.prisma.outboxEvent.count({
          where: {
            createdAt: { lt: batasWaktu },
            // Tanpa ini, pesan yang belum terkirim ikut terhapus.
            status: { in: [...(hanyaStatus ?? [])] as never },
          },
        })
    }
  }

  private async hapus(
    tabel: NamaTabel,
    batasWaktu: Date,
    hanyaStatus?: readonly string[],
  ): Promise<number> {
    let total = 0

    while (total < BATAS_PER_SIKLUS) {
      const ambil = Math.min(UKURAN_POTONG, BATAS_PER_SIKLUS - total)
      const potongan = await this.ambilId(tabel, batasWaktu, hanyaStatus, ambil)
      if (potongan.length === 0) break

      const dihapus = await this.hapusId(tabel,potongan.map((b) => b.id))
      total += dihapus

      if (potongan.length < ambil) break
    }

    return total
  }

  private async ambilId(
    tabel: NamaTabel,
    batasWaktu: Date,
    hanyaStatus: readonly string[] | undefined,
    ambil: number,
  ): Promise<Array<{ id: string }>> {
    switch (tabel) {
      case 'AgentTask':
        return this.prisma.agentTask.findMany({
          where: { createdAt: { lt: batasWaktu } },
          select: { id: true },
          take: ambil,
        })
      case 'AgentStep':
        return this.prisma.agentStep.findMany({
          where: { createdAt: { lt: batasWaktu } },
          select: { id: true },
          take: ambil,
        })
      case 'ToolExecution':
        return this.prisma.toolExecution.findMany({
          where: { createdAt: { lt: batasWaktu } },
          select: { id: true },
          take: ambil,
        })
      case 'AuditLog':
        return this.prisma.auditLog.findMany({
          where: { createdAt: { lt: batasWaktu } },
          select: { id: true },
          take: ambil,
        })
      case 'OutboxEvent':
        return this.prisma.outboxEvent.findMany({
          where: {
            createdAt: { lt: batasWaktu },
            status: { in: [...(hanyaStatus ?? [])] as never },
          },
          select: { id: true },
          take: ambil,
        })
    }
  }

  private async hapusId(tabel: NamaTabel, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0

    switch (tabel) {
      case 'AgentTask': {
        // Anak dihapus lebih dulu dan eksplisit.
        //
        // `AgentStep.task` punya `onDelete: Cascade` jadi cascade cukup —
        // tapi bergantung padanya membuat penghapusan lebih sulit dibuktikan
        // benar. Satu baris eksplisit lebih murah daripada menebak.
        const langkah = await this.prisma.agentStep.findMany({
          where: { taskId: { in: ids } },
          select: { id: true },
        })
        if (langkah.length > 0) {
          await this.prisma.agentStep.deleteMany({ where: { id: { in: langkah.map((l) => l.id) } } })
        }
        return (await this.prisma.agentTask.deleteMany({ where: { id: { in: ids } } })).count
      }
      case 'AgentStep':
        return (await this.prisma.agentStep.deleteMany({ where: { id: { in: ids } } })).count
      case 'ToolExecution':
        return (await this.prisma.toolExecution.deleteMany({ where: { id: { in: ids } } })).count
      case 'AuditLog':
        return (await this.prisma.auditLog.deleteMany({ where: { id: { in: ids } } })).count
      case 'OutboxEvent':
        return (await this.prisma.outboxEvent.deleteMany({ where: { id: { in: ids } } })).count
    }
  }
}