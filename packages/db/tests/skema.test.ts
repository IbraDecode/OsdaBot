/**
 * Tes skema database.
 *
 * Menguji definisi skema tanpa memerlukan database. Uji yang benar-benar
 * butuh PostgreSQL dilakukan lewat migrasi, trigger invariant, dan
 * `tools/scripts/e2e-absensi.mjs`.
 *
 * CATATAN: yang diperiksa adalah NAMA EKSPOR tabel (camelCase), bukan nama
 * tabel di PostgreSQL (snake_case). Keduanya dicerminkan di sini.
 */
import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';

import { schema } from './helper-skema.js';

/** Nama export tabel yang harus ada. */
const TABEL_WAJIB = [
  // Organisasi & struktur
  'organizations', 'organizationPeriods', 'divisions', 'positions',
  'positionAssignments',
  // Identitas & anggota
  'users', 'identities', 'members', 'memberPeriodHistory',
  'accountLinkRequests', 'sessions', 'oneTimeTokens', 'authPolicies',
  // Otorisasi
  'permissions', 'roles', 'rolePermissions', 'memberRoles', 'delegations',
  // Absensi
  'attendanceSessions', 'attendanceRecords', 'attendanceQrTokens',
  'permissionRequests', 'attendanceParticipants',
  // Rapat
  'meetings', 'meetingAgenda', 'meetingParticipants', 'meetingMinutes',
  'meetingActionItems', 'meetingAttachments',
  // Tugas
  'tasks', 'taskAssignees', 'taskActivity', 'taskDependencies', 'taskChecklists',
  // Program & acara
  'programs', 'programMembers', 'programMilestones', 'programDocuments',
  'programEvaluations', 'events', 'eventParticipants', 'eventAttendance',
  'eventSchedules',
  // Keuangan
  'accounts', 'financialPeriods', 'budgets', 'budgetItems', 'expenseRequests',
  'transactions', 'ledgerEntries', 'reimbursements', 'payments',
  'duesPeriods', 'duesStatus',
  // Dokumen
  'documents', 'documentVersions', 'documentAccess', 'letters',
  'documentCategories', 'storageBuckets',
  // Komunikasi & sistem
  'announcements', 'announcementRecipients', 'campaigns', 'notifications',
  'notificationDeliveries', 'approvalRequests', 'approvalRecipients',
  'activityLog', 'auditLogs', 'settings', 'featureFlags',
  'integrationConfigs', 'webhookEvents', 'legacyIdMappings',
];

/** Nama tabel di PostgreSQL yang wajib ada. */
const NAMA_TABEL_DB = [
  'organizations', 'organization_periods', 'divisions', 'positions',
  'position_assignments', 'users', 'identities', 'members',
  'member_period_history', 'account_link_requests', 'sessions',
  'one_time_tokens', 'auth_policies', 'permissions', 'roles',
  'role_permissions', 'member_roles', 'delegations', 'attendance_sessions',
  'attendance_records', 'attendance_qr_tokens', 'permission_requests',
  'attendance_participants', 'meetings', 'meeting_agenda',
  'meeting_participants', 'meeting_minutes', 'meeting_action_items',
  'meeting_attachments', 'tasks', 'task_assignees', 'task_activity',
  'task_dependencies', 'task_checklists', 'programs', 'program_members',
  'program_milestones', 'program_documents', 'program_evaluations',
  'events', 'event_participants', 'event_attendance', 'event_schedules',
  'accounts', 'financial_periods', 'budgets', 'budget_items',
  'expense_requests', 'transactions', 'ledger_entries', 'reimbursements',
  'payments', 'dues_periods', 'dues_status', 'documents',
  'document_versions', 'document_access', 'letters', 'document_categories',
  'storage_buckets', 'announcements', 'announcement_recipients',
  'campaigns', 'notifications', 'notification_deliveries',
  'approval_requests', 'approval_recipients', 'activity_log', 'audit_logs',
  'settings', 'feature_flags', 'integration_configs', 'webhook_events',
  'legacy_id_mappings',
];

/**
 * Nama kolom sebuah tabel.
 *
 * Catatan: kunci dari `getTableColumns` adalah nama properti TypeScript
 * (camelCase). Konversi ke snake_case baru terjadi saat query, lewat
 * opsi `casing: 'snake_case'` pada konfigurasi Drizzle. Karena itu test ini
 * memakai camelCase, bukan nama kolom PostgreSQL.
 *
 * `getTableColumns` mengembalikan objek kolom bernama, jadi kuncunya yang
 * dipakai — bukan nilai array-nya.
 */
function kolom(namaEkspor: string): string[] {
  const tabel = (schema as Record<string, unknown>)[namaEkspor];
  if (!tabel) throw new Error(`Tabel "${namaEkspor}" tidak ada di skema.`);
  return Object.keys(getTableColumns(tabel as never));
}

describe('Kelengkapan skema', () => {
  it('semua tabel wajib tersedia sebagai export', () => {
    const ada = new Set(Object.keys(schema));
    const hilang = TABEL_WAJIB.filter((t) => !ada.has(t));
    expect(hilang).toEqual([]);
  });

  it('jumlah tabel tetap 74 (dokumentasi DATABASE.md ikut terikat)', () => {
    expect(Object.keys(schema)).toHaveLength(74);
    expect(NAMA_TABEL_DB).toHaveLength(74);
  });

  it('semua tabel punya kolom id, kecuali tabeljunction', () => {
    // Tabel junction memakai kunci primer majemuk, bukan UUID.
    const junction = new Set(['rolePermissions']);
    for (const nama of TABEL_WAJIB) {
      if (junction.has(nama)) continue;
      expect(kolom(nama)).toContain('id');
    }
  });

  it('tabel junction memakai kunci primer majemuk', () => {
    const k = kolom('rolePermissions');
    expect(k).toContain('roleId');
    expect(k).toContain('permissionId');
    expect(k).toContain('cakupan');
  });
});

