/**
 * Skema keuangan: chart of accounts, periode, anggaran, transaksi, ledger,
 * reimbursement, pembayaran.
 *
 * Aturan yang ditegakkan (spec §22–§26, §44):
 * 1. Saldo TIDAK PERNAH disimpan sebagai satu angka; saldo dihitung dari
 *    `ledger_entries` yang immutable.
 * 2. `ledger_entries` tidak boleh di-UPDATE atau di-DELETE. Koreksi dibuat
 *    lewat transaksi ADJUSTMENT baru.
 * 3. Setiap transaksi uang berada dalam satu batas transaksi database.
 * 4. `transactions.idempotency_key` mencegah pembayaran tercatat dua kali.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  diubahPada,
  dibuatPada,
  dibuatOleh,
  enumArahTransaksi,
  enumJenisAkun,
  enumJenisTransaksi,
  enumMetodePembayaran,
  enumStatusAnggaran,
  enumStatusPembayaran,
  enumStatusPengajuan,
  enumStatusPeriodeKeuangan,
  enumStatusReimbursement,
  enumStatusTransaksi,
  pk,
  uang,
  versiBaris,
} from './_base.js';
import { organizations, organizationPeriods } from './organization.js';
import { members } from './identity.js';
import { events, programs } from './programs.js';

// ============================================================
// Chart of accounts
// ============================================================

export const accounts = pgTable(
  'accounts',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    nama: text('nama').notNull(),
    jenis: enumJenisAkun('jenis').notNull(),
    indukId: uuid('induk_id'),
    deskripsi: text('deskripsi'),
    /**
     * true bila akun hanya boleh dipakai lewat prosedur tertentu
     * (mis. akun kas tunai wajib punya mutasi).
     */
    requireMemo: boolean('require_memo').notNull().default(false),
    /** Akun kas yang menampilkan saldo di kasbook. */
    adalahKas: boolean('adalah_kas').notNull().default(false),
    /** Akun yang boleh menjadi tujuan POSTING lewat pengajuan. */
    postingOtomatis: boolean('posting_otomatis').notNull().default(true),
    aktif: boolean('aktif').notNull().default(true),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    uniqueIndex('uq_akun_org_kode').on(t.organizationId, t.kode),
    index('ix_akun_jenis').on(t.organizationId, t.jenis),
  ],
);

export type AkunBaris = typeof accounts.$inferSelect;
export type AkunSisip = typeof accounts.$inferInsert;

// ============================================================
// Periode keuangan (financial period)
// ============================================================

export const financialPeriods = pgTable(
  'financial_periods',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    nama: text('nama').notNull(),
    mulaiPada: date('mulai_pada').notNull(),
    selesaiPada: date('selesai_pada').notNull(),
    /** Saldo kas di awal periode. Diperhitungkan dari periode sebelumnya. */
    saldoAwal: uang('saldo_awal').notNull().default(0),
    status: enumStatusPeriodeKeuangan('status').notNull().default('OPEN'),
    ditutupPada: date('ditutup_pada'),
    ditutupOleh: uuid('ditutup_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    index('ix_periode_keuangan_org').on(t.organizationId),
    uniqueIndex('uq_periode_keuangan_nama').on(t.organizationId, t.nama),
  ],
);

export type PeriodeKeuanganBaris = typeof financialPeriods.$inferSelect;
export type PeriodeKeuanganSisip = typeof financialPeriods.$inferInsert;

// ============================================================
// Anggaran
// ============================================================

export const budgets = pgTable(
  'budgets',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    financialPeriodId: uuid('financial_period_id')
      .notNull()
      .references(() => financialPeriods.id, { onDelete: 'restrict' }),
    kode: text('kode').notNull(),
    nama: text('nama').notNull(),
    totalDiajukan: uang('total_diajukan').notNull().default(0),
    totalDisetujui: uang('total_disetujui').notNull().default(0),
    catatan: text('catatan'),
    status: enumStatusAnggaran('status').notNull().default('DRAFT'),
    diajukanPada: date('diajukan_pada'),
    disetujuiOleh: uuid('disetujui_oleh').references(() => members.id, { onDelete: 'set null' }),
    disetujuiPada: date('disetujui_pada'),
    alasanPenolakan: text('alasan_penolakan'),
    /** Revisi anggaran: Naikkan nomor revisi, jangan menimpa. */
    revisi: integer('revisi').notNull().default(1),
    parentId: uuid('parent_id'),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_anggaran_kode').on(t.organizationId, t.kode),
    index('ix_anggaran_program').on(t.programId),
    index('ix_anggaran_event').on(t.eventId),
    index('ix_anggaran_periode').on(t.financialPeriodId),
    index('ix_anggaran_status').on(t.status),
  ],
);

