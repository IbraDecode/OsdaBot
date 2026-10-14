/**
 * Test onboarding anggota.
 *
 * Fokusnya: import massal tidak boleh membuat data rusak diam-diam.
 * Anggota salah lebih baik terlihat daripada muncul sebagai anggota fiktif
 * yang tidak pernah ikut latihan.
 */
import { describe, expect, it } from 'vitest'
import { MemberProvisioner, resolveRoleKey } from '../../src/organization/member-onboarding.js'

describe('resolveRoleKey', () => {
  it('menerjemahkan peran Indonesia ke kunci kanonik', () => {
    // Kunci kanonik disimpan sebagai bahasa Inggris; operator mengetik
    // bahasa Indonesia.
    expect(resolveRoleKey('anggota')).toBe('member')
    expect(resolveRoleKey('Anggota')).toBe('member')
    expect(resolveRoleKey('ANGGOTA')).toBe('member')
    expect(resolveRoleKey('ketua')).toBe('committee')
    expect(resolveRoleKey('ketua panitia')).toBe('committee')
    expect(resolveRoleKey('sekretaris')).toBe('secretary')
    expect(resolveRoleKey('bendahara')).toBe('treasurer')
    expect(resolveRoleKey('absen')).toBe('attendance_manager')
  })

  it('mengembalikan input apa adanya kalau tidak dikenal', () => {
    // Supaya pesan galat bisa menyebut apa yang benar-benar diketik.
    expect(resolveRoleKey('ketum')).toBe('ketum')
    expect(resolveRoleKey('owner')).toBe('owner')
  })

  it('menerima kunci kanonik apa adanya', () => {
    for (const key of ['owner', 'admin', 'member', 'secretary', 'treasurer', 'committee']) {
      expect(resolveRoleKey(key), key).toBe(key)
    }
  })
})

describe('MemberProvisioner.parseText', () => {
  const parser = (text: string) => MemberProvisioner.parseText(text)

  it('membaca format lengkap', () => {
    const { members, errors } = parser('Budi Santoso | 6281234567890 | ketua | X AKL 3 | budi,budi_s')

    expect(errors).toEqual([])
    expect(members).toHaveLength(1)
    expect(members[0]).toEqual({
      fullName: 'Budi Santoso',
      phone: '6281234567890',
      roleKey: 'ketua',
      className: 'X AKL 3',
      aliases: ['budi', 'budi_s'],
    })
  })

  it('mengabaikan baris kosong dan komentar', () => {
    const { members } = parser(`
# daftar anggota
   # komentar lain

Budi | 6281234567890

Siti | 628987654321
`)
    expect(members.map((m) => m.fullName)).toEqual(['Budi', 'Siti'])
  })

  it('membolehkan anggota tanpa nomor', () => {
    // Anggota tanpa nomor masih berguna untuk daftar hadir; nomornya bisa
    // dilengkapi nanti.
    const { members, errors } = parser('Siti Aminah | | anggota | XI IPA 2')

    expect(errors).toEqual([])
    expect(members[0]!.phone).toBe('')
    expect(members[0]!.className).toBe('XI IPA 2')
  })

  it('MENOLAK nomor yang tidak masuk akal', () => {
    const { members, errors } = parser('Budi | bukan-nomor | anggota')

    expect(members).toHaveLength(0)
    expect(errors[0]).toContain('tidak valid')
  })

  it('melaporkan nomor bertanda dengan spasi dan kurung sebagai valid', () => {
    const { members, errors } = parser('Budi | +62 812-3456-7890 | anggota')

    expect(errors).toEqual([])
    expect(members[0]!.phone).toContain('812')
  })

  it('memperlakukan baris tanpa nama sebagai galat', () => {
    const { members, errors } = parser(' | 6281234567890')
    expect(members).toHaveLength(0)
    expect(errors[0]).toContain('nama kosong')
  })

  it('membuang alias kosong', () => {
    const { members } = parser('Budi | 6281234567890 | anggota | X | budi, , ')
    expect(members[0]!.aliases).toEqual(['budi'])
  })

  it('mengabaikan kolom yang tidak ada di akhir baris', () => {
    const { members, errors } = parser('Budi | 6281234567890')
    expect(errors).toEqual([])
    expect(members[0]!.fullName).toBe('Budi')
    expect(members[0]!.roleKey).toBeUndefined()
  })
})

// ── Test double ─────────────────────────────────────────────────────────────

