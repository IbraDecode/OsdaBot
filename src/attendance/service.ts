/**
 * AttendanceService — satu-satunya jalan untuk mengubah data kehadiran.
 *
 * Semua operasi:
 *  - selalu diskop ke `organizationId` (tidak pernah tanpa scope),
 *  - idempoten di level bisnis (tambah anggota yang sama dua kali = satu entri),
 *  - mengembalikan data TERBAWAH yang sudah diverifikasi, supaya agent tidak
 *    perlu menebak hasilnya,
 *  - menolak memberId yang bukan milik organisasi.
 */
import { AttendanceStatus, type Prisma, type PrismaClient } from '@prisma/client'
import type { RenderEntry, RenderOptions } from './renderer.js'
import { canonicalizeName } from '../identity/name-normalizer.js'
import { logger } from '../observability/logger.js'
import {
  DEFAULT_TEMPLATE,
  detectFormatHints,
  extractTitle,
  renderAttendanceList,
  toRenderEntries,
} from './renderer.js'

const log = logger.child({ module: 'attendance' })

export interface AttendanceServiceDeps {
  prisma: PrismaClient
}

export interface CreateAttendanceInput {
  organizationId: string
  title: string
  eventDate: Date
  location?: string | null
  eventId?: string | null
  markdownTemplate?: string | null
}

export interface UpdateEntryInput {
  organizationId: string
  attendanceEventId: string
  /** Id entri, atau memberId bila ingin update by-member. */
  entryId?: string
  memberId?: string
  status?: AttendanceStatus
  reason?: string | null
  displayName?: string
  className?: string | null
  notes?: string | null
  /** Alias opsional untuk kompatibilitas pemanggil. */
  upsert?: boolean
}

export interface AddMemberInput {
  organizationId: string
  attendanceEventId: string
  memberId: string
  status?: AttendanceStatus
  reason?: string | null
  /** Kalau true dan sudah ada entri, tidak buat duplikat. */
  skipIfExists?: boolean
}

export class AttendanceError extends Error {
  constructor(
    readonly code:
      | 'ATTENDANCE_NOT_FOUND'
      | 'ENTRY_NOT_FOUND'
      | 'MEMBER_NOT_FOUND'
      | 'DUPLICATE_MEMBER'
      | 'AMBIGUOUS_TARGET'
      | 'MEMBER_AMBIGUOUS'
      | 'MEMBER_UNRESOLVED',
    message: string,
  ) {
    super(message)
    this.name = 'AttendanceError'
  }
}

export class AttendanceService {
  constructor(private readonly deps: AttendanceServiceDeps) {}

  private get prisma() {
    return this.deps.prisma
  }

  /** Daftar kegiatan kehadiran organisasi, terbaru dulu. */
  async listEvents(organizationId: string, limit = 10) {
    return this.prisma.attendanceEvent.findMany({
      where: { organizationId },
      orderBy: { eventDate: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        eventDate: true,
        location: true,
        status: true,
        _count: { select: { entries: true } },
      },
    })
  }

  /** Ambil kegiatan yang paling dekat dengan tanggal acuan (untuk "besok"). */
  async findEventNearDate(organizationId: string, date: Date, toleranceDays = 2) {
    const mulai = new Date(date)
    mulai.setHours(0, 0, 0, 0)
    const selesai = new Date(mulai)
    selesai.setDate(selesai.getDate() + toleranceDays)

    return this.prisma.attendanceEvent.findFirst({
      where: {
        organizationId,
        eventDate: { gte: mulai, lte: selesai },
      },
      orderBy: { eventDate: 'asc' },
      select: { id: true, title: true, eventDate: true, location: true },
    })
  }

  async getEvent(organizationId: string, attendanceEventId: string) {
    const event = await this.prisma.attendanceEvent.findFirst({
      where: { id: attendanceEventId, organizationId },
      select: {
        id: true,
        title: true,
        eventDate: true,
        location: true,
        status: true,
        markdownTemplate: true,
        formatHints: true,
        notes: true,
      },
    })
    if (!event) throw new AttendanceError('ATTENDANCE_NOT_FOUND', 'Daftar kehadiran tidak ditemukan.')
    return event
  }

