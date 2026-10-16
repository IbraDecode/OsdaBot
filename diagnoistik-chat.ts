/**
 * Diagnostik percakapan nyata.
 *
 * Satu perintah untuk melihat apa yang SEBENARNYA terjadi: pesan masuk, tool
 * yang dipanggil, dan di mana agent tersendat kalau memang tersendat.
 *
 * Jalankan: pnpm exec tsx --env-file-if-exists=.env diagnoistik-chat.ts [menit]
 */
import { PrismaClient } from '@prisma/client'
import { MessageHandler } from './src/pipeline/message-handler.js'

const prisma = new PrismaClient()

const menit = Number(process.argv[2] ?? '60')
const sejak = new Date(Date.now() - menit * 60 * 1000)

const ORG = await prisma.organization.findFirst({
  where: { slug: 'osis-smkn-2-mataram' },
  select: { id: true, name: true },
})

console.log('')
console.log(`=== ${menit} menit terakhir · ${ORG?.name ?? 'organisasi tidak ditemukan'} ===`)
console.log('')

const percakapan = await prisma.conversation.findMany({
  where: { ...(ORG ? { OR: [{ organizationId: ORG.id }, { chatJid: { contains: '6285' } }] } : {}) },
  orderBy: { lastMessageAt: 'desc' },
  take: 5,
  select: { id: true, chatJid: true, chatType: true, lastMessageAt: true },
})

console.log('PERCAKAPAN DITEMUKAN')
for (const p of percakapan) {
  const pesan = await prisma.message.count({ where: { conversationId: p.id, createdAt: { gte: sejak } } })
  console.log(`  ${p.chatJid} (${p.chatType}) — ${pesan} pesan dalam jendela`)
}
console.log('')

const pesanMasuk = await prisma.message.findMany({
  where: {
    createdAt: { gte: sejak },
    ...(ORG ? { conversation: { OR: [{ organizationId: ORG.id }, { chatJid: { contains: '6285' } }] } } : {}),
    NOT: { senderJid: 'me' },
  },
  orderBy: { createdAt: 'asc' },
  select: { createdAt: true, senderJid: true, text: true, conversation: { select: { chatJid: true } } },
})

console.log(`PESAN MASUK (${pesanMasuk.length})`)
for (const m of pesanMasuk) {
  console.log(`  ${m.createdAt.toISOString().slice(11, 19)}  ${m.senderJid}`)
  console.log(`      "${(m.text ?? '(tanpa teks)').slice(0, 150)}"`)
}
console.log('')

const jalan = await prisma.agentTask.findMany({
  where: { createdAt: { gte: sejak }, ...(ORG ? { organizationId: ORG.id } : {}) },
  orderBy: { createdAt: 'asc' },
  select: {
    createdAt: true,
    errorCode: true,
    status: true,
    state: true,
    steps: { orderBy: { ordinal: 'asc' }, select: { ordinal: true, toolName: true, description: true, status: true, error: true } },
    executions: { orderBy: { createdAt: 'asc' }, select: { toolName: true, outcome: true, errorCode: true, durationMs: true } },
  },
})

console.log(`JALAN AGENT (${jalan.length})`)
for (const j of jalan) {
  const state = (j.state ?? {}) as { chatJid?: string; durasiMs?: number; availableTools?: string[] }
  const status = j.errorCode ?? 'JAWABAN_FINAL'
  const tanda = j.errorCode === 'JAWABAN_FINAL' ? ' ' : '!'
  console.log('')
  console.log(`  ${tanda} ${j.createdAt.toISOString().slice(11, 19)}  ${status}  ${state.durasiMs ?? 0}ms  dari ${state.chatJid ?? '?'}`)
  console.log(`      tool tersedia: ${state.availableTools?.length ?? 0}`)
  for (const e of j.executions) {
    const ok = e.outcome === 'success'
    console.log(`      ${ok ? '+' : '!'} ${e.toolName}${ok ? '' : ` — ${e.errorCode ?? e.outcome}`} (${e.durationMs ?? 0}ms)`)
  }
  if (j.steps.length > 0) {
    console.log(`      langkah: ${j.steps.map((s) => s.toolName ?? 'jawaban').join(' → ')}`)
  }
}
console.log('')

const tanpaTool = jalan.filter((j) => j.executions.length === 0).length
console.log(`RINGKASAN: ${jalan.length} jalan · ${jalan.length - tanpaTool} memanggil tool · ${tanpaTool} tanpa tool`)

const gagal = jalan.flatMap((j) => j.executions.filter((e) => e.outcome !== 'success'))
if (gagal.length > 0) {
  console.log('')
  console.log('TOOL YANG GAGAL:')
  const hitung = new Map<string, number>()
  for (const g of gagal) {
    const kunci = `${g.toolName} ${g.errorCode ?? g.outcome}`
    hitung.set(kunci, (hitung.get(kunci) ?? 0) + 1)
  }
  for (const [kunci, n] of hitung) console.log(`  ${n}× ${kunci}`)
}

await prisma.$disconnect()
process.exit(0)