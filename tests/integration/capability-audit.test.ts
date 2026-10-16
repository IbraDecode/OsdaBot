/**
 * Audit kemampuan: yang diklaim harus benar-benar ada.
 *
 * ── Kenapa file ini ada ───────────────────────────────────────────────────
 *
 * Pola yang berulang sepanjang pengerjaan proyek ini:
 *
 * ```
 * dokumentasi bilang "aktif"  →  kodenya ada  →  tapi tidak ada SKILL.md
 *   →  tool tidak pernah dikirim ke model  →  tidak pernah terpakai
 * ```
 *
 * Gejalanya selalu sama: pengguna melapor "gabisa ya". Test yang ada (unit dan
 * integrasi) semuanya **lulus**, karena setiap lapisan memang benar — lapisan
 * yang salah tidak pernah dipanggil.
 *
 * Test double tidak bisa menangkap ini. Yang bisa adalah pemeriksaan
 * keterjangkauan: apa yang diklaim, apa yang ada, dan apa yang bisa dijangkau.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { bootstrap } from '../../src/bootstrap.js'
import { ALL_PERMISSIONS, PERMISSIONS } from '../../src/security/permissions.js'
import { ROLE_TEMPLATES } from '../../src/security/role-templates.js'

/**
 * Izin yang sengaja TIDAK punya tool, beserta alasannya.
 *
 * Ini bukan tempat menyembunyikan izin yang lupa dipikirkan. Izin di katalog
 * tanpa tool berarti kemampuannya tidak bisa dipakai — dan itu harus terlihat,
 * bukan tersembunyi di daftar panjang.
 */
const IZIN_TANPA_TOOL = new Map<string, string>([
  ['ORGANIZATION_UPDATE', 'Profil organisasi belum bisa diubah dari chat; lewat CLI.'],
  ['MEMBERS_UPDATE', 'Belum ada tool untuk mengubah data anggota — hanya membuat.'],
  ['MEMBERS_DELETE', 'Sengaja dihilangkan: menghapus anggota berarti membatalkan seluruh riwayatnya.'],
  ['MEMBERS_EXPORT', 'Ekspor data anggota ke berkas eksternal belum ada.'],
  ['ROLES_MANAGE', 'Peran kustom belum ada. Peran sistem cukup untuk pemakaian saat ini.'],
  ['ORGANIZATION_READ', 'Detail organisasi sudah tampil sebagai konteks di balasan.'],
  [
    'ATTENDANCE_DELETE',
    'Sengaja: menghapus daftar berarti menghapus catatan kehadiran orang. Koreksi per entri, jangan dihapus.',
  ],
  ['ATTENDANCE_EXPORT', 'Daftar hadir sudah bisa diekspor sebagai PDF lewat dokumen.'],
  ['EVENTS_CREATE', 'Kegiatan dibuat lewat daftar hadir, bukan sebagai entitas tersendiri.'],
  ['EVENTS_UPDATE', 'Sama — kegiatan terikat pada daftar hadir.'],
  ['EVENTS_DELETE', 'Sama — menghapus kegiatan berarti menghapus daftar hadirnya.'],
  ['FINANCE_APPROVE', 'Pencatatan pembayaran tidak butuh persetujuan; tidak ada ambang nominal yang ditetapkan.'],
  ['FINANCE_EXPORT', 'Ekspor laporan keuangan belum ada. Rekap absensi sudah bisa sebagai PDF.'],
  ['DOCUMENTS_EXPORT', 'Dokumen sudah bisa dikirim lewat WhatsApp. Ekspor massal belum.'],
  [
    'WHATSAPP_BULK_SEND',
    'Sengaja: kirim massal ke daftar orang adalah operasi yang tidak bisa dibatalkan.',
  ],
  ['WHATSAPP_GROUP_MANAGE', 'Bot tidak mengelola anggota grup; tidak perlu untuk satu bot.'],
  ['MONITORING_READ', 'Monitoring agent belum ada.'],
  ['MONITORING_MANAGE', 'Monitoring agent belum ada.'],
  [
    'SKILLS_READ',
    'Skill tidak bisa dibaca dari chat — kalau bisa, agent bisa mengubah perilaku sendiri.',
  ],
  ['SKILLS_PROPOSE', 'Skill hanya bisa ditambah lewat pull request di repositori.'],
  ['SKILLS_APPROVE', 'Tidak ada alur persetujuan skill di dalam sistem.'],
  [
    'SYSTEM_CONFIGURE',
    'Tingkat operator: mengubah konfigurasi server. Tidak pernah diberikan ke peran pengguna.',
  ],
  ['SYSTEM_SAFE_MODE', 'Tingkat operator: mode aman saat ada gangguan. Tidak pernah diberikan ke peran pengguna.'],
])

