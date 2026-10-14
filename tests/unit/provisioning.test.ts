/**
 * Test provisioning organisasi.
 *
 * Fokusnya: perintah ini MEMBUAT akun yang punya akses ke data organisasi.
 * Kesalahan di sini berarti orang yang salah bisa masuk, atau orang yang
 * benar tidak bisa masuk sama sekali.
 */
import { describe, expect, it } from 'vitest'
import {
  OrganizationProvisioner,
  assertValidPhone,
  phoneToJid,
  slugify,
} from '../../src/organization/provisioning.js'

describe('slugify', () => {
  it('menurunkan huruf dan mengganti spasi', () => {
    expect(slugify('OSIS SMA Negeri 1 Lombok')).toBe('osis-sma-negeri-1-lombok')
  })

  it('membuang tanda baca', () => {
    expect(slugify('LKBB "Rajawali" (#2024)')).toBe('lkbb-rajawali-2024')
  })

  it('TIDAK menghasilkan slug kosong', () => {
    // Slug kosong akan bentrok dengan entri lain saat dipakai sebagai kunci unik.
    expect(slugify('###')).toBe('organisasi')
    expect(slugify('   ')).toBe('organisasi')
    expect(slugify('!!!')).toBe('organisasi')
  })

  it('memotong slug yang sangat panjang', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })

  it('idempoten untuk input yang sama', () => {
    expect(slugify('OSIS')).toBe(slugify('osis'))
  })
})

describe('phoneToJid', () => {
  it('membuat PN-JID tanpa tanda plus', () => {
    expect(phoneToJid('6281234567890')).toBe('6281234567890@s.whatsapp.net')
  })

  it('membuang formatasi yang tidak perlu', () => {
    expect(phoneToJid('+62 812-3456-7890')).toBe('6281234567890@s.whatsapp.net')
    expect(phoneToJid('(628) 1234567890')).toBe('6281234567890@s.whatsapp.net')
  })
})

describe('assertValidPhone', () => {
  it('menerima nomor Indonesia yang wajar', () => {
    expect(assertValidPhone('6285177653481')).toBe('6285177653481')
    expect(assertValidPhone('6285792820173')).toBe('6285792820173')
  })

  it('MENOLAK nomor yang tidak masuk akal', () => {
    // Nomor salah berarti akses diberikan ke orang yang salah.
    expect(() => assertValidPhone('12345')).toThrow(/tidak valid/)
    expect(() => assertValidPhone('1234567890123456')).toThrow(/tidak valid/)
    expect(() => assertValidPhone('abc')).toThrow(/tidak valid/)
    expect(() => assertValidPhone('')).toThrow(/tidak valid/)
  })
})

// ── Provisioner dengan test double ──────────────────────────────────────────

/**
 * Test double yang cukup untuk menguji idempotensi dan urutan operasi.
 *
 * Sengaja tidak memakai database sungguhan supaya perilakunya bisa diamati.
 */
