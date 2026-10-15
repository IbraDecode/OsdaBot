/**
 * Layanan tugas organisasi.
 *
 * ── Kenapa ini perlu ───────────────────────────────────────────────────────
 *
 * Chat WhatsApp adalah tempat orang bertanya "tugas saya apa saja". Tanpa
 * sistem tugas, jawaban itu hanya ada di kepala masing-masing orang — dan yang
 * paling lambat bergerak adalah orang yang paling lama menunda.
 *
 * ── Yang dijaga di sini ────────────────────────────────────────────────────
 *
 * 1. **Anggota harus milik organisasi yang sama.** `TaskAssignment` menautkan
 *    tugas ke anggota, tapi tidak ada constraint database yangzerwgrass kedua
 *    sisinya. Tanpa pengecekan, tugas organisasi A bisa ditugaskan ke anggota
 *    organisasi B — judul tugas dan keterangannya ikut terbawa lintas
 *    perusahaan.
 *
 * 2. **Siklus dependensi ditolak.** `A bergantung pada B` dan `B bergantung
 *    pada A` membuat keduanya tidak akan pernah bisa diselesaikan. Bukan
 *    masalah tampilan — datanya jadi salah dan tidak ada jalan keluar.
 *
 * 3. **Tugas yang belum bisa dikerjakan harus terlihat.** Tugas dengan
 *    ketergantungan yang belum selesai **tidak** bisa dianggap " actionable".
 * *Tidak Fabrication*, dan tidak dihapus dari daftar — ditandai.
 *
 * 4. **Menyelesaikan tugas berdependensi butuh pengakuan eksplisit.** Diblokir
 *    total adalah langkah yang terlalu jauh (kadang memang harus mendahului),
 *    tapi menerimanya diam-diam berarti "selesai" bisa jadi tidak jujur.
 *
 * 5. **Tanggal tenggat tidak pernah disimpan sebagai "terlambat".**-status
 *    `overdue` selalu dihitung saat baca, jadi jam sistem yang salah hanya
 *    memperbaiki dirinya sendiri.
 */
import type { PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'tasks' })

/** Status tugas. `blocked` TIDAK disimpan — itu turunan dari dependensi. */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'

export const TASK_STATUS: readonly TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled']

/** Prioritas 1 (paling mendesak) sampai 5 (paling longgar). */
const MIN_PRIORITY = 1
const MAX_PRIORITY = 5

/**
 * Batas baris yang diambil dari database sebelum diurutkan di memori.
 *
 * Tugas satu organisasi realistisnya puluhan–ratusan. Ambil semua, urutkan
 * di aplikasi, baru potong sesuai `limit` — supaya "5 tugas paling mendesak"
 * benar-benar yang 5 paling mendesak, bukan 5 pertama yang tersimpan acak.
 */
const BATAS_PEMBACAAN = 500

export class TaskError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'VALIDATION'
      | 'CROSS_ORGANIZATION'
      | 'DEPENDENCY_CYCLE'
      | 'BLOCKED',
    message: string,
  ) {
    super(message)
    this.name = 'TaskError'
  }
}

export interface TaskRow {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  dueAt: Date | null
  completedAt: Date | null
  createdAt: Date
  /** Tugas lain yang harus selesai lebih dulu. */
  dependencies: Array<{ id: string; title: string; status: string }>
  /** Tugas ini yang jadi halangan bagi tugas lain. */
  dependents: Array<{ id: string; title: string; status: string }>
  assignments: Array<{ memberId: string; memberName: string; status: string }>
  /** Tugas belum bisa dikerjakan karena dependensi belum selesai. */
  blocked: boolean
  /** Lewat tenggat dan belum selesai. */
  overdue: boolean
}

export interface CreateTaskInput {
  organizationId: string
  title: string
  description?: string | null
  /** ID anggota — sudah diverifikasi oleh pemanggil. */
  assigneeMemberIds?: string[]
  /** Tugas yang harus selesai lebih dulu. */
  dependsOnTaskIds?: string[]
  dueAt?: Date | null
  priority?: number
  eventId?: string | null
}

