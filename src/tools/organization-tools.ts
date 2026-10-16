/**
 * Tool organisasi & WhatsApp.
 *
 * Catatan keamanan untuk `whatsapp.send_message`:
 *  - pengiriman massal WAJIB lewat permission terpisah (`whatsapp.bulk_send`),
 *    bukan memakai izin kirim biasa;
 *  - `requiresApproval` untuk pengiriman ke grup, karena pengirim bisa menyalah-
 *    paham dan bot akan mengirim atas namanya;
 *  - hasil pengiriman dikembalikan apa adanya (termasuk status `unknown` yang
 *    berarti "tidak diketahui", bukan "gagal").
 */
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { canonicalizeName } from '../identity/name-normalizer.js'
import { PERMISSIONS } from '../security/permissions.js'
import { formatMention, parseJid } from '../whatsapp/jid.js'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'

export interface OrganizationToolsDeps {
  prisma: PrismaClient
  whatsapp: WhatsAppProvider
}

// =============================================================================
// Organisasi
// =============================================================================

export function buildOrganizationTools(deps: OrganizationToolsDeps): Array<ToolDefinition<never, never>> {
  const { prisma, whatsapp } = deps

  const listMembers: ToolDefinition<{ search?: string; limit?: number; offset?: number }, unknown> = {
    name: 'organization_list_members',
    description:
      'Lihat daftar anggota organisasi, boleh disaring dengan pencarian nama. Gunakan saat pengguna menanyakan isi keanggotaan ataujumlah anggota.',
    inputSchema: z.object({
      search: z.string().max(120).optional().describe('Saring berdasarkan nama atau panggilan.'),
      limit: z.number().int().positive().max(200).optional().describe('Jumlah hasil. Default 50.'),
      offset: z.number().int().min(0).optional(),
    }) as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const search = input.search ? canonicalizeName(input.search) : null
      const take = input.limit ?? 50

      const members = await prisma.organizationMember.findMany({
        where: {
          organizationId,
          isActive: true,
          ...(search
            ? {
                OR: [
                  { searchName: { contains: search } },
                  { nickname: { contains: search, mode: 'insensitive' as const } },
                  { aliases: { some: { alias: { contains: search, mode: 'insensitive' as const } } } },
                ],
              }
            : {}),
        },
        orderBy: [{ fullName: 'asc' }],
        skip: input.offset ?? 0,
        take,
        select: {
          id: true,
          fullName: true,
          className: true,
          nickname: true,
          aliases: { select: { alias: true } },
          // Identitas WhatsApp ikut diambil supaya "kirim tagihan ke Budi"
          // bisa dijawab tanpa menebak nomornya.
          //
          // Hanya yang **terverifikasi** yang diambil: mention otomatis ke
          // orang yang belum membuktikan nomornya adalah kesalahan yang tidak
          // bisa ditarik kembali.
          identityLinks: {
            where: { verifiedAt: { not: null } },
            select: { identity: { select: { id: true, pnJid: true, lidJid: true } } },
            take: 1,
          },
        },
      })

      const total = await prisma.organizationMember.count({ where: { organizationId, isActive: true } })

      return {
        total,
        returned: members.length,
        members: members.map((member) => {
          const identitas = member.identityLinks[0]?.identity ?? null
          return {
            memberId: member.id,
            name: member.fullName,
            class: member.className,
            nickname: member.nickname,
            aliases: member.aliases.map((alias) => alias.alias),
            whatsappVerified: Boolean(identitas),
            // Hanya diisi kalau tautannya terverifikasi. `null` berarti "tidak
            // tahu" — bukan berarti nomornya tidak ada.
            whatsappJid: identitas?.pnJid ?? identitas?.lidJid ?? null,
          }
        }),
      }
    },
  }

  const searchMember: ToolDefinition<{ query: string }, unknown> = {
    name: 'organization_search_members',
    description:
      'Cari anggota berdasarkan nama atau panggilan. WAJIB dipakai sebelum mengubah data yang menyebut nama orang, supaya tidak salah orang. Kalau hasilnya lebih dari satu, wajib minta klarifikasi ke pengguna.',
    inputSchema: z.object({
      query: z.string().min(1).max(120).describe('Nama atau panggilan anggota yang dicari.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const query = canonicalizeName(input.query)

      const members = await prisma.organizationMember.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { searchName: { contains: query } },
            { searchName: { contains: query.split(' ')[0] ?? query } },
            { nickname: { contains: input.query, mode: 'insensitive' } },
            { aliases: { some: { alias: { contains: input.query, mode: 'insensitive' } } } },
          ],
        },
        take: 25,
        select: {
          id: true,
          fullName: true,
          className: true,
          nickname: true,
          aliases: { select: { alias: true } },
          identityLinks: {
            where: { verifiedAt: { not: null } },
            select: { identity: { select: { pnJid: true, lidJid: true } } },
          },
        },
      })

      if (members.length === 0) {
        return {
          status: 'not_found',
          query: input.query,
          message: `Anggota "${input.query}" tidak ada di daftar organisasi ini. Jangan mengarang — tanyakan nama yang tepat.`,
        }
      }

      // Cocokkan persis dengan nama/panggilan/alias supaya bisa menilai ambiguitas.
      const exact = members.filter((member) => {
        const kandidat = [member.fullName, member.nickname ?? '', ...member.aliases.map((a) => a.alias)]
        return kandidat.some((value) => value && canonicalizeName(value) === query)
      })

      const toCandidate = (member: (typeof members)[number]) => ({
        memberId: member.id,
        name: member.fullName,
        class: member.className,
        whatsappVerified: member.identityLinks.length > 0,
      })

      if (exact.length === 1 && exact[0]) {
        return { status: 'unique', ...toCandidate(exact[0]) }
      }

      if (exact.length > 1) {
        return {
          status: 'ambiguous',
          candidates: exact.map(toCandidate),
          message: `Ada ${exact.length} anggota yang cocok. Minta pengguna pilih — jangan menebak.`,
        }
      }

      // Tidak ada yang persis → kembali daftar kandidat terdekat.
      return {
        status: 'multiple_candidates',
        candidates: members.slice(0, 8).map(toCandidate),
        message: `Tidak ada yang persis cocok dengan "${input.query}". Yang paling mirip — tanyakan ke pengguna.`,
      }
    },
  }

  const createMember: ToolDefinition<{ fullName: string; className?: string | null; aliases?: string[] }, unknown> = {
    name: 'organization_create_member',
    description:
      'Tambahkan anggota baru ke master anggota organisasi. Gunakan saat pengguna mengirim daftar nama (mis. "masukin daftar ini jadi anggota LKBB") atau menambah orang baru. Data anggota TIDAK otomatis terhubung ke nomor WhatsApp — itu perlu verifikasi terpisah.',
    inputSchema: z.object({
      fullName: z.string().min(2).max(160).describe('Nama lengkap anggota.'),
      className: z.string().max(60).nullish().describe('Kelas / rombongan, mis. "X AKL 3".'),
      aliases: z.array(z.string().min(1).max(80)).max(10).optional().describe('Nama panggilan tambahan.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      // Cek duplikat nama persis agar tidak menambah dua orang dengan nama sama
      // tanpa sadar (menyembunyikan baris 'cadangan' pun dibuat diam-diam).
      const searchName = canonicalizeName(input.fullName)
      const existing = await prisma.organizationMember.findMany({
        where: { organizationId, isActive: true, searchName },
        select: { id: true, fullName: true, className: true },
      })

      const created = await prisma.organizationMember.create({
        data: {
          organizationId,
          fullName: input.fullName.trim(),
          className: input.className?.trim() ?? null,
          searchName,
          aliases: {
            create: (input.aliases ?? []).map((alias) => ({ alias: canonicalizeName(alias) })),
          },
        },
        select: { id: true, fullName: true, className: true },
      })

      return {
        memberId: created.id,
        name: created.fullName,
        class: created.className,
        possibleDuplicates: existing.map((member) => ({ name: member.fullName, class: member.className })),
        warning:
          existing.length > 0
            ? `Perhatian: sudah ada anggota bernama "${input.fullName}" di organisasi ini. Kalau ini orang yang sama, bilang saja supaya tidak jadi dua data.`
            : undefined,
        message: `${created.fullName} sudah ditambahkan. Nomor WhatsApp-nya belum terhubung — itu perlu verifikasi manual.`,
      }
    },
  }

  const getRoles: ToolDefinition<Record<string, never>, unknown> = {
    name: 'organization_get_roles',
    description: 'Lihat daftar peran dalam organisasi beserta izinnya. Gunakan saat ada pertanyaan soal siapa boleh melakukan apa.',
    inputSchema: z.object({}) as never,
    requiredPermissions: [PERMISSIONS.ROLES_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(_input, context) {
      const organizationId = requireOrg(context)
      const roles = await prisma.organizationRole.findMany({
        where: { organizationId },
        orderBy: { key: 'asc' },
        select: {
          key: true,
          name: true,
          description: true,
          permissions: { select: { permissionId: true } },
          _count: { select: { memberBindings: true } },
        },
      })

      return {
        roles: roles.map((role) => ({
          key: role.key,
          name: role.name,
          description: role.description,
          memberCount: role._count.memberBindings,
          permissions: role.permissions.map((permission) => permission.permissionId),
        })),
      }
    },
  }

  const getEvents: ToolDefinition<{ limit?: number }, unknown> = {
    name: 'organization_get_events',
    description: 'Lihat kegiatan yang sudah tercatat di organisasi beserta tanggalnya.',
    inputSchema: z.object({ limit: z.number().int().positive().max(50).optional() }) as never,
    requiredPermissions: [PERMISSIONS.EVENTS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const events = await prisma.event.findMany({
        where: { organizationId },
        orderBy: { startsAt: 'desc' },
        take: input.limit ?? 20,
        select: { id: true, title: true, startsAt: true, endsAt: true, location: true, status: true },
      })
      return {
        events: events.map((event) => ({
          eventId: event.id,
          title: event.title,
          startsAt: event.startsAt?.toISOString() ?? null,
          endsAt: event.endsAt?.toISOString() ?? null,
          location: event.location,
          status: event.status,
        })),
      }
    },
  }

  // =============================================================================
  // WhatsApp
  // =============================================================================

  const sendMessage: ToolDefinition<
    { to?: string; text: string; quoteMessageId?: string | null; mentionMemberIds?: string[] },
    unknown
  > = {
    name: 'whatsapp_send_message',
    description:
      'Kirim pesan teks WhatsApp. TUJUAN WAJIB diisi eksplisit — kalau tidak, pakai chat tempat perintah datang. Untuk mengirim ke grup, tanyakan dulu ke pengguna karena pesan yang terkirim tidak bisa ditarik kembali.',
    inputSchema: z.object({
      to: z
        .string()
        .optional()
        .describe('JID tujuan (mis. 628123@s.whatsapp.net atau 123-456@g.us). Kosongkan untuk chat aktif.'),
      text: z.string().min(1).max(4000).describe('Isi pesan.'),
      quoteMessageId: z.string().max(128).nullish().describe('Balas pesan tertentu.'),
      mentionMemberIds: z
        .array(z.string().uuid())
        .max(50)
        .optional()
        .describe('ID anggota yang perlu di-mention. Hanya yang nomornya sudah terverifikasi.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'MEDIUM',
    // Selalu perlu persetujuan: pesan yang terkirim tidak bisa ditarik, dan
    // penerima bisa salah orang. Untuk pesan biasa di chat sendiri pun masih
    // dicek di registry lewat `approvalPolicy`.
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const target = input.to?.trim() || context.chatJid

      const parsed = parseJid(target)
      if (!parsed) throw new ToolError('VALIDATION_FAILED', `JID tujuan tidak valid: ${target}`)

      // Resolusi mention HANYA dari identitas yang sudah terverifikasi.
      const mentions: string[] = []
      const skippedMentions: Array<{ memberId: string; name: string; reason: string }> = []

      for (const memberId of input.mentionMemberIds ?? []) {
        const link = await prisma.memberIdentityLink.findFirst({
          where: {
            memberId,
            organizationId,
            verifiedAt: { not: null },
            identity: { OR: [{ pnJid: { not: null } }, { lidJid: { not: null } }] },
          },
          select: {
            identity: { select: { pnJid: true, lidJid: true } },
            member: { select: { fullName: true } },
          },
        })

        const jid = link?.identity.pnJid ?? link?.identity.lidJid
        if (jid) {
          mentions.push(jid)
        } else {
          skippedMentions.push({
            memberId,
            name: link?.member.fullName ?? memberId,
            reason: 'Nomor WhatsApp belum terverifikasi',
          })
        }
      }

      if ((input.mentionMemberIds?.length ?? 0) > 0 && !mentions.length) {
        throw new ToolError(
          'PERMISSION_DENIED',
          'Tidak ada anggota yang bisa di-mention karena nomor WhatsApp-nya belum terverifikasi. Jangan mengarang nomor.',
        )
      }

      const body = mentions.length > 0 ? `${input.text}\n\n${mentions.map(formatMention).join(' ')}` : input.text

      const result = await whatsapp.sendText(target, body, {
        targetJid: target,
        ...(input.quoteMessageId ? { quotedMessageId: input.quoteMessageId } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
        idempotencyKey: `tool:${organizationId}:${context.correlationId}:${target}`,
      })

      // Status jujur: `provider_accepted` BUKAN "sudah dibaca".
      return {
        to: target,
        providerMessageId: result.providerMessageId,
        status: result.status,
        mentioned: mentions.length,
        skippedMentions,
        message: deliveryMessage(result.status, target),
      }
    },
  }

  const reactMessage: ToolDefinition<{ messageId: string; emoji: string }, unknown> = {
    name: 'whatsapp_react_message',
    description: 'Beri reaksi pada sebuah pesan (mis. centang saat tugas selesai). Emoji kosong menghapus reaksi.',
    inputSchema: z.object({
      messageId: z.string().min(1).max(128),
      emoji: z.string().max(8).describe('Emoji reaksi. String kosong untuk menghapus.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const result = await whatsapp.reactToMessage(context.chatJid, input.messageId, input.emoji)
      if (result.status === 'failed') {
        throw new ToolError('PROVIDER_UNAVAILABLE', 'Reaksi gagal dikirim.', true)
      }
      return { ok: true, status: result.status }
    },
  }

  const getGroupMembers: ToolDefinition<Record<string, never>, unknown> = {
    name: 'whatsapp_get_group_members',
    description:
      'Ambil daftar anggota grup WhatsApp. Hanya untuk memastikan keanggotaan grup — BUKAN untuk menilai siapa yang berwenang dalam organisasi.',
    inputSchema: z.object({}) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(_input, context) {
      const parsed = parseJid(context.chatJid)
      if (parsed?.kind !== 'group') {
        throw new ToolError('VALIDATION_FAILED', 'Perintah ini hanya bisa dijalankan di dalam grup.')
      }

      const metadata = await whatsapp.getGroupMetadata(context.chatJid)
      if (!metadata) throw new ToolError('PROVIDER_UNAVAILABLE', 'Metadata grup tidak bisa diambil.', true)

      return {
        groupJid: metadata.jid,
        subject: metadata.subject,
        participantCount: metadata.participantCount,
        participants: metadata.participants.map((participant) => ({
          jid: participant.jid,
          isGroupAdmin: participant.isAdmin,
        })),
        note: 'Status admin di grup WhatsApp BUKAN berarti hak administrasi dalam organisasi.',
      }
    },
  }

  const getGroupMetadata: ToolDefinition<{ groupJid?: string }, unknown> = {
    name: 'whatsapp_get_group_metadata',
    description: 'Ambil metadata grup (nama, jumlah anggota). Berguna untuk mengenali grup yang belum tertaut ke organisasi.',
    inputSchema: z.object({ groupJid: z.string().optional() }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const jid = input.groupJid ?? context.chatJid
      const metadata = await whatsapp.getGroupMetadata(jid)
      if (!metadata) throw new ToolError('NOT_FOUND', 'Grup tidak ditemukan atau tidak bisa diakses.')

      const linked = await prisma.group.findUnique({
        where: { jid: metadata.jid },
        select: { organizationId: true, purpose: true, activation: true },
      })

      return {
        groupJid: metadata.jid,
        subject: metadata.subject,
        description: metadata.description,
        participantCount: metadata.participantCount,
        linkedOrganizationId: linked?.organizationId ?? null,
        purpose: linked?.purpose ?? null,
        activation: linked?.activation ?? null,
      }
    },
  }

  return [
    listMembers,
    searchMember,
    createMember,
    getRoles,
    getEvents,
    sendMessage,
    reactMessage,
    getGroupMembers,
    getGroupMetadata,
  ] as never
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

/** Pesan jujur tentang hasil pengiriman. */
export function deliveryMessage(status: string, target: string): string {
  switch (status) {
    case 'provider_accepted':
      return 'Pesan sudah diserahkan ke WhatsApp (belum tentu sudah dibaca).'
    case 'delivered':
      return 'Pesan sudah sampai.'
    case 'unknown':
      return 'Status pengiriman belum diketahui. Jangan menganggap gagal, tapi jangan juga menganggap terkirim.'
    case 'failed':
      return `Pesan gagal dikirim ke ${target}.`
    default:
      return 'Pengiriman sedang diproses.'
  }
}