function buatPrismaPalsu() {
  const panggil: string[] = []
  const state = {
    organizations: [] as Array<Record<string, unknown>>,
    roles: [] as Array<Record<string, unknown>>,
    permissions: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    aliases: [] as Array<Record<string, unknown>>,
    roleBindings: [] as Array<Record<string, unknown>>,
    links: [] as Array<Record<string, unknown>>,
    identities: [] as Array<Record<string, unknown>>,
  }

  const prisma = {
    permission: { count: async () => 50 },

    organization: {
      upsert: async ({ where, create }: { where: { slug: string }; create: Record<string, unknown> }) => {
        panggil.push('organization.upsert')
        const ada = state.organizations.find((o) => o.slug === where.slug)
        if (ada) {
          return { id: ada.id as string, slug: ada.slug as string, name: ada.name as string }
        }
        const baru: Record<string, unknown> = { id: `org-${state.organizations.length + 1}`, ...create }
        state.organizations.push(baru)
        return { id: baru.id as string, slug: baru.slug as string, name: baru.name as string }
      },
    },

    organizationRole: {
      upsert: async ({ where, create }: { where: { organizationId_key: { organizationId: string; key: string } }; create: Record<string, unknown> }) => {
        panggil.push('role.upsert')
        const key = where.organizationId_key.key
        let role = state.roles.find((r) => r.key === key)
        if (!role) {
          const baru: Record<string, unknown> = { id: `role-${key}`, ...create }
          state.roles.push(baru)
          role = baru
        }
        return { id: role.id as string }
      },
      findUnique: async ({ where }: { where: { organizationId_key: { organizationId: string; key: string } } }) => {
        const key = where.organizationId_key.key
        const role = state.roles.find((r) => r.key === key)
        return role ? { id: role.id as string } : null
      },
      count: async () => state.roles.length,
    },

    rolePermission: {
      deleteMany: async () => {
        panggil.push('rolePermission.deleteMany')
        return { count: 0 }
      },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        panggil.push(`rolePermission.createMany:${data.length}`)
        state.permissions.push(...data)
        return { count: data.length }
      },
    },

    whatsAppIdentity: {
      findUnique: async ({ where }: { where: { pnJid: string } }) => {
        const identity = state.identities.find((i) => i.pnJid === where.pnJid)
        return identity ? { id: identity.id as string, userId: identity.userId ?? null } : null
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        panggil.push('identity.update')
        return {}
      },
    },

    user: {
      create: async ({ data }: { data: Record<string, unknown> & { identities: { create: Record<string, unknown> } } }) => {
        panggil.push('user.create')
        const id = `user-${state.identities.length + 1}`
        state.identities.push({ id: `ident-${id}`, userId: id, ...data.identities.create })
        return { id, identities: [{ id: `ident-${id}` }] }
      },
    },

    organizationMember: {
      findFirst: async ({ where }: { where: { organizationId: string; searchName: string } }) => {
        const member = state.members.find(
          (m) => m.organizationId === where.organizationId && m.searchName === where.searchName,
        )
        return member ? { id: member.id as string } : null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        panggil.push('member.create')
        const baru = { id: `member-${state.members.length + 1}`, ...data }
        state.members.push(baru)
        return { id: baru.id as string }
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        panggil.push('member.update')
        const member = state.members.find((m) => m.id === where.id)
        if (member) Object.assign(member, data)
        return { id: where.id }
      },
      findMany: async () => [],
    },

    memberAlias: {
      findFirst: async ({ where }: { where: { memberId: string; alias: string } }) => {
        const alias = state.aliases.find((a) => a.memberId === where.memberId && a.alias === where.alias)
        return alias ? { id: alias.id as string } : null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        panggil.push('alias.create')
        state.aliases.push({ id: `alias-${state.aliases.length + 1}`, ...data })
        return {}
      },
    },

    memberRoleBinding: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        panggil.push('roleBinding.upsert')
        const ada = state.roleBindings.find(
          (b) => b.memberId === create.memberId && b.roleId === create.roleId,
        )
        if (!ada) state.roleBindings.push({ id: `rb-${state.roleBindings.length + 1}`, ...create })
        return {}
      },
    },

    memberIdentityLink: {
      upsert: async ({ where, create }: { where: { memberId_identityId: { memberId: string; identityId: string } }; create: Record<string, unknown> }) => {
        panggil.push('link.upsert')
        const key = where.memberId_identityId
        const ada = state.links.find((l) => l.memberId === key.memberId && l.identityId === key.identityId)
        if (!ada) state.links.push(create)
        return {}
      },
    },

    whatsAppIdentityCount: () => state.identities.length,
  }

  return { prisma, state, panggil }
}

describe('OrganizationProvisioner.createOrganization', () => {
  it('membuat organisasi dan seluruh templat peran', async () => {
    const { prisma, state } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)

    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1 Lombok' })

    expect(org.slug).toBe('osis-sma-1-lombok')
    expect(state.organizations).toHaveLength(1)
    // owner, admin, anggota (dll) — semua templat dibuat.
    expect(state.roles.length).toBeGreaterThanOrEqual(3)
  })

  it('IDEMPOTEN terhadap slug yang sama', async () => {
    const { prisma, state } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)

    await provisioner.createOrganization({ name: 'OSIS SMA 1' })
    await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    expect(state.organizations).toHaveLength(1)
  })

  it('MENOLAK templat peran yang tidak dikenal', async () => {
    const { prisma } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)

    // Salah ketik di sini berarti organisasi jadi tanpa admin sama sekali.
    await expect(provisioner.createOrganization({ name: 'X', roleKeys: ['pemimin'] })).rejects.toThrow(
      /tidak dikenal/,
    )
  })

  it('mengganti permission peran utuh, bukan menumpuknya', async () => {
    const { prisma, panggil } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)

    await provisioner.createOrganization({ name: 'X' })

    // deleteMany sebelum createMany: kalau tidak, izin lama yang sudah tidak
    // berlaku akan tetap aktif.
    expect(panggil.indexOf('rolePermission.deleteMany')).toBeLessThan(
      panggil.findIndex((p) => p.startsWith('rolePermission.createMany')),
    )
  })
})

