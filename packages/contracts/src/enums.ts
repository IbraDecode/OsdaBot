/**
 * Enum status & nilai domain yang dipakai lintas client.
 *
 * Semua status didefinisikan sebagai string union (bukan enum TypeScript)
 * agar tetap kompatibel dengan JSON, Zod, dan basis data.
 */

// ============================================================
// Identitas & organisasi
// ============================================================

/** Sumber identitas yang terkenal oleh sistem. */
export const PROVIDER_IDENTITAS = ['WHATSAPP', 'EMAIL', 'GOOGLE', 'PASSWORD'] as const;
export type ProviderIdentitas = (typeof PROVIDER_IDENTITAS)[number];

/** Status akun pengguna. */
export const STATUS_PENGGUNA = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING'] as const;
export type StatusPengguna = (typeof STATUS_PENGGUNA)[number];

/** Status anggota. Member tidak pernah dihapus keras bila punya histori. */
export const STATUS_ANGGOTA = ['ACTIVE', 'INACTIVE', 'ALUMNI', 'SUSPENDED', 'REMOVED'] as const;
export type StatusAnggota = (typeof STATUS_ANGGOTA)[number];

/** Status periode kepengurusan OSIS. */
export const STATUS_PERIODE = ['UPCOMING', 'ACTIVE', 'ARCHIVED'] as const;
export type StatusPeriode = (typeof STATUS_PERIODE)[number];

/** Tingkat jabatan dalam struktur organisasi. */
export const TINGKAT_JABATAN = ['BOARD', 'COORDINATOR', 'STAFF', 'MEMBER'] as const;
export type TingkatJabatan = (typeof TINGKAT_JABATAN)[number];

// ============================================================
// Absensi
// ============================================================

/** Jenis kegiatan yang-absensi absensi. */
export const JENIS_ABSENSI = [
  'MEETING',
  'EVENT',
  'ACTIVITY',
  'TRAINING',
  'COMMITTEE',
] as const;
export type JenisAbsensi = (typeof JENIS_ABSENSI)[number];

/** Status sesi absensi. */
export const STATUS_SESI = ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'] as const;
export type StatusSesi = (typeof STATUS_SESI)[number];

/** Status kehadiran seorang anggota pada satu sesi. */
export const STATUS_HADIR = ['PRESENT', 'LATE', 'EXCUSED', 'SICK', 'ABSENT'] as const;
export type StatusHadir = (typeof STATUS_HADIR)[number];

/** Kanal yang dipakai anggota untuk mengirim kehadiran. */
export const SUMBER_ABSENSI = ['WEB', 'MOBILE', 'WHATSAPP', 'ADMIN', 'QR'] as const;
export type SumberAbsensi = (typeof SUMBER_ABSENSI)[number];

/** Status kehadiran yang dianggap "ter hadir" (bukan absen). */
export const STATUS_TERHADIR: readonly StatusHadir[] = ['PRESENT', 'LATE'];

/** Alasan yang wajib diisi otomatis oleh sistem. */
export const ALASAN_HADIR_WAJB: readonly StatusHadir[] = ['EXCUSED', 'SICK'];

// ============================================================
// Rapat & notulen
// ============================================================

/** Status rapat. */
export const STATUS_RAPAT = ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;
export type StatusRapat = (typeof STATUS_RAPAT)[number];

/** Status notulen rapat. Setelah APPROVED tidak boleh ditimpa tanpa revisi baru. */
export const STATUS_NOTULEN = ['DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED'] as const;
export type StatusNotulen = (typeof STATUS_NOTULEN)[number];

// ============================================================
// Tugas
// ============================================================

/** Status tugas. PENTING: DONE belum berarti VERIFIED. */
export const STATUS_TUGAS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const;
export type StatusTugas = (typeof STATUS_TUGAS)[number];

/** Status verifikasi tugas oleh atasan/penguji. */
export const STATUS_VERIFIKASI = ['UNVERIFIED', 'VERIFIED', 'REJECTED'] as const;
export type StatusVerifikasi = (typeof STATUS_VERIFIKASI)[number];

