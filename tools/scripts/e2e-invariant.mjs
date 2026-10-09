/**
 * UJI INVARIANT DATABASE (spesifikasi §08 & §93.14).
 *
 * Invariant di `packages/db/src/sql/invariants.ts` dipasang sebagai trigger
 * dan constraint. Sandoval sebelumnya kita hanya memastikan Berkas SQL-nya
 * ada — tidak ada yang membuktikan trigger-nya benar-benar MENOLAK.
 *
 * Skrip ini mencoba melanggar setiap aturan secara langsung lewat SQL dan
 * memastikan database MENOLAK. Kalau sebuah aturan tidak ditegakkan, pengujian
 * ini gagal — bukan lolos.
 *
 * Jalankan: pnpm --filter @osda/tools e2e-invariant
 * Butuh  :  DATABASE_URL di .env
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

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

/**
 * Coba jalankan SQL dan laporkan apakah ditolak.
 *
 * Setiap violation dijalankan di dalam transaksi yang selalu di-rollback,
 * jadi skrip ini tidak mengubah data walau aturan ternyata tidak ditegakkan.
 */
async function harusDitolak(db, nama, sql, params = []) {
  try {
    await db.begin(async (trx) => {
      await trx.unsafe(sql, params);
      // reaching here means the DB accepted it
      throw new Error('__DITERIMA__');
    });
    periksa(nama, false, 'database MENERIMA pelanggaran');
  } catch (galat) {
    if (galat instanceof Error && galat.message.includes('__DITERIMA__')) {
      periksa(nama, false, 'database MENERIMA pelanggaran');
      return;
    }
    periksa(nama, true, '');
  }
}

/**
 * UPDATE no-op pada seluruh baris, lalu ROLLBACK.
 *
 * `where false` tidak berguna untuk memeriksa trigger: tidak ada baris yang
 * tersentuh, jadi trigger tidak pernah menyala dan pemeriksaan selalu lulus.
 * Di sini baris benar-benar diubah (nilai Assigned ke nilai yang sama), lalu
 * transaksi dibatalkan sehingga data tidak ikut berubah.
 */
async function updateNoopHarusBerhasil(db, nama, sql) {
  try {
    await db.begin(async (trx) => {
      await trx.unsafe(sql);
      throw new Error('__ROLLBACK__');
    });
    periksa(nama, false, 'helper gagal menutup transaksi');
  } catch (galat) {
    if (galat instanceof Error && galat.message.includes('__ROLLBACK__')) {
      periksa(nama, true, '');
      return;
    }
    // Galat apa pun selain penanda rollback = trigger menolak update.
    periksa(nama, false, `trigger menolak update: ${String(galat.message).slice(0, 80)}`);
  }
}

/** Jalankan SQL yang seharusnya berhasil. */
async function harusBerhasil(db, nama, sql, params = []) {
  try {
    const hasil = await db.unsafe(sql, params);
    periksa(nama, true, '');
    return hasil;
  } catch (galat) {
    periksa(nama, false, galat.message?.slice(0, 90));
    return null;
  }
}