function buatPrismaPalsu() {
  const state = {
    roles: [] as Array<Record<string, unknown>>,
    identities: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    roleBindings: [] as Array<Record<string, unknown>>,
    links: [] as Array<Record<string, unknown>>,
    aliases: [] as Array<Record<string, unknown>>,
  }

  const prisma = {
    organizationRole: {
      findUnique: async ({ where }: { where: { organizationId_key: { organizationId: string; key: string } } }) => {
        const role = state.roles.find((r) => r.key === where.organizationId_key.key)
        return role ? { id: role.id as string } : null
      },
      findMany: async () => state.roles.map((r) => ({ key: r.key as string })),
    },
    whatsAppIdentity: {
      findUnique: async ({ where }: { where: { pnJid: string } }) => {
        const identity = state.identities.find((i) => i.pnJid === where.pnJid)
        return identity ? { id: identity.id as string, userId: identity.userId ?? null } : null
      },
    },
    user: {
      create: async ({ data }: { data: Record<string, unknown> & { identities: { create: Record<string, unknown> } } }) => {
        const id = `user-${state.users.length + 1}`
        state.users.push({ id })
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
        const baru = { id: `member-${state.members.length + 1}`, ...data }
        state.members.push(baru)
        return { id: baru.id as string }
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const member = state.members.find((m) => m.id === where.id)!
        Object.assign(member, data)
        return { id: where.id }
      },
    },
    memberRoleBinding: {
      findMany: async ({ where }: { where: { memberId: string } }) =>
        state.roleBindings.filter((b) => b.memberId === where.memberId).map((b) => ({ roleId: b.roleId as string })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.roleBindings.push({ id: `rb-${state.roleBindings.length + 1}`, ...data })
        return {}
      },
    },
    memberAlias: {
      findFirst: async ({ where }: { where: { memberId: string; alias: string } }) =>
        state.aliases.some((a) => a.memberId === where.memberId && a.alias === where.alias)
          ? { id: 'ada' }
          : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.aliases.push({ id: `alias-${state.aliases.length + 1}`, ...data })
        return {}
      },
    },
    memberIdentityLink: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const ada = state.links.find(
          (l) => l.memberId === create.memberId && l.identityId === create.identityId,
        )
        if (!ada) state.links.push(create)
        return {}
      },
    },
  }

  return { prisma, state }
}

function provisionerDenganPeran(nilai: Record<string, boolean> = {}) {
  const dibuat = buatPrismaPalsu()
  // Kunci kanonik, sama seperti yang ditulis ROLE_TEMPLATES ke database.
  for (const key of ['owner', 'admin', 'member', 'secretary', 'treasurer', 'committee', 'attendance_manager']) {
    if (nilai[key] !== false) {
      dibuat.state.roles.push({ id: `role-${key}`, key })
    }
  }
  return { ...dibuat, provisioner: new MemberProvisioner(dibuat.prisma as never) }
}

const ORG = '11111111-1111-1111-1111-111111111111'

