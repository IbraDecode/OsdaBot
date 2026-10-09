/**
 * Skema otorisasi: RBAC + permission + scope.
 *
 * Prinsip:
 * 1. Peran (role) BUKAN satu-satunya authorization. Yang menentukan adalah
 *    permission + scope.
 * 2. Semua peran, permission, dan hubungan keduanya dapat dikonfigurasi lewat
 *    database. Tidak ada daftar peran yang di-hardcode di kode.
 * 3. Otorisasi selalu diperiksa di backend pada tiga tingkat:
 *    endpoint (guard) → service (permitted operation) → resource (objek).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';

import {
  diubahPada,
  dibuatPada,
  dibuatOleh,
  enumCakupan,
  pk,
  versiBaris,
} from './_base.js';
import { organizations, organizationPeriods } from './organization.js';
import { members } from './identity.js';

// ============================================================
// Permission — kamus izin
// ============================================================

export const permissions = pgTable(
  'permissions',
  {
    id: pk(),
    /** Bentuk "modul.aksi", mis. "finance.approve". */
    kode: text('kode').notNull(),
    modul: text('modul').notNull(),
    aksi: text('aksi').notNull(),
    deskripsi: text('deskripsi').notNull(),
    /** Tindakan yang mengubah uang/keamanan perlu pencatatan audit tambahan. */
    sensitif: boolean('sensitif').notNull().default(false),
    dibuatPada: dibuatPada(),
  },
  (t) => [uniqueIndex('uq_permission_kode').on(t.kode), index('ix_permission_modul').on(t.modul)],
);

export type PermissionBaris = typeof permissions.$inferSelect;
export type PermissionSisip = typeof permissions.$inferInsert;

// ============================================================
// Role — paket izin
// ============================================================

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    nama: text('nama').notNull(),
    deskripsi: text('deskripsi'),
    /**
     * Peran bawaan sistem (SUPER_ADMIN … MEMBER) tidak boleh dihapus.
     * Peran organizations (jika organizationId diisi) bebas dibuat.
     */
    bawaan: boolean('bawaan').notNull().default(false),
    /** Peran yang hanya relevan pada satu tingkat jabatan (mis. koordinator). */
    tingkatJabatan: text('tingkat_jabatan'),
    /** Peran yang tidak boleh menerima tugas lebih dari satu orang. */
    tunggal: boolean('tunggal').notNull().default(false),
    /** Cakupan default bila permission tidak mencantumkan cakupan. */
    cakupanDefault: text('cakupan_default').$type<'OWN' | 'DIVISION' | 'ORGANIZATION' | 'FINANCE' | 'SYSTEM'>(),
    /** Peran hierarchical: peran ini mewarisi izin dari peran lain. */
    warisiDariKode: text('warisi_dari_kode'),
    urutan: integer('urutan').notNull().default(100),
    aktif: boolean('aktif').notNull().default(true),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    dibuatOleh: uuid('dibuat_oleh'),
  },
  (t) => [
    // Peran bawaan bersifat global (organizationId NULL), peran lokal unik per organizations.
    index('ix_role_org').on(t.organizationId),
    uniqueIndex('uq_role_global_kode').on(t.kode).where(sqlIsNull('organization_id')),
    uniqueIndex('uq_role_org_kode')
      .on(t.organizationId, t.kode)
      .where(sqlNotNull('organization_id')),
  ],
);

export type PeranBaris = typeof roles.$inferSelect;
export type PeranSisip = typeof roles.$inferInsert;

// ============================================================
// Role ↔ Permission
// ============================================================

/**
 * Tautan peran ke izin, lengkap dengan cakupan.
 * Cakupan disimpan per tautan (bukan hanya di peran) karena satu permission
 * bisa berlaku OWN untuk satu peran dan ORGANIZATION untuk peran lain.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    cakupan: enumCakupan('cakupan').notNull().default('OWN'),
    /** Batasan tambahan per peran (mis. hanya untuk periode tertentu). */
    kondisi: jsonb('kondisi').$type<Record<string, unknown>>(),
    dibuatPada: dibuatPada(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId, t.cakupan] })],
);

// ============================================================
// Member ↔ Role
// ============================================================

export const memberRoles = pgTable(
  'member_roles',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    /** Periode berlaku. NULL = berlaku selama periode keanggotaan. */
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'cascade' }),
    /** Jabatan yang melandasi peran ini, bila ada. */
    positionAssignmentId: uuid('position_assignment_id'),
    /** Pembatas divisi untuk peran seperti KOORDINATOR. */
    divisionId: uuid('division_id'),
    mulaiPada: text('mulai_pada'),
    selesaiPada: text('selesai_pada'),
    diberikanOleh: uuid('diberikan_oleh'),
    alasan: text('alasan'),
    dicabutPada: text('dicabut_pada'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    index('ix_member_role_member').on(t.memberId),
    index('ix_member_role_role').on(t.roleId),
    index('ix_member_role_org').on(t.organizationId),
  ],
);

export type MemberPeranBaris = typeof memberRoles.$inferSelect;
export type MemberPeranSisip = typeof memberRoles.$inferInsert;

// ============================================================
// Delegasi wewenang sementara
// ============================================================

/**
 * Delegasi: seorang anggota memberi wewenang kepada anggota lain untuk
 * sementara, mis. Ketua-away memberi kewenangan kepada Wakil.
 * Delegasi tidak menambah permission baru — hanya meneruskan milik pemberi.
 */
export const delegations = pgTable(
  'delegations',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    pemberiMemberId: uuid('pemberi_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    penerimaMemberId: uuid('penerima_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** Kosong = semua izin pemberi. */
    permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }),
    alasan: text('alasan').notNull(),
    mulaiPada: text('mulai_pada').notNull(),
    selesaiPada: text('selesai_pada').notNull(),
    dicabutPada: text('dicabut_pada'),
    dibuatPada: dibuatPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    index('ix_delegasi_pemberi').on(t.pemberiMemberId),
    index('ix_delegasi_penerima').on(t.penerimaMemberId),
  ],
);

// ============================================================
// Helper SQL untuk indeks parsial
// ============================================================

function sqlIsNull(kolom: string) {
  return sql`${sql.raw(kolom)} is null`;
}
function sqlNotNull(kolom: string) {
  return sql`${sql.raw(kolom)} is not null`;
}
