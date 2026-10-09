/**
 * Skema tugas (task).
 *
 * Prinsip penting:
 * - DONE belum berarti VERIFIED. Untuk tugas yang butuh verifikasi, closure
 *   harus dikonfirmasi orang lain lewat izin `task.verify`.
 * - Setiap perubahan status tercatat di `task_activity` untuk keperluan audit
 *   dan activity feed.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  diubahPada,
  dibuatPada,
  dibuatOleh,
  enumPrioritas,
  enumStatusTugas,
  enumStatusVerifikasi,
  pk,
  versiBaris,
} from './_base.js';
import { divisions, organizations, organizationPeriods } from './organization.js';
import { members } from './identity.js';
import { meetings } from './meetings.js';
import { programs } from './programs.js';

// ============================================================
// Tugas
// ============================================================

export const tasks = pgTable(
  'tasks',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    /** Divisi yang menjadi sasaran eksekusi (bukan divisi pemilik). */
    divisionTujuanId: uuid('division_tujuan_id').references(() => divisions.id, { onDelete: 'set null' }),
    parentId: uuid('parent_id'),
    kode: text('kode').notNull(),
    judul: text('judul').notNull(),
    deskripsi: text('deskripsi'),
    status: enumStatusTugas('status').notNull().default('TODO'),
    verifikasi: enumStatusVerifikasi('verifikasi').notNull().default('UNVERIFIED'),
    /** Bila true, DONE belum menutup tugas sampai diverifikasi. */
    butuhVerifikasi: boolean('butuh_verifikasi').notNull().default(true),
    prioritas: enumPrioritas('prioritas').notNull().default('NORMAL'),
    batasWaktu: date('batas_waktu'),
    mulaiDikerjakanPada: date('mulai_dikerjakan_pada'),
    selesaiPada: date('selesai_pada'),
    diverifikasiPada: date('diverifikasi_pada'),
    diverifikasiOleh: uuid('diverifikasi_oleh').references(() => members.id, { onDelete: 'set null' }),
    verifikasiKomentar: text('verifikasi_komentar'),
    /** Progres 0-100, dipakai untuk bar progres di UI. */
    progres: integer('progres').notNull().default(0),
    /** Jumlah lampiran (metadata di tabel documents). */
    lampiranDokumenIds: uuid('lampiran_dokumen_ids').array().notNull().default([]),
    tags: text('tags').array().notNull().default([]),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    uniqueIndex('uq_tugas_kode').on(t.organizationId, t.kode),
    index('ix_tugas_org_status').on(t.organizationId, t.status),
    index('ix_tugas_program').on(t.programId),
    index('ix_tugas_meeting').on(t.meetingId),
    index('ix_tugas_division').on(t.divisionId),
    index('ix_tugas_batas').on(t.batasWaktu),
    index('ix_tugas_parent').on(t.parentId),
    index('ix_tugas_perlu_verifikasi').on(t.organizationId, t.butuhVerifikasi, t.status),
  ],
);

export type TugasBaris = typeof tasks.$inferSelect;
export type TugasSisip = typeof tasks.$inferInsert;

// ============================================================
// Penugasan tugas (many-to-many dengan anggota)
// ============================================================

export const taskAssignees = pgTable(
  'task_assignees',
  {
    id: pk(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** PIC utama boleh menugaskan ulang; anggota biasa tidak. */
    utama: boolean('utama').notNull().default(false),
    diterimaPada: date('diterima_pada'),
    selesaiPada: date('selesai_pada'),
    /** Progres individual bila tugas dibagi ke beberapa orang. */
    progres: integer('progres').notNull().default(0),
    catatan: text('catatan'),
    ditugaskanOleh: uuid('ditugaskan_oleh'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_tugas_assignee').on(t.taskId, t.memberId),
    index('ix_assignee_member').on(t.memberId),
    index('ix_assignee_task').on(t.taskId),
  ],
);

// ============================================================
// Aktivitas tugas (komentar & riwayat status)
// ============================================================

export const taskActivity = pgTable(
  'task_activity',
  {
    id: pk(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    /** DIBUAT / STATUS / KOMENTAR / VERIFIKASI / DITUGASKAN */
    tipe: text('tipe').notNull(),
    isi: text('isi'),
    statusSebelum: text('status_sebelum'),
    statusSesudah: text('status_sesudah'),
    /** Lampiran dalam bentuk metadata JSON (bukan binary). */
    metadata: jsonb('metadata').notNull().default({}),
    dibuatPada: dibuatPada(),
  },
  (t) => [index('ix_aktivitas_tugas').on(t.taskId, t.dibuatPada)],
);

// ============================================================
// Dependensi antar tugas
// ============================================================

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: pk(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    bergantungPadaTaskId: uuid('bergantung_pada_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_task_dep').on(t.taskId, t.bergantungPadaTaskId),
    index('ix_task_dep_parent').on(t.bergantungPadaTaskId),
  ],
);

// ============================================================
// Checklist tugas
// ============================================================

export const taskChecklists = pgTable(
  'task_checklists',
  {
    id: pk(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    isi: text('isi').notNull(),
    selesai: boolean('selesai').notNull().default(false),
    selesaiOleh: uuid('selesai_oleh'),
    selesaiPada: date('selesai_pada'),
    urutan: integer('urutan').notNull().default(0),
    dibuatPada: dibuatPada(),
  },
  (t) => [index('ix_checklist_task').on(t.taskId, t.urutan)],
);
