/**
 * MIGRASI DATA OSDA BOT v0.4 → OSDA Platform v2.
 *
 * Alur yang ditegakkan (spec §79):
 *
 *   DATA LAMA (dump JSON/backup SQL)
 *     → mapping (pemetaan kolom lama → entitas baru)
 *     → skema v2
 *     → validasi
 *     → rekonsiliasi
 *     → cutover
 *
 * Aturan:
 *  - Semua entri membawa `legacy_id` agar asal-usulnya bisa dilacak.
 *  - Skrip ini hanya MEMBACA dump; jangan pernah mengubah data legacy.
 *  - Idempoten: baris yang sudah dimigrasi dilewati, tidak digandakan.
 *  - Histori anggota, absensi, dan keuangan tetap tersedia.
 *
 * Pemetaan utama:
 *   members.account_id       → identities (WHATSAPP) → user → members
 *   members                 → members (kelas dipecah: Tingkat + jurusan + sub_kelas)
 *   attendance_sessions     → attendance_sessions (jenis MEETING)
 *   attendance              → attendance_records (+ ABSENT otomatis)
 *   moderators              → member_roles (STAFF)
 *   treasurers              → member_roles (TREASURER)
 *   kas_weeks               → dues_periods
 *   kas_payments            → dues_status + payments + ledger_entries
 *   kas_expenses            → transactions + ledger_entries
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import argon2 from 'argon2';
import postgres from 'postgres';

const BACKUP_DIR = '/home/jelastic/osda-backup';
const ENV_OSDA = '/home/jelastic/osda/.env';

/** Peta status kehadiran legacy → status v2. */
const STATUS_HADIR = {
  HADIR: 'PRESENT',
  TERLAMBAT: 'LATE',
  ALPHA: 'ABSENT',
  IZIN: 'EXCUSED',
  SAKIT: 'SICK',
};

/** Peta status anggota legacy → status v2. */
const STATUS_ANGGOTA = {
  active: 'ACTIVE',
  inactive: 'INACTIVE',
  alumni: 'ALUMNI',
  suspended: 'SUSPENDED',
  removed: 'REMOVED',
};

/** Peta status kehadiran yang boleh dikirim langsung oleh anggota. */
/** Sumber absensi yang sah pada enum `sumber_absensi`. */
const SUMBER_ABSENSI = new Set(['WEB', 'MOBILE', 'WHATSAPP', 'ADMIN', 'QR']);
/** Sumber untuk baris yang dibuat otomatis oleh sistem (ABSENT). */
const SUMBER_SISTEM = 'ADMIN';
const STATUS_DARI_ANGGOTA = new Set(['PRESENT', 'LATE', 'EXCUSED', 'SICK']);

/** Sisip entri ke reject_log bila ada (dipakai untuk baris bermasalah). */
const REJECT = [];

function bacaEnv(path, kunci) {
  const m = readFileSync(path, 'utf8').match(new RegExp(`^${kunci}=(.+)$`, 'm'));
  if (!m) throw new Error(`${kunci} tidak ditemukan di ${path}`);
  return m[1].trim();
}