describe('OrganizationProvisioner.linkAdmin', () => {
  it('menghubungkan nomor ke anggota + peran', async () => {
    const { prisma, state } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)
    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    const hasil = await provisioner.linkAdmin({
      organizationId: org.id,
      fullName: 'Budi Santoso',
      phone: '6285792820173',
    })

    expect(hasil.created).toBe(true)
    expect(hasil.roleKey).toBe('owner')
    expect(state.members).toHaveLength(1)
    expect(state.roleBindings).toHaveLength(1)
    expect(state.links).toHaveLength(1)
  })

  it('TIDAK menandai identitas sebagai terverifikasi', async () => {
    // Ini keputusan keamanan yang disengaja.
    //
    // Nomor dari environment adalah klaim. Backend tidak boleh menganggap
    // terverifikasi hanya karena nomor itu ada di file konfigurasi — kalau
    // tidak, siapa pun yang bisa menulis .env bisa masuk ke organisasi.
    const { prisma, state } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)
    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    await provisioner.linkAdmin({ organizationId: org.id, fullName: 'Budi', phone: '6285792820173' })

    expect(state.links[0]).not.toHaveProperty('verifiedAt')
    expect(state.links[0]!.verifiedAt ?? null).toBeNull()
    expect((state.identities[0]!.verifiedAt as Date | undefined) ?? null).toBeNull()
  })

  it('IDEMPOTEN: nomor sama tidak membuat anggota atau peran ganda', async () => {
    // Menjalankan `org:create` dua kali harus aman.
    const { prisma, state } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)
    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    await provisioner.linkAdmin({ organizationId: org.id, fullName: 'Budi Santoso', phone: '6285792820173' })
    const kedua = await provisioner.linkAdmin({ organizationId: org.id, fullName: 'Budi Santoso', phone: '6285792820173' })

    expect(kedua.created).toBe(false)
    expect(state.members).toHaveLength(1)
    expect(state.roleBindings).toHaveLength(1)
  })

  it('MENOLAK nomor yang tidak valid sebelum menyentuh database', async () => {
    const { prisma, panggil } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)
    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    await expect(
      provisioner.linkAdmin({ organizationId: org.id, fullName: 'X', phone: '123' }),
    ).rejects.toThrow(/tidak valid/)

    // Tidak ada user yang dibuat untuk nomor tidak valid.
    expect(panggil.filter((p) => p === 'user.create')).toHaveLength(0)
  })

  it('MENOLAK peran yang belum ada di organisasi itu', async () => {
    const { prisma } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)
    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    await expect(
      provisioner.linkAdmin({ organizationId: org.id, fullName: 'Budi', phone: '6285792820173', roleKey: 'ketua' }),
    ).rejects.toThrow(/belum ada/)
  })

  it('tidak membuat alias duplikat', async () => {
    const { prisma, state } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)
    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    const input = { organizationId: org.id, fullName: 'Budi Santoso', phone: '6285792820173', aliases: ['ketika'] }
    await provisioner.linkAdmin(input)
    await provisioner.linkAdmin(input)

    expect(state.aliases).toHaveLength(1)
  })

  it('membuang alias yang sama dengan nama utama', async () => {
    // Alias yang identik dengan nama tidak menambah kemampuan pencarian.
    const { prisma, state } = buatPrismaPalsu()
    const provisioner = new OrganizationProvisioner(prisma as never)
    const org = await provisioner.createOrganization({ name: 'OSIS SMA 1' })

    await provisioner.linkAdmin({
      organizationId: org.id,
      fullName: 'Budi Santoso',
      phone: '6285792820173',
      aliases: ['Budi Santoso', 'ketika'],
    })

    expect(state.aliases).toHaveLength(1)
    expect(String(state.aliases[0]!.alias)).toBe('ketika')
  })
})

describe('OrganizationProvisioner.ensurePermissions', () => {
  it('MENOLAK kalau tabel permission kosong', async () => {
    // Provisioning tanpa permission = organisasi yang tidak bisa dipakai
    // oleh siapa pun. Lebih baik gagal cepat dengan pesan jelas.
    const prisma = { permission: { count: async () => 0 } }
    const provisioner = new OrganizationProvisioner(prisma as never)

    await expect(provisioner.ensurePermissions()).rejects.toThrow(/db:seed/)
  })
})