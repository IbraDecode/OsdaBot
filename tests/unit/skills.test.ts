import { describe, expect, it } from 'vitest'
import { parseFrontMatter, buildMetadata, SkillRegistry } from '../../src/skills/registry.js'

const SKILL_VALID = `---
name: manage-attendance
description: Mengelola daftar hadir organisasi.
version: 1.2.0
required_tools:
  - attendance_get
  - attendance_update
required_permissions:
  - attendance.read
contexts: [private, group]
triggers:
  - daftar hadir
  - absen
---

# Kelola Kehadiran

## Tujuan
Bantu kelola daftar hadir.

## Aturan
Jangan menebak nama orang.
`

describe('parseFrontMatter', () => {
  it('memisahkan front-matter dari isi', () => {
    const { data, body } = parseFrontMatter(SKILL_VALID)
    expect(data.name).toBe('manage-attendance')
    expect(body).toContain('# Kelola Kehadiran')
    expect(body).not.toContain('---')
  })

  it('membaca daftar YAML multi-baris', () => {
    const { data } = parseFrontMatter(SKILL_VALID)
    // Nama TOOL memakai underscore (dipakai di API gateway yang hanya
    // menerima [a-zA-Z0-9_-]), sedangkan PERMISSION memakai titik — itu
    // identitas internal dan tidak pernah dikirim ke model.
    expect(data.required_tools).toEqual(['attendance_get', 'attendance_update'])
    expect(data.required_permissions).toEqual(['attendance.read'])
  })

  it('membaca daftar sebaris dalam tanda kurung siku', () => {
    const { data } = parseFrontMatter(SKILL_VALID)
    expect(data.contexts).toEqual(['private', 'group'])
  })

  it('menangani file tanpa front-matter', () => {
    const { data, body } = parseFrontMatter('# Hanya badan')
    expect(data).toEqual({})
    expect(body).toBe('# Hanya badan')
  })
})

describe('buildMetadata', () => {
  it('membaca metadata lengkap', () => {
    const { data } = parseFrontMatter(SKILL_VALID)
    const metadata = buildMetadata(data)

    expect(metadata.name).toBe('manage-attendance')
    expect(metadata.version).toBe('1.2.0')
    expect(metadata.requiredTools).toHaveLength(2)
    expect(metadata.contexts).toEqual(['private', 'group'])
    expect(metadata.triggers).toEqual(['daftar hadir', 'absen'])
  })

  it('menolak skill tanpa name', () => {
    expect(() => buildMetadata({ description: 'x' })).toThrow(/name/)
  })

  it('menolak skill tanpa description', () => {
    expect(() => buildMetadata({ name: 'x' })).toThrow(/description/)
  })

  it('menolak nama skill dengan karakter terlarang', () => {
    expect(() => buildMetadata({ name: 'Skill_with_underscore', description: 'x' })).toThrow()
    expect(() => buildMetadata({ name: 'Skill Dengan Spasi', description: 'x' })).toThrow()
  })

  it('memberi default versi dan konteks bila tidak diisi', () => {
    const metadata = buildMetadata({ name: 'skill-minimal', description: 'x' })
    expect(metadata.version).toBe('1.0.0')
    expect(metadata.contexts).toEqual(['private', 'group'])
  })
})

describe('SkillRegistry', () => {
  it('memuat skill nyata dari folder repository', async () => {
    const registry = new SkillRegistry()
    const root = new URL('../../skills/', import.meta.url).pathname
    const hasil = await registry.load(root)

    expect(hasil.issues, `skill bermasalah: ${hasil.issues.join(', ')}`).toEqual([])
    expect(hasil.loaded).toBeGreaterThanOrEqual(3)
    expect(registry.names()).toContain('manage-attendance')
  })

  it('setiap skill punya required_tools dan required_permissions', async () => {
    const registry = new SkillRegistry()
    const root = new URL('../../skills/', import.meta.url).pathname
    await registry.load(root)

    for (const skill of registry.list()) {
      expect(skill.metadata.requiredTools.length, `${skill.metadata.name} tanpa tool`).toBeGreaterThan(0)
      expect(skill.metadata.requiredPermissions.length, `${skill.metadata.name} tanpa izin`).toBeGreaterThan(0)
    }
  })

  it('skill yang menyebut izin terlalu spesifik tidak diurutkan untuk aktor tanpa izin itu', async () => {
    const registry = new SkillRegistry()
    const root = new URL('../../skills/', import.meta.url).pathname
    await registry.load(root)

    const hasil = registry.select('daftar hadir lkbb', {
      isGroup: false,
      allowedPermissions: new Set(['organization_read']),
    })

    // attendance.read tidak dimiliki → manage-attendance harus disaring.
    expect(hasil.map((s) => s.metadata.name)).not.toContain('manage-attendance')
  })

  it('mengurutkan skill berdasarkan kecocokan trigger', async () => {
    const registry = new SkillRegistry()
    const root = new URL('../../skills/', import.meta.url).pathname
    await registry.load(root)

    const semuaIzin = new Set([
      'attendance_read',
      'attendance_update',
      'attendance_create',
      'members.read',
      'members.create',
      'whatsapp_send',
    ])

    const hasil = registry.select('osda cek daftar hadir lkbb', { isGroup: false, allowedPermissions: semuaIzin })
    expect(hasil.length).toBeGreaterThan(0)
    if (hasil.length > 1) {
      // manage-attendance punya trigger "daftar hadir" + "hadir" → harus di atas.
      expect(hasil[0]?.metadata.name).toBe('manage-attendance')
    }
  })

  it('melempar issues untuk skill rusak, bukan crash total', async () => {
    const registry = new SkillRegistry()
    // Folder yang tidak ada tidak boleh membuat crash.
    const hasil = await registry.load('/tmp/osdabot-tidak-ada-99999')
    expect(hasil.loaded).toBe(0)
    expect(hasil.issues).toEqual([])
  })

  it('render() mengembalikan isi skill lengkap untuk konteks prompt', async () => {
    const registry = new SkillRegistry()
    const root = new URL('../../skills/', import.meta.url).pathname
    await registry.load(root)

    const skills = registry.select('daftar hadir', {
      isGroup: false,
      // Permission memakai TITIK — identitas internal, tidak pernah dikirim
      // ke model. Nama TOOL yang underscore. Doisnya sengaja dibedakan.
      allowedPermissions: new Set(['attendance.read', 'attendance.update']),
    })

    const rendered = registry.render(skills)
    expect(rendered).toContain('## Skill: manage-attendance')
    expect(rendered).toContain('Jangan pernah mengarang anggota')
  })
})