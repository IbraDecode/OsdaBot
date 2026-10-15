/**
 * Tool tautan grup WhatsApp.
 *
 * ── Kenapa ini penting ─────────────────────────────────────────────────────
 *
 * Bot yang ditambahkan ke grup tapi belum tertaut **diam**. Pesannya tidak
 * sampai ke agent, dan tidak ada penjelasan. Saat ini satu-satunya cara
 * menautkan adalah lewat terminal (`pnpm osda group:link`) — jadi admin yang
 * tidak punya akses server tidak bisa mengaktifkan bot-nya sendiri.
 *
 * Menautkan grup = memberikan akses ke data organisasi (anggota, kas, absensi).
 * Karena itu:
 *
 * 1. **Selalu butuh persetujuan.** Bot tidak boleh menautkan grup ke organisasi
 *    tanpa seseorang menyetujuinya.
 * 2. **Satu grup = satu organisasi.** Grup yang sudah dimiliki organisasi lain
 *    ditolak — kalau tidak, isi grup jadi dua sumber kebenaran.
 * 3. **Aktivasi default `MENTION_OR_REPLY`.** Bot yang membalas semua pesan di
 *    grup boros token dan menyela percakapan orang.
 */
import { z } from 'zod'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'
import { PERMISSIONS } from '../security/permissions.js'
import { GroupLinkError, type GroupLinkService } from '../groups/service.js'
import type { WhatsAppProvider } from '../whatsapp/types.js'

export interface GroupToolsDeps {
  groups: GroupLinkService
  whatsapp: Pick<WhatsAppProvider, 'listJoinedGroups'>
}