  async getEntries(organizationId: string, attendanceEventId: string) {
    const event = await this.getEvent(organizationId, attendanceEventId)
    const entries = await this.prisma.attendanceEntry.findMany({
      where: { attendanceEventId: event.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        memberId: true,
        displayName: true,
        className: true,
        status: true,
        reason: true,
        notes: true,
        sortOrder: true,
      },
    })
    return { event, entries }
  }

  async getUnconfirmed(organizationId: string, attendanceEventId: string) {
    const { event, entries } = await this.getEntries(organizationId, attendanceEventId)
    const unconfirmed = entries.filter(
      (entry) => entry.status === 'UNCONFIRMED' || entry.status === 'PENDING',
    )
    return { event, entries: unconfirmed, total: entries.length }
  }

  async create(input: CreateAttendanceInput) {
    const formatHints = input.markdownTemplate ? detectFormatHints(input.markdownTemplate) : {}

    return this.prisma.attendanceEvent.create({
      data: {
        organizationId: input.organizationId,
        title: input.title,
        eventDate: input.eventDate,
        location: input.location ?? null,
        eventId: input.eventId ?? null,
        markdownTemplate: input.markdownTemplate ?? null,
        formatHints: formatHints as Prisma.InputJsonValue,
      },
      select: { id: true, title: true, eventDate: true, location: true, markdownTemplate: true },
    })
  }

  /**
   * Cari kegiatan berdasarkan tanggal + kemiripan judul.
   * Ini yang membuat "buat list LKBB besok" saat activities sudah ada tidak
   * membuat duplikat.
   */
  async findOrCreate(
    organizationId: string,
    params: { title: string; eventDate: Date; location?: string | null; eventId?: string | null },
  ) {
    const mulai = new Date(params.eventDate)
    mulai.setHours(0, 0, 0, 0)
    const selesai = new Date(mulai)
    selesai.setDate(selesai.getDate() + 1)

    const existing = await this.prisma.attendanceEvent.findFirst({
      where: {
        organizationId,
        eventDate: { gte: mulai, lt: selesai },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, eventDate: true },
    })

    if (existing) return { event: existing, created: false }

    const created = await this.create({
      organizationId,
      title: params.title,
      eventDate: params.eventDate,
      location: params.location ?? null,
      eventId: params.eventId ?? null,
    })
    return { event: created, created: true }
  }

