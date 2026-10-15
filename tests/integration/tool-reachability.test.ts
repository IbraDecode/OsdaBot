/**
 * Invarian: setiap tool harus bisa dicapai dari skill.
 *
 * ── Kenapa ini perlu ───────────────────────────────────────────────────────
 *
 * Tool yang tidak ada di `required_tools` skill manapun **tidak pernah dikirim
 * ke model**. Model tidak bisa memakai tool yang tidak dia lihat — jadi tool itu
 * mati, sehebat apa pun implementasinya.
 *
 * Bug ini sudah terjadi dua kali dan gejalanya sama persis:
 *
 * 1. Semua nama tool pakai titik → gateway menolak seluruhnya dengan 400.
 *    Pesan user: *"gabisa ya"*.
 *
 * 2. Tool dokumen dibuat lengkap dengan testnya, tapi tidak ada SKILL.md →
 *    agent menulis surat izin sebagai teks chat, bukan PDF. Pesan user:
 *    *"dia menjawab dengan benar tapi bukan yang saya mau"*.
 *
 * Test double **tidak bisa** menangkap ini: registry happily menerima tool yang
 * tak terjangkau. Yang bisa menangkapnya adalah pemeriksaan keterjangkauan
 * seperti di file ini.
 */
import { describe, expect, it } from 'vitest'
import { bootstrap } from '../../src/bootstrap.js'
import { prisma } from '../../src/database/client.js'

/**
 * Tool yang sengaja TIDAK punya skill, beserta alasannya.
 *
 * Daftar ini bukan tempat menyembunyikan tool yang lupa dipikirkan — setiap
 * entri harus punya alasan yang bisa dipertanggungjawabkan. Kalau ada tool baru
 * yang tidak dipakai, test ini GAGAL dan memaksa entri di sini diisi.
 */
const TANPA_SKILL = new Map<string, string>([
  [
    'whatsapp_get_group_metadata',
    'Dipakai otomatis oleh pipeline untuk konteks grup; pengguna tidak pernah meminta "metadata grup".',
  ],
  [
    'whatsapp_get_group_members',
    'Dipakai otomatis untuk memverifikasi pengirim grup. Meminta daftar anggota grup lewat chat berisiko membocorkan data tanpa perlu.',
  ],
  [
    'whatsapp_react_message',
    'Reaksi WhatsApp (emoji) belum jadi kemampuan yang dijanjikan ke pengguna. Menambahkannya tanpa kasus nyata hanya menambah permukaan serang.',
  ],
])

describe('keterjangkauan tool lewat skill', () => {
  it('tool yang tidak punya skill tercatat dengan alasannya', async () => {
    const app = await bootstrap({ startWorkers: false })

    try {
      const tercakup = new Set<string>()
      for (const skill of app.skills.list()) {
        for (const tool of skill.metadata.requiredTools) tercakup.add(tool)
      }

      // Dihitung terpisah dari assertion supaya kegagalan test bisa
      // menyebutkan tool yang tepat, bukan hanya "expect failed".
      const takTercakup: string[] = []
      for (const name of app.tools.names()) {
        if (!tercakup.has(name)) takTercakup.push(name)
      }

      const tanpaAlasan = takTercakup.filter((name) => !TANPA_SKILL.has(name))
      expect(
        tanpaAlasan,
        `Tool ini tidak dipakai skill mana pun, jadi tidak akan pernah dikirim ke model: ${tanpaAlasan.join(', ')}. ` +
          'Tambahkan ke SKILL.md, atau isi alasannya di TANPA_SKILL.',
      ).toEqual([])

      // Entri yang sudah tidak relevan harus dibersihkan, kalau tidak
      // allowlist-nya tumbuh tanpa batas dan kehilangan artinya.
      const usang = [...TANPA_SKILL.keys()].filter(
        (name) => app.tools.names().includes(name) === false,
      )
      expect(usang, `TANPA_SKILL menyebut tool yang sudah tidak ada: ${usang.join(', ')}`).toEqual([])

      const sudahTercakup = [...TANPA_SKILL.keys()].filter((name) => tercakup.has(name))
      expect(
        sudahTercakup,
        `Tool ini sudah punya skill, hapus dari TANPA_SKILL: ${sudahTercakup.join(', ')}`,
      ).toEqual([])
    } finally {
      await app.shutdown()
    }
  }, 120_000)
})

describe('konsistensi skill', () => {
  it('setiap tool yang disebut skill benar-benar ada', async () => {
    // Sebaliknya: skill yang menyebut tool yang tidak ada gagal diam-diam
    // saat runtime — filternya mengosongkan daftar tool tanpa penjelasan.
    const app = await bootstrap({ startWorkers: false })

    try {
      const ada = new Set(app.tools.names())
      const hantu: string[] = []

      for (const skill of app.skills.list()) {
        for (const tool of skill.metadata.requiredTools) {
          if (!ada.has(tool)) hantu.push(`${skill.metadata.name} → ${tool}`)
        }
      }

      expect(hantu, `Skill menyebut tool yang tidak terdaftar: ${hantu.join(', ')}`).toEqual([])
    } finally {
      await app.shutdown()
    }
  }, 120_000)

  it('permission yang diminta skill memang ada di katalog', async () => {
    const app = await bootstrap({ startWorkers: false })

    try {
      const { ALL_PERMISSIONS } = await import('../../src/security/permissions.js')
      const ada = new Set<string>(ALL_PERMISSIONS)
      const hantu: string[] = []

      for (const skill of app.skills.list()) {
        for (const permission of skill.metadata.requiredPermissions) {
          if (!ada.has(permission)) hantu.push(`${skill.metadata.name} → ${permission}`)
        }
      }

      expect(hantu, `Skill meminta permission yang tidak ada: ${hantu.join(', ')}`).toEqual([])
    } finally {
      await app.shutdown()
    }
  }, 120_000)
})