export type AnggaranBaris = typeof budgets.$inferSelect;
export type AnggaranSisip = typeof budgets.$inferInsert;

/** Butir anggaran per akun. */
export const budgetItems = pgTable(
  'budget_items',
  {
    id: pk(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    keterangan: text('keterangan').notNull(),
    nominal: uang('nominal').notNull(),
    /** Realisasi dihitung dari transaksi, disimpan untuk laporan cepat. */
    realisasi: uang('realisasi').notNull().default(0),
    catatan: text('catatan'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    index('ix_butir_anggaran').on(t.budgetId),
    index('ix_butir_akun').on(t.accountId),
  ],
);

// ============================================================
// Pengajuan (expense / income request)
// ============================================================

/**
 * Pengajuan harus melalui persetujuan bila nominal melewati ambang yang
 * dikonfigurasi. Ambang default ada di @osda/contracts.
 */
export const expenseRequests = pgTable(
  'expense_requests',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    /** EXPENSE atau INCOME. */
    jenis: text('jenis').notNull().default('EXPENSE'),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    budgetId: uuid('budget_id').references(() => budgets.id, { onDelete: 'set null' }),
    nominal: uang('nominal').notNull(),
    keterangan: text('keterangan').notNull(),
    tanggal: date('tanggal').notNull(),
    status: enumStatusPengajuan('status').notNull().default('SUBMITTED'),
    /** Metadata bukti (kunci objek); berkas ada di object storage. */
    buktiDokumenId: uuid('bukti_dokumen_id'),
    pemohonMemberId: uuid('pemohon_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** Pemohon TIDAK BOLEH sama dengan pemberi persetujuan. */
    direviewOleh: uuid('direview_oleh').references(() => members.id, { onDelete: 'set null' }),
    direviewPada: date('direview_pada'),
    disetujuiOleh: uuid('disetujui_oleh').references(() => members.id, { onDelete: 'set null' }),
    disetujuiPada: date('disetujui_pada'),
    dibayarOleh: uuid('dibayar_oleh').references(() => members.id, { onDelete: 'set null' }),
    dibayarPada: date('dibayar_pada'),
    metodePembayaran: enumMetodePembayaran('metode_pembayaran'),
    buktiTransfer: text('bukti_transfer'),
    alasanPenolakan: text('alasan_penolakan'),
    /** Transaksi yang dihasilkan setelah POSTING. */
    transaksiId: uuid('transaksi_id'),
    idempotencyKey: text('idempotency_key'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_pengajuan_kode').on(t.organizationId, t.kode),
    uniqueIndex('uq_pengajuan_idempotensi').on(t.organizationId, t.idempotencyKey),
    index('ix_pengajuan_status').on(t.organizationId, t.status),
    index('ix_pengajuan_program').on(t.programId),
    index('ix_pengajuan_pemohon').on(t.pemohonMemberId),
    index('ix_pengajuan_tanggal').on(t.tanggal),
  ],
);

export type PengajuanBaris = typeof expenseRequests.$inferSelect;

// ============================================================
// Transaksi (header) & Ledger (detail, immutable)
// ============================================================

export const transactions = pgTable(
  'transactions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    financialPeriodId: uuid('financial_period_id')
      .notNull()
      .references(() => financialPeriods.id, { onDelete: 'restrict' }),
    kode: text('kode').notNull(),
    jenis: enumJenisTransaksi('jenis').notNull(),
    arah: enumArahTransaksi('arah').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** Akun kas yangaffected (untuk TRANSFER: dari → ke). */
    accountTujuanId: uuid('account_tujuan_id').references(() => accounts.id, { onDelete: 'restrict' }),
    nominal: uang('nominal').notNull(),
    keterangan: text('keterangan').notNull(),
    tanggal: date('tanggal').notNull(),
    status: enumStatusTransaksi('status').notNull().default('DRAFT'),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    /** Pengajuan / reimbursement asal transaksi ini. */
    expenseRequestId: uuid('expense_request_id').references(() => expenseRequests.id, {
      onDelete: 'set null',
    }),
    reimbursementId: uuid('reimbursement_id'),
    paymentId: uuid('payment_id'),
    dicatatOleh: uuid('dicatat_oleh').references(() => members.id, { onDelete: 'set null' }),
    disetujuiOleh: uuid('disetujui_oleh').references(() => members.id, { onDelete: 'set null' }),
    disetujuiPada: date('disetujui_pada'),
    dipostingPada: date('diposting_pada'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    /** Kunci idempotensi global — mencegah transaksi ganda dari webhook/UI. */
    idempotencyKey: text('idempotency_key'),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_transaksi_kode').on(t.organizationId, t.kode),
    uniqueIndex('uq_transaksi_idempotensi').on(t.organizationId, t.idempotencyKey),
    index('ix_transaksi_periode').on(t.financialPeriodId),
    index('ix_transaksi_tanggal').on(t.tanggal),
    index('ix_transaksi_status').on(t.status),
    index('ix_transaksi_program').on(t.programId),
    index('ix_transaksi_akun').on(t.accountId),
  ],
);

export type TransaksiBaris = typeof transactions.$inferSelect;
export type TransaksiSisip = typeof transactions.$inferInsert;

/**
 * Entri ledger — IMMUTABLE.
 * Trigger database `trg_ledger_immutable` akan menolak UPDATE dan DELETE.
 * Koreksi selalu dibuat lewat transaksi ADJUSTMENT baru.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: pk(),
    transaksiId: uuid('transaksi_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    financialPeriodId: uuid('financial_period_id')
      .notNull()
      .references(() => financialPeriods.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    tanggal: date('tanggal').notNull(),
    /** Nominal dalam rupiah penuh; salah satu dari debet/kredit boleh 0. */
    debit: uang('debit').notNull().default(0),
    kredit: uang('kredit').notNull().default(0),
    /** Saldo berjalan akun (denormalisasi, dipertahankan oleh trigger). */
    saldoBerjalan: uang('saldo_berjalan').notNull().default(0),
    narration: text('narration'),
    dibuatPada: dibuatPada(),
    /** Jejak sumber (mobile/web/bot/system). */
    dibuatOleh: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('ix_ledger_akun_tanggal').on(t.accountId, t.tanggal),
    index('ix_ledger_transaksi').on(t.transaksiId),
    index('ix_ledger_periode').on(t.financialPeriodId),
    index('ix_ledger_org_tanggal').on(t.organizationId, t.tanggal),
  ],
);

export type EntriLedgerBaris = typeof ledgerEntries.$inferSelect;
export type EntriLedgerSisip = typeof ledgerEntries.$inferInsert;

// ============================================================
// Reimbursement
// ============================================================

export const reimbursements = pgTable(
  'reimbursements',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    nominal: uang('nominal').notNull(),
    keterangan: text('keterangan').notNull(),
    tanggal: date('tanggal').notNull(),
    status: enumStatusReimbursement('status').notNull().default('SUBMITTED'),
    buktiDokumenId: uuid('bukti_dokumen_id'),
    direviewOleh: uuid('direview_oleh').references(() => members.id, { onDelete: 'set null' }),
    direviewPada: date('direview_pada'),
    disetujuiOleh: uuid('disetujui_oleh').references(() => members.id, { onDelete: 'set null' }),
    disetujuiPada: date('disetujui_pada'),
    dibayarOleh: uuid('dibayar_oleh').references(() => members.id, { onDelete: 'set null' }),
    dibayarPada: date('dibayar_pada'),
    metodePembayaran: enumMetodePembayaran('metode_pembayaran'),
    referensiPembayaran: text('referensi_pembayaran'),
    alasanPenolakan: text('alasan_penolakan'),
    transaksiId: uuid('transaksi_id').references(() => transactions.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_reimburse_kode').on(t.organizationId, t.kode),
    uniqueIndex('uq_reimburse_idempotensi').on(t.organizationId, t.idempotencyKey),
    index('ix_reimburse_status').on(t.organizationId, t.status),
    index('ix_reimburse_member').on(t.memberId),
  ],
);

export type ReimbursementBaris = typeof reimbursements.$inferSelect;

// ============================================================
// Pembayaran (QRIS / iuran)
// ============================================================

/**
 * Pembayaran memiliki status yang dijaga ketat. Webhook provider memanggil
 * `verifyAndSettle` yang bersifat idempotent: satu referensi aktif hanya
 * boleh di-settle sekali.
 */
export const payments = pgTable(
  'payments',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** KAS / IURAN / EVENT / PROGRAM / OTHER */
    jenis: text('jenis').notNull().default('KAS'),
    /** Label periode, mis. "2026-W10" untuk kas mingguan. */
    periode: text('periode'),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    nominal: uang('nominal').notNull(),
    metode: enumMetodePembayaran('metode').notNull().default('QRIS'),
    status: enumStatusPembayaran('status').notNull().default('PENDING'),
    /** Kunci idempotensi dari sisi klien — mencegah payment intent ganda. */
    idempotencyKey: text('idempotency_key').notNull(),
    /** Referensi dari provider. UNIQUE bila ada (mencegah settle 2x). */
    referensiProvider: text('referensi_provider'),
    qrString: text('qr_string'),
    qrUrl: text('qr_url'),
    kedaluwarsaPada: date('kedaluwarsa_pada').notNull(),
    dibayarPada: date('dibayar_pada'),
    /** Dicatat saat callback member mengonfirmasi (bukti transfer manual). */
    buktiTransfer: text('bukti_transfer'),
    dicatatOleh: uuid('dicatat_oleh').references(() => members.id, { onDelete: 'set null' }),
    /** Transaksi yang dihasilkan ketika pembayaran disettle. */
    transaksiId: uuid('transaksi_id').references(() => transactions.id, { onDelete: 'set null' }),
    /** Berapa kali webhook provider dipanggil (untuk observability). */
    jumlahWebhook: integer('jumlah_webhook').notNull().default(0),
    pesanGagal: text('pesan_gagal'),
    metadata: jsonb('metadata').notNull().default({}),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_payment_kode').on(t.organizationId, t.kode),
    uniqueIndex('uq_payment_idempotensi').on(t.organizationId, t.idempotencyKey),
    // INVARIANT: satu referensi provider aktif hanya boleh satu pembayaran.
    uniqueIndex('uq_payment_referensi').on(t.organizationId, t.referensiProvider),
    index('ix_payment_member').on(t.memberId),
    index('ix_payment_status').on(t.status),
    index('ix_payment_kedaluwarsa').on(t.kedaluwarsaPada),
    index('ix_payment_periode').on(t.organizationId, t.jenis, t.periode),
  ],
);

