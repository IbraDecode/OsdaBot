/**
 * Tool pengingat untuk AI.
 *
 * ── Aturan yang tidak boleh dilanggar ──────────────────────────────────────
 *
 * 1. `chatJid` TIDAK PERNAH dari argumen model.
 *
 *    Kalau model boleh menentukan tujuan, ia bisa membuat bot mengirim pesan
 *    ke chat mana pun. Tujuan berasal dari `context.chatJid` — chat tempat
 *    perintah datang — atau dari grup yang sudah tertaut ke organisasi.
 *
 * 2. Waktu harus dalam bentuk absolut dan terikat zona waktu organisasi.
 *
 *    Model mengubah "besok jam 9" menjadi tanggal. Kalau tanggalnya kosong
 *    atau ambigu, jangan menebak: tanya balik.
 *
 * 3. Pengingat di masa lalu langsung ditolak.
 *
 *    Worker membatalkan yang telat > 10 menit. Kalau tool diam-diam membuat
 *    pengingat untuk 2 jam yang lalu, hasilnya adalah baris `FAILED` yang
 *    membingungkan.
 */
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { PERMISSIONS } from '../security/permissions.js'
import type { ReminderService } from '../reminders/service.js'
import { parseJid } from '../whatsapp/jid.js'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'

export interface ReminderToolsDeps {
  prisma: PrismaClient
  reminders: ReminderService
}

/** Maksimal seberapa jauh ke depan pengingat boleh dijadwalkan. */
const MAKS_MENDEKAT = 365 * 24 * 60 * 60 * 1000 // 1 tahun

/** Minimal selisih dari sekarang. Batas grace worker adalah 10 menit. */
const MIN_SELISIH_MS = 60 * 1000 // 1 menit

