/**
 * Skill Registry — kemampuan berbasis Markdown.
 *
 * Prinsip:
 *  1. Skill berisi PETUNJUK, bukan kode. Eksekusi tetap lewat Tool Registry.
 *  2. Skill TIDAK punya hak akses sendiri. `required_permissions` yang ditulis di
 *     SKILL.md hanya ALASAN dokumentasi; kebenarannya tetap dicek backend.
 *  3. Skill divalidasi saat load. Metadata rusak = skill dibuang, bukan dipakai
 *     setengah-setengah.
 *  4. Hanya skill yang RELEVAN dimuat ke prompt — bukan semuanya (hemat token,
 *     dan mencegah model "mengingat" kemampuan yang tidak boleh dipakai).
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'skills' })

export interface SkillMetadata {
  name: string
  description: string
  version: string
  requiredTools: string[]
  requiredPermissions: string[]
  /** Konteks tempat skill ini relevan: 'private' | 'group' | 'both'. */
  contexts: Array<'private' | 'group' | 'both'>
  /** Kata kunci aktivasi — hanya untuk pre-filtering, bukan penentu final. */
  triggers: string[]
}

export interface Skill {
  metadata: SkillMetadata
  /** Isi SKILL.md tanpa front-matter. */
  body: string
  /** Path relatif terhadap root skills. */
  path: string
}

/**
 * Parser front-matter YAML minimal.
 *
 * Sengaja TIDAK memakai pustaka YAML penuh: kita hanya butuh subset kecil
 * (key: value dan key: [list]). Parser penuh menambah permukaan serangan
 * (alias/merge) tanpa manfaat di sini.
 */
export function parseFrontMatter(source: string): { data: Record<string, string | string[]>; body: string } {
  const normalized = source.replace(/^﻿/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized)

  if (!match) return { data: {}, body: normalized.trim() }

  const rawData = match[1] ?? ''
  const body = (match[2] ?? '').trim()

  const data: Record<string, string | string[]> = {}
  let currentKey: string | null = null

  for (const line of rawData.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue

    // Baris lanjutan list ("  - foo")
    const listItem = /^\s+-\s+(.*)$/.exec(line)
    if (listItem && currentKey) {
      const existing = data[currentKey]
      const list = Array.isArray(existing) ? existing : existing ? [existing] : []
      list.push(unquote(listItem[1] ?? ''))
      data[currentKey] = list
      continue
    }

    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue

    const key = kv[1] as string
    const rawValue = (kv[2] ?? '').trim()

    if (rawValue === '') {
      currentKey = key
      data[key] = []
      continue
    }

    currentKey = key

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      data[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter((item) => item !== '')
    } else {
      data[key] = unquote(rawValue)
    }
  }

  return { data, body }
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) return value.filter((item) => item !== '')
  return value
    .split(/[,\n]/)
    .map((item) => unquote(item.trim()))
    .filter((item) => item !== '')
}

