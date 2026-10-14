/**
 * Koneksi Redis untuk BullMQ.
 *
 * ── Dua jebakan Upstash yang bikin queue diam-diam mati ────────────────────
 *
 * 1. `maxRetriesPerRequest` HARUS `null`.
 *
 *    BullMQ memakai instance ioredis yang sama untuk blocking command
 *    (`BRPOPLPUSH`). ioredis default-nya `maxRetriesPerRequest: 20`, dan
 *    kalau koneksi terputus sesaat, blocking command itu langsung gagal.
 *
 *    Di BullMQ, blocking command yang gagal = worker berhenti memproses job,
 *    tanpa error yang terlihat. Job menumpuk, tidak ada yang jalan.
 *
 *    BullMQ mensyaratkan `null` secara eksplisit. Ini bukan preferensi.
 *
 * 2. `enableReadyCheck` harus dimatikan untuk some host managed.
 *
 *    Upstash lewat TLS sering tidak menjawab `INFO` dengan benar saat
 *    handshake. BullMQ mengirimnya otomatis; kalau gagal, koneksi dianggap
 *    belum siap.
 *
 * Koneksi dibuat lazy dan di-cache supaya seluruh modul memakai koneksi yang
 * sama — BullMQ tidak mendukung reconnect pada koneksi yang sudah dipakai
 * worker.
 */
import { Redis as IORedis } from 'ioredis'
import type { Redis, RedisOptions } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'queue:redis' })

/** Konfigurasi wajib BullMQ. */
const BULLMQ_REQUIRES: RedisOptions = {
  // BullMQ: blocking command harus tolerate reconnect.
  maxRetriesPerRequest: null,
  // Host managed sering tidak mendukung ready check.
  enableReadyCheck: false,
}

let koneksiUtama: Redis | null = null

/**
 * Koneksi utama — dipakai BullMQ (Queue, Worker, FlowProducer).
 *
 * Dipakai bersama, jadi jangan pernah `quit()` dari pemanggil biasa.
 * Untuk koneksi blocking yang boleh ditutup sendiri, pakai `blockingConnection()`.
 */
export function redisConnection(): Redis {
  if (koneksiUtama) return koneksiUtama

  const client = new IORedis(env.REDIS_URL, { ...BULLMQ_REQUIRES, lazyConnect: false })
  koneksiUtama = client

  client.on('error', (error: Error) => {
    // Redis down bukan akhir dunia — BullMQ akan reconnect sendiri. Yang
    // penting log-nya ada supaya tidak dievaluasi sebagai "kenaifan diam".
    log.error({ err: error.message }, 'koneksi redis bermasalah')
  })

  client.on('reconnecting', () => {
    log.warn('menghubungkan ulang ke redis')
  })

  return koneksiUtama
}

/**
 * Koneksi terpisah untuk operasi blocking.
 *
 * Pemanggil BOLEH menutupnya sendiri. Kalau memakai koneksi utama lalu
 * menutupnya, semua Queue dan Worker ikut mati.
 */
export function blockingConnection(): Redis {
  return new IORedis(env.REDIS_URL, { ...BULLMQ_REQUIRES, lazyConnect: false })
}

/**
 * Tutup koneksi utama. Hanya untuk shutdown aplikasi.
 */
export async function closeRedis(): Promise<void> {
  const client = koneksiUtama
  if (!client) return
  koneksiUtama = null
  try {
    await client.quit()
  } catch (error) {
    log.warn({ err: error }, 'gagal menutup koneksi redis dengan rapi')
    client.disconnect()
  }
}