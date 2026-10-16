/**
 * Uji smoke skill terhadap AI gateway NYATA.
 *
 * ── Celah yang ditutup ───────────────────────────────────────────────────────
 *
 * Invarian `tool-reachability` menangkap tool yang **tidak punya** skill.
 * Tapi itu separuh masalah. Yang separuh lagi tidak tertangkap apa pun:
 *
 * ```
 * tool ada  ✓  (terdaftar)
 * skill ada ✓  (menyebut tool itu)
 * tapi model TIDAK PERNAH memilihnya  ✗  (tidak ada yang tahu)
 * ```
 *
 * Kegagalan itu muncul paling lambat: saat pengguna mengetik "tugas saya apa
 * saja" dan bot menjawab "saya bisa bantu dengan dokumen, tapi saya tidak tahu
 * soal tugas". Semua test hijau.
 *
 * Test ini menjalankan **skenario percakapan nyata** lewat `AgentRuntime` sungguhan
 * dengan tool sungguhan dan database sungguhan, lalu memeriksa apakah tool yang
 * diharapkan benar-benar dipanggil.
 *
 * ── Kenapa opt-in ───────────────────────────────────────────────────────────
 *
 * Gateway lambat — 1–3 menit per panggilan. `pnpm test` tidak boleh bergantung
 * pada API berbayar maupun selama itu.
 *
 * Jalankan:
 *   RUN_LIVE_TESTS=true pnpm vitest run tests/live/skill-smoke.live.test.ts
 *
 * ── Yang SENGAJA tidak diuji di sini ───────────────────────────────────────
 *
 * Hanya skenario yang tidak punya efek samping ke luar. Yang menulis ke WhatsApp
 * (`compose-message`), mengirim dokumen, dan melakukan pembayaran **tidak** ikut:
 * test ini berjalan terhadap database dan nomor sungguhan, dan "kebetulan gagal
 * dengan efek samping" bukan cara yang benar untuk memverifikasi pemilihan tool.
 *
 * Pemeriksaan tool yang menulis (mis. `task_create`) tetap bisa ditambahkan
 * nanti — dengan tanda unik di judul dan pembersihan di `afterAll` — tapi itu
 * keputusan terpisah, bukan asumsi.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { bootstrap, type Application } from '../../src/bootstrap.js'
import { MessageHandler } from '../../src/pipeline/message-handler.js'

const JALAN = process.env.RUN_LIVE_TESTS === 'true'
const PUNYA_KREDENSIAL = JALAN && Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL)

/**
 * Skenario: kalimat pengguna sungguhan + tool yang seharusnya dipilih.
 *
 * `bolehTanpaTool: true` dipakai kalau jawaban lisan memang sudah benar —
 * misalnya "halo". Skenario seperti itu menguji bahwa agent **tidak** memanggil
 * tool secara sembarangan, yang sama pentingnya dengan memanggil yang tepat.
 */
interface Skenario {
  skill: string
  pesan: string
  toolHarapan: string[]
  bolehTanpaTool?: boolean
  /** Untuk yang menulis ke database: penanda unik supaya bisa dibersihkan. */
  marker?: string
}

const SKENARIO: Skenario[] = [
  {
    skill: 'manage-task',
    pesan: 'tugas saya apa saja?',
    toolHarapan: ['task_list'],
  },
  {
    skill: 'manage-attendance',
    pesan: 'ada kegiatan apa saja yang punya daftar hadir?',
    toolHarapan: ['attendance_list_events'],
  },
  {
    skill: 'manage-organization',
    pesan: 'daftar anggota organisasi ini siapa saja?',
    toolHarapan: ['organization_list_members'],
  },
  {
    skill: 'manage-finance',
    // Pertanyaan tentang saldo WAJIB memanggil tool. Versi pertama skenario ini
    // ditulis `bolehTanpaTool: true` karena saya belum tahu nama tool-nya —
    // dan hasilnya: model benar, test yang salah. Jawaban modelnya bahkan
    // jujur ("belum bisa diketahui — bukan berarti Rp0"), tapi test tetap gagal
    // karena tidak ada tool yang dipanggil.
    pesan: 'ringkasan kas organisasi sekarang berapa?',
    toolHarapan: ['finance_list_accounts'],
  },
  {
    skill: 'collect-payment',
    pesan: 'tagihan iuran bulan ini ada yang belum lunas?',
    toolHarapan: ['finance_list_invoices'],
  },
  {
    skill: 'create-document',
    // Hanya yang membaca. `document_create` menulis berkas dan
    // `document_send` mengirim ke WhatsApp — keduanya di luar lingkup test ini.
    pesan: 'dokumen apa saja yang sudah pernah dibuat?',
    toolHarapan: ['document_list'],
  },
  {
    skill: 'manage-reminder',
    pesan: 'ada pengingat yang terjadwal belum?',
    toolHarapan: ['reminder_list'],
  },
  {
    skill: 'kelompok tugas',
    pesan: 'tugas yang lewat tenggat apa saja?',
    toolHarapan: ['task_list'],
  },
  {
    skill: 'answer-from-knowledge',
    pesan: 'apa aturan yang tercatat tentang penggantian panitia?',
    toolHarapan: ['knowledge_search'],
  },
  {
    skill: 'manage-group',
    pesan: 'grup mana saja yang belum tertaut ke organisasi?',
    toolHarapan: ['group_list_joined'],
  },
  {
    skill: 'sapaan biasa',
    pesan: 'halo',
    toolHarapan: [],
    bolehTanpaTool: true,
  },
]

