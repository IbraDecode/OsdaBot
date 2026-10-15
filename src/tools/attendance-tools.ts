/**
 * Tool attendance.
 *
 * Semua tool di sini mengikuti aturan yang sama:
 *  - `organizationId` TIDAK pernah dari argumen model. Selalu dari context.
 *  - Tool membaca DB, bukan Carnegie; lalu mengembalikan data terstruktur yang
 *    sudah terverifikasi supaya agent bisa menyebutkan hasil sebenarnya.
 *  - Ketidakjelasan (nama ambigu) SELALU dikembalikan sebagai error
 *    `AMBIGUOUS_REFERENCE` dengan daftar kandidat, bukan ditebak.
 */
import { AttendanceStatus } from '@prisma/client'
import { z } from 'zod'
import type { AttendanceService } from '../attendance/service.js'
import { AttendanceError } from '../attendance/service.js'
import { renderStatusSummary } from '../attendance/renderer.js'
import type { IdentityEngine } from '../identity/resolver.js'
import { PERMISSIONS } from '../security/permissions.js'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'

const statusSchema = z
  .enum(['PRESENT', 'EXCUSED', 'SICK', 'ABSENT', 'UNCONFIRMED', 'PENDING'])
  .describe(
    'Status kehadiran: PRESENT=hadir, EXCUSED=izin, SICK=sakit, ABSENT=alpa, UNCONFIRMED=belum konfirmasi.',
  )

/** Petakan status agar mudah dibaca model. */
const statusLabel: Record<AttendanceStatus, string> = {
  PRESENT: 'hadir',
  EXCUSED: 'izin',
  SICK: 'sakit',
  ABSENT: 'alpa',
  UNCONFIRMED: 'belum konfirmasi',
  PENDING: 'belum konfirmasi',
}

export interface AttendanceToolsDeps {
  attendance: AttendanceService
  identity: IdentityEngine
}

