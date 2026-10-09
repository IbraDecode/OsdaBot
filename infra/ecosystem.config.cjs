/**
 * name: Berkas konfigurasi pm2 untuk OSDA Platform.
 *
 * Guna:
 *   pm2 start infra/ecosystem.config.cjs            # jalankan API + Web
 *   pm2 start infra/ecosystem.config.cjs --only api
 *   pm2 save && pm2 startup                          # hidup setelah reboot
 *
 * CATATAN: bot WhatsApp tidak dijalankan otomatis. Aktifkan hanya bila sudah
 * dikonfigurasi (WHATSAPP_ENABLED=true + pairing selesai).
 */
module.exports = [
  {
    name: 'osda-api',
    cwd: '/home/jelastic/osda',
    script: 'apps/api/dist/main.js',
    interpreter: 'node',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '30s',
    restart_delay: 4000,
    max_memory_restart: '600M',
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  },
  {
    name: 'osda-web',
    cwd: '/home/jelastic/osda',
    script: 'node_modules/.bin/next',
    args: 'start apps/web -p 3000',
    interpreter: 'none',
    autorestart: true,
    max_restarts: 5,
    min_uptime: '30s',
    restart_delay: 5000,
    max_memory_restart: '700M',
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  },
  // Bot WhatsApp — dinonaktifkan secara bawaan.
  // Aktifkan dengan: pm2 start infra/ecosystem.config.cjs --only osda-bot
  {
    name: 'osda-bot',
    cwd: '/home/jelastic/osda',
    script: 'apps/bot/dist/main.js',
    interpreter: 'node',
    autorestart: true,
    max_restarts: 5,
    min_uptime: '60s',
    restart_delay: 8000,
    max_memory_restart: '500M',
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  },
];
