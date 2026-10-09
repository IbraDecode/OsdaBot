/**
 * Skema identitas & anggota.
 *
 * Pemisahan yang ditegakkan di sini (spec §06):
 *   User       = akun untuk masuk (Web/Mobile)
 *   Identity   = sarana identifikasi (WhatsApp PN/LID, email, Google)
 *   Member     = orang sebagai anggota organizations (kelas, angkatan, status)
 *
 * Satu user dapat memiliki banyak identity. Logika bisnis TIDAK BOLEH
 * bergantung pada format identity WhatsApp.
 */
import { date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  batasWaktu,
  dibuatPada,
  diubahPada,
  dibuatOleh,
  enumProviderIdentitas,
  enumStatusAnggota,
  enumStatusPengguna,
  pk,
} from './_base.js';
import { organizations, organizationPeriods } from './organization.js';

// ============================================================
// User — akun masuk untuk Web & Mobile
// ============================================================

export const users = pgTable(
  'users',
  {
    id: pk(),
    nama: text('nama').notNull(),
    email: text('email'),
    telepon: text('telepon'),
    /** Hash kata sandi (argon2id). NULL untuk akun yang hanya masuk lewat identity. */
    passwordHash: text('password_hash'),
    status: enumStatusPengguna('status').notNull().default('ACTIVE'),
    emailDiverifikasiPada: date('email_diverifikasi_pada'),
    teleponDiverifikasiPada: date('telepon_diverifikasi_pada'),
    bahasa: text('bahasa').notNull().default('id'),
    /** Preferensi notifikasi per jenis & metode. */
    preferensiNotifikasi: jsonb('preferensi_notifikasi').notNull().default({}),
    avatarUrl: text('avatar_url'),
    loginTerakhirPada: date('login_terakhir_pada'),
    /** Hitung login gagal untuk mendeteksi percobaan menebak. */
    gagalLoginBerturut: integer('gagal_login_berturut').notNull().default(0),
    dikunciSampai: batasWaktu('dikunci_sampai'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    dihapusPada: date('dihapus_pada'),
  },
  (t) => [
    // Email unik bila diisi (beberapa akun bisa tanpa email).
    uniqueIndex('uq_users_email').on(t.email),
    uniqueIndex('uq_users_telepon').on(t.telepon),
    index('ix_users_status').on(t.status),
  ],
);

export type PenggunaBaris = typeof users.$inferSelect;
export type PenggunaSisip = typeof users.$inferInsert;

// ============================================================
// Identity — pasangan user dengan penyedia identitas
// ============================================================

export const identities = pgTable(
  'identities',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: enumProviderIdentitas('provider').notNull(),
    /**
     * Identitas mentah dari penyedia, SENGAJA disimpan apa adanya.
     * Contoh: "6281234567890@s.whatsapp.net" atau PN "6281234567890".
     * Logika bisnis harus memakai helper normalisasi, bukan mencocokkan string.
     */
    providerSubject: text('provider_subject').notNull(),
    /**
     * Identitas kanonik yang sudah dinormalisasi (mis. nomor telepon saja).
     * Inilah yang dipakai untuk pencocokan lintas client.
     */
    providerSubjectKanonik: text('provider_subject_kanonik').notNull(),
    /** LID WhatsApp bila tersedia; dipakai untuk Mention di grup. */
    whatsappLid: text('whatsapp_lid'),
    namaTampilan: text('nama_tampilan'),
    metadata: jsonb('metadata').notNull().default({}),
    diverifikasiPada: date('diverifikasi_pada'),
    dipakaiTerakhirPada: date('dipakai_terakhir_pada'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    // Idempotent: satu provider + satu subjek = satu identity.
    uniqueIndex('uq_identity_provider_subjek').on(t.provider, t.providerSubject),
    uniqueIndex('uq_identity_kanonik').on(t.provider, t.providerSubjectKanonik),
    index('ix_identity_user').on(t.userId),
    index('ix_identity_lid').on(t.whatsappLid),
  ],
);

export type IdentitasBaris = typeof identities.$inferSelect;
export type IdentitasSisip = typeof identities.$inferInsert;

// ============================================================
// Member — anggota organizations
// ============================================================

export const members = pgTable(
  'members',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    /** Relasi ke akun User. NULL = belum punya akun Web/Mobile. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Nomor anggota manusiawi, mis. "M-0001". */
    nomor: text('nomor').notNull(),
    nama: text('nama').notNull(),
    tingkat: text('tingkat').notNull(),
    jurusan: text('jurusan'),
    subKelas: text('sub_kelas'),
    nis: text('nis'),
    nisn: text('nisn'),
    /** Salinan kontak untuk keperluan arsip & laporan. */
    email: text('email'),
    telepon: text('telepon'),
    divisionId: uuid('division_id'),
    jenisKelamin: text('jenis_kelamin'),
    tanggalLahir: date('tanggal_lahir'),
    alamat: text('alamat'),
    bio: text('bio'),
    fotoUrl: text('foto_url'),
    status: enumStatusAnggota('status').notNull().default('ACTIVE'),
    bergabungPada: date('bergabung_pada').notNull(),
    /** Diisi admin/pengurus, bukan boleh diisi anggota sendiri. */
    dibuatOleh: uuid('dibuat_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    /**
     * Arsip, bukan hapus keras. Member dengan histori tidak boleh dihapus.
     * Lihat fungsi arsipkan di package @osda/domain.
     */
    diarsipkanPada: date('diarsipkan_pada'),
    alasanArsip: text('alasan_arsip'),
    /**
     * ID dari data legacy (OSDA BOT v0.4) bila anggota ini hasil migrasi.
     * Memudahkan rekonsiliasi & audit. NULL untuk anggota baru.
     */
    legacyId: text('legacy_id'),
    legacyTabel: text('legacy_tabel'),
  },
  (t) => [
    uniqueIndex('uq_member_org_nomor').on(t.organizationId, t.nomor),
    uniqueIndex('uq_member_org_nisn').on(t.organizationId, t.nisn),
    index('ix_member_org_status').on(t.organizationId, t.status),
    index('ix_member_user').on(t.userId),
    index('ix_member_division').on(t.divisionId),
    index('ix_member_nama').on(t.organizationId, t.nama),
    index('ix_member_telepon').on(t.organizationId, t.telepon),
    index('ix_member_period').on(t.periodId),
    // Anggota hasil migrasi satu organisasi tidak boleh bentrok.
    uniqueIndex('uq_member_org_legacy').on(t.organizationId, t.legacyTabel, t.legacyId),
  ],
);

export type AnggotaBaris = typeof members.$inferSelect;
export type AnggotaSisip = typeof members.$inferInsert;

/** Riwayat keanggotaan lintas periode (histori tidak pernah hilang). */
export const memberPeriodHistory = pgTable(
  'member_period_history',
  {
    id: pk(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => organizationPeriods.id, { onDelete: 'cascade' }),
    status: enumStatusAnggota('status').notNull(),
    bergabungPada: date('bergabung_pada').notNull(),
    selesaiPada: date('selesai_pada'),
    catatan: text('catatan'),
    dicatatPada: dibuatPada(),
  },
  (t) => [
    index('ix_histori_member').on(t.memberId),
    index('ix_histori_period').on(t.periodId),
  ],
);

// ============================================================
// Antrean account linking
// ============================================================

/**
 * Permintaan pengaitan akun:identity WhatsApp → user Web/Mobile.
 * Alur: WhatsApp → member → account linking → verified user → akses Web/Mobile.
 */
export const accountLinkRequests = pgTable(
  'account_link_requests',
  {
    id: pk(),
    /** Identity WhatsApp yang meminta linking. */
    identityId: uuid('identity_id').references(() => identities.id, { onDelete: 'set null' }),
    providerSubject: text('provider_subject').notNull(),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kode: text('kode').notNull(),
    /** Satu kode hanya boleh dipakai sekali dan punya masa berlaku. */
    berlakuSampai: date('berlaku_sampai').notNull(),
    dipakaiPada: date('dipakai_pada'),
    gagalPercobaan: integer('gagal_percobaan').notNull().default(0),
    alasanGagal: text('alasan_gagal'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_link_kode').on(t.kode),
    index('ix_link_subject').on(t.providerSubject),
    index('ix_link_user').on(t.userId),
  ],
);

// ============================================================
// Sesi & token
// ============================================================

/** Sesi login — dasar untuk pencabutan token (logout, ganti kata sandi). */
export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    /** Jaringan untuk device yang sama, dipakai deteksi anomali. */
    jaringan: text('jaringan'),
    terakhirDipakaiPada: date('terakhir_dipakai_pada'),
    /** bumped tiap refresh token; invalidatedAt diisi saat logout/revoke. */
    kedaluwarsaPada: date('kedaluwarsa_pada'),
    dicabutPada: date('dicabut_pada'),
    alasanPencabutan: text('alasan_pencabutan'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_sesi_refresh').on(t.refreshTokenHash),
    index('ix_sesi_user').on(t.userId),
    index('ix_sesi_kedaluwarsa').on(t.kedaluwarsaPada),
  ],
);

/** Token sekali pakai: verifikasi surel, tukar identity, tautan dalam. */
export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    id: pk(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    tipe: text('tipe').notNull(),
    tokenHash: text('token_hash').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    berlakuSampai: date('berlaku_sampai').notNull(),
    dipakaiPada: date('dipakai_pada'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_ott_token').on(t.tokenHash),
    index('ix_ott_user').on(t.userId),
    index('ix_ott_tipe').on(t.tipe),
  ],
);

/** Pengaturan yang memengaruhi perilaku masuk (mis. wajibkan 2FA). */
export const authPolicies = pgTable(
  'auth_policies',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kunci: text('kunci').notNull(),
    nilai: jsonb('nilai').notNull(),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [uniqueIndex('uq_auth_policy').on(t.organizationId, t.kunci)],
);