function tanggal(nilai) {
  if (!nilai) return new Date();
  const d = new Date(nilai);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function keTanggalSQL(nilai) {
  return new Date(tanggal(nilai)).toISOString().slice(0, 10);
}

/** Pecah kelas "X RPL 1" menjadi tingkat, jurusan, dan sub-kelas. */
function pecahKelas(teks) {
  const hasil = { tingkat: 'X', jurusan: null, subKelas: null };
  if (!teks) return hasil;
  const bagian = String(teks).trim().split(/\s+/);
  const tingkat = bagian.shift()?.toUpperCase();
  if (tingkat && ['X', 'XI', 'XII'].includes(tingkat)) hasil.tingkat = tingkat;
  if (bagian.length > 0 && /^[A-Za-z]{2,6}$/.test(bagian[0])) {
    hasil.jurusan = bagian.shift().toUpperCase();
  }
  if (bagian.length > 0 && /^\d$/.test(bagian[0])) hasil.subKelas = bagian[0];
  return hasil;
}

/** Nomor WhatsApp bersih dari JID: "628xxx@s.whatsapp.net" → "628xxx". */
function nomorDariJid(accountId) {
  const digit = String(accountId).split('@')[0].split(':')[0].replace(/\D/g, '');
  return digit.startsWith('62') ? digit : `62${digit}`;
}

/** Bangun kode ISO week "2026-W10" dari tahun + week_num legacy. */
function kodePeriodeKas(year, week) {
  const y = parseInt(year, 10);
  const w = parseInt(week, 10);
  if (Number.isNaN(y) || Number.isNaN(w)) return 'MIGRATED';
  // 4 Januari selalu berada di ISO week 1
  const kamu4Januari = new Date(Date.UTC(y, 0, 4));
  const hariIndex = (kamu4Januari.getUTCDay() + 6) % 7; // Senin = 0
  const awalMinggu = new Date(kamu4Januari);
  awalMinggu.setUTCDate(kamu4Januari.getUTCDate() - hariIndex + (w - 1) * 7);
  return `${awalMinggu.getUTCFullYear()}-W${String(isoWeek(awalMinggu)).padStart(2, '0')}`;
}

function isoWeek(d) {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  target.setUTCDate(target.getUTCDate() - ((target.getUTCDay() + 6) % 7) + 3);
  const kamis1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  return 1 + Math.round((target - kamis1) / (7 * 24 * 3600 * 1000));
}

async function main() {
  const berkas = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .pop();
  if (!berkas) {
    throw new Error(`Tidak ada dump JSON di ${BACKUP_DIR}. Jalankan dump-legacy.mjs lebih dahulu.`);
  }
  const data = JSON.parse(readFileSync(resolve(BACKUP_DIR, berkas), 'utf8'));
  const t = data.tabel ?? {};
  const anggotaLama = t.members ?? [];
  const sesiLama = t.attendance_sessions ?? [];
  const absenLama = t.attendance ?? [];
  const moderatorLama = t.moderators ?? [];
  const bendaharaLama = t.treasurers ?? [];
  const mingguLama = t.kas_weeks ?? [];
  const pembayaranLama = t.kas_payments ?? [];
  const pengeluaranLama = t.kas_expenses ?? [];

  console.log(`▸ Memakai dump: ${berkas}`);
  console.log(
    `  ${anggotaLama.length} anggota, ${sesiLama.length} sesi, ${absenLama.length} absensi, ` +
      `${pembayaranLama.length} pembayaran, ${pengeluaranLama.length} pengeluaran`,
  );

  const db = postgres(bacaEnv(ENV_OSDA, 'DATABASE_URL'), {
    ssl: 'require',
    max: 4,
    connect_timeout: 20,
  });

  // ------------------------------------------------------------------
  // A. Organisasi & periode wajib ada (dibuat oleh seed/setup)
  // ------------------------------------------------------------------
  const [org] = await db`select id from organizations limit 1`;
  const [periode] = await db`select id, nama from organization_periods order by dibuat_pada desc limit 1`;
  if (!org || !periode) throw new Error('Jalankan `pnpm db:seed` terlebih dahulu.');
  console.log(`▸ Organisasi ${org.id} · periode ${periode.nama}`);

  // ------------------------------------------------------------------
  // B. Akun & periode keuangan
  // ------------------------------------------------------------------
  const [akunKas] = await db`
    insert into accounts (organization_id, kode, nama, jenis, adalah_kas, require_memo, aktif)
    values (${org.id}, '101', 'Kas Tunai', 'ASSET', true, true, true)
    on conflict (organization_id, kode) do update set nama = excluded.nama
    returning id`;
  const [akunQris] = await db`
    insert into accounts (organization_id, kode, nama, jenis, adalah_kas, aktif)
    values (${org.id}, '102', 'Kas QRIS / Bank', 'ASSET', true, true)
    on conflict (organization_id, kode) do update set nama = excluded.nama
    returning id`;
  const [akunIuran] = await db`
    insert into accounts (organization_id, kode, nama, jenis, aktif)
    values (${org.id}, '401', 'Iuran Anggota', 'REVENUE', true)
    on conflict (organization_id, kode) do update set nama = excluded.nama
    returning id`;
  const [akunBelanja] = await db`
    insert into accounts (organization_id, kode, nama, jenis, aktif)
    values (${org.id}, '501', 'Belanja Kegiatan', 'EXPENSE', true)
    on conflict (organization_id, kode) do update set nama = excluded.nama
    returning id`;

  // Rentang tanggal periode harus berupa literal string 'YYYY-MM-DD'.
  const [tahunAwal, tahunAkhir] = String(periode.nama).split('/');
  const awal = `${tahunAwal}-07-01`;
  const akhir = `${(tahunAkhir ?? tahunAwal)}-06-30`;
  const namaPeriodeKeuangan = `Kas ${periode.nama}`;
  let [periodeKeuangan] = await db`
    select id from financial_periods
     where organization_id = ${org.id} and nama = ${namaPeriodeKeuangan}`;
  if (!periodeKeuangan) {
    [periodeKeuangan] = await db`
      insert into financial_periods (organization_id, period_id, nama, mulai_pada, selesai_pada, saldo_awal, status)
      values (${org.id}, ${periode.id}, ${namaPeriodeKeuangan}, ${awal}, ${akhir}, 0, 'OPEN')
      returning id`;
  }
  const periodeKeuanganId = periodeKeuangan.id;

  // ------------------------------------------------------------------
  // C. Anggota: user → identity → member
  // ------------------------------------------------------------------
  console.log('▸ Migrasi anggota…');
  const petaAnggota = new Map(); // legacy_member_id → v2 member_id

  for (const a of anggotaLama) {
    const status = STATUS_ANGGOTA[a.status] ?? 'ACTIVE';
    if (status === 'REMOVED') continue;

    const sudahAda = await db`
      select id from members
       where organization_id = ${org.id} and legacy_id = ${String(a.member_id)}`;
    if (sudahAda.length > 0) {
      petaAnggota.set(String(a.member_id), sudahAda[0].id);
      continue;
    }

    const kelas = pecahKelas(a.class);
    const nomorWa = nomorDariJid(a.account_id);

    // Akun dibuat TANPA kata sandi.
    //
    // Sebelumnya SEMUA anggota mendapat kata sandi placeholder yang sama. Tiga
    // masalah dengan cara itu:
    //   1. Kata sandinya tertulis di repositori publik — siapa pun bisa masuk
    //      ke akun anggota lain hanya dengan membacanya.
    //   2. Satu kata sandi untuk 49 orang berarti satu kebocoran membuka
    //      semuanya.
    //   3. Akun-akun ini tidak punya surel, jadi tidak bisa masuk lewat surel
    //      pada dasarnya.
    //
    // Hebatnya: anggota sudah punya identitas WhatsApp. Mereka masuk lewat
    // tautan dalam atau kode yang dikirim ke WhatsApp, lalu menetapkan kata
    // sandi sendiri. `password_hash` NULL adalah state yang sah — lihat
    // kolom `users.password_hash` di skema.
    let userId = null;
    const [u] = await db`
      insert into users (nama, telepon, password_hash, status, telepon_diverifikasi_pada)
      values (${a.name}, ${nomorWa}, null, 'ACTIVE', now())
      on conflict (telepon) do update set nama = excluded.nama
      returning id`;
    userId = u?.id ?? null;

    if (userId) {
      await db`
        insert into identities (user_id, provider, provider_subject, provider_subject_kanonik, nama_tampilan)
        values (${userId}, 'WHATSAPP', ${a.account_id}, ${nomorWa}, ${a.name})
        on conflict do nothing`;
    }

    const [m] = await db`
      insert into members (
        organization_id, period_id, user_id, nomor, nama, tingkat, jurusan, sub_kelas,
        email, telepon, status, bergabung_pada, legacy_id
      ) values (
        ${org.id}, ${periode.id}, ${userId},
        ${'M-' + String(a.member_id).padStart(4, '0')}, ${a.name},
        ${kelas.tingkat}, ${kelas.jurusan}, ${kelas.subKelas},
        ${null}, ${nomorWa}, ${status}, ${keTanggalSQL(a.registered_at)}, ${String(a.member_id)}
      )
      on conflict (organization_id, nomor) do update set nama = excluded.nama, status = excluded.status
      returning id`;

    petaAnggota.set(String(a.member_id), m.id);
  }
  console.log(`  ✓ ${petaAnggota.size} anggota aktif dimigrasi`);

  // ------------------------------------------------------------------
  // D. Sesi absensi
  // ------------------------------------------------------------------
  console.log('▸ Migrasi sesi absensi…');
  const petaSesi = new Map();

  for (const s of sesiLama) {
    const sudahAda = await db`
      select id from attendance_sessions
       where organization_id = ${org.id} and idempotency_key = ${`legacy-sesi-${s.session_id}`}`;
    if (sudahAda.length > 0) {
      petaSesi.set(String(s.session_id), sudahAda[0].id);
      continue;
    }

    const [baru] = await db`
      insert into attendance_sessions (
        organization_id, period_id, jenis, judul, tanggal, waktu_mulai, waktu_selesai,
        mulai_pada, selesai_pada, lokasi, status, wajib_hadir,
        batas_keterlambatan_menit, qr_ttl_detik,
        dibuka_pada, ditutup_pada, idempotency_key, dibuat_pada
      ) values (
        ${org.id}, ${periode.id}, 'MEETING',
        ${s.type ?? 'Rapat Rutin OSIS'}, ${keTanggalSQL(s.date)},
        null, null, ${s.opened_at ? new Date(s.opened_at) : null},
        ${s.closed_at ? new Date(s.closed_at) : null}, null,
        ${String(s.status).toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED'}, true,
        15, 120,
        ${s.opened_at ? new Date(s.opened_at) : null}, ${s.closed_at ? new Date(s.closed_at) : null},
        ${`legacy-sesi-${s.session_id}`}, ${new Date(s.created_at ?? Date.now())}
      )
      on conflict (organization_id, idempotency_key) do update set status = excluded.status
      returning id`;

    petaSesi.set(String(s.session_id), baru.id);
  }
  console.log(`  ✓ ${petaSesi.size} sesi`);

  // ------------------------------------------------------------------
  // E. Catatan kehadiran + ABSENT otomatis (spec §14)
  // ------------------------------------------------------------------
  console.log('▸ Migrasi catatan kehadiran…');
  const sudahAbsen = new Set();

  for (const a of absenLama) {
    const memberId = petaAnggota.get(String(a.member_id));
    const sessionId = petaSesi.get(String(a.session_id));
    if (!memberId || !sessionId) continue;

    const status = STATUS_HADIR[a.status] ?? 'ABSENT';
    await db`
      insert into attendance_records (
        session_id, member_id, status, alasan, sumber, direkam_pada, idempotency_key
      ) values (
        ${sessionId}, ${memberId}, ${status}, ${a.reason ?? null},
        ${STATUS_DARI_ANGGOTA.has(status) ? 'WHATSAPP' : SUMBER_SISTEM},
        ${new Date(a.timestamp)}, ${`legacy-absen-${a.attendance_id}`}
      )
      on conflict (session_id, idempotency_key) do update set status = excluded.status`;
    sudahAbsen.add(`${memberId}|${sessionId}`);
  }

  for (const [, memberId] of petaAnggota) {
    for (const [, sessionId] of petaSesi) {
      if (sudahAbsen.has(`${memberId}|${sessionId}`)) continue;
      await db`
        insert into attendance_records (session_id, member_id, status, alasan, sumber, direkam_pada, idempotency_key)
        values (${sessionId}, ${memberId}, 'ABSENT',
                'Tanpa catatan kehadiran pada bot v0.4 — dibuat otomatis oleh sistem',
                ${SUMBER_SISTEM}, now(),
                ${`legacy-absen-auto-${memberId}-${sessionId}`})
        on conflict (session_id, idempotency_key) do nothing`;
    }
  }
  console.log(`  ✓ ${absenLama.length} catatan eksplisit + ABSENT otomatis`);

  // ------------------------------------------------------------------
  // F. Keuangan: minggu kas, pembayaran, pengeluaran
  // ------------------------------------------------------------------
  console.log('▸ Migrasi keuangan…');

  const petaMinggu = new Map();
  for (const w of mingguLama) {
    const kode = kodePeriodeKas(w.year, w.week_num);
    const [row] = await db`
      insert into dues_periods (organization_id, kode, nama, frekuensi, periode, mulai_pada, selesai_pada, nominal, status, batas_pembayaran)
      values (${org.id}, ${`KAS-${kode}`}, ${`Kas Mingguan ${kode}`}, 'MINGGUAN', ${kode},
              ${keTanggalSQL(w.start_date)}, ${keTanggalSQL(w.end_date)},
              ${Number(w.amount)}, ${String(w.status).toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED'},
              ${keTanggalSQL(w.end_date)})
      on conflict (organization_id, periode) do update set nominal = excluded.nominal
      returning id`;
    petaMinggu.set(kode, row.id);
  }
  console.log(`  ✓ ${petaMinggu.size} periode kas`);

  for (const p of pembayaranLama) {
    const memberId = petaAnggota.get(String(p.member_id));
    if (!memberId) continue;

    const minggu = mingguLama.find((w) => String(w.week_id) === String(p.week_id));
    const kode = minggu ? kodePeriodeKas(minggu.year, minggu.week_num) : 'MIGRATED';
    const duesPeriodId = petaMinggu.get(kode) ?? null;
    const lunas = String(p.status).toLowerCase() === 'paid';

    await db`
      insert into dues_status (dues_period_id, member_id, kewajiban, status, nominal, catatan)
      values (${duesPeriodId}, ${memberId}, 'WAJIB',
              ${lunas ? 'LUNAS' : 'BELUM'}, ${Number(p.amount)},
              'Dimigrasi dari OSDA BOT v0.4')
      on conflict (dues_period_id, member_id) do update set status = excluded.status`;

    if (!lunas) continue;

    // Entri 1: pendapatan iuran (sisi pendapatan, REVENUE)
    const nominal = Number(p.amount);
    await catatLedger(db, {
      orgId: org.id,
      periodeKeuanganId,
      akunId: akunIuran.id,
      tanggal: keTanggalSQL(p.paid_at),
      debit: nominal,
      kredit: 0,
      keterangan: `Iuran kas periode ${kode} (migrasi v0.4)`,
      kode: `KAS-P${p.payment_id}-IURAN`,
      jenis: 'INCOME',
      arah: 'IN',
    });
    // Entri 2: kas tunai/QRIS bertambah (sisi kas, ASSET)
    await catatLedger(db, {
      orgId: org.id,
      periodeKeuanganId,
      akunId: p.method === 'qris' ? akunQris.id : akunKas.id,
      tanggal: keTanggalSQL(p.paid_at),
      debit: nominal,
      kredit: 0,
      keterangan: `Setoran kas ${p.method === 'qris' ? 'QRIS' : 'tunai'} (migrasi v0.4)`,
      kode: `KAS-P${p.payment_id}-KAS`,
      jenis: 'INCOME',
      arah: 'IN',
    });
  }

  for (const e of pengeluaranLama) {
    // Entri 1: pengeluaran dicatat pada akun beban (EXPENSE)
    await catatLedger(db, {
      orgId: org.id,
      periodeKeuanganId,
      akunId: akunBelanja.id,
      tanggal: keTanggalSQL(e.spent_at),
      debit: 0,
      kredit: Number(e.amount),
      keterangan: e.description ?? 'Pengeluaran kas (migrasi v0.4)',
      kode: `KAS-E${e.expense_id}-BELANJA`,
      jenis: 'EXPENSE',
      arah: 'OUT',
    });
    // Entri 2: kas tunai berkurang (ASSET)
    await catatLedger(db, {
      orgId: org.id,
      periodeKeuanganId,
      akunId: akunKas.id,
      tanggal: keTanggalSQL(e.spent_at),
      debit: 0,
      kredit: Number(e.amount),
      keterangan: 'Pengurangan kas tunai (migrasi v0.4)',
      kode: `KAS-E${e.expense_id}-KAS`,
      jenis: 'EXPENSE',
      arah: 'OUT',
    });
  }
  console.log(`  ✓ ${pembayaranLama.length} pembayaran, ${pengeluaranLama.length} pengeluaran`);

  // ------------------------------------------------------------------
  // G. Peran pengurus (bendahara & moderator)
  // ------------------------------------------------------------------
  console.log('▸ Migrasi peran pengurus…');
  const petaPeran = new Map(
    (await db`select id, kode from roles where organization_id is null`).map((r) => [r.kode, r.id]),
  );

  for (const t of bendaharaLama) {
    const memberId =
      petaAnggota.get(String(t.account_id)) ?? (await cariMemberByTelepon(db, t.account_id));
    if (memberId) await beriPeran(db, org.id, periode.id, memberId, petaPeran.get('TREASURER'), 'Bendahara (migrasi v0.4)');
  }
  for (const m of moderatorLama) {
    const memberId =
      petaAnggota.get(String(m.account_id)) ?? (await cariMemberByTelepon(db, m.account_id));
    if (memberId) await beriPeran(db, org.id, periode.id, memberId, petaPeran.get('STAFF'), 'Moderator (migrasi v0.4)');
  }
  console.log(`  ✓ ${bendaharaLama.length} bendahara, ${moderatorLama.length} moderator`);

  // ------------------------------------------------------------------
  // H. Peta kepemilikan ID lama → baru
  // ------------------------------------------------------------------
  console.log('▸ Mencatat peta kepemilikan ID…');
  for (const [legacy, id] of petaAnggota) {
    await db`
      insert into legacy_id_mappings (legacy_tabel, legacy_id, target_tabel, target_id, organization_id, catatan)
      values ('members', ${legacy}, 'members', ${id}, ${org.id}, 'migrasi v0.4 → v2')
      on conflict (legacy_tabel, legacy_id) do update set target_id = excluded.target_id`;
  }
  for (const [legacy, id] of petaSesi) {
    await db`
      insert into legacy_id_mappings (legacy_tabel, legacy_id, target_tabel, target_id, organization_id, catatan)
      values ('attendance_sessions', ${legacy}, 'attendance_sessions', ${id}, ${org.id}, 'migrasi v0.4 → v2')
      on conflict (legacy_tabel, legacy_id) do update set target_id = excluded.target_id`;
  }

  await db.end();
  console.log('\n✓ MIGRASI SELESAI');
  console.log('  Verifikasi dengan: node tools/legacy/scripts/reconcile.mjs');
}

/** Cari member melalui nomor telepon WhatsApp. */
async function cariMemberByTelepon(db, accountId) {
  const nomor = nomorDariJid(accountId);
  const [m] = await db`select id from members where telepon = ${nomor} limit 1`;
  return m?.id ?? null;
}

/** Beri peran anggota bila belum punya. */
async function beriPeran(db, orgId, periodeId, memberId, roleId, alasan) {
  if (!roleId || !memberId) return;
  const [ada] = await db`
    select id from member_roles
     where organization_id = ${orgId} and member_id = ${memberId} and role_id = ${roleId}`;
  if (ada) return;
  await db`
    insert into member_roles (organization_id, member_id, role_id, period_id, alasan)
    values (${orgId}, ${memberId}, ${roleId}, ${periodeId}, ${alasan})`;
}

/**
 * Buat transaksi + entri ledger secara atomik dan idempoten.
 * Ledger adalah immutable; kalau kode transaksi sudah ada, baris dilewati.
 */
async function catatLedger(db, opsi) {
  const [ada] = await db`
    select id from transactions where organization_id = ${opsi.orgId} and kode = ${opsi.kode}`;
  if (ada) return ada.id;

  const [trx] = await db`
    insert into transactions (
      organization_id, financial_period_id, kode, jenis, arah, account_id,
      nominal, keterangan, tanggal, status, diposting_pada
    ) values (
      ${opsi.orgId}, ${opsi.periodeKeuanganId}, ${opsi.kode}, ${opsi.jenis}, ${opsi.arah},
      ${opsi.akunId}, ${opsi.debit > 0 ? opsi.debit : opsi.kredit},
      ${opsi.keterangan}, ${opsi.tanggal}, 'POSTED', now()
    )
    returning id`;

  await db`
    insert into ledger_entries (
      transaksi_id, organization_id, financial_period_id, account_id,
      tanggal, debit, kredit, narration
    ) values (
      ${trx.id}, ${opsi.orgId}, ${opsi.periodeKeuanganId}, ${opsi.akunId},
      ${opsi.tanggal}, ${opsi.debit}, ${opsi.kredit}, ${opsi.keterangan}
    )`;

  return trx.id;
}

main().catch((e) => {
  if (REJECT.length > 0) {
    console.error('BARIS DITOLAK:');
    for (const r of REJECT) console.error('  -', r);
  }
  console.error('MIGRASI GAGAL:', e.message);
  process.exit(1);
});
