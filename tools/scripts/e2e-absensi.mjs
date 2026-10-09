/**
 * UJI ALUR ABSENSI END-TO-END (spesifikasi §58 & §14).
 *
 * Menjalankan skenario lengkap terhadap API OSDA yang sedang hidup:
 *
 *   Sekretaris membuat rapat
 *     → sesi absensi terbentuk otomatis
 *     → sesi dibuka, QR aktif
 *     → anggota HADIR (source WEB)
 *     → anggota IZIN dengan alasan
 *     → anggota SAKIT tanpa alasan → DITOLAK (invariant database)
 *     → absensi ganda dengan idempotencyKey sama → TIDAK menggandakan
 *     → sesi ditutup, anggota tanpa catatan menjadi ABSENT
 *     → rekap + laporan terbentuk
 *
 * Jalankan:  node tools/scripts/e2e-absensi.mjs
 * Butuh   :  API OSDA hidup di $API_URL (default http://localhost:4000)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AKAR = resolve(import.meta.dirname, '../..');
const API = process.env.API_URL ?? 'http://localhost:4000';

/** Baca kredensial administrator dari .env. */
function kredensial() {
  try {
    const isi = readFileSync(resolve(AKAR, '.env'), 'utf8');
    return {
      email: isi.match(/^SEED_SUPER_ADMIN_EMAIL=(.+)$/m)?.[1].trim() ?? 'admin@osis.local',
      sandi: isi.match(/^SEED_SUPER_ADMIN_PASSWORD=(.+)$/m)?.[1].trim() ?? 'GantiPassword123!',
    };
  } catch {
    return { email: 'admin@osis.local', sandi: 'GantiPassword123!' };
  }
}

let lolos = 0;
let gagal = 0;

/** Cetak hasil satu pemeriksaan. */
function periksa(nama, kondisi, keterangan = '') {
  if (kondisi) {
    lolos++;
    console.log(`  ✓ ${nama}`);
  } else {
    gagal++;
    console.log(`  ✗ ${nama}${keterangan ? ` — ${keterangan}` : ''}`);
  }
}

/**
 * Panggil API dan kembalikan { status, data }.
 *
 * `header` dipakai untuk menguji penentuan kanal (`x-osda-sumber`).
 */