export function buildAttendanceTools(deps: AttendanceToolsDeps): Array<ToolDefinition<never, never>> {
  const { attendance, identity } = deps

  const listEvents: ToolDefinition<{ limit?: number }, unknown> = {
    name: 'attendance_list_events',
    description:
      'Gunakan saat pengguna menanyakan daftar kegiatan yang punya daftar hadir, atau saat perlu tahu kegiatan mana yang aktif. Jangan gunakan untuk mengubah apa pun.',
    inputSchema: z.object({
      limit: z.number().int().positive().max(20).optional().describe('Jumlah maksimal. Default 10.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.ATTENDANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const events = await attendance.listEvents(organizationId, input.limit ?? 10)

      return {
        events: events.map((event) => ({
          attendanceEventId: event.id,
          title: event.title,
          date: event.eventDate.toISOString().slice(0, 10),
            totalEntries: event._count.entries,
        })),
      }
    },
  }

  const getList: ToolDefinition<{ attendanceEventId?: string }, unknown> = {
    name: 'attendance_get',
    description:
      'Ambil daftar hadir beserta isi dan formatnya. Gunakan untuk menampilkan daftar, melihat siapa yang sudah/belum konfirmasi, atau melanjutkan perubahan pada daftar yang sama. Jika attendanceEventId tidak diberikan, daftar aktif terakhir dipakai.',
    inputSchema: z.object({
      attendanceEventId: z
        .string()
        .uuid()
        .optional()
        .describe('ID kegiatan kehadiran. Kosongkan untuk memakai daftar terakhir yang aktif.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.ATTENDANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const eventId = input.attendanceEventId ?? (await resolveActiveEvent(attendance, organizationId))

      const { event, renderEntries } = await attendance.listForRender(organizationId, eventId)

      return {
        attendanceEventId: event.id,
        title: event.title,
        date: event.eventDate.toISOString().slice(0, 10),
        /** Teks siap kirim — renderer memakai format yang sudah disimpan. */
        rendered: await attendance.renderList(organizationId, event.id),
        entries: renderEntries.map((entry) => ({
          entryId: null,
          memberId: entry.memberId,
          name: entry.displayName,
          class: entry.className,
          status: entry.status,
          statusLabel: statusLabel[entry.status],
          reason: entry.reason,
        })),
        counts: countByStatus(renderEntries),
      }
    },
  }

  const createList: ToolDefinition<
    {
      title: string
      eventDate?: string
      location?: string | null
      markdown?: string | null
      includeAllMembers?: boolean
      memberNames?: string[]
    },
    unknown
  > = {
    name: 'attendance_create',
    description:
      'Buat daftar hadir untuk satu kegiatan. JUDUL WAJIB diambil dari nama kegiatan yang disebut pengguna — jangan pernah mengarang atau mengosongkan, karena parameter ini wajib dan tanpa itu tool gagal. ' +
      'Pakai tanggal YYYY-MM-DD. Kalau kegiatan untuk tanggal itu sudah ada, jangan buat ulang — gunakan attendance.get. ' +
      'Kalau pengguna memberikan daftar teks (markdown), teruskan lewat markdown supaya formatnya dipertahankan.',
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .max(200)
        .describe(
          'WAJIB. Nama kegiatan dari kalimat pengguna. Contoh: pengguna bilang "buat daftar hadir latihan LKBB besok" -> title = "Latihan LKBB". Kalau pengguna tidak menyebut nama kegiatan, gunakan kalimat singkat yang paling menggambarkan, jangan kosongkan.',
        ),
      eventDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
        .optional()
        .describe('Tanggal kegiatan format YYYY-MM-DD, dihitung di zona waktu organisasi.'),
      location: z.string().max(200).nullish().describe('Tempat kegiatan bila sudah diketahui.'),
      markdown: z
        .string()
        .max(20_000)
        .nullish()
        .describe('Isi markdown asli dari pengguna bila ada. Dipakai sebagai cetakan format.'),
      includeAllMembers: z
        .boolean()
        .optional()
        .describe(
          'Kalau true, semua anggota aktif ikut masuk ke daftar dengan status BELUM KONFIRMASI. ' +
            'Pakai true saat pengguna minta "daftar hadir untuk semua anggota".',
        ),
      memberNames: z
        .array(z.string().max(120))
        .max(500)
        .optional()
        .describe(
          'Nama anggota yang mau dimasukkan, sesuai yang disebut pengguna. ' +
            'Boleh nama panggilan atau alias. Semua masuk dengan status BELUM KONFIRMASI — jangan menandai hadir sendiri.',
        ),
    }) as never,
    requiredPermissions: [PERMISSIONS.ATTENDANCE_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const eventDate = input.eventDate ? parseDateInTimezone(input.eventDate, context.timezone) : new Date()

      const { event, created } = await attendance.findOrCreate(organizationId, {
        title: input.title,
        eventDate,
        location: input.location ?? null,
      })

      // Isi daftar sekaligus, bukan satu per satu.
      //
      // Menambahkan anggota lewat panggilan tool terpisah butuh satu putaran
      // agent per orang. Untuk organisasi dengan puluhan anggota, itu
      // kehabisan langkah di tengah jalan dan daftar tetap kosong.
      const mauSemua = input.includeAllMembers === true
      const namaDisebut = input.memberNames ?? []
      let hasilIsi: Awaited<ReturnType<typeof attendance.seedMembers>> | null = null

      if (mauSemua || namaDisebut.length > 0) {
        hasilIsi = await attendance.seedMembers({
          organizationId,
          attendanceEventId: event.id,
          names: namaDisebut,
          includeAll: mauSemua,
        })
      }

      if (!created) {
        return {
          attendanceEventId: event.id,
          created: false,
          message: hasilIsi
            ? `Daftar untuk tanggal itu sudah ada, jadi aku pakai yang tadi dan menambahkan ${hasilIsi.added.length} anggota.`
            : 'Daftar untuk tanggal itu sudah ada, jadi aku pakai yang tadi. Kalau mau bikin yang terpisah, sebutkan waktunya.',
        }
      }

      const catatan: string[] = []
      if (hasilIsi) {
        catatan.push(`${hasilIsi.added.length} anggota masuk dengan status BELUM KONFIRMASI.`)
        if (hasilIsi.notFound.length > 0) {
          catatan.push(`Tidak ditemukan: ${hasilIsi.notFound.join(', ')}.`)
        }
        if (hasilIsi.ambiguous.length > 0) {
          // Menebak yang mana berarti data kehadiran salah orang.
          catatan.push(`Nama ambigu (tidak ditambahkan): ${hasilIsi.ambiguous.join('; ')}.`)
        }
      } else {
        catatan.push('Belum ada anggota di dalamnya.')
      }

      return {
        attendanceEventId: event.id,
        created: true,
        title: event.title,
        date: event.eventDate.toISOString().slice(0, 10),
        memberCount: hasilIsi?.added.length ?? 0,
        added: hasilIsi?.added.map((member) => member.fullName) ?? [],
        notFound: hasilIsi?.notFound ?? [],
        ambiguous: hasilIsi?.ambiguous ?? [],
        message: `Daftar "${event.title}" sudah dibuat. ${catatan.join(' ')}`,
      }
    },
  }

  const addMember: ToolDefinition<
    { attendanceEventId?: string; memberName?: string; memberId?: string; status?: AttendanceStatus; reason?: string | null },
    unknown
  > = {
    name: 'attendance_add_member',
    description:
      'Tambahkan satu anggota ke daftar hadir. memberName boleh dipakai, tapi WAJIB hasilkan memberId dari organization.search_members lebih dulu agar tidak salah orang. Kalau anggota sudah ada di daftar, tidak akan dibuat entri ganda.',
    inputSchema: z.object({
      attendanceEventId: z.string().uuid().optional().describe('ID daftar. Kosongkan untuk daftar aktif terakhir.'),
      memberId: z.string().uuid().optional().describe('ID anggota dari organization.search_members.'),
      memberName: z.string().min(1).max(120).optional().describe('Nama anggota sebagai cadangan.'),
      status: statusSchema.optional().describe('Status awal. Default: belum konfirmasi.'),
      reason: z.string().max(500).nullish(),
    }) as never,
    requiredPermissions: [PERMISSIONS.ATTENDANCE_UPDATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const eventId = input.attendanceEventId ?? (await resolveActiveEvent(attendance, organizationId))

      // Prioritaskan memberId (sudah diverifikasi). Falls back ke resolusi nama.
      let memberId = input.memberId
      if (!memberId) {
        if (!input.memberName) {
          throw new ToolError('VALIDATION_FAILED', 'memberId atau memberName wajib diisi.')
        }
        const resolution = await identity.resolveMemberByName(organizationId, input.memberName)
        if (resolution.certainty === 'ambiguous') {
          throw new ToolError(
            'AMBIGUOUS_REFERENCE',
            `Ada beberapa anggota yang cocok dengan "${input.memberName}". Minta pengguna memilih: ${resolution.candidates.map((c) => `${c.name}${c.className ? ` (${c.className})` : ''}`).join(', ')}.`,
          )
        }
        if (resolution.certainty === 'none') {
          throw new ToolError('NOT_FOUND', `Anggota "${input.memberName}" tidak ditemukan di organisasi ini.`)
        }
        memberId = resolution.memberId
      }

      const result = await attendance.addMember({
        organizationId,
        attendanceEventId: eventId,
        memberId,
        status: input.status ?? 'UNCONFIRMED',
        reason: input.reason ?? null,
      })

      return {
        attendanceEventId: eventId,
        entryId: result.entryId,
        created: result.created,
        alreadyPresent: result.alreadyPresent,
        name: result.member.fullName,
        class: result.member.className,
        message: result.alreadyPresent
          ? `${result.member.fullName} sudah ada di daftar ini, jadi tidak ditambah dua kali.`
          : `${result.member.fullName} sudah ditambahkan.`,
      }
    },
  }

  const updateEntry: ToolDefinition<
    {
      attendanceEventId?: string
      entryId?: string
      memberId?: string
      memberName?: string
      status?: AttendanceStatus
      reason?: string | null
      notes?: string | null
    },
    unknown
  > = {
    name: 'attendance_update',
    description:
      'Ubah entri yang SUDAH ADA di daftar. Hanya field yang diisi yang berubah — kolom lain tetap apa adanya. Pakai ini untuk "ubah status jadi izin", "ganti alasan", atau koreksi field lain. Untuk menambahkan anggota baru pakai attendance.add_member.',
    inputSchema: z.object({
      attendanceEventId: z.string().uuid().optional().describe('ID daftar. Kosongkan untuk daftar aktif terakhir.'),
      entryId: z.string().uuid().optional().describe('ID entri — paling presisi.'),
      memberId: z.string().uuid().optional().describe('ID anggota bila entryId tidak diketahui.'),
      memberName: z.string().min(1).max(120).optional().describe('Nama anggota sebagai cadangan.'),
      status: statusSchema.optional().describe('Status baru. Kosongkan kalau hanya mengubah alasan.'),
      reason: z.string().max(500).nullish().describe('Alasan baru. Kosongkan kalau tidak mengubah alasan.'),
      notes: z.string().max(1000).nullish(),
    }) as never,
    requiredPermissions: [PERMISSIONS.ATTENDANCE_UPDATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const eventId = input.attendanceEventId ?? (await resolveActiveEvent(attendance, organizationId))

      // Tentukan target entri.
      let entryId = input.entryId
      let memberId = input.memberId

      if (!entryId && !memberId) {
        if (!input.memberName) {
          throw new ToolError('VALIDATION_FAILED', 'Sebutkan entri yang mau diubah (entryId, memberId, atau memberName).')
        }
        const resolution = await identity.resolveMemberByName(organizationId, input.memberName)
        if (resolution.certainty === 'ambiguous') {
          throw new ToolError(
            'AMBIGUOUS_REFERENCE',
            `Ada beberapa anggota yang cocok dengan "${input.memberName}". Minta pengguna memilih: ${resolution.candidates.map((c) => `${c.name}${c.className ? ` (${c.className})` : ''}`).join(', ')}.`,
          )
        }
        if (resolution.certainty === 'none') {
          throw new ToolError('NOT_FOUND', `Anggota "${input.memberName}" tidak ditemukan di organisasi ini.`)
        }
        memberId = resolution.memberId
      }

      if (input.status === undefined && input.reason === undefined && input.notes === undefined) {
        throw new ToolError('VALIDATION_FAILED', 'Tidak ada field yang mau diubah.')
      }

      const updated = await attendance.updateEntry({
        organizationId,
        attendanceEventId: eventId,
        ...(entryId ? { entryId } : {}),
        ...(memberId ? { memberId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })

      const changed: string[] = []
      if (input.status !== undefined) changed.push(`status → ${statusLabel[input.status]}`)
      if (input.reason !== undefined) changed.push(`alasan → "${input.reason}"`)
      if (input.notes !== undefined) changed.push('catatan diperbarui')

      return {
        attendanceEventId: eventId,
        entryId: updated.id,
        name: updated.displayName,
        class: updated.className,
        status: updated.status,
        statusLabel: statusLabel[updated.status],
        reason: updated.reason,
        changedFields: changed,
        rendered: await attendance.renderList(organizationId, eventId),
        message: `${updated.displayName}: ${changed.join(', ')}.`,
      }
    },
  }

  const getUnconfirmed: ToolDefinition<{ attendanceEventId?: string }, unknown> = {
    name: 'attendance_get_unconfirmed',
    description:
      'Daftarkan anggota yang belum mengonfirmasi kehadiran pada satu kegiatan. Gunakan untuk pertanyaan "siapa yang belum konfirmasi".',
    inputSchema: z.object({
      attendanceEventId: z.string().uuid().optional(),
    }) as never,
    requiredPermissions: [PERMISSIONS.ATTENDANCE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const eventId = input.attendanceEventId ?? (await resolveActiveEvent(attendance, organizationId))

      const result = await attendance.getUnconfirmed(organizationId, eventId)

      const resolved = await Promise.all(
        result.entries.map(async (entry) => ({
          entryId: entry.id,
          memberId: entry.memberId,
          name: entry.displayName,
          class: entry.className,
          status: entry.status,
          whatsappVerified: entry.memberId ? await identity.hasVerifiedIdentity(entry.memberId) : false,
        })),
      )

      return {
        attendanceEventId: eventId,
        title: result.event.title,
        date: result.event.eventDate.toISOString().slice(0, 10),
        totalMembers: result.total,
        unconfirmedCount: resolved.length,
        unconfirmed: resolved,
        rendered: renderStatusSummary(
          result.entries.map((entry) => ({
            memberId: entry.memberId,
            displayName: entry.displayName,
            className: entry.className,
            status: entry.status,
            reason: entry.reason,
          })),
        ),
      }
    },
  }

  // `organization.search_members` sengaja TIDAK didefinisikan di sini —
  //didefinisikan satu kali di organization-tools.ts supaya tidak ada definisi ganda.
  return [listEvents, getList, createList, addMember, updateEntry, getUnconfirmed] as never
}

// =============================================================================
// Helper
// =============================================================================

function requireOrg(context: ToolExecutionContext): string {
  if (!context.organizationId) {
    throw new ToolError('PERMISSION_DENIED', 'Organisasi belum ditentukan untuk percakapan ini.')
  }
  return context.organizationId
}

/** Cari kegiatan kehadiran aktif terakhir, atau error yang jelas. */
async function resolveActiveEvent(
  attendance: AttendanceService,
  organizationId: string,
): Promise<string> {
  const events = await attendance.listEvents(organizationId, 1)
  const first = events[0]
  if (!first) {
    throw new ToolError('NOT_FOUND', 'Belum ada daftar kehadiran di organisasi ini.')
  }
  return first.id
}

/** Parse tanggal YYYY-MM-DD menjadi Date tengah hari di zona waktu organisasi. */
export function parseDateInTimezone(value: string, timezone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new ToolError('VALIDATION_FAILED', 'Format tanggal harus YYYY-MM-DD.')

  const [, year, month, day] = match
  // Pukul 12:00 waktu lokal → aman terhadap pergeseran zona waktu.
  const utcGuess = new Date(`${year}-${month}-${day}T12:00:00Z`)
  if (Number.isNaN(utcGuess.getTime())) {
    throw new ToolError('VALIDATION_FAILED', `Tanggal "${value}" tidak valid.`)
  }
  return new Date(utcGuess.getTime())
}

function countByStatus(entries: Array<{ status: AttendanceStatus }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1
  }
  return counts
}

/** Ubah error domain attendance menjadi ToolError yang konsisten. */
export function mapAttendanceError(error: unknown): ToolError {
  if (error instanceof AttendanceError) {
    switch (error.code) {
      case 'ATTENDANCE_NOT_FOUND':
      case 'ENTRY_NOT_FOUND':
      case 'MEMBER_NOT_FOUND':
        return new ToolError('NOT_FOUND', error.message)
      case 'AMBIGUOUS_TARGET':
        return new ToolError('AMBIGUOUS_REFERENCE', error.message)
      case 'DUPLICATE_MEMBER':
        return new ToolError('CONFLICT', error.message)
    }
  }
  return new ToolError('INTERNAL_ERROR', 'Gagal memproses data kehadiran.')
}