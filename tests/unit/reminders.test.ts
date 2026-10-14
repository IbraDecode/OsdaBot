/**
 * Test pengingat terjadwal.
 *
 * Fokusnya: pengingat yang hilang lebih buruk daripada pengingat yang telat.
 * Test di sini mengunci bahwa tidak ada jalan untuk kehilangan pengingat,
 * dan tidak ada jalan untuk mengirimnya dua kali.
 */
import { describe, expect, it } from 'vitest'
import {
  ReminderService,
  buildIdempotencyKey,
  contohPengingat,
  renderReminder,
} from '../../src/reminders/service.js'
import { ReminderWorker } from '../../src/queue/reminder-worker.js'

const ORG = '11111111-1111-1111-1111-111111111111'
const CHAT = '6281234567890@s.whatsapp.net'

// ── Fungsi murni ────────────────────────────────────────────────────────────

describe('buildIdempotencyKey', () => {
  const dasar = {
    organizationId: ORG,
    chatJid: CHAT,
    title: 'Latihan LKBB',
    body: 'Lapangan sekolah, 16:00.',
    scheduledAt: new Date('2026-10-20T09:00:00.000Z'),
  }

  it('stabil untuk input yang sama', () => {
    expect(buildIdempotencyKey(dasar)).toBe(buildIdempotencyKey(dasar))
  })

  it('berbeda untuk isi berbeda', () => {
    expect(buildIdempotencyKey(dasar)).not.toBe(buildIdempotencyKey({ ...dasar, body: 'Beda' }))
  })

  it('berbeda untuk slot waktu berbeda', () => {
    // Pengingat yang sama di jam berbeda itu dua pengingat berbeda.
    const lain = new Date('2026-10-20T10:00:00.000Z')
    expect(buildIdempotencyKey(dasar)).not.toBe(buildIdempotencyKey({ ...dasar, scheduledAt: lain }))
  })

  it('berbeda untuk organisasi berbeda', () => {
    // Kunci global berarti satu organisasi bisa memblokir pengingat org lain.
    expect(buildIdempotencyKey(dasar)).not.toBe(
      buildIdempotencyKey({ ...dasar, organizationId: '22222222-2222-2222-2222-222222222222' }),
    )
  })

  it('menyamakan slot waktu dalam menit yang sama', () => {
    // Granularitas idempotensi disengaja 1 menit: dua permintaan dengan isi
    // sama dalam semenit dianggap satu. Tanpa itu, perintah yang terkirim
    // ulang karena timeout akan menggandakan pengingat.
    const a = new Date('2026-10-20T09:00:10.000Z')
    const b = new Date('2026-10-20T09:00:50.000Z')
    expect(buildIdempotencyKey({ ...dasar, scheduledAt: a })).toBe(
      buildIdempotencyKey({ ...dasar, scheduledAt: b }),
    )
  })

  it('memisahkan slot menit yang berbeda', () => {
    const a = new Date('2026-10-20T09:00:59.000Z')
    const b = new Date('2026-10-20T09:01:01.000Z')
    expect(buildIdempotencyKey({ ...dasar, scheduledAt: a })).not.toBe(
      buildIdempotencyKey({ ...dasar, scheduledAt: b }),
    )
  })
})

describe('renderReminder', () => {
  it('memuat judul dan isi', () => {
    const teks = renderReminder({ title: 'Latihan', body: '16:00 di lapangan' })
    expect(teks).toContain('Latihan')
    expect(teks).toContain('16:00 di lapangan')
  })
})

// ── Test double Prisma ──────────────────────────────────────────────────────

type Baris = {
  id: string
  organizationId: string | null
  actorUserId: string | null
  type: string
  payload: unknown
  idempotencyKey: string | null
  status: string
  scheduledAt: Date
  startedAt: Date | null
  completedAt: Date | null
  attempts: number
  lastError: string | null
  result: unknown
}

/**
 * Terapkan data seperti Prisma: mendukung `{ increment: n }`.
 *
 * Tanpa ini, `attempts` jadi objek `{ increment: 1 }` dan logika percobaan
 * selalu salah.
 */
function terapkan(target: Baris, data: any): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      ;(target as any)[key] = ((target as any)[key] ?? 0) + value.increment
    } else {
      ;(target as any)[key] = value
    }
  }
}

