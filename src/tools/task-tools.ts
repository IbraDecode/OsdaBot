/**
 * Tool tugas organisasi.
 *
 * ── Prinsip yang ditegakkan di sini ─────────────────────────────────────────
 *
 * 1. **Rujukan yang ambigu SELALU ditanyakan, tidak ditebak.** "tugas proposal
 *    itu" bisa berarti tiga baris. Memilih satu tanpa bertanya berarti
 *    memberi status yang salah untuk pekerjaan orang — dan itu kesalahan yang
 *    tidak ada yang mengetahuinya.
 *
 * 2. **"Selesai" hanya lewat satu pintu.** Tool `task_complete` adalah satu-
 *    satunya jalan ke `done`, karena di situ ada pemeriksaan dependensi.
 *    `task_update` sengaja tidak menerima `status: "done"` — kalau diterima,
 *    model akan menemukan jalan yang lebih ringkas dan melewati pemeriksaan.
 *
 * 3. **Anggota ditugaskan lewat nama, tapi ambigu tidak diterka.** Nama di chat
 *    itu tidak unik; ID itu verifikasi.
 *
 * 4. **Setiap jawaban menyebut IDs.** Kalau model perlu lanjutkan acting,
 *    dia harus punya `taskId` yang benar, bukan tebakan dari judul.
 */
import { z } from 'zod'
import { PERMISSIONS } from '../security/permissions.js'
import { TaskError, type TaskRow, type TaskService } from '../tasks/service.js'
import type { IdentityEngine } from '../identity/resolver.js'
import { parseWaktu } from './reminder-tools.js'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'

export interface TaskToolsDeps {
  tasks: TaskService
  identity: IdentityEngine
}

const filterSchema = z
  .enum(['open', 'overdue', 'done', 'todo', 'in_progress', 'cancelled'])
  .describe(
    'open=belum selesai (default), overdue=lewat tenggat, done=selesai, atau status tunggal. ' +
      'Pakai overdue kalau pengguna bertanya "yang lewat tenggat".',
  )

const referensiSchema = z
  .object({
    taskId: z.string().uuid().optional().describe('ID tugas dari task_create atau task_list.'),
    taskTitle: z.string().max(200).optional().describe('Potongan judul, kalau tidak punya ID.'),
  })
  .strict()