/** Prioritas tugas. */
export const PRIORITAS_TUGAS = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type PrioritasTugas = (typeof PRIORITAS_TUGAS)[number];

/** Permintaan izin yang harus diverifikasi. */
export const STATUS_IZIN = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type StatusIzin = (typeof STATUS_IZIN)[number];

// ============================================================
// Program kerja
// ============================================================

/** Status program kerja (alur: DRAFT → PROPOSED → APPROVED → RUNNING → COMPLETED). */
export const STATUS_PROGRAM = [
  'DRAFT',
  'PROPOSED',
  'APPROVED',
  'PLANNED',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
] as const;
export type StatusProgram = (typeof STATUS_PROGRAM)[number];

/** Peta transisi status program yang sah. */
export const TRANSISI_PROGRAM: Readonly<Record<StatusProgram, readonly StatusProgram[]>> = {
  DRAFT: ['PROPOSED', 'CANCELLED'],
  PROPOSED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PLANNED', 'CANCELLED'],
  PLANNED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Status acara. */
export const STATUS_ACARA = ['DRAFT', 'PLANNED', 'REGISTRATION', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;
export type StatusAcara = (typeof STATUS_ACARA)[number];

// ============================================================
// Keuangan
// ============================================================

/** Jenis akun dalam chart of accounts. */
export const JENIS_AKUN = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type JenisAkun = (typeof JENIS_AKUN)[number];

/** Arah transaksi terhadap kas. */
export const ARAH_TRANSAKSI = ['IN', 'OUT'] as const;
export type ArahTransaksi = (typeof ARAH_TRANSAKSI)[number];

/** Jenis transaksi kas. */
export const JENIS_TRANSAKSI = [
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'REIMBURSEMENT',
  'ADJUSTMENT',
] as const;
export type JenisTransaksi = (typeof JENIS_TRANSAKSI)[number];

/** Status transaksi sebelum masuk ledger. */
export const STATUS_TRANSAKSI = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED'] as const;
export type StatusTransaksi = (typeof STATUS_TRANSAKSI)[number];

/** Status pengajuan reimbursement. */
export const STATUS_REIMBURSEMENT = ['SUBMITTED', 'REVIEWED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'] as const;
export type StatusReimbursement = (typeof STATUS_REIMBURSEMENT)[number];

/** Metode pembayaran yang didukung. */
export const METODE_PEMBAYARAN = ['CASH', 'QRIS', 'BANK_TRANSFER', 'EWALLET'] as const;
export type MetodePembayaran = (typeof METODE_PEMBAYARAN)[number];

/** Status periode keuangan (buku besar). */
export const STATUS_PERIODE_KEUANGAN = ['OPEN', 'CLOSED'] as const;
export type StatusPeriodeKeuangan = (typeof STATUS_PERIODE_KEUANGAN)[number];

/** Status anggaran. */
export const STATUS_ANGGARAN = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'REVISED', 'CLOSED'] as const;
export type StatusAnggaran = (typeof STATUS_ANGGARAN)[number];

/** Status pengajuan pengeluaran. */
export const STATUS_PENGAJUAN = ['SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'] as const;
export type StatusPengajuan = (typeof STATUS_PENGAJUAN)[number];

// ============================================================
// Dokumen
// ============================================================

/** Kategori dokumen (kategori di seed kustom lewat database). */
export const KATEGORI_DOKUMEN_BAWAAN = [
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
] as const;
export type KategoriDokumenBawaan = (typeof KATEGORI_DOKUMEN_BAWAAN)[number];

/** Status dokumen. Versi yang APPROVED bersifat immutable. */
export const STATUS_DOKUMEN = ['DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED'] as const;
export type StatusDokumen = (typeof STATUS_DOKUMEN)[number];

// ============================================================
// Komunikasi
// ============================================================

/** Audiens pengumuman/pengiriman. */
export const AUDIENS = ['ALL', 'BOARD', 'DIVISION', 'EVENT', 'CUSTOM'] as const;
export type Audiens = (typeof AUDIENS)[number];

/** Kanal pengiriman. Satu pengumuman dibuat sekali, backend menentukan kanal. */
export const KANAL = ['WEB', 'MOBILE', 'WHATSAPP', 'EMAIL'] as const;
export type Kanal = (typeof KANAL)[number];

/** Status pengumuman/kampanye. */
export const STATUS_KOMUNIKASI = ['DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const;
export type StatusKomunikasi = (typeof STATUS_KOMUNIKASI)[number];

/** Status pengiriman per penerima. */
export const STATUS_PENGIRIMAN = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
export type StatusPengiriman = (typeof STATUS_PENGIRIMAN)[number];

// ============================================================
// Notifikasi
// ============================================================

/** Jenis notifikasi. */
export const JENIS_NOTIFIKASI = [
  'ATTENDANCE',
  'TASK',
  'MEETING',
  'PROGRAM',
  'FINANCE',
  'APPROVAL',
  'ANNOUNCEMENT',
  'SYSTEM',
] as const;
export type JenisNotifikasi = (typeof JENIS_NOTIFIKASI)[number];

/** Metode pengiriman notifikasi. */
export const METODE_NOTIFIKASI = ['IN_APP', 'PUSH', 'WHATSAPP', 'EMAIL'] as const;
export type MetodeNotifikasi = (typeof METODE_NOTIFIKASI)[number];

/** Prioritas notifikasi. Menentukan apakah dikirim ke WhatsApp atau tidak. */
export const PRIORITAS_NOTIFIKASI = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type PrioritasNotifikasi = (typeof PRIORITAS_NOTIFIKASI)[number];

/** Status baca notifikasi. */
export const STATUS_BACA = ['UNREAD', 'READ'] as const;
export type StatusBaca = (typeof STATUS_BACA)[number];

// ============================================================
// Persetujuan & audit
// ============================================================

/** Jenis entitas yang dapat requestingpersetujuan. */
export const JENIS_PERSETUJUAN = [
  'PROGRAM',
  'BUDGET',
  'EXPENSE',
  'REIMBURSEMENT',
  'DOCUMENT',
  'ANNOUNCEMENT',
  'EVENT',
  'MINUTES',
  'LEAVE',
] as const;
export type JenisPersetujuan = (typeof JENIS_PERSETUJUAN)[number];

/** Status permintaan persetujuan. */
export const STATUS_PERSETUJUAN = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type StatusPersetujuan = (typeof STATUS_PERSETUJUAN)[number];

/** Aksi sensitif yang tercatat di audit log. */
export const AKSI_AUDIT = [
  'USER_CREATED',
  'USER_UPDATED',
  'ROLE_CHANGED',
  'MEMBER_CREATED',
  'MEMBER_UPDATED',
  'MEMBER_ARCHIVED',
  'ATTENDANCE_RECORDED',
  'ATTENDANCE_MANUALLY_CHANGED',
  'ATTENDANCE_SESSION_CLOSED',
  'MEETING_CREATED',
  'MEETING_UPDATED',
  'MINUTES_APPROVED',
  'TASK_ASSIGNED',
  'TASK_VERIFIED',
  'PROGRAM_CREATED',
  'PROGRAM_APPROVED',
  'EXPENSE_CREATED',
  'EXPENSE_APPROVED',
  'PAYMENT_SETTLED',
  'DOCUMENT_APPROVED',
  'ANNOUNCEMENT_PUBLISHED',
  'PERIOD_ARCHIVED',
  'SETTINGS_CHANGED',
] as const;
export type AksiAudit = (typeof AKSI_AUDIT)[number];

/** Sumber perubahan untuk audit. */
export const SUMBER_AUDIT = ['API', 'WEB', 'MOBILE', 'WHATSAPP', 'SYSTEM', 'MIGRATION'] as const;
export type SumberAudit = (typeof SUMBER_AUDIT)[number];
