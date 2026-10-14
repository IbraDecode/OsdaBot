/**
 * Outbox — pola untuk event yang tidak boleh hilang.
 *
 * ── Masalah yang dipecahkan ────────────────────────────────────────────────
 *
 * Event yang dibuat di luar tabel pengirim punya dua kemungkinan buruk:
 *
 *   1. Tulis event dulu, kirim setelahnya. Kalau proses mati di tengah,
 *      event hilang selamanya.
 *   2. Kirim dulu, tulis event setelahnya. Kalau proses mati di antara
 *      keduanya, pesan terkirim tapi tidak tercatat.
 *
 * Di kedua kasus, tidak ada yang bisa menjawab "apakah ini sudah terkirim?".
 *
 * Polanya: tulis event **di dalam transaksi yang sama** dengan perubahan
 * bisnis. Kalau transaksinya commit, event-nya pasti ada. Kalau rollback,
 * event-nya juga tidak ada. Tidak ada celah di antaranya.
 *
 * Dispatcher terpisah yang mengambil event itu dan mengirimkannya.
 *
 * ── Yang paling penting: status `unknown` ──────────────────────────────────
 *
 * `DeliveryStatus` punya nilai `UNKNOWN` dengan peringatan:
 *
 *     "WAJIB direkonsiliasi sebelum retry — jangan diasumsikan gagal."
 *
 * `unknown` berarti timeout lalu proses mati. Pesan **mungkin sudah terkirim**.
 * Mengirim ulang tanpa rekonsiliasi berarti pengguna bisa menerima pesan yang
 * sama dua kali — dan untuk pengumuman organisasi itu tidak bisa diterima.
 *
 * Jadi `unknown` TIDAK pernah di-retry otomatis di sini. Ia masuk daftar yang
 * perlu diperiksa manusia.
 */
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'outbox' })

/** Berapa kali percobaan sebelum menyerah. */
const MAX_ATTEMPTS = 5

/** Jeda dasar untuk retry, dalam milidetik. */
const DASAR_BACKOFF_MS = 30_000

/** Batas atas backoff. */
const MAKS_BACKOFF_MS = 60 * 60 * 1000

/** Batas jumlah event per siklus. */
const MAX_BATCH = 100

/**
 * Masa berlaku klaim (lease), dalam milidetik.
 *
 * `OutboxEvent` tidak punya kolom `updatedAt`, jadi tidak ada cara tahu kapan
 * sebuah event terakhir disentuh. Sebagai gantinya, `availableAt` dipakai
 * sebagai **lease**: saat event diklaim, `availableAt` diset ke masa depan.
 *
 * Kalau event masih `SENDING` setelah lease-nya lewat, proses yang
 * mengklaimnya pasti sudah mati. Tidak perlu kolom tambahan.
 */
const LEASE_MS = 5 * 60 * 1000

export interface EmitEventInput {
  organizationId: string | null
  topic: string
  payload: unknown
  /** Kapan event boleh dicoba lagi. Default sekarang. */
  availableAt?: Date
}

/**
 * Klien transaksi untuk menulis event outbox.
 *
 * WAJIB dipakai di dalam transaksi yang sama dengan perubahan bisnis.
 * Dipisah supaya jelas di kode mana yang boleh memanggilnya.
 */
export class OutboxWriter {
  constructor(
    private readonly tx: {
      outboxEvent: {
        create(args: { data: unknown }): Promise<{ id: string }>
      }
    },
  ) {}

  /**
   * Tulis event ke outbox.
   *
   * Panggil dengan `prisma.$transaction(async (tx) => ...)` — kalau di luar
   * transaksi, jaminan "tidak ada event yang hilang" hilang juga.
   */
  async emit(input: EmitEventInput): Promise<string> {
    const event = await this.tx.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        topic: input.topic,
        payload: (input.payload ?? {}) as never,
        status: 'PENDING',
        availableAt: input.availableAt ?? new Date(),
      },
    })

    log.debug({ eventId: event.id, topic: input.topic }, 'event outbox ditulis')
    return event.id
  }
}

/** Hasil pengiriman satu event. */
export type DispatchResult =
  | { outcome: 'delivered'; detail?: string }
  | { outcome: 'accepted'; detail?: string }
  | { outcome: 'failed'; error: string }
  /**
   * Hasil tidak diketahui. Event TIDAK akan di-retry — harus direkonsiliasi
   * lebih dulu, karena pesan mungkin sudah terkirim.
   */
  | { outcome: 'unknown'; detail: string }

