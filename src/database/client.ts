/**
 * Klien Prisma.
 *
 * Satu instance untuk seluruh proses (modular monolith).
 * Log query dinonaktifkan supaya isi pesan tidak bocor ke log — kita sudah
 * punya audit log terstruktur untuk hal yang perlu ditelusuri.
 */
import { PrismaClient } from '@prisma/client'
import { env, isProduction } from '../config/env.js'
import { logger } from '../observability/logger.js'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction
      ? [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
      : [{ emit: 'event', level: 'error' }],
    datasources: {
      // Pooler butuh batas koneksi jelas supaya tidak exhausting pada Neon.
      db: { url: env.DATABASE_URL },
    },
  })

if (!isProduction) {
  // Cegah terlalu banyak instance saat hot-reload tsx.
  globalForPrisma.prisma = prisma
}

type PrismaEvent = { level: 'error' | 'warn'; message: string }

prisma.$on('error' as never, (event: PrismaEvent) => {
  logger.error({ event: 'prisma.error', message: event.message }, 'kesalahan database')
})

prisma.$on('warn' as never, (event: PrismaEvent) => {
  logger.warn({ event: 'prisma.warn', message: event.message }, 'peringatan database')
})

/** Tutup koneksi dengan rapi saat aplikasi dihentikan. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
}

/** Cek konektivitas database untuk health check. */
export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const mulai = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return { ok: true, latencyMs: Date.now() - mulai }
  } catch (error) {
    logger.error({ err: error }, 'health check database gagal')
    return { ok: false, latencyMs: Date.now() - mulai }
  }
}