describe('MemberProvisioner.addMembers', () => {
  it('menambah anggota beserta peran dan tautan identitas', async () => {
    const { provisioner, state } = provisionerDenganPeran()

    const results = await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: 'Budi Santoso', phone: '6281234567890' }],
    })

    expect(results[0]!.status).toBe('created')
    expect(state.members).toHaveLength(1)
    expect(state.roleBindings).toHaveLength(1)
    expect(state.links).toHaveLength(1)
  })

  it('TIDAK pernah mengisi verifiedAt', async () => {
    const { provisioner, state } = provisionerDenganPeran()

    await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: 'Budi Santoso', phone: '6281234567890' }],
    })

    expect(state.links[0]!.verifiedAt ?? null).toBeNull()
    expect(state.identities[0]!.verifiedAt ?? null).toBeNull()
  })

  it('menggabungkan anggota dengan nama yang sudah ada', async () => {
    // Dua anggota dengan nama sama bikin resolusi nama membingungkan.
    const { provisioner, state } = provisionerDenganPeran()
    const input = [{ fullName: 'Budi Santoso', phone: '6281234567890' }]

    await provisioner.addMembers({ organizationId: ORG, members: input })
    await provisioner.addMembers({ organizationId: ORG, members: input })

    expect(state.members).toHaveLength(1)
  })

  it('menyimpan peran yang sudah ada saat impor ulang', async () => {
    // Kalau anggota sudah punya peran 'ketua' lalu diimpor ulang sebagai
    // 'anggota', peran 'ketua' tidak boleh hilang.
    const { provisioner, state } = provisionerDenganPeran()
    const hasilImpor = await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: 'Budi Santoso', phone: '6281234567890' }],
    })
    const memberId = hasilImpor[0]!.memberId!

    // Tambah perancommittee di luar jalur impor.
    const roleKetua = state.roles.find((r) => r.key === 'committee')!
    state.roleBindings.push({ id: 'rb-manual', memberId, roleId: roleKetua.id })

    await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: 'Budi Santoso', phone: '6281234567890', roleKey: 'anggota' }],
    })

    const perannya = state.roleBindings.filter((b) => b.memberId === memberId)
    expect(perannya.some((b) => b.roleId === roleKetua.id)).toBe(true)
  })

  it('membuat alias tanpa duplikat', async () => {
    const { provisioner, state } = provisionerDenganPeran()
    const input = [{ fullName: 'Budi Santoso', phone: '6281234567890', aliases: ['budi'] }]

    await provisioner.addMembers({ organizationId: ORG, members: input })
    await provisioner.addMembers({ organizationId: ORG, members: input })

    expect(state.aliases).toHaveLength(1)
  })

  it('melewatkan baris salah tanpa menghentikan yang lain', async () => {
    // Import dari file teks biasanya punya beberapa baris salah. Berhenti di
    // baris pertama memaksa operator mengulang dari awal.
    const { provisioner, state } = provisionerDenganPeran()

    const results = await provisioner.addMembers({
      organizationId: ORG,
      members: [
        { fullName: 'Budi', phone: '6281234567890' },
        { fullName: 'Siti', phone: 'bukan-nomor' },
        { fullName: 'Andi', phone: '6283333333333' },
      ],
    })

    expect(results.filter((r) => r.status === 'created')).toHaveLength(2)
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(1)
    expect(results[1]!.reason).toBeTruthy()
    expect(state.members).toHaveLength(2)
  })

  it('MENOLAK peran yang tidak dikenal sebelum menyentuh data', async () => {
    const { provisioner } = provisionerDenganPeran({ committee: false })

    await expect(
      provisioner.addMembers({
        organizationId: ORG,
        members: [{ fullName: 'Budi', phone: '6281234567890', roleKey: 'ketua' }],
      }),
    ).rejects.toThrow(/belum ada/)
  })

  it('MEMBATAS jumlah anggota per batch', async () => {
    // Import tanpa batas berbahaya: satu berkas salah bisa menyimpan ribuan
    // anggota palsu.
    const { provisioner } = provisionerDenganPeran()

    const banyak = Array.from({ length: 501 }, (_, i) => ({
      fullName: `Anggota ${i}`,
      phone: `628${String(i).padStart(9, '0')}`,
    }))

    await expect(provisioner.addMembers({ organizationId: ORG, members: banyak })).rejects.toThrow(
      /Melebihi batas/,
    )
  })

  it('MEMBERI alasan jelas saat nama kosong', async () => {
    const { provisioner } = provisionerDenganPeran()

    const results = await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: '___', phone: '6281234567890' }],
    })

    expect(results[0]!.status).toBe('skipped')
    expect(results[0]!.reason).toContain('Nama kosong')
  })

  it('MENOLAK nama yang isinya hanya simbol', async () => {
    // canonicalizeName('!!!') mengembalikan '!!!', bukan string kosong.
    // Kalau dibiarkan, searchName sampah masuk dan resolusi nama saat chat
    // jadi kacau — tidak ada anggota yang bisa dipanggil.
    const { provisioner, state } = provisionerDenganPeran()

    const results = await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: '!!!', phone: '6281234567890' }],
    })

    expect(results[0]!.status).toBe('skipped')
    expect(results[0]!.reason).toContain('huruf atau angka')
    expect(state.members).toHaveLength(0)
  })

  it('MEMBERI alasan jelas saat nomor disebut tapi salah', async () => {
    const { provisioner } = provisionerDenganPeran()

    const results = await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: 'Budi', phone: '123' }],
    })

    expect(results[0]!.status).toBe('skipped')
    expect(results[0]!.reason).toContain('tidak valid')
  })

  it('MEMASUKKAN anggota tanpa nomor', async () => {
    // Daftar hadir bekerja berdasarkan NAMA, bukan nomor. Anggota yang
    // WhatsApp-nya belum diketahui tetap berguna; nomornya bisa dilengkapi
    // belakangan.
    const { provisioner, state } = provisionerDenganPeran()

    const results = await provisioner.addMembers({
      organizationId: ORG,
      members: [{ fullName: 'Andi Pratama', phone: '', className: 'XII IPA 1' }],
    })

    expect(results[0]!.status).toBe('created')
    expect(state.members).toHaveLength(1)
    // Tidak ada user/identitas yang dibuat.
    expect(state.users).toHaveLength(0)
    // Tidak ada tautan identitas.
    expect(state.links).toHaveLength(0)
    // Tapi tetap punya peran.
    expect(state.roleBindings).toHaveLength(1)
  })

  it('melengkapi nomor anggota tanpa nomor saat diimpor ulang', async () => {
    const { provisioner, state } = provisionerDenganPeran()

    await provisioner.addMembers({ organizationId: ORG, members: [{ fullName: 'Andi', phone: '' }] })
    await provisioner.addMembers({ organizationId: ORG, members: [{ fullName: 'Andi', phone: '6281234567890' }] })

    expect(state.members).toHaveLength(1)
    expect(state.identities).toHaveLength(1)
    expect(state.links).toHaveLength(1)
  })
})

describe('MemberProvisioner.listRoles', () => {
  it('mengembalikan daftar peran', async () => {
    const { provisioner } = provisionerDenganPeran()
    const roles = await provisioner.listRoles(ORG)
    expect(roles).toContain('owner')
    expect(roles).toContain('member')
  })
})