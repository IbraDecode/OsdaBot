/**
 * BUAT AKUN UJI PERAN.
 *
 * Setiap peran bawaan dibuatkan satu akun uji agar batas izin bisa dibuktikan
 * saat runtime — bukan hanya di tingkat data. Tanpa ini, matriks izin di
 * `@osda/contracts` benar secara teori tetapi tidak pernah diuji oleh guard
 * sungguhan.
 *
 * Akun uji ditandai dengan awalan email `uji+` supaya mudah dikenali dan
 * dicabut sebelum produksi.
 *
 * Jalankan: pnpm --filter @osda/tools akun-uji
 * Butuh  :  DATABASE_URL di .env
 * Lalu    :  pnpm --filter @osda/tools e2e-izin   (API harus hidup)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';
import argon2 from 'argon2';

const AKAR = resolve(import.meta.dirname, '../..');

/** Baca .env tanpa bergantung pada pustaka dotenv. */
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
 * Satu akun uji per peran bawaan.
 *
 * `nama` memakai nama peran itu sendiri agar mudah dikenali di daftar.
 */
const AKUN_UJI = [
  { peran: 'MEMBER', nama: 'Uji Anggota' },
  { peran: 'SECRETARY', nama: 'Uji Sekretaris' },
  { peran: 'TREASURER', nama: 'Uji Bendahara' },
  { peran: 'PR', nama: 'Uji Hubungan Masyarakat' },
  { peran: 'CHAIRPERSON', nama: 'Uji Ketua' },
  { peran: 'COORDINATOR', nama: 'Uji Koordinator' },
  { peran: 'STAFF', nama: 'Uji Staff' },
  { peran: 'ADVISOR', nama: 'Uji Penasihat' },
  { peran: 'VICE_CHAIRPERSON', nama: 'Uji Wakil Ketua' },
];

/** Kata sandi akun uji. Boleh diganti lewat environment. */
const SANDI_UJI = process.env.UJI_PASSWORD ?? 'UjiPeran#2026';

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  BUAT AKUN UJI PERAN                              ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const env = bacaEnv();
  const db = postgres(env.DATABASE_URL, { max: 1 });

  const orgRows = await db`
    select id, nama from organizations order by dibuat_pada limit 1`;
  const org = orgRows[0];
  if (!org) {
    console.error('\nTidak ada organisasi. Jalankan `pnpm db:seed` lebih dulu.');
    await db.end();
    process.exit(1);
  }

  const periodeRows = await db`
    select id from organization_periods
     where organization_id = ${org.id} and status = 'ACTIVE' limit 1`;
  const periodeId = periodeRows[0]?.id ?? null;

  console.log(`\n  Organisasi : ${org.nama}`);
  console.log(`  Periode    : ${periodeId ?? '(tidak ada)'}`);
  console.log(`  Sandi uji  : ${SANDI_UJI}\n`);

  const hash = await argon2.hash(SANDI_UJI, { type: argon2.argon2id });
  let dibuat = 0;
  let diperbarui = 0;
  let gagal = 0;

  for (const akun of AKUN_UJI) {
    const email = `uji+${akun.peran.toLowerCase()}@osda.local`;

    const peranRows = await db`
      select id, kode from roles where kode = ${akun.peran}`;
    const peran = peranRows[0];
    if (!peran) {
      console.log(`  ✗ ${akun.peran.padEnd(18)} peran belum ada di tabel roles`);
      gagal += 1;
      continue;
    }

    try {
      await db.begin(async (trx) => {
        // 1) Akun pengguna
        // Akun uji SELALU dibuat ulang dari nol, bukan diperbarui.
        //
        // Alasannya bukan sekadar kesederhanaan: kalau akun sebelumnya pernah
        // terkunci akibat percobaan login gagal, akun itu tidak bisa dipakai
        // lagi tanpa bergantung pada kolom penguncian. Menghapus lalu membuat
        // ulang menjamin kondisinya benar-benar bersih.
        //
        // Aman karena data Akun uji tidak ada nilainya — hanya untuk
        // menguji batas izin, dan ditandai prefix `uji+` agar mudah
        // dikenali dan dicabut.
        // Keanggotaan ikut dihapus: `members.user_id` memakai ON DELETE SET
        // NULL, jadi menghapus akun saja akan meninggalkan baris anggota
        // yatim dan numero `UJI-<PERAN>` tetap terpakai.
        await trx`
          delete from members
           where organization_id = ${org.id} and nomor = ${`UJI-${akun.peran}`}`;

        const lama = await trx`
          select id from users where email = ${email}`;
        if (lama[0]) {
          await trx`delete from users where id = ${lama[0].id}`;
        }

        let userId;
        let baruIni = false;
        {
          const baru = await trx`
            insert into users (nama, email, password_hash, status,
                               email_diverifikasi_pada, dibuat_pada, diubah_pada)
            values (${akun.nama}, ${email}, ${hash}, 'ACTIVE', now(), now(), now())
            returning id`;
          userId = baru[0].id;
          baruIni = true;
        }

        // 2) Keanggotaan sebagai anggota
        let memberId;
        {
          // Nomor uji unik agar tidak bentrok dengan M-0001..M-0049 hasil migrasi.
          const baru = await trx`
            insert into members (organization_id, period_id, user_id, nomor, nama,
                                  tingkat, status, bergabung_pada,
                                  dibuat_pada, diubah_pada)
            values (${org.id}, ${periodeId}, ${userId}, ${`UJI-${akun.peran}`},
                    ${akun.nama}, 'STAFF', 'ACTIVE', current_date, now(), now())
            returning id`;
          memberId = baru[0].id;
        }

        // 3) Peran — hanya satu peran aktif agar batas izin tidak tumpang tindih.
        await trx`
          delete from member_roles
           where member_id = ${memberId} and dicabut_pada is null`;
        await trx`
          insert into member_roles (organization_id, member_id, role_id, period_id,
                                    alasan, dibuat_pada)
          values (${org.id}, ${memberId}, ${peran.id}, ${periodeId},
                  'Akun uji otomatis', now())`;

        // Penghitung hanya naik bila transaksi benar-benar commit.
        if (baruIni) dibuat += 1;
        else diperbarui += 1;
      });

      console.log(`  ✓ ${akun.peran.padEnd(18)} ${email}`);
    } catch (galat) {
      gagal += 1;
      console.log(`  ✗ ${akun.peran.padEnd(18)} ${galat.message}`);
    }
  }

  await db.end();
  console.log(
    `\n  Dibuat: ${dibuat} · Diperbarui: ${diperbarui} · Gagal: ${gagal} · ` +
      `Total: ${AKUN_UJI.length}`,
  );
  console.log('\n  Uji batas izin:');
  console.log('    pnpm --filter @osda/tools e2e-izin');
  console.log('\n  ⚠️  Hapus akun uji sebelum produksi:');
  console.log(`    delete from users where email like 'uji+%@osda.local';`);
  process.exit(gagal > 0 ? 1 : 0);
}

main().catch((galat) => {
  console.error('\n✗ Gagal:', galat instanceof Error ? galat.message : galat);
  process.exit(1);
});