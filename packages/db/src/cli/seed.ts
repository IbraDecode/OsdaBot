/**
 * Seed data awal OSDA.
 *
 * Mengisi:
 *  1. Seluruh permission bawaan dari @osda/contracts
 *  2. Seluruh peran bawaan beserta permission & cakupannya
 *  3. Satu organisasi + periode + struktur jabatan + divisi
 *  4. Chart of accounts standar untuk kas OSIS
 *  5. Periode keuangan awal
 *  6. Kategori dokumen bawaan
 *  7. Feature flags untuk migrasi bertahap
 *  8. Akun administrator pertama (dari .env)
 *
 * Aman dijalankan berkali-kali (idempotent).
 */
import argon2 from 'argon2';
import { createHash } from 'node:crypto';

import {
  MATRICS_PERAN,
  PERAN_BAWAAN,
  PERMISSION,
  type Cakupan,
} from '@osda/contracts';
import { sql } from 'drizzle-orm';

import { buatDb, jalankanMigrasi, muatEnv, type Db } from '../client.js';
import { SQL_INVARIANT } from '../sql/invariants.js';
import {
  accounts,
  divisions,
  documentCategories,
  featureFlags,
  financialPeriods,
  hariIni,
  memberPeriodHistory,
  memberRoles,
  members,
  organizationPeriods,
  organizations,
  permissions,
  positionAssignments,
  positions,
  rolePermissions,
  roles,
  users,
} from '../schema/index.js';

/** Hash kata sandi dengan argon2id (fallback SHA-256 hanya untuk dev). */
async function hashPassword(kosong: string): Promise<string> {
  try {
    return await argon2.hash(kosong, { type: argon2.argon2id });
  } catch {
    // Fallback: SHA-256 iteratif. Hanya untuk pengembangan; production WAJIB argon2.
    let hash = createHash('sha256').update(kosong).digest('hex');
    for (let i = 0; i < 10_000; i++) hash = createHash('sha256').update(hash).digest('hex');
    return `fallback-sha256$${hash}`;
  }
}

/** Chart of accounts kas OSIS. */
const CHART_AWAL: readonly {
  kode: string;
  nama: string;
  jenis: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  adalahKas?: boolean;
  requireMemo?: boolean;
}[] = [
  { kode: '1', nama: 'ASET', jenis: 'ASSET' },
  { kode: '101', nama: 'Kas Tunai', jenis: 'ASSET', adalahKas: true, requireMemo: true },
  { kode: '102', nama: 'Kas QRIS / Bank', jenis: 'ASSET', adalahKas: true },
  { kode: '103', nama: 'Kas Petty Cash', jenis: 'ASSET', adalahKas: true },
  { kode: '2', nama: 'KEWAJIBAN', jenis: 'LIABILITY' },
  { kode: '201', nama: 'Utang kepada Anggota', jenis: 'LIABILITY' },
  { kode: '3', nama: 'MODAL', jenis: 'EQUITY' },
  { kode: '301', nama: 'Saldo Awal Periode', jenis: 'EQUITY' },
  { kode: '4', nama: 'PENDAPATAN', jenis: 'REVENUE' },
  { kode: '401', nama: 'Iuran Anggota', jenis: 'REVENUE' },
  { kode: '402', nama: 'Pendapatan Acara', jenis: 'REVENUE' },
  { kode: '403', nama: 'Sponsor', jenis: 'REVENUE' },
  { kode: '404', nama: 'Donasi', jenis: 'REVENUE' },
  { kode: '405', nama: 'Pendapatan Lain-lain', jenis: 'REVENUE' },
  { kode: '5', nama: 'PENGELUARAN', jenis: 'EXPENSE' },
  { kode: '501', nama: 'Belanja Kegiatan', jenis: 'EXPENSE' },
  { kode: '502', nama: 'ATK & Administrasi', jenis: 'EXPENSE' },
  { kode: '503', nama: 'Transport & Akomodasi', jenis: 'EXPENSE' },
  { kode: '504', nama: 'Publikasi & Dokumentasi', jenis: 'EXPENSE' },
  { kode: '505', nama: 'Refund / Reimbursement', jenis: 'EXPENSE' },
  { kode: '506', nama: 'Utilitas & Internet', jenis: 'EXPENSE' },
  { kode: '507', nama: 'Pengeluaran Lain-lain', jenis: 'EXPENSE' },
];

