/**
 * Monitoring agent — mendeteksi kemunduran yang tidak terlihat dari satu pesan.
 *
 * ── Yang sudah ada, dan yang belum ──────────────────────────────────────────
 *
 * `AgentTask`, `AgentStep`, dan `ToolExecution` sudah merekam apa yang terjadi.
 * Tapi semuanya itu **per kejadian**. Tidak ada yang melintasinya, jadi pola
 * berikut tidak terlihat dari satu pesan pun:
 *
 * ```
 * 08:00  "absen" → ZAKAT_FINANCE_CREATE gagal, argumen tidak lengkap
 * 08:02  "absen" → ZAKAT_FINANCE_CREATE gagal, argumen tidak lengkap
 * 08:03  "absen" → ZAKAT_FINANCE_CREATE gagal, argumen tidak lengkap
 * ```
 *
 * Tiga baris, semua "kegagalan biasa". Yang penting: **user yang sama mengulang
 * permintaan yang sama**. Itu bug prompt atau kemampuan yang belum ada — bukan
 * kebetulan. Tapi tidak ada yang memperingatkan.
 *
 * ── Prinsip yang dijaga ─────────────────────────────────────────────────────
 *
 * 1. **Yang dilaporkan harus bisa dihitung dari data.** Tidak ada "rasa" atau
 *    tebakan. Kalau sebuah sinyal tidak bisa dijawab dengan angka, ia bukan
 *    sinyal — ia opini.
 *
 * 2. **Deduplikasi lewat `fingerprint`.** Kolomnya sudah `@unique` di schema
 *    dengan alasan yang tepat: satu masalah, satu sinyal, angka `occurrences`
 *    yang bertambah. Kalau setiap kejadian jadi sinyal sendiri, notifikasi
 *    akan dibanjiri tepat saat masalahnya paling serius.
 *
 * 3. **Sinyal yang sudah beres dihentikan otomatis.** Kalau tidak, setiap
 *    masalah selesai akan meninggalkan baris `ACTIVE` selamanya, dan daftar
 *    sinyal akan jadi arsip, bukan daftar pekerjaan.
 *
 * 4. **Rekomendasi membedakan dasarnya.** `Recommendation.basis` memisahkan
 *    `evidence` (hitung dari rekaman), `heuristic` (kesimpulan darievidence),
 *    dan `speculative` (dugaan). Tebakan tidak boleh disajikan dengan nada
 *    yang sama dengan fakta.
 *
 * ── Yang TIDAK ada di sini ──────────────────────────────────────────────────
 *
 * `MonitoringConfiguration.notifyPolicy` dirancang untuk notifikasi (quiet
 * hours, digest). **Tidak diimplementasikan.** Mengirim "bot kamu sedang
 * gagal" ke WhatsApp organisasi tanpa diminta hanya menambah kebisingan —
 * dan itu keputusan yang butuh persetujuan orang, bukan default teknis.
 *
 *Sinyal di sini hanya bisa dilihat lewat `pnpm osda monitor:list`.
 */
import type { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'monitoring' })

export type JenisSinyal =
  | 'TOOL_FAILURE_REPEAT'
  | 'MAX_STEPS_REPEAT'
  | 'PROVIDER_ERROR'
  | 'EMPTY_RESPONSE_REPEAT'
  | 'SLOW_RESPONSE'

export interface Aturan {
  jenis: JenisSinyal
  /** Jendela pengamatan dalam menit. */
  jendelaMenit: number
  /**
   * Minimal kemunculan sebelum dianggap pola.
   *
   * Tanpa ini, satu kegagalan tunggal menjadi "sinyal" — dan pemeriksaan
   * berikutnya menaikkan `occurrences`, jadi satu kesalahan kecil terlihat
   * seperti masalah yang sedang tumbuh.
   */
  minimum: number
  judul: string
}

