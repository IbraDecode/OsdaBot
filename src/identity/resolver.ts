/**
 * Identity Engine — menyelesaikan "siapa orang ini" dan "siapa yang dimaksud".
 *
 * Aturan yang ditegakkan:
 *
 * 1. KLAIM IDENTITAS DI CHAT BUKAN BUKTI.
 *    Kalau seseorang bilang "aku ketua OSIS", itu TIDAK otomatis jadi admin.
 *    Hanya link `MemberIdentityLink` yang sudah `verifiedAt` yang diandalkan.
 *
 * 2. AMBIGUITAS SELALU DIMINTA KLARIFIKASI.
 *    Dua anggota bernama "Ibra" → jangan pilih salah satu. Tanya.
 *
 * 3. IDENTITAS WHATSAPP (PN/LID) ≠ IDENTITAS ORGANISASI (member UUID).
 *    Hubungan dengan anggota perlu dikonfirmasi; bridge-nya adalah `MemberIdentityLink`.
 */
import type { PrismaClient } from '@prisma/client'
import { getPhoneNumber, isGroupJid, normalizeJid, parseJid } from '../whatsapp/jid.js'
import { canonicalizeName, cleanNameInput, decideMatch, nicknameCandidates, type MatchCertainty } from './name-normalizer.js'

export interface ResolvedIdentity {
  /** UUID user internal, atau null bila belum terhubung ke akun mana pun. */
  userId: string | null
  /** UUID anggota di organisasi aktif, atau null. */
  memberId: string | null
  /** JID yang dipakai untuk membalas (sama dengan yang masuk). */
  jid: string
  /** Nomor telepon bila tersedia (LID bisa null). */
  phoneNumber: string | null
  /** Nama tampilan yang paling bisa dipercaya. */
  displayName: string
  /** True bila identitas WhatsApp sudah diverifikasi tertaut ke anggota. */
  isVerified: boolean
}

export interface ResolvedOrganization {
  /** Dipakai sebagai `organizationId` di seluruh layanan. */
  organizationId: string
  name: string
  timezone: string
}

export interface NameResolutionSuccess {
  certainty: 'unique'
  memberId: string
  memberName: string
  className: string | null
  /** Kandidat lain yang skornyarunner-up (bisa null). */
  alternativeName: string | null
}

export interface NameResolutionAmbiguous {
  certainty: 'ambiguous'
  candidates: Array<{ memberId: string; name: string; className: string | null }>
}

export interface NameResolutionNotFound {
  certainty: 'none'
}

export type NameResolution =
  | NameResolutionSuccess
  | NameResolutionAmbiguous
  | NameResolutionNotFound

export interface IdentityEngineDeps {
  prisma: PrismaClient
}

export class IdentityEngine {
  constructor(private readonly deps: IdentityEngineDeps) {}

  private get prisma() {
    return this.deps.prisma
  }

  /**
   * Pastikan baris `WhatsAppIdentity` ada untuk JID ini, dan kembalikan ID-nya.
   *
   * Catatan: baris dibuat otomatis supaya pesan pertama dari nomor mana pun
   * bisa dilacak. Tapi `verifiedAt` TIDAK diisi di sini — itu proses
   * verifikasi terpisah yang dilakukan admin.
   */
  async upsertIdentity(params: {
    jid: string
    pushName?: string | null
  }): Promise<string> {
    const jid = normalizeJid(params.jid)
    if (!jid) throw new Error('JID tidak valid')

    const parsed = parseJid(jid)
    const phoneNumber = parsed?.phoneNumber ?? null

    // JID PN dan LID adalah dua baris berbeda. Kalau yang masuk LID, jangan
    // Kalau yang masuk adalah LID, jangan diam-diam menebak nomor telepon
    // dari ID tersebut. LID bukan nomor.
    const existing = await this.prisma.whatsAppIdentity.findFirst({
      where: { OR: [{ pnJid: jid }, { lidJid: jid }] },
      select: { id: true },
    })
    if (existing) return existing.id

    const data =
      parsed?.kind === 'lid'
        ? { lidJid: jid, pushName: params.pushName ?? null }
        : { pnJid: jid, phoneNumber, pushName: params.pushName ?? null }

    const created = await this.prisma.whatsAppIdentity.create({ data, select: { id: true } })
    return created.id
  }

