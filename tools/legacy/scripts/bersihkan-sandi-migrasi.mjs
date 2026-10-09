/**
 * BERSIHKAN KATA SANDAI HASIL MIGRASI LAMA.
 *
 * `migrate-to-v2.mjs` versi lama memberi SATU kata sandi placeholder yang
 * sama kepada seluruh anggota, dan kata sandi itu tertulis di repositori.
 * Jadi siapa pun yang membaca repo ini bisa masuk sebagai anggota mana pun.
 *
 * Skrip ini menghapus `password_hash` milik akun hasil migrasi lama sehingga
 * mereka tidak bisa masuk dengan kata sandiplaceholder lagi.
 *
 * Mengapa dihapus, bukan diganti:
 *  - Akun-akun ini tidak punya surel, jadi tidak bisa masuk lewat surel.
 *  - Mereka sudah punya identitas WhatsApp, jadi bisa masuk lewat tautan dalam
 *    atau kode, lalu menetapkan kata sandi sendiri.
 *  - `password_hash` NULL adalah state yang sah di skema.
 *
 * Jalankan SEKALI setelah migrasi yang memakai skrip versi lama.
 * Aman diulang — hanya menyentuh akun tanpa surel yang masih memakai
 * placeholder-nya.
 *
 * Jalankan: node tools/legacy/scripts/bersihkan-sandi-migrasi.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';
import argon2 from 'argon2';

const AKAR = resolve(import.meta.dirname, '../../..');

/** Baca .env tanpa pustaka dotenv. */
function bacaEnv() {
  const isi = readFileSync(resolve(AKAR, '.env'), 'utf8');
  const hasil = {};
  for (const baris of isi.split('\n')) {
    if (!baris || baris.startsWith('#')) continue;
    const i = baris.indexOf('=');
    if (i < 0) continue;
    hasil[baris.slice(0, i).trim()] = baris.slice(i + 1).trim();
  }
  return hasil;
}

/**
 * Kata sandi placeholder yang pernah dipakai skrip migrasi lama.
 *
 * Daftar ini harus dibaca dari sini, BUKAN ditebak ulang — kalau placeholder
 * berubah di masa depan, akun lama tidak akan terdeteksi dan skrip ini
 * akan melaporkan 0 baris, memberi kesan aman padahal tidak.
 */
const PLACEHOLDER_LAMA = ['OsdaMigrasi#2026'];

/** Apakah sebuah hash cocok dengan salah satu placeholder lama? */
async function memakaiPlaceholder(hash) {
  for (const sandi of PLACEHOLDER_LAMA) {
    try {
      if (await argon2.verify(hash, sandi)) return true;
    } catch {
      // Hash rusak atau bukan argon2 — bukan placeholder.
    }
  }
  return false;
}

async function main() {
  const db = postgres(bacaEnv().DATABASE_URL, { max: 1 });

  // Hanya akun tanpa surel yang ikut migrasi lama. Akun admin dan akun uji
  // tidak boleh tersentuh.
  const kandidat = await db`
    select id, nama, telepon, password_hash
      from users
     where email is null and password_hash is not null
     order by nama`;

  console.log(`\nMemeriksa ${kandidat.length} akun tanpa surel…`);
  if (kandidat.length === 0) {
    console.log('Tidak ada akun tanpa surel yang punya kata sandi. Semua bersih.');
    await db.end();
    return;
  }

  const terkena = [];
  for (const akun of kandidat) {
    process.stdout.write(`  ${akun.nama} … `);
    if (await memakaiPlaceholder(akun.password_hash)) {
      terkena.push(akun);
      console.log('placeholder');
    } else {
      console.log('kata sandi lain (dibiarkan)');
    }
  }

  if (terkena.length === 0) {
    console.log('\nTidak ada akun yang memakai placeholder. Tidak ada yang diubah.');
    await db.end();
    return;
  }

  await db.begin(async (trx) => {
    for (const akun of terkena) {
      await trx`
        update users set password_hash = null, diubah_pada = now()
         where id = ${akun.id}`;
    }
  });

  console.log(`\n${terkena.length} akun kehilangan kata sandi placeholder:`);
  for (const a of terkena) {
    console.log(`  - ${a.nama} (${a.telepon ?? 'tanpa telepon'})`);
  }
  console.log('\nAnggota yang terdampak masuk lewat WhatsApp (tautan dalam / kode),');
  console.log('lalu menetapkan kata sandi sendiri.');
  await db.end();
}

main().catch((galat) => {
  console.error('\nGagal:', galat instanceof Error ? galat.message : galat);
  process.exit(1);
});