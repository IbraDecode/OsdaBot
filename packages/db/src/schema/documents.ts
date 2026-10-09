/**
 * Skema dokumen & penyimpanan objek.
 *
 * Berkas TIDAK disimpan di PostgreSQL. Tabel ini hanya menyimpan metadata dan
 * kunci objek (`storage_key`). Akses berkas lewat signed URL berumur pendek
 * dari object storage privat (spec §28, §48).
 */
import { sql } from 'drizzle-orm';
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
  enumStatusDokumen,
  pk,
  versiBaris,
} from './_base.js';
import { divisions, organizations, organizationPeriods } from './organization.js';
import { members } from './identity.js';
import { events, programs } from './programs.js';
import { meetings } from './meetings.js';

// ============================================================
// Dokumen
// ============================================================

export const documents = pgTable(
  'documents',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    judul: text('judul').notNull(),
    /** Kategori: SURAT_MASUK, SURAT_KELUAR, PROPOSAL, LPJ, NOTULEN, SK, UNDANGAN, … */
    kategori: text('kategori').notNull().default('LAINNYA'),
    deskripsi: text('deskripsi'),
    /** Versi aktif saat ini. */
    versi: integer('versi').notNull().default(1),
    status: enumStatusDokumen('status').notNull().default('DRAFT'),
    ownerMemberId: uuid('owner_member_id').references(() => members.id, { onDelete: 'set null' }),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    /** Metadata versi aktif (denormalisasi untuk list tanpa join). */
    storageKey: text('storage_key'),
    namaBerkas: text('nama_berkas'),
    ukuranBytes: integer('ukuran_bytes'),
    mime: text('mime'),
    checksumSha256: text('checksum_sha256'),
    perluPersetujuan: boolean('perlu_persetujuan').notNull().default(true),
    disetujuiOleh: uuid('disetujui_oleh').references(() => members.id, { onDelete: 'set null' }),
    disetujuiPada: date('disetujui_pada'),
    alasanPenolakan: text('alasan_penolakan'),
    diarsipkanPada: date('diarsipkan_pada'),
    /** Retensi: 0 = simpan permanen. */
    retensiHari: integer('retensi_hari').notNull().default(0),
    tagLabel: text('tag').array().notNull().default([]),
    pencarian: text('pencarian'),
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    index('ix_dokumen_org_kategori').on(t.organizationId, t.kategori),
    index('ix_dokumen_status').on(t.status),
    index('ix_dokumen_program').on(t.programId),
    index('ix_dokumen_event').on(t.eventId),
    index('ix_dokumen_meeting').on(t.meetingId),
    index('ix_dokumen_owner').on(t.ownerMemberId),
    index('ix_dokumen_pencarian').on(t.organizationId, t.pencarian),
    uniqueIndex('uq_dokumen_storage_key').on(t.storageKey),
  ],
);

export type DokumenBaris = typeof documents.$inferSelect;
export type DokumenSisip = typeof documents.$inferInsert;

// ============================================================
// Versi dokumen
// ============================================================

/**
 * Setiap revisi menambah versi baru. Versi yang sudah APPROVED dikunci dan
 * tidak boleh diubah — trigger database menolak UPDATE pada baris terkunci.
 */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: pk(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versi: integer('versi').notNull(),
    storageKey: text('storage_key').notNull(),
    namaBerkas: text('nama_berkas').notNull(),
    ukuranBytes: integer('ukuran_bytes').notNull(),
    mime: text('mime').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    catatan: text('catatan'),
    alasanRevisi: text('alasan_revisi'),
    diunggahOleh: uuid('diunggah_oleh').references(() => members.id, { onDelete: 'set null' }),
    diunggahPada: date('diunggah_pada').notNull().default(sql`now()`),
    /** true setelah disetujui; baris tidak dapat diubah lagi. */
    dikunci: boolean('dikunci').notNull().default(false),
    dikunciPada: date('dikunci_pada'),
  },
  (t) => [
    uniqueIndex('uq_dokumen_versi').on(t.documentId, t.versi),
    uniqueIndex('uq_dokumen_versi_key').on(t.storageKey),
  ],
);

