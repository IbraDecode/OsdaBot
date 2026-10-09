/**
 * Skema organizations: organizations, sekolah, periode kepengurusan, divisi, jabatan.
 *
 * Tidak ada pun yang di-hardcode. "Ketua", "Sekretaris", atau "Bendahara" hanya
 * adalah baris pada tabel `jabatan` + `peran`, bukan nilai enum di kode.
 */
import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  diubahPada,
  dibuatPada,
  dibuatOleh,
  enumStatusPeriode,
  enumTingkatJabatan,
  pk,
} from './_base.js';

// ============================================================
// Organisasi
// ============================================================

export const organizations = pgTable(
  'organizations',
  {
    id: pk(),
    nama: text('nama').notNull(),
    singkat: text('singkat').notNull(),
    jenis: text('jenis').notNull().default('OSIS'),
    namaSekolah: text('nama_sekolah').notNull(),
    npsn: text('npsn'),
    alamat: text('alamat'),
    kodePos: text('kode_pos'),
    telepon: text('telepon'),
    email: text('email'),
    website: text('website'),
    logoUrl: text('logo_url'),
    zonaWaktu: text('zona_waktu').notNull().default('Asia/Makassar'),
    aktif: boolean('aktif').notNull().default(true),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  
  },
  (t) => [uniqueIndex('uq_organisasi_singkat').on(t.singkat)],
);

export type OrganisasiBaris = typeof organizations.$inferSelect;
export type OrganisasiSisip = typeof organizations.$inferInsert;

// ============================================================
// Periode kepengurusan
// ============================================================

export const organizationPeriods = pgTable(
  'organization_periods',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    nama: text('nama').notNull(),
    mulaiPada: date('mulai_pada').notNull(),
    selesaiPada: date('selesai_pada').notNull(),
    status: enumStatusPeriode('status').notNull().default('UPCOMING'),
    deskripsi: text('deskripsi'),
    diarsipkanPada: date('diarsipkan_pada'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    dibuatOleh: uuid('dibuat_oleh'),
  },
  (t) => [
    index('ix_period_org').on(t.organizationId),
    uniqueIndex('uq_period_org_nama').on(t.organizationId, t.nama),
  ],
);

export type PeriodeBaris = typeof organizationPeriods.$inferSelect;
export type PeriodeSisip = typeof organizationPeriods.$inferInsert;

// ============================================================
// Divisi / Bidang
// ============================================================

export const divisions = pgTable(
  'divisions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    nama: text('nama').notNull(),
    kode: text('kode').notNull(),
    deskripsi: text('deskripsi'),
    idDivisiInduk: uuid('id_divisi_induk'),
    koordinatorMemberId: uuid('koordinator_member_id'),
    urutant: integer('urutan').notNull().default(100),
    aktif: boolean('aktif').notNull().default(true),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    dibuatOleh: uuid('dibuat_oleh'),
  },
  (t) => [
    index('ix_divisi_org').on(t.organizationId),
    index('ix_divisi_period').on(t.periodId),
    uniqueIndex('uq_divisi_org_kode').on(t.organizationId, t.kode),
  ],
);

export type DivisiBaris = typeof divisions.$inferSelect;
export type DivisiSisip = typeof divisions.$inferInsert;

// ============================================================
// Jabatan (position) — sepenuhnya configurable
// ============================================================

export const positions = pgTable(
  'positions',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    nama: text('nama').notNull(),
    kode: text('kode').notNull(),
    tingkat: enumTingkatJabatan('tingkat').notNull().default('MEMBER'),
    urutan: integer('urutan').notNull().default(100),
    deskripsi: text('deskripsi'),
    /** Jabatan ini umumnya hanya diisi pada satu periode (mis. Ketua). */
    butuhSK: boolean('butuh_sk').notNull().default(true),
    aktif: boolean('aktif').notNull().default(true),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    dibuatOleh: uuid('dibuat_oleh'),
  },
  (t) => [
    index('ix_jabatan_org').on(t.organizationId),
    uniqueIndex('uq_jabatan_org_kode').on(t.organizationId, t.kode),
  ],
);

export type JabatanBaris = typeof positions.$inferSelect;
export type JabatanSisip = typeof positions.$inferInsert;

/** Penugasan jabatan kepada anggota pada periode tertentu. */
export const positionAssignments = pgTable(
  'position_assignments',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => organizationPeriods.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    positionId: uuid('position_id')
      .notNull()
      .references(() => positions.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    mulaiPada: date('mulai_pada'),
    selesaiPada: date('selesai_pada'),
    /** SK atau bukti penugasan (metadata dokumen). */
    dokumenId: uuid('dokumen_id'),
    catatan: text('catatan'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    dibuatOleh: uuid('dibuat_oleh'),
  },
  (t) => [
    index('ix_jabatan_tugas_member').on(t.memberId),
    index('ix_jabatan_tugas_period').on(t.periodId),
    index('ix_jabatan_tugas_pos').on(t.positionId),
  ],
);

export type JabatanTugasBaris = typeof positionAssignments.$inferSelect;
export type JabatanTugasSisip = typeof positionAssignments.$inferInsert;

/** skil此处 tidak perlu index unik karena satu anggota bisa punya beberapa jabatan. */
