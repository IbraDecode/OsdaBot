/**
 * Onboarding anggota.
 *
 * `linkAdmin` di provisioning hanya untuk orang pertama yang punya peran
 * `owner`. Organisasi nyata punya puluhan anggota, dan menambah mereka satu
 * per satu lewat SQL tidak realistis.
 *
 * Yang Ditambah vs provisioning
 * ---------------------------
 * - Bisa massal (dari teks atau berkas).
 * - Peran bisa apa saja, bukan hanya owner.
 * - Alias untuk resolusi nama lewat chat ("ketika", "bang").
 * - Validasi nama duplikat diorganisasi yang sama.
 *
 * Yang SENGAJA tidak ada
 * ---------------------
 * - Verifikasi nomor. Modul ini tidak pernah mengisi `verifiedAt`.
 * - Penghapusan anggota. Salah hapus berarti data hilang.
 * - Impor massal tanpa batas. Lihat `MAX_BATCH`.
 */
import type { PrismaClient } from '@prisma/client'
import { canonicalizeName } from '../identity/name-normalizer.js'
import { assertValidPhone, phoneToJid } from './provisioning.js'

/**
 * Batas anggota per batch.
 *
 * Import tanpa batas itu berbahaya: satu berkas salah bisa menyimpan ribuan
 * anggota palsu dan membuat resolusi nama mustahil dipakai. Lebih baik gagal
 * dengan pesan jelas.
 */
const MAX_BATCH = 500

/**
 * Alias peran berbahasa Indonesia.
 *
 * `ROLE_TEMPLATES` memakai kunci berbahasa Inggris (`member`, `secretary`)
 * karena itu yang tersimpan di database dan dipakai di audit log. Tapi
 * operator mengetik dalam bahasa Indonesia, dan "anggota" yang ditolak
 * dengan pesan "peran tidak dikenal" itu membingungkan tanpa penjelasan.
 *
 * Alias ini hanya untuk INPUT. Yang disimpan tetap kunci kanonik.
 */
const ROLE_ALIASES: Record<string, string> = {
  anggota: 'member',
  ketua: 'committee',
  ketua_panitia: 'committee',
  panitia: 'committee',
  sekretaris: 'secretary',
  bendahara: 'treasurer',
  kasir: 'treasurer',
  pengelola_kehadiran: 'attendance_manager',
  absen: 'attendance_manager',
}

/**
 * Terjemahkan input peran ke kunci kanonik.
 *
 * Mengembalikan input apa adanya kalau tidak dikenal — supaya pesan galat
 * bisa menyebut apa yang benar-benar diketik pengguna.
 */
export function resolveRoleKey(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ROLE_ALIASES[normalized] ?? input.trim()
}

export interface MemberInput {
  fullName: string
  phone: string
  roleKey?: string
  className?: string
  aliases?: string[]
}

export interface MemberResult {
  fullName: string
  phone: string
  status: 'created' | 'updated' | 'skipped'
  reason?: string
  memberId?: string
}

export interface AddMembersInput {
  organizationId: string
  members: MemberInput[]
  /** Peran kalau tidak ditentukan per anggota. */
  defaultRoleKey?: string
}

export class MemberProvisioner {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Tambahkan banyak anggota sekaligus.
   *
   * Tidak melempar error pada satu baris yang gagal — dikembalikan sebagai
   * `skipped` dengan alasannya. Import dari file teks biasanya punya beberapa
   * baris salah; berhenti di baris pertama membuat operator harus mengulang
   * dari awal.
   */
  async addMembers(input: AddMembersInput): Promise<MemberResult[]> {
    if (input.members.length > MAX_BATCH) {
      throw new Error(
        `Melebihi batas ${MAX_BATCH} anggota per batch (diminta ${input.members.length}). ` +
          `Pecah jadi beberapa batch supaya kalau ada yang salah tidak hilang semuanya.`,
      )
    }

    const roleKeys = new Map<string, string>()
    for (const member of input.members) {
      const requested = member.roleKey ?? input.defaultRoleKey ?? 'anggota'
      const key = resolveRoleKey(requested)
      if (roleKeys.has(key)) continue

      const role = await this.prisma.organizationRole.findUnique({
        where: { organizationId_key: { organizationId: input.organizationId, key } },
        select: { id: true },
      })

      if (!role) {
        throw new Error(
          `Peran "${key}" belum ada di organisasi ini. ` +
            `Pilihan yang tersedia: ${(await this.listRoles(input.organizationId)).join(', ')}`,
        )
      }

      roleKeys.set(key, role.id)
    }

    const results: MemberResult[] = []
    for (const member of input.members) {
      results.push(await this.addOne(input.organizationId, member, roleKeys))
    }
    return results
  }