function buatPrismaPalsu(options: { claimBerhasil?: boolean } = {}) {
  const baris: Baris[] = []
  let counter = 0

  const prisma = {
    scheduledJob: {
      findUnique: async ({ where }: { where: Record<string, any>; select?: Record<string, boolean> }) => {
        // Prisma `findUnique` bisa dipanggil dengan `id` ATAU `idempotencyKey`.
        const found = baris.find((b) =>
          where.id ? b.id === where.id : b.idempotencyKey === where.idempotencyKey,
        )
        if (!found) return null
        // Hormati `select` supaya nilai yang tidak diminta tidak dikembalikan.
        if (!where.select) return found
        const hasil: Record<string, unknown> = {}
        for (const key of Object.keys(where.select)) {
          if (where.select[key]) hasil[key] = (found as any)[key]
        }
        return hasil
      },
      create: async ({ data }: { data: Partial<Baris> }) => {
        counter += 1
        const baru: Baris = {
          id: `job-${counter}`,
          organizationId: null,
          actorUserId: null,
          type: 'reminder.send',
          payload: {},
          idempotencyKey: null,
          status: 'SCHEDULED',
          scheduledAt: new Date(),
          startedAt: null,
          completedAt: null,
          attempts: 0,
          lastError: null,
          result: {},
          ...data,
        } as Baris
        baris.push(baru)
        return { id: baru.id }
      },
      findMany: async ({ where }: { where: Record<string, any> }) => {
        return baris.filter((b) => {
          if (where.status && b.status !== where.status) return false
          if (where.scheduledAt?.lte && b.scheduledAt > where.scheduledAt.lte) return false
          if (where.organizationId && b.organizationId !== where.organizationId) return false
          if (where.scheduledAt?.lte === null) return true
          return true
        })
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const target = baris.find((b) => b.id === where.id)!
        terapkan(target, data)
        return target
      },
      updateMany: async ({ where, data }: { where: Record<string, any>; data: any }) => {
        let count = 0
        for (const b of baris) {
          if (where.id && b.id !== where.id) continue
          if (where.status && b.status !== where.status) continue
          if (where.status === 'RUNNING' && options.claimBerhasil === false) continue
          if (where.organizationId && b.organizationId !== where.organizationId) continue
          terapkan(b, data)
          count += 1
        }
        return { count }
      },
    },
  }

  return { prisma, baris }
}

describe('ReminderService.schedule', () => {
  it('menyimpan pengingat dengan payload lengkap', async () => {
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)

    const hasil = await service.schedule(contohPengingat())

    expect(hasil.deduped).toBe(false)
    expect(baris).toHaveLength(1)
    expect(baris[0]!.status).toBe('SCHEDULED')
    expect(baris[0]!.payload).toMatchObject({ chatJid: CHAT, title: 'Latihan LKBB' })
  })

  it('TIDAK membuat duplikat untuk idempotencyKey yang sama', async () => {
    // Tanpa ini, satu perintah bisa membuat puluhan pengingat identik.
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    const input = contohPengingat()

    const pertama = await service.schedule(input)
    const kedua = await service.schedule(input)

    expect(kedua.deduped).toBe(true)
    expect(kedua.id).toBe(pertama.id)
    expect(baris).toHaveLength(1)
  })
})

describe('ReminderService.claimDue', () => {
  it('mengambil job yang waktunya sudah lewat', async () => {
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() - 1000) })

    const jobs = await service.claimDue(new Date())

    expect(jobs).toHaveLength(1)
    expect(baris[0]!.status).toBe('RUNNING')
    expect(baris[0]!.attempts).toBe(1)
  })

  it('TIDAK mengambil job yang belum waktunya', async () => {
    const { prisma } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() + 3_600_000) })

    expect(await service.claimDue(new Date())).toHaveLength(0)
  })

  it('HANYA satu worker bisa mengklaim satu job', async () => {
    // Dua worker mengambil job yang sama = pengingat terkirim dua kali.
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() - 1000) })

    const pertama = await service.claimDue(new Date())
    const kedua = await service.claimDue(new Date())

    expect(pertama).toHaveLength(1)
    expect(kedua).toHaveLength(0)
    expect(baris[0]!.attempts).toBe(1)
  })

  it('MEMBATAL pengingat yang terlalu basi', async () => {
    // Pengingat basi lebih buruk daripada tidak ada — penerima tidak tahu
    // itu untuk acara yang sudah lewat.
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() - 60 * 60_000) })

    const jobs = await service.claimDue(new Date())

    expect(jobs).toHaveLength(0)
    expect(baris[0]!.status).toBe('FAILED')
    expect(baris[0]!.lastError).toContain('kesabaran')
  })
})

describe('ReminderService.fail', () => {
  it('mengembalikan job ke SCHEDULED kalau belum habis percobaan', async () => {
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() - 1000) })
    await service.claimDue(new Date())

    const giveUp = await service.fail(baris[0]!.id, 'gagal sementara', 3)

    expect(giveUp).toBe(false)
    expect(baris[0]!.status).toBe('SCHEDULED')
  })

  it('menyerah setelah percobaan habis', async () => {
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() - 1000) })
    await service.claimDue(new Date())
    baris[0]!.attempts = 3

    const giveUp = await service.fail(baris[0]!.id, 'gagal terus', 3)

    expect(giveUp).toBe(true)
    expect(baris[0]!.status).toBe('FAILED')
  })
})

