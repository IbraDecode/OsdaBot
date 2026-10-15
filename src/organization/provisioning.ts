/**
 * Provisioning organisasi.
 *
 * Menyediakan jalan yang bisa diulang untuk menyiapkan organisasi NYATA tanpa
 * bergantung pada seed. Seed mengisi data fiktif untuk pengembangan; modul ini
 * mengisi data yang sebenarnya dipakai.
 *
 * ── Bagian yang paling menentukan ───────────────────────────────────────────
 *Ada satu langkah yang mudah dilewatkan: **menghubungkan nomor WhatsApp admin ke
 * anggota + peran**.
 *
 * Tanpa itu, organisasi ada, permission ada, tapi tidak ada yang bisa memakai
 * bot. Setiap pesan dibalas "aku belum tahu kamu bagian dari organisasi mana".
 * `WHATSAPP_ADMIN_PHONE` di env selama ini hanya dibaca untuk penyaringan —
 * tidak pernah memberi akses apa pun ke database.
 *
 * Rantai yang harus benar:
 *
 *   WhatsAppIdentity.userId ──→ User
 *                               │
 *                               └─→ OrganizationMember.userId ──→ MemberRoleBinding
 *                                                                           │
 *                                                                           └─→ RolePermission
 *
 * Ada satu hal yang TIDAK boleh diotomatisasi: `verifiedAt`. Nomor di
 * environment adalah klaim, belum bukti. Mengisinya berarti menyatakan
 * "nomor ini sudah dibuktikan miliknya", dan tidak ada yang membuktikannya.
 *
 * CATATAN: `verifiedAt` TIDAK menentukan boleh-tidaknya memakai bot.
 * Yang menentukan adalah rantai
 * `identity.userId -> User -> Member -> MemberRoleBinding -> RolePermission`.
 * `verifiedAt` adalah penanda kepercayaan yang terpisah. Verified secara
 * empiris: setelah `linkAdmin`, `resolveSender()` mengembalikan userId,
 * memberId, dan organisasi — bot langsung bisa dipakai.
 */
import type { PrismaClient } from '@prisma/client'
import { canonicalizeName } from '../identity/name-normalizer.js'
import { ALL_PERMISSIONS } from '../security/permissions.js'
import { ROLE_TEMPLATES, expandPermissions } from '../security/role-templates.js'

export interface ProvisionOrganizationInput {
  name: string
  /** Slug. Kalau kosong, dibuat dari nama. */
  slug?: string
  timezone?: string
  locale?: string
  /** Templat peran yang dibuat. Default semua. */
  roleKeys?: string[]
}

export interface ProvisionAdminInput {
  organizationId: string
  fullName: string
  /** Nomor format digits + kode negara, mis. 6281234567890. */
  phone: string
  /** Peran yang diberikan. Default `owner`. */
  roleKey?: string
  /** Alias tambahan untuk resolusi nama via chat. */
  aliases?: string[]
}

export interface LinkResult {
  userId: string
  memberId: string
  identityId: string
  roleKey: string
  /** True kalau nomor ini pertama kali ditautkan. */
  created: boolean
}

/**
 * Ubah nama menjadi slug yang aman untuk URL/ID.
 *
 * Panjang dibatasi supaya tidak memotong kolom, dan tanda baca dibuang supaya
 * slug tidak mengandung karakter yang harus di-escape di mana-mana.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  // Slug kosong (mis. nama hanya simbol) tidak bisa dipakai sebagai kunci unik.
  return slug || 'organisasi'
}

/**
 * Ubah nomor telepon menjadi PN-JID.
 *
 * Format WA yang dipakai WhatsApp: `<digits>@s.whatsapp.net` tanpa tanda `+`.
 */
export function phoneToJid(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  return `${digits}@s.whatsapp.net`
}

/** Validasi nomor sebelum dipakai — nomor salah berarti akses salah orang. */
export function assertValidPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error(
      `Nomor tidak valid: "${phone}". Pakai digits + kode negara tanpa '+', '-', spasi, atau kurung (mis. 6281234567890).`,
    )
  }
  return digits
}

export class OrganizationProvisioner {
  constructor(private readonly prisma: PrismaClient) {}