const JABATAN_AWAL: readonly {
  kode: string;
  nama: string;
  tingkat: 'BOARD' | 'COORDINATOR' | 'STAFF' | 'MEMBER';
  urutan: number;
}[] = [
  { kode: 'KETUA', nama: 'Ketua', tingkat: 'BOARD', urutan: 10 },
  { kode: 'WAKIL_KETUA', nama: ' Wakil Ketua', tingkat: 'BOARD', urutan: 20 },
  { kode: 'SEKRETARIS', nama: 'Sekretaris', tingkat: 'BOARD', urutan: 30 },
  { kode: 'BENDAHARA', nama: 'Bendahara', tingkat: 'BOARD', urutan: 40 },
  { kode: 'HUMAS', nama: 'Humas', tingkat: 'BOARD', urutan: 50 },
  { kode: 'KOORDINATOR', nama: 'Koordinator Bidang', tingkat: 'COORDINATOR', urutan: 100 },
  { kode: 'STAFF', nama: 'Staf', tingkat: 'STAFF', urutan: 200 },
  { kode: 'ANGGOTA', nama: 'Anggota', tingkat: 'MEMBER', urutan: 300 },
];

const DIVISI_AWAL: readonly { kode: string; nama: string }[] = [
  { kode: 'BIDA', nama: 'Bidang Nilais' },
  { kode: 'BIDI', nama: 'Bidang Informasi' },
  { kode: 'BIDQ', nama: 'Bidang Qurban dan Sportif' },
];

const KATEGORI_DOKUMEN_AWAL = [
  'SURAT_MASUK',
  'SURAT_KELUAR',
  'PROPOSAL',
  'LPJ',
  'NOTULEN',
  'SK',
  'UNDANGAN',
  'DOKUMEN_PROGRAM',
  'DOKUMEN_ACARA',
  'LAINNYA',
];

const FEATURE_FLAGS_AWAL: readonly [string, string][] = [
  ['new_attendance', 'Absensi sesi & QR dinamis'],
  ['new_finance', 'Modul keuangan baru (ledger, anggaran, reimbursement)'],
  ['new_mobile', 'Aplikasi mobile OSDA'],
  ['new_communication', 'Pusat komunikasi & pengumuman'],
  ['new_reports', 'Mesin laporan baru'],
  ['legacy_bot', 'Kompatibilitas perintah bot WhatsApp v0.4'],
];

/** MODUL yang izinnya sensitif (wajib tercatat di audit). */
const MODUL_SENSITIF = new Set(['finance', 'settings', 'integration', 'audit', 'period', 'approval']);

/** Cakupan yang relevan untuk sebuah izin pada sebuah peran. */
function cakupanUntuk(izin: string, cakupanPeran: readonly Cakupan[]): Cakupan[] {
  if (izin.startsWith('finance.')) return ['FINANCE'];
  if (izin.startsWith('settings.') || izin.startsWith('integration.') || izin.startsWith('audit.')) {
    return ['SYSTEM'];
  }
  return [...new Set(cakupanPeran)];
}

