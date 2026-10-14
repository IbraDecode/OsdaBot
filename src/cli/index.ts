/**
 * CLI operasional OSDABOT.
 *
 * Prinsip: setiap perintah membaca kondisi NYATA dari sistem. Tidak ada
 * perintah yang hanya mencetak teks statis supaya terlihat bagus.
 *
 * Contoh perintah:
 *   pnpm osda status            — status komponen
 *   pnpm osda doctor            — diagnosis unhealthy
 *   pnpm osda tools             — daftar tool yang terdaftar
 *   pnpm osda skills            — daftar skill yang termuat
 *   pnpm osda whatsapp:status   — status koneksi WhatsApp
 *   pnpm osda whatsapp:qr       — tampilkan QR (butuh server jalan)
 *   pnpm osda org:list          — daftar organisasi
 *   pnpm osda db:seed           — isi data contoh
 */

import { bootstrap } from '../bootstrap.js'
import { env } from '../config/env.js'
import { checkDatabaseHealth, prisma } from '../database/client.js'
import { logger } from '../observability/logger.js'
import { listSessionFiles } from '../whatsapp/session-store.js'
import { MessageHandler } from '../pipeline/message-handler.js'

const log = logger.child({ module: 'cli' })

interface Command {
  name: string
  description: string
  run: () => Promise<void>
}

const commands = new Map<string, Command>()

function register(name: string, description: string, run: () => Promise<void>): void {
  commands.set(name, { name, description, run })
}

/** Bungkus garis agar rapi di terminal sempit. */
function box(title: string, lines: string[]): void {
  const lebar = Math.max(title.length, ...lines.map((line) => line.length)) + 2
  const atas = `╭─${'─'.repeat(lebar)}─╮`
  const bawah = `╰─${'─'.repeat(lebar)}─╯`
  console.log(atas)
  console.log(`│ ${title.padEnd(lebar)} │`)
  console.log(`├─${'─'.repeat(lebar)}─┤`)
  for (const line of lines) console.log(`│ ${line.padEnd(lebar)} │`)
  console.log(bawah)
}

// ---------------------------------------------------------------------------
// Perintah
// ---------------------------------------------------------------------------

register('status', 'Tampilkan status komponen OSDABOT', async () => {
  const db = await checkDatabaseHealth()
  const sessionFiles = await listSessionFiles(env.WHATSAPP_SESSION_DIR)

  const app = await bootstrap()
  box('OSDABOT — STATUS', [
    `Environment      : ${env.NODE_ENV}`,
    `Zona waktu       : ${env.APP_TIMEZONE}`,
    `Database         : ${db.ok ? `TERHUBUNG (${db.latencyMs}ms)` : 'GAGAL'}`,
    `Model AI         : ${env.AI_MODEL}`,
    `Gateway AI       : ${env.AI_BASE_URL}`,
    `Session WA       : ${sessionFiles.length} berkas`,
    `Tool terdaftar   : ${app.tools.names().length}`,
    `Skill termuat    : ${app.skills.size()}`,
    `BaturPay         : ${env.BATURPAY_API_KEY ? 'TERKONFIGURASI' : 'belum diatur'}`,
    `Penyimpanan      : ${env.STORAGE_DRIVER}`,
  ])
  await app.shutdown()
})

register('doctor', 'Diagnosis masalah konfigurasi dan konektivitas', async () => {
  const problems: string[] = []
  const notes: string[] = []

  const db = await checkDatabaseHealth()
  if (!db.ok) problems.push(`Database tidak bisa dihubungi: ${db.latencyMs}ms`)
  else notes.push(`Database OK (${db.latencyMs}ms)`)

  try {
    const sessionFiles = await listSessionFiles(env.WHATSAPP_SESSION_DIR)
    const adaCreds = sessionFiles.includes('creds.json')
    if (!adaCreds) notes.push('Belum ada session WhatsApp. Jalankan aplikasi lalu pindai QR / pakai pairing code.')
    else notes.push(`Session WhatsApp ada (${sessionFiles.length} berkas)`)
  } catch (error) {
    problems.push(`Folder session tidak bisa dibaca: ${String(error)}`)
  }

  const { OpenAiCompatibleProvider } = await import('../agent/llm/openai-compatible.js')
  const llm = new OpenAiCompatibleProvider()
  const ai = await llm.healthCheck()
  if (!ai.ok) problems.push(`AI provider bermasalah: ${ai.error ?? 'tidak diketahui'}`)
  else notes.push(`AI provider OK (${ai.latencyMs}ms)`)

  if (!env.WHATSAPP_OWNER_PHONE) {
    notes.push('WHATSAPP_OWNER_PHONE kosong — pairing code manual tidak bisa dijalankan.')
  }

  if (env.NODE_ENV === 'production') {
    if (env.SERVER_HOST === '127.0.0.1') {
      notes.push('SERVER_HOST 127.0.0.1 — webhook BaturPay tidak bisa dijangkau dari internet.')
    }
  }

  box(
    'OSDABOT — DIAGNOSIS',
    problems.length === 0
      ? [...notes, '', 'Status: tidak ada masalah kritis']
      : [...notes, '', ...problems.map((p) => `MASALAH: ${p}`), '', `Status: ${problems.length} masalah`],
  )
})

