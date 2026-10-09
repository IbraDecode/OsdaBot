/**
 * Skema rapat, agenda, peserta, dan notulen (Secretary adalah owner modul ini).
 *
 * Notulen yang sudah APPROVED tidak boleh ditimpa. Setiap revisi membuat versi
 * baru; versi lama tetap utuh sebagai bukti historis.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
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
  enumPrioritas,
  enumStatusNotulen,
  enumStatusRapat,
  pk,
} from './_base.js';
import { attendanceSessions } from './attendance.js';
import { divisions, organizations, organizationPeriods } from './organization.js';
import { members } from './identity.js';

// ============================================================
// Rapat
// ============================================================

export const meetings = pgTable(
  'meetings',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    programId: uuid('program_id'),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    judul: text('judul').notNull(),
    deskripsi: text('deskripsi'),
    tanggal: date('tanggal').notNull(),
    waktuMulai: time('waktu_mulai').notNull(),
    waktuSelesai: time('waktu_selesai').notNull(),
    lokasi: text('lokasi'),
    /** RUTIN / KALENDER / DARURAT / DIVISI / PROGRAM */
    jenis: text('jenis').notNull().default('RUTIN'),
    /** Ringkasan peserta yang diundang, mis. "Ketua, Sekretaris, seluruh koordinator". */
    audiensDeskripsi: text('audiens_deskripsi'),
    pembicara: text('pembicara').array().notNull().default([]),
    /** Divisi yang wajib hadir (kosong = semua). */
    divisionIds: uuid('division_ids').array().notNull().default([]),
    /** Jabatan yang wajib hadir. */
    jabatanIds: uuid('jabatan_ids').array().notNull().default([]),
    status: enumStatusRapat('status').notNull().default('SCHEDULED'),
    /** Sesi absensi yang dihasilkan oleh rapat ini. */
    sessionId: uuid('session_id').references(() => attendanceSessions.id, { onDelete: 'set null' }),
    mulaiPada: date('mulai_pada'),
    selesaiPada: date('selesai_pada'),
    /** Undangan sudah dikirim ke seluruh peserta. */
    undanganTerkirimPada: date('undangan_terkirim_pada'),
    /** Pengingat dikirim H-1 dan H-1 jam. */
    pengingatTerkirim: jsonb('pengingat_terkirim').notNull().default({}),
    /** Increment untuk sinkronisasi realtime. */
    revisi: integer('revisi').notNull().default(1),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    index('ix_rapat_org_tanggal').on(t.organizationId, t.tanggal),
    index('ix_rapat_status').on(t.status),
    index('ix_rapat_period').on(t.periodId),
    index('ix_rapat_program').on(t.programId),
    index('ix_rapat_division').on(t.divisionId),
    // CATATAN: TIDAK ada unique constraint pada (tanggal, waktuMulai).
    // Sebuah organisasi boleh punya beberapa rapat pada jam yang sama —
    // misalnya rapat rutin.divisi yang berjalan paralel. Tabrakan jadwal
    // adalah peringatan, bukan error; validasi卖给 lewat endpoint kalender.
    index('ix_rapat_slot').on(t.organizationId, t.tanggal, t.waktuMulai),
  ],
);

export type RapatBaris = typeof meetings.$inferSelect;
export type RapatSisip = typeof meetings.$inferInsert;

// ============================================================
// Agenda
// ============================================================

