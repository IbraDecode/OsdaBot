/**
 * Skema absensi: sesi, catatan kehadiran, token QR, permintaan izin.
 *
 * Absensi bukan hanya untuk rapat — ada jenis MEETING, EVENT, ACTIVITY, TRAINING,
 * dan COMMITTEE. Setiap jenis mengikuti alur yang sama, sehingga absensi dari
 * WhatsApp, Mobile, dan Web selalu identik.
 *
 * Invariant yang dijaga database (spec §44):
 *  - UNIQUE (session_id, member_id) → satu catatan per anggota per sesi
 *  - Token QR berumur pendek, terikat sesi, dan hanya bisa dipakai sekali
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  diubahPada,
  dibuatPada,
  dibuatOleh,
  enumJenisAbsensi,
  enumStatusHadir,
  enumStatusIzin,
  enumStatusSesi,
  enumSumberAbsensi,
  pk,
} from './_base.js';
import { organizations, organizationPeriods } from './organization.js';
import { members } from './identity.js';
import { divisions } from './organization.js';

// ============================================================
// Sesi absensi
// ============================================================

export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    /** Meeting/event yang memunculkan sesi ini (bila ada). */
    meetingId: uuid('meeting_id'),
    eventId: uuid('event_id'),
    jenis: enumJenisAbsensi('jenis').notNull(),
    judul: text('judul').notNull(),
    tanggal: date('tanggal').notNull(),
    waktuMulai: time('waktu_mulai'),
    waktuSelesai: time('waktu_selesai'),
    mulaiPada: date('mulai_pada'),
    selesaiPada: date('selesai_pada'),
    lokasi: text('lokasi'),
    status: enumStatusSesi('status').notNull().default('DRAFT'),
    /** Hanya divisi tertentu yang wajib absen (kosong = semua anggota aktif). */
    hanyaDivisionIds: uuid('hanya_division_ids').array().notNull().default([]),
    /** Hanya anggota pada jabatan tertentu yang wajib absen. */
    hanyaJabatanIds: uuid('hanya_jabatan_ids').array().notNull().default([]),
    /** Hanya anggota pada program/acara tertentu. */
    memberIds: uuid('member_ids').array(),
    wajibHadir: boolean('wajib_hadir').notNull().default(true),
    /** Batas keterlambatan: masih hadir, tetapi tercatat berstatus LATE. */
    batasKeterlambatanMenit: integer('batas_keterlambatan_menit').notNull().default(15),
    /** Berapa lama token QR masih berlaku. */
    qrTtlDetik: integer('qr_ttl_detik').notNull().default(120),
    qrSecret: text('qr_secret'),
    qrTerakhirDiaturPada: date('qr_terakhir_diatur_pada'),
    dibukaPada: date('dibuka_pada'),
    ditutupPada: date('ditutup_pada'),
    ditutupOleh: uuid('ditutup_oleh'),
    /** Jumlah anggota yang tercatat saat sesi ditutup (denormalisasi untuk laporan cepat). */
    rekapTotalWajib: integer('rekap_total_wajib').notNull().default(0),
    rekapHadir: integer('rekap_hadir').notNull().default(0),
    rekapIzin: integer('rekap_izin').notNull().default(0),
    rekapSakit: integer('rekap_sakit').notNull().default(0),
    rekapTidakHadir: integer('rekap_tidak_hadir').notNull().default(0),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    /** Kunci idempotensi agar scheduler tidak membuka sesi ganda. */
    idempotencyKey: text('idempotency_key'),
    /** ID dari data legacy (bot v0.4). */
    legacyId: text('legacy_id'),
    legacyTabel: text('legacy_tabel'),
  },
  (t) => [
    index('ix_sesi_org_tanggal').on(t.organizationId, t.tanggal),
    index('ix_sesi_status').on(t.status),
    index('ix_sesi_period').on(t.periodId),
    index('ix_sesi_meeting').on(t.meetingId),
    index('ix_sesi_event').on(t.eventId),
    uniqueIndex('uq_sesi_idempotensi').on(t.organizationId, t.idempotencyKey),
  ],
);

export type SesiAbsensiBaris = typeof attendanceSessions.$inferSelect;
export type SesiAbsensiSisip = typeof attendanceSessions.$inferInsert;