/**
 * Kemampuan yang diklaim aktif, dan istilah yang harus ada di skill-nya.
 *
 * Istilah dipilih dari kata yang benar-benar dipakai orang di chat, bukan dari
 * nama internal fitur.
 */
const KEMAMPUAN_WAJIB: Array<{ label: string; need: string[] }> = [
  { label: 'Kehadiran', need: ['hadir', 'kehadiran'] },
  { label: 'Anggota', need: ['anggota'] },
  { label: 'Pesan & pengumuman', need: ['pesan'] },
  { label: 'Jadwal & pengingat', need: ['pengingat'] },
  { label: 'Keuangan', need: ['keuangan', 'kas', 'tagihan'] },
  { label: 'Dokumen', need: ['dokumen', 'surat'] },
  { label: 'Pengetahuan', need: ['pengetahuan'] },
]

/**
 * Model database yang sengaja tidak dipakai kode.
 *
 * Tabel mati tidak merusak, tapi membuat orang mengira ada fitur yang
 * sebenarnya belum ada.
 */
const TABEL_MATI = new Map<string, string>([
  ['Memory', 'Memori jangka panjang antar percakapan belum dirancang.'],
  ['GroupMembership', 'Keanggotaan per grup belum dipakai; identitas memakai keanggotaan organisasi.'],

  // ── Sistem tugas & alur kerja: dirancang, belum dibangun ─────────────────
  ['ActiveTask', 'Sistem tugas belum diimplementasikan.'],
  ['WorkflowRun', 'Mesin alur kerja belum diimplementasikan.'],
  ['AgentTask', 'Agent belum menyimpan tugasnya; satu pesan diproses sekali jalan.'],
  ['AgentStep', 'Langkah agent belum dipersistensi; log saja yang ada.'],

  // ── Idempotensi: dirancang untuk pengaman, belum dipakai ────────────────
  [
    'IdempotencyKey',
    'Belum dipakai. Ini menjelaskan kenapa nomor dokumen bisa bentrok bila dua dokumen dibuat bersamaan.',
  ],

  // ── Rekaman operasional: belum ada ───────────────────────────────────────
  ['InvoiceItem', 'Rincian tagihan disimpan lewat relasi bertingkat, bukan lewat klien terpisah.'],
  ['KnowledgeChunk', 'Penulisan lewat `createMany`; klien item tidak pernah dipanggil langsung.'],
  ['MessageDelivery', 'Pelacakan pengiriman per pesan belum ada; yang ada hanya outbox.'],
  ['OrganizationSetting', 'Pengaturan per organisasi belum ada; konfigurasi berasal dari .env.'],
  ['SkillRecord', 'Skill dimuat dari berkas, bukan dari database.'],
  ['SkillVersion', 'Skill dimuat dari berkas, bukan dari database.'],
])

let app: Awaited<ReturnType<typeof bootstrap>>

/**
 * Izin yang benar-benar dipakai tool.
 *
 * Mengembalikan NILAI izin (`attendance.read`), bukan nama konstantanya
 * (`ATTENDANCE_READ`). Mencampur keduanya mencampur keduanya membuat seluruh allowlist
 * jadi tidak berguna — semua entri terlihat "usang".
 */
