import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, PERMISSION_GROUPS, validatePermissionCatalog } from '../../src/security/permissions.js'
import { expandPermissions, findRoleTemplate, ROLE_TEMPLATES, SYSTEM_ROLES } from '../../src/security/role-templates.js'

describe('katalog permission', () => {
  it('setiap permission punya deskripsi', () => {
    expect(() => validatePermissionCatalog()).not.toThrow()
  })

  it('tidak ada permission duplikat', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
  })

  it('semua permission masuk ke dalam kelompok yang ada', () => {
    const Berlis = new Set(Object.values(PERMISSION_GROUPS).flat())
    const orphan = ALL_PERMISSIONS.filter((permission) => !Berlis.has(permission))
    expect(orphan).toEqual([])
  })

  it('deskripsi tersedia untuk tiap permission', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(PERMISSION_DESCRIPTIONS[permission], `deskripsi ${permission}`).toBeTruthy()
    }
  })
})

describe('role template', () => {
  it('semua role punya kunci, nama, dan deskripsi', () => {
    for (const role of ROLE_TEMPLATES) {
      expect(role.key, `key ${role.key}`).toBeTruthy()
      expect(role.name, `nama ${role.key}`).toBeTruthy()
      expect(role.description, `deskripsi ${role.key}`).toBeTruthy()
    }
  })

  it('kunci role unik', () => {
    expect(new Set(ROLE_TEMPLATES.map((r) => r.key)).size).toBe(ROLE_TEMPLATES.length)
  })

  it('semua permission yang dirujuk ada di katalog', () => {
    const valid = new Set<string>(ALL_PERMISSIONS)
    for (const role of ROLE_TEMPLATES) {
      for (const permission of role.permissions) {
        expect(valid.has(permission) || permission === '*', `${role.key} → ${permission}`).toBe(true)
      }
    }
  })

  it('findRoleTemplate menemukan role yang benar', () => {
    expect(findRoleTemplate(SYSTEM_ROLES.OWNER)?.name).toBe('Pemilik Organisasi')
    expect(findRoleTemplate('tidak-ada')).toBeUndefined()
  })
})

describe('expandPermissions', () => {
  it('meng-ekspansi wildcard OWNER ke daftar lengkap', () => {
    const hasil = expandPermissions(['*'], ALL_PERMISSIONS)
    expect(hasil).toHaveLength(ALL_PERMISSIONS.length)
    expect(hasil).not.toContain('*')
  })

  it('mempertahankan permission eksplisit apa adanya', () => {
    const hasil = expandPermissions(['attendance.read', 'members.read'], ALL_PERMISSIONS)
    expect(hasil.sort()).toEqual(['attendance.read', 'members.read'])
  })

  it('menghapus duplikat', () => {
    const hasil = expandPermissions(['attendance.read', 'attendance.read'], ALL_PERMISSIONS)
    expect(hasil).toEqual(['attendance.read'])
  })
})

describe('prinsip keamanan role', () => {
  it('role biasa TIDAK punya wildcard', () => {
    for (const role of ROLE_TEMPLATES) {
      if (role.key === SYSTEM_ROLES.OWNER) continue
      expect(role.permissions, `role ${role.key} tidak boleh punya *`).not.toContain('*')
    }
  })

  it('role anggota tidak boleh punya izin financially sensitive', () => {
    const member = findRoleTemplate(SYSTEM_ROLES.MEMBER)
    expect(member?.permissions).not.toContain('finance.read')
    expect(member?.permissions).not.toContain('members.delete')
    expect(member?.permissions).not.toContain('whatsapp.bulk_send')
  })

  it('hanya owner yang punya akses konfigurasi sistem', () => {
    const owner = findRoleTemplate(SYSTEM_ROLES.OWNER)
    const admin = findRoleTemplate(SYSTEM_ROLES.ADMIN)
    expect(owner?.permissions).toContain('*')
    expect(admin?.permissions).not.toContain('system.configure')
    expect(admin?.permissions).not.toContain('system.safe_mode')
  })

  it('role non-admin tidak bisa menghapus anggota', () => {
    for (const key of [SYSTEM_ROLES.SECRETARY, SYSTEM_ROLES.TREASURER, SYSTEM_ROLES.ATTENDANCE_MANAGER, SYSTEM_ROLES.COMMITTEE]) {
      const role = findRoleTemplate(key)
      expect(role?.permissions, `${key} tidak boleh bisa menghapus anggota`).not.toContain('members.delete')
    }
  })
})