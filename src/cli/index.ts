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
 *   pnpm osda org:create        — buat organisasi nyata + hubungkan nomor admin
 *   pnpm osda org:show          — detail organisasi (anggota, nomor, peran)
 *   pnpm osda org:add-member    — tambah satu anggota
 *   pnpm osda org:import-members— impor massal dari teks/berkas
 *   pnpm osda reminder:list     — daftar pengingat terjadwal
 *   pnpm osda reminder:cancel   — batalkan semua pengingat
 *   pnpm osda reminder:tick     — jalankan worker sekali
 *   pnpm osda outbox:list        — event yang perlu rekonsiliasi
 *   pnpm osda outbox:tick        — jalankan dispatcher sekali
 *   pnpm osda group:pending     — grup yang mengirim pesan tapi belum tertaut
 *   pnpm osda group:list        — grup yang sudah tertaut
 *   pnpm osda group:link        — hubungkan grup ke organisasi
 *   pnpm osda group:activation  — ubah kapan bot merespons di grup
 *   pnpm osda group:unlink      — lepas tautan grup
 *   pnpm osda db:seed           — isi data contoh
 */

import { bootstrap } from '../bootstrap.js'
import { env } from '../config/env.js'
import { checkDatabaseHealth, prisma } from '../database/client.js'
import { logger } from '../observability/logger.js'
import { listSessionFiles } from '../whatsapp/session-store.js'
import { maskPhone } from '../whatsapp/baileys-provider.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OrganizationProvisioner } from '../organization/provisioning.js'
import { MemberProvisioner } from '../organization/member-onboarding.js'
import { ReminderService } from '../reminders/service.js'
import { MessageHandler } from '../pipeline/message-handler.js'
import { GroupLinkError, GroupLinkService } from '../groups/service.js'

const log = logger.child({ module: 'cli' })

interface Command {
  name: string
  description: string
  run: () => Promise<void>
}

const commands = new Map<string, Command>()

/** Argumen bebas yang menyusul nama perintah. */
let argumenBebas: string[] = []

function register(name: string, description: string, run: () => Promise<void>): void {
  commands.set(name, { name, description, run })
}

/**
 * Parse argumen `--key=value` dan `--key value`.
 *
 * Tanpa parser, setiap perintah akan menurunkan variabel ad-hoc sendiri.
 */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue

    const body = token.slice(2)
    const sama = body.indexOf('=')
    if (sama !== -1) {
      out[body.slice(0, sama)] = body.slice(sama + 1).replace(/^["']|["']$/g, '')
      continue
    }

    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[body] = next.replace(/^["']|["']$/g, '')
      i += 1
    } else {
      out[body] = 'true'
    }
  }
  return out
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

  const app = await bootstrap({ startWorkers: false })
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

  if (!env.WHATSAPP_LINK_PHONE) {
    notes.push(
      'WHATSAPP_LINK_PHONE kosong — nomor akun BOT belum diisi, jadi pairing code ' +
        'tidak bisa dijalankan. (Bukan nomor admin.)',
    )
  } else {
    notes.push(`Nomor akun bot : ${maskPhone(env.WHATSAPP_LINK_PHONE)}`)
  }

  if (env.WHATSAPP_ADMIN_PHONE) {
    notes.push(`Nomor admin     : ${maskPhone(env.WHATSAPP_ADMIN_PHONE)}`)
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
    `Nomor bot     : ${env.WHATSAPP_LINK_PHONE ? maskPhone(env.WHATSAPP_LINK_PHONE) : '(belum diisi)'}`,
    `Nomor admin   : ${env.WHATSAPP_ADMIN_PHONE ? maskPhone(env.WHATSAPP_ADMIN_PHONE) : '(belum diisi)'}`,
    '',
    'Nomor bot adalah akun yang DITAUTKAN ke Baileys.',
    'Nomor admin adalah pemilik yang mengendalikan — tidak pernah dikirim ke WhatsApp.',
  ])
})

register('whatsapp:files', 'Daftar berkas session (untuk diagnosis)', async () => {
  const files = await listSessionFiles(env.WHATSAPP_SESSION_DIR)
  box('SESSION FILES', files.length > 0 ? files : ['(folder kosong)'])
})

/**
 * Cari organisasi berdasarkan id, slug, atau nama.
 *
 * `id` hanya ikut dicocokkan kalau nilainya benar-benar berbentuk UUID.
 * Kolom `id` bertipe `@db.Uuid`, jadi memberi slug seperti
 * "osis-smkn-2-mataram" ke sana membuat PostgreSQL menolak dengan
 * "Error creating UUID" — bukan pesan yang membantu operator sama sekali.
 */