export const meetingAgenda = pgTable(
  'meeting_agenda',
  {
    id: pk(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    judul: text('judul').notNull(),
    deskripsi: text('deskripsi'),
    pembicara: text('pembicara'),
    durasiMenit: integer('durasi_menit'),
    /**wak empezando tidak apa, bisa null → diisi setelah rapat. */
    mulaiPukul: time('mulai_pukul'),
    selesaiPukul: time('selesai_pukul'),
    urutan: integer('urutan').notNull().default(0),
    dibahas: boolean('dibahas').notNull().default(false),
    createdAt: dibuatPada(),
  },
  (t) => [index('ix_agenda_rapat').on(t.meetingId, t.urutan)],
);

// ============================================================
// Peserta rapat
// ============================================================

export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id: pk(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    wajib: boolean('wajib').notNull().default(true),
    hadir: boolean('hadir').notNull().default(false),
    /** Salinan dari attendance_records agar rekap rapat tidak bergantung join. */
    statusHadir: text('status_hadir'),
    hadirPada: date('hadir_pada'),
    alasanTidakHadir: text('alasan_tidak_hadir'),
    diundangPada: date('diundang_pada'),
    sudahDibacaUndangan: boolean('sudah_dibaca_undangan').notNull().default(false),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_peserta_rapat_member').on(t.meetingId, t.memberId),
    index('ix_peserta_rapat_member').on(t.memberId),
    index('ix_peserta_rapat_hadir').on(t.meetingId, t.hadir),
  ],
);

// ============================================================
// Notulen (dengan versioning)
// ============================================================

export const meetingMinutes = pgTable(
  'meeting_minutes',
  {
    id: pk(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Nomor notulen resmi, mis. "001/PMR/III/2026". */
    nomor: text('nomor'),
    versi: integer('versi').notNull().default(1),
    ringkasan: text('ringkasan').notNull(),
    pembahasan: text('pembahasan'),
    /** Keputusan diambil di rapat (array teks). */
    keputusan: text('keputusan').array().notNull().default([]),
    status: enumStatusNotulen('status').notNull().default('DRAFT'),
    /** Alasan perubahan versi; wajib diisi bila membuat revisi. */
    alasanRevisi: text('alasan_revisi'),
    /** Versi ini dikunci setelah disetujui dan tidak boleh diubah lagi. */
    dikunciPada: date('dikunci_pada'),
    penulisId: uuid('penulis_id').references(() => members.id, { onDelete: 'set null' }),
    disetujuiOleh: uuid('disetujui_oleh'),
    disetujuiPada: date('disetujui_pada'),
    komentarPersetujuan: text('komentar_persetujuan'),
    diarsipkanPada: date('diarsipkan_pada'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    // Satu rapat hanya punya satu notulen "aktif" per versi; versi lama tetap disimpan.
    uniqueIndex('uq_notulen_rapat_versi').on(t.meetingId, t.versi),
    index('ix_notulen_status').on(t.status),
    index('ix_notulen_org').on(t.organizationId),
  ],
);

export type NotulenBaris = typeof meetingMinutes.$inferSelect;
export type NotulenSisip = typeof meetingMinutes.$inferInsert;

/** Item tindakan hasil rapat — dapat dikonversi menjadi tugas. */
export const meetingActionItems = pgTable(
  'meeting_action_items',
  {
    id: pk(),
    minutesId: uuid('minutes_id')
      .notNull()
      .references(() => meetingMinutes.id, { onDelete: 'cascade' }),
    isi: text('isi').notNull(),
    penanggungJawabMemberId: uuid('penanggung_jawab_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    batasWaktu: date('batas_waktu'),
    prioritas: enumPrioritas('prioritas').notNull().default('NORMAL'),
    /** Tugas yang dihasilkan dari item ini (bila sudah dikonversi). */
    taskId: uuid('task_id'),
    selesai: boolean('selesai').notNull().default(false),
    selesaiPada: date('selesai_pada'),
    dibuatPada: dibuatPada(),
  },
  (t) => [index('ix_item_notulen').on(t.minutesId)],
);

// ============================================================
// Lampiran rapat
// ============================================================

export const meetingAttachments = pgTable(
  'meeting_attachments',
  {
    id: pk(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    /** Metadata dokumen (isi berkas ada di object storage). */
    documentId: uuid('document_id').notNull(),
    jenis: text('jenis').notNull().default('LAMPIRAN'),
    keterangan: text('keterangan'),
    diunggahOleh: uuid('diunggah_oleh'),
    dibuatPada: dibuatPada(),
  },
  (t) => [index('ix_lampiran_rapat').on(t.meetingId)],
);
