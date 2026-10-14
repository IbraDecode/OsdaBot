/**
 * Test outbox.
 *
 * Fokusnya: event yang tidak boleh hilang, dan pengiriman yang tidak boleh
 * dobel.
 *
 * Ujian terpenting di sini: `unknown` TIDAK BOLEH di-retry. Kalau iya,
 * penerima bisa mendapat pesan yang sama dua kali — dan untuk pengumuman
 * organisasi itu tidak bisa diterima.
 */
import { describe, expect, it } from 'vitest'
import { OutboxDispatcher, OutboxWriter, type DispatchResult } from '../../src/outbox/dispatcher.js'
import { mapDeliveryStatus } from '../../src/outbox/handlers.js'

// ── Test double ─────────────────────────────────────────────────────────────

type Event = {
  id: string
  organizationId: string | null
  topic: string
  payload: unknown
  status: string
  attempts: number
  availableAt: Date
  processedAt: Date | null
  lastError: string | null
}

function buatPrismaPalsu() {
  const events: Event[] = []
  let counter = 0

  const prisma = {
    outboxEvent: {
      create: async ({ data }: { data: any }) => {
        counter += 1
        const baru: Event = {
          id: `ev-${counter}`,
          organizationId: null,
          topic: 'test',
          payload: {},
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
          processedAt: null,
          lastError: null,
          ...data,
        }
        events.push(baru)
        return { id: baru.id }
      },
      findMany: async ({ where }: { where: any }) => {
        return events
          .filter((e) => {
            if (where.status === 'PENDING' && e.status !== 'PENDING') return false
            if (where.status?.in && !where.status.in.includes(e.status)) return false
            if (where.availableAt?.lte && e.availableAt > where.availableAt.lte) return false
            return true
          })
          .map((e) => ({ ...e }))
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const target = events.find((e) => e.id === where.id)!
        for (const [k, v] of Object.entries(data)) {
          ;(target as any)[k] = v && typeof v === 'object' && 'increment' in v
            ? ((target as any)[k] ?? 0) + v.increment
            : v
        }
        return target
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        let count = 0
        for (const e of events) {
          if (where.id && e.id !== where.id) continue
          if (where.status === 'PENDING' && e.status !== 'PENDING') continue
          if (where.status === 'SENDING' && e.status !== 'SENDING') continue
          if (where.availableAt?.lte && e.availableAt > where.availableAt.lte) continue
          for (const [k, v] of Object.entries(data)) {
            ;(e as any)[k] = v && typeof v === 'object' && 'increment' in v
              ? ((e as any)[k] ?? 0) + v.increment
              : v
          }
          count += 1
        }
        return { count }
      },
    },
  }

  return { prisma, events }
}

function dispatcherDengan(handler: { topic: string; handle: (e: any) => Promise<DispatchResult> }) {
  const dibuat = buatPrismaPalsu()
  const dispatcher = new OutboxDispatcher(dibuat.prisma as never)
  dispatcher.register(handler as never)
  return { ...dibuat, dispatcher }
}

/** Tulis event lewat OutboxWriter, persis seperti jalur produksi. */
async function seed(prisma: never, data: Partial<Event>): Promise<string> {
  return new OutboxWriter(prisma).emit({
    organizationId: null,
    topic: 'test',
    payload: {},
    ...data,
  })
}

// ── Pemetaan status ─────────────────────────────────────────────────────────

describe('mapDeliveryStatus', () => {
  it('menyelesaikan event yang benar-benar terkirim', () => {
    expect(mapDeliveryStatus('delivered').outcome).toBe('delivered')
    expect(mapDeliveryStatus('provider_accepted').outcome).toBe('accepted')
  })

  it('MENYATAKAN gagal HANYA jika provider menyatakan gagal', () => {
    // `failed` berarti provider menolak — aman mengirim ulang.
    expect(mapDeliveryStatus('failed', 'UNKNOWN').outcome).toBe('failed')
  })

  it('TIDAK menyatakan gagal untuk status yang tidak pasti', () => {
    // Ini inti dari seluruh modul.
    //
    // `unknown` = timeout lalu proses mati. Pesan MUNGKIN sudah terkirim.
    // Kalau dipetakan jadi `failed`, dispatcher akan mengirim ulang dan
    // penerima bisa mendapat pesan yang sama dua kali.
    for (const status of ['unknown', 'pending', 'sending', 'apapun_lain']) {
      expect(mapDeliveryStatus(status).outcome, status).toBe('unknown')
    }
  })
})