describe('ReminderService.cancel', () => {
  it('membatalkan pengingat terjadwal', async () => {
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() + 3_600_000) })

    expect(await service.cancel(baris[0]!.id)).toBe(true)
    expect(baris[0]!.status).toBe('CANCELLED')
  })

  it('TIDAK membatalkan job yang sedang berjalan', async () => {
    // Membatalkan yang sedang dikirim = hasil yang ambigu.
    const { prisma, baris } = buatPrismaPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({ ...contohPengingat(), scheduledAt: new Date(Date.now() - 1000) })
    await service.claimDue(new Date())

    expect(await service.cancel(baris[0]!.id)).toBe(false)
    expect(baris[0]!.status).toBe('RUNNING')
  })
})

// ── Worker ──────────────────────────────────────────────────────────────────

function buatWhatsAppPalsu(status: 'sent' | 'delivered' | 'failed' = 'delivered') {
  const terkirim: Array<{ to: string; text: string }> = []
  return {
    terkirim,
    whatsapp: {
      sendText: async (to: string, text: string) => {
        terkirim.push({ to, text })
        return {
          status,
          providerMessageId: 'msg-1',
          ...(status === 'failed' ? { errorCode: 'UNKNOWN' } : {}),
        }
      },
    } as never,
  }
}

describe('ReminderWorker.tick', () => {
  it('mengirim pengingat yang jatuh tempo', async () => {
    const { prisma } = buatPrismaPalsu()
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({
      ...contohPengingat(),
      organizationId: ORG,
      scheduledAt: new Date(Date.now() - 1000),
    })

    const worker = new ReminderWorker({ prisma: prisma as never, whatsapp })
    const hasil = await worker.tick(new Date())

    expect(hasil.dikirim).toBe(1)
    expect(terkirim).toHaveLength(1)
    expect(terkirim[0]!.to).toBe(CHAT)
    expect(terkirim[0]!.text).toContain('Latihan LKBB')
  })

  it('TIDAK menandai selesai kalau pengiriman gagal', async () => {
    // Kalau `failed` dicatat COMPLETED, pengingat hilang selamanya tanpa
    // pernah sampai ke penerima.
    const { prisma, baris } = buatPrismaPalsu()
    const { whatsapp } = buatWhatsAppPalsu('failed')
    const service = new ReminderService(prisma as never)
    await service.schedule({
      ...contohPengingat(),
      organizationId: ORG,
      scheduledAt: new Date(Date.now() - 1000),
    })

    const worker = new ReminderWorker({ prisma: prisma as never, whatsapp })
    const hasil = await worker.tick(new Date())

    expect(hasil.dikirim).toBe(0)
    expect(hasil.gagal).toBe(1)
    expect(baris[0]!.status).not.toBe('COMPLETED')
    expect(baris[0]!.lastError).toContain('gagal')
  })

  it('menandai selesai setelah terkirim', async () => {
    const { prisma, baris } = buatPrismaPalsu()
    const { whatsapp } = buatWhatsAppPalsu()
    const service = new ReminderService(prisma as never)
    await service.schedule({
      ...contohPengingat(),
      organizationId: ORG,
      scheduledAt: new Date(Date.now() - 1000),
    })

    await new ReminderWorker({ prisma: prisma as never, whatsapp }).tick(new Date())

    expect(baris[0]!.status).toBe('COMPLETED')
    expect(baris[0]!.result).toMatchObject({ status: 'delivered' })
  })

  it('MELEWATI pengingat tanpa chatJid', async () => {
    // Mengirim tanpa tujuan hanya menghasilkan error berulang.
    const { prisma, baris } = buatPrismaPalsu()
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const service = new ReminderService(prisma as never)
    const hasil = await service.schedule({
      ...contohPengingat(),
      organizationId: ORG,
      scheduledAt: new Date(Date.now() - 1000),
    })

    // Buang chatJid dari payload.
    baris[0]!.payload = { title: 'Tanpa tujuan', body: 'x' }

    const worker = new ReminderWorker({ prisma: prisma as never, whatsapp })
    const ringkasan = await worker.tick(new Date())

    expect(hasil.deduped).toBe(false)
    expect(ringkasan.dilewati).toBe(1)
    expect(terkirim).toHaveLength(0)
    expect(baris[0]!.lastError).toContain('chatJid')
  })

  it('TIDAK mengirim pengingat yang belum waktunya', async () => {
    const { prisma } = buatPrismaPalsu()
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    await new ReminderService(prisma as never).schedule({
      ...contohPengingat(),
      organizationId: ORG,
      scheduledAt: new Date(Date.now() + 3_600_000),
    })

    const hasil = await new ReminderWorker({ prisma: prisma as never, whatsapp }).tick(new Date())

    expect(hasil.dikirim).toBe(0)
    expect(terkirim).toHaveLength(0)
  })
})