import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * Gate izin skill.
 *
 * ── Asal bug ────────────────────────────────────────────────────────────────
 *
 * Gate lama memakai `every`: skill hanya lolos kalau aktor memegang **semua**
 * izin yang dideklarasikan. Tapi `ToolRegistry.schemasFor()` sudah memfilter
 * tool per-izin secara terpisah — jadi gate itu tidak menambah keamanan,
 * hanya membuang kemampuan.
 *
 * Bentuk gejalanya persis seperti yang dilaporkan pengguna:
 *
 *     "fitur menambah anggota belum tersedia"
 *
 * padahal `organization_create_member` ada di disk dan terdaftar di
 * `manage-members`. Skill-nya yang hilang, bukan tool-nya.
 *
 * Yang memperparah: `manage-reminder` mendeklarasikan `tasks.read` padahal
 * ketiga tool-nya butuh `automation.*`. Skill itu terlewat untuk siapa pun yang
 * punya izin pengingat tapi tidak punya izin tugas — dan "ingatkan besok jam 7"
 * dijawab "fitur belum tersedia".
 */
describe('gate izin skill tidak boleh membuang kemampuan', () => {
  async function muatSemua() {
    const registry = new SkillRegistry()
    const root = new URL('../../skills/', import.meta.url).pathname
    await registry.load(root)
    return registry
  }

  it('BUG REGRESSION: skill tetap terkirim kalau aktor punya SATU izin yang cukup', async () => {
    const registry = await muatSemua()

    // Harus skill yang deklarasikan LEBIH dari satu izin.
    //
    // Percobaan pertama memakai `manage-finance`, yang hanya mendeklarasikan
    // `finance.read` — jadi `every` juga lulus, dan test tidak membedakan
    // apa pun. Itu test yang berbohong.
    const skill = registry.list().find((s) => s.metadata.name === 'manage-task')
    expect(skill, 'skill manage-task tidak termuat').toBeTruthy()
    expect(
      skill!.metadata.requiredPermissions.length,
      'test ini butuh skill dengan lebih dari satu izin deklarasi',
    ).toBeGreaterThan(1)

    // Aktor punya SATU izin saja dari beberapa yang dideklarasikan.
    const hasil = registry.select('daftar tugas', {
      isGroup: false,
      allowedPermissions: new Set(['tasks.read']),
    })

    // Dengan `every`, skill ini hilang total — dan bersama seluruh tool-nya.
    // Padahal `task_list` sendiri butuh `tasks.read` dan TIDAK butuh izin lain.
    // Aktor yang bisa membaca tugas kehilangan kemampuan membaca tugas.
    expect(
      hasil.some((s) => s.metadata.name === 'manage-task'),
      'aktor dengan satu izin yang cukup kehilangan seluruh skill',
    ).toBe(true)
  })

  it('BUG REGRESSION: skill hilang kalau TIDAK ADA izinnya sama sekali', async () => {
    const registry = await muatSemua()

    // Aktor tanpa izin apa pun yang relevan: skill harus benar-benar hilang.
    // Kalau lolos, prompt membengkak tanpa gunanya dan model melihat tool yang
    // akan ditolak.
    const hasil = registry.select('daftar tagihan kas', {
      isGroup: false,
      allowedPermissions: new Set<string>(),
    })

    expect(hasil.length, 'skill tanpa izin sama sekali tetap terkirim').toBe(0)
  })

  it('BUG REGRESSION: manage-reminder memakai izin automation, bukan tasks', async () => {
    const registry = await muatSemua()

    const skill = registry.list().find((s) => s.metadata.name === 'manage-reminder')
    expect(skill, 'skill manage-reminder tidak termuat').toBeTruthy()

    // Izin pengingat harus cukup untuk melihat skill pengingat.
    expect(
      skill!.metadata.requiredPermissions,
      'manage-reminder masih memakai domain izin yang salah',
    ).toContain('automation.read')
    expect(skill!.metadata.requiredPermissions).not.toContain('tasks.read')
  })

  it('BUG REGRESSION: nama tool di dalam isi SKILL.md harus benar-benar ada', async () => {
    // Model diperintah memanggil nama-nama ini. Kalau namanya salah, model
    // memanggil tool yang tidak terdaftar dan capability-nya hilang.
    //
    // `tool-reachability.test.ts` hanya memeriksa front-matter — isi prosa
    // tidak pernah diawasi, dan di sanalah nama hantu bersembunyi
    // (`organization.search_members` alih-alih `organization_search_members`).
    const daftarTool = new Set<string>()
    const folder = new URL('../../src/tools/', import.meta.url).pathname
    for (const berkas of readdirSync(folder)) {
      if (!berkas.endsWith('.ts')) continue
      const isi = readFileSync(join(folder, berkas), 'utf-8')
      for (const cocok of isi.matchAll(/name: '([a-z_]+)'/g)) daftarTool.add(cocok[1]!)
    }

    const hantu: string[] = []
    const root = new URL('../../skills/', import.meta.url).pathname
    for (const kategori of readdirSync(root)) {
      for (const nama of readdirSync(join(root, kategori))) {
        const isi = readFileSync(join(root, kategori, nama, 'SKILL.md'), 'utf-8')
        for (const cocok of isi.matchAll(/`([a-z]+)\.([a-z_]+)`/g)) {
          const kandidat = `${cocok[1]}_${cocok[2]}`
          if (daftarTool.has(kandidat)) continue
          // Lewati yang memang nama izin (`finance.read`), bukan nama tool.
          if (cocok[2] === 'read' || cocok[2] === 'write' || cocok[2] === 'create' || cocok[2] === 'delete') continue
          if (cocok[2] === 'update' || cocok[2] === 'send' || cocok[2] === 'list' || cocok[2] === 'assign') continue
          hantu.push(`${nama}: ${cocok[0]}`)
        }
      }
    }

    expect(hantu, `nama tool tidak dikenal di isi SKILL.md:\n${hantu.join('\n')}`).toEqual([])
  })
})
