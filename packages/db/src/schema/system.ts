/**
 * Skema komunikasi (Humas), notifikasi, audit, pengaturan, dan integrasi.
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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  diubahPada,
  dibuatPada,
  dibuatOleh,
  enumAudiens,
  enumKanal,
  enumJenisNotifikasi,
  enumJenisPersetujuan,
  enumMetodeNotifikasi,
  enumPrioritasNotifikasi,
  enumStatusFitur,
  enumStatusKomunikasi,
  enumStatusPersetujuan,
  enumStatusPengiriman,
  enumSumberAudit,
  pk,
  uang,
  versiBaris,
} from './_base.js';
import { divisions, organizations, organizationPeriods } from './organization.js';
import { members, users } from './identity.js';
import { events, programs } from './programs.js';

// ============================================================
// Pengumuman
// ============================================================

export const announcements = pgTable(
  'announcements',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    judul: text('judul').notNull(),
    isi: text('isi').notNull(),
    /** Cuplikan 160 karakter untuk daftar & WhatsApp preview. */
    ringkasan: text('ringkasan'),
    audiens: enumAudiens('audiens').notNull().default('ALL'),
    /** Filter audiens detail (dipakai bila audiens = DIVISION / CUSTOM). */
    divisionIds: uuid('division_ids').array().notNull().default([]),
    jabatanIds: uuid('jabatan_ids').array().notNull().default([]),
    memberIds: uuid('member_ids').array(),
    kanal: enumKanal('kanal').array().notNull().default([]),
    prioritas: enumPrioritasNotifikasi('prioritas').notNull().default('NORMAL'),
    status: enumStatusKomunikasi('status').notNull().default('DRAFT'),
    pin: boolean('pin').notNull().default(false),
    perluPersetujuan: boolean('perlu_persetujuan').notNull().default(true),
    /** Kunci idempotensi pembuatan agar scheduler tidak mengirim dua kali. */
    idempotencyKey: text('idempotency_key'),
    lampiranDokumenIds: uuid('lampiran_dokumen_ids').array().notNull().default([]),
    /** Tanggal terbit efektif (untuk pengumuman terjadwal). */
    tanggalTerbit: date('tanggal_terbit'),
    jadwalkanPada: timestamp('jadwalkan_pada', { withTimezone: true }),
    terbitPada: timestamp('terbit_pada', { withTimezone: true }),
    /** Zahl penerima hasil resolusi audiens. */
    totalPenerima: integer('total_penerima').notNull().default(0),
    totalTerkirim: integer('total_terkirim').notNull().default(0),
    totalTerbaca: integer('total_terbaca').notNull().default(0),
    totalGagal: integer('total_gagal').notNull().default(0),
    disetujuiOleh: uuid('disetujui_oleh'),
    disetujuiPada: date('disetujui_pada'),
    alasanPenolakan: text('alasan_penolakan'),
    dibuatOleh: uuid('dibuat_oleh').references(() => members.id, { onDelete: 'set null' }),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    index('idx_pengumuman_status').on(t.organizationId, t.status),
    index('idx_pengumuman_terbit').on(t.terbitPada),
    index('idx_pengumuman_jadwal').on(t.jadwalkanPada),
    index('idx_pengumuman_program').on(t.programId),
    index('idx_pengumuman_event').on(t.eventId),
  ],
);

export type PengumumanBaris = typeof announcements.$inferSelect;

// ============================================================
// Peserta pengumuman
// ============================================================