  /**
   * Resolve identitas pengirim menjadi konteks organisasi.
   *
   * Prioritas:
   *  1. Kalau chat-nya grup yang tertaut ke organisasi → pakai organisasi itu.
   *  2. Kalau pengirim punya tepat satu keanggotaan aktif → pakai itu.
   *  3. Kalau punya beberapa → butuh klarifikasi (bukan ditebak).
   */
  async resolveSender(params: {
    jid: string
    chatJid: string
    pushName?: string | null
  }): Promise<{
    identity: ResolvedIdentity
    organization: ResolvedOrganization | null
    /** Alasan kalau organisasi ambigu. */
    organizationAmbiguity: 'none' | 'multiple_memberships' | 'no_membership'
  }> {
    const identityId = await this.upsertIdentity({ jid: params.jid, pushName: params.pushName })

    const waIdentity = await this.prisma.whatsAppIdentity.findUnique({
      where: { id: identityId },
      select: {
        id: true,
        userId: true,
        pnJid: true,
        lidJid: true,
        phoneNumber: true,
        pushName: true,
        verifiedAt: true,
        user: {
          select: {
            id: true,
            displayName: true,
            memberships: {
              where: { isActive: true, organization: { isActive: true } },
              select: {
                id: true,
                organization: { select: { id: true, name: true, timezone: true } },
              },
            },
          },
        },
      },
    })

    if (!waIdentity) throw new Error('identitas WhatsApp tidak ditemukan setelah upsert')

    const jid = waIdentity.pnJid ?? waIdentity.lidJid ?? normalizeJid(params.jid)!
    const displayName =
      waIdentity.user?.displayName ?? waIdentity.pushName ?? params.pushName ?? getPhoneNumber(jid) ?? 'Pengguna'

    // Coba organizational context dari grup terlebih dahulu.
    let organization: ResolvedOrganization | null = null
    let ambiguity: 'none' | 'multiple_memberships' | 'no_membership' = 'no_membership'

    const memberships = waIdentity.user?.memberships ?? []

    if (isGroupJid(params.chatJid)) {
      const group = await this.prisma.group.findUnique({
        where: { jid: normalizeJid(params.chatJid)! },
        select: { organization: { select: { id: true, name: true, timezone: true } } },
      })
      if (group) {
        organization = {
          organizationId: group.organization.id,
          name: group.organization.name,
          timezone: group.organization.timezone,
        }
        ambiguity = 'none'
      }
    }

    if (!organization) {
      if (memberships.length === 1 && memberships[0]) {
        organization = {
          organizationId: memberships[0].organization.id,
          name: memberships[0].organization.name,
          timezone: memberships[0].organization.timezone,
        }
        ambiguity = 'none'
      } else if (memberships.length > 1) {
        organization = null
        ambiguity = 'multiple_memberships'
      } else {
        organization = null
        ambiguity = 'no_membership'
      }
    }

    const memberId = organization
      ? (memberships.find((m) => m.organization.id === organization!.organizationId)?.id ?? null)
      : null

    return {
      identity: {
        userId: waIdentity.userId,
        memberId,
        jid,
        phoneNumber: waIdentity.phoneNumber ?? getPhoneNumber(jid),
        displayName,
        isVerified: Boolean(waIdentity.verifiedAt) || Boolean(memberId),
      },
      organization,
      organizationAmbiguity: ambiguity,
    }
  }

