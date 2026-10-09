/**
 * Kolom & tabel bersama yang sering dipakai lintas modul.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/** PRIMARY KEY universal: UUID v4 agar ID tidak tertebak dan aman di URL. */
export const pk = () => uuid('id').primaryKey().defaultRandom();

/** Waktu dibuat. Selalu diisi database, bukan aplikasi. */
export const dibuatPada = () =>
  timestamp('dibuat_pada', { withTimezone: true }).notNull().default(sql`now()`);

/** Waktu diubah. Diperbarui oleh trigger `set_updated_at`. */
export const diubahPada = () =>
  timestamp('diubah_pada', { withTimezone: true }).notNull().default(sql`now()`);

/** Soft delete: baris disembunyikan dari UI, histori tetap ada. */
export const dihapusPada = () => timestamp('dihapus_pada', { withTimezone: true });

/** Versi baris untuk optimistic locking (mencegah tulis saling menimpa). */
export const versiBaris = () => timestamp('versi_baris', { withTimezone: true }).notNull().default(sql`now()`);

/**
 * Kolom uang dalam RUPIAH PENUH.
 *
 * Menggunakan bigint dengan mode 'number' agar otomatis ter-serialize menjadi
 * JSON number di API. Batas aman 9.007.199.254.740.991 rupiah — jauh di atas
 * kapasitas nyata kas OSIS. Bila organisasi butuh angka lebih besar, ubah ke
 * mode 'bigint' (kontrak API harus ikut bertipe string).
 */
export const uang = (nama: string) => bigint(nama, { mode: 'number' });

/**
 * Tanggal hari ini dalam format YYYY-MM-DD.
 *
 * Kolom bertipe `date` di Drizzle menerima string, bukan objek Date. Helper ini
 * dipakai repository agar tidak ada yang lupa mengonversi.
 */
export const hariIni = (): string => new Date().toISOString().slice(0, 10);

/** Ubah objek Date menjadi string YYYY-MM-DD. */
export const keTanggal = (d: Date): string => d.toISOString().slice(0, 10);

/** Nama kolom standar untuk audit trail. */
export const dibuatOleh = () => uuid('dibuat_oleh');
export const diubahOleh = () => uuid('diubah_oleh');

// ============================================================
// Enum database — cerminan dari @osda/contracts
// ============================================================

export const enumStatusPengguna = pgEnum('status_pengguna', [
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'PENDING',
]);

export const enumProviderIdentitas = pgEnum('provider_identitas', [
  'WHATSAPP',
  'EMAIL',
  'GOOGLE',
  'PASSWORD',
]);

export const enumStatusAnggota = pgEnum('status_anggota', [
  'ACTIVE',
  'INACTIVE',
  'ALUMNI',
  'SUSPENDED',
  'REMOVED',
]);

export const enumStatusPeriode = pgEnum('status_periode', ['UPCOMING', 'ACTIVE', 'ARCHIVED']);

export const enumTingkatJabatan = pgEnum('tingkat_jabatan', [
  'BOARD',
  'COORDINATOR',
  'STAFF',
  'MEMBER',
]);

export const enumCakupan = pgEnum('cakupan', ['OWN', 'DIVISION', 'ORGANIZATION', 'FINANCE', 'SYSTEM']);

export const enumJenisAbsensi = pgEnum('jenis_absensi', [
  'MEETING',
  'EVENT',
  'ACTIVITY',
  'TRAINING',
  'COMMITTEE',
]);