async function main() {
  muatEnv();
  console.log('▸ Menyiapkan database…');
  const db: Db = await buatDb();
  await jalankanMigrasi(db);
  await db.execute(sql.raw(SQL_INVARIANT));

  // ---------------------------------------------------------------
  // 1. Permission
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan permission…');
  const barisPermission = PERMISSION.flatMap((kode) => {
    const titik = kode.indexOf('.');
    const modul = kode.slice(0, titik);
    const aksi = kode.slice(titik + 1);
    return [
      {
        kode,
        modul,
        aksi,
        deskripsi: `Izin ${aksi} pada modul ${modul}`,
        sensitif: MODUL_SENSITIF.has(modul),
      },
    ];
  });
  await db.insert(permissions).values(barisPermission).onConflictDoNothing();
  console.log(`  ✓ ${barisPermission.length} permission`);

  const semuaPermission = await db.select().from(permissions);
  const petaPermission = new Map(semuaPermission.map((p) => [p.kode, p.id]));

  // ---------------------------------------------------------------
  // 2. Peran bawaan + permission + cakupan
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan peran bawaan…');
  for (const kode of PERAN_BAWAAN) {
    const paket = MATRICS_PERAN[kode];
    await db
      .insert(roles)
      .values({ kode, nama: paket.nama, deskripsi: paket.deskripsi, bawaan: true, organizationId: null })
      .onConflictDoNothing();

    const [peran] = await db.select().from(roles).where(sql`kode = ${kode}`).limit(1);
    if (!peran) continue;

    for (const izin of paket.izin) {
      const permissionId = petaPermission.get(izin);
      if (!permissionId) continue;
      for (const cakupan of cakupanUntuk(izin, paket.cakupan)) {
        await db
          .insert(rolePermissions)
          .values({ roleId: peran.id, permissionId, cakupan })
          .onConflictDoNothing();
      }
    }
  }
  console.log(`  ✓ ${PERAN_BAWAAN.length} peran`);

  // ---------------------------------------------------------------
  // 3. Organisasi + periode
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan organisasi…');
  const namaSekolah = process.env.SEED_ORGANIZATION_NAME ?? 'OSIS Contoh';
  let [org] = await db
    .select()
    .from(organizations)
    .where(sql`nama_sekolah = ${namaSekolah}`)
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(organizations)
      .values({
        nama: 'OSIS',
        singkat: 'OSIS',
        jenis: 'OSIS',
        namaSekolah: namaSekolah,
        zonaWaktu: process.env.TZ ?? 'Asia/Makassar',
        aktif: true,
      })
      .returning();
  }
  if (!org) throw new Error('Gagal membuat organisasi.');
  console.log(`  ✓ ${org.nama} — ${org.namaSekolah}`);

  const tahun = new Date().getFullYear();
  const namaPeriode = `${tahun}/${tahun + 1}`;
  let [periode] = await db
    .select()
    .from(organizationPeriods)
    .where(sql`organization_id = ${org.id} and nama = ${namaPeriode}`)
    .limit(1);
  if (!periode) {
    [periode] = await db
      .insert(organizationPeriods)
      .values({
        organizationId: org.id,
        nama: namaPeriode,
        mulaiPada: `${tahun}-07-01`,
        selesaiPada: `${tahun + 1}-06-30`,
        status: 'ACTIVE',
      })
      .returning();
  }
  if (!periode) throw new Error('Gagal membuat periode.');
  console.log(`  ✓ Periode ${periode.nama} (${periode.status})`);

  // ---------------------------------------------------------------
  // 4. Jabatan & divisi
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan jabatan & divisi…');
  for (const j of JABATAN_AWAL) {
    await db.insert(positions).values({ organizationId: org.id, ...j }).onConflictDoNothing();
  }
  for (const d of DIVISI_AWAL) {
    await db
      .insert(divisions)
      .values({ organizationId: org.id, periodId: periode.id, kode: d.kode, nama: d.nama })
      .onConflictDoNothing();
  }
  const nJabatan = await db.select().from(positions).where(sql`organization_id = ${org.id}`);
  const nDivisi = await db.select().from(divisions).where(sql`organization_id = ${org.id}`);
  console.log(`  ✓ ${nJabatan.length} jabatan, ${nDivisi.length} divisi`);

  // ---------------------------------------------------------------
  // 5. Chart of accounts
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan chart of accounts…');
  for (const a of CHART_AWAL) {
    await db
      .insert(accounts)
      .values({ organizationId: org.id, ...a })
      .onConflictDoNothing({ target: [accounts.organizationId, accounts.kode] });
  }
  const nAkun = await db.select().from(accounts).where(sql`organization_id = ${org.id}`);
  console.log(`  ✓ ${nAkun.length} akun`);

  // ---------------------------------------------------------------
  // 6. Periode keuangan
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan periode keuangan…');
  const periodeAktif = await db
    .select()
    .from(financialPeriods)
    .where(sql`organization_id = ${org.id} and status = 'OPEN'`)
    .limit(1);
  if (periodeAktif.length === 0) {
    await db.insert(financialPeriods).values({
      organizationId: org.id,
      periodId: periode.id,
      nama: `Kas ${periode.nama}`,
      mulaiPada: periode.mulaiPada,
      selesaiPada: periode.selesaiPada,
      saldoAwal: 0,
      status: 'OPEN',
    });
  }
  console.log('  ✓ Periode keuangan');

  // ---------------------------------------------------------------
  // 7. Kategori dokumen
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan kategori dokumen…');
  for (const kode of KATEGORI_DOKUMEN_AWAL) {
    await db
      .insert(documentCategories)
      .values({
        organizationId: org.id,
        kode,
        nama: kode
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace(/^\w/, (c) => c.toUpperCase()),
        bawaan: true,
      })
      .onConflictDoNothing({
        target: [documentCategories.organizationId, documentCategories.kode],
      });
  }
  console.log(`  ✓ ${KATEGORI_DOKUMEN_AWAL.length} kategori`);

  // ---------------------------------------------------------------
  // 8. Feature flags
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan feature flags…');
  for (const [kunci, deskripsi] of FEATURE_FLAGS_AWAL) {
    await db
      .insert(featureFlags)
      .values({ organizationId: org.id, kunci, deskripsi, status: 'OFF', persentase: 0 })
      .onConflictDoNothing({ target: [featureFlags.organizationId, featureFlags.kunci] });
  }
  console.log(`  ✓ ${FEATURE_FLAGS_AWAL.length} feature flag`);

  // ---------------------------------------------------------------
  // 9. Administrator pertama
  // ---------------------------------------------------------------
  console.log('▸ Menyiapkan administrator pertama…');
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@osis.local').toLowerCase();
  const sandi = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'GantiPassword123!';
  const [admin] = (await db.select().from(users).where(sql`email = ${email}`).limit(1)) ?? [];

  if (!admin) {
    const [baru] = await db
      .insert(users)
      .values({
        nama: 'Administrator OSDA',
        email,
        passwordHash: await hashPassword(sandi),
        status: 'ACTIVE' as const,
        emailDiverifikasiPada: hariIni(),
      })
      .returning();
    if (!baru) throw new Error('Gagal membuat akun administrator.');
    await pasangPeranAdmin(db, baru.id, baru.nama, org.id, periode.id, email);
  } else {
    console.log('  ✓ Akun sudah ada (dilewati).');
    await pasangPeranAdmin(db, admin.id, admin.nama, org.id, periode.id, email);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  OSDA Platform — seed selesai                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Organisasi  : ${org.nama} (${org.namaSekolah})`);
  console.log(`  Periode     : ${periode.nama}`);
  console.log(`  Jabatan     : ${nJabatan.length}`);
  console.log(`  Divisi      : ${nDivisi.length}`);
  console.log(`  Akun kas    : ${nAkun.length}`);
  console.log(`  Admin email : ${email}`);
  console.log(`  Admin sandi : ${sandi}`);
  console.log('\n  ⚠️  Ganti kata sandi administrator setelah login pertama.');
  console.log('  Jalankan: pnpm --filter @osda/api start');
  process.exit(0);
}

/** Pasang keanggotaan & peran SUPER_ADMIN untuk akun administrator. */
async function pasangPeranAdmin(
  db: Db,
  userId: string,
  nama: string,
  orgId: string,
  periodId: string,
  email: string,
): Promise<void> {
  const [sudah] = await db
    .select()
    .from(members)
    .where(sql`user_id = ${userId} and organization_id = ${orgId}`)
    .limit(1);
  if (sudah) return;

  const [anggota] = await db
    .insert(members)
    .values({
      organizationId: orgId,
      periodId: periodId,
      userId,
      nomor: 'M-0001',
      nama,
      tingkat: 'XII',
      email,
      status: 'ACTIVE',
      bergabungPada: hariIni(),
    })
    .returning();
  if (!anggota) return;

  await db.insert(memberPeriodHistory).values({
    memberId: anggota.id,
    periodId,
    status: 'ACTIVE',
    bergabungPada: hariIni(),
  });

  const [jabatan] = await db
    .select()
    .from(positions)
    .where(sql`organization_id = ${orgId} and kode = 'STAFF'`)
    .limit(1);
  if (jabatan) {
    await db.insert(positionAssignments).values({
      organizationId: orgId,
      periodId,
      memberId: anggota.id,
      positionId: jabatan.id,
    });
  }

  const [peranSuper] = await db.select().from(roles).where(sql`kode = 'SUPER_ADMIN'`).limit(1);
  if (peranSuper) {
    await db.insert(memberRoles).values({
      organizationId: orgId,
      memberId: anggota.id,
      roleId: peranSuper.id,
      periodId,
    });
  }
  console.log('  ✓ Anggota administrator dibuat.');
}

main().catch((e) => {
  console.error('✗ Seed gagal:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