export const announcementRecipients = pgTable(
  'announcement_recipients',
  {
    id: pk(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    kanal: enumKanal('kanal').notNull(),
    status: enumStatusPengiriman('status').notNull().default('PENDING'),
    percobaan: integer('percobaan').notNull().default(0),
    pesanGalat: text('pesan_gagal'),
    /** Referensi pesan di provider (msg id). */
    pesanId: text('pesan_id'),
    dikirimPada: timestamp('dikirim_pada', { withTimezone: true }),
    diterimaPada: timestamp('diterima_pada', { withTimezone: true }),
    dibacaPada: timestamp('dibaca_pada', { withTimezone: true }),
    /** Anti-spam: pesan identik tidak dikirim dua kali dalam 24 jam. */
    dedupKey: text('dedup_key'),
  },
  (t) => [
    uniqueIndex('uq_penerima_kanal').on(t.announcementId, t.memberId, t.kanal),
    index('ix_penerima_status').on(t.status),
    index('ix_penerima_member').on(t.memberId),
  ],
);

// ============================================================
// Kampanye
// ============================================================

export const campaigns = pgTable(
  'campaigns',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    nama: text('nama').notNull(),
    deskripsi: text('deskripsi'),
    mulaiPada: date('mulai_pada').notNull(),
    selesaiPada: date('selesai_pada').notNull(),
    /** PLANNED / ACTIVE / COMPLETED / CANCELLED */
    status: text('status').notNull().default('PLANNED'),
    /** Pengumuman yang terkait kampanye. */
    announcementIds: uuid('announcement_ids').array().notNull().default([]),
    budget: uang('budget'),
    dibuatOleh: uuid('dibuat_oleh').references(() => members.id, { onDelete: 'set null' }),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [
    index('idx_kampanye_org').on(t.organizationId, t.status),
    index('idx_kampanye_program').on(t.programId),
  ],
);

// ============================================================
// Notifikasi
// ============================================================

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    organizationId: uuid('organization_id').references(() => org.id, { onDelete: 'cascade' }),
    /** NULL = notifikasi sistem untuk semua pengguna. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Alias member agar pencarian notifikasi mudah. */
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }),
    jenis: enumJenisNotifikasi('jenis').notNull(),
    prioritas: enumPrioritasNotifikasi('prioritas').notNull().default('NORMAL'),
    judul: text('judul').notNull(),
    isi: text('isi').notNull(),
    /** Objek yang memicu notifikasi, mis. { jenis: 'TASK', id: '...' }. */
    entitasJenis: text('entitas_jenis'),
    entitasId: uuid('entitas_id'),
    /** Tombol aksi (deep link ke Web/Mobile). */
    actions: jsonb('actions').$type<{ label: string; url: string; utama?: boolean }[]>().notNull().default([]),
    /** Idempotensi notifikasi agar tidak terkirim berulang. */
    dedupKey: text('dedup_key'),
    dibacaPada: timestamp('dibaca_pada', { withTimezone: true }),
    /** Dihapus otomatis setelah waktu ini (0 = tidak pernah). */
    kedaluwarsaPada: timestamp('kedaluwarsa_pada', { withTimezone: true }),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    index('ix_notif_user_belum').on(t.userId, t.dibacaPada),
    index('ix_notif_jenis').on(t.userId, t.jenis),
    index('ix_notif_entitas').on(t.entitasJenis, t.entitasId),
    index('ix_notif_kedaluwarsa').on(t.kedaluwarsaPada),
    uniqueIndex('uq_notif_dedup').on(t.userId, t.dedupKey),
  ],
);

export type NotifikasiBaris = typeof notifications.$inferSelect;

// ============================================================
// Antrean pengiriman (outbox pattern)
// ============================================================

/**
 * Outbox pattern: notifikasi & pengumuman ditulis ke sini dalam satu transaksi
 * dengan perubahan bisnis, lalu worker mengirimkannya. Ini menjamin:
 *  - tidak ada notifikasi hilang bila integrasi gagal
 *  - pengiriman dapat diulang dengan aman
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: pk(),
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'cascade',
    }),
    announcementId: uuid('announcement_id').references(() => announcements.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }),
    metode: enumMetodeNotifikasi('metode').notNull(),
    kanal: enumKanal('kanal'),
    status: enumStatusPengiriman('status').notNull().default('PENDING'),
    percobaan: integer('percobaan').notNull().default(0),
    pesanGalat: text('pesan_gagal'),
    pesanId: text('pesan_id'),
    /** Idempotensi worker (kunci job BullMQ). */
    jobKey: text('job_key').notNull(),
    jadwalkanPada: timestamp('jadwalkan_pada', { withTimezone: true }).notNull().default(sql`now()`),
    dikirimPada: timestamp('dikirim_pada', { withTimezone: true }),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_delivery_job').on(t.jobKey),
    index('ix_delivery_status').on(t.status),
    index('ix_delivery_jadwal').on(t.jadwalkanPada),
    index('ix_delivery_notif').on(t.notificationId),
    index('ix_delivery_pengumuman').on(t.announcementId),
  ],
);

// ============================================================
// Persetujuan (Approval engine)
// ============================================================

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    /** PROGRAM / BUDGET / EXPENSE / REIMBURSEMENT / DOCUMENT / ANNOUNCEMENT / EVENT / MINUTES / LEAVE */
    jenis: enumJenisPersetujuan('jenis').notNull(),
    /** Tabel + id objek yang meminta persetujuan. */
    entitasTabel: text('entitas_tabel').notNull(),
    entitasId: uuid('entitas_id').notNull(),
    ringkasan: text('ringkasan').notNull(),
    nominal: uang('nominal'),
    /** Konteks tambahan (mis. JSON butir anggaran). */
    metadata: jsonb('metadata').notNull().default({}),
    pemohonId: uuid('pemohon_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    status: enumStatusPersetujuan('status').notNull().default('PENDING'),
    /** Level persetujuan bertingkat. */
    levelSekarang: integer('level_sekarang').notNull().default(1),
    totalLevel: integer('total_level').notNull().default(1),
    /** Kunci idempotensi: satu objek hanya punya satu permintaan aktif. */
    idempotencyKey: text('idempotency_key'),
    diselesaikanPada: date('diselesaikan_pada'),
    alasanPenolakan: text('alasan_penolakan'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    versiBaris: versiBaris(),
  },
  (t) => [
    index('idx_approval_entitas').on(t.entitasTabel, t.entitasId),
    index('idx_approval_status').on(t.organizationId, t.status),
    index('idx_approval_pemohon').on(t.pemohonId),
    uniqueIndex('uq_approval_idempotensi').on(t.organizationId, t.idempotencyKey),
  ],
);

