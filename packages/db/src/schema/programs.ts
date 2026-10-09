/**
 * Skema program kerja & acara (event).
 *
 * Program adalah modul utama: satu program menyatukan timeline, tugas, tim,
 * anggaran, dokumen, rapat, pengumuman, absensi, pengeluaran, dan evaluasi —
 * supaya satu kegiatan OSIS tidak lagi tersebar di WhatsApp.
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
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  diubahPada,
  dibuatPada,
  dibuatOleh,
  enumPrioritas,
  enumStatusAcara,
  enumStatusProgram,
  pk,
  uang,
  versiBaris,
} from './_base.js';
import { divisions, organizations, organizationPeriods } from './organization.js';
import { members } from './identity.js';
import { attendanceSessions } from './attendance.js';

// ============================================================
// Program kerja
// ============================================================

export const programs = pgTable(
  'programs',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    kode: text('kode').notNull(),
    nama: text('nama').notNull(),
    /** Tujuan program — field yang wajib diisi saat pengajuan. */
    tujuan: text('tujuan').notNull(),
    deskripsi: text('deskripsi'),
    latarBelakang: text('latar_belakang'),
    status: enumStatusProgram('status').notNull().default('DRAFT'),
    prioritas: enumPrioritas('prioritas').notNull().default('NORMAL'),
    ownerMemberId: uuid('owner_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** Nominal uang dalam rupiah penuh (bigint, tanpa pecahan). */
    anggaranDiajukan: uang('anggaran_diajukan').notNull().default(0),
    anggaranDisetujui: uang('anggaran_disetujui').notNull().default(0),
    realisasiPengeluaran: uang('realisasi_pengeluaran').notNull().default(0),
    mulaiPada: date('mulai_pada').notNull(),
    selesaiPada: date('selesai_pada').notNull(),
    /** Tanggal nyata mulai & selesai eksekusi (bisa berbeda dari rencana). */
    mulaiRiwayatPada: date('mulai_riwayat_pada'),
    selesaiRiwayatPada: date('selesai_riwayat_pada'),
    /** Indikator keberhasilan (array teks). */
    indikator: text('indikator').array().notNull().default([]),
    /** Gambaran 1-100, dipakai untuk dasbor. */
    progres: integer('progres').notNull().default(0),
    totalTugas: integer('total_tugas').notNull().default(0),
    tugasSelesai: integer('tugas_selesai').notNull().default(0),
    totalAcara: integer('total_acara').notNull().default(0),
    warna: text('warna').default('#0ea5e9'),
    ikon: text('ikon'),
    coverUrl: text('cover_url'),
    templateId: uuid('template_id'),
    diajukanPada: date('diajukan_pada'),
    disetujuiOleh: uuid('disetujui_oleh'),
    disetujuiPada: date('disetujui_pada'),
    alasanPenolakan: text('alasan_penolakan'),
    dibatalkanPada: date('dibatalkan_pada'),
    alasanPembatalan: text('alasan_pembatalan'),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_program_kode').on(t.organizationId, t.kode),
    index('ix_program_status').on(t.organizationId, t.status),
    index('ix_program_division').on(t.divisionId),
    index('ix_program_owner').on(t.ownerMemberId),
    index('ix_program_period').on(t.periodId),
    index('ix_program_tenggat').on(t.selesaiPada),
  ],
);

export type ProgramBaris = typeof programs.$inferSelect;
export type ProgramSisip = typeof programs.$inferInsert;

// ============================================================
// Tim program
// ============================================================