function izinDipakaiTool(): Set<string> {
  const files = execSync('grep -rl PERMISSIONS src/tools/', { encoding: 'utf8' }).trim().split('\n')
  const hasil = new Set<string>()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/PERMISSIONS\.([A-Z_]+)/g)) {
      const nilai = (PERMISSIONS as Record<string, string>)[match[1]!]
      if (nilai) hasil.add(nilai)
    }
  }
  return hasil
}

/** Ubah daftar nama konstanta izin menjadi nilai izin-nya. */
function keNilaiIzin(kunci: string[]): string[] {
  return kunci.map((k) => (PERMISSIONS as Record<string, string>)[k]).filter((v): v is string => Boolean(v))
}

/** Nilai izin yang tercatat di IZIN_TANPA_TOOL. */
const NILAI_TANPA_TOOL = new Set(keNilaiIzin([...IZIN_TANPA_TOOL.keys()]))

/**
 * Izin tingkat operator.
 *
 * Sengaja TIDAK diberikan ke peran pengguna mana pun. Pemeriksa ini ada
 * supaya "tidak ada yang punya" tidak terjadi karena kelalaian — kalau izin ini
 * hilang dari daftar ini, test gagal dan seseorang harus memutuskan dengan
 * sadar.
 */
const IZIN_OPERATOR = new Map<string, string>([
  ['SYSTEM_CONFIGURE', 'Mengubah konfigurasi server; hanya lewat berkas .env dan restart.'],
  ['SYSTEM_SAFE_MODE', 'Mode aman saat ada gangguan; belum ada mekanisme untuk mengaktifkannya.'],
])

const NILAI_OPERATOR = new Set(keNilaiIzin([...IZIN_OPERATOR.keys()]))

beforeAll(async () => {
  app = await bootstrap({ startWorkers: false })
}, 120_000)

afterAll(async () => {
  await app.shutdown()
})

describe('izin tanpa tool', () => {
  it('izin tanpa tool tercatat dengan penjelasannya', () => {
    const dipakai = izinDipakaiTool()
    const tanpaTool = ALL_PERMISSIONS.filter((p) => !dipakai.has(p))
    const tanpaAlasan = tanpaTool.filter((p) => !NILAI_TANPA_TOOL.has(p))

    expect(
      tanpaAlasan,
      `Izin ini ada di katalog tapi tidak ada toolnya dan tidak tercatat: ${tanpaAlasan.join(', ')}. ` +
        'Izin tanpa tool berarti kemampuan tidak bisa dipakai. Tambahkan toolnya, hapus izinnya, ' +
        'atau catat alasannya di IZIN_TANPA_TOOL.',
    ).toEqual([])
  })

  it('izin operator juga tercatat dan tidak usang', () => {
    const adaRole = new Set(
      ROLE_TEMPLATES.flatMap((role) => role.permissions).filter((p) => !p.includes('*')),
    )
    const salah = [...NILAI_OPERATOR].filter((nilai) => adaRole.has(nilai))

    expect(
      salah,
      `Izin ini tercatat sebagai operator tapi ternyata diberikan ke peran: ${salah.join(', ')}.`,
    ).toEqual([])

    const tanpaPenjelasan = [...IZIN_OPERATOR.values()].filter((v) => v.length < 15)
    expect(
      tanpaPenjelasan,
      'Setiap entri IZIN_OPERATOR wajib punya penjelasan yang jelas.',
    ).toEqual([])
  })

  it('IZIN_TANPA_TOOL tidak usang dan tidak berbohong', () => {
    const dipakai = izinDipakaiTool()

    // Allowlist yang usang membuat audit ini berhenti berguna — dia akan
    // hijau padahal ada izin yang sebenarnya sudah punya tool.
    const sudahAdaTool = keNilaiIzin([...IZIN_TANPA_TOOL.keys()]).filter((p) => dipakai.has(p))
    expect(
      sudahAdaTool,
      `Izin ini sudah punya tool, hapus dari IZIN_TANPA_TOOL: ${sudahAdaTool.join(', ')}`,
    ).toEqual([])

    const sudahHilang = keNilaiIzin([...IZIN_TANPA_TOOL.keys()]).filter(
      (p) => !(ALL_PERMISSIONS as string[]).includes(p),
    )
    expect(
      sudahHilang,
      `Izin ini sudah tidak ada di katalog, hapus dari IZIN_TANPA_TOOL: ${sudahHilang.join(', ')}`,
    ).toEqual([])
  })
})