export function buildTaskTools(deps: TaskToolsDeps): Array<ToolDefinition<never, never>> {
  const { tasks, identity } = deps

  const create: ToolDefinition<
    {
      title: string
      description?: string
      assigneeNames?: string[]
      dueAt?: string
      priority?: number
      dependsOnTitles?: string[]
    },
    unknown
  > = {
    name: 'task_create',
    description:
      'Buat tugas baru, boleh ditugaskan ke anggota dan punya tenggat. ' +
      'Pakai ini saat pengguna meminta "buatkan tugas untuk Budi: siapkan proposal, tenggat besok". ' +
      'Kalau yang diminta hanya pengingat ("ingetin aku besok pagi"), jangan pakai ini — pakai schedule_reminder.',
    inputSchema: z
      .object({
        title: z.string().min(1).max(200).describe('Judul tugas, ditulis sebagai perintah kerja.'),
        description: z.string().max(2000).optional().describe('Rincian tambahan kalau ada.'),
        assigneeNames: z
          .array(z.string().min(1).max(60))
          .max(10)
          .optional()
          .describe('Nama anggota yang ditugaskan. Kalau ambigu, sistem akan meminta dipilih.'),
        dueAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
          .optional()
          .describe('Tenggat format 2026-10-20T17:00, waktu lokal organisasi.'),
        priority: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('1=paling mendesak, 5=paling longgar. Default 3.'),
        dependsOnTitles: z
          .array(z.string().min(1).max(200))
          .max(5)
          .optional()
          .describe('Judul tugas yang harus selesai lebih dulu. Jangan dipakai untuk "lalu/lalu".'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.TASKS_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const memberIds: string[] = []
      for (const nama of input.assigneeNames ?? []) {
        memberIds.push(await resolveMember(identity, organizationId, nama))
      }

      const dependencyIds: string[] = []
      for (const judul of input.dependsOnTitles ?? []) {
        dependencyIds.push((await resolveTaskReference(tasks, organizationId, { taskTitle: judul })).id)
      }

      try {
        const tugas = await tasks.create({
          organizationId,
          title: input.title,
          description: input.description ?? null,
          assigneeMemberIds: memberIds,
          dependsOnTaskIds: dependencyIds,
          dueAt: input.dueAt ? parseWaktu(input.dueAt, context.timezone) : null,
          priority: input.priority,
        })

        return {
          ...ringkas(tugas),
          message: `Tugas "${tugas.title}" dibuat` + assigneeSuffix(tugas),
        }
      } catch (error) {
        throw mapTaskError(error)
      }
    },
  }

  const list: ToolDefinition<
    { filter?: 'open' | 'overdue' | 'done' | 'todo' | 'in_progress' | 'cancelled'; assigneeName?: string; limit?: number },
    unknown
  > = {
    name: 'task_list',
    description:
      'Tampilkan daftar tugas beserta penugas, tenggat, dan status keterikatan. ' +
      'Pakai ini untuk "tugas saya apa saja", "yang lewat tenggat", atau "apa yang belum selesai". ' +
      'Tidak mengubah apa pun.',
    inputSchema: z
      .object({
        filter: filterSchema.optional(),
        assigneeName: z
          .string()
          .min(1)
          .max(60)
          .optional()
          .describe('Saring untuk satu anggota. Kalau ambigu, sistem akan meminta dipilih.'),
        limit: z.number().int().positive().max(50).optional().describe('Jumlah maksimal. Default 20.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.TASKS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const assigneeMemberId = input.assigneeName
        ? await resolveMember(identity, organizationId, input.assigneeName)
        : undefined

      const hasil = await tasks.list({
        organizationId,
        filter: input.filter,
        assigneeMemberId,
        limit: input.limit ?? 20,
      })

      return {
        tasks: hasil.map((t) => ({
          ...ringkas(t),
          dueAt: t.dueAt ? t.dueAt.toISOString() : null,
          overdue: t.overdue,
          blocked: t.blocked,
        })),
        count: hasil.length,
        message: hasil.length === 0 ? tidakAdaTugas(input.filter) : hasil.map(teksTugas).join('\n'),
      }
    },
  }

  const complete: ToolDefinition<
    { taskId?: string; taskTitle?: string; acknowledgeUnfinishedDependencies?: boolean },
    unknown
  > = {
    name: 'task_complete',
    description:
      'Tandai tugas selesai. Ini satu-satunya jalan ke status selesai, dan hanya lewat sini dependensi diperiksa. ' +
      'Kalau tugas masih bergantung pada tugas lain yang belum selesai, sistem akan menolak dan menyebutkan yang menghambat — ' +
      'jangan langsung mengulang dengan acknowledgeUnfinishedDependencies=true; tanyakan dulu ke pengguna.',
    inputSchema: referensiSchema
      .extend({
        acknowledgeUnfinishedDependencies: z
          .boolean()
          .optional()
          .describe(
            'Set true HANYA kalau pengguna sudah dinyatakan tahu bahwa urutan dibalik. Tanpa ini, tugas ditolak.',
          ),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.TASKS_UPDATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const tugas = await resolveTaskReference(tasks, organizationId, input)

      try {
        const hasil = await tasks.complete(organizationId, tugas.id, {
          force: input.acknowledgeUnfinishedDependencies === true,
        })
        return {
          ...ringkas(hasil.task),
          completedAt: hasil.task.completedAt?.toISOString() ?? null,
          selesaiDenganPengakuan: hasil.dependensiBelumSelesai,
          message:
            `Tugas "${hasil.task.title}" ditandai selesai` +
            (hasil.dependensiBelumSelesai.length > 0
              ? `, meskipun masih bergantung pada: ${hasil.dependensiBelumSelesai.join(', ')}.`
              : '.'),
        }
      } catch (error) {
        throw mapTaskError(error)
      }
    },
  }

  const update: ToolDefinition<
    {
      taskId?: string
      taskTitle?: string
      title?: string
      description?: string | null
      dueAt?: string
      removeDueDate?: boolean
      priority?: number
      status?: 'todo' | 'in_progress' | 'cancelled' | 'done'
    },
    unknown
  > = {
    name: 'task_update',
    description:
      'Ubah isi, tenggat, prioritas, atau status tugas. ' +
      'TIDAK bisa dipakai untuk menandai selesai — itu pakai task_complete, yang memeriksa dependensi. ' +
      'Kalau tidak ada yang perlu diubah, jangan panggil tool ini.',
    inputSchema: referensiSchema
      .extend({
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullish(),
        dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).optional(),
        removeDueDate: z.boolean().optional().describe('true untuk menghapus tenggat yang ada.'),
        priority: z.number().int().min(1).max(5).optional(),
        status: z
          .enum(['todo', 'in_progress', 'cancelled', 'done'])
          .optional()
          .describe(
            'todo=belum dikerjakan, in_progress=sedang, cancelled=dibatalkan. ' +
              '"done" diterima di sini hanya supaya pesannya jelas — sistem akan mengarahkan ke task_complete.',
          ),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.TASKS_UPDATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const tugas = await resolveTaskReference(tasks, organizationId, input)

      // `done` sengaja diterima di skema lalu dialihkan di sini, bukan
      // ditolak Zod. Model akan wajar saja mengirim `status: "done"` ke tool
      // mana pun yang bisa mengubah status — itu perilaku yang diharapkan,
      // bukan kesalahan. Menolaknya dengan "enum tidak cocok" hanya menambah
      // satu percobaan sia-sia; mengarahkan ke pintu yang benar.
      if (input.status === 'done') {
        throw new ToolError(
          'VALIDATION_FAILED',
          'task_update tidak menandai selesai. Panggil task_complete dengan taskId yang sama — di situ dependensi diperiksa ' +
            'dan, kalau ada yang belum selesai, sistem akan menyebutkan yang menghambat.',
        )
      }

      const patch: Parameters<TaskService['update']>[2] = {}
      if (input.title !== undefined) patch.title = input.title
      if (input.description !== undefined) patch.description = input.description
      if (input.priority !== undefined) patch.priority = input.priority
      if (input.status !== undefined) patch.status = input.status
      if (input.dueAt !== undefined) patch.dueAt = parseWaktu(input.dueAt, context.timezone)
      else if (input.removeDueDate === true) patch.dueAt = null

      try {
        const hasil = await tasks.update(organizationId, tugas.id, patch)
        return { ...ringkas(hasil), message: `Tugas "${hasil.title}" diperbarui.` }
      } catch (error) {
        throw mapTaskError(error)
      }
    },
  }

  const assign: ToolDefinition<
    { taskId?: string; taskTitle?: string; memberNames: string[]; mode?: 'add' | 'remove' | 'replace' },
    unknown
  > = {
    name: 'task_assign',
    description:
      'Tugaskan anggota ke tugas, atau lepas dari tugas. ' +
      'Pakai persetujuan — menugaskan pekerjaan ke orang adalah keputusan yang bukan milik agent. ' +
      'Anggota dari luar organisasi akan ditolak.',
    inputSchema: referensiSchema
      .extend({
        memberNames: z.array(z.string().min(1).max(60)).max(10),
        mode: z
          .enum(['add', 'remove', 'replace'])
          .optional()
          .describe('add=tambah (default), remove=lepas, replace=ganti seluruh daftar.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.TASKS_ASSIGN],
    riskLevel: 'HIGH',
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const tugas = await resolveTaskReference(tasks, organizationId, input)

      const memberIds: string[] = []
      for (const nama of input.memberNames) {
        memberIds.push(await resolveMember(identity, organizationId, nama))
      }

      try {
        const hasil = await tasks.assign(organizationId, tugas.id, memberIds, input.mode ?? 'add')
        return {
          ...ringkas(hasil),
          message:
            input.mode === 'remove'
              ? `Anggota dilepas dari "${hasil.title}". Sisa: ${daftarNama(hasil)}.`
              : `Ditugaskan ke "${hasil.title}". Penugas: ${daftarNama(hasil)}.`,
        }
      } catch (error) {
        throw mapTaskError(error)
      }
    },
  }

  const remove: ToolDefinition<{ taskId?: string; taskTitle?: string; force?: boolean }, unknown> = {
    name: 'task_delete',
    description:
      'Hapus tugas. Ditolak kalau tugas lain bergantung padanya, dan yang bergantung disebutkan. ' +
      'Hapus karena salah catat, bukan untuk menghilangkan tugas yang masih dikerjakan orang.',
    inputSchema: referensiSchema
      .extend({
        force: z
          .boolean()
          .optional()
          .describe('true untuk hapus walau ada tugas lain yang bergantung.-rounded Setelah dikonfirmasi pengguna.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.TASKS_DELETE],
    riskLevel: 'HIGH',
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const tugas = await resolveTaskReference(tasks, organizationId, input)

      try {
        const hasil = await tasks.remove(organizationId, tugas.id, { force: input.force === true })
        return {
          taskId: hasil.id,
          title: hasil.title,
          message: `Tugas "${hasil.title}" dihapus.`,
        }
      } catch (error) {
        throw mapTaskError(error)
      }
    },
  }

  return [create, list, complete, update, assign, remove] as never
}

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Rujukan tugas: ID, atau potongan judul.
 *
 * Kalau judul cocok lebih dari satu, **tidak ditebak** — kandidat
 * dikembalikan supaya model bisa bertanya. Memilih satu tanpa bertanya berarti
 * menandai pekerjaan orang sebagai selesai yang sebenarnya belum.
 */
async function resolveTaskReference(
  tasks: TaskService,
  organizationId: string,
  input: { taskId?: string; taskTitle?: string },
): Promise<TaskRow> {
  if (input.taskId) {
    try {
      return await tasks.get(organizationId, input.taskId)
    } catch (error) {
      throw mapTaskError(error)
    }
  }

  if (!input.taskTitle) {
    throw new ToolError(
      'VALIDATION_FAILED',
      'Sebutkan tugas yang dimaksud: taskId (dari task_list) atau taskTitle (potongan judul).',
    )
  }

  const kandidat = await tasks.searchByTitle(organizationId, input.taskTitle)
  if (kandidat.length === 0) {
    throw new ToolError('NOT_FOUND', `Tidak ada tugas yang judulnya mengandung "${input.taskTitle}".`)
  }
  if (kandidat.length > 1) {
    throw new ToolError(
      'AMBIGUOUS_REFERENCE',
      `Ada ${kandidat.length} tugas yang cocok dengan "${input.taskTitle}": ` +
        kandidat.map((t) => `"${t.title}" (${t.status})`).join(', ') +
        '. Minta pengguna memilih — jangan menebak.',
    )
  }
  return kandidat[0]!
}

async function resolveMember(identity: IdentityEngine, organizationId: string, nama: string): Promise<string> {
  const resolution = await identity.resolveMemberByName(organizationId, nama)
  if (resolution.certainty === 'ambiguous') {
    throw new ToolError(
      'AMBIGUOUS_REFERENCE',
      `Ada beberapa anggota yang cocok dengan "${nama}": ` +
        resolution.candidates.map((c) => `"${c.name}"${c.className ? ` (${c.className})` : ''}`).join(', ') +
        '. Minta pengguna memilih.',
    )
  }
  if (resolution.certainty === 'none') {
    throw new ToolError('NOT_FOUND', `Anggota "${nama}" tidak ditemukan di organisasi ini.`)
  }
  return resolution.memberId
}

function ringkas(t: TaskRow) {
  return {
    taskId: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignees: t.assignments.map((a) => a.memberName),
    dependencies: t.dependencies.map((d) => ({ taskId: d.id, title: d.title, status: d.status })),
    blocked: t.blocked,
  }
}

function daftarNama(t: TaskRow): string {
  return t.assignments.length > 0 ? t.assignments.map((a) => a.memberName).join(', ') : 'tidak ada'
}

function assigneeSuffix(t: TaskRow): string {
  return t.assignments.length > 0 ? ` untuk ${daftarNama(t)}` : ''
}

function teksTugas(t: TaskRow): string {
  const bagian = [`- ${t.title} [${t.status}]`]
  if (t.assignments.length > 0) bagian.push(` assignee: ${daftarNama(t)}`)
  if (t.overdue) bagian.push('LEWAT TENGGAT')
  if (t.blocked) bagian.push(`menunggu: ${t.dependencies.filter((d) => d.status !== 'done').map((d) => d.title).join(', ')}`)
  return bagian.join(' ')
}

function tidakAdaTugas(filter?: string): string {
  if (filter === 'overdue') return 'Tidak ada tugas yang lewat tenggat.'
  if (filter === 'done') return 'Belum ada tugas yang selesai.'
  if (filter === 'cancelled') return 'Tidak ada tugas yang dibatalkan.'
  return 'Tidak ada tugas yang cocok.'
}

/** Ubah error domain tugas menjadi ToolError yang konsisten. */
export function mapTaskError(error: unknown): ToolError {
  if (error instanceof TaskError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return new ToolError('NOT_FOUND', error.message)
      case 'VALIDATION':
        return new ToolError('VALIDATION_FAILED', error.message)
      case 'CROSS_ORGANIZATION':
      case 'CONFLICT':
      case 'DEPENDENCY_CYCLE':
      case 'BLOCKED':
        return new ToolError('CONFLICT', error.message)
    }
  }
  return new ToolError('INTERNAL_ERROR', 'Gagal memproses data tugas.')
}

function requireOrg(context: ToolExecutionContext): string {
  if (!context.organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum terdeteksi untuk percakapan ini.')
  }
  return context.organizationId
}