/** Penerima persetujuan (bisa peran, bukan orang — agar tidak hardcode). */
export const approvalRecipients = pgTable(
  'approval_recipients',
  {
    id: pk(),
    approvalRequestId: uuid('approval_request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    /** Kode peran, mis. "CHAIRPERSON". */
    roleCode: text('role_code').notNull(),
    level: integer('level').notNull().default(1),
    /** WAITING / DECIDED */
    status: enumStatusPersetujuan('status').notNull().default('PENDING'),
    diputuskanOleh: uuid('diputusan_oleh').references(() => members.id, { onDelete: 'set null' }),
    diputuskanPada: date('diputusan_pada'),
    komentar: text('komentar'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    index('idx_approval_penerima').on(t.roleCode, t.status),
    index('idx_approval_req').on(t.approvalRequestId),
  ],
);

// ============================================================
// Activity feed
// ============================================================

export const activityLog = pgTable(
  'activity_log',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => organizationPeriods.id, { onDelete: 'set null' }),
    /** Pesan siap tampil, mis. "Ibra membuat program OSDACUP". */
    pesan: text('pesan').notNull(),
    /** Pelaku aksi. */
    actorId: uuid('actor_id').references(() => members.id, { onDelete: 'set null' }),
    actorNama: text('actor_nama'),
    /** Entitas yang terpengaruh. */
    entitasJenis: text('entitas_jenis').notNull(),
    entitasId: uuid('entitas_id'),
    entitasLabel: text('entitas_label'),
    /** Kanal aksi: dari UI mana. */
    kanal: text('kanal'),
    /** Data tambahan untuk filter (division, program, dsb). */
    metadata: jsonb('metadata').notNull().default({}),
    /** Diolak oleh CSRF-like guard: user tidak boleh melihat entitas yang tidak diizinkan. */
    divisionId: uuid('division_id').references(() => divisions.id, { onDelete: 'set null' }),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'set null' }),
    dibuatPada: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index('idx_activity_org_created').on(t.organizationId, t.dibuatPada),
    index('idx_activity_entitas').on(t.entitasJenis, t.entitasId),
    index('idx_activity_actor').on(t.actorId),
    index('idx_activity_division').on(t.divisionId),
    index('idx_activity_program').on(t.programId),
  ],
);

// ============================================================
// Audit log
// ============================================================

/**
 * Audit log menyimpan SEBELUM & SESUDAH dalam bentuk JSON untuk perubahan
 * sensitif. WAJIB: nilai rahasia (password, token, secret) TIDAK BOLEH dicatat.
 * Sanitasi dilakukan di lapisan service sebelum menulis ke sini.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    organizationId: uuid('organization_id').references(() => org.id, { onDelete: 'set null' }),
    /** USER_CREATED / ROLE_CHANGED / EXPENSE_APPROVED / … */
    aksi: text('aksi').notNull(),
    entitasTabel: text('entitas_tabel').notNull(),
    entitasId: uuid('entitas_id'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorMemberId: uuid('actor_member_id').references(() => members.id, { onDelete: 'set null' }),
    sumber: enumSumberAudit('sumber').notNull().default('API'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    /** JSON perubahan. Tidak pernah berisi secret. */
    sebelum: jsonb('sebelum'),
    sesudah: jsonb('sesudah'),
    /** Field yang berubah. */
    fieldDiubah: text('field_diubah'),
    berhasil: boolean('berhasil').notNull().default(true),
    pesanGalat: text('pesan_galat'),
    dibuatPada: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index('idx_audit_org_created').on(t.organizationId, t.dibuatPada),
    index('idx_audit_aksi').on(t.aksi, t.dibuatPada),
    index('idx_audit_entitas').on(t.entitasTabel, t.entitasId),
    index('idx_audit_actor').on(t.actorId),
    index('idx_audit_request').on(t.requestId),
  ],
);

// ============================================================
// Pengaturan sistem
// ============================================================