interface HasilSkenario {
  /** Skill yang benar-benar terpilih oleh `SkillRegistry` untuk kalimat ini. */
  skillTerpilih: string[]
  skill: string
  pesan: string
  toolHarapan: string[]
  /** Tool yang benar-benar dipanggil, urut kemunculan. */
  toolDipanggil: string[]
  /** Tool yang gagal saat dipanggil. */
  toolGagal: Array<{ nama: string; kode: string; pesan: string }>
  steps: number
  durasiMs: number
  status: string
  errorCode: string | null
  balasan: string
  /** Alasan berhenti dari rekaman agent, kalau ada. */
  alasanBerhenti: string | null
}

const LAPORAN: HasilSkenario[] = []
const DIR_LAPORAN = resolve('/tmp/opencode/live-smoke')
let app: Application
let ORG_ID = ''
let izin = new Set<string>()
let AKTOR_ID: string | null = null

beforeAll(async () => {
  mkdirSync(DIR_LAPORAN, { recursive: true })

  app = await bootstrap({ startWorkers: false })
  ORG_ID = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'

  // Izin yang dimiliki aktor nyata. Skill difilter berdasarkan ini — kalau
  // tidak, skill yang tidak boleh dipakai tetap dirender ke prompt, dan test
  // ini akan mengukur sesuatu yang tidak terjadi di produksi.


  // Aktor nyata, bukan `null`. Dengan `null`, RBAC menolak sebelum tool
  // dipanggil — dan test ini hanya akan menguji bahwa penolakan bekerja.
  //
  // Yang dipakai adalah **User** id, bukan member id. `MessageHandler` juga
  // memakai `resolved.identity.userId` untuk menghitung izin skill, jadi
  // member id membuat `allowedPermissions` kosong — semua skill terfilter
  // habis, dan test gagal bukan karena model salah memilih.
  //
  // Rantainya sama seperti produksi: anggota → tautan identitas → identitas
  // WhatsApp → user.
  const user = await app.prisma.whatsAppIdentity.findFirst({
    where: { memberLinks: { some: { organizationId: ORG_ID, member: { isActive: true } } } },
    select: { userId: true },
    orderBy: { verifiedAt: 'desc' },
  })
  AKTOR_ID = user?.userId ?? null

  if (!AKTOR_ID) {
    throw new Error(
      'Tidak ada user yang tertaut ke anggota organisasi uji. ' +
        'Jalankan `pnpm osda db:seed` lebih dulu.',
    )
  }

  // Dihitung SESUDAH `AKTOR_ID` terisi.
  //
  // Versi pertama mengaturnya sebelum `AKTOR_ID` diisi, jadi `izin` selalu
  // kosong: semua skill terfilter habis, `extraSystemContext` kosong, dan agent
  // berjalan tanpa panduan skill apa pun. Test tetap lulus — karena tool yang
  // dikirim adalah **semua** tool, bukan yang production kirim. Jadi lulusnya
  // tidak berarti apa-apa.
  izin = await app.authorization.permissionsFor(AKTOR_ID, ORG_ID)
}, 180_000)

afterAll(async () => {
  writeFileSync(resolve(DIR_LAPORAN, 'laporan.json'), JSON.stringify(LAPORAN, null, 2), 'utf-8')
  await app?.prisma.$disconnect()
})

/**
 * Jalankan satu skenario lewat `AgentRuntime` sungguhan.
 *
 * `ToolExecution` dibaca dari database, bukan dari return value — supaya yang
 * diperiksa benar-benar **dipanggil**, bukan sekadar ada di daftar.
 */
