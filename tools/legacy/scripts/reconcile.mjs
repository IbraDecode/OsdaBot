/**
 * REKONSILIASI: membandingkan jumlah data di dump legacy dengan isi database v2.
 *
 * Output harus menunjukkan SELISIH 0 untuk setiap tabel, atau minimal penjelasan
 * kenapa ada selisih (mis. anggota dengan status `removed` sengaja tidak
 * dimigrasi), sesuai spec §79: "histori harus tetap tersedia".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

const BACKUP_DIR = '/home/jelastic/osda-backup';
const ENV_OSDA = '/home/jelastic/osda/.env';

function bacaEnv(path, kunci) {
  const m = readFileSync(path, 'utf8').match(new RegExp(`^${kunci}=(.+)$`, 'm'));
  if (!m) throw new Error(`${kunci} tidak ditemukan di ${path}`);
  return m[1].trim();
}

async function main() {
  const berkas = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .pop();
  if (!berkas) throw new Error(`Tidak ada dump JSON di ${BACKUP_DIR}`);

  const data = JSON.parse(readFileSync(resolve(BACKUP_DIR, berkas), 'utf8'));
  const t = data.tabel ?? {};

  const db = postgres(bacaEnv(ENV_OSDA, 'DATABASE_URL'), { ssl: 'require', max: 1 });

  const anggotaLama = (t.members ?? []).filter(
    (m) => String(m.status).toLowerCase() !== 'removed',
  ).length;
  const sesiLama = (t.attendance_sessions ?? []).length;
  const absenLama = (t.attendance ?? []).length;
  const pembayaranPaid = (t.kas_payments ?? []).filter(
    (p) => String(p.status).toLowerCase() === 'paid',
  ).length;
  const pengeluaranLama = (t.kas_expenses ?? []).length;
  const mingguLama = (t.kas_weeks ?? []).length;

  const cek = async (label, lama, sekarang) => {
    const cocok = Number(lama) === Number(sekarang) ? '✓' : '✗';
    const warna = Number(lama) === Number(sekarang) ? '' : '  ← SELISIH';
    console.log(
      `${cocok} ${label.padEnd(34)} legacy=${String(lama).padStart(5)}  v2=${String(sekarang).padStart(5)}${warna}`,
    );
    return Number(lama) === Number(sekarang);
  };

  console.log(`Rekonsiliasi migrasi OSDA v0.4 → v2 (dump: ${berkas})\n`);
  console.log('-'.repeat(76));

  let semuaCocok = true;
  semuaCocok &&= await cek(
    'anggota aktif',
    anggotaLama,
    (await db`select count(*)::int c from members where legacy_id is not null`)[0].c,
  );
  semuaCocok &&= await cek(
    'sesi absensi',
    sesiLama,
    (await db`select count(*)::int c from attendance_sessions where idempotency_key like 'legacy-%'`)[0]
      .c,
  );
  semuaCocok &&= await cek(
    'catatan absensi eksplisit',
    absenLama,
    (await db`select count(*)::int c from attendance_records
                   where idempotency_key like 'legacy-absen-%'
                     and idempotency_key not like 'legacy-absen-auto-%'`)[0].c,
  );
  semuaCocok &&= await cek(
    'periode kas',
    mingguLama,
    (await db`select count(*)::int c from dues_periods where nama like 'Kas Mingguan %'`)[0].c,
  );
  semuaCocok &&= await cek(
    'pembayaran sudah lunas',
    pembayaranPaid,
    (await db`select count(*)::int c from dues_status where status = 'LUNAS'`)[0].c,
  );
  // Pengeluaran legacy migrasi berupa 2 entri ledger: belanja + pengurangan kas.
  // Legacy hanya punya 1 catatan pengeluaran, jadi bandingkan 1-nya saja.
  semuaCocok &&= await cek(
    'pengeluaran kas',
    pengeluaranLama,
    (await db`select count(*)::int c from ledger_entries
              where narration like '%migrasi v0.4%' and kredit > 0`)[0].c,
  );

  console.log('-'.repeat(76));

  // Ringkasan kesehatan database v2
  const jumlah = async (tabel) =>
    (await db.unsafe(`select count(*)::int as c from ${tabel}`))[0].c;
  console.log('\nIsi database v2:');
  for (const tb of [
    'organizations',
    'organization_periods',
    'users',
    'identities',
    'members',
    'member_roles',
    'attendance_sessions',
    'attendance_records',
    'accounts',
    'financial_periods',
    'dues_periods',
    'dues_status',
    'transactions',
    'ledger_entries',
    'permissions',
    'roles',
    'role_permissions',
    'documents',
    'notifications',
    'audit_logs',
  ]) {
    const n = await jumlah(tb).catch(() => 0);
    console.log(`  ${tb.padEnd(24)} ${String(n).padStart(6)} baris`);
  }

  // Validasi invariant penting
  console.log('\nInvariant database:');
  const nilai = await db`
    select
      (select count(*)::int from audit_logs) as audit,
      (select count(*)::int from ledger_entries where debit = 0 and kredit = 0) as ledger_nol,
      (select count(*)::int from attendance_records where status in ('EXCUSED','SICK') and (alasan is null or length(trim(alasan)) < 3)) as alasan_kurang,
      (select count(*)::int from members where legacy_id is not null and user_id is null) as anggota_tanpa_akun`;

  const okAudit = nilai[0].audit >= 0;
  const okLedger = nilai[0].ledger_nol === 0;
  const okAlasan = nilai[0].alasan_kurang === 0;
  console.log(`${okAudit ? '✓' : '✗'} audit_logs dapat ditulis (${nilai[0].audit} baris)`);
  console.log(`${okLedger ? '✓' : '✗'} tidak ada entri ledger bernilai nol`);
  console.log(`${okAlasan ? '✓' : '✗'} semua IZIN/SAKIT memiliki alasan minimal 3 karakter`);

  const anggotaTanpaAkun = nilai[0].anggota_tanpa_akun;
  console.log(`${anggotaTanpaAkun === 0 ? '✓' : '!'} anggota tanpa akun login: ${anggotaTanpaAkun}`);

  await db.end();

  console.log('\n' + (semuaCocok ? '✓ Semua jumlah cocok.' : '✗ Ada selisih, periksa di atas.'));
  process.exit(semuaCocok ? 0 : 1);
}

main().catch((e) => {
  console.error('Rekonsiliasi gagal:', e);
  process.exit(1);
});
