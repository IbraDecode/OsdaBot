/**
 * UJI BATAS IZIN END-TO-END (spesifikasi §09 & §93.7).
 *
 * Matriks izin di `@osda/contracts` sudah diuji di tingkat data, tapi belum
 * pernah dibuktikan bahwa guard sungguhan menegakkannya. Skrip ini login
 * sebagai setiap peran lalu mencoba aksi yang seharusnya diizinkan dan yang
 * seharusnya ditolak.
 *
 * Yang diuji:
 *   1. Setiap peran bisa login dan menerima paket izin sesuai matriks.
 *   2. Izin yang DIMILIKI benar-benar lolos ke endpoint.
 *   3. Izin yang TIDAK dimiliki benar-benar ditolak (403).
 *   4. Cakupan MEMBER membatasi data pada dirinya sendiri.
 *   5. Administrator-super tetap punya akses penuh (kontrol).
 *
 * Jalankan: pnpm --filter @osda/tools e2e-izin
 * Butuh  :  API hidup di $API_URL (default http://localhost:4000)
 *           akun uji sudah dibuat (`pnpm --filter @osda/tools akun-uji`)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MATRICS_PERAN, PERMISSION } from '../../packages/contracts/dist/index.js';

const AKAR = resolve(import.meta.dirname, '../..');
const API = process.env.API_URL ?? 'http://localhost:4000';
const SANDI_UJI = process.env.UJI_PASSWORD ?? 'UjiPeran#2026';

/**
 * Baca kredensial administrator dari `.env`.
 *
 * TIDAK ada nilai bawaan. Uji yang diam-diam memakai kata sandi bawaan
 * berbahaya: ia lulus di mesin yang sudah punya `.env` terisi, lalu
 * gagal secara membingungkan di mesin lain — atau, lebih buruk, dianggap
 * lulus padahal tidak pernah menguji apa pun.
 */
function kredensial() {
  const isi = readFileSync(resolve(AKAR, '.env'), 'utf8');
  const email = isi.match(/^SEED_SUPER_ADMIN_EMAIL=(.+)$/m)?.[1].trim();
  const sandi = isi.match(/^SEED_SUPER_ADMIN_PASSWORD=(.+)$/m)?.[1].trim();
  if (!email || !sandi) {
    console.error(
      '\n.env tidak memuat SEED_SUPER_ADMIN_EMAIL dan SEED_SUPER_ADMIN_PASSWORD.\n' +
        'Isi keduanya lalu jalankan ulang.',
    );
    process.exit(1);
  }
  return { email, sandi };
}

let lolos = 0;
let gagal = 0;
const rincian = [];

/** Cetak hasil satu pemeriksaan. */
function periksa(nama, kondisi, keterangan = '') {
  if (kondisi) {
    lolos += 1;
    console.log(`     ${nama}`);
  } else {
    gagal += 1;
    console.log(`     ${nama}${keterangan ? ` — ${keterangan}` : ''}`);
  }
}

/** Panggil API dan kembalikan { status, data }. */
async function panggil(jalur, opsi = {}) {
  try {
    const respons = await fetch(`${API}${jalur}`, {
      method: opsi.metode ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opsi.token ? { Authorization: `Bearer ${opsi.token}` } : {}),
      },
      body: opsi.badan === undefined ? undefined : JSON.stringify(opsi.badan),
    });
    const teks = await respons.text();
    let data = null;
    try {
      data = teks ? JSON.parse(teks) : null;
    } catch {
      data = teks;
    }
    return { status: respons.status, data };
  } catch (galat) {
    return { status: 0, data: { error: { message: String(galat) } } };
  }
}

/** Login dan kembalikan { token, pengguna }. */
async function masuk(email, sandi = SANDI_UJI) {
  const hasil = await panggil('/api/v1/auth/login', {
    metode: 'POST',
    badan: { email, password: sandi },
  });
  return hasil.status === 200 && hasil.data?.aksesToken
    ? { ok: true, token: hasil.data.aksesToken, pengguna: hasil.data.pengguna }
    : { ok: false, status: hasil.status, pesan: hasil.data?.error?.message };
}