export async function cariOrganisasi(kunci: string): Promise<{ id: string; name: string; slug: string } | null> {
  const kekunciUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(kunci)

  return prisma.organization.findFirst({
    where: {
      OR: [
        ...(kekunciUuid ? [{ id: kunci }] : []),
        { slug: kunci },
        { name: kunci },
      ],
    },
    select: { id: true, name: true, slug: true },
  })
}

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

register('org:create', 'Buat organisasi sungguhan + hubungkan nomor admin', async () => {
  const args = parseArgs(process.argv.slice(3))
  const nama = args.name
  const adminNama = args['admin-name']
  const adminTelepon = args['admin-phone'] ?? env.WHATSAPP_ADMIN_PHONE

  if (!nama) {
    console.error('Wajib: --name="Nama Organisasi"')
    console.error('Disarankan: --admin-name="Nama Admin" --admin-phone=628xxxxxxxxx')
    console.error('')
    console.error('Contoh:')
    console.error('  pnpm osda org:create --name="OSIS SMA 1" \\')
    console.error('    --admin-name="Budi Santoso" --admin-phone=6285792820173')
    await prisma.$disconnect()
    process.exit(1)
  }

  if (!adminNama || !adminTelepon) {
    console.error('Wajib: --admin-name dan --admin-phone.')
    console.error('Tanpa itu organisasi akan ada, tapi tidak ada yang bisa memakainya.')
    console.error('WHATSAPP_ADMIN_PHONE di env dipakai sebagai nilai bawaan.')
    await prisma.$disconnect()
    process.exit(1)
  }

  const provisioner = new OrganizationProvisioner(prisma as never)
  await provisioner.ensurePermissions()

  const org = await provisioner.createOrganization({
    name: nama,
    ...(args.slug ? { slug: args.slug } : {}),
    ...(args.timezone ? { timezone: args.timezone } : {}),
  })

  const link = await provisioner.linkAdmin({
    organizationId: org.id,
    fullName: adminNama,
    phone: adminTelepon,
    ...(args.role ? { roleKey: args.role } : {}),
  })

  const ringkasan = await provisioner.describe(org.id)

  box('ORGANISASI DIBUAT', [
    `Nama        : ${ringkasan.name}`,
    `Slug        : ${ringkasan.slug}`,
    `Zona waktu  : ${ringkasan.timezone}`,
    `Anggota     : ${ringkasan.memberCount}`,
    `Peran       : ${ringkasan.roleCount}`,
    '',
    `Admin       : ${adminNama} (${maskPhone(adminTelepon)})`,
    `Peran admin : ${link.roleKey}`,
    `Status      : ${link.created ? 'nomor baru ditautkan' : 'nomor sudah ada, diperbarui'}`,
  ])

  console.log('')
  console.log('  Catatan:')
  console.log('  - Nomor admin sudah terhubung, jadi begitu bot hidup dia langsung')
  console.log('    bisa dipakai tanpa onboarding manual.')
  console.log('  - Tautan identitas BELUM ditandai terverifikasi. Itu disengaja:')
  console.log('    nomor di environment adalah klaim, belum bukti.')
  console.log('  - Periksa hasilnya dengan: pnpm osda org:show --slug=' + org.slug)
  console.log('')
  await prisma.$disconnect()
})