// ── OutboxWriter ────────────────────────────────────────────────────────────

describe('OutboxWriter', () => {
  it('menulis event PENDING', async () => {
    const { prisma, events } = buatPrismaPalsu()
    const id = await new OutboxWriter(prisma as never).emit({
      organizationId: 'org-1',
      topic: 'test',
      payload: { a: 1 },
    })

    expect(events).toHaveLength(1)
    expect(events[0]!.status).toBe('PENDING')
    expect(events[0]!.id).toBe(id)
  })
})

// ── Dispatcher ──────────────────────────────────────────────────────────────

describe('OutboxDispatcher', () => {
  it('memproses event yang waktunya tiba', async () => {
    const { dispatcher, events, prisma } = dispatcherDengan({
      topic: 'test',
      handle: async () => ({ outcome: 'delivered' }),
    })
    await seed(prisma as never, { availableAt: new Date(Date.now() - 1000) })

    const hasil = await dispatcher.tick(new Date())

    expect(hasil.diproses).toBe(1)
    expect(hasil.terkirim).toBe(1)
    expect(events[0]!.status).toBe('DELIVERED')
  })

  it('TIDAK memproses event yang belum waktunya', async () => {
    const { dispatcher, events, prisma } = dispatcherDengan({
      topic: 'test',
      handle: async () => ({ outcome: 'delivered' }),
    })
    await seed(prisma as never, { availableAt: new Date(Date.now() + 3_600_000) })

    expect((await dispatcher.tick(new Date())).diproses).toBe(0)
  })

  it('HANYA satu dispatcher bisa mengambil satu event', async () => {
    let dipanggil = 0
    const { dispatcher, events, prisma } = dispatcherDengan({
      topic: 'test',
      handle: async () => {
        dipanggil += 1
        return { outcome: 'delivered' }
      },
    })
    await seed(prisma as never, { availableAt: new Date(Date.now() - 1000) })

    await dispatcher.tick(new Date())
    await dispatcher.tick(new Date())

    expect(dipanggil).toBe(1)
  })

  it('BUG REGRESSION: hasil TIDAK DIKETAHUI tidak pernah di-retry', async () => {
    // Kalau `unknown` dipetakan jadi gagal atau langsung dikirim ulang,
    // orang bisa menerima pesan yang sama dua kali.
    const { dispatcher, events, prisma } = dispatcherDengan({
      topic: 'test',
      handle: async () => ({ outcome: 'unknown', detail: 'timeout lalu proses mati' }),
    })
    await seed(prisma as never, { availableAt: new Date(Date.now() - 1000) })

    const hasil = await dispatcher.tick(new Date())

    expect(hasil.unknown).toBe(1)
    expect(hasil.gagal).toBe(0)
    expect(hasil.terkirim).toBe(0)
    expect(events[0]!.status).toBe('UNKNOWN')
    // Tidak masuk jadwal retry.
    expect(events[0]!.status).not.toBe('PENDING')
  })

  it('mengganti handler yang melempar error menjadi retry', async () => {
    const { dispatcher, events, prisma } = dispatcherDengan({
      topic: 'test',
      handle: async () => {
        throw new Error('koneksi putus')
      },
    })
    await seed(prisma as never, { availableAt: new Date(Date.now() - 1000) })

    const hasil = await dispatcher.tick(new Date())

    expect(hasil.gagal).toBe(1)
    expect(events[0]!.status).toBe('PENDING')
    // Dijadwalkan ulang dengan jeda, bukan langsung dicoba.
    expect(events[0]!.availableAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('menyerah setelah batas percobaan dan TIDAK menghapus event', async () => {
    const { dispatcher, events, prisma } = dispatcherDengan({
      topic: 'test',
      handle: async () => ({ outcome: 'failed', error: 'selalu gagal' }),
    })
    await seed(prisma as never, { availableAt: new Date(Date.now() - 1000) })
    events[0]!.attempts = 5

    await dispatcher.tick(new Date())

    expect(events[0]!.status).toBe('FAILED')
    // Masih ada supaya bisa diperiksa.
    expect(events).toHaveLength(1)
  })

  it('TIDAK membuang event untuk topik tanpa handler', async () => {
    // Kalau di-drop, event hilang. Kalau langsung FAIL, masalahnya
    // tersembunyi di antara event lain yang gagal.
    const { dispatcher, events, prisma } = dispatcherDengan({
      topic: 'test',
      handle: async () => ({ outcome: 'delivered' }),
    })
    await seed(prisma as never, { topic: 'tidak.ada.handler' })

    const hasil = await dispatcher.tick(new Date())

    expect(hasil.tanpaHandler).toBe(1)
    expect(events[0]!.status).toBe('PENDING')
    expect(events[0]!.lastError).toContain("Tidak ada handler")
  })

  it('MENOLAK handler ganda untuk topik yang sama', () => {
    const { prisma } = buatPrismaPalsu()
    const dispatcher = new OutboxDispatcher(prisma as never)
    dispatcher.register({ topic: 'a', handle: async () => ({ outcome: 'delivered' }) })

    expect(() =>
      dispatcher.register({ topic: 'a', handle: async () => ({ outcome: 'delivered' }) }),
    ).toThrow(/sudah terdaftar/)
  })
})

describe('OutboxDispatcher.recoverStuckSending', () => {
  it('MEMINDAHKAN event SENDING yang lease-nya habis ke UNKNOWN', async () => {
    // Event SENDING berarti proses mati saat mengirim. Hasilnya tidak
    // diketahui — harus direkonsiliasi, BUKAN dikirim ulang.
    const { prisma, events } = buatPrismaPalsu()
    events.push({
      id: 'ev-stuck',
      organizationId: null,
      topic: 'test',
      payload: {},
      status: 'SENDING',
      attempts: 1,
      availableAt: new Date(Date.now() - 60_000),
      processedAt: null,
      lastError: null,
    })

    const dispatcher = new OutboxDispatcher(prisma as never)
    const jumlah = await dispatcher.recoverStuckSending(new Date())

    expect(jumlah).toBe(1)
    expect(events[0]!.status).toBe('UNKNOWN')
  })

  it('TIDAK menyentuh event SENDING yang lease-nya masih berlaku', async () => {
    const { prisma, events } = buatPrismaPalsu()
    events.push({
      id: 'ev-aktif',
      organizationId: null,
      topic: 'test',
      payload: {},
      status: 'SENDING',
      attempts: 1,
      availableAt: new Date(Date.now() + 300_000),
      processedAt: null,
      lastError: null,
    })

    const dispatcher = new OutboxDispatcher(prisma as never)

    expect(await dispatcher.recoverStuckSending(new Date())).toBe(0)
    expect(events[0]!.status).toBe('SENDING')
  })
})

describe('OutboxDispatcher.needReconciliation', () => {
  it('mengumpulkan event UNKNOWN dan FAILED', async () => {
    const { prisma, events } = buatPrismaPalsu()
    events.push(
      {
        id: 'u1', organizationId: null, topic: 'test', payload: {},
        status: 'UNKNOWN', attempts: 1, availableAt: new Date(), processedAt: new Date(), lastError: 'x',
      },
      {
        id: 'f1', organizationId: null, topic: 'test', payload: {},
        status: 'FAILED', attempts: 5, availableAt: new Date(), processedAt: new Date(), lastError: 'y',
      },
      {
        id: 'ok1', organizationId: null, topic: 'test', payload: {},
        status: 'DELIVERED', attempts: 1, availableAt: new Date(), processedAt: new Date(), lastError: null,
      },
    )

    const dispatcher = new OutboxDispatcher(prisma as never)
    const daftar = await dispatcher.needReconciliation()

    const id = daftar.map((d) => d.id).sort()
    expect(id).toEqual(['f1', 'u1'])
  })
})