/**
 * KELOLA AKUN — buka kunci & atur ulang kata sandi.
 *
 * Dua kebutuhan operasional yang tidak bisa lewat API:
 *
 *  1. **Buka kunci akun.** `dikunci_sampai` diisi otomatis setelah 5 percobaan
 *     masuk gagal. Bila ada anggota terkunci karena salah ketik, pengurus
 *     harus bisa membukanya tanpa menunggu 15 menit.
 *  2. **Setel ulang kata sandi.** Untuk akun yang tidak punya surel — anggota
 *     yang hanya masuk lewat WhatsApp, termasuk hasil migrasi v0.4.
 *
 * Jalankan:
 *   pnpm --filter @osda/tools akun-buka-kunci <email>
 *   pnpm --filter @osda/tools akun-sandi        <email> [sandi-baru]
 *
 * Perintah tanpa argumen menampilkan daftar akun yang sedang terkunci.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';
import argon2 from 'argon2';

const AKAR = resolve(import.meta.dirname, '../..');

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

const PERINTAH = process.argv[2] ?? 'daftar';
const ARGUMEN = process.argv[3];

async function main() {
  const db = postgres(bacaEnv().DATABASE_URL, { max: 1 });

  // ---------------------------------------------------------------
  // Daftar akun terkunci (perintah bawaan).
  // ---------------------------------------------------------------
  if (PERINTAH === 'daftar' || PERINTAH === 'list') {
    const terkunci = await db`
      select u.email, u.nama, u.telepon, u.dikunci_sampai, u.gagal_login_berurut
        from users u
       where u.dikunci_sampai is not null and u.dikunci_sampai > now()
       order by u.dikunci_sampai desc`;

    if (terkunci.length === 0) {
      console.log('\nTidak ada akun yang sedang terkunci.');
    } else {
      console.log(`\n${terkunci.length} akun terkunci:`);
      console.log('  EMAIL'.padEnd(38) + 'NAMA'.padEnd(26) + 'GAGAL  SAMPAI');
      for (const u of terkunci) {
        console.log(
          `  ${String(u.email ?? '(tanpa surel)').padEnd(38)}` +
            `${String(u.nama).padEnd(26)}${String(u.gagal_login_berturut).padStart(5)}  ` +
            `${new Date(u.dikunci_sampai).toISOString().slice(0, 16).replace('T', ' ')}`,
        );
      }
    }

    const mencurigakan = await db`
      select count(*)::int AS jml from users
       where password_hash is not null and email is null`;
    console.log(
      `\nCatatan: ${mencurigakan[0].jml} akun punya kata sandi tanpa surel ` +
        '(hasil migrasi). Akun semacam ini tidak bisa masuk via surel.',
    );
    await db.end();
    return;
  }

  if (!ARGUMEN) {
    console.error('\nSebutkan surel akun, contoh:');
    console.error('  pnpm --filter @osda/tools akun-buka-kunci uji+member@osda.local');
    await db.end();
    process.exit(1);
  }

  // ---------------------------------------------------------------
  // Buka kunci.
  // ---------------------------------------------------------------
  if (PERINTAH === 'buka-kunci' || PERINTAH === 'unlock') {
    const hasil = await db`
      update users set dikunci_sampai = null, gagal_login_berurut = 0
       where lower(email) = lower(${ARGUMEN}) and dikunci_sampai is not null
      returning email, nama`;
    if (hasil.length === 0) {
      // Cek apakah akunnya memang ada.
      const ada = await db`
        select email, nama, dikunci_sampai from users where lower(email) = lower(${ARGUMEN})`;
      if (ada.length === 0) {
        console.error(`\nAkun "${ARGUMEN}" tidak ditemukan.`);
        await db.end();
        process.exit(1);
      }
      console.log(`\nAkun ${ada[0].email} memang tidak sedang terkunci.`);
    } else {
      console.log(`\nKunci dibuka: ${hasil[0].email} (${hasil[0].nama})`);
    }
    await db.end();
    return;
  }

  // ---------------------------------------------------------------
  // Setel ulang kata sandi.
  // ---------------------------------------------------------------
  if (PERINTAH === 'sandi' || PERINTAH === 'password') {
    // Sandi dari argumen, atau dibangkitkan acak lalu ditampilkan sekali.
    const sandiBaru = sandiDariArgumen() ?? buatSandi();
    const hash = await argon2.hash(sandiBaru, { type: argon2.argon2id });

    const hasil = await db`
      update users set password_hash = ${hash}, status = 'ACTIVE',
                        dikunci_sampai = null, gagal_login_berurut = 0
       where lower(email) = lower(${ARGUMEN})
      returning email, nama`;

    if (hasil.length === 0) {
      console.error(`\nAkun "${ARGUMEN}" tidak ditemukan.`);
      await db.end();
      process.exit(1);
    }

    console.log(`\nKata sandi diperbarui: ${hasil[0].email} (${hasil[0].nama})`);
    console.log(`  sandi baru : ${sandiBaru}`);
    console.log('\n  Ingatkan pengguna untuk langsung menggantinya setelah masuk.');
    await db.end();
    return;
  }

  console.error(`\nPerintah tidak dikenal: ${PERINTAH}`);
  console.error('  daftar | buka-kunci <email> | sandi <email> [sandi-baru]');
  await db.end();
  process.exit(1);
}

/** Kata sandi dari argumen ke-4, bila diberikan. */
function sandiDariArgumen() {
  return process.argv[4];
}

/** Bangkitkan kata sandi acak yang mudah diketik admin. */
function buatSandi() {
  const huruf = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const angka = '23456789';
  const ambil = (s) => s[Math.floor(Math.random() * s.length)];
  return `OSDA-${Array.from({ length: 4 }, () => ambil(huruf)).join('')}-${Array.from({ length: 4 }, () => ambil(angka)).join('')}`;
}

main().catch((galat) => {
  console.error('\nGagal:', galat instanceof Error ? galat.message : galat);
  process.exit(1);
});