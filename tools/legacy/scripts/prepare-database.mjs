/**
 * Persiapan database OSDA v2.
 *
 * Langkah:
 *  1. Cadangkan dump DB lama ke berkas SQL (opsional bila dump sudah ada)
 *  2. DROP DATABASE lama, CREATE DATABASE dengan nama sama (URL tidak berubah)
 *  3. Terapkan seluruh migrasi skema v2 + trigger invariant
 *  4. Jalankan seed data awal
 *
 * JANGAN pernah dijalankan terhadap production yang sedang dilayani.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const ENV_LEGACY = '/home/jelastic/osda-bot/.env';
const BACKUP_DIR = '/home/jelastic/osda-backup';
const NAMA_DB = 'neondb';

function bacaLegacyUrl() {
  const txt = readFileSync(ENV_LEGACY, 'utf8');
  const m = txt.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL tidak ditemukan di .env bot lama.');
  return m[1].trim();
}

/** Buat DATABASE_URL untuk database tertentu dari URL legacy. */
function urlUntuk(namaDb) {
  return bacaLegacyUrl().replace(/\/[^/?]+(\?|$)/, `/${namaDb}$1`);
}

async function main() {
  const postgres = (await import('postgres')).default;
  const url = urlUntuk(NAMA_DB);
  const admin = postgres(url, { ssl: 'require', max: 1, connect_timeout: 20 });

  // --- 1. Pastikan ada dump cadangan -----------------------------------
  const dumps = existsSync(BACKUP_DIR)
    ? readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql'))
    : [];
  if (dumps.length === 0) {
    throw new Error(
      `Tidak ada dump cadangan di ${BACKUP_DIR}. Jalankan node tools/legacy/scripts/dump-legacy.mjs terlebih dahulu.`,
    );
  }
  console.log(`✓ Dump cadangan tersedia: ${dumps.join(', ')}`);

  // --- 2. Drop & recreate ---------------------------------------------
  // Koneksi ke database postgres, BUKAN ke database yang mau dihapus
  await admin.end();
  const kontrol = postgres(url.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), {
    ssl: 'require',
    max: 1,
    connect_timeout: 20,
  });

  console.log(`▸ Menjalankan: DROP DATABASE "${NAMA_DB}" …`);
  await kontrol.unsafe(`DROP DATABASE IF EXISTS "${NAMA_DB}" WITH (FORCE)`);
  console.log(`▸ Menjalankan: CREATE DATABASE "${NAMA_DB}" …`);
  await kontrol.unsafe(`CREATE DATABASE "${NAMA_DB}"`);
  await kontrol.end();
  console.log('✓ Database kosong siap.');

  // Tulis .env OSDA v2 bila belum ada
  const envOsda = '/home/jelastic/osda/.env';
  if (!existsSync(envOsda)) {
    const isi = [
      '# OSDA Platform — environment lokal (JANGAN commit)',
      `DATABASE_URL=${bacaLegacyUrl()}`,
      `TZ=${process.env.TZ ?? 'Asia/Makassar'}`,
      'API_PORT=4000',
      'PUBLIC_API_URL=http://localhost:4000',
      'CORS_ORIGINS=http://localhost:3000',
      'JWT_SECRET=dev-secret-jangan-dipakai-di-produksi-minimal-32-karakter',
      'JWT_REFRESH_SECRET=dev-refresh-secret-jangan-dipakai-di-produksi-32-karakter',
      'SEED_SUPER_ADMIN_EMAIL=admin@osis.local',
      'SEED_SUPER_ADMIN_PASSWORD=GantiPassword123!',
      'SEED_ORGANIZATION_NAME=OSIS SMKN 2 Mataram',
      '',
    ].join('\n');
    (await import('node:fs')).writeFileSync(envOsda, isi, { mode: 0o600 });
    console.log('✓ .env OSDA dibuat (mode 600).');
  } else {
    console.log('✓ .env OSDA sudah ada.');
  }

  // --- 3 & 4. Migrasi + seed ------------------------------------------
  console.log('\n▸ Menerapkan migrasi skema v2 …');
  execSync('pnpm db:migrate', { cwd: '/home/jelastic/osda', stdio: 'inherit' });
  console.log('\n▸ Menjalankan seed data awal …');
  execSync('pnpm db:seed', { cwd: '/home/jelastic/osda', stdio: 'inherit' });

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Database OSDA v2 siap                            ║');
  console.log('╚══════════════════════════════════════════════════╝');
}

main().catch((e) => {
  console.error('✗ Gagal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
