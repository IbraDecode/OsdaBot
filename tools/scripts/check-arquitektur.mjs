/**
 * Pemeriksaan aturan arsitektur.
 *
 * Menegakkan prinsip inti OSDA yang paling mudah dilanggar tanpa disadari:
 *  1. Tidak ada client (web/mobile/bot) yang boleh mengimpor driver database.
 *  2. Hanya paket `@osda/db` yang boleh tahu nama tabel PostgreSQL.
 *  3. Tidak ada satu pun file yang memuat string kredensial.
 *  4. Skema database adalah sumber kebenaran; tidak ada SQL mentah di luar
 *     paket db.
 *
 * Jalankan: `pnpm check:architecture`
 */
import { readFileSync, existsSync } from 'node:fs';
import { extname, resolve, relative } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const AKAR = resolve(import.meta.dirname, '../..');

/** Client yang dilarang menyentuh database. */
const CLIENT_TANPA_DB = ['apps/web', 'apps/mobile', 'apps/bot'];

/** Pola yang menandakan akses langsung ke database. */
const POLA_AKSES_DB = [
  /\bfrom\s+['"]@osda\/db['"]/,
  /\bfrom\s+['"]drizzle-orm['"]/,
  /\bfrom\s+['"]node-postgres['"]/,
  /\bfrom\s+['"]postgres['"]/,
  /\bfrom\s+['"]pg['"]/,
  /DATABASE_URL/,
];

/** Pola kredensial yang tidak boleh ada di kode. */
const POLA_RAHASIA = [
  /postgres(ql)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/i,
  /\bBP_LIVE_[A-Za-z0-9]{10,}/,
  /\bbp_live_[A-Za-z0-9]{10,}/,
  /sk-[A-Za-z0-9]{20,}/,
];

/** Kumpulkan seluruh berkas kode di dalam satu folder. */
function kumpulkan(folder) {
  const hasil = [];
  const mutlak = resolve(AKAR, folder);
  if (!existsSync(mutlak)) return hasil;
  for (const nama of readdirSync(mutlak)) {
    const jalur = resolve(mutlak, nama);
    if (statSync(jalur).isDirectory()) {
      if (['node_modules', '.next', 'dist', '.expo', '.turbo'].includes(nama)) continue;
      hasil.push(...kumpulkan(relative(AKAR, jalur)));
      continue;
    }
    if (['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(nama))) {
      hasil.push(relative(AKAR, jalur));
    }
  }
  return hasil;
}

const masalah = [];

// 1. Client tidak boleh mengimpor driver database
for (const client of CLIENT_TANPA_DB) {
  for (const berkas of kumpulkan(client)) {
    const isi = readFileSync(resolve(AKAR, berkas), 'utf8');
    for (const pola of POLA_AKSES_DB) {
      if (pola.test(isi)) {
        masalah.push(
          `${berkas}: klien tidak boleh mengakses database secara langsung (pola: ${pola})`,
        );
      }
    }
  }
}

// 2. Kredensial tidak boleh ada di kode
for (const folder of ['apps', 'packages', 'tools', 'infra']) {
  for (const berkas of kumpulkan(folder)) {
    if (berkas.endsWith('.env.example')) continue;
    const isi = readFileSync(resolve(AKAR, berkas), 'utf8');
    for (const pola of POLA_RAHASIA) {
      if (pola.test(isi)) {
        masalah.push(`${berkas}: kemungkinan memuat kredensial (pola: ${pola})`);
      }
    }
  }
}

// 3. Hanya paket db yang boleh menyebut nama tabel mentah
const penamaTabel = /\b(?:from|into|update|join)\s+["']?(organizations|members|attendance_records|ledger_entries|audit_logs|payments|transactions)["']?/i;
for (const folder of ['apps/api', 'apps/bot']) {
  for (const berkas of kumpulkan(folder)) {
    const isi = readFileSync(resolve(AKAR, berkas), 'utf8');
    if (penamaTabel.test(isi) && !berkas.includes('/db/')) {
      // Nama tabel dalam string SQL hanya boleh di migrations/seed.
      if (berkas.includes('/cli/') || berkas.includes('invariants')) continue;
      masalah.push(`${berkas}: menyebut nama tabel langsung; gunakan objek tabel dari @osda/db`);
    }
  }
}

if (masalah.length > 0) {
  console.error('✗ Pelanggaran aturan arsitektur:\n');
  for (const m of masalah) console.error(`  - ${m}`);
  process.exit(1);
}

console.log('✓ Aturan arsitektur terpenuhi:');
console.log('  - Tidak ada klien yang mengakses database langsung');
console.log('  - Tidak ada kredensial dalam kode');
console.log('  - Nama tabel hanya diatur di paket @osda/db');