describe('Nama tabel PostgreSQL', () => {
  it('setiap nama tabel DB terdaftar di TABEL_WAJIB sebagai nama export', () => {
    // Nama export memakai camelCase (duesStatus), nama DB snake_case (dues_status).
    const ada = new Set(TABEL_WAJIB);
    const tidakAda = NAMA_TABEL_DB.filter((n) => {
      const camel = n.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      return !ada.has(camel);
    });
    expect(tidakAda).toEqual([]);
  });
});

describe('Kolom waktu', () => {
  it('tabel utama punya dibuat_pada', () => {
    for (const nama of [
      'members', 'users', 'attendanceSessions', 'meetings', 'tasks', 'programs',
      'events', 'transactions', 'ledgerEntries', 'documents', 'announcements',
      'notifications', 'auditLogs',
    ]) {
      expect(kolom(nama)).toContain('dibuatPada');
    }
  });

  it('catatan absensi memakai direkamPada, bukan dibuatPada', () => {
    // Absensi dicatat saat anggota mengirim, bukan saat baris dibuat.
    // Nama kolomnya sengaja dibedakan agar maknanya tidak tertukar.
    const k = kolom('attendanceRecords');
    expect(k).toContain('direkamPada');
    expect(k).not.toContain('dibuatPada');
  });

  it('tabel yang dapat diubah punya diubah_pada', () => {
    for (const nama of ['members', 'tasks', 'programs', 'documents', 'settings']) {
      expect(kolom(nama)).toContain('diubahPada');
    }
  });
});

describe('Anggota tidak pernah dihapus keras', () => {
  it('pakai arsip, bukan dihapus_pada', () => {
    const k = kolom('members');
    expect(k).toContain('diarsipkanPada');
    expect(k).toContain('alasanArsip');
    expect(k).not.toContain('dihapusPada');
  });
});

describe('Idempotensi', () => {
  it('catatan absensi punya idempotency_key', () => {
    expect(kolom('attendanceRecords')).toContain('idempotencyKey');
  });

  it('sesi absensi punya idempotency_key agar scheduler tidak membuka ganda', () => {
    expect(kolom('attendanceSessions')).toContain('idempotencyKey');
  });

  it('transaksi punya idempotency_key', () => {
    expect(kolom('transactions')).toContain('idempotencyKey');
  });

  it('notifikasi punya dedup_key', () => {
    expect(kolom('notifications')).toContain('dedupKey');
  });

  it('webhook punya event_id', () => {
    expect(kolom('webhookEvents')).toContain('eventId');
  });

  it('permintaan persetujuan punya idempotency_key', () => {
    expect(kolom('approvalRequests')).toContain('idempotencyKey');
  });
});

describe('Keuangan', () => {
  it('transaksi punya nominal', () => {
    expect(kolom('transactions')).toContain('nominal');
  });

  it('ledger punya debit, kredit, dan saldo berjalan', () => {
    const k = kolom('ledgerEntries');
    expect(k).toContain('debit');
    expect(k).toContain('kredit');
    expect(k).toContain('saldoBerjalan');
  });

  it('pembayaran punya referensi provider', () => {
    expect(kolom('payments')).toContain('referensiProvider');
  });

  it('anggaran menyimpan total diajukan dan disetujui terpisah', () => {
    const k = kolom('budgets');
    expect(k).toContain('totalDiajukan');
    expect(k).toContain('totalDisetujui');
  });

  it('reimbursement mencatat siapa yang mereview, menyetujui, dan membayar', () => {
    const k = kolom('reimbursements');
    expect(k).toContain('direviewOleh');
    expect(k).toContain('disetujuiOleh');
    expect(k).toContain('dibayarOleh');
  });
});

describe('Tugas: DONE bukan berarti VERIFIED', () => {
  it('status dan verifikasi adalah dua kolom terpisah', () => {
    const k = kolom('tasks');
    expect(k).toContain('status');
    expect(k).toContain('verifikasi');
    expect(k).toContain('butuhVerifikasi');
    expect(k).toContain('diverifikasiOleh');
    expect(k).toContain('diverifikasiPada');
  });
});

describe('Notulen berversi', () => {
  it('punya nomor versi dan kunci revisi', () => {
    const k = kolom('meetingMinutes');
    expect(k).toContain('versi');
    expect(k).toContain('alasanRevisi');
    expect(k).toContain('dikunciPada');
  });
});

describe('Penelusuran asal-usul', () => {
  it('anggota hasil migrasi menyimpan legacy_id', () => {
    expect(kolom('members')).toContain('legacyId');
  });

  it('sesi absensi hasil migrasi menyimpan legacy_id', () => {
    expect(kolom('attendanceSessions')).toContain('legacyId');
  });

  it('ada tabel pemetaan ID legacy ke ID baru', () => {
    const k = kolom('legacyIdMappings');
    expect(k).toContain('legacyTabel');
    expect(k).toContain('legacyId');
    expect(k).toContain('targetId');
  });
});

describe('Audit', () => {
  it('menyimpan sebelum, sesudah, dan konteks teknis', () => {
    const k = kolom('auditLogs');
    expect(k).toContain('sebelum');
    expect(k).toContain('sesudah');
    expect(k).toContain('ip');
    expect(k).toContain('userAgent');
    expect(k).toContain('requestId');
  });
});

describe('Periode kepengurusan', () => {
  it('periode bisa diarsipkan tanpa dihapus', () => {
    const k = kolom('organizationPeriods');
    expect(k).toContain('status');
    expect(k).toContain('diarsipkanPada');
    expect(k).not.toContain('dihapusPada');
  });
});