  /** Tambah anggota ke daftar. Idempoten: anggota sama tidak jadi dua entri. */
  /**
   * Isi daftar sekaligus dengan banyak anggota.
   *
   * Memakai satu panggilan, bukan satu per anggota. Untuk organisasi dengan
   * puluhan anggota, memanggil tool satu-per-satu butuh puluhan putaran agent
   * dan bisa kehabisan langkah di tengah jalan.
   *
   * Semua anggota yang disebut masuk dengan status `UNCONFIRMED` — tidak ada
   * yang otomatis ditandai HADIR. Menandai hadir adalah keputusan manusia;
   * sistem tidak boleh mengarang kehadiran.
   */
  async seedMembers(input: {
    organizationId: string
    attendanceEventId: string
    /** Nama atau panggilan, seperti yang diucapkan di chat. */
    names: string[]
    /** Kalau true, semua anggota aktif ikut masuk. */
    includeAll?: boolean
  }): Promise<{
    added: Array<{ memberId: string; fullName: string; className: string | null }>
    notFound: string[]
    ambiguous: string[]
    totalActive: number
  }> {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: input.organizationId, isActive: true },
      select: { id: true, fullName: true, className: true, searchName: true },
      orderBy: { fullName: 'asc' },
    })

    const aliases = await this.prisma.memberAlias.findMany({
      where: { member: { organizationId: input.organizationId, isActive: true } },
      select: { alias: true, memberId: true },
    })

    const existing = await this.prisma.attendanceEntry.findMany({
      where: { attendanceEventId: input.attendanceEventId },
      select: { memberId: true },
    })
    const sudahDiDaftar = new Set(existing.map((row) => row.memberId))

    // Tanpa nama yang disebut, seluruh anggota aktif masuk.
    const semuaDiambil = input.includeAll === true || input.names.length === 0

    type Member = (typeof members)[number]
    const terpilih: Array<{ kunci: string; cocok: Member[] }> = semuaDiambil
      ? []
      : input.names.map((raw) => {
          const kunci = canonicalizeName(raw)
          const cocok = members.filter((member) => {
            if (member.searchName === kunci) return true
            if (canonicalizeName(member.fullName) === kunci) return true
            return aliases.some((a) => a.memberId === member.id && a.alias === kunci)
          })
          return { kunci, cocok }
        })

    const added: Array<{ memberId: string; fullName: string; className: string | null }> = []
    const notFound: string[] = []
    const ambiguous: string[] = []

    if (semuaDiambil) {
      for (const member of members) {
        if (sudahDiDaftar.has(member.id)) continue
        added.push({ memberId: member.id, fullName: member.fullName, className: member.className })
      }
    } else {
      for (const { kunci, cocok } of terpilih) {
        if (cocok.length === 0) {
          notFound.push(kunci)
          continue
        }
        if (cocok.length > 1) {
          // Menebak yang mana berarti data kehadiran salah orang.
          ambiguous.push(`${kunci} -> ${cocok.map((m) => m.fullName).join(' / ')}`)
          continue
        }
        const member = cocok[0]!
        if (sudahDiDaftar.has(member.id)) continue
        added.push({ memberId: member.id, fullName: member.fullName, className: member.className })
      }
    }

    // Urutan mengikuti daftar organisasi, bukan urutan disebut.
    const urut = new Map(members.map((m, i) => [m.id, i]))
    added.sort((a, b) => (urut.get(a.memberId) ?? 0) - (urut.get(b.memberId) ?? 0))

    if (added.length > 0) {
      await this.prisma.attendanceEntry.createMany({
        data: added.map((member, index) => ({
          attendanceEventId: input.attendanceEventId,
          memberId: member.memberId,
          displayName: member.fullName,
          className: member.className,
          // Tidak ada yang otomatis HADIR — kehadiran adalah keputusan manusia.
          status: 'UNCONFIRMED' as const,
          sortOrder: index,
        })),
        skipDuplicates: true,
      })
    }

    log.info(
      { organizationId: input.organizationId, added: added.length, notFound: notFound.length, ambiguous: ambiguous.length },
      'anggota ditambahkan ke daftar',
    )

    return { added, notFound, ambiguous, totalActive: members.length }
  }

  async addMember(input: AddMemberInput) {
    // Validasi anggota benar-benar milik organisasi.
    const member = await this.prisma.organizationMember.findFirst({
      where: { id: input.memberId, organizationId: input.organizationId },
      select: { id: true, fullName: true, className: true },
    })
    if (!member) {
      throw new AttendanceError('MEMBER_NOT_FOUND', 'Anggota tidak ditemukan di organisasi ini.')
    }

    const existing = await this.prisma.attendanceEntry.findUnique({
      where: { attendanceEventId_memberId: { attendanceEventId: input.attendanceEventId, memberId: member.id } },
      select: { id: true, status: true, reason: true },
    })

    if (existing) {
      if (input.skipIfExists !== false) {
        return { entryId: existing.id, created: false, alreadyPresent: true, member }
      }
      const updated = await this.prisma.attendanceEntry.update({
        where: { id: existing.id },
        data: { status: input.status ?? existing.status, reason: input.reason ?? existing.reason },
        select: { id: true, status: true, reason: true },
      })
      return { entryId: updated.id, created: false, alreadyPresent: true, member }
    }

    const maxOrder = await this.prisma.attendanceEntry.aggregate({
      where: { attendanceEventId: input.attendanceEventId },
      _max: { sortOrder: true },
    })

    const created = await this.prisma.attendanceEntry.create({
      data: {
        attendanceEventId: input.attendanceEventId,
        memberId: member.id,
        displayName: member.fullName,
        className: member.className,
        status: input.status ?? 'UNCONFIRMED',
        reason: input.reason ?? null,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
      select: { id: true, status: true, reason: true },
    })

    return { entryId: created.id, created: true, alreadyPresent: false, member }
  }

  /**
   * Ubah entri yang ada.
   *
   * SANGAT PENTING: kalau `reason` tidak diberikan, `reason` lama TIDAK
   * dihapus. Instructions dari pengguna kadang hanya menyentuh satu field,
   * dan sistem harus menghormati itu ("yg lain tetap").
   */
  async updateEntry(input: UpdateEntryInput) {
    const { event, entries } = await this.getEntries(input.organizationId, input.attendanceEventId)

    const entry = input.entryId
      ? entries.find((e) => e.id === input.entryId)
      : input.memberId
        ? entries.find((e) => e.memberId === input.memberId)
        : undefined

    if (!entry) {
      throw new AttendanceError(
        'ENTRY_NOT_FOUND',
        'Entri yang mau diubah tidak ada di daftar ini.',
      )
    }

    const data: Prisma.AttendanceEntryUpdateInput = {}

    if (input.status !== undefined) data.status = input.status
    if (input.reason !== undefined) data.reason = input.reason
    if (input.notes !== undefined) data.notes = input.notes
    if (input.displayName !== undefined) data.displayName = input.displayName
    if (input.className !== undefined) data.className = input.className

    const updated = await this.prisma.attendanceEntry.update({
      where: { id: entry.id },
      data,
      select: {
        id: true,
        memberId: true,
        displayName: true,
        className: true,
        status: true,
        reason: true,
        notes: true,
      },
    })

    void event
    return updated
  }

  /** Hapus entri (dengan catatan: pesan tidak bisa "dibatalkan" seperti undo). */
  async removeEntry(organizationId: string, attendanceEventId: string, entryId: string) {
    const { entries } = await this.getEntries(organizationId, attendanceEventId)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new AttendanceError('ENTRY_NOT_FOUND', 'Entri tidak ditemukan.')

    await this.prisma.attendanceEntry.delete({ where: { id: entry.id } })
    return { removed: entry }
  }

  /** Rekap jumlah per status. */
  async summarize(organizationId: string, attendanceEventId: string) {
    const { entries } = await this.getEntries(organizationId, attendanceEventId)
    const counts = new Map<AttendanceStatus, number>()
    for (const status of DEFAULT_TEMPLATE.sectionOrder) counts.set(status, 0)
    for (const entry of entries) {
      counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1)
    }
    return {
      total: entries.length,
      byStatus: Object.fromEntries(counts.entries()) as Record<AttendanceStatus, number>,
    }
  }

  /** Render daftar ke teks WhatsApp memakai template yang tersimpan. */
  async renderList(organizationId: string, attendanceEventId: string, options: RenderOptions = {}): Promise<string> {
    const { event, entries } = await this.getEntries(organizationId, attendanceEventId)

    const template = (event.formatHints as Partial<typeof DEFAULT_TEMPLATE> | null) ?? {}
    const title = options.title ?? extractTitle(event.markdownTemplate ?? '', `*${event.title.toUpperCase()}*`)

    return renderAttendanceList(toRenderEntries(entries), {
      ...options,
      title,
      template: { ...template, ...options.template },
    })
  }

  /** List entry siap render (dipakai tool yang butuh data + teks). */
  async listForRender(
    organizationId: string,
    attendanceEventId: string,
  ): Promise<{ event: Awaited<ReturnType<AttendanceService['getEvent']>>; renderEntries: RenderEntry[] }> {
    const { event, entries } = await this.getEntries(organizationId, attendanceEventId)
    return { event, renderEntries: toRenderEntries(entries) }
  }
}