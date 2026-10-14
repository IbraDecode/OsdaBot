/**
 * Worker pengingat.
 *
 * ── Kenapa pakai polling, bukan BullMQ timer ────────────────────────────────
 *
 * Denah aslinya: BullMQ hanya sebagai antrean, job disetor dari database.
 * Itu meruntuhkan seluruh mekanisme idempotensi — kalau job hilang dari Redis,
 * tidak ada yang mengembalikannya kecuali polling dari database.
 *
 * Kalau tetap pakai BullMQ, `ScheduledJob` di database jadi dekorasi: ada,
 * tapi tidak pernah jadi sumber kebenaran apa pun. Dan setiap klaim "job
 * reliable" jadi tidak terbukti.
 *
 * Worker mengambil job dari database, jadi:
 *   - Redis mati → tidak ada yang terkirim, tapi tidak ada yang hilang.
 *   - Worker restart → job dipungut lagi dari database.
 *   - Redis di-flush → job tetap ada di database.
 *
 * BullMQ tetap dipakai untuk pekerjaan yang benar-benar antrean (fan-out
 * pekerjaan panjang), bukan untuk ketepatan waktu.
 *
 * ── Job yang telat ──────────────────────────────────────────────
 *
 * Job yang telat lebih dari `GRACE_MS` dibatalkan, bukan dikirim. Pengingat
 * yang sudah basi lebih buruk daripada tidak ada — penerima tidak tahu itu
 * untuk acara yang sudah lewat.
 */
import { setTimeout as delay } from 'node:timers/promises'
import type { PrismaClient } from '@prisma/client'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import { logger } from '../observability/logger.js'
import { ReminderService, renderReminder } from '../reminders/service.js'

const log = logger.child({ module: 'reminder-worker' })

export interface ReminderWorkerOptions {
  prisma: PrismaClient
  whatsapp: WhatsAppProvider
  /** Seberapa sering mencari job yang jatuh tempo. Default 15 detik. */
  intervalMs?: number
  /** Maksimal percobaan sebelum menyerah. Default 3. */
  maxAttempts?: number
  /** Berapa banyak job per siklus. */
  batchSize?: number
}

export class ReminderWorker {
  private readonly reminders: ReminderService
  private readonly intervalMs: number
  private readonly maxAttempts: number
  private readonly batchSize: number
  private berjalan = false
  private loop: Promise<void> | null = null

  constructor(private readonly options: ReminderWorkerOptions) {
    this.reminders = new ReminderService(options.prisma)
    this.intervalMs = options.intervalMs ?? 15_000
    this.maxAttempts = options.maxAttempts ?? 3
    this.batchSize = options.batchSize ?? 100
  }

  /** Nyalakan worker. Tidak blocking. */
  start(): void {
    if (this.berjalan) {
      log.warn('worker sudah berjalan')
      return
    }

    this.berjalan = true
    log.info({ intervalMs: this.intervalMs }, 'worker pengingat dinyalakan')

    // Siklus pertama langsung jalan, bukan menunggu interval penuh — kalau
    // tidak, pengingat yang jatuh tempo 1 detik setelah start menunggu 15 detik.
    this.loop = this.run()
  }

  async stop(): Promise<void> {
    this.berjalan = false
    if (this.loop) {
      await this.loop.catch(() => undefined)
      this.loop = null
    }
    log.info('worker pengingat dimatikan')
  }

  /** Jalankan satu siklus. Dipisah supaya bisa diuji tanpa loop. */
  async tick(now: Date = new Date()): Promise<{ dikirim: number; gagal: number; dilewati: number }> {
    const jobs = await this.reminders.claimDue(now, this.batchSize)

    let dikirim = 0
    let gagal = 0
    let dilewati = 0

    for (const job of jobs) {
      // Job tanpa chat tujuan tidak bisa dikirim. Dilewati, bukan dicoba —
      // mencoba tanpa tujuan hanya menghasilkan error berulang.
      const chatJid = job.payload.chatJid
      if (!chatJid) {
        dilewati += 1
        await this.reminders.fail(job.id, 'Job tidak punya chatJid tujuan')
        log.error({ jobId: job.id }, 'pengingat tanpa chatJid — dilewati')
        continue
      }

      const teks = renderReminder({
        title: job.payload.title ?? 'Pengingat',
        body: job.payload.body ?? '',
      })

      try {
        const result = await this.options.whatsapp.sendText(chatJid, teks, {
          idempotencyKey: `reminder:${job.id}`,
        })

        // Status pengiriman yang gagal TIDAP boleh dihitung sukses.
        //
        // `sendText` returning `failed` berarti pesan tidak terkirim. Kalau
        // itu dicatat `COMPLETED`, pengingat hilang selamanya tanpa pernah
        // sampai ke penerima.
        if (result.status === 'failed') {
          gagal += 1
          await this.reminders.fail(
            job.id,
            `Pengiriman gagal (${result.errorCode ?? 'tidak diketahui'})`,
            this.maxAttempts,
          )
          log.error({ jobId: job.id, errorCode: result.errorCode }, 'pengingat gagal dikirim')
          continue
        }

        await this.reminders.complete(job.id, {
          status: result.status,
          providerMessageId: result.providerMessageId,
          deliveredAt: new Date().toISOString(),
        })
        dikirim += 1
        log.info({ jobId: job.id, status: result.status }, 'pengingat dikirim')
      } catch (error) {
        gagal += 1
        await this.reminders.fail(
          job.id,
          error instanceof Error ? error.message : String(error),
          this.maxAttempts,
        )
        log.error({ jobId: job.id, err: error }, 'kesalahan saat mengirim pengingat')
      }
    }

    if (jobs.length > 0) {
      log.info({ dikirim, gagal, dilewati, total: jobs.length }, 'siklus worker selesai')
    }

    return { dikirim, gagal, dilewati }
  }

  private async run(): Promise<void> {
    // Jitter supaya beberapa instance tidak ikut memukul database serempak.
    const jitter = Math.floor(Math.random() * 2_000)

    while (this.berjalan) {
      await delay(this.intervalMs + jitter)
      if (!this.berjalan) break

      try {
        await this.tick()
      } catch (error) {
        // Loop TIDAK boleh mati karena satu siklus gagal. Kalau mati, semua
        // pengingat berhenti tanpa ada yang Potter tahu.
        log.error({ err: error }, 'siklus worker gagal, melanjutkan ke siklus berikutnya')
      }
    }
  }
}