export class TaskService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Membaca ───────────────────────────────────────────────────────────────

  async list(input: {
    organizationId: string
    /**
     * - `open`    — belum selesai dan belum dibatalkan (default)
     * - `overdue` — punya tenggat yang sudah lewat, belum selesai
     * - `done`    — selesai
     * - atau status tunggal
     */
    filter?: 'open' | 'overdue' | 'done' | TaskStatus
    assigneeMemberId?: string
    eventId?: string
    limit?: number
    now?: Date
  }): Promise<TaskRow[]> {
    const now = input.now ?? new Date()
    const filter = input.filter ?? 'open'

    const where: Record<string, unknown> = { organizationId: input.organizationId }

    if (filter === 'open') {
      where.status = { in: ['todo', 'in_progress'] }
    } else if (filter === 'done') {
      where.status = 'done'
    } else if (filter === 'overdue') {
      // Dihitung di memori (lihat `overdue`), tapi dism narrowingkan agar
      // baris yang sudah selesai tidak ikut terbaca.
      where.status = { in: ['todo', 'in_progress'] }
      where.dueAt = { not: null, lt: now }
    } else {
      where.status = filter
    }

    if (input.assigneeMemberId) {
      where.assignments = { some: { memberId: input.assigneeMemberId } }
    }
    if (input.eventId) {
      where.eventId = input.eventId
    }

    const raw = await this.prisma.task.findMany({
      where,
      take: BATAS_PEMBACAAN,
      orderBy: { createdAt: 'desc' },
      include: {
        dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
        dependents: { include: { task: { select: { id: true, title: true, status: true } } } },
        assignments: {
          include: {
            member: { select: { id: true, fullName: true, className: true } },
          },
        },
      },
    })

    const rows = raw.map((t) => keBaris(t, now))
    if (filter === 'overdue') {
      return rows
        .filter((r) => r.overdue)
        .sort(urutkan)
        .slice(0, input.limit ?? 20)
    }
    return rows.sort(urutkan).slice(0, input.limit ?? 20)
  }

  async get(organizationId: string, taskId: string, now = new Date()): Promise<TaskRow> {
    const raw = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: {
        dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
        dependents: { include: { task: { select: { id: true, title: true, status: true } } } },
        assignments: { include: { member: { select: { id: true, fullName: true, className: true } } } },
      },
    })

    if (!raw) throw new TaskError('NOT_FOUND', 'Tugas tidak ditemukan di organisasi ini.')
    return keBaris(raw, now)
  }

  /**
   * Cari tugas berdasarkan potongan judul.
   *
   * Dipakai untuk rujukan seperti "tugas proposal itu sudah selesai?" tanpa
   * harus menyebut UUID. Kalau lebih dari satu cocok, pemanggil **wajib**
   * bertanya — menebak tugas yang salah berarti memberi status yang salah
   * untuk pekerjaan orang.
   */
  async searchByTitle(
    organizationId: string,
    query: string,
    options: { openOnly?: boolean } = {},
  ): Promise<TaskRow[]> {
    const now = new Date()
    const raw = await this.prisma.task.findMany({
      where: {
        organizationId,
        ...(options.openOnly ? { status: { in: ['todo', 'in_progress'] } } : {}),
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
        dependents: { include: { task: { select: { id: true, title: true, status: true } } } },
        assignments: { include: { member: { select: { id: true, fullName: true, className: true } } } },
      },
    })
    return raw.map((t) => keBaris(t, now))
  }

  // ── Menulis ───────────────────────────────────────────────────────────────

  async create(input: CreateTaskInput): Promise<TaskRow> {
    if (input.title.trim() === '') {
      throw new TaskError('VALIDATION', 'Judul tugas tidak boleh kosong.')
    }

    const memberIds = [...new Set(input.assigneeMemberIds ?? [])]
    const dependencyIds = [...new Set(input.dependsOnTaskIds ?? [])]

    // Cek anggota SEBELUM menulis apa pun. Pesan penolakannya menyebut
    // organisasi asal, bukan "anggota tidak ditemukan" — supaya alasan
    // penolakan tidak perlu ditebak.
    await this.pastikanAnggotaMilik(memberIds, input.organizationId)
    await this.pastikanTugasMilik(dependencyIds, input.organizationId)

    // Tidak ada pemeriksaan siklus di sini. Tugas yang baru dibuat belum punya
    // sisi masuk sama sekali — tidak ada yang bisa bergantung padanya — jadi
    // secara struktur tidak mungkin membentuk lingkaran.
    //
    // Yang checked nanti, setiap kali dependensi ditambahkan ke tugas yang
    // sudah ada.

    const dibuat = await this.prisma.task.create({
      data: {
        organizationId: input.organizationId,
        title: input.title.trim(),
        description: input.description ?? null,
        priority: await this.normalisasiPrioritas(input.priority),
        dueAt: input.dueAt ?? null,
        eventId: input.eventId ?? null,
        assignments: memberIds.length
          ? { create: memberIds.map((memberId) => ({ memberId })) }
          : undefined,
        dependencies: dependencyIds.length
          ? { create: dependencyIds.map((dependsOnTaskId) => ({ dependsOnTaskId })) }
          : undefined,
      },
      select: { id: true },
    })

    log.info({ taskId: dibuat.id, memberIds, dependencyIds }, 'tugas dibuat')
    return this.get(input.organizationId, dibuat.id)
  }

  /**
   * Ubah isi atau status tugas.
   *
   * `status: 'done'` **sengaja tidak ada di sini**. Satu-satunya jalan ke
   * "selesai" adalah `complete()`, karena di situ ada pemeriksaan dependensi.
   *
   * Kalau `done` diterima di sini, celah muncul: satu tool bisa menandai
   * selesai lewat `update` dan melewati seluruh pemeriksaan, sementara tool
   * lain menolak. Dua jalur, dua perilaku — dan yang longgar biasanya yang
   * dipakai.
   */
  async update(
    organizationId: string,
    taskId: string,
    patch: {
      title?: string
      description?: string | null
      priority?: number
      dueAt?: Date | null
      status?: Exclude<TaskStatus, 'done'>
      eventId?: string | null
    },
  ): Promise<TaskRow> {
    // Melempar `NOT_FOUND` kalau tugas bukan milik organisasi ini.
    await this.ambil(organizationId, taskId)

    const data: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      if (patch.title.trim() === '') throw new TaskError('VALIDATION', 'Judul tugas tidak boleh kosong.')
      data.title = patch.title.trim()
    }
    if (patch.description !== undefined) data.description = patch.description
    if (patch.priority !== undefined) data.priority = await this.normalisasiPrioritas(patch.priority)
    if (patch.dueAt !== undefined) data.dueAt = patch.dueAt
    if (patch.eventId !== undefined) data.eventId = patch.eventId

    if (patch.status !== undefined) {
      data.status = patch.status
      // Status selain `done`/`cancelled` berarti tugas dihidupkan kembali, jadi
      // jejak "selesai pada..." harus dihapus. Kalau dibiarkan, daftar tugas
      // akan menampilkan tugas aktif dengan tanggal selesai yang sudah lama.
      data.completedAt = null
    }

    if (Object.keys(data).length === 0) {
      throw new TaskError('VALIDATION', 'Tidak ada yang diubah.')
    }

    await this.prisma.task.update({ where: { id: taskId }, data })
    return this.get(organizationId, taskId)
  }

  /**
   * Tandai selesai.
   *
   * Kalau masih ada dependensi yang belum selesai, operasi **ditolak** dulu
   * dan daftarnya dikembalikan. Pemanggil bisa mengulang dengan
   * `force: true` — jalan keluar untuk kasus nyata ketika urutan memang
   * harus dibalik.
   */
  async complete(
    organizationId: string,
    taskId: string,
    options: { force?: boolean } = {},
  ): Promise<{ task: TaskRow;dependensiBelumSelesai: string[] }> {
    const tugas = await this.get(organizationId, taskId)

    if (tugas.status === 'done') {
      return { task: tugas,dependensiBelumSelesai: [] }
    }

    const belum = tugas.dependencies.filter((d) => d.status !== 'done' && d.status !== 'cancelled')

    if (belum.length > 0 && !options.force) {
      throw new TaskError(
        'BLOCKED',
        `Tugas ini bergantung pada ${belum.length} tugas yang belum selesai: ` +
          belum.map((d) => `"${d.title}" (${d.status})`).join(', ') +
          '. Tandai yang lain dulu, atau ulangi dengan pengakuan bahwa urutan memang dibalik.',
      )
    }

    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'done', completedAt: new Date() },
    })

    if (belum.length > 0) {
      log.warn(
        { taskId, belumSelesai: belum.map((d) => d.title) },
        'tugas diselesaikan meski dependensinya belum selesai — atas pengakuan pemanggil',
      )
    }

    return { task: await this.get(organizationId, taskId), dependensiBelumSelesai: belum.map((d) => d.title) }
  }

  /**
   * Atur penugasan.
   *
   * `mode: 'add'` menambah, `'remove'` mengurangi, `'replace'` mengganti
   * seluruh daftar.
   */
  async assign(
    organizationId: string,
    taskId: string,
    memberIds: string[],
    mode: 'add' | 'remove' | 'replace' = 'add',
  ): Promise<TaskRow> {
    await this.ambil(organizationId, taskId)
    const unik = [...new Set(memberIds)]

    // Sama seperti pembuatan: keanggotaan diperiksa lebih dulu. Menugaskan
    // anggota organisasi lain adalah kebocoran lintas perusahaan, bukan sekadar
    // data yang salah.
    await this.pastikanAnggotaMilik(unik, organizationId)

    const sekarang = await this.prisma.taskAssignment.findMany({
      where: { taskId },
      select: { memberId: true },
    })
    const punya = new Set(sekarang.map((a) => a.memberId))

    const tambah = mode === 'replace' ? unik.filter((m) => !punya.has(m)) : unik

    // `replace` harus menghapus juga. Kalau hanya menambahkan, "ganti
    // penugas" diam-diam berubah jadi "tambah penugas" — dan orang yang
    // ditugaskan lama tetap punya tugas tanpa pernah diminta orang.
    const kurang = mode === 'remove' ? unik : mode === 'replace' ? [...punya] : []

    // Hapus hanya yang benar-benar ada, supaya "remove" untuk anggota yang
    // tidak ditugaskan tidak melempar error P2025 yang tidak informatif.
    const hapusValid = kurang.filter((m) => punya.has(m))
    const tambahBaru = tambah.filter((m) => !punya.has(m))

    await this.prisma.$transaction(async (tx) => {
      if (hapusValid.length > 0) {
        await tx.taskAssignment.deleteMany({
          where: { taskId, memberId: { in: hapusValid } },
        })
      }
      if (tambahBaru.length > 0) {
        await tx.taskAssignment.createMany({
          data: tambahBaru.map((memberId) => ({ taskId, memberId })),
          skipDuplicates: true,
        })
      }
    })

    return this.get(organizationId, taskId)
  }

  async addDependency(organizationId: string, taskId: string, dependsOnTaskId: string): Promise<TaskRow> {
    await this.ambil(organizationId, taskId)
    await this.pastikanTugasMilik([dependsOnTaskId], organizationId)
    await this.pastikanTakSiklus(taskId, dependsOnTaskId)

    await this.prisma.taskDependency.create({ data: { taskId, dependsOnTaskId } }).catch((error: unknown) => {
      if ((error as { code?: string }).code === 'P2002') {
        throw new TaskError('CONFLICT', 'Keterikatan itu sudah ada.')
      }
      throw error
    })

    return this.get(organizationId, taskId)
  }

  /**
   * Hapus tugas.
   *
   * Ditolak kalau ada tugas lain yang bergantung padanya. Menghapus diam-diam
   * akan membuat tugas-tugas itu kehilangan konteks tanpa ada yang memberi
   * tahu — dan status "menunggu proposal" menggantung tanpa ada yang perlu
   * ditanya.
   */
  async remove(organizationId: string, taskId: string, options: { force?: boolean } = {}): Promise<TaskRow> {
    const tugas = await this.get(organizationId, taskId)

    if (tugas.dependents.length > 0 && !options.force) {
      throw new TaskError(
        'CONFLICT',
        `${tugas.dependents.length} tugas lain bergantung pada tugas ini: ` +
          tugas.dependents.map((d) => `"${d.title}"`).join(', ') +
          '. Hapus keterikatannya dulu, atau paksa penghapusan kalau tugas-tugas itu memang tidak relevan lagi.',
      )
    }

    await this.prisma.task.delete({ where: { id: taskId } })
    log.info({ taskId }, 'tugas dihapus')
    // Kembalikan bentuk terakhir supaya pemanggil masih bisa melaporkannya.
    return tugas
  }

  // ── Pemeriksaan ───────────────────────────────────────────────────────────

  /**
   * Pastikan setiap anggota benar-benar milik organisasi yang diberikan.
   *
   * Query satu kali, lalu bandingkan-setnya. Kalau satu salah, pesan menyebut
   * namayang berbeda organisasi asalnya — itu informasi yang dibutuhkan untuk
   * mengoreksi, dan bukan membocorkan isi tugas.
   */
  private async pastikanAnggotaMilik(memberIds: string[], organizationId: string): Promise<void> {
    if (memberIds.length === 0) return

    const anggota = await this.prisma.organizationMember.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, organizationId: true, fullName: true, isActive: true },
    })

    const peta = new Map(anggota.map((a) => [a.id, a]))

    const salah = memberIds.filter((id) => peta.get(id)?.organizationId !== organizationId)
    if (salah.length > 0) {
      throw new TaskError(
        'CROSS_ORGANIZATION',
        'Anggota berikut bukan anggota organisasi ini: ' +
          salah.map((id) => `"${peta.get(id)?.fullName ?? id}"`).join(', ') +
          '.',
      )
    }

    const nonaktif = memberIds.filter((id) => peta.get(id)?.isActive === false)
    if (nonaktif.length > 0) {
      throw new TaskError(
        'VALIDATION',
        'Anggota berikut sudah tidak aktif: ' +
          nonaktif.map((id) => `"${peta.get(id)?.fullName ?? id}"`).join(', ') +
          '.',
      )
    }
  }

  private async pastikanTugasMilik(taskIds: string[], organizationId: string): Promise<void> {
    if (taskIds.length === 0) return

    const ditemukan = await this.prisma.task.findMany({
      where: { id: { in: taskIds }, organizationId },
      select: { id: true },
    })
    const ada = new Set(ditemukan.map((t) => t.id))

    const hilang = taskIds.filter((id) => !ada.has(id))
    if (hilang.length > 0) {
      // Tugas milik organisasi lain sengaja tidak dibedakan dari yang tidak
      // ada: membocorkan keberadaannya lewat pesan error juga kebocoran.
      throw new TaskError('NOT_FOUND', 'Tugas yang dirujuk tidak ditemukan di organisasi ini.')
    }
  }

  /**
   * Tolak penambahan dependensi yang membentuk siklus.
   *
   * Sisi baru adalah `taskId` → `dependsOnTaskId`. Lingkaran tertutup kalau
   * `taskId` **sudah bisa dicapai** dari `dependsOnTaskId` lewat rantai
   * dependensi yang sudah ada — karena begitu, tugas yang satu menunggu yang
   * lain, dan yang lain menunggu yang satu.
   *
   * Hanya dipakai untuk penambahan dependensi **setelah** tugas ada. Saat
   * pembuatan, tugas baru belum punya sisi masuk sama sekali, jadi tidak ada
   * yang bisa membentuk lingkaran.
   */
  private async pastikanTakSiklus(taskId: string, dependsOnTaskId: string): Promise<void> {
    if (taskId === dependsOnTaskId) {
      throw new TaskError('DEPENDENCY_CYCLE', 'Tugas tidak bisa bergantung pada dirinya sendiri.')
    }

    const stack = [dependsOnTaskId]
    const dilihat = new Set<string>()

    while (stack.length > 0) {
      const sekarang = stack.pop()!
      if (dilihat.has(sekarang)) continue
      dilihat.add(sekarang)

      const sisi = await this.prisma.taskDependency.findMany({
        where: { taskId: sekarang },
        select: { dependsOnTaskId: true },
      })

      for (const sisiTugas of sisi) {
        if (sisiTugas.dependsOnTaskId === taskId) {
          throw new TaskError(
            'DEPENDENCY_CYCLE',
            'Keterikatan itu membentuk lingkaran: tugas-tugas saling menunggu dan tidak akan pernah bisa diselesaikan.',
          )
        }
        stack.push(sisiTugas.dependsOnTaskId)
      }
    }
  }

  private async ambil(organizationId: string, taskId: string) {
    const tugas = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: {
        id: true,
        status: true,
      },
    })
    if (!tugas) throw new TaskError('NOT_FOUND', 'Tugas tidak ditemukan di organisasi ini.')
    return tugas
  }

  private async normalisasiPrioritas(priority?: number): Promise<number> {
    if (priority === undefined) return 3
    const bulat = Math.round(priority)
    if (!Number.isFinite(bulat) || bulat < MIN_PRIORITY || bulat > MAX_PRIORITY) {
      throw new TaskError('VALIDATION', `Prioritas harus antara ${MIN_PRIORITY} dan ${MAX_PRIORITY}.`)
    }
    return bulat
  }
}