  /**
   * Cari anggota berdasarkan nama/alias di SUATU organisasi.
   *
   * Mengembalikan klasifikasi, bukan "yang paling cocok" — supaya pemanggil
   * bisa memutuskan untuk bertanya ke pengguna.
   */
  async resolveMemberByName(organizationId: string, rawQuery: string): Promise<NameResolution> {
    const query = canonicalizeName(cleanNameInput(rawQuery))
    if (query === '') return { certainty: 'none' }

    const tokenVariants = nicknameCandidates(rawQuery)

    const members = await this.prisma.organizationMember.findMany({
      where: {
        organizationId,
        isActive: true,
        OR: [
          { searchName: { contains: query } },
          { searchName: { in: tokenVariants } },
          { searchName: { in: [query.split(' ')[0] ?? ''] } },
          { nickname: { contains: cleanNameInput(rawQuery), mode: 'insensitive' } },
          { aliases: { some: { alias: { in: tokenVariants } } } },
          { aliases: { some: { alias: { contains: query, mode: 'insensitive' } } } },
        ],
      },
      select: {
        id: true,
        fullName: true,
        className: true,
        nickname: true,
        searchName: true,
        aliases: { select: { alias: true } },
      },
      take: 25,
    })

    if (members.length === 0) return { certainty: 'none' }

    // Bentuk "nama tampilan" yang mencakup nama, panggilan, dan alias.
    const enriched = members.map((member) => ({
      id: member.id,
      name: member.fullName,
      className: member.className,
      searchable: [member.fullName, member.nickname ?? '', ...member.aliases.map((a) => a.alias)].filter(
        Boolean,
      ),
    }))

    // Kalau hanya satu anggota yang cocok teks persis → langsung einde.
    const exact = enriched.filter((member) => member.searchable.some((value) => canonicalizeName(value) === query))
    if (exact.length === 1 && exact[0]) {
      return {
        certainty: 'unique',
        memberId: exact[0].id,
        memberName: exact[0].name,
        className: exact[0].className,
        alternativeName: null,
      }
    }
    if (exact.length > 1) {
      return {
        certainty: 'ambiguous',
        candidates: exact.map((m) => ({ memberId: m.id, name: m.name, className: m.className })),
      }
    }

    // Tidak ada yang persis → pakai pencocokan fuzzy.
    const scored = enriched
      .map((member) => ({
        id: member.id,
        name: member.name,
        className: member.className,
        score: Math.max(
          ...member.searchable.map((value) => similarity(query, value)),
        ),
      }))
      .sort((a, b) => b.score - a.score)

    const decision = decideMatch(
      query,
      scored.map((s) => ({ id: s.id, name: s.name, className: s.className })),
    )

    const byId = new Map(scored.map((s) => [s.id, s]))

    if (decision.certainty === 'ambiguous' || decision.certainty === 'none') {
      const relevant = decision.ranked.filter((c) => c.score > 0.2).slice(0, 5)
      if (decision.certainty === 'ambiguous') {
        return {
          certainty: 'ambiguous',
          candidates: relevant.map((c) => {
            const s = byId.get(c.item.id)
            return { memberId: c.item.id, name: c.item.name, className: s?.className ?? null }
          }),
        }
      }
      return { certainty: 'none' }
    }

    const best = byId.get(decision.best!.id)
    const alternative = decision.ranked[1]?.item ?? null

    return {
      certainty: 'unique',
      memberId: decision.best!.id,
      memberName: decision.best!.name,
      className: best?.className ?? null,
      alternativeName: alternative ? alternative.name : null,
    }
  }

  /**
   * Resolve beberapa nama sekaligus. Berguna untuk "tambahin A, B, sama C".
   *
   * Hasil per-nama bisa 'ambiguous'/'none' supaya pemanggil bisa hanya
   * menanyakan yang bermasalah.
   */
  async resolveMembersByName(
    organizationId: string,
    rawQueries: string[],
  ): Promise<Array<{ query: string; resolution: NameResolution }>> {
    const results: Array<{ query: string; resolution: NameResolution }> = []
    for (const query of rawQueries) {
      results.push({ query, resolution: await this.resolveMemberByName(organizationId, query) })
    }
    return results
  }