/**
 * Rangkaian aksi yang harus DIJAGA per peran.
 *
 * Setiap aksi punya: `harus` = kode status yang diharapkan.
 * 200/201 = diizinkan, 403 = ditolak, 400/404 = diizinkan tetapi data kurang
 * (tetap bukti guard meloloskan permintaan).
 */
function harapaPeran(peran) {
  const tab = {
    MEMBER: {
      boleh: [{ nama: 'baca daftar anggota', jalur: '/api/v1/members?limit=1' }],
      tolak: [
        { nama: 'kelola anggota', jalur: '/api/v1/members', metode: 'POST',
          badan: { organizationId: 'x', nomor: 'X', nama: 'X', tingkat: 'X',
                   bergabungPada: new Date().toISOString().slice(0, 10) } },
        { nama: 'kelola absensi', jalur: '/api/v1/attendance/sessions', metode: 'POST',
          badan: {} },
        { nama: 'buka semua sesi absensi',
          jalur: '/api/v1/attendance/sessions/00000000-0000-0000-0000-000000000000/buka',
          metode: 'POST', badan: {} },
        { nama: 'kelola keuangan', jalur: '/api/v1/finance/transactions', metode: 'POST',
          badan: {} },
        { nama: 'ubah pengaturan', jalur: '/api/v1/settings', metode: 'PUT',
          badan: { kunci: 'uji', nilai: '1', tipe: 'string' } },
      ],
    },
    SECRETARY: {
      boleh: [
        { nama: 'baca anggota', jalur: '/api/v1/members?limit=1' },
        { nama: 'baca sesi absensi', jalur: '/api/v1/attendance/sessions?limit=1' },
        { nama: 'baca rapat', jalur: '/api/v1/meetings?limit=1' },
      ],
      tolak: [
        { nama: 'setujui keuangan', jalur: '/api/v1/finance/transactions/00000000-0000-0000-0000-000000000000/approve',
          metode: 'POST', badan: {} },
        { nama: 'kelola pengaturan', jalur: '/api/v1/settings', metode: 'PUT',
          badan: { kunci: 'uji', nilai: '1', tipe: 'string' } },
      ],
    },
    TREASURER: {
      boleh: [
        { nama: 'baca keuangan', jalur: '/api/v1/finance/kas' },
        { nama: 'baca akun kas', jalur: '/api/v1/finance/accounts?limit=1' },
      ],
      tolak: [
        { nama: 'kelola absensi', jalur: '/api/v1/attendance/sessions', metode: 'POST',
          badan: {} },
        { nama: 'kelola anggota', jalur: '/api/v1/members', metode: 'POST',
          badan: { organizationId: 'x', nomor: 'X', nama: 'X', tingkat: 'X',
                   bergabungPada: new Date().toISOString().slice(0, 10) } },
      ],
    },
    PR: {
      boleh: [{ nama: 'baca komunikasi', jalur: '/api/v1/communications/stats' }],
      tolak: [
        { nama: 'kelola keuangan', jalur: '/api/v1/finance/transactions', metode: 'POST',
          badan: {} },
        { nama: 'arsipkan anggota', jalur: '/api/v1/members/00000000-0000-0000-0000-000000000000',
          metode: 'DELETE', badan: {} },
      ],
    },
    CHAIRPERSON: {
      boleh: [
        { nama: 'baca keuangan', jalur: '/api/v1/finance/kas' },
        { nama: 'baca program', jalur: '/api/v1/programs?limit=1' },
      ],
      tolak: [
        { nama: 'kelola pengaturan sistem', jalur: '/api/v1/settings', metode: 'PUT',
          badan: { kunci: 'uji', nilai: '1', tipe: 'string' } },
      ],
    },
    COORDINATOR: {
      boleh: [{ nama: 'baca program', jalur: '/api/v1/programs?limit=1' }],
      tolak: [
        { nama: 'setujui keuangan', jalur: '/api/v1/finance/transactions/00000000-0000-0000-0000-000000000000/approve',
          metode: 'POST', badan: {} },
      ],
    },
    STAFF: {
      boleh: [{ nama: 'baca tugas', jalur: '/api/v1/tasks?limit=1' }],
      tolak: [
        { nama: 'kelola keuangan', jalur: '/api/v1/finance/transactions', metode: 'POST',
          badan: {} },
      ],
    },
    ADVISOR: {
      boleh: [{ nama: 'baca laporan', jalur: '/api/v1/reports/attendance' }],
      tolak: [
        { nama: 'kelola anggota', jalur: '/api/v1/members', metode: 'POST',
          badan: { organizationId: 'x', nomor: 'X', nama: 'X', tingkat: 'X',
                   bergabungPada: new Date().toISOString().slice(0, 10) } },
      ],
    },
    VICE_CHAIRPERSON: {
      boleh: [{ nama: 'baca anggota', jalur: '/api/v1/members?limit=1' }],
      tolak: [
        { nama: 'kelola keuangan', jalur: '/api/v1/finance/transactions', metode: 'POST',
          badan: {} },
      ],
    },
  };
  return tab[peran] ?? { boleh: [], tolak: [] };
}