/** Status yang berarti "tidak ada lagi yang perlu dikerjakan". */
function sudahTuntas(status: string): boolean {
  return status === 'done' || status === 'cancelled'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function keBaris(raw: any, now: Date): TaskRow {
  const dependencies = (raw.dependencies ?? []).map((d: any) => ({
    id: d.dependsOn.id as string,
    title: d.dependsOn.title as string,
    status: d.dependsOn.status as string,
  }))
  const dependents = (raw.dependents ?? []).map((d: any) => ({
    id: d.task.id as string,
    title: d.task.title as string,
    status: d.task.status as string,
  }))

  const belumTuntas = dependencies.filter((d: { status: string }) => !sudahTuntas(d.status))
  const sudah = sudahTuntas(raw.status as string)

  return {
    id: raw.id as string,
    title: raw.title as string,
    description: (raw.description ?? null) as string | null,
    status: raw.status as string,
    priority: raw.priority as number,
    dueAt: (raw.dueAt ?? null) as Date | null,
    completedAt: (raw.completedAt ?? null) as Date | null,
    createdAt: raw.createdAt as Date,
    dependencies,
    dependents,
    assignments: (raw.assignments ?? []).map((a: any) => ({
      memberId: a.memberId as string,
      memberName: (a.member?.fullName ?? 'Tanpa nama') as string,
      status: a.status as string,
    })),
    blocked: !sudah && belumTuntas.length > 0,
    overdue: !sudah && raw.dueAt !== null && (raw.dueAt as Date).getTime() < now.getTime(),
  }
}

/**
 * Urutan tampilan.
 *
 * Urutan ini dihitung di aplikasi, bukan lewat `orderBy`, karena `dueAt` bisa
 * null dan orang ingin melihat yang bertenggat di depan — bukan yang tidak
 * bertenggat. `orderBy` Prisma tidak bisa menyatakan "null di akhir" pada
 * kolom yang bisa null.
 *
 * **Tenggat mendahului prioritas, bukan sebaliknya.** Tugas prioritas 1 yang
 * harus selesai bulan depan bukan lebih mendesak dari tugas prioritas 5 yang
 * lewat tenggat hari ini. Kalau prioritas yang lebih dulu, daftar yang dibuka
 * pertama kali selalu diisi tugas yang tidak sedang terburu — persis yang
 * tidak dilihat orang yang sedang kejar waktu.
 *
 * Urutannya:
 *   1. lewat tenggat          — sudah terlambat, tanpa kecuali
 *   2. tenggat terdekat       — yang paling sempit waktunya
 *   3. prioritas              — pemutus seri waktu bertumpuk
 *   4. tanpa tenggat          — tidak ada batas waktu, di akhir
 *   5. dibuat lebih dulu      — stabil, supaya daftar tidak bergeser sendiri
 */
function urutkan(a: TaskRow, b: TaskRow): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1

  const ad = a.dueAt?.getTime()
  const bd = b.dueAt?.getTime()

  // Tanpa tenggat tidak boleh mendahului yang ada tenggatnya, meski prioritasnya
  // lebih tinggi — tidak ada batas waktu bukan berarti lebih mendesak.
  if (ad !== bd) {
    if (ad === undefined) return 1
    if (bd === undefined) return -1
    return ad - bd
  }

  if (a.priority !== b.priority) return a.priority - b.priority
  return a.createdAt.getTime() - b.createdAt.getTime()
}