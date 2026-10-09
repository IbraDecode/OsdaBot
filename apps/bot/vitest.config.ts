import { defineConfig } from 'vitest/config';

/**
 * Konfigurasi uji OSDA Bot.
 * Nilai environment dipasang di sini supaya konfigurasi bot terbaca konsisten
 * saat berkas pengujian diimpor (config dibaca sekali saat modul dimuat).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      WHATSAPP_ENABLED: 'false',
      API_URL: 'http://localhost:4000/api/v1',
      API_BOT_TOKEN: 'token-uji',
    },
  },
});