  /** Pastikan permission global ada. Idempoten. */
  async ensurePermissions(): Promise<number> {
    // Permissionglobal adalah data referensi, bukan data organisasi.
    // Seed sudah membuatnya; di sini hanya dijamin agar provisioning
    // tidak gagal karena permission yang hilang.
    const ada = await this.prisma.permission.count()
    if (ada === 0) {
      throw new Error(
        'Tabel permission kosong. Jalankan `pnpm osda db:seed` lebih dulu untuk mengisi permission global.',
      )
    }
    return ALL_PERMISSIONS.length
  }

  /**
   * Buat organisasi beserta templat perannya.
   *
   * Idempoten terhadap `slug`: memanggil dua kali dengan slug sama tidak
   * membuat duplikat.
   */
  async createOrganization(input: ProvisionOrganizationInput): Promise<{ id: string; slug: string; name: string }> {
    const slug = input.slug ? slugify(input.slug) : slugify(input.name)

    const organization = await this.prisma.organization.upsert({
      where: { slug },
      create: {
        name: input.name,
        slug,
        timezone: input.timezone ?? 'Asia/Makassar',
        locale: input.locale ?? 'id',
        settings: {
          groupActivation: 'MENTION_OR_REPLY',
          requireApprovalForBulkMessages: true,
        },
      },
      update: {
        // Nama & zona waktu boleh diperbarui; slug tidak (memakai kunci unik).
        name: input.name,
        timezone: input.timezone ?? 'Asia/Makassar',
      },
      select: { id: true, slug: true, name: true },
    })

    const wanted = input.roleKeys
      ? ROLE_TEMPLATES.filter((role) => input.roleKeys?.includes(role.key))
      : ROLE_TEMPLATES

    if (wanted.length === 0) {
      throw new Error(`Templat peran tidak dikenal: ${(input.roleKeys ?? []).join(', ')}`)
    }

    for (const template of wanted) {
      const permissions = expandPermissions(template.permissions, ALL_PERMISSIONS)

      const role = await this.prisma.organizationRole.upsert({
        where: { organizationId_key: { organizationId: organization.id, key: template.key } },
        create: {
          organizationId: organization.id,
          key: template.key,
          name: template.name,
          description: template.description,
          isSystem: true,
        },
        update: { name: template.name, description: template.description },
        select: { id: true },
      })

      // Permission peran diganti utuh, bukan ditumpuk — supaya template yang
      // diperbarui benar-benar berlaku dan tidak ada izin nyasar yang tertinggal.
      await this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
      await this.prisma.rolePermission.createMany({
        data: permissions.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      })
    }

    return organization
  }