/** Ubah front-matter mentah menjadi SkillMetadata tervalidasi. */
export function buildMetadata(data: Record<string, string | string[]>): SkillMetadata {
  const name = (data.name as string | undefined)?.trim() ?? ''
  const description = (data.description as string | undefined)?.trim() ?? ''

  const problems: string[] = []
  if (!name) problems.push('field `name` wajib ada')
  if (!description) problems.push('field `description` wajib ada')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    problems.push('`name` hanya boleh huruf kecil, angka, dan tanda hubung')
  }

  if (problems.length > 0) {
    throw new Error(`Metadata skill tidak valid: ${problems.join('; ')}`)
  }

  const contexts = asList(data.contexts).filter(
    (value): value is 'private' | 'group' | 'both' =>
      value === 'private' || value === 'group' || value === 'both',
  )

  return {
    name,
    description,
    version: (data.version as string | undefined)?.trim() || '1.0.0',
    requiredTools: asList(data.required_tools),
    requiredPermissions: asList(data.required_permissions),
    contexts: contexts.length > 0 ? contexts : ['private', 'group'],
    triggers: asList(data.triggers).map((value) => value.toLowerCase()),
  }
}

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>()
  private readonly issues: string[] = []

  /** Muat semua SKILL.md di bawah `root` (rekursif). */
  async load(root: string): Promise<{ loaded: number; issues: string[] }> {
    this.skills.clear()
    this.issues.length = 0

    const files = await findSkillFiles(root)
    for (const file of files) {
      try {
        const source = await readFile(file, 'utf8')
        const { data, body } = parseFrontMatter(source)
        const metadata = buildMetadata(data)

        if (body.trim() === '') {
          throw new Error('isi SKILL.md kosong')
        }

        const key = metadata.name
        if (this.skills.has(key)) {
          throw new Error(`nama skill duplikat: ${key}`)
        }

        this.skills.set(key, {
          metadata,
          body,
          path: relative(root, file),
        })
      } catch (error) {
        const message = `${relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`
        this.issues.push(message)
        log.warn({ skill: file, err: error }, 'skill tidak valid, dilewati')
      }
    }

    log.info({ loaded: this.skills.size, issues: this.issues.length }, 'skill dimuat')
    return { loaded: this.skills.size, issues: [...this.issues] }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  list(): Skill[] {
    return [...this.skills.values()]
  }

  names(): string[] {
    return [...this.skills.keys()]
  }

  size(): number {
    return this.skills.size
  }

  /**
   * Pilih skill yang relevan untuk pesan ini.
   *
   * Pre-filter ini hanya mengurangi beban prompt. Keputusan akhir tetap milik
   * model + Tool Registry — skill tidak pernah memberi izin.
   */
  select(text: string, options: { isGroup: boolean; allowedPermissions: Set<string> }): Skill[] {
    const lower = text.toLowerCase()

    return this.list()
      .filter((skill) => {
        if (!skill.metadata.contexts.includes('both') && skill.metadata.contexts.length === 1) {
          const only = skill.metadata.contexts[0]
          if (only === 'group' && !options.isGroup) return false
          if (only === 'private' && options.isGroup) return false
        }

        // Skill yang butuh izin yang tidak dimiliki dilewati — hanya hemat
        // prompt; penolakan sebenarnya tetap di registry.
        if (skill.metadata.requiredPermissions.length > 0) {
          const punyaSemua = skill.metadata.requiredPermissions.every((permission) =>
            options.allowedPermissions.has(permission),
          )
          if (!punyaSemua) return false
        }

        return true
      })
      .map((skill) => {
        // Skor sederhana: berapa keyword trigger yang muncul.
        const hits = skill.metadata.triggers.filter((trigger) => trigger !== '' && lower.includes(trigger)).length
        return { skill, hits }
      })
      .sort((a, b) => b.hits - a.hits)
      .map((entry) => entry.skill)
  }

  /** Ringkasan skill untuk system prompt — hanya metadata, bukan seluruh isi. */
  summary(skills: Skill[]): string {
    if (skills.length === 0) return ''
    return skills
      .map((skill) => `- ${skill.metadata.name}: ${skill.metadata.description}`)
      .join('\n')
  }

  /** Isi skill lengkap untuk dikirim sebagai konteks tambahan. */
  render(skills: Skill[]): string {
    if (skills.length === 0) return ''
    return skills
      .map((skill) => `## Skill: ${skill.metadata.name}\n${skill.body}`)
      .join('\n\n---\n\n')
  }
}

/** Cari semua SKILL.md di bawah root secara rekursif. */
async function findSkillFiles(root: string): Promise<string[]> {
  const hasil: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        // Jangan pernah membaca credential yang mungkin ada di folder skill.
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        await walk(full)
      } else if (entry.name === 'SKILL.md') {
        hasil.push(full)
      }
    }
  }

  await walk(root)
  return hasil.sort()
}