export function buildGroupTools(deps: GroupToolsDeps): Array<ToolDefinition<never, never>> {
  const { groups, whatsapp } = deps

  const listJoined: ToolDefinition<Record<string, never>, unknown> = {
    name: 'group_list_joined',
    description:
      'Tampilkan semua grup WhatsApp yang diikuti akun bot ini, beserta status tertaut atau belum. ' +
      'Pakai ini kalau admin bertanya "kenapa bot tidak merespons di grup" — supaya bisa dilihat persis grup mana yang belum tertaut.',
    inputSchema: z.object({}).strict() as never,
    requiredPermissions: [PERMISSIONS.GROUPS_CONFIGURE],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute() {
      const joined = await whatsapp.listJoinedGroups()
      if (joined.length === 0) {
        return { groups: [], message: 'Bot belum ikut di grup WhatsApp mana pun.' }
      }

      const tertaut = await groups.listLinked()
      const peta = new Map(tertaut.map((g) => [g.jid, g]))

      return {
        groups: joined.map((g) => {
          const row = peta.get(g.jid)
          return {
            jid: g.jid,
            subject: g.subject ?? null,
            linked: Boolean(row),
            organizationName: row?.organizationName ?? null,
            activation: row?.activation ?? null,
          }
        }),
        belumTertaut: joined.filter((g) => !peta.has(g.jid)).length,
        message: joined
          .map((g) => `${g.subject ?? g.jid}: ${peta.has(g.jid) ? 'tertaut' : 'BELUM tertaut'}`)
          .join(' | '),
      }
    },
  }

  const link: ToolDefinition<{ jid?: string; activation?: string; purpose?: string }, unknown> = {
    name: 'group_link',
    description:
      'Hubungkan grup WhatsApp ke organisasi ini supaya bot mulai merespons di sana. ' +
      'PAKAI PERSETUJUAN. Hanya administrator yang boleh; di grup yang belum tertaut, bot akan diam total tanpa memberi tahu. ' +
      'Panggil group_list_joined dulu untuk melihat JID grup yang belum tertaut. ' +
      'Setelah tertaut, bot hanya merespons kalau namanya disebut atau di-mention — itu disengaja.',
    inputSchema: z
      .object({
        jid: z
          .string()
          .max(64)
          .optional()
          .describe('JID grup (diakhiri @g.us). Kalau tidak disebut, pakai grup belum tertaut yang paling baru.'),
        activation: z
          .enum(['MENTION_OR_REPLY', 'ALL_MESSAGES', 'OFF'])
          .optional()
          .describe('Kapan bot merespons. Default MENTION_OR_REPLY — hanya kalau disebut. ALL_MESSAGES boros token dan mengganggu.'),
        purpose: z.string().max(200).optional().describe('Kegunaan grup di organisasi, mis. "Panitia LKBB".'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.GROUPS_LINK],
    riskLevel: 'HIGH',
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      // Tanpa JID, pakai grup yang belum tertaut. Kalau ada lebih dari satu,
      // jangan menebak — menautkan grup yang salah memberi akses data ke chat
      // yang tidak seharusnya.
      let jid = input.jid
      if (!jid) {
        const tertaut = new Set((await groups.listLinked()).map((g) => g.jid))
        const joined = await whatsapp.listJoinedGroups()
        const kandidat = joined.filter((g) => !tertaut.has(g.jid))

        if (kandidat.length === 0) {
          throw new ToolError('VALIDATION_FAILED', 'Semua grup yang diikuti bot sudah tertaut.')
        }
        if (kandidat.length > 1) {
          throw new ToolError(
            'VALIDATION_FAILED',
            `Ada ${kandidat.length} grup yang belum tertaut: ${kandidat.map((g) => g.subject ?? g.jid).join(' / ')}. ` +
              'Sebutkan yang mana dengan parameter jid — jangan menebak.',
          )
        }
        jid = kandidat[0]!.jid
      }

      try {
        const hasil = await groups.link({
          organizationId,
          jid,
          purpose: input.purpose ?? null,
          ...(input.activation ? { activation: input.activation as 'MENTION_OR_REPLY' | 'ALL_MESSAGES' | 'OFF' } : {}),
        })

        return {
          jid: hasil.jid,
          subject: hasil.subject,
          activation: hasil.activation,
          message:
            `Grup "${hasil.subject ?? hasil.jid}" sekarang tertaut ke organisasi ini. ` +
            `Bot hanya akan merespons kalau namanya disebut atau di-mention (mode ${hasil.activation}).`,
        }
      } catch (error) {
        if (error instanceof GroupLinkError) {
          throw new ToolError('CONFLICT', error.message)
        }
        throw error
      }
    },
  }

  const setActivation: ToolDefinition<{ jid?: string; mode: 'MENTION_OR_REPLY' | 'ALL_MESSAGES' | 'OFF' }, unknown> = {
    name: 'group_set_activation',
    description:
      'Ubah kapan bot merespons di grup. Pakai OFF kalau grup terlalu ramai dan botnya mengganggu.',
    inputSchema: z
      .object({
        jid: z.string().max(64).optional().describe('JID grup. Kosongkan kalau hanya ada satu grup tertaut.'),
        mode: z
          .enum(['MENTION_OR_REPLY', 'ALL_MESSAGES', 'OFF'])
          .describe('MENTION_OR_REPLY hanya kalau disebut; ALL_MESSAGES semua pesan; OFF tidak pernah.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.GROUPS_CONFIGURE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      void context

      let jid = input.jid
      if (!jid) {
        const tertaut = await groups.listLinked()
        if (tertaut.length === 0) {
          throw new ToolError('NOT_FOUND', 'Belum ada grup yang tertaut.')
        }
        if (tertaut.length > 1) {
          throw new ToolError(
            'VALIDATION_FAILED',
            `Ada ${tertaut.length} grup tertaut: ${tertaut.map((g) => g.subject ?? g.jid).join(' / ')}. Sebutkan yang mana.`,
          )
        }
        jid = tertaut[0]!.jid
      }

      try {
        const hasil = await groups.setActivation(jid, input.mode)
        return {
          jid: hasil.jid,
          activation: hasil.activation,
          message: `Aktivasi grup ${hasil.jid} diubah ke ${hasil.activation}.`,
        }
      } catch (error) {
        if (error instanceof GroupLinkError) {
          throw new ToolError('NOT_FOUND', error.message)
        }
        throw error
      }
    },
  }

  return [listJoined, link, setActivation] as never
}

function requireOrg(context: ToolExecutionContext): string {
  if (!context.organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum terdeteksi untuk percakapan ini.')
  }
  return context.organizationId
}