  /**
   * Hubungkan nomor WhatsApp ke anggota yang punya peran.
   *
   * Idempoten: nomor yang sama dipanggil dua kali tidak membuat anggota atau
   * peran ganda.
   *
   * CATATAN KEAMANAN: `verifiedAt` SENGAJA TIDAK diisi. Nomor dari environment
   * adalah klaim, bukan bukti — mengisinya berarti menyatakan sesuatu yang
   * tidak pernah dibuktikan.
   *
   * Ini TIDAK memblokir akses: rantai `userId -> Member -> Role` yang
   * menentukan izin, dan itu sudah terisi di sini.
   */
  async linkAdmin(input: ProvisionAdminInput): Promise<LinkResult> {
    const digits = assertValidPhone(input.phone)
    const pnJid = phoneToJid(digits)
    const roleKey = input.roleKey ?? 'owner'

    const role = await this.prisma.organizationRole.findUnique({
      where: { organizationId_key: { organizationId: input.organizationId, key: roleKey } },
      select: { id: true },
    })

    if (!role) {
      throw new Error(
        `Peran "${roleKey}" belum ada di organisasi ini. Jalankan provisioning peran lebih dulu.`,
      )
    }

    // 1. User + identitas WhatsApp.
    const existingIdentity = await this.prisma.whatsAppIdentity.findUnique({
      where: { pnJid },
      select: { id: true, userId: true, phoneNumber: true, pushName: true },
    })

    let identityId: string
    let userId: string
    let created = false

    if (existingIdentity?.userId) {
      identityId = existingIdentity.id
      userId = existingIdentity.userId
    } else if (existingIdentity) {
      // Identitas sudah ada tapi belum punya User.
      //
      // Ini kondisi nyata: identitas bisa dibuat duluan (mis. oleh percakapan
      // sebelumnya) lalu User-nya belum pernah dibuat. Versi lama mencoba
      // `user.create` dengan `pnJid` yang sama dan bentrok unique.
      //
      // Yang benar: buat User-nya, lalu SAMBUNGKAN ke identitas yang sudah
      // ada. Identitas WhatsApp tidak boleh diduplikasi — nomor itu satu.
      const user = await this.prisma.user.create({
        data: { displayName: input.fullName },
        select: { id: true },
      })

      await this.prisma.whatsAppIdentity.update({
        where: { id: existingIdentity.id },
        data: {
          userId: user.id,
          phoneNumber: existingIdentity.phoneNumber ?? digits,
          pushName: existingIdentity.pushName ?? input.fullName,
        },
      })

      identityId = existingIdentity.id
      userId = user.id
      created = true
    } else {
      const user = await this.prisma.user.create({
        data: {
          displayName: input.fullName,
          identities: {
            create: {
              pnJid,
              phoneNumber: digits,
              pushName: input.fullName,
            },
          },
        },
        select: { id: true, identities: { select: { id: true } } },
      })

      identityId = user.identities[0]!.id
      userId = user.id
      created = true
    }

    // 2. Anggota di organisasi ini.
    //
    // TIDAK pakai `upsert` dengan kunci gabungan: `OrganizationMember` tidak
    // punya unique constraint pada (organizationId, searchName), hanya index.
    // Menambahkan constraint itu akan melarang dua anggota bernama sama —
    // itu bisa sah di organisasi nyata, jadi bukan urusan modul ini.
    //
    // Yang penting: menjalankan perintah ini dua kali tidak boleh membuat
    // anggota ganda.
    const searchName = canonicalizeName(input.fullName)

    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId: input.organizationId, searchName },
      select: { id: true },
    })

    const memberId = member
      ? (
          await this.prisma.organizationMember.update({
            where: { id: member.id },
            data: { userId, isActive: true },
            select: { id: true },
          })
        ).id
      : (
          await this.prisma.organizationMember.create({
            data: {
              organizationId: input.organizationId,
              userId,
              fullName: input.fullName,
              searchName,
              isActive: true,
            },
            select: { id: true },
          })
        ).id

    // Alias untuk resolusi nama lewat chat ("ketika", "bang", dan sejenisnya).
    //
    // `MemberAlias` juga tidak punya unique constraint pada (memberId, alias),
    // jadi dicek dulu sebelum membuat supaya perintah ini tetap idempoten.
    for (const alias of input.aliases ?? []) {
      const normalized = canonicalizeName(alias)
      if (!normalized || normalized === searchName) continue

      const sudahAda = await this.prisma.memberAlias.findFirst({
        where: { memberId, alias: normalized },
        select: { id: true },
      })

      if (!sudahAda) {
        await this.prisma.memberAlias.create({ data: { memberId, alias: normalized } })
      }
    }

    // 3. Peran.
    await this.prisma.memberRoleBinding.upsert({
      where: { memberId_roleId: { memberId, roleId: role.id } },
      create: { memberId, roleId: role.id },
      update: {},
    })

    // 4. Tautan identitas → anggota.
    //    `verifiedAt` dibiarkan null; lihat catatan di docblock fungsi ini.
    await this.prisma.memberIdentityLink.upsert({
      where: { memberId_identityId: { memberId, identityId } },
      create: {
        memberId,
        identityId,
        organizationId: input.organizationId,
        method: 'CLI_PROVISION',
        // verifiedAt SENGAJA null — lihat catatan keamanan di docblock.
      },
      update: { organizationId: input.organizationId },
    })

    return { userId, memberId, identityId, roleKey, created }
  }

  /** Ringkasan siap-takai untuk ditampilkan ke operator. */
  async describe(organizationId: string): Promise<{
    name: string
    slug: string
    timezone: string
    memberCount: number
    roleCount: number
    linkedPhones: Array<{ name: string; phone: string; roles: string[]; verified: boolean }>
  }> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, slug: true, timezone: true },
    })

    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId, isActive: true },
      select: {
        fullName: true,
        userId: true,
        identityLinks: {
          select: { verifiedAt: true, identity: { select: { phoneNumber: true } } },
        },
        roleBindings: { select: { role: { select: { key: true } } } },
      },
    })

    return {
      ...org,
      memberCount: members.length,
      roleCount: await this.prisma.organizationRole.count({ where: { organizationId } }),
      linkedPhones: members.map((member) => ({
        name: member.fullName,
        phone: member.identityLinks[0]?.identity.phoneNumber ?? '(belum terhubung)',
        roles: member.roleBindings.map((binding) => binding.role.key),
        verified: member.identityLinks.some((link) => link.verifiedAt !== null),
      })),
    }
  }
}