  private async addOne(
    organizationId: string,
    member: MemberInput,
    roleKeys: Map<string, string>,
  ): Promise<MemberResult> {
    const fullName = member.fullName.trim()
    const searchName = canonicalizeName(fullName)

    if (!searchName) {
      return { fullName, phone: member.phone, status: 'skipped', reason: 'Nama kosong setelah normalisasi' }
    }

    // Nama yang isinya cuma simbol lolos normalisasi sebagai-is-nya:
    // canonicalizeName('!!!') === '!!!'. Kalau dibiarkan, anggota dengan
    // searchName sampah masuk dan resolution nama saat chat jadi kacau.
    if (!/[\p{L}\p{N}]/u.test(searchName)) {
      return {
        fullName,
        phone: member.phone,
        status: 'skipped',
        reason: 'Nama tidak mengandung huruf atau angka',
      }
    }

    // Nomor boleh kosong.
    //
    // Daftar hadir bekerja berdasarkan NAMA, bukan nomor — jadi anggota yang
    // WhatsApp-nya belum diketahui tetap berguna dan boleh masuk. Nomor bisa
    // dilengkapi nanti.
    //
    // Yang tidak boleh kosong adalah nomor yang DISEBERKAN tapi salah.
    let digits = ''
    if (member.phone.trim() !== '') {
      try {
        digits = assertValidPhone(member.phone)
      } catch (error) {
        return {
          fullName,
          phone: member.phone,
          status: 'skipped',
          reason: error instanceof Error ? error.message : 'Nomor tidak valid',
        }
      }
    }

    // Dicari dengan kunci kanonik supaya cocok dengan yang di-resolve di atas.
    const roleKey = resolveRoleKey(member.roleKey ?? 'anggota')
    const roleId = roleKeys.get(roleKey)!

    // 1. Identitas — hanya kalau nomornya ada.
    let identityId: string | undefined
    let userId: string | null = null

    if (digits) {
      const pnJid = phoneToJid(digits)
      const adaIdentity = await this.prisma.whatsAppIdentity.findUnique({
        where: { pnJid },
        select: { id: true, userId: true },
      })

      identityId = adaIdentity?.id
      userId = adaIdentity?.userId ?? null

      if (!identityId) {
        const user = await this.prisma.user.create({
          data: {
            displayName: fullName,
            identities: { create: { pnJid, phoneNumber: digits, pushName: fullName } },
          },
          select: { id: true, identities: { select: { id: true } } },
        })
        identityId = user.identities[0]!.id
        userId = user.id
      }
    }


    // 2. Anggota. Kalau nama sudah dipakai anggota lain di organisasi ini,
    //   umeric*-again membuat dua anggota dengan nama sama adalah bug, bukan
    //    fitur — jadi digabung, bukan dibuat terpisah.
    const ada = await this.prisma.organizationMember.findFirst({
      where: { organizationId, searchName },
      select: { id: true },
    })

    let memberId = ada?.id
    const anggotaBaru = !ada
    let status: MemberResult['status'] = ada ? 'updated' : 'created'

    if (memberId) {
      const diperbarui = await this.prisma.organizationMember.update({
        where: { id: memberId },
        data: {
          ...(userId ? { userId } : {}),
          ...(member.className ? { className: member.className } : {}),
          isActive: true,
        },
        select: { id: true },
      })
      memberId = diperbarui.id
    } else {
      const baru = await this.prisma.organizationMember.create({
        data: {
          organizationId,
          ...(userId ? { userId } : {}),
          fullName,
          searchName,
          ...(member.className ? { className: member.className } : {}),
          isActive: true,
        },
        select: { id: true },
      })
      memberId = baru.id
    }

    // 3. Peran. Peran yang sudah ada dipertahankan — jangan menimpa peran
    //    anggota yang sengaja dinaikkan.
    const peranExisting = await this.prisma.memberRoleBinding.findMany({
      where: { memberId },
      select: { roleId: true },
    })
    if (!peranExisting.some((binding) => binding.roleId === roleId)) {
      await this.prisma.memberRoleBinding.create({ data: { memberId, roleId } })

      // Menambah peran pada anggota yang SUDAH ADA berarti perubahan.
      // Untuk anggota yang baru dibuat, peran pertamanya adalah bagian dari
      // pembuatan — bukan perubahan. Kalau tidak dibedakan, laporan impor
      // akan Reported semua orang sebagai "diperbarui" padahal baru dibuat.
      if (!anggotaBaru) status = 'updated'
    }

    // 4. Alias.
    for (const alias of member.aliases ?? []) {
      const normalized = canonicalizeName(alias)
      if (!normalized || normalized === searchName) continue
      const sudah = await this.prisma.memberAlias.findFirst({
        where: { memberId, alias: normalized },
        select: { id: true },
      })
      if (!sudah) await this.prisma.memberAlias.create({ data: { memberId, alias: normalized } })
    }

    // 5. Tautan identitas — hanya kalau ada identitasnya.
    //    verifiedAt dibiarkan null — lihat provisioning.ts.
    if (identityId) {
      await this.prisma.memberIdentityLink.upsert({
        where: { memberId_identityId: { memberId, identityId } },
        create: {
          memberId,
          identityId,
          organizationId,
          method: 'CLI_IMPORT',
          // verifiedAt SENGAJA kosong.
        },
        update: { organizationId },
      })
    }

    return { fullName, phone: digits, status, memberId }
  }

