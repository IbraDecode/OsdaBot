CREATE TYPE "public"."arah_transaksi" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."audiens" AS ENUM('ALL', 'BOARD', 'DIVISION', 'EVENT', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."cakupan" AS ENUM('OWN', 'DIVISION', 'ORGANIZATION', 'FINANCE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."jenis_absensi" AS ENUM('MEETING', 'EVENT', 'ACTIVITY', 'TRAINING', 'COMMITTEE');--> statement-breakpoint
CREATE TYPE "public"."jenis_akun" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."jenis_notifikasi" AS ENUM('ATTENDANCE', 'TASK', 'MEETING', 'PROGRAM', 'FINANCE', 'APPROVAL', 'ANNOUNCEMENT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."jenis_persetujuan" AS ENUM('PROGRAM', 'BUDGET', 'EXPENSE', 'REIMBURSEMENT', 'DOCUMENT', 'ANNOUNCEMENT', 'EVENT', 'MINUTES', 'LEAVE');--> statement-breakpoint
CREATE TYPE "public"."jenis_transaksi" AS ENUM('INCOME', 'EXPENSE', 'TRANSFER', 'REIMBURSEMENT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."kanal" AS ENUM('WEB', 'MOBILE', 'WHATSAPP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."metode_notifikasi" AS ENUM('IN_APP', 'PUSH', 'WHATSAPP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."metode_pembayaran" AS ENUM('CASH', 'QRIS', 'BANK_TRANSFER', 'EWALLET');--> statement-breakpoint
CREATE TYPE "public"."prioritas" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."prioritas_notifikasi" AS ENUM('LOW', 'NORMAL', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."provider_identitas" AS ENUM('WHATSAPP', 'EMAIL', 'GOOGLE', 'PASSWORD');--> statement-breakpoint
CREATE TYPE "public"."status_acara" AS ENUM('DRAFT', 'PLANNED', 'REGISTRATION', 'ONGOING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_anggaran" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'REVISED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."status_anggota" AS ENUM('ACTIVE', 'INACTIVE', 'ALUMNI', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."status_dokumen" AS ENUM('DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."status_fitur" AS ENUM('ON', 'OFF');--> statement-breakpoint
CREATE TYPE "public"."status_hadir" AS ENUM('PRESENT', 'LATE', 'EXCUSED', 'SICK', 'ABSENT');--> statement-breakpoint
CREATE TYPE "public"."status_izin" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_komunikasi" AS ENUM('DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."status_notulen" AS ENUM('DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."status_pembayaran" AS ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."status_pengajuan" AS ENUM('SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_pengguna" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."status_pengiriman" AS ENUM('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."status_periode" AS ENUM('UPCOMING', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."status_periode_keuangan" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."status_persetujuan" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_program" AS ENUM('DRAFT', 'PROPOSED', 'APPROVED', 'PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_rapat" AS ENUM('SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_reimbursement" AS ENUM('SUBMITTED', 'REVIEWED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_sesi" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_transaksi" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED');--> statement-breakpoint
CREATE TYPE "public"."status_tugas" AS ENUM('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."status_verifikasi" AS ENUM('UNVERIFIED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."sumber_absensi" AS ENUM('WEB', 'MOBILE', 'WHATSAPP', 'ADMIN', 'QR');--> statement-breakpoint
CREATE TYPE "public"."sumber_audit" AS ENUM('API', 'WEB', 'MOBILE', 'WHATSAPP', 'SYSTEM', 'MIGRATION');--> statement-breakpoint
CREATE TYPE "public"."tingkat_jabatan" AS ENUM('BOARD', 'COORDINATOR', 'STAFF', 'MEMBER');--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"nama" text NOT NULL,
	"kode" text NOT NULL,
	"deskripsi" text,
	"id_divisi_induk" uuid,
	"koordinator_member_id" uuid,
	"urutan" integer DEFAULT 100 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"dibuat_oleh" uuid
);
--> statement-breakpoint
CREATE TABLE "organization_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"mulai_pada" date NOT NULL,
	"selesai_pada" date NOT NULL,
	"status" "status_periode" DEFAULT 'UPCOMING' NOT NULL,
	"deskripsi" text,
	"diarsipkan_pada" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"dibuat_oleh" uuid
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nama" text NOT NULL,
	"singkat" text NOT NULL,
	"jenis" text DEFAULT 'OSIS' NOT NULL,
	"nama_sekolah" text NOT NULL,
	"npsn" text,
	"alamat" text,
	"kode_pos" text,
	"telepon" text,
	"email" text,
	"website" text,
	"logo_url" text,
	"zona_waktu" text DEFAULT 'Asia/Makassar' NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"division_id" uuid,
	"mulai_pada" date,
	"selesai_pada" date,
	"dokumen_id" uuid,
	"catatan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"dibuat_oleh" uuid
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"kode" text NOT NULL,
	"tingkat" "tingkat_jabatan" DEFAULT 'MEMBER' NOT NULL,
	"urutan" integer DEFAULT 100 NOT NULL,
	"deskripsi" text,
	"butuh_sk" boolean DEFAULT true NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"dibuat_oleh" uuid
);
--> statement-breakpoint
CREATE TABLE "account_link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid,
	"provider_subject" text NOT NULL,
	"member_id" uuid,
	"user_id" uuid,
	"kode" text NOT NULL,
	"berlaku_sampai" date NOT NULL,
	"dipakai_pada" date,
	"gagal_percobaan" integer DEFAULT 0 NOT NULL,
	"alasan_gagal" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kunci" text NOT NULL,
	"nilai" jsonb NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider_identitas" NOT NULL,
	"provider_subject" text NOT NULL,
	"provider_subject_kanonik" text NOT NULL,
	"whatsapp_lid" text,
	"nama_tampilan" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diverifikasi_pada" date,
	"dipakai_terakhir_pada" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_period_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"status" "status_anggota" NOT NULL,
	"bergabung_pada" date NOT NULL,
	"selesai_pada" date,
	"catatan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"user_id" uuid,
	"nomor" text NOT NULL,
	"nama" text NOT NULL,
	"tingkat" text NOT NULL,
	"jurusan" text,
	"sub_kelas" text,
	"nis" text,
	"nisn" text,
	"email" text,
	"telepon" text,
	"division_id" uuid,
	"jenis_kelamin" text,
	"tanggal_lahir" date,
	"alamat" text,
	"bio" text,
	"foto_url" text,
	"status" "status_anggota" DEFAULT 'ACTIVE' NOT NULL,
	"bergabung_pada" date NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diarsipkan_pada" date,
	"alasan_arsip" text
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tipe" text NOT NULL,
	"token_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"berlaku_sampai" date NOT NULL,
	"dipakai_pada" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"jaringan" text,
	"terakhir_dipakai_pada" date,
	"kedaluwarsa_pada" date,
	"dicabut_pada" date,
	"alasan_pencabutan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nama" text NOT NULL,
	"email" text,
	"telepon" text,
	"password_hash" text,
	"status" "status_pengguna" DEFAULT 'ACTIVE' NOT NULL,
	"email_diverifikasi_pada" date,
	"telepon_diverifikasi_pada" date,
	"bahasa" text DEFAULT 'id' NOT NULL,
	"preferensi_notifikasi" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avatar_url" text,
	"login_terakhir_pada" date,
	"gagal_login_berturut" integer DEFAULT 0 NOT NULL,
	"dikunci_sampai" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"dihapus_pada" date
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pemberi_member_id" uuid NOT NULL,
	"penerima_member_id" uuid NOT NULL,
	"permission_id" uuid,
	"alasan" text NOT NULL,
	"mulai_pada" text NOT NULL,
	"selesai_pada" text NOT NULL,
	"dicabut_pada" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"period_id" uuid,
	"position_assignment_id" uuid,
	"division_id" uuid,
	"mulai_pada" text,
	"selesai_pada" text,
	"diberikan_oleh" uuid,
	"alasan" text,
	"dicabut_pada" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kode" text NOT NULL,
	"modul" text NOT NULL,
	"aksi" text NOT NULL,
	"deskripsi" text NOT NULL,
	"sensitif" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"cakupan" "cakupan" DEFAULT 'OWN' NOT NULL,
	"kondisi" jsonb,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_cakupan_pk" PRIMARY KEY("role_id","permission_id","cakupan")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"deskripsi" text,
	"bawaan" boolean DEFAULT false NOT NULL,
	"tingkat_jabatan" text,
	"tunggal" boolean DEFAULT false NOT NULL,
	"cakupan_default" text,
	"warisi_dari_kode" text,
	"urutan" integer DEFAULT 100 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"dibuat_oleh" uuid
);
--> statement-breakpoint
CREATE TABLE "attendance_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"wajib" boolean DEFAULT true NOT NULL,
	"sudah_absen" boolean DEFAULT false NOT NULL,
	"ditampilkan" integer DEFAULT 0 NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_qr_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"jti" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"dibuat_pada" date DEFAULT now() NOT NULL,
	"berlaku_sampai" date NOT NULL,
	"dipakai_pada" date,
	"dipakai_oleh_member_id" uuid,
	"dibatalkan" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "status_hadir" NOT NULL,
	"alasan" text,
	"catatan" text,
	"sumber" "sumber_absensi" DEFAULT 'WEB' NOT NULL,
	"menit_keterlambatan" integer,
	"direkam_pada" date DEFAULT now() NOT NULL,
	"qr_token_jti" uuid,
	"diubah_oleh" uuid,
	"diubah_pada" date,
	"alasan_perubahan" text,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"meeting_id" uuid,
	"event_id" uuid,
	"jenis" "jenis_absensi" NOT NULL,
	"judul" text NOT NULL,
	"tanggal" date NOT NULL,
	"waktu_mulai" time,
	"waktu_selesai" time,
	"mulai_pada" date,
	"selesai_pada" date,
	"lokasi" text,
	"status" "status_sesi" DEFAULT 'DRAFT' NOT NULL,
	"hanya_division_ids" uuid[] DEFAULT '{}' NOT NULL,
	"hanya_jabatan_ids" uuid[] DEFAULT '{}' NOT NULL,
	"member_ids" uuid[],
	"wajib_hadir" boolean DEFAULT true NOT NULL,
	"batas_keterlambatan_menit" integer DEFAULT 15 NOT NULL,
	"qr_ttl_detik" integer DEFAULT 120 NOT NULL,
	"qr_secret" text,
	"qr_terakhir_diatur_pada" date,
	"dibuka_pada" date,
	"ditutup_pada" date,
	"ditutup_oleh" uuid,
	"rekap_total_wajib" integer DEFAULT 0 NOT NULL,
	"rekap_hadir" integer DEFAULT 0 NOT NULL,
	"rekap_izin" integer DEFAULT 0 NOT NULL,
	"rekap_sakit" integer DEFAULT 0 NOT NULL,
	"rekap_tidak_hadir" integer DEFAULT 0 NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE "permission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"jenis" text DEFAULT 'EXCUSED' NOT NULL,
	"alasan" text NOT NULL,
	"bukti_dokumen_id" uuid,
	"status" "status_izin" DEFAULT 'PENDING' NOT NULL,
	"diputusan_oleh" uuid,
	"diputusan_pada" date,
	"komentar" text,
	"kode" text NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minutes_id" uuid NOT NULL,
	"isi" text NOT NULL,
	"penanggung_jawab_member_id" uuid,
	"batas_waktu" date,
	"prioritas" "prioritas" DEFAULT 'NORMAL' NOT NULL,
	"task_id" uuid,
	"selesai" boolean DEFAULT false NOT NULL,
	"selesai_pada" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_agenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"judul" text NOT NULL,
	"deskripsi" text,
	"pembicara" text,
	"durasi_menit" integer,
	"mulai_pukul" time,
	"selesai_pukul" time,
	"urutan" integer DEFAULT 0 NOT NULL,
	"dibahas" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"jenis" text DEFAULT 'LAMPIRAN' NOT NULL,
	"keterangan" text,
	"diunggah_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"nomor" text,
	"versi" integer DEFAULT 1 NOT NULL,
	"ringkasan" text NOT NULL,
	"pembahasan" text,
	"keputusan" text[] DEFAULT '{}' NOT NULL,
	"status" "status_notulen" DEFAULT 'DRAFT' NOT NULL,
	"alasan_revisi" text,
	"dikunci_pada" date,
	"penulis_id" uuid,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"komentar_persetujuan" text,
	"diarsipkan_pada" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"division_id" uuid,
	"wajib" boolean DEFAULT true NOT NULL,
	"hadir" boolean DEFAULT false NOT NULL,
	"status_hadir" text,
	"hadir_pada" date,
	"alasan_tidak_hadir" text,
	"diundang_pada" date,
	"sudah_dibaca_undangan" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"program_id" uuid,
	"division_id" uuid,
	"judul" text NOT NULL,
	"deskripsi" text,
	"tanggal" date NOT NULL,
	"waktu_mulai" time NOT NULL,
	"waktu_selesai" time NOT NULL,
	"lokasi" text,
	"jenis" text DEFAULT 'RUTIN' NOT NULL,
	"audiens_deskripsi" text,
	"pembicara" text[] DEFAULT '{}' NOT NULL,
	"division_ids" uuid[] DEFAULT '{}' NOT NULL,
	"jabatan_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" "status_rapat" DEFAULT 'SCHEDULED' NOT NULL,
	"session_id" uuid,
	"mulai_pada" date,
	"selesai_pada" date,
	"undangan_terkirim_pada" date,
	"pengingat_terkirim" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revisi" integer DEFAULT 1 NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid,
	"tipe" text NOT NULL,
	"isi" text,
	"status_sebelum" text,
	"status_sesudah" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"utama" boolean DEFAULT false NOT NULL,
	"diterima_pada" date,
	"selesai_pada" date,
	"progres" integer DEFAULT 0 NOT NULL,
	"catatan" text,
	"ditugaskan_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"isi" text NOT NULL,
	"selesai" boolean DEFAULT false NOT NULL,
	"selesai_oleh" uuid,
	"selesai_pada" date,
	"urutan" integer DEFAULT 0 NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"bergantung_pada_task_id" uuid NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"program_id" uuid,
	"meeting_id" uuid,
	"division_id" uuid,
	"division_tujuan_id" uuid,
	"parent_id" uuid,
	"kode" text NOT NULL,
	"judul" text NOT NULL,
	"deskripsi" text,
	"status" "status_tugas" DEFAULT 'TODO' NOT NULL,
	"verifikasi" "status_verifikasi" DEFAULT 'UNVERIFIED' NOT NULL,
	"butuh_verifikasi" boolean DEFAULT true NOT NULL,
	"prioritas" "prioritas" DEFAULT 'NORMAL' NOT NULL,
	"batas_waktu" date,
	"mulai_dikerjakan_pada" date,
	"selesai_pada" date,
	"diverifikasi_pada" date,
	"diverifikasi_oleh" uuid,
	"verifikasi_komentar" text,
	"progres" integer DEFAULT 0 NOT NULL,
	"lampiran_dokumen_ids" uuid[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"tipe" text DEFAULT 'HADIR' NOT NULL,
	"waktu" date DEFAULT now() NOT NULL,
	"dicatat_oleh" uuid,
	"catatan" text
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"peran" text DEFAULT 'PESERTA' NOT NULL,
	"divisi" text,
	"tugas" text,
	"terdaftar_pada" date DEFAULT now() NOT NULL,
	"hadir" boolean DEFAULT false NOT NULL,
	"hadir_pada" date,
	"dibatalkan_pada" date,
	"alasan_pembatalan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"judul" text NOT NULL,
	"deskripsi" text,
	"mulai_pukul" time NOT NULL,
	"selesai_pukul" time,
	"lokasi" text,
	"penanggung_jawab_member_id" uuid,
	"urutan" integer DEFAULT 0 NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"program_id" uuid,
	"division_id" uuid,
	"kode" text NOT NULL,
	"judul" text NOT NULL,
	"deskripsi" text,
	"tanggal" date NOT NULL,
	"waktu_mulai" time,
	"waktu_selesai" time,
	"lokasi" text,
	"detail_lokasi" text,
	"status" "status_acara" DEFAULT 'DRAFT' NOT NULL,
	"penanggung_jawab_member_id" uuid NOT NULL,
	"kapasitas" integer,
	"kuota_kelas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"butuh_absensi" boolean DEFAULT true NOT NULL,
	"butuh_pendaftaran" boolean DEFAULT false NOT NULL,
	"pendaftaran_mulai_pada" date,
	"pendaftaran_selesai_pada" date,
	"session_id" uuid,
	"biaya_diajukan" bigint DEFAULT 0 NOT NULL,
	"progres" integer DEFAULT 0 NOT NULL,
	"cover_url" text,
	"sudah_dkomunikasikan" boolean DEFAULT false NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"jenis" text DEFAULT 'DOKUMENTASI' NOT NULL,
	"keterangan" text,
	"diunggah_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"capaian" text NOT NULL,
	"kendala" text,
	"pelajaran" text,
	"rekomendasi" text,
	"skor_kualitas" numeric(5, 2),
	"skor_keberhasilan" numeric(5, 2),
	"dievaluasi_oleh" uuid,
	"dievaluasi_pada" date DEFAULT now() NOT NULL,
	"publik" boolean DEFAULT false NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"division_id" uuid,
	"peran" text DEFAULT 'ANGGOTA' NOT NULL,
	"jabatan_id" uuid,
	"tanggal_bergabung" date DEFAULT now() NOT NULL,
	"tanggal_keluar" date,
	"deskripsi_peran" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"deskripsi" text,
	"tanggal" date NOT NULL,
	"selesai" boolean DEFAULT false NOT NULL,
	"selesai_pada" date,
	"urutan" integer DEFAULT 0 NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"division_id" uuid,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"tujuan" text NOT NULL,
	"deskripsi" text,
	"latar_belakang" text,
	"status" "status_program" DEFAULT 'DRAFT' NOT NULL,
	"prioritas" "prioritas" DEFAULT 'NORMAL' NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"anggaran_diajukan" bigint DEFAULT 0 NOT NULL,
	"anggaran_disetujui" bigint DEFAULT 0 NOT NULL,
	"realisasi_pengeluaran" bigint DEFAULT 0 NOT NULL,
	"mulai_pada" date NOT NULL,
	"selesai_pada" date NOT NULL,
	"mulai_riwayat_pada" date,
	"selesai_riwayat_pada" date,
	"indikator" text[] DEFAULT '{}' NOT NULL,
	"progres" integer DEFAULT 0 NOT NULL,
	"total_tugas" integer DEFAULT 0 NOT NULL,
	"tugas_selesai" integer DEFAULT 0 NOT NULL,
	"total_acara" integer DEFAULT 0 NOT NULL,
	"warna" text DEFAULT '#0ea5e9',
	"ikon" text,
	"cover_url" text,
	"template_id" uuid,
	"diajukan_pada" date,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"alasan_penolakan" text,
	"dibatalkan_pada" date,
	"alasan_pembatalan" text,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"jenis" "jenis_akun" NOT NULL,
	"induk_id" uuid,
	"deskripsi" text,
	"require_memo" boolean DEFAULT false NOT NULL,
	"adalah_kas" boolean DEFAULT false NOT NULL,
	"posting_otomatis" boolean DEFAULT true NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"keterangan" text NOT NULL,
	"nominal" bigint NOT NULL,
	"realisasi" bigint DEFAULT 0 NOT NULL,
	"catatan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"program_id" uuid,
	"event_id" uuid,
	"financial_period_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"total_diajukan" bigint DEFAULT 0 NOT NULL,
	"total_disetujui" bigint DEFAULT 0 NOT NULL,
	"catatan" text,
	"status" "status_anggaran" DEFAULT 'DRAFT' NOT NULL,
	"diajukan_pada" date,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"alasan_penolakan" text,
	"revisi" integer DEFAULT 1 NOT NULL,
	"parent_id" uuid,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dues_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"frekuensi" text DEFAULT 'MINGGUAN' NOT NULL,
	"periode" text NOT NULL,
	"mulai_pada" date NOT NULL,
	"selesai_pada" date NOT NULL,
	"nominal" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"batas_pembayaran" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dues_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dues_period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kewajiban" text DEFAULT 'WAJIB' NOT NULL,
	"status" text DEFAULT 'BELUM' NOT NULL,
	"nominal" bigint DEFAULT 0 NOT NULL,
	"payment_id" uuid,
	"dibayar_pada" date,
	"catatan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"jenis" text DEFAULT 'EXPENSE' NOT NULL,
	"account_id" uuid NOT NULL,
	"program_id" uuid,
	"event_id" uuid,
	"budget_id" uuid,
	"nominal" bigint NOT NULL,
	"keterangan" text NOT NULL,
	"tanggal" date NOT NULL,
	"status" "status_pengajuan" DEFAULT 'SUBMITTED' NOT NULL,
	"bukti_dokumen_id" uuid,
	"pemohon_member_id" uuid NOT NULL,
	"direview_oleh" uuid,
	"direview_pada" date,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"dibayar_oleh" uuid,
	"dibayar_pada" date,
	"metode_pembayaran" "metode_pembayaran",
	"bukti_transfer" text,
	"alasan_penolakan" text,
	"transaksi_id" uuid,
	"idempotency_key" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"nama" text NOT NULL,
	"mulai_pada" date NOT NULL,
	"selesai_pada" date NOT NULL,
	"saldo_awal" bigint DEFAULT 0 NOT NULL,
	"status" "status_periode_keuangan" DEFAULT 'OPEN' NOT NULL,
	"ditutup_pada" date,
	"ditutup_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaksi_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"financial_period_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"kredit" bigint DEFAULT 0 NOT NULL,
	"saldo_berjalan" bigint DEFAULT 0 NOT NULL,
	"narration" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"member_id" uuid NOT NULL,
	"jenis" text DEFAULT 'KAS' NOT NULL,
	"periode" text,
	"program_id" uuid,
	"event_id" uuid,
	"nominal" bigint NOT NULL,
	"metode" "metode_pembayaran" DEFAULT 'QRIS' NOT NULL,
	"status" "status_pembayaran" DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"referensi_provider" text,
	"qr_string" text,
	"qr_url" text,
	"kedaluwarsa_pada" date NOT NULL,
	"dibayar_pada" date,
	"bukti_transfer" text,
	"dicatat_oleh" uuid,
	"transaksi_id" uuid,
	"jumlah_webhook" integer DEFAULT 0 NOT NULL,
	"pesan_gagal" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"member_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"program_id" uuid,
	"event_id" uuid,
	"nominal" bigint NOT NULL,
	"keterangan" text NOT NULL,
	"tanggal" date NOT NULL,
	"status" "status_reimbursement" DEFAULT 'SUBMITTED' NOT NULL,
	"bukti_dokumen_id" uuid,
	"direview_oleh" uuid,
	"direview_pada" date,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"dibayar_oleh" uuid,
	"dibayar_pada" date,
	"metode_pembayaran" "metode_pembayaran",
	"referensi_pembayaran" text,
	"alasan_penolakan" text,
	"transaksi_id" uuid,
	"idempotency_key" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"financial_period_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"jenis" "jenis_transaksi" NOT NULL,
	"arah" "arah_transaksi" NOT NULL,
	"account_id" uuid NOT NULL,
	"account_tujuan_id" uuid,
	"nominal" bigint NOT NULL,
	"keterangan" text NOT NULL,
	"tanggal" date NOT NULL,
	"status" "status_transaksi" DEFAULT 'DRAFT' NOT NULL,
	"program_id" uuid,
	"event_id" uuid,
	"expense_request_id" uuid,
	"reimbursement_id" uuid,
	"payment_id" uuid,
	"dicatat_oleh" uuid,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"diposting_pada" date,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"member_id" uuid,
	"role_code" text,
	"division_id" uuid,
	"hanya_baca" boolean DEFAULT true NOT NULL,
	"berlaku_sampai" date,
	"diberikan_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"deskripsi" text,
	"bawaan" boolean DEFAULT false NOT NULL,
	"retensi_hari" integer DEFAULT 0 NOT NULL,
	"perlu_persetujuan" boolean DEFAULT true NOT NULL,
	"urutan" integer DEFAULT 100 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"versi" integer NOT NULL,
	"storage_key" text NOT NULL,
	"nama_berkas" text NOT NULL,
	"ukuran_bytes" integer NOT NULL,
	"mime" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"catatan" text,
	"alasan_revisi" text,
	"diunggah_oleh" uuid,
	"diunggah_pada" date DEFAULT now() NOT NULL,
	"dikunci" boolean DEFAULT false NOT NULL,
	"dikunci_pada" date
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"judul" text NOT NULL,
	"kategori" text DEFAULT 'LAINNYA' NOT NULL,
	"deskripsi" text,
	"versi" integer DEFAULT 1 NOT NULL,
	"status" "status_dokumen" DEFAULT 'DRAFT' NOT NULL,
	"owner_member_id" uuid,
	"division_id" uuid,
	"program_id" uuid,
	"event_id" uuid,
	"meeting_id" uuid,
	"storage_key" text,
	"nama_berkas" text,
	"ukuran_bytes" integer,
	"mime" text,
	"checksum_sha256" text,
	"perlu_persetujuan" boolean DEFAULT true NOT NULL,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"alasan_penolakan" text,
	"diarsipkan_pada" date,
	"retensi_hari" integer DEFAULT 0 NOT NULL,
	"tag" text[] DEFAULT '{}' NOT NULL,
	"pencarian" text,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"arah" text NOT NULL,
	"nomor" text NOT NULL,
	"tanggal" date NOT NULL,
	"pengirim" text,
	"penerima" text,
	"instansi_pengirim" text,
	"ringkasan" text NOT NULL,
	"perlu_tindak_lanjut" boolean DEFAULT false NOT NULL,
	"batas_tindak_lanjut" date,
	"selesai_pada" date,
	"document_id" uuid,
	"dicatat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"publik" boolean DEFAULT false NOT NULL,
	"prefix" text NOT NULL,
	"batas_ukuran_bytes" integer,
	"kuota_bytes" integer,
	"dipakai_bytes" integer DEFAULT 0 NOT NULL,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"pesan" text NOT NULL,
	"actor_id" uuid,
	"actor_nama" text,
	"entitas_jenis" text NOT NULL,
	"entitas_id" uuid,
	"entitas_label" text,
	"kanal" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"division_id" uuid,
	"program_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kanal" "kanal" NOT NULL,
	"status" "status_pengiriman" DEFAULT 'PENDING' NOT NULL,
	"percobaan" integer DEFAULT 0 NOT NULL,
	"pesan_gagal" text,
	"pesan_id" text,
	"dikirim_pada" timestamp with time zone,
	"diterima_pada" timestamp with time zone,
	"dibaca_pada" timestamp with time zone,
	"dedup_key" text
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"program_id" uuid,
	"event_id" uuid,
	"judul" text NOT NULL,
	"isi" text NOT NULL,
	"ringkasan" text,
	"audiens" "audiens" DEFAULT 'ALL' NOT NULL,
	"division_ids" uuid[] DEFAULT '{}' NOT NULL,
	"jabatan_ids" uuid[] DEFAULT '{}' NOT NULL,
	"member_ids" uuid[],
	"kanal" "kanal"[] DEFAULT '{}' NOT NULL,
	"prioritas" "prioritas_notifikasi" DEFAULT 'NORMAL' NOT NULL,
	"status" "status_komunikasi" DEFAULT 'DRAFT' NOT NULL,
	"pin" boolean DEFAULT false NOT NULL,
	"perlu_persetujuan" boolean DEFAULT true NOT NULL,
	"idempotency_key" text,
	"lampiran_dokumen_ids" uuid[] DEFAULT '{}' NOT NULL,
	"tanggal_terbit" date,
	"jadwalkan_pada" timestamp with time zone,
	"terbit_pada" timestamp with time zone,
	"total_penerima" integer DEFAULT 0 NOT NULL,
	"total_terkirim" integer DEFAULT 0 NOT NULL,
	"total_terbaca" integer DEFAULT 0 NOT NULL,
	"total_gagal" integer DEFAULT 0 NOT NULL,
	"disetujui_oleh" uuid,
	"disetujui_pada" date,
	"alasan_penolakan" text,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"status" "status_persetujuan" DEFAULT 'PENDING' NOT NULL,
	"diputusan_oleh" uuid,
	"diputusan_pada" date,
	"komentar" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"jenis" "jenis_persetujuan" NOT NULL,
	"entitas_tabel" text NOT NULL,
	"entitas_id" uuid NOT NULL,
	"ringkasan" text NOT NULL,
	"nominal" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pemohon_id" uuid NOT NULL,
	"status" "status_persetujuan" DEFAULT 'PENDING' NOT NULL,
	"level_sekarang" integer DEFAULT 1 NOT NULL,
	"total_level" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"diselesaikan_pada" date,
	"alasan_penolakan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"versi_baris" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"aksi" text NOT NULL,
	"entitas_tabel" text NOT NULL,
	"entitas_id" uuid,
	"actor_id" uuid,
	"actor_member_id" uuid,
	"sumber" "sumber_audit" DEFAULT 'API' NOT NULL,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"sebelum" jsonb,
	"sesudah" jsonb,
	"field_diubah" text,
	"berhasil" boolean DEFAULT true NOT NULL,
	"pesan_galat" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid,
	"event_id" uuid,
	"nama" text NOT NULL,
	"deskripsi" text,
	"mulai_pada" date NOT NULL,
	"selesai_pada" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"announcement_ids" uuid[] DEFAULT '{}' NOT NULL,
	"budget" bigint,
	"dibuat_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"kunci" text NOT NULL,
	"status" "status_fitur" DEFAULT 'OFF' NOT NULL,
	"persentase" integer DEFAULT 100 NOT NULL,
	"deskripsi" text,
	"diubah_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"provider" text NOT NULL,
	"status" text DEFAULT 'DISABLED' NOT NULL,
	"config_terenkripsi" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"terhubung_pada" timestamp with time zone,
	"pesan_galat" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_oleh" uuid
);
--> statement-breakpoint
CREATE TABLE "legacy_id_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_tabel" text NOT NULL,
	"legacy_id" text NOT NULL,
	"target_tabel" text NOT NULL,
	"target_id" uuid NOT NULL,
	"organization_id" uuid,
	"catatan" text,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid,
	"announcement_id" uuid,
	"user_id" uuid,
	"member_id" uuid,
	"metode" "metode_notifikasi" NOT NULL,
	"kanal" "kanal",
	"status" "status_pengiriman" DEFAULT 'PENDING' NOT NULL,
	"percobaan" integer DEFAULT 0 NOT NULL,
	"pesan_gagal" text,
	"pesan_id" text,
	"job_key" text NOT NULL,
	"jadwalkan_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"dikirim_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid NOT NULL,
	"member_id" uuid,
	"jenis" "jenis_notifikasi" NOT NULL,
	"prioritas" "prioritas_notifikasi" DEFAULT 'NORMAL' NOT NULL,
	"judul" text NOT NULL,
	"isi" text NOT NULL,
	"entitas_jenis" text,
	"entitas_id" uuid,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedup_key" text,
	"dibaca_pada" timestamp with time zone,
	"kedaluwarsa_pada" timestamp with time zone,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kunci" text NOT NULL,
	"nilai" text NOT NULL,
	"deskripsi" text,
	"tipe" text DEFAULT 'string' NOT NULL,
	"diubah_oleh" uuid,
	"dibuat_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"tipe" text NOT NULL,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"diproses" boolean DEFAULT false NOT NULL,
	"pesan_gagal" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diproses_pada" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_periods" ADD CONSTRAINT "organization_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_link_requests" ADD CONSTRAINT "account_link_requests_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_link_requests" ADD CONSTRAINT "account_link_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_link_requests" ADD CONSTRAINT "account_link_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_policies" ADD CONSTRAINT "auth_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_period_history" ADD CONSTRAINT "member_period_history_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_period_history" ADD CONSTRAINT "member_period_history_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_pemberi_member_id_members_id_fk" FOREIGN KEY ("pemberi_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_penerima_member_id_members_id_fk" FOREIGN KEY ("penerima_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_participants" ADD CONSTRAINT "attendance_participants_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_participants" ADD CONSTRAINT "attendance_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_qr_tokens" ADD CONSTRAINT "attendance_qr_tokens_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_qr_tokens" ADD CONSTRAINT "attendance_qr_tokens_dipakai_oleh_member_id_members_id_fk" FOREIGN KEY ("dipakai_oleh_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_minutes_id_meeting_minutes_id_fk" FOREIGN KEY ("minutes_id") REFERENCES "public"."meeting_minutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_penanggung_jawab_member_id_members_id_fk" FOREIGN KEY ("penanggung_jawab_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda" ADD CONSTRAINT "meeting_agenda_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_penulis_id_members_id_fk" FOREIGN KEY ("penulis_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_bergantung_pada_task_id_tasks_id_fk" FOREIGN KEY ("bergantung_pada_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_division_tujuan_id_divisions_id_fk" FOREIGN KEY ("division_tujuan_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_diverifikasi_oleh_members_id_fk" FOREIGN KEY ("diverifikasi_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schedules" ADD CONSTRAINT "event_schedules_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_penanggung_jawab_member_id_members_id_fk" FOREIGN KEY ("penanggung_jawab_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_documents" ADD CONSTRAINT "program_documents_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_evaluations" ADD CONSTRAINT "program_evaluations_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_evaluations" ADD CONSTRAINT "program_evaluations_dievaluasi_oleh_members_id_fk" FOREIGN KEY ("dievaluasi_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_members" ADD CONSTRAINT "program_members_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_members" ADD CONSTRAINT "program_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_members" ADD CONSTRAINT "program_members_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_milestones" ADD CONSTRAINT "program_milestones_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_financial_period_id_financial_periods_id_fk" FOREIGN KEY ("financial_period_id") REFERENCES "public"."financial_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_disetujui_oleh_members_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_periods" ADD CONSTRAINT "dues_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_status" ADD CONSTRAINT "dues_status_dues_period_id_dues_periods_id_fk" FOREIGN KEY ("dues_period_id") REFERENCES "public"."dues_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_status" ADD CONSTRAINT "dues_status_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_status" ADD CONSTRAINT "dues_status_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_pemohon_member_id_members_id_fk" FOREIGN KEY ("pemohon_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_direview_oleh_members_id_fk" FOREIGN KEY ("direview_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_disetujui_oleh_members_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_dibayar_oleh_members_id_fk" FOREIGN KEY ("dibayar_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaksi_id_transactions_id_fk" FOREIGN KEY ("transaksi_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_financial_period_id_financial_periods_id_fk" FOREIGN KEY ("financial_period_id") REFERENCES "public"."financial_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_dicatat_oleh_members_id_fk" FOREIGN KEY ("dicatat_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaksi_id_transactions_id_fk" FOREIGN KEY ("transaksi_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_direview_oleh_members_id_fk" FOREIGN KEY ("direview_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_disetujui_oleh_members_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_dibayar_oleh_members_id_fk" FOREIGN KEY ("dibayar_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_transaksi_id_transactions_id_fk" FOREIGN KEY ("transaksi_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_financial_period_id_financial_periods_id_fk" FOREIGN KEY ("financial_period_id") REFERENCES "public"."financial_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_tujuan_id_accounts_id_fk" FOREIGN KEY ("account_tujuan_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expense_request_id_expense_requests_id_fk" FOREIGN KEY ("expense_request_id") REFERENCES "public"."expense_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_dicatat_oleh_members_id_fk" FOREIGN KEY ("dicatat_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_disetujui_oleh_members_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access" ADD CONSTRAINT "document_access_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_diunggah_oleh_members_id_fk" FOREIGN KEY ("diunggah_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_disetujui_oleh_members_id_fk" FOREIGN KEY ("disetujui_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_dicatat_oleh_members_id_fk" FOREIGN KEY ("dicatat_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_buckets" ADD CONSTRAINT "storage_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_period_id_organization_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."organization_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_dibuat_oleh_members_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_recipients" ADD CONSTRAINT "approval_recipients_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_recipients" ADD CONSTRAINT "approval_recipients_diputusan_oleh_members_id_fk" FOREIGN KEY ("diputusan_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_pemohon_id_members_id_fk" FOREIGN KEY ("pemohon_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_dibuat_oleh_members_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_id_mappings" ADD CONSTRAINT "legacy_id_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_divisi_org" ON "divisions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ix_divisi_period" ON "divisions" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_divisi_org_kode" ON "divisions" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE INDEX "ix_period_org" ON "organization_periods" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_period_org_nama" ON "organization_periods" USING btree ("organization_id","nama");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_organisasi_singkat" ON "organizations" USING btree ("singkat");--> statement-breakpoint
CREATE INDEX "ix_jabatan_tugas_member" ON "position_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_jabatan_tugas_period" ON "position_assignments" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "ix_jabatan_tugas_pos" ON "position_assignments" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "ix_jabatan_org" ON "positions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jabatan_org_kode" ON "positions" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_link_kode" ON "account_link_requests" USING btree ("kode");--> statement-breakpoint
CREATE INDEX "ix_link_subject" ON "account_link_requests" USING btree ("provider_subject");--> statement-breakpoint
CREATE INDEX "ix_link_user" ON "account_link_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_policy" ON "auth_policies" USING btree ("organization_id","kunci");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identity_provider_subjek" ON "identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identity_kanonik" ON "identities" USING btree ("provider","provider_subject_kanonik");--> statement-breakpoint
CREATE INDEX "ix_identity_user" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_identity_lid" ON "identities" USING btree ("whatsapp_lid");--> statement-breakpoint
CREATE INDEX "ix_histori_member" ON "member_period_history" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_histori_period" ON "member_period_history" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_org_nomor" ON "members" USING btree ("organization_id","nomor");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_org_nisn" ON "members" USING btree ("organization_id","nisn");--> statement-breakpoint
CREATE INDEX "ix_member_org_status" ON "members" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ix_member_user" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_member_division" ON "members" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "ix_member_nama" ON "members" USING btree ("organization_id","nama");--> statement-breakpoint
CREATE INDEX "ix_member_telepon" ON "members" USING btree ("organization_id","telepon");--> statement-breakpoint
CREATE INDEX "ix_member_period" ON "members" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ott_token" ON "one_time_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_ott_user" ON "one_time_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_ott_tipe" ON "one_time_tokens" USING btree ("tipe");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sesi_refresh" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "ix_sesi_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_sesi_kedaluwarsa" ON "sessions" USING btree ("kedaluwarsa_pada");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_telepon" ON "users" USING btree ("telepon");--> statement-breakpoint
CREATE INDEX "ix_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_delegasi_pemberi" ON "delegations" USING btree ("pemberi_member_id");--> statement-breakpoint
CREATE INDEX "ix_delegasi_penerima" ON "delegations" USING btree ("penerima_member_id");--> statement-breakpoint
CREATE INDEX "ix_member_role_member" ON "member_roles" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_member_role_role" ON "member_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "ix_member_role_org" ON "member_roles" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_permission_kode" ON "permissions" USING btree ("kode");--> statement-breakpoint
CREATE INDEX "ix_permission_modul" ON "permissions" USING btree ("modul");--> statement-breakpoint
CREATE INDEX "ix_role_org" ON "roles" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_role_global_kode" ON "roles" USING btree ("kode") WHERE organization_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_role_org_kode" ON "roles" USING btree ("organization_id","kode") WHERE organization_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_peserta_sesi_member" ON "attendance_participants" USING btree ("session_id","member_id");--> statement-breakpoint
CREATE INDEX "ix_peserta_member" ON "attendance_participants" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_qr_token" ON "attendance_qr_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_qr_sesi" ON "attendance_qr_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ix_qr_berlaku" ON "attendance_qr_tokens" USING btree ("berlaku_sampai");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hadir_sesi_member" ON "attendance_records" USING btree ("session_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hadir_idempotensi" ON "attendance_records" USING btree ("session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_hadir_member" ON "attendance_records" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_hadir_status" ON "attendance_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_hadir_direkam" ON "attendance_records" USING btree ("direkam_pada");--> statement-breakpoint
CREATE INDEX "ix_sesi_org_tanggal" ON "attendance_sessions" USING btree ("organization_id","tanggal");--> statement-breakpoint
CREATE INDEX "ix_sesi_status" ON "attendance_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_sesi_period" ON "attendance_sessions" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "ix_sesi_meeting" ON "attendance_sessions" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "ix_sesi_event" ON "attendance_sessions" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sesi_idempotensi" ON "attendance_sessions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_izin_sesi_member" ON "permission_requests" USING btree ("session_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_izin_kode" ON "permission_requests" USING btree ("kode");--> statement-breakpoint
CREATE INDEX "ix_izin_status" ON "permission_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_izin_member" ON "permission_requests" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_item_notulen" ON "meeting_action_items" USING btree ("minutes_id");--> statement-breakpoint
CREATE INDEX "ix_agenda_rapat" ON "meeting_agenda" USING btree ("meeting_id","urutan");--> statement-breakpoint
CREATE INDEX "ix_lampiran_rapat" ON "meeting_attachments" USING btree ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notulen_rapat_versi" ON "meeting_minutes" USING btree ("meeting_id","versi");--> statement-breakpoint
CREATE INDEX "ix_notulen_status" ON "meeting_minutes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_notulen_org" ON "meeting_minutes" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_peserta_rapat_member" ON "meeting_participants" USING btree ("meeting_id","member_id");--> statement-breakpoint
CREATE INDEX "ix_peserta_rapat_member" ON "meeting_participants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_peserta_rapat_hadir" ON "meeting_participants" USING btree ("meeting_id","hadir");--> statement-breakpoint
CREATE INDEX "ix_rapat_org_tanggal" ON "meetings" USING btree ("organization_id","tanggal");--> statement-breakpoint
CREATE INDEX "ix_rapat_status" ON "meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_rapat_period" ON "meetings" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "ix_rapat_program" ON "meetings" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_rapat_division" ON "meetings" USING btree ("division_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_rapat_undangan_slot" ON "meetings" USING btree ("organization_id","tanggal","waktu_mulai");--> statement-breakpoint
CREATE INDEX "ix_aktivitas_tugas" ON "task_activity" USING btree ("task_id","dibuat_pada");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tugas_assignee" ON "task_assignees" USING btree ("task_id","member_id");--> statement-breakpoint
CREATE INDEX "ix_assignee_member" ON "task_assignees" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_assignee_task" ON "task_assignees" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ix_checklist_task" ON "task_checklists" USING btree ("task_id","urutan");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_task_dep" ON "task_dependencies" USING btree ("task_id","bergantung_pada_task_id");--> statement-breakpoint
CREATE INDEX "ix_task_dep_parent" ON "task_dependencies" USING btree ("bergantung_pada_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tugas_kode" ON "tasks" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE INDEX "ix_tugas_org_status" ON "tasks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ix_tugas_program" ON "tasks" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_tugas_meeting" ON "tasks" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "ix_tugas_division" ON "tasks" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "ix_tugas_batas" ON "tasks" USING btree ("batas_waktu");--> statement-breakpoint
CREATE INDEX "ix_tugas_parent" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_tugas_perlu_verifikasi" ON "tasks" USING btree ("organization_id","butuh_verifikasi","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_acara_absensi" ON "event_attendance" USING btree ("event_id","member_id","tipe");--> statement-breakpoint
CREATE INDEX "ix_acara_absensi_member" ON "event_attendance" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_acara_peserta" ON "event_participants" USING btree ("event_id","member_id");--> statement-breakpoint
CREATE INDEX "ix_acara_peserta_member" ON "event_participants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_acara_peserta_peran" ON "event_participants" USING btree ("event_id","peran");--> statement-breakpoint
CREATE INDEX "ix_acara_jadwal" ON "event_schedules" USING btree ("event_id","urutan");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_acara_kode" ON "events" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE INDEX "ix_acara_program" ON "events" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_acara_tanggal" ON "events" USING btree ("organization_id","tanggal");--> statement-breakpoint
CREATE INDEX "ix_acara_status" ON "events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_acara_pj" ON "events" USING btree ("penanggung_jawab_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_dokumen" ON "program_documents" USING btree ("program_id","document_id");--> statement-breakpoint
CREATE INDEX "ix_program_dokumen_program" ON "program_documents" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_evaluasi_program" ON "program_evaluations" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_member" ON "program_members" USING btree ("program_id","member_id");--> statement-breakpoint
CREATE INDEX "ix_program_member_member" ON "program_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_program_member_divisi" ON "program_members" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "ix_milestone_program" ON "program_milestones" USING btree ("program_id","tanggal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_kode" ON "programs" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE INDEX "ix_program_status" ON "programs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ix_program_division" ON "programs" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "ix_program_owner" ON "programs" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "ix_program_period" ON "programs" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "ix_program_tenggat" ON "programs" USING btree ("selesai_pada");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_akun_org_kode" ON "accounts" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE INDEX "ix_akun_jenis" ON "accounts" USING btree ("organization_id","jenis");--> statement-breakpoint
CREATE INDEX "ix_butir_anggaran" ON "budget_items" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "ix_butir_akun" ON "budget_items" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_anggaran_kode" ON "budgets" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE INDEX "ix_anggaran_program" ON "budgets" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_anggaran_event" ON "budgets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_anggaran_periode" ON "budgets" USING btree ("financial_period_id");--> statement-breakpoint
CREATE INDEX "ix_anggaran_status" ON "budgets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dues_org_periode" ON "dues_periods" USING btree ("organization_id","periode");--> statement-breakpoint
CREATE INDEX "ix_dues_status" ON "dues_periods" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dues_status" ON "dues_status" USING btree ("dues_period_id","member_id");--> statement-breakpoint
CREATE INDEX "ix_dues_status_member" ON "dues_status" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_dues_status_status" ON "dues_status" USING btree ("dues_period_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pengajuan_kode" ON "expense_requests" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pengajuan_idempotensi" ON "expense_requests" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_pengajuan_status" ON "expense_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ix_pengajuan_program" ON "expense_requests" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_pengajuan_pemohon" ON "expense_requests" USING btree ("pemohon_member_id");--> statement-breakpoint
CREATE INDEX "ix_pengajuan_tanggal" ON "expense_requests" USING btree ("tanggal");--> statement-breakpoint
CREATE INDEX "ix_periode_keuangan_org" ON "financial_periods" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_periode_keuangan_nama" ON "financial_periods" USING btree ("organization_id","nama");--> statement-breakpoint
CREATE INDEX "ix_ledger_akun_tanggal" ON "ledger_entries" USING btree ("account_id","tanggal");--> statement-breakpoint
CREATE INDEX "ix_ledger_transaksi" ON "ledger_entries" USING btree ("transaksi_id");--> statement-breakpoint
CREATE INDEX "ix_ledger_periode" ON "ledger_entries" USING btree ("financial_period_id");--> statement-breakpoint
CREATE INDEX "ix_ledger_org_tanggal" ON "ledger_entries" USING btree ("organization_id","tanggal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_kode" ON "payments" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_idempotensi" ON "payments" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_referensi" ON "payments" USING btree ("organization_id","referensi_provider");--> statement-breakpoint
CREATE INDEX "ix_payment_member" ON "payments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ix_payment_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_payment_kedaluwarsa" ON "payments" USING btree ("kedaluwarsa_pada");--> statement-breakpoint
CREATE INDEX "ix_payment_periode" ON "payments" USING btree ("organization_id","jenis","periode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reimburse_kode" ON "reimbursements" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reimburse_idempotensi" ON "reimbursements" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_reimburse_status" ON "reimbursements" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ix_reimburse_member" ON "reimbursements" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_transaksi_kode" ON "transactions" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_transaksi_idempotensi" ON "transactions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_transaksi_periode" ON "transactions" USING btree ("financial_period_id");--> statement-breakpoint
CREATE INDEX "ix_transaksi_tanggal" ON "transactions" USING btree ("tanggal");--> statement-breakpoint
CREATE INDEX "ix_transaksi_status" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_transaksi_program" ON "transactions" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_transaksi_akun" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_akses_dokumen" ON "document_access" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_akses_member" ON "document_access" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_kategori_org_kode" ON "document_categories" USING btree ("organization_id","kode");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dokumen_versi" ON "document_versions" USING btree ("document_id","versi");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dokumen_versi_key" ON "document_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "ix_dokumen_org_kategori" ON "documents" USING btree ("organization_id","kategori");--> statement-breakpoint
CREATE INDEX "ix_dokumen_status" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_dokumen_program" ON "documents" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "ix_dokumen_event" ON "documents" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_dokumen_meeting" ON "documents" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "ix_dokumen_owner" ON "documents" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "ix_dokumen_pencarian" ON "documents" USING btree ("organization_id","pencarian");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dokumen_storage_key" ON "documents" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_surat_org_nomor" ON "letters" USING btree ("organization_id","nomor");--> statement-breakpoint
CREATE INDEX "ix_surat_arah" ON "letters" USING btree ("organization_id","arah");--> statement-breakpoint
CREATE INDEX "ix_surat_tindak_lanjut" ON "letters" USING btree ("organization_id","perlu_tindak_lanjut");--> statement-breakpoint
CREATE INDEX "ix_surat_tanggal" ON "letters" USING btree ("tanggal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bucket_org" ON "storage_buckets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_activity_org_created" ON "activity_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_entitas" ON "activity_log" USING btree ("entitas_jenis","entitas_id");--> statement-breakpoint
CREATE INDEX "idx_activity_actor" ON "activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_activity_division" ON "activity_log" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "idx_activity_program" ON "activity_log" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_penerima_kanal" ON "announcement_recipients" USING btree ("announcement_id","member_id","kanal");--> statement-breakpoint
CREATE INDEX "ix_penerima_status" ON "announcement_recipients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_penerima_member" ON "announcement_recipients" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_pengumuman_status" ON "announcements" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_pengumuman_terbit" ON "announcements" USING btree ("terbit_pada");--> statement-breakpoint
CREATE INDEX "idx_pengumuman_jadwal" ON "announcements" USING btree ("jadwalkan_pada");--> statement-breakpoint
CREATE INDEX "idx_pengumuman_program" ON "announcements" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "idx_pengumuman_event" ON "announcements" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_approval_penerima" ON "approval_recipients" USING btree ("role_code","status");--> statement-breakpoint
CREATE INDEX "idx_approval_req" ON "approval_recipients" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "idx_approval_entitas" ON "approval_requests" USING btree ("entitas_tabel","entitas_id");--> statement-breakpoint
CREATE INDEX "idx_approval_status" ON "approval_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_approval_pemohon" ON "approval_requests" USING btree ("pemohon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_approval_idempotensi" ON "approval_requests" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_audit_org_created" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_aksi" ON "audit_logs" USING btree ("aksi","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_entitas" ON "audit_logs" USING btree ("entitas_tabel","entitas_id");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_audit_request" ON "audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_kampanye_org" ON "campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_kampanye_program" ON "campaigns" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_flag_kunci" ON "feature_flags" USING btree ("organization_id","kunci");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_integration_provider" ON "integration_configs" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_legacy_mapping" ON "legacy_id_mappings" USING btree ("legacy_tabel","legacy_id");--> statement-breakpoint
CREATE INDEX "idx_legacy_target" ON "legacy_id_mappings" USING btree ("target_tabel","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_delivery_job" ON "notification_deliveries" USING btree ("job_key");--> statement-breakpoint
CREATE INDEX "ix_delivery_status" ON "notification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_delivery_jadwal" ON "notification_deliveries" USING btree ("jadwalkan_pada");--> statement-breakpoint
CREATE INDEX "ix_delivery_notif" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_pengumuman" ON "notification_deliveries" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "ix_notif_user_belum" ON "notifications" USING btree ("user_id","dibaca_pada");--> statement-breakpoint
CREATE INDEX "ix_notif_jenis" ON "notifications" USING btree ("user_id","jenis");--> statement-breakpoint
CREATE INDEX "ix_notif_entitas" ON "notifications" USING btree ("entitas_jenis","entitas_id");--> statement-breakpoint
CREATE INDEX "ix_notif_kedaluwarsa" ON "notifications" USING btree ("kedaluwarsa_pada");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_dedup" ON "notifications" USING btree ("user_id","dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_setting_org_kunci" ON "settings" USING btree ("organization_id","kunci");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_event" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_diproses" ON "webhook_events" USING btree ("diproses","created_at");