async function jalankan(s: Skenario): Promise<HasilSkenario> {
  const correlationId = `live-smoke-${s.skill}-${Date.now()}`
  const sebelum = await app.prisma.toolExecution.findMany({
    where: { correlationId },
    select: { toolName: true, outcome: true, errorCode: true },
  })
  expect(sebelum).toHaveLength(0)

  // Prompt yang dikirim sama persis dengan yang produksi: daftar kemampuan dari
  // `MessageHandler`, dan konteks skill dari `SkillRegistry` untuk skill yang
  // **memang terpilih** oleh kalimat pengguna.
  //
  // Menyalin sendiri daftar kemampuan akan membuat test menguji prompt yang
  // berbeda dari yang dipakai bot — dan lulus tanpa artinya.
  const skillTerpilih = app.skills.select(s.pesan, { isGroup: false, allowedPermissions: izin })
  const konteksSkill = app.skills.render(skillTerpilih)

  const mulai = Date.now()
  const hasil = await app.agent.run({
    correlationId,
    actorUserId: AKTOR_ID,
    organizationId: ORG_ID,
    conversationId: null,
    chatJid: '6280000000000@s.whatsapp.net',
    senderJid: '6280000000000@s.whatsapp.net',
    isGroup: false,
    timezone: process.env.APP_TIMEZONE ?? 'Asia/Jakassar',
    organizationName: 'OSIS SMKN 2 MATARAM',
    memberName: 'Anggota Uji',
    history: [],
    text: s.pesan,
    capabilities: MessageHandler.capabilities()
      .filter((c) => c.status === 'enabled')
      .map((c) => ({ name: c.name, description: c.description })),
    extraSystemContext: konteksSkill || undefined,
    // Sama persis seperti `MessageHandler`: tool dibatasi oleh skill yang
    // terpilih, ditambah tool default. Tanpa ini test mengirim 49 tool dan
    // mengukur sesuatu yang tidak terjadi di produksi.
    relevantToolNames: [...new Set(skillTerpilih.flatMap((k) => k.metadata.requiredTools))],
  })

  const eksekusi = await app.prisma.toolExecution.findMany({
    where: { correlationId },
    select: { toolName: true, outcome: true, errorCode: true },
    orderBy: { createdAt: 'asc' },
  })

  const rekaman = await app.prisma.agentTask.findFirst({
    where: { state: { path: ['correlationId'], equals: correlationId } },
    select: { errorCode: true },
  })

  return {
    skill: s.skill,
    skillTerpilih: skillTerpilih.map((k) => k.metadata.name),
    pesan: s.pesan,
    toolHarapan: s.toolHarapan,
    toolDipanggil: eksekusi.map((e) => e.toolName),
    toolGagal: eksekusi
      .filter((e) => e.outcome !== 'success')
      .map((e) => ({ nama: e.toolName, kode: e.errorCode ?? e.outcome, pesan: '' })),
    steps: 'steps' in hasil ? (hasil.steps ?? 0) : 0,
    durasiMs: Date.now() - mulai,
    status: hasil.status,
    errorCode: 'errorCode' in hasil ? ((hasil as { errorCode?: string }).errorCode ?? null) : null,
    balasan: hasil.message.slice(0, 400),
    alasanBerhenti: rekaman?.errorCode ?? null,
  }
}

describe.skipIf(!PUNYA_KREDENSIAL)('skill smoke — gateway sungguhan', () => {
  // Gateway lambat. 1–3 menit per panggilan adalah yang wajar, dan test ini
  // akan gagal karena timeout jauh sebelum model selesai berpikir.
  const TIMEOUT_SKENARIO = 300_000

  for (const s of SKENARIO) {
    it(
      `${s.skill}: "${s.pesan}"`,
      { timeout: TIMEOUT_SKENARIO },
      async () => {
        const hasil = await jalankan(s)
        LAPORAN.push(hasil)

        const pesanDiagnostik =
          `\n  skill     : ${hasil.skill}\n` +
          `\n  terpilih  : ${hasil.skillTerpilih.join(', ') || '(tidak ada)'}\n` +
          `  pesan     : ${hasil.pesan}\n` +
          `  diharapkan : ${hasil.toolHarapan.join(', ') || '(tanpa tool)'}\n` +
          `  dipanggil : ${hasil.toolDipanggil.join(', ') || '(tidak ada)'}\n` +
          `  berhenti  : ${hasil.alasanBerhenti ?? '-'}\n` +
          `  balasan   : ${hasil.balasan}`

        expect(hasil.status, `agent gagal\n${pesanDiagnostik}`).toBe('completed')

        if (s.bolehTanpaTool && hasil.toolHarapan.length === 0) {
          // Menguji bahwa agent TIDAK memanggil tool untuk obrolan biasa.
          expect(
            hasil.toolDipanggil,
            `agent seharusnya tidak memanggil tool untuk obrolan biasa\n${pesanDiagnostik}`,
          ).toEqual([])
          return
        }

        const dipanggilYangDiharapkan = hasil.toolHarapan.filter((t) => hasil.toolDipanggil.includes(t))
        expect(
          dipanggilYangDiharapkan.length,
          `tool yang diharapkan tidak dipilih model\n${pesanDiagnostik}`,
        ).toBeGreaterThan(0)
      },
    )
  }
})