  /** Daftar peran yang tersedia di organisasi. */
  async listRoles(organizationId: string): Promise<string[]> {
    const roles = await this.prisma.organizationRole.findMany({
      where: { organizationId },
      orderBy: { key: 'asc' },
      select: { key: true },
    })
    return roles.map((role) => role.key)
  }

  /**
   * Parse teks anggota sederhana.
   *
   * Format per baris: `Nama | 628xxxxxxxxx | peran | kelas | alias1,alias2`
   *
   * Garis yang diawali `#` diabaikan. Kolom yang kosong berarti pakai
   * bawaan. Baris yang tidak punya nomor tetap dibaca sebagai anggota —
   * nomor bisa dilengkapi nanti, dan anggota tanpa nomor masih berguna untuk
   * daftar hadir.
   */
  static parseText(text: string): { members: MemberInput[]; errors: string[] } {
    const members: MemberInput[] = []
    const errors: string[] = []

    const lines = text.split('\n')
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return

      const parts = trimmed.split('|').map((part) => part.trim())
      const [name, phone = '', role = '', className = '', aliasText = ''] = parts

      if (!name) {
        errors.push(`Baris ${index + 1}: nama kosong`)
        return
      }

      if (phone && !/^\+?[\d\s-()]{8,20}$/.test(phone)) {
        errors.push(`Baris ${index + 1} (${name}): nomor tampak tidak valid — "${phone}"`)
        return
      }

      members.push({
        fullName: name,
        phone: phone || '',
        ...(role ? { roleKey: role } : {}),
        ...(className ? { className } : {}),
        ...(aliasText
          ? { aliases: aliasText.split(',').map((alias) => alias.trim()).filter(Boolean) }
          : {}),
      })
    })

    return { members, errors }
  }
}