describe('izin tanpa peran', () => {
  it('setiap izin diberikan setidaknya satu template peran, kecuali yang tingkat operator', () => {
    // Izin yang tidak diberikan role mana pun = tidak bisa dimiliki siapa pun.
    // Tool yang butuh izin itu mustahil dipanggil siapa pun, dan tidak ada
    // yang tahu sampai saat itu diklik.
    const diberiRole = new Set(
      ROLE_TEMPLATES.flatMap((role) => role.permissions).filter((p) => !p.includes('*')),
    )

    const tanpaRole = ALL_PERMISSIONS.filter((p) => !diberiRole.has(p) && !NILAI_OPERATOR.has(p))

    expect(
      tanpaRole,
      `Izin ini tidak diberikan template peran mana pun, jadi tidak bisa dimiliki siapa pun: ${tanpaRole.join(', ')}. ` +
        'Tambahkan ke template peran yang paling sesuai, atau hapus dari katalog.',
    ).toEqual([])
  })
})

describe('kemampuan vs skill', () => {
  it('setiap kemampuan yang diklaim aktif punya skill', () => {
    const deskripsiSkill = app.skills
      .list()
      .map((s) => `${s.metadata.name} ${s.metadata.description}`)
      .join(' | ')
      .toLowerCase()

    const bermasalah = KEMAMPUAN_WAJIB.filter(
      (k) => !k.need.some((kata) => deskripsiSkill.includes(kata.toLowerCase())),
    )

    expect(
      bermasalah,
      `Kemampuan ini diklaim aktif tapi tidak ada skill yang cocok: ${bermasalah.map((k) => k.label).join(', ')}. ` +
        'Tambahkan SKILL.md-nya, atau turunkan kemampuannya jadi belum tersedia.',
    ).toEqual([])
  })
})

describe('skema database', () => {
  it('BUG REGRESSION: tidak ada model mati yang tidak tercatat', () => {
    const file = readFileSync('prisma/schema.prisma', 'utf8')
    const model = [...file.matchAll(/^model ([A-Z][A-Za-z]+) /gm)].map((m) => m[1]!)

    // Cukup tangkap `prisma.x` DAN `tx.x` — banyak akses dilakukan di dalam
    // `$transaction(async (tx) => ...)`, yang nama kliennya `tx`, bukan
    // `prisma`. Kalau hanya `prisma`, tabel yang paling aktif justru terlihat
    // paling mati.
    const kode = execSync('grep -rhoE "(prisma|tx)\\.[a-zA-Z]+" src/ --include=*.ts | sort -u', { encoding: 'utf8' })

    // Prisma memberi nama accessor dengan huruf pertama kecil saja:
    // `model OrganizationMember` → `prisma.organizationMember`. Mengubah
    // jadi kebab-case membuat SETIAP model terlihat mati — dan audit yang
    // selalu salah akan diabaikan.
    const mati = model.filter((n) => {
      const accessor = n.charAt(0).toLowerCase() + n.slice(1)
      return !kode.includes(`.${accessor}`)
    })

    const tidakDicatat = mati.filter((n) => !TABEL_MATI.has(n))

    expect(
      tidakDicatat,
      `Model ini tidak dipakai kode mana pun: ${tidakDicatat.join(', ')}. ` +
        'Hapus dari schema, atau catat alasannya di TABEL_MATI.',
    ).toEqual([])
  })

  it('TABEL_MATI tidak usang', () => {
    const file = readFileSync('prisma/schema.prisma', 'utf8')
    const model = new Set([...file.matchAll(/^model ([A-Z][A-Za-z]+) /gm)].map((m) => m[1]!))

    const sudahHilang = [...TABEL_MATI.keys()].filter((n) => !model.has(n))
    expect(
      sudahHilang,
      `Model ini sudah tidak ada di schema, hapus dari TABEL_MATI: ${sudahHilang.join(', ')}`,
    ).toEqual([])
  })
})