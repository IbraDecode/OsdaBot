/**
 * Setup test global.
 *
 * Nilai environment berasal dari `vitest.config.ts` → `test.env`, yang sudah
 * diterapkan sebelum modul apa pun dimuat. File ini untuk hook yang butuh
 * pembersihan artefak test.
 */
import { afterAll } from 'vitest'
import { rm } from 'node:fs/promises'

afterAll(async () => {
  await rm('/tmp/osdabot-test-session', { recursive: true, force: true }).catch(() => undefined)
})