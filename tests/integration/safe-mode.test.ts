/**
 * Uji integrasi mode aman — tombol darurat operasional.
 *
 * Yang diuji bukan "flag-nya bisa disimpan", tapi **betapa-bot berhenti**.
 * Mode aman yang hanya mencatat kejadian tanpa menahan apa pun adalah
 * dokumentasi yang salah, bukan kendali.
 *
 * Yang harus terbukti di sini:
 *  - tool tidak jalan
 *  - pesan keluar tidak terkirim
 *  - pesan yang SUDAH antre di outbox tidak terkirim
 *  - approval yang sudah disetujui tidak dieksekusi
 *  - pesan masuk tetap tercatat (bukti insiden tidak hilang)
 *  - flag bertahan melewati "restart"
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { SafeModeService, FLAG_SAFE_MODE } from '../../src/system/safe-mode.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { WhatsAppOutboxHandler } from '../../src/outbox/handlers.js'
import { TOPICS } from '../../src/outbox/dispatcher.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'

const safeMode = new SafeModeService(prisma)

/** Berapa kali `sendText` dipanggil. */
let terkirim: Array<{ chatJid: string; text: string }> = []

/** Berapa kali tool dummy dijalankan. */
let toolDipanggil = 0

const whatsappTiruan = {
  sendText: async (chatJid: string, text: string) => {
    terkirim.push({ chatJid, text })
    return { status: 'provider_accepted' as const, providerMessageId: 'uji' }
  },
} as never

afterAll(async () => {
  await prisma.systemFlag.deleteMany({ where: { key: FLAG_SAFE_MODE } })
  await prisma.auditLog.deleteMany({ where: { action: 'system.safe_mode.blocked' } })
  await prisma.$disconnect()
})

beforeEach(async () => {
  await safeMode.set({ enabled: false, changedBy: 'uji' })
  await prisma.auditLog.deleteMany({ where: { action: 'system.safe_mode.blocked' } })
  terkirim = []
  toolDipanggil = 0
})

/** Registry dengan satu tool yang mencatat bahwa dia dipanggil. */
function registryDenganGerbang() {
  const registry = new ToolRegistry({ prisma: prisma as never, safeMode })
  registry.register({
    name: 'uji_hitung',
    description: 'Tool uji yang mencatat pemanggilannya.',
    inputSchema: z.object({}).strict() as never,
    requiredPermissions: [],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute() {
      toolDipanggil += 1
      return { success: true as const, data: { jalan: true } }
    },
  } as never)
  return registry
}

const konteks = {
  actorUserId: AKTOR,
  organizationId: ORG,
  conversationId: null,
  taskId: null,
  chatJid: '6280000000000@s.whatsapp.net',
  senderJid: '6280000000000@s.whatsapp.net',
  correlationId: 'uji',
  timezone: 'Asia/Makassar',
  authorization: {} as never,
}

describe('menyimpan dan membaca flag', () => {
  it('default-nya mati kalau belum pernah diset', async () => {
    await prisma.systemFlag.deleteMany({ where: { key: FLAG_SAFE_MODE } })

    const status = await safeMode.snapshot()
    expect(status.enabled).toBe(false)
    expect(await safeMode.aktif()).toBe(false)
  })

  it('BUG REGRESSION: flag BERTAHAN melewati restart', async () => {
    await prisma.systemFlag.deleteMany({ where: { key: FLAG_SAFE_MODE } })

    await safeMode.set({ enabled: true, reason: 'insiden', changedBy: 'operator' })

    // Simulasi restart: layanan BARU tanpa cache sama sekali. Kalau flag
    // hanya hidup di memori, layanan baru ini akan mengira sistem normal dan
    // mengulang kesalahan yang sama persis.
    const setelahRestart = new SafeModeService(prisma)
    const status = await setelahRestart.aktif()

    expect(status).toBe(true)
    const snapshot = await setelahRestart.snapshot()
    expect(snapshot.reason).toBe('insiden')
    expect(snapshot.changedBy).toBe('operator')
  })

  it('BUG REGRESSION: penyalaan langsung berlaku tanpa menunggu cache', async () => {
    // Skenario nyata: bot sedang memproses pesan, operator menyalakan mode
    // aman dari terminal lain. Tool call berikutnya di percakapan itu harus
    // sudah tertahan.
    //
    // Kalau cache baru berubah setelah commit ke database, ada jendela
    // beberapa detik di mana tombol darurat diam-diam tidak berefek — dan
    // jendela itulah yang jadi insiden.
    const registry = registryDenganGerbang()

    await registry.execute('uji_hitung', {}, konteks)
    expect(toolDipanggil).toBe(1)

    await safeMode.set({ enabled: true, changedBy: 'operator' })

    const hasil = await registry.execute('uji_hitung', {}, konteks)
    expect(toolDipanggil).toBe(1)
    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      expect(hasil.error.code).toBe('SAFE_MODE')
      // Tidak retryable: mencoba lagi tidak akan pernah berhasil sampai
      // operator mengubahnya, dan membuat model mengulang percobaan hanya
      // membuang waktu dan token.
      expect(hasil.error.retryable).toBe(false)
    }
  })
})