register('org:show', 'Tampilkan detail organisasi (anggota, nomor, peran)', async () => {
  const args = parseArgs(process.argv.slice(3))
  // Tanpa --slug/--id, pakai satu-satunya organisasi yang ada. Kalau lebih
  // dari satu, memilih diam-diam bisa menampilkan detail organisasi yang
  // salah — itu informasi yang tidak seharusnya bocor.
  let identifier = args.slug ?? args.id ?? null
  if (!identifier) {
    const semua = await prisma.organization.findMany({ select: { slug: true } })
    if (semua.length === 1) identifier = semua[0]!.slug
    else if (semua.length === 0) {
      console.error('Belum ada organisasi. Jalankan: pnpm osda org:create --name="..." --admin-name="..." --admin-phone=...')
    }
  }

  if (!identifier) {
    console.error('Pakai --slug=... atau --id=...')
    await prisma.$disconnect()
    process.exit(1)
  }

  const provisioner = new OrganizationProvisioner(prisma as never)
  const org = await prisma.organization.findFirst({
    where: typeof identifier === 'string' && identifier.includes('-') && identifier.length === 36
      ? { id: identifier }
      : { slug: identifier },
    select: { id: true },
  })

  if (!org) {
    console.error(`Organisasi "${identifier}" tidak ditemukan.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const detail = await provisioner.describe(org.id)
  const lines = detail.linkedPhones.map(
    (item) => `${item.name}\n    ${maskPhone(item.phone)} | peran: ${item.roles.join(', ') || '(tanpa peran)'}${item.verified ? '' : ' | BELUM diverifikasi'}`,
  )

  box(`${detail.name} (${detail.slug})`, [
    `Zona waktu : ${detail.timezone}`,
    `Anggota    : ${detail.memberCount}`,
    `Peran      : ${detail.roleCount}`,
    '',
    ...lines,
  ])
  await prisma.$disconnect()
})

register('org:add-member', 'Tambah satu anggota ke organisasi', async () => {
  const args = parseArgs(process.argv.slice(3))
  const slug = args.slug
  const nama = args.name
  const telepon = args.phone

  if (!slug || !nama) {
    console.error('Wajib: --slug=... --name="Nama Lengkap" --phone=628xxxxxxxxx')
    await prisma.$disconnect()
    process.exit(1)
  }

  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!org) {
    console.error(`Organisasi "${slug}" tidak ditemukan.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const provisioner = new MemberProvisioner(prisma as never)
  const results = await provisioner.addMembers({
    organizationId: org.id,
    members: [
      {
        fullName: nama,
        phone: telepon ?? '',
        ...(args.role ? { roleKey: args.role } : {}),
        ...(args.class ? { className: args.class } : {}),
        ...(args.aliases ? { aliases: args.aliases.split(',').map((a) => a.trim()).filter(Boolean) } : {}),
      },
    ],
    ...(args.role ? { defaultRoleKey: args.role } : {}),
  })
  const hasil = results[0]

  if (!hasil || hasil.status === 'skipped') {
    console.error(`Gagal: ${hasil?.reason ?? 'tidak diketahui'}`)
    await prisma.$disconnect()
    process.exit(1)
  }

  box('ANGGOTA DITAMBAHKAN', [
    `Organisasi : ${org.name}`,
    `Nama       : ${hasil.fullName}`,
    `Nomor      : ${hasil.phone ? maskPhone(hasil.phone) : '(belum diisi)'}`,
    `Status     : ${hasil.status === 'created' ? 'baru dibuat' : 'sudah ada, diperbarui'}`,
  ])
  await prisma.$disconnect()
})

register('org:import-members', 'Impor banyak anggota dari teks atau berkas', async () => {
  const args = parseArgs(process.argv.slice(3))
  const slug = args.slug
  const sumber = args.file

  if (!slug) {
    console.error('Wajib: --slug=...')
    console.error('Sumber data: --file=anggota.txt  atau  --text="Nama | 628xxx | peran"')
    console.error('')
    console.error('Format tiap baris:')
    console.error('  Nama | 628xxxxxxxxx | peran | kelas | alias1,alias2')
    console.error('')
    console.error('Contoh isi berkas:')
    console.error('  # baris diawali # diabaikan')
    console.error('  Budi Santoso | 6281234567890 | anggota | X AKL 3 | budi,budi_s')
    console.error('  Siti Aminah  |                  | anggota | XI IPA 2')
    await prisma.$disconnect()
    process.exit(1)
  }

  let text: string
  if (sumber) {
    const path = resolve(process.cwd(), sumber)
    if (!existsSync(path)) {
      console.error(`Berkas tidak ditemukan: ${path}`)
      await prisma.$disconnect()
      process.exit(1)
    }
    text = readFileSync(path, 'utf-8')
  } else if (args.text) {
    text = args.text.replace(/\\n/g, '\n')
  } else {
    console.error('Sebutkan --file=... atau --text="..."')
    await prisma.$disconnect()
    process.exit(1)
  }

  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!org) {
    console.error(`Organisasi "${slug}" tidak ditemukan.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const { members, errors } = MemberProvisioner.parseText(text)
  const provisioner = new MemberProvisioner(prisma as never)

  const peranTersedia = await provisioner.listRoles(org.id)
  console.log(`  Peran tersedia: ${peranTersedia.join(', ')}`)

  if (errors.length > 0) {
    console.log(`\n  ${errors.length} baris dilewati:`)
    for (const message of errors.slice(0, 10)) console.log(`    - ${message}`)
    if (errors.length > 10) console.log(`    ... dan ${errors.length - 10} lagi`)
  }

  if (members.length === 0) {
    console.log('\n  Tidak ada anggota valid untuk diimpor.')
    await prisma.$disconnect()
    process.exit(1)
  }

  const results = await provisioner.addMembers({
    organizationId: org.id,
    members,
    ...(args.role ? { defaultRoleKey: args.role } : {}),
  })

  const dibuat = results.filter((r) => r.status === 'created').length
  const diperbarui = results.filter((r) => r.status === 'updated').length
  const dilewati = results.filter((r) => r.status === 'skipped').length

  box('HASIL IMPOR', [
    `Organisasi : ${org.name}`,
    `Dibaca     : ${members.length}`,
    `Baru       : ${dibuat}`,
    `Diperbarui : ${diperbarui}`,
    `Dilewati   : ${dilewati}`,
  ])

  if (dilewati > 0) {
    console.log('\n  Yang dilewati:')
    for (const item of results.filter((r) => r.status === 'skipped').slice(0, 10)) {
      console.log(`    - ${item.fullName}: ${item.reason}`)
    }
  }

  await prisma.$disconnect()
})

register('reminder:list', 'Daftar pengingat terjadwal', async () => {
  const args = parseArgs(process.argv.slice(3))
  const slug = args.slug

  if (!slug) {
    console.error('Pakai --slug=...')
    await prisma.$disconnect()
    process.exit(1)
  }

  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!org) {
    console.error(`Organisasi "${slug}" tidak ditemukan.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const service = new ReminderService(prisma as never)
  const daftar = await service.listActive(org.id)

  box(`PENGINGAT — ${org.name} (${daftar.length})`, [
    ...daftar.map((item) => {
      const kapan = item.scheduledAt.toISOString().replace('T', ' ').slice(0, 16)
      return `${kapan} | ${item.title}\n    ${item.body}`
    }),
    ...(daftar.length === 0 ? ['(tidak ada pengingat terjadwal)'] : []),
  ])
  await prisma.$disconnect()
})

register('reminder:cancel', 'Batalkan semua pengingat terjadwal di organisasi', async () => {
  const args = parseArgs(process.argv.slice(3))
  const slug = args.slug

  if (!slug) {
    console.error('Pakai --slug=...')
    await prisma.$disconnect()
    process.exit(1)
  }

  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!org) {
    console.error(`Organisasi "${slug}" tidak ditemukan.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const service = new ReminderService(prisma as never)
  const jumlah = await service.cancelAll(org.id)

  console.log(`\n${jumlah} pengingat dibatalkan di "${org.name}".`)
  await prisma.$disconnect()
})

register('reminder:tick', 'Jalankan satu siklus worker pengingat sekarang', async () => {
  const { ReminderWorker } = await import('../queue/reminder-worker.js')
  const { BaileysProvider } = await import('../whatsapp/baileys-provider.js')

  const whatsapp = new BaileysProvider()
  const worker = new ReminderWorker({ prisma: prisma as never, whatsapp })

  console.log('Menjalankan satu siklus worker pengingat...\n')
  try {
    const hasil = await worker.tick()
    console.log(`  Dikirim     : ${hasil.dikirim}`)
    console.log(`  Gagal       : ${hasil.gagal}`)
    console.log(`  Dilewati    : ${hasil.dilewati}`)
    console.log('')
    if (hasil.dikirim === 0 && hasil.gagal === 0) {
      console.log('  Tidak ada pengingat yang jatuh tempo.')
    }
  } catch (error) {
    console.error('  Siklus gagal:', error instanceof Error ? error.message : error)
    await prisma.$disconnect()
    process.exit(1)
  }

  await prisma.$disconnect()
})

register('outbox:list', 'Tampilkan event outbox yang perlu rekonsiliasi', async () => {
  const { OutboxDispatcher } = await import('../outbox/dispatcher.js')
  const dispatcher = new OutboxDispatcher(prisma as never)

  const daftar = await dispatcher.needReconciliation(30)

  box(`OUTBOX — PERLU REKONSILIASI (${daftar.length})`, [
    ...daftar.map((item) =>
      `${item.status} | ${item.topic} | percobaan ${item.attempts}\n    ${item.lastError ?? '(tanpa catatan)'}`,
    ),
    ...(daftar.length === 0
      ? ['(semua event selesai)']
      : []),
    '',
    'UNKNOWN = mungkin sudah terkirim, jangan dikirim ulang tanpa dicek.',
    'FAILED  = sudah menyerah setelah batas percobaan.',
  ])
  await prisma.$disconnect()
})

register('outbox:tick', 'Jalankan satu siklus dispatcher outbox', async () => {
  const { OutboxDispatcher } = await import('../outbox/dispatcher.js')
  const { WhatsAppOutboxHandler } = await import('../outbox/handlers.js')
  const { BaileysProvider } = await import('../whatsapp/baileys-provider.js')
  const { SafeModeService } = await import('../system/safe-mode.js')

  const dispatcher = new OutboxDispatcher(prisma as never)
  dispatcher.register(
    new WhatsAppOutboxHandler({
      prisma: prisma as never,
      whatsapp: new BaileysProvider(),
      safeMode: new SafeModeService(prisma as never),
    }),
  )

  const hasil = await dispatcher.tick()
  console.log('')
  console.log(`  Diproses    : ${hasil.diproses}`)
  console.log(`  Terkirim   : ${hasil.terkirim}`)
  console.log(`  Gagal      : ${hasil.gagal}`)
  console.log(`  Tidak pasti: ${hasil.unknown}`)
  console.log(`  Tanpa handler: ${hasil.tanpaHandler}`)
  console.log('')
  await prisma.$disconnect()
})

register('db:seed', 'Isi data contoh (organisasi fiktif) untuk pengembangan', async () => {
  const { seed } = await import('../database/seed.js')
  await seed()
  console.log('Data contoh berhasil dibuat.')
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Rekaman jalan agent
// ---------------------------------------------------------------------------

register('run:list', 'Jalan agent terbaru beserta alasan berhentinya', async () => {
  const { ringkasRekaman } = await import('../agent/run-recorder.js')
  const args = parseArgs(process.argv.slice(3))
  const ambil = parseInt(args.limit ?? '10', 10)

  const baris = await prisma.agentTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(ambil, 1), 50),
    include: { steps: { orderBy: { ordinal: 'asc' } } },
  })

  if (baris.length === 0) {
    console.log('\n  Belum ada rekaman jalan agent.\n')
    await prisma.$disconnect()
    return
  }

  const lines = baris.map((b) => ringkasRekaman(b))

  // Ringkasan alasan berhenti: ini yang paling sering dicari. "Agent error"
  // dan "langkah habis" punya penanganan yang sama sekali berbeda.
  const hitung = new Map<string, number>()
  for (const b of baris) {
    const kunci = b.errorCode ?? 'JAWABAN_FINAL'
    hitung.set(kunci, (hitung.get(kunci) ?? 0) + 1)
  }
  const ringkas = [...hitung.entries()].map(([alasan, n]) => `${alasan}: ${n}`).join(' · ')

  box('OSDABOT — Jalan agent', lines)
  console.log(`\n  ${ringkas}\n`)
  await prisma.$disconnect()
})

/** Cari id AgentTask yang dimulai dengan prefix, lewat cast ke teks. */
async function idYangMulaiDengan(prefix: string): Promise<string[]> {
  const hasil = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM "AgentTask"
    WHERE id::text LIKE ${prefix + '%'}
    ORDER BY "createdAt" DESC
    LIMIT 5
  `
  return hasil.map((h) => h.id)
}

register('run:show', 'Detail satu jalan agent beserta langkah-langkahnya', async () => {
  const { ringkasRekaman } = await import('../agent/run-recorder.js')
  const args = parseArgs(process.argv.slice(3))
  const id = args.id
  if (!id) {
    console.error('Pakai: pnpm osda run:show --id=<AgentTask id>')
    await prisma.$disconnect()
    process.exit(1)
  }

  // Identifier boleh disingkat seperti git: 8 karakter pertama sudah unik untuk
  // ribuan baris, dan mengetik UUID penuh lewat terminal itu memalukan.
  //
  // Prisma tidak bisa menyaring UUID dengan `startsWith`. Postgres bisa lewat
  // `::text`, tapi indeks UUID-nya jadi tidak terpakai kalau kolomnya di-cast.
  // Karena ini CLI yang dijalankan manusia — bukan loop — kandidat diambil
  // dengan cast lalu yang pertama diambil. Batasnya jelas dan cukup untuk
  //pemeriksaan.
  const baris =
    id.length === 36
      ? await prisma.agentTask.findUnique({
          where: { id },
          include: { steps: { orderBy: { ordinal: 'asc' } } },
        })
      : await (async () => {
          const kandidat = await prisma.agentTask.findMany({
            where: { id: { in: await idYangMulaiDengan(id) } },
            include: { steps: { orderBy: { ordinal: 'asc' } } },
          })
          return kandidat[0] ?? null
        })()

  if (!baris) {
    console.error(`Jalan agent tidak ditemukan: ${id}`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const state = (baris.state ?? {}) as Record<string, unknown>
  console.log('')
  console.log(`  ${ringkasRekaman(baris)}`)
  console.log(`  Percakapan : ${baris.conversationId ?? '-'}`)
  console.log(`  Chat       : ${state.chatJid ?? '-'} ${state.isGroup ? '(grup)' : '(personal)'}`)
  console.log(`  Actor      : ${baris.actorUserId ?? '-'}`)
  console.log(`  Tool tersedia: ${(state.availableTools as string[] | undefined)?.length ?? 0}`)
  console.log('')

  if (baris.steps.length === 0) {
    console.log('  (tidak ada langkah tercatat)')
  }
  for (const langkah of baris.steps) {
    const tanda = langkah.error ? '!' : '.'
    console.log(
      `  ${tanda} ${String(langkah.ordinal).padStart(2)} ${langkah.description}` +
        (langkah.error ? `  ← ${langkah.error}` : ''),
    )
  }
  console.log('')

  // Tool yang gagal di jalan ini sering jadi akar masalah.
  const gagal = await prisma.toolExecution.findMany({
    where: { taskId: baris.id, outcome: { not: 'success' } },
    select: { toolName: true, errorCode: true, outcome: true },
  })
  if (gagal.length > 0) {
    console.log('  Tool yang tidak berhasil:')
    for (const g of gagal) console.log(`    ${g.toolName}: ${g.errorCode ?? g.outcome}`)
    console.log('')
  }

  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Retensi data
// ---------------------------------------------------------------------------

register('retention:status', 'Kebijakan retensi + berapa baris yang akan dihapus', async () => {
  const { RetentionService, KEBIJAKAN } = await import('../system/retention.js')
  const service = new RetentionService(prisma)
  const hasil = await service.perkiraan()

  const lines = KEBIJAKAN.map(
    (k) => `${k.tabel.padEnd(16)} ${String(k.hari).padStart(4)} hari  ${'·'.repeat(2)} ${hasil.perTabel.find((p) => p.tabel === k.tabel)?.jumlah ?? 0} baris`,
  )

  box('OSDABOT — RETENSI', [
    ...lines,
    '',
    `Total akan dihapus : ${hasil.perTabel.reduce((n, p) => n + p.jumlah, 0)} baris`,
    `Data bisnis        : ${hasil.dilewati.length} tabel TIDAK tersentuh`,
  ])
  console.log('')
  console.log('  Jalankan dengan: pnpm osda retention:run --dry-run  (hitung saja)')
  console.log('                  pnpm osda retention:run             (hapus)')
  console.log('')
  await prisma.$disconnect()
})

register('retention:run', 'Hapus baris yang melewati kebijakan retensi', async () => {
  const { RetentionService } = await import('../system/retention.js')
  const args = parseArgs(process.argv.slice(3))
  const dryRun = args['dry-run'] !== undefined

  const service = new RetentionService(prisma)
  const hasil = dryRun ? await service.perkiraan() : await service.jalankan()

  console.log('')
  for (const p of hasil.perTabel) {
    const tanda = p.kenaBatas ? ' (batas siklus tercapai, sisanya belum)' : ''
    console.log(
      `  ${p.tabel.padEnd(16)} ${String(p.jumlah).padStart(6)} baris${tanda}` +
        (dryRun ? '' : ' dihapus'),
    )
  }
  console.log('')
  console.log(dryRun ? '  Hitsung saja — tidak ada yang dihapus.' : `  Total dihapus: ${hasil.totalDihapus} baris`)
  console.log(`  ${hasil.dilewati.length} tabel data bisnis tidak tersentuh.`)
  console.log('')
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Mode aman — tombol darurat
// ---------------------------------------------------------------------------

register('safe-mode:status', 'Status mode aman (tombol darurat)', async () => {
  const { SafeModeService } = await import('../system/safe-mode.js')
  const service = new SafeModeService(prisma)
  const status = await service.snapshot()

  console.log('')
  if (!status.enabled) {
    console.log('  Mode aman: MATI — bot bertindak normal.')
  } else {
    console.log('  Mode aman: AKTIF — bot tidak bertindak.')
    console.log(`  Desde      : ${status.since?.toISOString() ?? 'tidak diketahui'}`)
    console.log(`  Alasan     : ${status.reason ?? '(tidak dicatat)'}`)
    console.log(`  Diubah oleh: ${status.changedBy ?? '(tidak dicatat)'}`)
    console.log('')
    console.log('  Yang tetap jalan: pencatatan pesan masuk, endpoint HTTP.')
    console.log('  Yang berhenti: panggilan AI, semua tool, semua pengiriman pesan,')
    console.log('                termasuk pesan yang sudah antre di outbox.')
  }
  console.log('')
  await prisma.$disconnect()
})

register('safe-mode:on', 'Nyalakan mode aman — bot berhenti bertindak (TOMBOL DARURAT)', async () => {
  const { SafeModeService } = await import('../system/safe-mode.js')
  const alasan = argumenBebas.join(' ').trim() || null
  const service = new SafeModeService(prisma)
  const status = await service.set({ enabled: true, reason: alasan, changedBy: 'cli' })

  console.log('')
  console.log('  MODE AMAN AKTIF.')
  console.log(`  Desde: ${status.since?.toISOString()}`)
  if (alasan) console.log(`  Alasan: ${alasan}`)
  console.log('')
  console.log('  Pesan masuk tetap dicatat. Tidak ada AI, tool, atau pesan keluar')
  console.log('  yang akan berjalan. Matikan lagi dengan: pnpm osda safe-mode:off')
  console.log('')
  await prisma.$disconnect()
})

register('safe-mode:off', 'Matikan mode aman — bot bertindak lagi', async () => {
  const { SafeModeService } = await import('../system/safe-mode.js')
  const service = new SafeModeService(prisma)
  await service.set({ enabled: false, reason: null, changedBy: 'cli' })

  console.log('')
  console.log('  Mode aman mati. Bot bertindak lagi dari pesan berikutnya.')
  console.log('')
  await prisma.$disconnect()
})


// ---------------------------------------------------------------------------
// Grup WhatsApp
// ---------------------------------------------------------------------------

register('group:pending', 'Grup yang mengirim pesan tapi belum tertaut', async () => {
  const service = new GroupLinkService(prisma)
  const grup = await service.listUnlinked(20)

  const lines = grup.map(
    (g) =>
      `${g.subject ?? '(tanpa subjek)'}\n    jid: ${g.jid}\n    pesan: ${g.messageCount} | terakhir: ${g.lastSeenAt.toISOString().slice(0, 16).replace('T', ' ')}${g.lastSenderName ? ` | pengirim: ${g.lastSenderName}` : ''}`,
  )

  if (lines.length === 0) {
    console.log('Tidak ada grup yang menunggu ditautkan.')
    console.log('')
    console.log('Kalau bot tidak merespons di grup, cek urutan ini:')
    console.log('  1. Grup masuk daftar ini? → belum tertaut, jalankan group:link')
    console.log('  2. Sudah tertaut?         → pastikan pesan menyebut "osda" atau @mention')
    console.log('  3. Sudah disebut?        → cek log bot, cari "pesan dilewati"')
  } else {
    box('GRUP MENUNGGU TAUTAN', lines)
    console.log('')
    console.log('Tautkan dengan:')
    console.log('  pnpm osda group:link --jid=<JID> --org=<NAMA ATAU ID>')
  }
  await prisma.$disconnect()
})

register('group:list', 'Daftar grup yang sudah tertaut ke organisasi', async () => {
  const args = parseArgs(process.argv.slice(3))
  const service = new GroupLinkService(prisma)

  let organizationId: string | undefined
  if (args.org) {
    const org = await cariOrganisasi(args.org)
    if (!org) {
      console.error(`Organisasi "${args.org}" tidak ditemukan. Cek dengan org:list.`)
      await prisma.$disconnect()
      process.exit(1)
    }
    organizationId = org.id
  }

  const grup = await service.listLinked(organizationId)
  const lines = grup.map(
    (g) =>
      `${g.subject ?? '(tanpa subjek)'}\n    jid: ${g.jid}\n    org: ${g.organizationName} | aktivasi: ${g.activation}${g.isArchived ? ' | ARSIP' : ''}`,
  )

  box(`GRUP TERTAUT (${grup.length})`, lines.length > 0 ? lines : ['(belum ada grup tertaut)'])
  await prisma.$disconnect()
})

register('group:link', 'Hubungkan grup WhatsApp ke organisasi', async () => {
  const args = parseArgs(process.argv.slice(3))
  const service = new GroupLinkService(prisma)

  const jid = args.jid
  if (!jid) {
    console.error('Wajib: --jid=123456789-123456789@g.us')
    console.error('')
    console.error('Cara mencari JID grup:')
    console.error('  1. Jalankan "pnpm osda group:pending" setelah ada pesan di grup.')
    console.error('  2. JID grup muncul di sana.')
    await prisma.$disconnect()
    process.exit(1)
  }

  const kunciOrg = args.org
  if (!kunciOrg) {
    console.error('Wajib: --org=<NAMA, SLUG, atau ID>')
    await prisma.$disconnect()
    process.exit(1)
  }

  const org = await cariOrganisasi(kunciOrg)
  if (!org) {
    console.error(`Organisasi "${kunciOrg}" tidak ditemukan. Cek dengan org:list.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  // Subjek diambil dari catatan grup yang belum tertaut supaya operator tidak
  // perlu mengetiknya — tapi kalau tidak ada, biarkan kosong.
  const catatan = await prisma.seenGroup.findUnique({ where: { jid }, select: { subject: true } })

  try {
    const hasil = await service.link({
      organizationId: org.id,
      jid,
      subject: args.subject ?? catatan?.subject ?? null,
      purpose: args.purpose ?? null,
      ...(args.activation ? { activation: args.activation as 'MENTION_OR_REPLY' | 'ALL_MESSAGES' | 'OFF' } : {}),
    })

    console.log(`Grup "${hasil.subject ?? jid}" tertaut ke ${org.name}.`)
    console.log(`  jid: ${hasil.jid}`)
    console.log(`  aktivasi: ${hasil.activation}`)
    console.log('')
    console.log('Cara pakai di grup:')
    console.log('  • Mention bot, atau tulis "osda ..." di awal pesan.')
    console.log('  • Bot membalas semua pesan? Jadikan OFF:')
    console.log(`      pnpm osda group:activation --jid=${jid} --mode=OFF`)
  } catch (error) {
    if (error instanceof GroupLinkError) {
      console.error(`Gagal menautkan: ${error.message}`)
      await prisma.$disconnect()
      process.exit(1)
    }
    throw error
  }
  await prisma.$disconnect()
})

register('group:activation', 'Ubah kapan bot merespons di grup', async () => {
  const args = parseArgs(process.argv.slice(3))
  const service = new GroupLinkService(prisma)

  const jid = args.jid
  const mode = args.mode
  if (!jid || !mode) {
    console.error('Wajib: --jid=<JID> --mode=MENTION_OR_REPLY|ALL_MESSAGES|OFF')
    console.log('')
    console.log('  MENTION_OR_REPLY  Bot hanya merespons kalau disebut atau di-mention (default)')
    console.log('  ALL_MESSAGES      Bot merespons SEMUA pesan (boros token, mengganggu)')
    console.log('  OFF               Bot tidak pernah merespons otomatis')
    await prisma.$disconnect()
    process.exit(1)
  }

  try {
    const hasil = await service.setActivation(jid, mode as 'MENTION_OR_REPLY' | 'ALL_MESSAGES' | 'OFF')
    console.log(`Aktivasi grup ${hasil.jid} diubah ke ${hasil.activation}.`)
  } catch (error) {
    if (error instanceof GroupLinkError) {
      console.error(`Gagal: ${error.message}`)
      await prisma.$disconnect()
      process.exit(1)
    }
    throw error
  }
  await prisma.$disconnect()
})

register('group:unlink', 'Lepas tautan grup (riwayat tidak ikut terhapus)', async () => {
  const args = parseArgs(process.argv.slice(3))
  const service = new GroupLinkService(prisma)

  const jid = args.jid
  if (!jid) {
    console.error('Wajib: --jid=<JID>')
    await prisma.$disconnect()
    process.exit(1)
  }

  try {
    await service.unlink(jid)
    console.log(`Tautan grup ${jid} dilepas.`)
    console.log('Data kehadiran dan pengingat di grup itu TIDAK dihapus.')
  } catch (error) {
    if (error instanceof GroupLinkError) {
      console.error(`Gagal: ${error.message}`)
      await prisma.$disconnect()
      process.exit(1)
    }
    throw error
  }
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

  // Argumen bebas setelah nama perintah, untuk perintah yang butuh penjelasan
  // bebas — mis. `safe-mode:on bot mengirim dokumen ke grup yang salah`.
  argumenBebas = process.argv.slice(3)

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