register('tools', 'Daftar tool yang terdaftar beserta izin yang dibutuhkan', async () => {
  const app = await bootstrap()
  const lines: string[] = []
  for (const tool of app.tools.list()) {
    lines.push(`${tool.name}`)
    lines.push(`    risiko: ${tool.riskLevel.toLowerCase()} | persetujuan: ${tool.requiresApproval ? 'ya' : 'tidak'}`)
    lines.push(`    izin: ${tool.requiredPermissions.join(', ') || '(tanpa izin khusus)'}`)
  }
  box(`OSDABOT — TOOL (${app.tools.names().length})`, lines.length > 0 ? lines : ['(belum ada tool)'])
  await app.shutdown()
})

register('skills', 'Daftar skill yang termuat dari folder skills/', async () => {
  const app = await bootstrap()
  const lines = app.skills.list().map(
    (skill) => `${skill.metadata.name} v${skill.metadata.version}\n    ${skill.metadata.description}`,
  )
  box(`OSDABOT — SKILL (${app.skills.size()})`, lines.length > 0 ? lines : ['(tidak ada skill)'])
  await app.shutdown()
})

register('capabilities', 'Tampilkan kemampuan yang benar-benar aktif', async () => {
  const lines = MessageHandler.capabilities().map((cap) => `${cap.name.padEnd(24)} ${cap.status}\n    ${cap.description}`)
  box('OSDABOT — KEMAMPUAN', lines)
})

register('whatsapp:status', 'Status koneksi WhatsApp', async () => {
  const sessionFiles = await listSessionFiles(env.WHATSAPP_SESSION_DIR)
  const hasCreds = sessionFiles.includes('creds.json')

  box('OSDABOT — WHATSAPP', [
    `Folder session : ${env.WHATSAPP_SESSION_DIR}`,
    `Berkas        : ${sessionFiles.length}`,
    `Credentials   : ${hasCreds ? 'ada' : 'belum ada'}`,
    `Nama bot      : ${env.WHATSAPP_BOT_NAME}`,
    '',
    'Catatan: status koneksi live hanya terlihat dari aplikasi yang sedang jalan.',
    'Jalankan `pnpm start` lalu lihat log untuk status realtime.',
  ])
})

register('whatsapp:files', 'Daftar berkas session (untuk diagnosis)', async () => {
  const files = await listSessionFiles(env.WHATSAPP_SESSION_DIR)
  box('SESSION FILES', files.length > 0 ? files : ['(folder kosong)'])
})

register('org:list', 'Daftar organisasi yang terdaftar', async () => {
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      timezone: true,
      isActive: true,
      _count: { select: { members: true, groups: true } },
    },
  })

  const lines = organizations.map(
    (org) => `${org.name}\n    id: ${org.id}\n    zona: ${org.timezone} | anggota: ${org._count.members} | grup: ${org._count.groups}${org.isActive ? '' : ' (nonaktif)'}`,
  )

  box(`ORGANISASI (${organizations.length})`, lines.length > 0 ? lines : ['(belum ada organisasi)'])
  await prisma.$disconnect()
})

register('db:seed', 'Isi data contoh (organisasi fiktif) untuk pengembangan', async () => {
  const { seed } = await import('../database/seed.js')
  await seed()
  console.log('Data contoh berhasil dibuat.')
  await prisma.$disconnect()
})

register('help', 'Tampilkan daftar perintah', async () => {
  const lines: string[] = []
  for (const command of commands.values()) {
    lines.push(`${command.name.padEnd(20)} ${command.description}`)
  }
  box('OSDABOT — CLI', lines)
})

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const requested = process.argv[2] ?? 'help'
  const command = commands.get(requested)

  if (!command) {
    console.error(`Perintah tidak dikenal: ${requested}`)
    console.error('\nPerintah yang tersedia:')
    for (const cmd of commands.values()) console.error(`  ${cmd.name.padEnd(20)} ${cmd.description}`)
    process.exit(1)
  }

  try {
    await command.run()
  } catch (error) {
    log.error({ err: error, command: requested }, 'perintah gagal')
    console.error(`\nGagal menjalankan "${requested}": ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

void main()