describe('menahan tindakan', () => {
  it('BUG REGRESSION: tool TIDAK jalan saat mode aman aktif', async () => {
    const registry = registryDenganGerbang()
    await safeMode.set({ enabled: true })

    await registry.execute('uji_hitung', {}, konteks)
    expect(toolDipanggil).toBe(0)
  })

  it('BUG REGRESSION: pesan keluar TIDAK terkirim dari outbox', async () => {
    await safeMode.set({ enabled: true })
    const handler = new WhatsAppOutboxHandler({
      prisma: prisma as never,
      whatsapp: whatsappTiruan,
      safeMode,
    })

    const hasil = await handler.handle({
      id: 'evt-uji',
      organizationId: ORG,
      payload: { chatJid: '6280000000000@s.whatsapp.net', text: 'halo' },
    })

    expect(terkirim).toHaveLength(0)
    expect(hasil.outcome).toBe('failed')
  })

  it('BUG REGRESSION: pesan yang SUDAH antre ikut tertahan', async () => {
    // Outbox decoupling pengirim dan penerima. Pesan bisa masuk antrean saat
    // bot masih normal, lalu dikirim berjam-jam kemudian — termasuk tepat
    // setelah operator menyalakan mode aman.
    //
    // Kalau gerbang hanya ada di jalur pesan masuk, antrean yang sudah jadi
    // akan tetap terkirim. Itu kegagalan yang lebih buruk daripada tidak
    // punya mode aman: operator mengira sudah aman.
    const antrean = await prisma.outboxEvent.create({
      data: {
        topic: TOPICS.WHATSAPP_MESSAGE,
        organizationId: ORG,
        payload: { chatJid: '6280000000000@s.whatsapp.net', text: 'pesan antrean' },
      },
      select: { id: true },
    })

    const handler = new WhatsAppOutboxHandler({
      prisma: prisma as never,
      whatsapp: whatsappTiruan,
      safeMode,
    })
    await safeMode.set({ enabled: true })

    await handler.handle({
      id: antrean.id,
      organizationId: ORG,
      payload: { chatJid: '6280000000000@s.whatsapp.net', text: 'pesan antrean' },
    })

    expect(terkirim).toHaveLength(0)
    await prisma.outboxEvent.delete({ where: { id: antrean.id } })
  })

  it('BUG REGRESSION: normal, pesan outbox tetap terkirim', async () => {
    const handler = new WhatsAppOutboxHandler({
      prisma: prisma as never,
      whatsapp: whatsappTiruan,
      safeMode,
    })

    const hasil = await handler.handle({
      id: 'evt-uji',
      organizationId: ORG,
      payload: { chatJid: '6280000000000@s.whatsapp.net', text: 'halo' },
    })

    expect(terkirim).toHaveLength(1)
    expect(hasil.outcome).toBe('accepted')
  })
})

describe('bukti bahwa mode aman bekerja', () => {
  it('BUG REGRESSION: kejadian yang diblokir tercatat di audit trail', async () => {
    // Tanpa catatan, "bot diam" dan "bot mati" tidak bisa dibedakan — dan
    // itulah persis kebingungan yang muncul saat insiden.
    const registry = registryDenganGerbang()
    await safeMode.set({ enabled: true })
    await registry.execute('uji_hitung', {}, konteks)

    const jejak = await prisma.auditLog.findMany({
      where: { action: 'system.safe_mode.blocked' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    expect(jejak).toHaveLength(1)
    expect(jejak[0]!.outcome).toBe('blocked')
    expect(jejak[0]!.reasonCode).toBe('SAFE_MODE_ON')
  })

  it('BUG REGRESSION: jejak tidak menyimpan isi pesan', async () => {
    // AuditLog adalah tempat yang dibaca banyak orang. Isi pesan bisa berisi
    // data pribadi anggota — dan ini bukan tempatnya.
    const handler = new WhatsAppOutboxHandler({
      prisma: prisma as never,
      whatsapp: whatsappTiruan,
      safeMode,
    })
    await safeMode.set({ enabled: true })

    const rahasia = 'RAHASIA-Tidak-Boleh-Tercatat-12345'
    await handler.handle({
      id: 'evt-uji',
      organizationId: ORG,
      payload: { chatJid: '6280000000000@s.whatsapp.net', text: rahasia },
    })

    const jejak = await prisma.auditLog.findMany({
      where: { action: 'system.safe_mode.blocked' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    expect(JSON.stringify(jejak[0]?.metadata ?? {})).not.toContain(rahasia)
  })
})

describe('batas mode aman', () => {
  it('BUG REGRESSION: mode aman tidak menyentuh data — hanya menahan tindakan', async () => {
    // Yang ditolak adalah memanggil registry, bukan menulis ke tabel lain.
    // Kalau service ini ikut menyentuh data, mematikan tombol darurat bisa
    // berarti merusak data — dan tombol darurat yang merusak data bukan
    // tombol darurat.
    await safeMode.set({ enabled: true })
    const sebelum = await prisma.task.count({ where: { organizationId: ORG } })

    const registry = registryDenganGerbang()
    await registry.execute('uji_hitung', {}, konteks)

    const sesudah = await prisma.task.count({ where: { organizationId: ORG } })
    expect(sesudah).toBe(sebelum)
  })

  it('menyalaan lalu mematikan mengembalikan sistem ke normal', async () => {
    const registry = registryDenganGerbang()

    await safeMode.set({ enabled: true })
    await registry.execute('uji_hitung', {}, konteks)
    expect(toolDipanggil).toBe(0)

    await safeMode.set({ enabled: false, changedBy: 'operator' })
    await registry.execute('uji_hitung', {}, konteks)
    expect(toolDipanggil).toBe(1)
  })
})