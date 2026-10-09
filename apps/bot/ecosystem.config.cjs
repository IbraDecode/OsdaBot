/**
 * Konfigurasi PM2 untuk OSDA Bot (nama proses: osda-bot-v2).
 *
 * Catatan:
 * - Bila `dist/` sudah dibangun (pnpm --filter @osda/bot build), PM2 memakai
 *   `node dist/main.js`.
 * - Bila belum, PM2 menjalankan TypeScript langsung lewat tsx
 *   (`node --import tsx src/main.ts`) supaya pengembangan tetap praktis.
 * - Bot WAJIB dijalankan dengan instance 1: koneksi WhatsApp (Baileys) hanya
 *   bisa terhubung dari satu proses agar sesi tidak saling mengusir.
 */
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const adaDist = existsSync(join(__dirname, 'dist', 'main.js'));

module.exports = {
  apps: [
    {
      name: 'osda-bot-v2',
      script: adaDist ? 'dist/main.js' : 'src/main.ts',
      args: [],
      interpreter: 'node',
      node_args: adaDist ? [] : ['--import', 'tsx'],
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: 10000,
      restart_delay: 5000,
      max_memory_restart: '500M',
      time: true,
      merge_logs: true,
      // Variabel default; nilai asli tetap dibaca dari berkas .env.
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Makassar',
        LOG_LEVEL: 'info',
        WHATSAPP_ENABLED: 'false',
        WHATSAPP_SESSION_DIR: './whatsapp-session',
        API_URL: 'http://localhost:4000/api/v1',
        NOTIFIKASI_AKTIF: 'true',
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
        WHATSAPP_ENABLED: 'false',
      },
    },
  ],
};