// ============================================================
// Hak akses dokumen
// ============================================================

/**
 * Akses dokumen mengikuti authorization. Daftar kosong berarti semua anggota
 * dengan izin `document.read` boleh membaca (dibatasi oleh scope).
 */
export const documentAccess = pgTable(
  'document_access',
  {
    id: pk(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }),
    roleCode: text('role_code'),
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'cascade' }),
    /** true = hanya boleh dibaca, false = boleh diedit. */
    hanyaBaca: boolean('hanya_baca').notNull().default(true),
    berlakuSampai: date('berlaku_sampai'),
    diberikanOleh: uuid('diberikan_oleh'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    index('ix_akses_dokumen').on(t.documentId),
    index('ix_akses_member').on(t.memberId),
  ],
);

// ============================================================
// Surat masuk & surat keluar (Secretary)
// ============================================================

export const letters = pgTable(
  'letters',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    /** MASUK / KELUAR */
    arah: text('arah').notNull(),
    nomor: text('nomor').notNull(),
    tanggal: date('tanggal').notNull(),
    pengirim: text('pengirim'),
    penerima: text('penerima'),
    instansiPengirim: text('instansi_pengirim'),
    /** Ringkasan isi surat. */
    ringkasan: text('ringkasan').notNull(),
    /** Tindak lanjut: perlu_respon / sudah_respon. */
    perluTindakLanjut: boolean('perlu_tindak_lanjut').notNull().default(false),
    batasTindakLanjut: date('batas_tindak_lanjut'),
    selesaiPada: date('selesai_pada'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    dicatatOleh: uuid('dicatat_oleh').references(() => members.id, { onDelete: 'set null' }),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    uniqueIndex('uq_surat_org_nomor').on(t.organizationId, t.nomor),
    index('ix_surat_arah').on(t.organizationId, t.arah),
    index('ix_surat_tindak_lanjut').on(t.organizationId, t.perluTindakLanjut),
    index('ix_surat_tanggal').on(t.tanggal),
  ],
);

// ============================================================
// Kategori dokumen kustom
// ============================================================

export const documentCategories = pgTable(
  'document_categories',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    nama: text('nama').notNull(),
    deskripsi: text('deskripsi'),
    /** Mask kategori bawaan agar tidak terhapus. */
    bawaan: boolean('bawaan').notNull().default(false),
    /** Retensi default (hari). 0 = permanen. */
    retensiHari: integer('retensi_hari').notNull().default(0),
    perluPersetujuan: boolean('perlu_persetujuan').notNull().default(true),
    urutan: integer('urutan').notNull().default(100),
    aktif: boolean('aktif').notNull().default(true),
    dibuatPada: dibuatPada(),
  },
  (t) => [uniqueIndex('uq_kategori_org_kode').on(t.organizationId, t.kode)],
);

// ============================================================
// Wuwongan metadata object storage
// ============================================================

/**
 * Bucket per organizations, dengan konfigurasi privat. Bucket tidak boleh
 * diekspos publik; semua akses lewat signed URL.
 */
export const storageBuckets = pgTable(
  'storage_buckets',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    nama: text('nama').notNull(),
    /** Selalu true di v2 — bucket publik dilarang. */
    publik: boolean('publik').notNull().default(false),
    /** Prefix objek (organizations sebagai namespace). */
    prefix: text('prefix').notNull(),
    batasUkuranBytes: integer('batas_ukuran_bytes'),
    kuotaBytes: integer('kuota_bytes'),
    dipakaiBytes: integer('dipakai_bytes').notNull().default(0),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [uniqueIndex('uq_bucket_org').on(t.organizationId)],
);