export function buildReminderTools(deps: ReminderToolsDeps): Array<ToolDefinition<never, never>> {
  const { prisma, reminders } = deps

  const createReminder: ToolDefinition<
    { title: string; body: string; scheduledAt: string; toGroupTitle?: string },
    unknown
  > = {
    name: 'reminder_create',
    description:
      'Buat pengingat yang akan dikirim ke chat ini pada waktu tertentu. Gunakan saat pengguna minta "ingatkan saya", ' +
      '"kirim pengingat", atau menjadwalkan pesan untuk nanti. WAKTU WAJIB absolut (mis. 2026-10-20T09:00:00), ' +
      'dihitung dalam zona waktu organisasi. Jangan mengarang waktu — kalau pengguna tidak menyebut waktu yang jelas, tanya dulu.',
    inputSchema: z.object({
      title: z.string().min(1).max(120).describe('Judul singkat, mis. "Latihan LKBB".'),
      body: z.string().min(1).max(1000).describe('Isi pengingat.'),
      scheduledAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
        .describe('Waktu absolut ISO tanpa zona waktu, mis. "2026-10-20T09:00:00". Dipakai zona waktu organisasi.'),
      toGroupTitle: z
        .string()
        .max(120)
        .optional()
        .describe('Judul grup tujuan kalau pengingat untuk grup. Kosongkan untuk chat ini.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.AUTOMATION_CREATE],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      // --- Waktu -----------------------------------------------------------
      const scheduledAt = parseWaktu(input.scheduledAt, context.timezone)
      const sekarang = Date.now()
      const selisih = scheduledAt.getTime() - sekarang

      if (selisih < MIN_SELISIH_MS) {
        throw new ToolError(
          'VALIDATION_FAILED',
          'Waktu pengingat sudah lewat. Tentukan waktu yang akan datang.',
        )
      }

      if (selisih > MAKS_MENDEKAT) {
        throw new ToolError(
          'VALIDATION_FAILED',
          'Waktu pengingat terlalu jauh (lebih dari setahun).',
        )
      }

      // --- Tujuan ----------------------------------------------------------
      // Destinasi TIDAK pernah diterima dari argumen model.
      const chatJid = await resolveTujuan({
        prisma,
        organizationId,
        context,
        toGroupTitle: input.toGroupTitle,
      })

      const hasil = await reminders.schedule({
        organizationId,
        chatJid,
        actorUserId: context.actorUserId,
        title: input.title,
        body: input.body,
        scheduledAt,
      })

      return {
        success: true as const,
        data: {
          reminderId: hasil.id,
          scheduledAt: scheduledAt.toISOString(),
          timezone: context.timezone,
          destination: describeTujuan(chatJid),
          duplicate: hasil.deduped,
          message: hasil.deduped
            ? `Sudah ada pengingat dengan isi sama di waktu itu — tidak dibuat duplikat.`
            : `Pengingat dijadwalkan untuk ${formatWaktu(scheduledAt, context.timezone)}.`,
        },
      }
    },
  }

  const listReminders: ToolDefinition<{ limit?: number }, unknown> = {
    name: 'reminder_list',
    description:
      'Lihat daftar pengingat yang masih terjadwal. Gunakan saat pengguna bertanya "ada pengingat apa saja" atau "pengingat saya yang mana".',
    inputSchema: z.object({
      limit: z.number().int().positive().max(50).optional().describe('Jumlah hasil. Default 20.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.AUTOMATION_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const semua = await reminders.listActive(organizationId)
      const hasil = semua.slice(0, input.limit ?? 20)

      return {
        success: true as const,
        data: {
          count: hasil.length,
          reminders: hasil.map((item) => ({
            id: item.id,
            title: item.title,
            body: item.body,
            scheduledAt: item.scheduledAt.toISOString(),
            scheduledLocal: formatWaktu(item.scheduledAt, context.timezone),
          })),
          message:
            hasil.length === 0
              ? 'Tidak ada pengingat yang terjadwal.'
              : `${hasil.length} pengingat akan dikirim.`,
        },
      }
    },
  }

  const cancelReminder: ToolDefinition<{ reminderId?: string; all?: boolean }, unknown> = {
    name: 'reminder_cancel',
    description:
      'Batalkan satu pengingat, atau semua pengingat yang terjadwal. Gunakan saat pengguna membatalkan pengingat.',
    inputSchema: z.object({
      reminderId: z.string().uuid().optional().describe('ID pengingat dari reminder.list.'),
      all: z.boolean().optional().describe('Batalkan semua. Set true kalau pengguna bilang "batal semua".'),
    }) as never,
    requiredPermissions: [PERMISSIONS.AUTOMATION_CANCEL],
    riskLevel: 'MEDIUM',
    // Pembatalan bisadue salah paham yang tidak bisa dibatalkan.
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      if (input.all) {
        const jumlah = await reminders.cancelAll(organizationId)
        return {
          success: true as const,
          data: { cancelled: jumlah, message: `${jumlah} pengingat dibatalkan.` },
        }
      }

      if (!input.reminderId) {
        throw new ToolError(
          'VALIDATION_FAILED',
          'Sebutkan reminderId, atau set all=true untuk membatalkan semua.',
        )
      }

      // Hanya bisa membatalkan milik organisasi sendiri.
      const milik = await prisma.scheduledJob.findFirst({
        where: { id: input.reminderId, organizationId },
        select: { id: true },
      })

      if (!milik) {
        throw new ToolError('NOT_FOUND', 'Pengingat itu tidak ditemukan di organisasimu.')
      }

      const ok = await reminders.cancel(input.reminderId)
      return {
        success: true as const,
        data: {
          cancelled: ok ? 1 : 0,
          message: ok ? 'Pengingat dibatalkan.' : 'Pengingat itu sudah tidak aktif.',
        },
      }
    },
  }

  return [createReminder, listReminders, cancelReminder] as never
}

function requireOrg(context: ToolExecutionContext): string {
  if (!context.organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum teridentifikasi.')
  }
  return context.organizationId
}

/**
 * Parse waktu tanpa zona waktu, dalam zona waktu organisasi.
 *
 * Sengaja tidak memakai `new Date(string)` tanpa keterangan: itu memakai
 * zona waktu **server**, yang bisa berbeda dari zona waktu organisasi. Satu
 * pengingat meleset 8 jam karena itu.
 */
export function parseWaktu(input: string, timezone: string): Date {
  const cocok = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim())
  if (!cocok) {
    throw new ToolError(
      'VALIDATION_FAILED',
      'Format waktu harus YYYY-MM-DDTHH:MM, mis. 2026-10-20T09:00',
    )
  }

  const [, tahun, bulan, hari, jam, menit, detik = '00'] = cocok
  const utcMs = Date.UTC(
    Number(tahun),
    Number(bulan) - 1,
    Number(hari),
    Number(jam),
    Number(menit),
    Number(detik),
  )

  // Zona waktu organisasi bisa geser "../" seluruh hari, bukan cuma jam.
  const awalNaif = new Date(utcMs)
  const offset = zonaOffsetMs(awalNaif, timezone)
  return new Date(utcMs - offset)
}

/**
 * Offset zona waktu pada satu momen, dalam milidetik.
 *
 * Dihitung dengan cara yang benar: kirim waktu UTC sebagai waktu lokal,
 * lalu bandingkan. `getTimezoneOffset` saja tidak cukup untuk zona dengan
 * DST.
 */
function zonaOffsetMs(waktu: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

    const bagian = Object.fromEntries(
      formatter.formatToParts(waktu).map((p) => [p.type, p.value]),
    )

    const sebagaiUtc = Date.UTC(
      Number(bagian.year),
      Number(bagian.month) - 1,
      Number(bagian.day),
      Number(bagian.hour) % 24,
      Number(bagian.minute),
      Number(bagian.second),
    )

    return sebagaiUtc - waktu.getTime()
  } catch {
    // Zona waktu tidak dikenal di sistem ini — pakai UTC lebih baik daripada
    // gagal total.
    return 0
  }
}

/** Format waktu lokal organisasi untuk ditampilkan ke pengguna. */
export function formatWaktu(waktu: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(waktu)
  } catch {
    return waktu.toISOString()
  }
}