/**
 * Pemroses event.
 *
 * Satu implementasi per topic. Dispatcher tidak tahu apa pun soal isi event.
 */
export interface OutboxHandler {
  /** Topik yang ditangani. */
  readonly topic: string
  handle(event: { id: string; organizationId: string | null; payload: unknown }): Promise<DispatchResult>
}

export class OutboxDispatcher {
  private berjalan = false
  private loop: Promise<void> | null = null
  private readonly handlers = new Map<string, OutboxHandler>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly intervalMs = 10_000,
  ) {}

  register(handler: OutboxHandler): this {
    if (this.handlers.has(handler.topic)) {
      throw new Error(`Handler untuk topik "${handler.topic}" sudah terdaftar.`)
    }
    this.handlers.set(handler.topic, handler)
    return this
  }

  /** Topik yang ada handler-nya. */
  topics(): string[] {
    return [...this.handlers.keys()]
  }

  start(): void {
    if (this.berjalan) return
    this.berjalan = true
    log.info({ intervalMs: this.intervalMs, topik: this.topics() }, 'dispatcher outbox dinyalakan')
    this.loop = this.run()
  }

  async stop(): Promise<void> {
    this.berjalan = false
    if (this.loop) {
      await this.loop.catch(() => undefined)
      this.loop = null
    }
    log.info('dispatcher outbox dimatikan')
  }

  /** Jalankan satu siklus. Dipisah supaya bisa diuji tanpa loop. */
  async tick(now: Date = new Date()): Promise<{
    diproses: number
    terkirim: number
    gagal: number
    unknown: number
    tanpaHandler: number
  }> {
    const events = await this.claim(now)

    let terkirim = 0
    let gagal = 0
    let unknown = 0
    let tanpaHandler = 0

    for (const event of events) {
      const handler = this.handlers.get(event.topic)

      if (!handler) {
        // Event untuk topik yang tidak ada handler-nya TIDAK boleh di-drop.
        // Kalau di-drop, event hilang; kalau dicoba terus, akan mengaburkan
        // masalah yang sebenarnya (handler belum ditulis).
        tanpaHandler += 1
        await this.defer(event.id, `Tidak ada handler untuk topik "${event.topic}"`, 10 * 60_000)
        log.error({ eventId: event.id, topic: event.topic }, 'tidak ada handler untuk topik')
        continue
      }

      try {
        const hasil = await handler.handle({
          id: event.id,
          organizationId: event.organizationId,
          payload: event.payload,
        })

        switch (hasil.outcome) {
          case 'delivered':
            terkirim += 1
            await this.complete(event.id)
            break

          case 'accepted':
            // Provider menerima, belum tentu sampai. Dicatat sebagai selesai
            // dari sisi outbox; status akhir sebenarnya ada di MessageDelivery.
            terkirim += 1
            await this.complete(event.id, hasil.detail)
            break

          case 'failed':
            gagal += 1
            await this.retryOrGiveUp(event.id, event.attempts + 1, hasil.error)
            break

          case 'unknown':
            // TIDAK di-retry. Pesan mungkin sudah terkirim; mengirim ulang
            // bisa membuat orang menerima pesan yang sama dua kali.
            unknown += 1
            await this.markUnknown(event.id, hasil.detail)
            log.error({ eventId: event.id, topic: event.topic }, 'hasil pengiriman tidak diketahui — perlu direkonsiliasi')
            break
        }
      } catch (error) {
        gagal += 1
        await this.retryOrGiveUp(event.id, event.attempts + 1, error instanceof Error ? error.message : String(error))
        log.error({ eventId: event.id, topic: event.topic, err: error }, 'handler melempar error')
      }
    }

    if (events.length > 0) {
      log.info({ diproses: events.length, terkirim, gagal, unknown, tanpaHandler }, 'siklus outbox selesai')
    }

    return { diproses: events.length, terkirim, gagal, unknown, tanpaHandler }
  }

  private async claim(now: Date): Promise<
    Array<{ id: string; topic: string; organizationId: string | null; payload: unknown; attempts: number }>
  > {
    const kandidat = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING', availableAt: { lte: now } },
      orderBy: { availableAt: 'asc' },
      take: MAX_BATCH,
      select: { id: true, topic: true, organizationId: true, payload: true, attempts: true },
    })

    const diklaim: typeof kandidat = []

    for (const event of kandidat) {
      // `updateMany` bersyarat PENDING = hanya satu dispatcher yang boleh
      // mengambil satu event.
      const claimed = await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: 'PENDING' },
        data: {
          status: 'SENDING',
          attempts: { increment: 1 },
          // `availableAt` jadi lease — bukan "kapan coba lagi".
          availableAt: new Date(now.getTime() + LEASE_MS),
        },
      })

      if (claimed.count > 0) diklaim.push({ ...event, attempts: event.attempts + 1 })
    }

    return diklaim
  }

  private async complete(id: string, detail?: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        processedAt: new Date(),
        lastError: detail ?? null,
      },
    })
  }

  /**
   * Retry dengan backoff eksponensial, atau menyerah kalau sudah habis.
   *
   * Event yang menyerah TIDAK dihapus — tetap ada sebagai `FAILED` supaya
   * bisa diperiksa.
   */
  private async retryOrGiveUp(id: string, attempts: number, error: string): Promise<void> {
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.outboxEvent.update({
        where: { id },
        data: { status: 'FAILED', processedAt: new Date(), lastError: error },
      })
      log.error({ eventId: id, attempts }, 'event menyerah setelah batas percobaan')
      return
    }

    const backoff = Math.min(DASAR_BACKOFF_MS * 2 ** (attempts - 1), MAKS_BACKOFF_MS)
    await this.defer(id, error, backoff)
  }

  private async defer(id: string, error: string, delayMs: number): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'PENDING',
        availableAt: new Date(Date.now() + delayMs),
        lastError: error,
      },
    })
  }

  /**
   * Tandai sebagai `UNKNOWN` — perlu rekonsiliasi manusia.
   *
   * `processedAt` TIDAP diisi: event sudah diproses, hanya hasilnya yang
   * tidak diketahui. Membedakannya penting saat merekonsiliasi.
   */
  private async markUnknown(id: string, detail: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'UNKNOWN', processedAt: new Date(), lastError: detail },
    })
  }

  /**
   * Kembalikan event `SENDING` yang menggantung.
   *
   * Event yang tersisa di `SENDING` berarti proses mati saat sedang
   * mengirim. Statusnya tidak diketahui — dan itu harus diperlakukan sebagai
   * `UNKNOWN`, bukan langsung dikirim ulang, karena pesan mungkin sudah
   * terkirim sebelum proses mati.
   */
  async recoverStuckSending(now: Date = new Date()): Promise<number> {
    const hasil = await this.prisma.outboxEvent.updateMany({
      // Lease habis = proses yang mengklaim sudah mati.
      where: { status: 'SENDING', availableAt: { lte: now } },
      data: {
        status: 'UNKNOWN',
        processedAt: new Date(),
        lastError: 'Proses mati saat mengirim — hasil tidak diketahui',
      },
    })
    const result = hasil

    if (result.count > 0) {
      log.warn(
        { jumlah: result.count },
        'event SENDING yang menggantung dipindahkan ke UNKNOWN — perlu rekonsiliasi',
      )
    }
    return result.count
  }

  /** Daftar event yang perlu rekonsiliasi manusia. */
  async needReconciliation(limit = 50): Promise<
    Array<{ id: string; topic: string; status: string; attempts: number; lastError: string | null }>
  > {
    return this.prisma.outboxEvent.findMany({
      where: { status: { in: ['UNKNOWN', 'FAILED'] } },
      orderBy: { availableAt: 'desc' },
      take: limit,
      select: { id: true, topic: true, status: true, attempts: true, lastError: true },
    })
  }

  private async run(): Promise<void> {
    const jitter = Math.floor(Math.random() * 2_000)
    while (this.berjalan) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs + jitter))
      if (!this.berjalan) break
      try {
        await this.tick()
      } catch (error) {
        log.error({ err: error }, 'siklus outbox gagal, melanjutkan')
      }
    }
  }
}

/** Topik yang dipahami sistem. */
export const TOPICS = {
  WHATSAPP_MESSAGE: 'whatsapp.message.send',
  ATTENDANCE_NOTIFY: 'attendance.notify',
} as const

/** Helper untuk menulis event di dalam transaksi. */
export function outboxWriter(tx: never): OutboxWriter {
  return new OutboxWriter(tx)
}

/** ID acak untuk korelasi manual. */
export function correlationId(): string {
  return randomUUID()
}