export type PembayaranBaris = typeof payments.$inferSelect;

// ============================================================
// Iuran kas periodik (pengganti kas_weeks versi lama)
// ============================================================

/** Periode iuran kas — mencakup kas mingguan maupun kas bulanan. */
export const duesPeriods = pgTable(
  'dues_periods',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    nama: text('nama').notNull(),
    /** MINGGUAN / BULANAN / KUSTOM */
    frekuensi: text('frekuensi').notNull().default('MINGGUAN'),
    /** ISO week: "2026-W10". */
    periode: text('periode').notNull(),
    mulaiPada: date('mulai_pada').notNull(),
    selesaiPada: date('selesai_pada').notNull(),
    nominal: uang('nominal').notNull().default(0),
    /** OPEN / CLOSED — hanya OPEN yang menerima pembayaran. */
    status: text('status').notNull().default('OPEN'),
    /** Tanggal paling akhir tanpa penalty. */
    batasPembayaran: date('batas_pembayaran'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    uniqueIndex('uq_dues_org_periode').on(t.organizationId, t.periode),
    index('ix_dues_status').on(t.organizationId, t.status),
  ],
);

/** Status iuran tiap anggota untuk periode kas tertentu. */
export const duesStatus = pgTable(
  'dues_status',
  {
    id: pk(),
    duesPeriodId: uuid('dues_period_id')
      .notNull()
      .references(() => duesPeriods.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** WAJIB / OPSIONAL / BELEGA / GRATIS */
    kewajiban: text('kewajiban').notNull().default('WAJIB'),
    /** LUNAS / BELUM / TERLAMBAT / DINONAKTIFKAN */
    status: text('status').notNull().default('BELUM'),
    nominal: uang('nominal').notNull().default(0),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    dibayarPada: date('dibayar_pada'),
    catatan: text('catatan'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    uniqueIndex('uq_dues_status').on(t.duesPeriodId, t.memberId),
    index('ix_dues_status_member').on(t.memberId),
    index('ix_dues_status_status').on(t.duesPeriodId, t.status),
  ],
);