/**
 * Tentukan chat tujuan pengingat.
 *
 * Kalau `toGroupTitle` diisi, grup dicari **di dalam organisasi itu saja**.
 * Grup yang tidak tertaut ke organisasi tidak bisa dipakai, dan model tidak
 * boleh menebak-nebak yang mana.
 *
 * Kalau lebih dari satu grup cocok, TIDAK dipilih salah satu — dikembalikan
 * sebagai ambigu supaya pengguna yang memutuskan. Salah pilih berarti
 * pengingat terkirim ke grup yang salah, dan itu tidak bisa ditarik.
 */
async function resolveTujuan(input: {
  prisma: PrismaClient
  organizationId: string
  context: ToolExecutionContext
  toGroupTitle?: string
}): Promise<string> {
  const { prisma, organizationId, context, toGroupTitle } = input

  if (!toGroupTitle) {
    // Default: chat tempat perintah datang. Berasal dari pipeline, bukan model.
    return context.chatJid
  }

  const grup = await prisma.group.findMany({
    where: { organizationId, isArchived: false },
    select: { jid: true, subject: true, purpose: true },
  })

  if (grup.length === 0) {
    throw new ToolError(
      'NOT_FOUND',
      'Belum ada grup yang tertaut ke organisasimu, jadi pengingat grup tidak bisa dibuat.',
    )
  }

  const cari = toGroupTitle.trim().toLowerCase()
  const cocok = grup.filter((item) => {
    const subjek = item.subject?.toLowerCase() ?? ''
    const tujuan = item.purpose?.toLowerCase() ?? ''
    return subjek.includes(cari) || tujuan.includes(cari)
  })

  if (cocok.length === 0) {
    const daftar = grup.map((item) => item.subject ?? item.jid).join(', ')
    throw new ToolError(
      'NOT_FOUND',
      `Grup "${toGroupTitle}" tidak ditemukan. Grup yang tersedia: ${daftar}`,
    )
  }

  if (cocok.length > 1) {
    const daftar = cocok.map((item) => item.subject ?? item.jid).join(', ')
    throw new ToolError(
      'AMBIGUOUS_REFERENCE',
      `Ada beberapa grup yang cocok dengan "${toGroupTitle}": ${daftar}. Tanya pengguna yang dimaksud.`,
    )
  }

  return cocok[0]!.jid
}

function describeTujuan(chatJid: string): string {
  const parsed = parseJid(chatJid)
  if (parsed?.kind === 'group') return 'grup tertaut'
  return 'chat ini'
}