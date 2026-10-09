/**
 * UJI ALUR TUGAS & PROGRAM END-TO-END.
 *
 * Dua aturan domain yang paling sering dilanggar, dan belum pernah dibuktikan
 * lewat HTTP:
 *
 *  1. **DONE ≠ VERIFIED** (spesifikasi §93.2). Menandai tugas selesai
 *    vigor TIDAK berarti tugasnya sudah diperiksa. Kalau keduanya disamakan,
 *  siapa pun bisa menutup tugas temannya sendiri dan hasil kerja semua
 *  menganggapnya sah.
 *  2. **Program tidak boleh mundur bebas** (spesifikasi §93.3). Program yang
 *     sudah `COMPLETED` tidak boleh kembali menjadi `RUNNING` tanpa jalur
 *     koreksi yang eksplisit.
 *
 * Jalankan: pnpm --filter @osda/tools e2e-alur
 * Butuh  :  API OSDA hidup di $API_URL (default http://localhost:4000)
 *           akun uji sudah dibuat (`pnpm akun-uji`)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AKAR = resolve(import.meta.dirname, '../..');
const API = process.env.API_URL ?? 'http://localhost:4000';
const SANDI_UJI = process.env.UJI_PASSWORD ?? 'UjiPeran#2026';

let lolos = 0;
let gagal = 0;

/** Cetak hasil satu pemeriksaan. */
function periksa(nama, kondisi, keterangan = '') {
  if (kondisi) {
    lolos += 1;
    console.log(`    + ${nama}`);
  } else {
    gagal += 1;
    console.log(`    x ${nama}${keterangan ? ` — ${keterangan}` : ''}`);
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

const hariIni = () => new Date().toISOString().slice(0, 10);
const nanti = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

async function main() {
  console.log('==================================================');
  console.log('  UJI ALUR TUGAS & PROGRAM END-TO-END');
  console.log('==================================================');
  console.log(`  API: ${API}\n`);

  const hidup = await panggil('/health/ready');
  if (hidup.status !== 200) {
    console.error('API tidak hidup. Jalankan `pnpm start` lebih dulu.');
    process.exit(1);
  }

  // ---------------------------------------------------------------
  console.log('1. MASUK');
  // ---------------------------------------------------------------
  const sekretaris = await masuk('uji+secretary@osda.local');
  periksa('Sekretaris bisa masuk', sekretaris.ok, sekretaris.pesan ?? `HTTP ${sekretaris.status}`);
  if (!sekretaris.ok) process.exit(1);

  const anggota = await masuk('uji+member@osda.local');
  periksa('Anggota bisa masuk', anggota.ok, anggota.pesan ?? '');

  const ketua = await masuk('uji+chairperson@osda.local');
  periksa('Ketua bisa masuk', ketua.ok, ketua.pesan ?? '');

  const koordinator = await masuk('uji+coordinator@osda.local');
  periksa('Koordinator bisa masuk', koordinator.ok, koordinator.pesan ?? '');

  const orgId = sekretaris.pengguna.organizationIds[0];
  const memberId = sekretaris.pengguna.memberId;

  // ---------------------------------------------------------------
  console.log('\n2. TUGAS — DONE BUKAN BERARTI VERIFIED');
  // ---------------------------------------------------------------
  const tugas = await panggil('/api/v1/tasks', {
    metode: 'POST',
    token: sekretaris.token,
    badan: {
      organizationId: orgId,
      judul: `Uji DONE vs VERIFIED ${new Date().toISOString().slice(11, 19)}`,
      deskripsi: 'Tugas untuk membuktikan bahwa DONE tidak sama dengan VERIFIED.',
      assigneeMemberIds: [memberId],
      batasWaktu: nanti(),
      butuhVerifikasi: true,
    },
  });
  periksa('Tugas berhasil dibuat', tugas.status === 201 && Boolean(tugas.data?.id),
    tugas.data?.error?.message ?? `HTTP ${tugas.status}`);
  if (!tugas.data?.id) process.exit(1);
  const tugasId = tugas.data.id;
  periksa('Tugas baru berstatus TODO', tugas.data.status === 'TODO',
    `status=${tugas.data.status}`);
  periksa('Tugas ditandai butuh verifikasi',
    tugas.data.butuhVerifikasi === true || tugas.data.verifikasi === 'PENDING',
    `butuhVerifikasi=${tugas.data.butuhVerifikasi}`);

  // Alur normal: TODO → IN_PROGRESS → DONE
  for (const status of ['IN_PROGRESS', 'DONE']) {
    const ubah = await panggil(`/api/v1/tasks/${tugasId}/status`, {
      metode: 'POST',
      token: sekretaris.token,
      badan: { status },
    });
    periksa(`Status tugas → ${status}`, ubah.status === 200 && ubah.data?.status === status,
      ubah.data?.error?.message ?? `HTTP ${ubah.status}`);
  }

  // Di_status DONE, tapi BELUM diverifikasi.
  const setelahDone = await panggil(`/api/v1/tasks/${tugasId}`, { token: sekretaris.token });
  periksa('Setelah DONE, verifikasi belum berstatus VERIFIED',
    setelahDone.data?.verifikasi !== 'VERIFIED',
    `verifikasi=${setelahDone.data?.verifikasi}`);
  periksa('Setelah DONE, belum ada yang memverifikasi',
    !setelahDone.data?.diverifikasiOleh,
    `diverifikasiOleh=${setelahDone.data?.diverifikasiOleh}`);

  // Verifikasi harus butuh permission tersendiri.
  const verifikasiTanpaIzin = await panggil(`/api/v1/tasks/${tugasId}/verifikasi`, {
    metode: 'POST',
    token: anggota.token,
    badan: { keputusan: 'VERIFIED', komentar: 'Saya verifikasi sendiri.' },
  });
  periksa('Anggota biasa tidak boleh memverifikasi tugas',
    verifikasiTanpaIzin.status === 403,
    `status=${verifikasiTanpaIzin.status} (diharapkan 403)`);

  // Penilai yang benar-benar diberi wewenang.
  const verifikasi = await panggil(`/api/v1/tasks/${tugasId}/verifikasi`, {
    metode: 'POST',
    token: ketua.token,
    badan: { keputusan: 'VERIFIED', komentar: 'Sudah diperiksa, lengkap.' },
  });
  periksa('Ketua dapat memverifikasi tugas',
    verifikasi.status === 200 || verifikasi.status === 201,
    verifikasi.data?.error?.message ?? `HTTP ${verifikasi.status}`);

  const setelahVerifikasi = await panggil(`/api/v1/tasks/${tugasId}`, { token: sekretaris.token });
  periksa('Setelah diverifikasi, verifikasi = VERIFIED',
    setelahVerifikasi.data?.verifikasi === 'VERIFIED',
    `verifikasi=${setelahVerifikasi.data?.verifikasi}`);
  periksa('Verifikasi mencatat siapa yang memeriksa',
    Boolean(setelahVerifikasi.data?.diverifikasiOleh),
    `diverifikasiOleh=${setelahVerifikasi.data?.diverifikasiOleh}`);

  // ---------------------------------------------------------------
  console.log('\n3. TUGAS — TRANSISI YANG TIDAK SAH');
  // ---------------------------------------------------------------
  // TODO tidak boleh langsung DONE — harus dikerjakan dulu.
  const tugas2 = await panggil('/api/v1/tasks', {
    metode: 'POST',
    token: sekretaris.token,
    badan: {
      organizationId: orgId,
      judul: `Uji transisi langsung ${new Date().toISOString().slice(11, 19)}`,
      assigneeMemberIds: [memberId],
      batasWaktu: nanti(),
      butuhVerifikasi: false,
    },
  });
  if (tugas2.data?.id) {
    const langsung = await panggil(`/api/v1/tasks/${tugas2.data.id}/status`, {
      metode: 'POST',
      token: sekretaris.token,
      badan: { status: 'DONE' },
    });
    periksa('TODO → DONE langsung ditolak', langsung.status === 409,
      `status=${langsung.status} (diharapkan 409)`);

    const keDibatalkan = await panggil(`/api/v1/tasks/${tugas2.data.id}/status`, {
      metode: 'POST',
      token: sekretaris.token,
      badan: { status: 'CANCELLED' },
    });
    periksa('TODO → CANCELLED boleh', keDibatalkan.status === 200,
      keDibatalkan.status === 200 ? '' : `HTTP ${keDibatalkan.status}`);
  } else {
    periksa('Tugas kedua berhasil dibuat', false,
      tugas2.data?.error?.message ?? `HTTP ${tugas2.status}`);
  }

  // ---------------------------------------------------------------
  console.log('\n4. PROGRAM — URUTAN STATUS & LARANGAN MUNDUR');
  // ---------------------------------------------------------------
  const program = await panggil('/api/v1/programs', {
    metode: 'POST',
    token: sekretaris.token,
    badan: {
      organizationId: orgId,
      nama: `Uji alur program ${new Date().toISOString().slice(11, 19)}`,
      tujuan: 'Membuktikan program tidak bisa mundur bebas tanpa koreksi.',
      deskripsi: 'Program untuk menguji state machine program.',
      ownerMemberId: memberId,
      mulaiPada: hariIni(),
      selesaiPada: nanti(),
    },
  });
  periksa('Program berhasil dibuat', program.status === 201 && Boolean(program.data?.id),
    program.data?.error?.message ?? `HTTP ${program.status}`);

  if (!program.data?.id) {
    console.log('\nProgram tidak bisa dibuat — pemeriksaan sebelumnya tetap sah.');
  } else {
    const programId = program.data.id;
    periksa('Program baru berstatus DRAFT', program.data.status === 'DRAFT',
      `status=${program.data.status}`);

    // Alur normal melibatkan DUA aktor, karena persetujuan bukan wewenang
    // pengelola: DRAFT → PROPOSED → APPROVED → PLANNED → RUNNING → COMPLETED.
    //  - program.create : sekretaris
    //  - program.manage : koordinator
    //  - program.approve: ketua
    const lompat = await panggil(`/api/v1/programs/${programId}/status`, {
      metode: 'POST',
      token: koordinator.token,
      badan: { status: 'RUNNING' },
    });
    periksa('DRAFT → RUNNING langsung ditolak', lompat.status === 409,
      `status=${lompat.status} (diharapkan 409)`);

    const keProposed = await panggil(`/api/v1/programs/${programId}/status`, {
      metode: 'POST',
      token: koordinator.token,
      badan: { status: 'PROPOSED' },
    });
    periksa('DRAFT → PROPOSED oleh koordinator', keProposed.status === 200,
      keProposed.data?.error?.message ?? `HTTP ${keProposed.status}`);

    // Persetujuan bukan wewenang pengelola — harus kepala.
    const approvedSekretaris = await panggil(`/api/v1/programs/${programId}/status`, {
      metode: 'POST',
      token: sekretaris.token,
      badan: { status: 'APPROVED' },
    });
    periksa('Sekretaris tidak boleh menyetujui program',
      approvedSekretaris.status === 403,
      `status=${approvedSekretaris.status} (diharapkan 403)`);

    for (const [status, aktor] of [
      ['APPROVED', ketua],
      ['PLANNED', koordinator],
      ['RUNNING', koordinator],
      ['COMPLETED', koordinator],
    ]) {
      const ubah = await panggil(`/api/v1/programs/${programId}/status`, {
        metode: 'POST',
        token: aktor.token,
        badan: { status },
      });
      periksa(`Status program → ${status} (${aktor === ketua ? 'ketua' : 'koordinator'})`,
        (ubah.status === 200 || ubah.status === 201) && ubah.data?.status === status,
        ubah.data?.error?.message ?? `HTTP ${ubah.status}`);
      if (ubah.status >= 400) break;
    }

    const selesai = await panggil(`/api/v1/programs/${programId}`, { token: sekretaris.token });
    periksa('Program berakhir di COMPLETED', selesai.data?.status === 'COMPLETED',
      `status=${selesai.data?.status}`);
    periksa('Program mencatat siapa yang menyetujui',
      Boolean(selesai.data?.disetujuiOleh),
      `disetujuiOleh=${selesai.data?.disetujuiOleh}`);

    // COMPLETED tidak boleh mundur tanpa koreksi eksplisit.
    //
    // Menuju APPROVED ditolak lebih awal — di level izin (403), karena
    // koordinator memang tidak memegang `program.approve`. Menuju status lain
    // ditolak karena transisinya tidak sah (409). Dua-duanya berarti "ditolak",
    // tapi dengan alasan berbeda — itu yang diuji di sini.
    for (const [target, diharapkan] of [
      ['RUNNING', [409]],
      ['DRAFT', [409]],
      ['APPROVED', [403, 409]],
    ]) {
      const mundur = await panggil(`/api/v1/programs/${programId}/status`, {
        metode: 'POST',
        token: koordinator.token,
        badan: { status: target },
      });
      periksa(`COMPLETED → ${target} tanpa koreksi ditolak`,
        diharapkan.includes(mundur.status),
        `status=${mundur.status} (diharapkan ${diharapkan.join('/')})`);
    }

    // Jalur koreksi privileged. Kalau siapa pun boleh memakai flag ini,
    // aturan "tidak boleh mundur" jadi tidak berarti apa-apa.
    const koreksi = await panggil(`/api/v1/programs/${programId}/status`, {
      metode: 'POST',
      token: koordinator.token,
      badan: {
        status: 'RUNNING',
        koreksiPrivileged: true,
        komentar: 'Program perlu dilanjutkan karena ada kegiatan baru.',
      },
    });
    periksa('koreksiPrivileged oleh KOORDINATOR ditolak',
      koreksi.status === 403,
      `status=${koreksi.status} — berarti koreksi tidak punya batas wewenang`);

    // Yang memang berwenang boleh memakai jalur koreksi.
    const koreksiKetua = await panggil(`/api/v1/programs/${programId}/status`, {
      metode: 'POST',
      token: ketua.token,
      badan: {
        status: 'RUNNING',
        koreksiPrivileged: true,
        komentar: 'Program dilanjutkan resmi oleh ketua.',
      },
    });
    periksa('koreksiPrivileged oleh KETUA diizinkan',
      koreksiKetua.status === 200,
      `status=${koreksiKetua.status} — ${koreksiKetua.data?.error?.message ?? ''}`);

    const setelahKoreksi = await panggil(`/api/v1/programs/${programId}`, { token: sekretaris.token });
    periksa('Status program setelah koreksi = RUNNING',
      setelahKoreksi.data?.status === 'RUNNING',
      `status=${setelahKoreksi.data?.status}`);
  }

  // ---------------------------------------------------------------
  console.log('\n5. LAPORAN');
  // ---------------------------------------------------------------
  const laporanTugas = await panggil('/api/v1/reports/tasks', { token: sekretaris.token });
  periksa('Laporan tugas dapat dibaca', laporanTugas.status === 200,
    `HTTP ${laporanTugas.status}`);
  const laporanProgram = await panggil('/api/v1/reports/programs', { token: sekretaris.token });
  periksa('Laporan program dapat dibaca', laporanProgram.status === 200,
    `HTTP ${laporanProgram.status}`);

  console.log('\n' + '-'.repeat(58));
  if (gagal === 0) {
    console.log(`+ SEMUA ${lolos} PEMERIKSAAN LULUS — alur tugas & program benar.`);
    process.exit(0);
  }
  console.log(`x ${gagal} gagal dari ${lolos + gagal} pemeriksaan.`);
  process.exit(1);
}

main().catch((galat) => {
  console.error('\nx Uji terhenti:', galat instanceof Error ? galat.message : galat);
  process.exit(1);
});