export const programMembers = pgTable(
  'program_members',
  {
    id: pk(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    /** OWNER / KETU / ANGGOTA / PENGAWAS / PEMBIAYA */
    peran: text('peran').notNull().default('ANGGOTA'),
    jabatanId: uuid('jabatan_id'),
    tanggalBergabung: date('tanggal_bergabung').notNull().default(sql`now()`),
    tanggalKeluar: date('tanggal_keluar'),
    deskripsiPeran: text('deskripsi_peran'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_program_member').on(t.programId, t.memberId),
    index('ix_program_member_member').on(t.memberId),
    index('ix_program_member_divisi').on(t.divisionId),
  ],
);

// ============================================================
// Timeline / tonggak waktu
// ============================================================

export const programMilestones = pgTable(
  'program_milestones',
  {
    id: pk(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    nama: text('nama').notNull(),
    deskripsi: text('deskripsi'),
    tanggal: date('tanggal').notNull(),
    selesai: boolean('selesai').notNull().default(false),
    selesaiPada: date('selesai_pada'),
    urutan: integer('urutan').notNull().default(0),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
  },
  (t) => [index('ix_milestone_program').on(t.programId, t.tanggal)],
);

// ============================================================
// Dokumen program
// ============================================================

export const programDocuments = pgTable(
  'program_documents',
  {
    id: pk(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    /** Metadata di tabel documents; berkas ada di object storage. */
    documentId: uuid('document_id').notNull(),
    /** PROPOSAL / ANGGARAN / SURAT / DOKUMENTASI / LPJ / LAINNYA */
    jenis: text('jenis').notNull().default('DOKUMENTASI'),
    keterangan: text('keterangan'),
    diunggahOleh: uuid('diunggah_oleh'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_program_dokumen').on(t.programId, t.documentId),
    index('ix_program_dokumen_program').on(t.programId),
  ],
);

// ============================================================
// Evaluasi program
// ============================================================

export const programEvaluations = pgTable(
  'program_evaluations',
  {
    id: pk(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    capaian: text('capaian').notNull(),
    kendala: text('kendala'),
    pelajaran: text('pelajaran'),
    rekomendasi: text('rekomendasi'),
    /** Skor kualitas 0-100, bila dinilai. */
    skorKualitas: numeric('skor_kualitas', { precision: 5, scale: 2 }),
    /** Skor keberhasilan 0-100, bila dinilai. */
    skorKeberhasilan: numeric('skor_keberhasilan', { precision: 5, scale: 2 }),
    dievaluasiOleh: uuid('dievaluasi_oleh').references(() => members.id, { onDelete: 'set null' }),
    dievaluasiPada: date('dievaluasi_pada').notNull().default(sql`now()`),
    /** Whether to publish to all members or only board. */
    publik: boolean('publik').notNull().default(false),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [index('ix_evaluasi_program').on(t.programId)],
);

// ============================================================
// Acara (event)
// ============================================================

export const events = pgTable(
  'events',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    /** Acara dapat lahir dari sebuah program kerja. */
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    kode: text('kode').notNull(),
    judul: text('judul').notNull(),
    deskripsi: text('deskripsi'),
    tanggal: date('tanggal').notNull(),
    waktuMulai: time('waktu_mulai'),
    waktuSelesai: time('waktu_selesai'),
    lokasi: text('lokasi'),
    /** Detail lokasi (denah, patokan). */
    detailLokasi: text('detail_lokasi'),
    status: enumStatusAcara('status').notNull().default('DRAFT'),
    penanggungJawabMemberId: uuid('penanggung_jawab_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    kapasitas: integer('kapasitas'),
    /** Kuota khusus untuk tiap angkatan/kelas, mis. { "X": 50, "XI": 40 }. */
    kuotaKelas: jsonb('kuota_kelas').notNull().default({}),
    butuhAbsensi: boolean('butuh_absensi').notNull().default(true),
    butuhPendaftaran: boolean('butuh_pendaftaran').notNull().default(false),
    pendaftaranMulaiPada: date('pendaftaran_mulai_pada'),
    pendaftaranSelesaiPada: date('pendaftaran_selesai_pada'),
    sessionId: uuid('session_id').references(() => attendanceSessions.id, { onDelete: 'set null' }),
    biayaDiajukan: uang('biaya_diajukan').notNull().default(0),
    progres: integer('progres').notNull().default(0),
    coverUrl: text('cover_url'),
    /** Apakah HUMAS sudah membuat materi promosi. */
    sudahDikomunikasikan: boolean('sudah_dkomunikasikan').notNull().default(false),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_acara_kode').on(t.organizationId, t.kode),
    index('ix_acara_program').on(t.programId),
    index('ix_acara_tanggal').on(t.organizationId, t.tanggal),
    index('ix_acara_status').on(t.status),
    index('ix_acara_pj').on(t.penanggungJawabMemberId),
  ],
);

export type AcaraBaris = typeof events.$inferSelect;
export type AcaraSisip = typeof events.$inferInsert;

// ============================================================
// Peserta & panitia acara
// ============================================================

export const eventParticipants = pgTable(
  'event_participants',
  {
    id: pk(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** PESERTA / PANITIA / PANITIA_UTAMA / NARASUMBER */
    peran: text('peran').notNull().default('PESERTA'),
    /** Divisi yang bertugas pada acara (bila perlu). */
    divisi: text('divisi'),
    /** Rincian tugas dalam acara. */
    tugas: text('tugas'),
    terdaftarPada: date('terdaftar_pada').notNull().default(sql`now()`),
    hadir: boolean('hadir').notNull().default(false),
    hadirPada: date('hadir_pada'),
    dibatalkanPada: date('dibatalkan_pada'),
    alasanPembatalan: text('alasan_pembatalan'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_acara_peserta').on(t.eventId, t.memberId),
    index('ix_acara_peserta_member').on(t.memberId),
    index('ix_acara_peserta_peran').on(t.eventId, t.peran),
  ],
);

// ============================================================
// Absensi acara
// ============================================================

export const eventAttendance = pgTable(
  'event_attendance',
  {
    id: pk(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** IN / OUT / HADIR / PULANG */
    tipe: text('tipe').notNull().default('HADIR'),
    waktu: date('waktu').notNull().default(sql`now()`),
    dicatatOleh: uuid('dicatat_oleh'),
    catatan: text('catatan'),
  },
  (t) => [
    uniqueIndex('uq_acara_absensi').on(t.eventId, t.memberId, t.tipe),
    index('ix_acara_absensi_member').on(t.memberId),
  ],
);

// ============================================================
// Jadwal acara
// ============================================================

export const eventSchedules = pgTable(
  'event_schedules',
  {
    id: pk(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    judul: text('judul').notNull(),
    deskripsi: text('deskripsi'),
    mulaiPukul: time('mulai_pukul').notNull(),
    selesaiPukul: time('selesai_pukul'),
    lokasi: text('lokasi'),
    penanggungJawabMemberId: uuid('penanggung_jawab_member_id'),
    urutan: integer('urutan').notNull().default(0),
    dibuatPada: dibuatPada(),
  },
  (t) => [index('ix_acara_jadwal').on(t.eventId, t.urutan)],
);