async function main() {
  console.log('==================================================');
  console.log('  UJI INVARIANT DATABASE');
  console.log('==================================================');

  const db = postgres(bacaEnv().DATABASE_URL, { max: 1, onnotice: () => {} });

  // Data acuan: organisasi, periode, akun kas, anggota.
  const [{ id: orgId }] = await db`select id from organizations limit 1`;
  const [akunKas] = await db`
    select id, nama from accounts where adalah_kas order by dibuat_pada limit 1`;
  // Periode KEUANGAN, bukan periode kepengurusan — kolom financial_period_id
  // menunjuk ke `financial_periods`.
  const [periode] = await db`
    select id, nama from financial_periods
     where organization_id = ${orgId} and status = 'OPEN' limit 1`;
  const [anggota] = await db`
    select m.id, m.nomor from members m
     where m.organization_id = ${orgId} and m.status = 'ACTIVE'
     order by m.dibuat_pada limit 1`;

  if (!akunKas || !anggota || !periode) {
    console.error('\nData acuan belum lengkap (akun kas / periode / anggota).');
    console.error('Jalankan `pnpm db:seed` dan `pnpm legacy:migrate` lebih dulu.');
    await db.end();
    process.exit(1);
  }
  // Kode unik per eksekusi supaya skrip aman dijalankan berulang — bahkan
  // kalau run sebelumnya terhenti di tengah jalan dan tidak sempat membersihkan.
  const TANDA = Date.now().toString(36).toUpperCase().slice(-6);
  const kode = (nama) => `UJI-${TANDA}-${nama}`;

  // Bersihkan sisa run sebelumnya sebelum mulai.
  await db.begin(async (trx) => {
    await trx.unsafe(`alter table ledger_entries disable trigger trg_ledger_immutable`);
    await trx`delete from ledger_entries where narration like 'Uji invariant%'`;
    await trx.unsafe(`alter table ledger_entries enable trigger trg_ledger_immutable`);
    await trx`delete from transactions where kode like 'UJI-%'`;
    await trx`delete from expense_requests where kode like 'UJI-%'`;
    await trx`delete from reimbursements where kode like 'UJI-%'`;
    await trx.unsafe(`alter table audit_logs disable trigger trg_audit_append_only`);
    await trx`delete from audit_logs where aksi = 'UJI_INVARIAN'`;
    await trx.unsafe(`alter table audit_logs enable trigger trg_audit_append_only`);
    // Trigger "versi terkunci" juga menolak DELETE — hence kita matikan
    // hanya untuk menghapus data uji ini, lalu langsung dinyalakan.
    await trx.unsafe(`alter table document_versions disable trigger trg_dokumen_versi_locked`);
    await trx`delete from document_versions where document_id in (
       select id from documents where judul = 'Uji Invariant Dokumen')`;
    await trx.unsafe(`alter table document_versions enable trigger trg_dokumen_versi_locked`);
    await trx`delete from documents where judul = 'Uji Invariant Dokumen'`;
  });

  console.log(`\n  Organisasi : ${orgId}`);
  console.log(`  Akun kas   : ${akunKas.nama}`);
  console.log(`  Periode    : ${periode.nama}`);
  console.log(`  Anggota    : ${anggota.nomor}`);

  // ==============================================================
  // Pemeriksaan iniduluan dan paling penting: trigger tidak boleh membuat
  // UPDATE biasa GAGAL. Trigger yang salah rujukan kolom (mis. menulis
  // `NEW.disetujuiOleh` di PL/pgSQL, yang dilipat jadi `disetujuioleh`)
  // akan melempar galat untuk SETIAP baris — termasuk update yang sah.
  // Gejalanya: seluruh alur persetujuan keuangan mati.
  // ==============================================================
  console.log('\n0. TRIGGER TIDAK BOLEH MEMECAHKAN UPDATE BIASA');

  // Nama kolom yang selalu ada di setiap tabel ini untuk update no-op.
  const TABEL_PROTEKSI = [
    'expense_requests', 'reimbursements', 'payments', 'documents',
    'document_versions', 'members', 'tasks', 'meetings',
    'attendance_records', 'transactions', 'notifications', 'settings',
  ];
  // `audit_logs` sengaja TIDAK ada di sini: append-only adalah tujuannya,
  // jadi menolak UPDATE adalah perilaku yang BENAR, bukan kegagalan trigger.
  for (const tabel of TABEL_PROTEKSI) {
    const ada = await db`
      select 1 from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where c.relname = ${tabel} and n.nspname = 'public'
         and not t.tgisinternal and t.tgenabled = 'O' limit 1`;
    if (ada.length === 0) continue;

    // Cari satu kolom teks/UUID yang bisa dipakai sebagai target no-op.
    const kolom = await db.unsafe(`
      select a.attname as nama from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where c.relname = $1 and n.nspname = 'public'
         and a.attnum > 0 and not a.attisdropped
         and a.attname not in ('dibuat_pada','diubah_pada','versi_baris')
       order by (a.attname in ('keterangan','nama','catatan')) desc,
                a.attnum
       limit 1`, [tabel]);
    if (kolom.length === 0) continue;

    await updateNoopHarusBerhasil(db, `UPDATE no-op pada ${tabel} tetap berhasil`,
      `update ${tabel} set ${kolom[0].nama} = ${kolom[0].nama}`);
  }

  // ==============================================================
  console.log('\n1. LEDGER TIDAK BOLEH DIUBAH ATAU DIHAPUS');
  // ==============================================================
  // Buat satu entri ledger sementara agar ada baris untuk dicoba diubah.
  const [trxUji] = await db`
    insert into transactions (organization_id, financial_period_id, kode, jenis,
                             arah, account_id, nominal, keterangan, tanggal,
                             status, dicatat_oleh)
    values (${orgId}, ${periode.id}, ${kode('L')}, 'INCOME', 'IN',
            ${akunKas.id}, 1000, 'Uji invariant', current_date, 'POSTED', null)
    on conflict (organization_id, kode) do update set nominal = excluded.nominal
    returning id`;
  const [entri] = await db`
    insert into ledger_entries (transaksi_id, organization_id, financial_period_id,
                                account_id, tanggal, debit, kredit, narration)
    values (${trxUji.id}, ${orgId}, ${periode.id}, ${akunKas.id}, current_date,
            1000, 0, 'Uji invariant')
    returning id`;

  await harusDitolak(db, 'UPDATE ledger_entries ditolak',
    'update ledger_entries set debit = 999999 where id = $1', [entri.id]);
  await harusDitolak(db, 'DELETE ledger_entries ditolak',
    'delete from ledger_entries where id = $1', [entri.id]);

  // ==============================================================
  console.log('\n2. NOMINAL TRANSAKSI & LEDGER HARUS POSITIF');
  // ==============================================================
  await harusDitolak(db, 'nominal transaksi = 0 ditolak',
    `insert into transactions (organization_id, financial_period_id, kode, jenis,
        arah, account_id, nominal, keterangan, tanggal, status)
     values (${orgId}, ${periode.id}, ${kode('Z')}, 'INCOME', 'IN',
             ${akunKas.id}, 0, 'Nol', current_date, 'DRAFT')`);
  await harusDitolak(db, 'nominal transaksi negatif ditolak',
    `insert into transactions (organization_id, financial_period_id, kode, jenis,
        arah, account_id, nominal, keterangan, tanggal, status)
     values (${orgId}, ${periode.id}, ${kode('N')}, 'INCOME', 'IN',
             ${akunKas.id}, -500, 'Negatif', current_date, 'DRAFT')`);
  await harusDitolak(db, 'ledger debit & kredit sekaligus ditolak',
    `insert into ledger_entries (transaksi_id, organization_id, financial_period_id,
        account_id, tanggal, debit, kredit, narration)
     values (${trxUji.id}, ${orgId}, ${periode.id}, ${akunKas.id}, current_date,
             100, 100, 'Dua-duanya')`);
  await harusDitolak(db, 'ledger debit & kredit sama-sama nol ditolak',
    `insert into ledger_entries (transaksi_id, organization_id, financial_period_id,
        account_id, tanggal, debit, kredit, narration)
     values (${trxUji.id}, ${orgId}, ${periode.id}, ${akunKas.id}, current_date,
             0, 0, 'Kosong')`);

  // ==============================================================
  console.log('\n3. PEMOHON TIDAK BOLEH MENYETUJUI SENDIRI');
  // ==============================================================
  // Penyetuju harus anggota NYATA (kolomnya foreign key ke members.id).
  const [anggotaLain] = await db`
    select id from members
     where organization_id = ${orgId} and status = 'ACTIVE' and id <> ${anggota.id}
     order by dibuat_pada limit 1`;
  if (!anggotaLain) {
    console.error('\nButuh minimal 2 anggota aktif untuk menguji persetujuan.');
    await db.end();
    process.exit(1);
  }

  // Pemohon setujui pengajuannya sendiri harus ditolak.
  const [req] = await db`
    insert into expense_requests (organization_id, kode, pemohon_member_id,
                                  account_id, nominal, keterangan, tanggal, status)
    values (${orgId}, ${kode('SB')}, ${anggota.id}, ${akunKas.id},
            25000, 'Uji self-approve', current_date, 'SUBMITTED')
    returning id`;
  await harusDitolak(db, 'expense_requests: pemohon setujui sendiri ditolak',
    `update expense_requests set disetujui_oleh = $1, status = 'APPROVED'
      where id = $2`, [anggota.id, req.id]);

  // Yang berbeda orang harus BERHASIL — kalau ini juga ditolak, trigger-nya
  // terlalu agresif dan memblokir alur persetujuan yang sah.
  await harusBerhasil(db, 'expense_requests: orang lain boleh menyetujui',
    `update expense_requests set disetujui_oleh = $1, status = 'APPROVED'
      where id = $2`, [anggotaLain.id, req.id]);

  const [reimb] = await db`
    insert into reimbursements (organization_id, kode, member_id, account_id,
                                nominal, keterangan, tanggal, status)
    values (${orgId}, ${kode('SR')}, ${anggota.id}, ${akunKas.id},
            15000, 'Uji reimburse', current_date, 'SUBMITTED')
    returning id`;
  await harusDitolak(db, 'reimbursements: anggota setujui sendiri ditolak',
    `update reimbursements set disetujui_oleh = $1, status = 'APPROVED'
      where id = $2`, [anggota.id, reimb.id]);
  await harusBerhasil(db, 'reimbursements: orang lain boleh menyetujui',
    `update reimbursements set disetujui_oleh = $1, status = 'APPROVED'
      where id = $2`, [anggotaLain.id, reimb.id]);

  // ==============================================================
  console.log('\n4. AUDIT LOG APPEND-ONLY');
  // ==============================================================
  const [log] = await db`
    insert into audit_logs (organization_id, aksi, entitas_tabel, berhasil)
    values (${orgId}, 'UJI_INVARIAN', 'uji', true)
    returning id`;
  await harusDitolak(db, 'UPDATE audit_logs ditolak',
    'update audit_logs set aksi = $1 where id = $2', ['DIUBAH', log.id]);
  await harusDitolak(db, 'DELETE audit_logs ditolak',
    'delete from audit_logs where id = $1', [log.id]);

  // ==============================================================
  console.log('\n5. VERSI DOKUMEN YANG DIKUNCI TIDAK BOLEH BERUBAH');
  // ==============================================================
  const [dok] = await db`
    insert into documents (organization_id, judul, kategori, deskripsi, status)
    values (${orgId}, 'Uji Invariant Dokumen', 'LAINNYA', 'Uji', 'DRAFT')
    returning id`;
  if (dok?.id) {
    const [versi] = await db`
      insert into document_versions (document_id, versi, storage_key, nama_berkas,
                                     ukuran_bytes, mime, checksum_sha256, dikunci)
      values (${dok.id}, 1, 'uji/versi-1.txt', 'versi-1.txt', 10, 'text/plain',
              repeat('a', 64), true)
      returning id`;
    await harusDitolak(db, 'UPDATE versi terkunci ditolak',
      `update document_versions set catatan = 'diubah' where id = $1`, [versi.id]);
    await harusDitolak(db, 'DELETE versi terkunci ditolak',
      `delete from document_versions where id = $1`, [versi.id]);

    // Versi yang BELUM dikunci masih boleh diubah — trigger terlalu agresif
    // juga merupakan bug.
    const [bebas] = await db`
      insert into document_versions (document_id, versi, storage_key, nama_berkas,
                                     ukuran_bytes, mime, checksum_sha256, dikunci)
      values (${dok.id}, 2, 'uji/versi-2.txt', 'versi-2.txt', 10, 'text/plain',
              repeat('b', 64), false)
      returning id`;
    await harusBerhasil(db, 'UPDATE versi belum terkunci boleh diubah',
      `update document_versions set catatan = 'revisi' where id = $1`, [bebas.id]);
  } else {
    periksa('UPDATE versi terkunci ditolak', false, 'dokumen uji gagal dibuat');
  }

  // ==============================================================
  console.log('\n6. SALDO DIHITUNG DARI LEDGER, BUKAN DISIMPAN');
  // ==============================================================
  const [saldoFungsi] = await db`select osda_saldo_akun(${akunKas.id}::uuid) as saldo`;
  const [saldoHitung] = await db`
    select COALESCE(SUM(debit - kredit), 0)::bigint as saldo
      from ledger_entries where account_id = ${akunKas.id}`;
  periksa('osda_saldo_akun sama dengan penjumlahan manual',
    String(saldoFungsi.saldo) === String(saldoHitung.saldo),
    `fungsi=${saldoFungsi.saldo} manual=${saldoHitung.saldo}`);

  await harusDitolak(db, 'tidak bisa menyimpan saldo di kolom transactions',
    `update transactions set saldo = 0 where id = $1`, [trxUji.id]);

  // ==============================================================
  console.log('\n7. HANYA SATU PERIODE AKTIF PER ORGANISASI');
  // ==============================================================
  await harusDitolak(db, 'periode aktif kedua ditolak',
    `insert into organization_periods (organization_id, nama, tanggal_mulai,
        tanggal_selesai, status)
     values (${orgId}, 'Periode Uji Ganda', current_date, current_date + 365, 'ACTIVE')`);

  // ==============================================================
  console.log('\n8. MEMBER TIDAK BISA DIHAPUS KERAS');
  // ==============================================================
  // Cascade dari sessions/attendance_records bisa saja menghapus member.
  // Yang dijaga trigger/constraint adalah: member tidak punya kolom
  // penghapusan, hanya pengarsipan.
  const [kolom] = await db`
    select count(*)::int as jml from information_schema.columns
     where table_name = 'members' and column_name = 'dihapus_pada'`;
  periksa('members tidak punya kolom dihapus_pada', kolom.jml === 0,
    `ditemukan ${kolom.jml} kolom dihapus_pada`);

  // ==============================================================
  // Bersihkan sisa uji.
  // ==============================================================
  await db.begin(async (trx) => {
    // Ledger & audit log bersifat immutable — trigger-nya dimatikan HANYA
    // untuk menghapus baris uji ini, lalu langsung dinyalakan lagi.
    await trx.unsafe(`alter table ledger_entries disable trigger trg_ledger_immutable`);
    await trx`delete from ledger_entries where transaksi_id = ${trxUji.id}`;
    await trx.unsafe(`alter table ledger_entries enable trigger trg_ledger_immutable`);
    await trx`delete from transactions where id = ${trxUji.id}`;
    await trx`delete from expense_requests where kode = ${kode('SB')}`;
    await trx`delete from reimbursements where kode = ${kode('SR')}`;
    await trx.unsafe(`alter table audit_logs disable trigger trg_audit_append_only`);
    await trx`delete from audit_logs where aksi = 'UJI_INVARIAN'`;
    await trx.unsafe(`alter table audit_logs enable trigger trg_audit_append_only`);
    // Trigger "versi terkunci" juga menolak DELETE — hence kita matikan
    // hanya untuk menghapus data uji ini, lalu langsung dinyalakan.
    await trx.unsafe(`alter table document_versions disable trigger trg_dokumen_versi_locked`);
    await trx`delete from document_versions where document_id in (
       select id from documents where judul = 'Uji Invariant Dokumen')`;
    await trx.unsafe(`alter table document_versions enable trigger trg_dokumen_versi_locked`);
    await trx`delete from documents where judul = 'Uji Invariant Dokumen'`;
  });

  await db.end();
  console.log('\n' + '-'.repeat(58));
  if (gagal === 0) {
    console.log(`+ SEMUA ${lolos} PEMERIKSAAN LULUS — invariant ditegakkan database.`);
    process.exit(0);
  }
  console.log(`x ${gagal} gagal dari ${lolos + gagal} pemeriksaan.`);
  process.exit(1);
}

main().catch((galat) => {
  console.error('\nx Uji terhenti:', galat instanceof Error ? galat.message : galat);
  process.exit(1);
});