import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Konfigurasi test.
 *
 * Prinsip:
 *  - Test UNIT tidak boleh butuh layanan eksternal sama sekali.
 *  - Test INTEGRASI boleh memakai PostgreSQL sungguhan, tapi TIDAK BOLEH
 *    mengirim pesan WhatsApp atau melakukan pembayaran sungguhan.
 *  - Kalau `.env` tersedia, nilainya dipakai untuk test integrasi.
 *    Kalau tidak, test unit tetap jalan dengan nilai palsu.
 */
const hasRealEnv = existsSync(resolve(process.cwd(), '.env'))
if (hasRealEnv) {
  // Dimuat di level config, SEBELUM `test.env` diterapkan.
  process.loadEnvFile(resolve(process.cwd(), '.env'))
}

const dummy = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/osdabot_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  AI_BASE_URL: 'http://127.0.0.1:9/v1',
  AI_API_KEY: 'sk-test-key-not-real',
  AI_MODEL: 'test-model',
  WHATSAPP_SESSION_DIR: '/tmp/osdabot-test-session',
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Pool persis: test integrasi memakai database yang sama.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // Nilai asli dari .env menang kalau ada; kalau tidak, pakai dummy.
      ...dummy,
      ...(hasRealEnv
        ? {
            DATABASE_URL: process.env.DATABASE_URL,
            // Dibawa juga supaya test/live/* bisa dijalankan eksplisit bila diminta.
            AI_BASE_URL: process.env.AI_BASE_URL,
            AI_API_KEY: process.env.AI_API_KEY,
            AI_MODEL: process.env.AI_MODEL,
          }
        : {}),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**', 'src/index.ts', 'src/config/**'],
    },
  },
})