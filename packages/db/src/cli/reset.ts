/**
 * CLI Reset: `pnpm --filter @osda/db reset`
 *
 * MENGHAPUS SELURUH SKEMA DATABASE lalu membangun ulang dari nol.
 * Hanya boleh dipakai di pengembangan lokal. CLI ini menolak berjalan bila
 * NODE_ENV=production atau bila ada host database yang bukan localhost.
 */
import { sql } from 'drizzle-orm';

import { buatDb, muatEnv } from '../client.js';

const hostAman = ['localhost', '127.0.0.1', '::1', 'ep-'];

async function main() {
  muatEnv();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Reset database DILARANG di production.');
  }
  const host = new URL(process.env.DATABASE_URL ?? 'http://localhost').hostname;
  const boleh = hostAman.some((h) => host.includes(h));
  if (!boleh && process.env.PGLITE_DIR === undefined) {
    throw new Error(
      `Reset hanya diizinkan pada database lokal/Neon dev. Host sekarang: ${host}. ` +
        'Setel IZINKAN_RESET_REMOTE=1 bila benar-benar disengaja.',
    );
  }
  if (!boleh && process.env.IZINKAN_RESET_REMOTE !== '1') {
    throw new Error('Setel IZINKAN_RESET_REMOTE=1 untuk mengonfirmasi.');
  }

  console.log('⚠️  Menghapus seluruh skema OSDA…');
  const db = await buatDb();
  await db.execute(
    sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;`,
  );
  console.log('✓ Skema kosong.');
  console.log('   Jalankan `pnpm db:migrate` lalu `pnpm db:seed` untuk membangun ulang.');
  process.exit(0);
}

main().catch((e) => {
  console.error('✗ Reset gagal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