export const enumStatusSesi = pgEnum('status_sesi', ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']);

export const enumStatusHadir = pgEnum('status_hadir', [
  'PRESENT',
  'LATE',
  'EXCUSED',
  'SICK',
  'ABSENT',
]);

export const enumSumberAbsensi = pgEnum('sumber_absensi', [
  'WEB',
  'MOBILE',
  'WHATSAPP',
  'ADMIN',
  'QR',
]);

export const enumStatusRapat = pgEnum('status_rapat', [
  'SCHEDULED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
]);

export const enumStatusNotulen = pgEnum('status_notulen', ['DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED']);

export const enumStatusTugas = pgEnum('status_tugas', [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'CANCELLED',
]);

export const enumStatusVerifikasi = pgEnum('status_verifikasi', [
  'UNVERIFIED',
  'VERIFIED',
  'REJECTED',
]);

export const enumPrioritas = pgEnum('prioritas', ['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const enumStatusIzin = pgEnum('status_izin', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

export const enumStatusProgram = pgEnum('status_program', [
  'DRAFT',
  'PROPOSED',
  'APPROVED',
  'PLANNED',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
]);

export const enumStatusAcara = pgEnum('status_acara', [
  'DRAFT',
  'PLANNED',
  'REGISTRATION',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
]);

export const enumJenisAkun = pgEnum('jenis_akun', [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
]);

export const enumJenisTransaksi = pgEnum('jenis_transaksi', [
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'REIMBURSEMENT',
  'ADJUSTMENT',
]);

export const enumArahTransaksi = pgEnum('arah_transaksi', ['IN', 'OUT']);

export const enumStatusTransaksi = pgEnum('status_transaksi', [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'POSTED',
]);

export const enumStatusAnggaran = pgEnum('status_anggaran', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'ACTIVE',
  'REVISED',
  'CLOSED',
]);

export const enumStatusPengajuan = pgEnum('status_pengajuan', [
  'SUBMITTED',
  'REVIEWED',
  'APPROVED',
  'REJECTED',
  'PAID',
  'CANCELLED',
]);

export const enumStatusReimbursement = pgEnum('status_reimbursement', [
  'SUBMITTED',
  'REVIEWED',
  'APPROVED',
  'PAID',
  'REJECTED',
  'CANCELLED',
]);

export const enumStatusPeriodeKeuangan = pgEnum('status_periode_keuangan', ['OPEN', 'CLOSED']);

export const enumMetodePembayaran = pgEnum('metode_pembayaran', [
  'CASH',
  'QRIS',
  'BANK_TRANSFER',
  'EWALLET',
]);

export const enumStatusPembayaran = pgEnum('status_pembayaran', [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
]);

export const enumStatusDokumen = pgEnum('status_dokumen', ['DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED']);

export const enumAudiens = pgEnum('audiens', ['ALL', 'BOARD', 'DIVISION', 'EVENT', 'CUSTOM']);

export const enumKanal = pgEnum('kanal', ['WEB', 'MOBILE', 'WHATSAPP', 'EMAIL']);

export const enumStatusKomunikasi = pgEnum('status_komunikasi', [
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'ARCHIVED',
]);

export const enumStatusPengiriman = pgEnum('status_pengiriman', [
  'PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
]);

export const enumJenisNotifikasi = pgEnum('jenis_notifikasi', [
  'ATTENDANCE',
  'TASK',
  'MEETING',
  'PROGRAM',
  'FINANCE',
  'APPROVAL',
  'ANNOUNCEMENT',
  'SYSTEM',
]);

export const enumMetodeNotifikasi = pgEnum('metode_notifikasi', [
  'IN_APP',
  'PUSH',
  'WHATSAPP',
  'EMAIL',
]);

export const enumPrioritasNotifikasi = pgEnum('prioritas_notifikasi', [
  'LOW',
  'NORMAL',
  'HIGH',
  'CRITICAL',
]);

export const enumJenisPersetujuan = pgEnum('jenis_persetujuan', [
  'PROGRAM',
  'BUDGET',
  'EXPENSE',
  'REIMBURSEMENT',
  'DOCUMENT',
  'ANNOUNCEMENT',
  'EVENT',
  'MINUTES',
  'LEAVE',
]);

export const enumStatusPersetujuan = pgEnum('status_persetujuan', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const enumSumberAudit = pgEnum('sumber_audit', [
  'API',
  'WEB',
  'MOBILE',
  'WHATSAPP',
  'SYSTEM',
  'MIGRATION',
]);

export const enumStatusFitur = pgEnum('status_fitur', ['ON', 'OFF']);

/** Ekspor ulang helper agar modul schema tidak perlu mengulang definisi. */
export {
  index,
  pgTable,
  primaryKey,
  uniqueIndex,
  uuid,
  varchar,
  sql,
  timestamp,
};