/** Kode status yang berarti "guard meloloskan permintaan". */
function guardMelolos(status) {
  return status === 200 || status === 201 || status === 400 || status === 404;
}

/** Kode status yang berarti "guard menolak karena izin". */
function ditolak(status) {
  return status === 401 || status === 403;
}

async function main() {
  console.log('');
  console.log('  UJI BATAS IZIN END-TO-END                        ');
  console.log('');
  console.log(`  API: ${API}\n`);

  const hidup = await panggil('/health/ready');
  if (hidup.status !== 200) {
    console.error('API tidak hidup. Jalankan `pnpm start` lebih dulu.');
    process.exit(1);
  }
  console.log('1. MASUK SEBAGAI SETIAP PERAN');
  console.log('');

  const peran = [
    'MEMBER', 'SECRETARY', 'TREASURER', 'PR',
    'CHAIRPERSON', 'COORDINATOR', 'STAFF', 'ADVISOR', 'VICE_CHAIRPERSON',
  ];

  const sesi = {};
  for (const kode of peran) {
    const email = `uji+${kode.toLowerCase()}@osda.local`;
    const hasil = await masuk(email);
    if (!hasil.ok) {
      periksa(`${kode} bisa login`, false, hasil.pesan ?? `HTTP ${hasil.status}`);
      continue;
    }
    sesi[kode] = hasil;

    const izinDiberi = hasil.pengguna?.izin ?? [];
    const peranAktif = (hasil.pengguna?.peran ?? []).map((r) =>
      typeof r === 'string' ? r : (r.kode ?? r),
    );
    periksa(`${kode} login & menerima peran`, peranAktif.includes(kode),
      `peran diterima: ${peranAktif.join(',') || '(kosong)'}`);

    // Izin dari database HARUS sama persis dengan matriks di kontrak.
    // Jika berbeda, salah satu dari keduanya salah — biasanya seed atau
    // migrasi role_permissions yang tidak sinkron.
    const harapan = new Set(MATRICS_PERAN[kode]?.izin ?? []);
    const nyata = new Set(izinDiberi);
    const kurang = [...harapan].filter((i) => !nyata.has(i));
    const lebih = [...nyata].filter((i) => !harapan.has(i));
    periksa(`${kode} izin sama persis dengan matriks kontrak`,
      kurang.length === 0 && lebih.length === 0,
      kurang.length || lebih.length
        ? `hilang: [${kurang.join(', ')}] tambahan: [${lebih.join(', ')}]`
        : '');

    // Tidak boleh ada izin yang tidak dikenal sistem.
    const asing = izinDiberi.filter((i) => !PERMISSION.includes(i));
    periksa(`${kode} tidak memakai izin yang tidak dikenal`, asing.length === 0,
      asing.join(', '));

    rincian.push({ kode, izin: izinDiberi.length });
  }

  if (rincian.length === 0) {
    console.error('\nTidak ada akun uji yang berhasil masuk.');
    console.error('Jalankan: pnpm --filter @osda/tools akun-uji');
    process.exit(1);
  }

  console.log('\n2. IZIN YANG DIMILIKI HARUS LOLOS');
  console.log('');
  for (const kode of peran) {
    const s = sesi[kode];
    if (!s) continue;
    console.log(`  ${kode}`);
    for (const aksi of harapaPeran(kode).boleh) {
      const r = await panggil(aksi.jalur, {
        metode: aksi.metode,
        token: s.token,
        badan: aksi.badan,
      });
      periksa(aksi.nama, guardMelolos(r.status),
        r.status === 403 ? 'ditolak padahal seharusnya diizinkan' : `HTTP ${r.status}`);
    }
  }

  console.log('\n3. IZIN YANG TIDAK DIMILIKI HARUS DITOLAK (403)');
  console.log('');
  for (const kode of peran) {
    const s = sesi[kode];
    if (!s) continue;
    const aksiTolak = harapaPeran(kode).tolak;
    if (aksiTolak.length === 0) continue;
    console.log(`  ${kode}`);
    for (const aksi of aksiTolak) {
      const r = await panggil(aksi.jalur, {
        metode: aksi.metode,
        token: s.token,
        badan: aksi.badan,
      });
      periksa(`tolak: ${aksi.nama}`, ditolak(r.status),
        r.status === 403 ? '' : `status=${r.status} (diharapkan 401/403)`);
    }
  }

  console.log('\n4. CAKUPAN — anggota hanya melihat dirinya');
  console.log('');
  const anggota = sesi.MEMBER;
  if (anggota) {
    const daftar = await panggil('/api/v1/members?limit=100', { token: anggota.token });
    const total = daftar.data?.meta?.total ?? daftar.data?.data?.length ?? 0;
    periksa('MEMBER tidak melihat seluruh anggota', total <= 2,
      `melihat ${total} anggota (harusnya hanya dirinya)`);

    const profil = await panggil('/api/v1/users/me', { token: anggota.token });
    periksa('MEMBER bisa membaca profilnya sendiri', profil.status === 200,
      `HTTP ${profil.status}`);
    periksa('Profil melaporkan peran MEMBER',
      JSON.stringify(profil.data?.peran ?? profil.data?.roles ?? '').includes('MEMBER'),
      JSON.stringify(profil.data?.peran ?? profil.data?.roles ?? '').slice(0, 70));
  } else {
    periksa('Akun MEMBER tersedia', false, 'tidak berhasil login');
  }

  console.log('\n5. KONTROL — administrator super tetap penuh');
  console.log('');
  const { email, sandi } = kredensial();
  const admin = await masuk(email, sandi);
  if (admin.ok) {
    const semua = await panggil('/api/v1/members?limit=100', { token: admin.token });
    const totalAdmin = semua.data?.meta?.total ?? semua.data?.data?.length ?? 0;
    periksa('SUPER_ADMIN melihat seluruh anggota', totalAdmin > 2,
      `hanya ${totalAdmin} anggota`);
    const keuangan = await panggil('/api/v1/finance/kas', { token: admin.token });
    periksa('SUPER_ADMIN boleh membaca keuangan', guardMelolos(keuangan.status),
      `HTTP ${keuangan.status}`);
  } else {
    periksa('Administrator super bisa login', false, admin.pesan ?? `HTTP ${admin.status}`);
  }

  console.log('\n6. RINGKASAN PAKET IZIN (dari database)');
  console.log('');
  console.log(`  ${'PERAN'.padEnd(18)} ${'IZIN'.padStart(5)}  CONTOH`);
  console.log(`  ${'-'.repeat(18)} ${'-'.repeat(5)}  ${'-'.repeat(24)}`);
  for (const kode of peran) {
    const r = rincian.find((x) => x.kode === kode);
    if (!r) continue;
    const contoh = (MATRICS_PERAN[kode]?.izin ?? []).slice(0, 2).join(', ');
    console.log(`  ${kode.padEnd(18)} ${String(r.izin).padStart(5)}  ${contoh}`);
  }

  console.log('\n' + '-'.repeat(58));
  if (gagal === 0) {
    console.log(` SEMUA ${lolos} PEMERIKSAAN LULUS — batas izin ditegakkan.`);
    process.exit(0);
  }
  console.log(` ${gagal} gagal dari ${lolos + gagal} pemeriksaan.`);
  process.exit(1);
}

main().catch((galat) => {
  console.error('\n Uji terhenti:', galat instanceof Error ? galat.message : galat);
  process.exit(1);
});