// ============================================================
// Catatan kehadiran
// ============================================================

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: pk(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    status: enumStatusHadir('status').notNull(),
    /** Alasan wajib untuk EXCUSED / SICK; dicek di service & check constraint. */
    alasan: text('alasan'),
    catatan: text('catatan'),
    sumber: enumSumberAbsensi('sumber').notNull().default('WEB'),
    /** Menit keterlambatan bila status LATE. */
    menitKeterlambatan: integer('menit_keterlambatan'),
    direkamPada: date('direkam_pada').notNull().default(sql`now()`),
    /** Token QR yang dipakai (jejak audit, tidak disimpan mentah). */
    qrTokenJti: uuid('qr_token_jti'),
    diubahOleh: uuid('diubah_oleh'),
    diubahPada: date('diubah_pada'),
    alasanPerubahan: text('alasan_perubahan'),
    /** Kunci idempotensi per klien (mobile/web/bot) untuk mencegah dobel kirim. */
    idempotencyKey: text('idempotency_key'),
  },
  (t) => [
    // INVARIANT: satu anggota hanya punya satu catatan per sesi.
    uniqueIndex('uq_hadir_sesi_member').on(t.sessionId, t.memberId),
    uniqueIndex('uq_hadir_idempotensi').on(t.sessionId, t.idempotencyKey),
    index('ix_hadir_member').on(t.memberId),
    index('ix_hadir_status').on(t.status),
    index('ix_hadir_direkam').on(t.direkamPada),
  ],
);

export type CatatanHadirBaris = typeof attendanceRecords.$inferSelect;
export type CatatanHadirSisip = typeof attendanceRecords.$inferInsert;

// ============================================================
// Token QR (rotating, sekali pakai)
// ============================================================

/**
 * Setiap kali sesi dibuka atau token kedaluwarsa, token QR baru dibuat.
 * Token bersifat:
 *  - short-lived (bawaan 120 detik)
 *  - signed (HMAC, rahasia disimpan di server)
 *  - session-bound (tidak berlaku untuk sesi lain)
 *  - non-reusable setelah dipakai atau kedaluwarsa
 */
export const attendanceQrTokens = pgTable(
  'attendance_qr_tokens',
  {
    id: pk(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    /** JTI token, dicatat pada attendance_records agar bisa dilacak. */
    jti: uuid('jti').notNull(),
    /** Hash dari token yang diberikan ke klien (token mentah tidak disimpan). */
    tokenHash: text('token_hash').notNull(),
    dibuatPada: date('dibuat_pada').notNull().default(sql`now()`),
    berlakuSampai: date('berlaku_sampai').notNull(),
    dipakaiPada: date('dipakai_pada'),
    dipakaiOlehMemberId: uuid('dipakai_oleh_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    membatalkan: boolean('dibatalkan').notNull().default(false),
  },
  (t) => [
    uniqueIndex('uq_qr_token').on(t.tokenHash),
    index('ix_qr_sesi').on(t.sessionId),
    index('ix_qr_berlaku').on(t.berlakuSampai),
  ],
);

// ============================================================
// Permintaan izin (izin / sakit via WhatsApp)
// ============================================================

export const permissionRequests = pgTable(
  'permission_requests',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** EXCUSED (izin) atau SICK (sakit). */
    jenis: text('jenis').notNull().default('EXCUSED'),
    alasan: text('alasan').notNull(),
    buktiDokumenId: uuid('bukti_dokumen_id'),
    status: enumStatusIzin('status').notNull().default('PENDING'),
    decidedBy: uuid('diputusan_oleh'),
    decidedAt: date('diputusan_pada'),
    komentar: text('komentar'),
    /** Nomor permintaan member agar mudah dirujuk balik lewat WhatsApp. */
    kode: text('kode').notNull(),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    uniqueIndex('uq_izin_sesi_member').on(t.sessionId, t.memberId),
    uniqueIndex('uq_izin_kode').on(t.kode),
    index('ix_izin_status').on(t.status),
    index('ix_izin_member').on(t.memberId),
  ],
);

export type PermintaanIzinBaris = typeof permissionRequests.$inferSelect;

// ============================================================
// Partisipan wajib absen (snapshot siapa yang wajib hadir)
// ============================================================

/**
 * Daftar anggota yang wajib absen pada sesi tertentu, dibekukan saat sesi dibuka.
 * Karena itu, anggota yang baru bergabung setelah sesi dibuka tidak otomatis
 * menjadi wajib, dan anggota yang diarsipkan tetap punya rekap yang konsisten.
 */
export const attendanceParticipants = pgTable(
  'attendance_participants',
  {
    id: pk(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    wajib: boolean('wajib').notNull().default(true),
    /** Rekap otomatis saat sesi ditutup. */
    sudahAbsen: boolean('sudah_absen').notNull().default(false),
    ditampilkan: integer('ditampilkan').notNull().default(0),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_peserta_sesi_member').on(t.sessionId, t.memberId),
    index('ix_peserta_member').on(t.memberId),
  ],
);