  /**
   * Ambil identitas WhatsApp yang SUDAH TERVERIFIKASI untuk seorang anggota.
   * Hanya ini yang boleh dipakai untuk mention otomatis.
   */
  async verifiedIdentityForMember(
    memberId: string,
  ): Promise<{ jid: string; identityId: string } | null> {
    const link = await this.prisma.memberIdentityLink.findFirst({
      where: { memberId, verifiedAt: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        identity: { select: { id: true, pnJid: true, lidJid: true } },
      },
    })

    if (!link) return null
    const jid = link.identity.pnJid ?? link.identity.lidJid
    if (!jid) return null
    return { jid, identityId: link.identity.id }
  }

  /** Cek apakah anggota sudah punya identitas WhatsApp terverifikasi. */
  async hasVerifiedIdentity(memberId: string): Promise<boolean> {
    const count = await this.prisma.memberIdentityLink.count({
      where: { memberId, verifiedAt: { not: null } },
    })
    return count > 0
  }

  /**
   * Verifikasi tautan anggota <-> identitas WhatsApp.
   * Dipanggil oleh proses admin/botstrap, BUKAN dari klaim chat biasa.
   */
  async linkIdentity(params: {
    memberId: string
    identityId: string
    organizationId: string
    verifiedBy: string | null
    method: string
  }): Promise<void> {
    const member = await this.prisma.organizationMember.findFirst({
      where: { id: params.memberId, organizationId: params.organizationId },
      select: { id: true },
    })
    if (!member) throw new Error('Anggota tidak ditemukan di organisasi ini')

    await this.prisma.memberIdentityLink.upsert({
      where: { memberId_identityId: { memberId: params.memberId, identityId: params.identityId } },
      create: {
        memberId: params.memberId,
        identityId: params.identityId,
        organizationId: params.organizationId,
        verifiedAt: new Date(),
        verifiedBy: params.verifiedBy,
        method: params.method,
      },
      update: {
        verifiedAt: new Date(),
        verifiedBy: params.verifiedBy,
        method: params.method,
        organizationId: params.organizationId,
      },
    })

    // Betulkan pointer userId supaya izin bisa dihitung.
    const identity = await this.prisma.whatsAppIdentity.findUnique({
      where: { id: params.identityId },
      select: { userId: true },
    })

    if (identity && !identity.userId) {
      const memberWithUser = await this.prisma.organizationMember.findUnique({
        where: { id: params.memberId },
        select: { userId: true },
      })
      if (memberWithUser?.userId) {
        await this.prisma.whatsAppIdentity.update({
          where: { id: params.identityId },
          data: { userId: memberWithUser.userId },
        })
      }
    }
  }
}

/** Skor kecocokan sederhana (sinkron) — dipakai oleh resolver. */
function similarity(query: string, candidate: string): number {
  const q = canonicalizeName(query)
  const c = canonicalizeName(candidate)
  if (q === c) return 1
  if (q === '' || c === '') return 0
  const qt = new Set(q.split(' '))
  const ct = new Set(c.split(' '))
  let overlap = 0
  for (const token of qt) {
    if (ct.has(token)) {
      overlap += 1
      continue
    }
    for (const ctok of ct) {
      const shorter = token.length <= ctok.length ? token : ctok
      const longer = token.length <= ctok.length ? ctok : token
      if (shorter.length >= 3 && longer.startsWith(shorter)) {
        overlap += 0.7
        break
      }
    }
  }
  const total = Math.max(qt.size, ct.size)
  return total === 0 ? 0 : Math.min(1, overlap / total)
}

export type { MatchCertainty }