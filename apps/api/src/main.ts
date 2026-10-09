/**
 * Titik masuk aplikasi OSDA API.
 *
 *   pnpm --filter @osda/api dev     → mode pengembangan (watch)
 *   pnpm --filter @osda/api start   → mode biasa
 *
 * Scheduler latar (pengingat, tutup sesi otomatis, terbit pengumuman terjadwal)
 * TIDAK memakai Redis/BullMQ: cukup `setInterval` yang dilindungi advisory lock
 * Postgres agar aman berjalan di multi-instance.
 */
import 'reflect-metadata';

import { siapkanAplikasi } from './bootstrap.js';
import { bacaKonfigurasi, muatEnvDariAkar } from './config/konfigurasi.js';
import { KendaliPenjadwal, mulaiScheduler } from './modules/sistem/scheduler.service.js';

async function main(): Promise<void> {
  muatEnvDariAkar();
  bacaKonfigurasi(); // gagal cepat bila konfigurasi tidak valid

  const { app, konfigurasi } = await siapkanAplikasi();

  // Scheduler hanya berjalan bila diaktifkan eksplisit (aman multi-instance).
  const penjadwal: KendaliPenjadwal = mulaiScheduler(app, konfigurasi);

  await app.listen({ port: konfigurasi.API_PORT, host: konfigurasi.API_HOST });
  app.enableShutdownHooks();

  const url = `http://${konfigurasi.API_HOST}:${konfigurasi.API_PORT}`;
  process.stdout.write(`\n  OSDA API siap       : ${url}\n`);
  process.stdout.write(`  Dokumentasi OpenAPI : ${url}/api/docs\n`);
  process.stdout.write(`  Health              : ${url}/health/ready\n\n`);

  for (const sinyal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sinyal, () => {
      penjadwal.hentikan();
    });
  }
}

main().catch((galat: unknown) => {
  process.stderr.write(`\n✗ Gagal menjalankan OSDA API: ${(galat as Error)?.message ?? galat}\n`);
  if (galat instanceof Error && galat.stack) process.stderr.write(`${galat.stack}\n`);
  process.exit(1);
});