async function panggil(jalur, opsi = {}) {
  const respons = await fetch(`${API}${jalur}`, {
    method: opsi.metode ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opsi.token ? { Authorization: `Bearer ${opsi.token}` } : {}),
      ...(opsi.header ?? {}),
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
}

/** Tanggal hari ini dalam format YYYY-MM-DD. */
function hariIni() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  UJI ALUR ABSENSI END-TO-END                     ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  API: ${API}\n`);

  // ---------------------------------------------------------------
  console.log('1. MASUK');
  const { email, sandi } = kredensial();
  const masuk = await panggil('/api/v1/auth/login', {
    metode: 'POST',
    badan: { email, password: sandi },
  });
  periksa('Login administrator berhasil', masuk.status === 200 && masuk.data?.aksesToken,
    masuk.data?.error?.message ?? `HTTP ${masuk.status}`);
  if (!masuk.data?.aksesToken) {
    console.error('\nTidak bisa lanjut tanpa token. Pastikan API hidup dan seed sudah dijalankan.');
    process.exit(1);
  }
  const token = masuk.data.aksesToken;
  const orgId = masuk.data.pengguna.organizationIds[0];
  periksa('Organisasi aktif terdeteksi', Boolean(orgId), 'pengguna belum tertaut ke organisasi');

  // ---------------------------------------------------------------
  console.log('\n2. PERSIAPAN — ambil dua anggota');
  const anggota = await panggil('/api/v1/members?limit=5&status=ACTIVE', { token });
  const daftar = anggota.data?.data ?? [];
  periksa('Daftar anggota dapat dibaca', daftar.length >= 2, `hanya ${daftar.length} anggota`);
  if (daftar.length < 2) {
    console.error('\nButuh minimal 2 anggota aktif untuk menguji alur.');
    process.exit(1);
  }
  const [a1, a2, a3] = daftar;

  // ---------------------------------------------------------------
  console.log('\n3. SEKRETARIS MEMBUAT RAPAT');
  const rapat = await panggil('/api/v1/meetings', {
    metode: 'POST',
    token,
    badan: {
      organizationId: orgId,
      judul: `Uji E2E Absensi ${new Date().toISOString().slice(11, 19)}`,
      tanggal: hariIni(),
      waktuMulai: '08:00',
      waktuSelesai: '10:00',
      lokasi: 'Ruang Uji',
      jenis: 'RUTIN',
      buatSesiAbsensi: true,
    },
  });
  periksa('Rapat berhasil dibuat', rapat.status === 201 && Boolean(rapat.data?.id),
    rapat.data?.error?.message ?? `HTTP ${rapat.status}`);
  if (!rapat.data?.id) process.exit(1);
  const rapatId = rapat.data.id;

  periksa('Rapat menghasilkan sesi absensi', Boolean(rapat.data.sessionId),
    'sesi absensi tidak terbentuk otomatis');
  const sessionId = rapat.data.sessionId;
  if (!sessionId) process.exit(1);

  // ---------------------------------------------------------------
  console.log('\n4. SESI DIBUKA');
  const buka = await panggil(`/api/v1/attendance/sessions/${sessionId}/buka`, {
    metode: 'POST',
    token,
    badan: { qrTtlDetik: 120 },
  });
  periksa('Sesi absensi berhasil dibuka', buka.status === 201 || buka.status === 200,
    buka.data?.error?.message ?? `HTTP ${buka.status}`);
  periksa('Sesi berstatus OPEN', buka.data?.sesi?.status === 'OPEN',
    `status=${buka.data?.sesi?.status}`);
  periksa('Token QR diterbitkan', typeof buka.data?.qr?.token === 'string',
    'token QR tidak dikembalikan');

  // ---------------------------------------------------------------
  console.log('\n5. ANGGOTA HADIR (source WEB)');
  const hadir = await panggil(`/api/v1/attendance/sessions/${sessionId}/absen`, {
    metode: 'POST',
    token,
    badan: { sessionId, memberId: a1.id, status: 'PRESENT',
             idempotencyKey: `uji-${sessionId}-a1` },
  });
  periksa('Absensi HADIR tercatat',
    (hadir.status === 200 || hadir.status === 201) && hadir.data?.status === 'PRESENT',
    hadir.data?.error?.message ?? `HTTP ${hadir.status}`);
  periksa('Sumber absensi ditentukan backend dari kanal permintaan',
    hadir.data?.sumber === 'WEB', `sumber=${hadir.data?.sumber} (diharapkan WEB dari klien API)`);

  // Klien tidak boleh memaksa menentukan `sumber` — backend yang menentukan
  // berdasarkan kanal. Ini mencegah anggota menandai absensinya sebagai ADMIN.
  const paksaSumber = await panggil(`/api/v1/attendance/sessions/${sessionId}/absen`, {
    metode: 'POST',
    token,
    badan: { sessionId, memberId: a1.id, status: 'PRESENT', sumber: 'ADMIN',
             idempotencyKey: `uji-${sessionId}-paksa` },
  });
  periksa('Klien tidak boleh menentukan `sumber` sendiri', paksaSumber.status === 400,
    `status=${paksaSumber.status} (diharapkan 400)`);

  // Header kanal dipakai backend untuk mencatat asal absensi (spesifikasi §13).
  const dariWa = await panggil(`/api/v1/attendance/sessions/${sessionId}/absen`, {
    metode: 'POST',
    token,
    badan: { sessionId, memberId: a3.id, status: 'PRESENT',
             idempotencyKey: `uji-${sessionId}-wa` },
    header: { 'x-osda-sumber': 'WHATSAPP' },
  });
  periksa('Absensi berheader WHATSAPP tercatat sebagai WHATSAPP',
    dariWa.data?.sumber === 'WHATSAPP', `sumber=${dariWa.data?.sumber}`);
  periksa('Absensi berheader WHATSAPP mengembalikan id yang sama saat diulang',
    (await panggil(`/api/v1/attendance/sessions/${sessionId}/absen`, {
      metode: 'POST',
      token,
      badan: { sessionId, memberId: a3.id, status: 'PRESENT',
               idempotencyKey: `uji-${sessionId}-wa` },
      header: { 'x-osda-sumber': 'WHATSAPP' },
    })).data?.id === dariWa.data?.id,
    'ulangan menghasilkan catatan berbeda');

  // ---------------------------------------------------------------
  console.log('\n6. ANGGOTA IZIN DENGAN ALASAN');
  const izin = await panggil(`/api/v1/attendance/sessions/${sessionId}/absen`, {
    metode: 'POST',
    token,
    badan: { sessionId, memberId: a2.id, status: 'EXCUSED', alasan: 'Keperluan keluarga',
             idempotencyKey: `uji-${sessionId}-a2` },
  });
  periksa('Absensi IZIN tercatat',
    (izin.status === 200 || izin.status === 201) && izin.data?.status === 'EXCUSED',
    izin.data?.error?.message ?? `HTTP ${izin.status}`);

  // ---------------------------------------------------------------
  console.log('\n7. INVARIANT — SAKIT TANPA ALASAN HARUS DITOLAK');
  const tanpaAlasan = await panggil(`/api/v1/attendance/sessions/${sessionId}/absen`, {
    metode: 'POST',
    token,
    badan: { sessionId, memberId: a3.id, status: 'SICK',
             idempotencyKey: `uji-${sessionId}-a3` },
  });
  periksa('SAKIT tanpa alasan DITOLAK', tanpaAlasan.status === 400,
    `t seharusnya 400, dapat ${tanpaAlasan.status}`);

  // ---------------------------------------------------------------
  console.log('\n8. IDEMPOTENSI — absensi ganda tidak menggandakan');
  const ulang = await panggil(`/api/v1/attendance/sessions/${sessionId}/absen`, {
    metode: 'POST',
    token,
    badan: { sessionId, memberId: a1.id, status: 'PRESENT',
             idempotencyKey: `uji-${sessionId}-a1` },
  });
  periksa('Kirim ulang dengan idempotencyKey sama mengembalikan catatan yang sama',
    ulang.status === 200 && ulang.data?.id === hadir.data?.id && ulang.data?.sudahAda === true,
    `status=${ulang.status} id=${ulang.data?.id} (aslinya ${hadir.data?.id})`);

  // ---------------------------------------------------------------
  console.log('\n9. SESI DITUTUP — anggota tanpa catatan menjadi ABSENT');
  const tutup = await panggil(`/api/v1/attendance/sessions/${sessionId}/tutup`, {
    metode: 'POST',
    token,
    badan: { tandaiHadirSebagaiTidakHadir: true, kirimRekap: false },
  });
  periksa('Sesi berhasil ditutup', tutup.status === 201 || tutup.status === 200,
    tutup.data?.error?.message ?? `HTTP ${tutup.status}`);
  const sesiTutup = tutup.data?.sesi ?? tutup.data;
  periksa('Tutup sesi mengembalikan rekap terpisah', Boolean(tutup.data?.rekap),
    'respons tidak memuat objek rekap');
  periksa('Sesi berstatus CLOSED', sesiTutup?.status === 'CLOSED', `status=${sesiTutup?.status}`);
  periksa('Rekap tercatat pada sesi', typeof sesiTutup?.totalWajib === 'number',
    `totalWajib=${sesiTutup?.totalWajib}`);

  // ---------------------------------------------------------------
  console.log('\n10. REKAP & LAPORAN');
  const recap = await panggil(`/api/v1/attendance/sessions/${sessionId}/recap`, { token });
  periksa('Rekap sesi dapat dibaca', recap.status === 200 && Boolean(recap.data),
    recap.data?.error?.message ?? `HTTP ${recap.status}`);
  periksa('Rekap memuat anggota yang HADIR', (recap.data?.hadir?.length ?? 0) >= 1,
    `hadir=${recap.data?.hadir?.length}`);
  periksa('Rekap memuat anggota yang IZIN', (recap.data?.izin?.length ?? 0) >= 1,
    `izin=${recap.data?.izin?.length}`);
  periksa('Anggota tanpa catatan otomatis menjadi ABSENT',
    (recap.data?.belumAbsen?.length ?? 0) + (recap.data?.tidakHadir?.length ?? 0) >= 1,
    `tidakHadir=${recap.data?.tidakHadir?.length} belumAbsen=${recap.data?.belumAbsen?.length}`);
  periksa('Statistik rekap konsisten', (recap.data?.statistik?.hadir ?? 0) >= 1,
    JSON.stringify(recap.data?.statistik ?? {}).slice(0, 90));

  const laporan = await panggil(
    `/api/v1/reports/attendance?dari=${hariIni()}&sampai=${hariIni()}`,
    { token },
  );
  periksa('Laporan absensi terbentuk', laporan.status === 200 && (laporan.data?.data?.length ?? 0) > 0,
    laporan.data?.error?.message ?? 'laporan kosong');

  // ---------------------------------------------------------------
  console.log('\n11. OTORISASI — tanpa token harus ditolak');
  const tanpaToken = await panggil('/api/v1/members');
  periksa('Endpoint terlindungi menolak tanpa token', tanpaToken.status === 401,
    `status=${tanpaToken.status}`);
  periksa('Bentuk galat sesuai kontrak',
    tanpaToken.data?.error?.code !== undefined && tanpaToken.data?.error?.message !== undefined,
    JSON.stringify(tanpaToken.data)?.slice(0, 80));

  // ---------------------------------------------------------------
  console.log('\n12. PENUTUPAN');
  console.log(`  ID rapat   : ${rapatId}`);
  console.log(`  ID sesi    : ${sessionId}`);
  console.log(`  Rekap      : wajib=${sesiTutup?.totalWajib} hadir=${sesiTutup?.sudahHadir} ` +
              `izin/sakit/tidak-hadir=${sesiTutup?.sudahAbsen}`);

  // ---------------------------------------------------------------
  console.log('\n' + '─'.repeat(58));
  if (gagal === 0) {
    console.log(`✓ SEMUA ${lolos} PEMERIKSAAN LULUS — alur absensi bekerja end-to-end.`);
    process.exit(0);
  }
  console.log(`✗ ${gagal} gagal dari ${lolos + gagal} pemeriksaan.`);
  process.exit(1);
}

main().catch((e) => {
  console.error('\n✗ Uji terhenti:', e instanceof Error ? e.message : e);
  process.exit(1);
});