export const ATURAN_BAWAAN: readonly Aturan[] = [
  {
    jenis: 'TOOL_FAILURE_REPEAT',
    judul: 'Tool yang sama gagal berulang',
    jendelaMenit: 60,
    minimum: 3,
  },
  {
    jenis: 'MAX_STEPS_REPEAT',
    judul: 'Agent kehabisan langkah berulang',
    jendelaMenit: 60,
    minimum: 3,
  },
  {
    jenis: 'PROVIDER_ERROR',
    judul: 'Penyedia AI gagal berulang',
    jendelaMenit: 30,
    minimum: 3,
  },
  {
    jenis: 'EMPTY_RESPONSE_REPEAT',
    judul: 'Agent tidak bisa menjawab berulang',
    jendelaMenit: 120,
    minimum: 3,
  },
  {
    jenis: 'SLOW_RESPONSE',
    judul: 'Balasan jauh lebih lambat dari biasanya',
    jendelaMenit: 120,
    minimum: 3,
  },
]

/** Di atas ini dianggap lambat. Dua kali batas `AI_TIMEOUT_MS` yang umum. */
const AMBANG_LAMBAT_MS = 60_000

export interface SinyalTerlihat {
  jenis: JenisSinyal
  judul: string
  ringkasan: string
  bukti: Record<string, string | number>
  tingkat: 'INFO' | 'WARNING' | 'CRITICAL'
  /** Apa yang sebaiknya dilakukan — selalu tanpa Pretensikan. */
  saran: string
  /** Dasar saran: dihitung dari rekaman, atau disimpulkan darinya. */
  dasar: 'evidence' | 'heuristic'
}

export interface HasilEvaluasi {
  organizationId: string
  sejak: Date
  sampai: Date
  sinyalBaru: OrganizationSignalBaris[]
  sinyalDipulihkan: string[]
  /// Hitungan telemetry, bukan sinyal — supaya "tidak ada sinyal" bisa
  /// dibedakan dari "tidak ada yang diukur".
  diukur: {
    toolCalls: number
    agentRuns: number
    percakapan: number
  }
}

/**
 * Bentuk sinyal yang dikembalikan ke pemanggil.
 *
 * Membawa ringkasan, saran, dan dasarnya — bukan cuma jenisnya. Tanpa itu,
 * operator melihat "ada 7 sinyal" tapi tidak tahu apa yang gagal; jawabannya
 * ada di SQL, yang justru hal yang paling ingin dihindari.
 */
export interface OrganizationSignalBaris {
  id: string
  jenis: JenisSinyal
  judul: string
  tingkat: 'INFO' | 'WARNING' | 'CRITICAL'
  occurrences: number
  ringkasan: string
  saran: string
  dasar: 'evidence' | 'heuristic'
}

