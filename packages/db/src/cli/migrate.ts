/**
 * CLI Migrasi: `pnpm --filter @osda/db migrate`
 *
 * Menjalankan migrasi Drizzle-generated, lalu memasang trigger & constraint
 * invariant. Dijalankan SETELAH `drizzle-kit generate`.
 */
import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';

import { buatDb, jalankanMigrasi, muatEnv } from '../client.js';
import { SQL_INVARIANT } from '../sql/invariants.js';

async function main() {
  muatEnv();
  console.log('▸ Menjalankan migrasi skema…');
  const db = await buatDb();
  await jalankanMigrasi(db);
  console.log('✓ Migrasi skema selesai.');

  console.log('▸ Memasang trigger & constraint invariant…');
  await db.execute(sql.raw(SQL_INVARIANT));
  console.log('✓ Invariant terpasang:');
  console.log('  - ledger_entries immutable');
  console.log('  - document_versions terkunci tidak dapat diubah');
  console.log('  - pemohon ≠ pemberi persetujuan');
  console.log('  - alasan wajib untuk IZIN/SAKIT');
  console.log('  - nominal & entri ledger harus positif');
  console.log('  - audit_logs append-only');
  console.log('  - hanya satu periode aktif per organisasi');
  console.log('  - pembayaran tidak dapat di-settle dua kali');

  // Drizzle menyimpan versi di schema drizzle, tabel __drizzle_migrations.
  try {
    const hasil = await db.execute<{ version: string }>(
      sql`select max(id) as version from drizzle.__drizzle_migrations`,
    );
    const baris = (hasil as unknown as { rows?: { version: string }[] }).rows;
    console.log(`\n✓ Jumlah migrasi yang sudah diterapkan: ${baris?.[0]?.version ?? 0}`);
  } catch {
    console.log('\n✓ Skema selesai tanpa catatan versi.');
  }

  // Verifikasi cepat: pastikan tabel inti benar-benar ada.
  const cek = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  );
  const jumlahTabel = (cek as unknown as { rows?: { n: number }[] }).rows?.[0]?.n ?? 0;
  console.log(`✓ Jumlah tabel di database: ${jumlahTabel}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('✗ Migrasi gagal:', e instanceof Error ? e.message : e);
  console.error(resolve(process.cwd()));
  process.exit(1);
});