/** Konfigurasi non-rahasia yang boleh diubah organization (mis. zona waktu). */
export const settings = pgTable(
  'settings',
  {
    id: pk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    kunci: text('kunci').notNull(),
    nilai: text('nilai').notNull(),
    deskripsi: text('deskripsi'),
    /** Tipe nilai untuk parsing: string / number / boolean / json. */
    tipe: text('tipe').notNull().default('string'),
    diubahOleh: uuid('diubah_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [uniqueIndex('uq_setting_org_kunci').on(t.organizationId, t.kunci)],
);

// ============================================================
// Feature flags
// ============================================================

/**
 * Feature flags untuk migrasi bertahap: new_attendance, new_finance,
 * new_mobile, new_communication, new_reports.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: pk(),
    organizationId: uuid('organization_id').references(() => org.id, { onDelete: 'cascade' }),
    kunci: text('kunci').notNull(),
    status: enumStatusFitur('status').notNull().default('OFF'),
    /** Nilainya bisa per percentage (rollout bertahap). */
    persentase: integer('persentase').notNull().default(100),
    deskripsi: text('deskripsi'),
    diubahOleh: uuid('diubah_oleh'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
  },
  (t) => [uniqueIndex('uq_flag_kunci').on(t.organizationId, t.kunci)],
);

// ============================================================
// Integrasi
// ============================================================

/**
 * Konfigurasi integrasi. Kredensial disimpan terenkripsi (AES-256-GCM) di
 * `configTerenkripsi`. Kolom ini tidak boleh dikembalikan oleh API.
 */
export const integrationConfigs = pgTable(
  'integration_configs',
  {
    id: pk(),
    organizationId: uuid('organization_id').references(() => org.id, { onDelete: 'cascade' }),
    /** WHATSAPP / QRIS / EMAIL / STORAGE / PUSH */
    provider: text('provider').notNull(),
    status: text('status').notNull().default('DISABLED'),
    /** JSON terenkripsi berisi token/secret. */
    configTerenkripsi: text('config_terenkripsi'),
    /** Metadata non-rahasia untuk UI (mis. nama akun, nomor bot). */
    metadata: jsonb('metadata').notNull().default({}),
    /** Status koneksi terakhir + pesan galat. */
    terhubungPada: timestamp('terhubung_pada', { withTimezone: true }),
    pesanGalat: text('pesan_galat'),
    dibuatPada: dibuatPada(),
    diubahPada: diubahPada(),
    diubahOleh: uuid('diubah_oleh'),
  },
  (t) => [uniqueIndex('uq_integration_provider').on(t.organizationId, t.provider)],
);

/** Log pemanggilan webhook masuk (untuk audit & debugging). */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: pk(),
    organizationId: uuid('organization_id').references(() => org.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    /** Idempotency key dari provider. */
    eventId: text('event_id').notNull(),
    tipe: text('tipe').notNull(),
    signatureValid: boolean('signature_valid').notNull().default(false),
    diproses: boolean('diproses').notNull().default(false),
    pesanGalat: text('pesan_gagal'),
    /** Payload mentah disimpan untuk investigasi (tanpa secret). */
    payload: jsonb('payload').notNull().default({}),
    dibuatPada: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    diprosesPada: timestamp('diproses_pada', { withTimezone: true }),
  },
  (t) => [
    // Idempotent: satu event provider hanya boleh diproses sekali.
    uniqueIndex('uq_webhook_event').on(t.provider, t.eventId),
    index('idx_webhook_diproses').on(t.diproses, t.dibuatPada),
  ],
);

// ============================================================
// Riwayatscape-ish: import migrasi legacy
// ============================================================

/**
 * Jejak pemetaan data dari OSDA BOT v0.4 ke OSDA v2. Membantu audit dan
 * rekonsiliasi (spec §79).
 */
export const legacyIdMappings = pgTable(
  'legacy_id_mappings',
  {
    id: pk(),
    /** Tabel legacy: members / attendance_sessions / attendance / kas_weeks / … */
    legacyTabel: text('legacy_tabel').notNull(),
    legacyId: text('legacy_id').notNull(),
    /** Tabel v2 yang menerima data. */
    targetTabel: text('target_tabel').notNull(),
    targetId: uuid('target_id').notNull(),
    organizationId: uuid('organization_id').references(() => org.id, { onDelete: 'set null' }),
    catatan: text('catatan'),
    dibuatPada: dibuatPada(),
  },
  (t) => [
    uniqueIndex('uq_legacy_mapping').on(t.legacyTabel, t.legacyId),
    index('idx_legacy_target').on(t.targetTabel, t.targetId),
  ],
);

// ============================================================
// Alias internal
// ============================================================

/** Alias agar file lain bisa mengimpor `org` tanpa ambigu dengan `options`. */
const org = organizations;