export class MonitoringService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sekarang: () => Date = () => new Date(),
  ) {}

  /**
   * Periksa satu organisasi.
   *
   * `dryRun` hanya menghitung dan mengembalikan apa yang **akan** disobor —
   * dipakai `pnpm osda monitor:run --dry-run` supaya operator bisa melihat
   * hasil SebelumSomething tersimpan.
   */
  async periksa(
    organizationId: string,
    options: { dryRun?: boolean; aturan?: readonly Aturan[] } = {},
  ): Promise<HasilEvaluasi> {
    // Aturan per organisasi mengalahkan bawaan.
    //
    // Ini yang membuat `MonitoringConfiguration` jadi tabel sungguhan dan
    // bukan hiasan: operator bisa menaikkan ambang untuk organisasi yang
    // memang ramai, tanpa mengubah perilaku organisasi lain.
    const aturan = options.aturan ?? (await this.aturanUntuk(organizationId))
    const dryRun = options.dryRun === true

    const sampai = this.sekarang()
    const jendelaTerpanjang = Math.max(...aturan.map((a) => a.jendelaMenit))
    const sejak = new Date(sampai.getTime() - jendelaTerpanjang * 60 * 1000)

    const terlihat = await this.kumpulkan(organizationId, sejak, sampai, aturan)
    const diukur = await this.hitungTelemetri(organizationId, sejak, sampai)

    const sinyalBaru: OrganizationSignalBaris[] = []
    const dipulihkan: string[] = []

    if (dryRun) {
      // Tanpa menulis apa pun: cukup ambil baris yang akan dibuat/dipulihkan.
      const yangAda = await this.prisma.organizationSignal.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { id: true, fingerprint: true, occurrences: true, detail: true },
      })
      const peta = new Map(yangAda.map((s) => [String((s.detail as { jenis?: string })?.jenis ?? ''), s]))

      for (const s of terlihat) {
        const ada = peta.get(s.jenis)
        sinyalBaru.push({
          id: ada?.id ?? '(baru)',
          jenis: s.jenis,
          judul: s.judul,
          tingkat: s.tingkat,
          occurrences: (ada?.occurrences ?? 0) + 1,
          ringkasan: s.ringkasan,
          saran: s.saran,
          dasar: s.dasar,
        })
      }
      dipulihkan.push(...yangAda.filter((s) => !terlihat.some((t) => t.jenis === (s.detail as { jenis?: string })?.jenis)).map((s) => s.id))
    } else {
      for (const s of terlihat) {
        sinyalBaru.push(await this.simpan(organizationId, s))
      }
      dipulihkan.push(...(await this.pulihkanYangSudahBeres(organizationId, terlihat)))
    }

    return { organizationId, sejak, sampai, sinyalBaru, sinyalDipulihkan: dipulihkan, diukur }
  }

  /**
   * Ambil aturan organisasi, atau bawaan kalau belum dikonfigurasi.
   *
   * Konfigurasi yang rusak **tidak** dipakai — kembali ke bawaan dan dicatat.
   * Menyimpan satu angka yang salah di `MonitoringConfiguration` lebih buruk
   * daripada tidak punya konfigurasi: yang kelihatan benar tapi diam-diam
   * tidak memonitor apa pun.
   */
  private async aturanUntuk(organizationId: string): Promise<readonly Aturan[]> {
    const config = await this.prisma.monitoringConfiguration.findFirst({
      where: { organizationId, enabled: true },
      orderBy: { createdAt: 'desc' },
      select: { rules: true, name: true },
    })
    if (!config) return ATURAN_BAWAAN

    const rules = (config.rules ?? {}) as { thresholds?: Record<string, { minimum?: number; jendelaMenit?: number }> }
    if (!rules.thresholds || typeof rules.thresholds !== 'object') {
      log.warn({ nama: config.name }, 'konfigurasi monitoring tidak punya thresholds — pakai bawaan')
      return ATURAN_BAWAAN
    }

    const hasil: Aturan[] = []
    for (const bawaan of ATURAN_BAWAAN) {
      const ubah = rules.thresholds[bawaan.jenis]
      if (!ubah) {
        hasil.push(bawaan)
        continue
      }

      const minimum = Number(ubah.minimum ?? bawaan.minimum)
      const jendela = Number(ubah.jendelaMenit ?? bawaan.jendelaMenit)
      if (!Number.isInteger(minimum) || minimum < 1) {
        log.warn({ jenis: bawaan.jenis, minimum }, 'threshold minimum tidak valid — pakai bawaan')
        hasil.push(bawaan)
        continue
      }
      hasil.push({ ...bawaan, minimum, jendelaMenit: jendela >= 1 ? jendela : bawaan.jendelaMenit })
    }

    return hasil
  }

  /** Simpan konfigurasi aturan untuk satu organisasi. */
  async konfigurasi(input: {
    organizationId: string
    name: string
    thresholds: Record<string, { minimum?: number; jendelaMenit?: number }>
    timezone?: string
  }): Promise<{ id: string; name: string }> {
    const baris = await this.prisma.monitoringConfiguration.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        enabled: true,
        rules: { thresholds: input.thresholds },
        timezone: input.timezone ?? 'Asia/Makassar',
      },
      select: { id: true, name: true },
    })
    return baris
  }

  // ── Deteksi ────────────────────────────────────────────────────────────────

  private async kumpulkan(
    organizationId: string,
    sejak: Date,
    sampai: Date,
    aturan: readonly Aturan[],
  ): Promise<SinyalTerlihat[]> {
    const hasil: SinyalTerlihat[] = []
    const untuk = (jenis: JenisSinyal) => aturan.find((a) => a.jenis === jenis)

    // ── Tool yang sama gagal berulang ──────────────────────────────────
    //
    // Dikelompokkan per (tool, kode error) — bukan per tool saja. `NOT_FOUND`
    // dan `VALIDATION_FAILED` untuk tool yang sama adalah dua masalah
    // berbeda: yang pertama berarti datanya salah, yang kedua berarti model
    // salah paham kontrak tool.
    const aturanTool = untuk('TOOL_FAILURE_REPEAT')
    if (aturanTool) {
      const jendela = jendelaAtau(sejak, sampai, aturanTool.jendelaMenit)
      const gagal = await this.prisma.toolExecution.groupBy({
        by: ['toolName', 'errorCode'],
        where: { organizationId, createdAt: { gte: jendela }, outcome: { not: 'success' } },
        _count: { _all: true },
      })

      for (const baris of gagal) {
        if (baris._count._all < aturanTool.minimum) continue
        const kode = baris.errorCode ?? 'TIDAK_TERDAFTAR'

        hasil.push({
          jenis: aturanTool.jenis,
          judul: aturanTool.judul,
          ringkasan:
            `${baris.toolName} gagal ${baris._count._all}× dengan ${kode} dalam ${aturanTool.jendelaMenit} menit`,
          bukti: { tool: baris.toolName, errorCode: kode, jumlah: baris._count._all },
          tingkat: 'WARNING',
          saran:
            `Buka rekaman jalan yang memakai ${baris.toolName} (` +
            `pnpm osda run:list). Kalau argumennya memang tidak lengkap dari sisi pengguna, ` +
            `deskripsi tool-nya perlu diperjelas; kalau lengkap, bug-nya di tool.`,
          dasar: 'evidence',
        })
      }
    }

    // ── Alasan berhenti agent ───────────────────────────────────────────
    for (const jenis of ['MAX_STEPS_REPEAT', 'PROVIDER_ERROR', 'EMPTY_RESPONSE_REPEAT'] as const) {
      const aturanJalan = untuk(jenis)
      if (!aturanJalan) continue

      const jendela = jendelaAtau(sejak, sampai, aturanJalan.jendelaMenit)
      const kode = jenis === 'MAX_STEPS_REPEAT' ? 'MAX_STEPS' : jenis === 'PROVIDER_ERROR' ? 'LLM_ERROR' : 'EMPTY_RESPONSE'

      const baris = await this.prisma.agentTask.groupBy({
        by: ['errorCode'],
        where: { organizationId, createdAt: { gte: jendela }, errorCode: kode },
        _count: { _all: true },
      })

      const total = baris.reduce((n, b) => n + b._count._all, 0)
      if (total < aturanJalan.minimum) continue

      const sarannya =
        jenis === 'MAX_STEPS_REPEAT'
          ? 'Agent berputar tanpa selesai. Urutan kemungkinan: skill tidak memanggil tool yang benar, ' +
            'atau langkah yang dibutuhkan memang tidak ada kemampuannya. Cek run yang ber-alasan MAX_STEPS.'
          : jenis === 'PROVIDER_ERROR'
            ? 'Penyedia AI yang bermasalah, bukan kode. Cek `pnpm osda doctor` dan status gateway. ' +
              'Tidak ada yang perlu diubah di prompt selama ini berjalan.'
            : 'Model mengembalikan kosong. Sering berarti konteks percakapan terlalu panjang atau ' +
              'tidak ada tool yang relevan — cek run EMPTY_RESPONSE di `pnpm osda run:list`.'

      hasil.push({
        jenis,
        judul: aturanJalan.judul,
        ringkasan: `${total} jalan agent berhenti dengan ${kode} dalam ${aturanJalan.jendelaMenit} menit`,
        bukti: { errorCode: kode, jumlah: total, jendelaMenit: aturanJalan.jendelaMenit },
        // Provider error adalah masalah infrastruktur, bukan kode: ini yang
        // paling perlu perhatian segera meski penyebabnya ada di luar kendali.
        tingkat: jenis === 'PROVIDER_ERROR' ? 'CRITICAL' : 'WARNING',
        saran: sarannya,
        dasar: jenis === 'PROVIDER_ERROR' ? 'evidence' : 'heuristic',
      })
    }

    // ── Balasan lambat ──────────────────────────────────────────────────
    //
    // Dihitung dari `state.durasiMs` yang sudah ditulis rekaman jalan — bukan
    // dari log. Log tidak punya bentuk yang bisa dijawab.
    const aturanLambat = untuk('SLOW_RESPONSE')
    if (aturanLambat) {
      const jendela = jendelaAtau(sejak, sampai, aturanLambat.jendelaMenit)
      const lambat = await this.prisma.agentTask.findMany({
        where: { organizationId, createdAt: { gte: jendela } },
        select: { state: true },
      })

      const durasi = lambat
        .map((r) => Number((r.state as { durasiMs?: number })?.durasiMs ?? 0))
        .filter((d) => d > AMBANG_LAMBAT_MS)

      if (durasi.length >= aturanLambat.minimum) {
        const rata = Math.round(durasi.reduce((n, d) => n + d, 0) / durasi.length / 1000)
        hasil.push({
          jenis: aturanLambat.jenis,
          judul: aturanLambat.judul,
          ringkasan: `${durasi.length} jalan agent lewat ${AMBANG_LAMBAT_MS / 1000} detik (rata-rata ${rata} detik)`,
          bukti: { jumlah: durasi.length, rataDetik: rata, ambangDetik: AMBANG_LAMBAT_MS / 1000 },
          tingkat: 'INFO',
          saran:
            'Bandingkan dengan `pnpm osda run:list`: kalau langkahnya banyak, masalahnya konkurensi tool. ' +
            'Kalau hanya satu langkah, bottleneck-nya di penyedia AI.',
          dasar: 'evidence',
        })
      }
    }

    return hasil
  }

  // ── Penyimpanan sinyal ────────────────────────────────────────────────────

  /**
   * Sidik jari yang stabil untuk satu jenis masalah dalam satu organisasi.
   *
   * Tanpa bagian jumlahnya: masalah yang berulang **menaikkan** `occurrences`,
   * bukan membuat baris baru. Kalau jumlah ikut jadi bagian sidik jari, setiap
   * kejadian akan menjadi sinyal baru — persis kebanjiran yang dicegah lewat
   * kolom `fingerprint` yang unik di schema.
   *
   * Bagian yang tersisa (nama tool, kode error) justru ikut karena dua
   * kegagalan berbeda di tool yang sama adalah dua masalah yang berbeda.
   */
  private fingerprint(organizationId: string, s: SinyalTerlihat): string {
    const bukti = Object.entries(s.bukti)
      .filter(([k]) => k !== 'jumlah')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(';')

    return createHash('sha256')
      .update(`${organizationId}|${s.jenis}|${bukti}`)
      .digest('hex')
      .slice(0, 32)
  }

  private async simpan(organizationId: string, s: SinyalTerlihat): Promise<OrganizationSignalBaris> {
    const fingerprint = this.fingerprint(organizationId, s)

    const baris = await this.prisma.organizationSignal.upsert({
      where: { fingerprint },
      create: {
        organizationId,
        type: s.jenis,
        entityType: 'organization',
        severity: s.tingkat,
        fingerprint,
        occurrences: 1,
        detail: { jenis: s.jenis, judul: s.judul, ringkasan: s.ringkasan, bukti: s.bukti, saran: s.saran, dasar: s.dasar },
      },
      update: {
        // Naik satu kali per evaluasi, bukan satu kali per kejadian — supaya
        // angkanya bisa dibaca sebagai "berapa kali kita memeriksa dan masih
        // melihat hal yang sama".
        occurrences: { increment: 1 },
        severity: s.tingkat,
        status: 'ACTIVE',
        resolvedAt: null,
        detail: { jenis: s.jenis, judul: s.judul, ringkasan: s.ringkasan, bukti: s.bukti, saran: s.saran, dasar: s.dasar },
      },
      select: { id: true, type: true, severity: true, occurrences: true },
    })

    return {
      id: baris.id,
      jenis: s.jenis,
      judul: s.judul,
      tingkat: baris.severity,
      occurrences: baris.occurrences,
      ringkasan: s.ringkasan,
      saran: s.saran,
      dasar: s.dasar,
    }
  }

  /**
   * Sinyal yang tidak terdeteksi lagi ditandai `RESOLVED`.
   *
   * Kalau tidak, setiap masalah yang sudah beres akan meninggalkan baris
   * `ACTIVE` selamanya dan daftarnya jadi arsip, bukan daftar pekerjaan.
   */
  private async pulihkanYangSudahBeres(organizationId: string, terlihat: SinyalTerlihat[]): Promise<string[]> {
    const aktif = await this.prisma.organizationSignal.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, type: true },
    })

    const masihAda = new Set(terlihat.map((s) => s.jenis))
    const selesai = aktif.filter((s) => !masihAda.has(s.type as JenisSinyal))
    if (selesai.length === 0) return []

    await this.prisma.organizationSignal.updateMany({
      where: { id: { in: selesai.map((s) => s.id) } },
      data: { status: 'RESOLVED', resolvedAt: this.sekarang() },
    })

    log.info({ jumlah: selesai.length }, 'sinyal ditandai selesai')
    return selesai.map((s) => s.id)
  }

  // ── Rekomendasi ────────────────────────────────────────────────────────────

  /**
   * Rekomendasi dari sinyal aktif.
   *
   * `basis` diambil dari sinyalnya, bukan ditebak di sini. Kalau sarannya
   * berdasarkan kesimpulan, kesimpulannya ditulis sebagai kesimpulan.
   */
  async rekomendasikan(
    organizationId: string,
  ): Promise<Array<{ summary: string; reasoning: string; basis: string; confidence: number | null }>> {
    const aktif = await this.prisma.organizationSignal.findMany({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: { severity: 'desc' },
    })

    return aktif.map((s) => {
      const detail = (s.detail ?? {}) as { judul?: string; saran?: string; dasar?: string; ringkasan?: string }
      const dasar = detail.dasar === 'evidence' ? 'evidence' : 'heuristic'

      return {
        summary: detail.judul ?? s.type,
        reasoning: `${detail.ringkasan ?? 'tanpa detail'}${detail.saran ? ` ${detail.saran}` : ''}`,
        basis: dasar,
        // `confidence` tidak dihitung dari data — tidak ada model yang menghasilkannya.
        // `null` berarti "tidak ada", dan lebih jujur daripada angka yang
        // terlihat seperti hasil pengukuran.
        confidence: null,
      }
    })
  }

  /**
   * Simpan rekomendasi ke tabel.
   *
   * Idempoten per isi: pemeriksaan ulang yang menghasilkan rekomendasi sama
   * persis tidak menambah baris baru. Tanpa itu, satu masalah yang bertahan
   * seminggu menghasilkan tujuh rekomendasi yang isinya identik — dan daftar
   * yang isinya kembar tidak dibaca siapa pun.
   */
  async simpanRekomendasi(organizationId: string): Promise<number> {
    const daftar = await this.rekomendasikan(organizationId)
    if (daftar.length === 0) return 0

    let tersimpan = 0
    for (const r of daftar) {
      const fingerprint = createHash('sha256')
        .update(`${organizationId}|${r.summary}|${r.reasoning}`)
        .digest('hex')
        .slice(0, 32)

      const ada = await this.prisma.recommendation.findFirst({
        where: { organizationId, status: 'active', summary: r.summary, reasoning: r.reasoning },
        select: { id: true },
      })
      if (ada) continue

      await this.prisma.recommendation.create({
        data: {
          organizationId,
          summary: r.summary,
          reasoning: r.reasoning,
          basis: r.basis,
          confidence: r.confidence,
          evidenceRefs: { fingerprint },
        },
      })
      tersimpan += 1
    }
    return tersimpan
  }

  // ── Telemetri ──────────────────────────────────────────────────────────────

  private async hitungTelemetri(organizationId: string, sejak: Date, sampai: Date) {
    void sampai
    const [toolCalls, agentRuns, percakapan] = await Promise.all([
      this.prisma.toolExecution.count({ where: { organizationId, createdAt: { gte: sejak } } }),
      this.prisma.agentTask.count({ where: { organizationId, createdAt: { gte: sejak } } }),
      this.prisma.conversation.count({ where: { lastMessageAt: { gte: sejak } } }),
    ])
    return { toolCalls, agentRuns, percakapan }
  }
}

/** Jendela efektif untuk satu aturan — tidak pernah melebihi jendela terpanjang. */
function jendelaAtau(sejak: Date, sampai: Date, menit: number): Date {
  const mulai = new Date(sampai.getTime() - menit * 60 * 1000)
  return mulai > sejak ? mulai : sejak
}