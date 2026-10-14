/**
 * Katalog permission.
 *
 * Prinsip: permission itu EKSPLISIT dan BERBUTIR RINGKAS.
 * Jangan pernah menulis `if (role === 'admin') allow everything` — itu cepat
 * menyebabkan celah. Setiap tool menyatakan permission yang dibutuhkan, dan
 * backend independently memeriksanya.
 */

export const PERMISSIONS = {
  // Organisasi
  ORGANIZATION_READ: 'organization.read',
  ORGANIZATION_UPDATE: 'organization.update',

  // Anggota
  MEMBERS_READ: 'members.read',
  MEMBERS_CREATE: 'members.create',
  MEMBERS_UPDATE: 'members.update',
  MEMBERS_DELETE: 'members.delete',
  MEMBERS_EXPORT: 'members.export',

  // Peran & izin
  ROLES_READ: 'roles.read',
  ROLES_MANAGE: 'roles.manage',

  // Kehadiran
  ATTENDANCE_READ: 'attendance.read',
  ATTENDANCE_CREATE: 'attendance.create',
  ATTENDANCE_UPDATE: 'attendance.update',
  ATTENDANCE_DELETE: 'attendance.delete',
  ATTENDANCE_EXPORT: 'attendance.export',

  // Kegiatan
  EVENTS_READ: 'events.read',
  EVENTS_CREATE: 'events.create',
  EVENTS_UPDATE: 'events.update',
  EVENTS_DELETE: 'events.delete',

  // Tugas
  TASKS_READ: 'tasks.read',
  TASKS_CREATE: 'tasks.create',
  TASKS_UPDATE: 'tasks.update',
  TASKS_ASSIGN: 'tasks.assign',
  TASKS_DELETE: 'tasks.delete',

  // Keuangan
  FINANCE_READ: 'finance.read',
  FINANCE_CREATE: 'finance.create',
  FINANCE_UPDATE: 'finance.update',
  FINANCE_APPROVE: 'finance.approve',
  FINANCE_EXPORT: 'finance.export',

  // Dokumen
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_CREATE: 'documents.create',
  DOCUMENTS_EXPORT: 'documents.export',
  DOCUMENTS_DISTRIBUTE: 'documents.distribute',

  // Pengetahuan organisasi
  KNOWLEDGE_READ: 'knowledge.read',
  KNOWLEDGE_WRITE: 'knowledge.write',

  // WhatsApp
  WHATSAPP_SEND: 'whatsapp.send',
  WHATSAPP_BULK_SEND: 'whatsapp.bulk_send',
  WHATSAPP_GROUP_MANAGE: 'whatsapp.group_manage',

  // Grup & organisasi di grup
  GROUPS_LINK: 'groups.link',
  GROUPS_CONFIGURE: 'groups.configure',

  // Otomasi
  AUTOMATION_READ: 'automation.read',
  AUTOMATION_CREATE: 'automation.create',
  AUTOMATION_CANCEL: 'automation.cancel',

  // Proactive intelligence
  MONITORING_READ: 'monitoring.read',
  MONITORING_MANAGE: 'monitoring.manage',

  // Skill
  SKILLS_READ: 'skills.read',
  SKILLS_PROPOSE: 'skills.propose',
  SKILLS_APPROVE: 'skills.approve',

  // Sistem
  SYSTEM_STATUS_READ: 'system.status_read',
  SYSTEM_CONFIGURE: 'system.configure',
  SYSTEM_SAFE_MODE: 'system.safe_mode',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

/** Kelompok permission untuk dokumentasi & UI. */
export const PERMISSION_GROUPS: Record<string, Permission[]> = {
  'Organisasi': [PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.ORGANIZATION_UPDATE],
  'Anggota': [
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_CREATE,
    PERMISSIONS.MEMBERS_UPDATE,
    PERMISSIONS.MEMBERS_DELETE,
    PERMISSIONS.MEMBERS_EXPORT,
  ],
  'Peran': [PERMISSIONS.ROLES_READ, PERMISSIONS.ROLES_MANAGE],
  'Kehadiran': [
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_CREATE,
    PERMISSIONS.ATTENDANCE_UPDATE,
    PERMISSIONS.ATTENDANCE_DELETE,
    PERMISSIONS.ATTENDANCE_EXPORT,
  ],
  'Kegiatan': [
    PERMISSIONS.EVENTS_READ,
    PERMISSIONS.EVENTS_CREATE,
    PERMISSIONS.EVENTS_UPDATE,
    PERMISSIONS.EVENTS_DELETE,
  ],
  'Tugas': [
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.TASKS_UPDATE,
    PERMISSIONS.TASKS_ASSIGN,
    PERMISSIONS.TASKS_DELETE,
  ],
  'Keuangan': [
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.FINANCE_CREATE,
    PERMISSIONS.FINANCE_UPDATE,
    PERMISSIONS.FINANCE_APPROVE,
    PERMISSIONS.FINANCE_EXPORT,
  ],
  'Dokumen': [
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_CREATE,
    PERMISSIONS.DOCUMENTS_EXPORT,
    PERMISSIONS.DOCUMENTS_DISTRIBUTE,
  ],
  'Pengetahuan': [PERMISSIONS.KNOWLEDGE_READ, PERMISSIONS.KNOWLEDGE_WRITE],
  'Grup': [
    PERMISSIONS.GROUPS_LINK,
    PERMISSIONS.GROUPS_CONFIGURE,
    PERMISSIONS.WHATSAPP_GROUP_MANAGE,
  ],
  'Skill': [PERMISSIONS.SKILLS_READ, PERMISSIONS.SKILLS_PROPOSE, PERMISSIONS.SKILLS_APPROVE],
  'WhatsApp': [PERMISSIONS.WHATSAPP_SEND, PERMISSIONS.WHATSAPP_BULK_SEND],
  'Otomasi': [
    PERMISSIONS.AUTOMATION_READ,
    PERMISSIONS.AUTOMATION_CREATE,
    PERMISSIONS.AUTOMATION_CANCEL,
    PERMISSIONS.MONITORING_READ,
    PERMISSIONS.MONITORING_MANAGE,
  ],
  'Sistem': [
    PERMISSIONS.SYSTEM_STATUS_READ,
    PERMISSIONS.SYSTEM_CONFIGURE,
    PERMISSIONS.SYSTEM_SAFE_MODE,
  ],
}

/** Deskripsi singkat tiap permission — dipakai untuk dokumentasi & error message. */
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [PERMISSIONS.ORGANIZATION_READ]: 'Melihat data dasar organisasi',
  [PERMISSIONS.ORGANIZATION_UPDATE]: 'Mengubah pengaturan organisasi',
  [PERMISSIONS.MEMBERS_READ]: 'Melihat data anggota',
  [PERMISSIONS.MEMBERS_CREATE]: 'Menambah anggota',
  [PERMISSIONS.MEMBERS_UPDATE]: 'Mengubah data anggota',
  [PERMISSIONS.MEMBERS_DELETE]: 'Menghapus anggota',
  [PERMISSIONS.MEMBERS_EXPORT]: 'Mengekspor data anggota',
  [PERMISSIONS.ROLES_READ]: 'Melihat daftar peran',
  [PERMISSIONS.ROLES_MANAGE]: 'Mengatur peran dan izin',
  [PERMISSIONS.ATTENDANCE_READ]: 'Melihat daftar hadir',
  [PERMISSIONS.ATTENDANCE_CREATE]: 'Membuat daftar hadir / kegiatan',
  [PERMISSIONS.ATTENDANCE_UPDATE]: 'Mengubah status kehadiran',
  [PERMISSIONS.ATTENDANCE_DELETE]: 'Menghapus entri kehadiran',
  [PERMISSIONS.ATTENDANCE_EXPORT]: 'Mengekspor rekap kehadiran',
  [PERMISSIONS.EVENTS_READ]: 'Melihat kegiatan',
  [PERMISSIONS.EVENTS_CREATE]: 'Membuat kegiatan',
  [PERMISSIONS.EVENTS_UPDATE]: 'Mengubah kegiatan',
  [PERMISSIONS.EVENTS_DELETE]: 'Menghapus kegiatan',
  [PERMISSIONS.TASKS_READ]: 'Melihat tugas',
  [PERMISSIONS.TASKS_CREATE]: 'Membuat tugas',
  [PERMISSIONS.TASKS_UPDATE]: 'Mengubah tugas',
  [PERMISSIONS.TASKS_ASSIGN]: 'Menugaskan orang',
  [PERMISSIONS.TASKS_DELETE]: 'Menghapus tugas',
  [PERMISSIONS.FINANCE_READ]: 'Melihat catatan keuangan',
  [PERMISSIONS.FINANCE_CREATE]: 'Mencatat transaksi keuangan',
  [PERMISSIONS.FINANCE_UPDATE]: 'Mengubah transaksi keuangan',
  [PERMISSIONS.FINANCE_APPROVE]: 'Menyetujui transaksi keuangan',
  [PERMISSIONS.FINANCE_EXPORT]: 'Mengekspor laporan keuangan',
  [PERMISSIONS.DOCUMENTS_READ]: 'Melihat dokumen organisasi',
  [PERMISSIONS.DOCUMENTS_CREATE]: 'Membuat dokumen',
  [PERMISSIONS.DOCUMENTS_EXPORT]: 'Mengekspor dokumen',
  [PERMISSIONS.DOCUMENTS_DISTRIBUTE]: 'Mendistribusikan dokumen ke pihak lain',
  [PERMISSIONS.KNOWLEDGE_READ]: 'Membaca pengetahuan organisasi',
  [PERMISSIONS.KNOWLEDGE_WRITE]: 'Menulis pengetahuan organisasi',
  [PERMISSIONS.WHATSAPP_SEND]: 'Mengirim pesan WhatsApp',
  [PERMISSIONS.WHATSAPP_BULK_SEND]: 'Mengirim pesan massal',
  [PERMISSIONS.WHATSAPP_GROUP_MANAGE]: 'Mengelola grup WhatsApp',
  [PERMISSIONS.GROUPS_LINK]: 'Menghubungkan grup ke organisasi',
  [PERMISSIONS.GROUPS_CONFIGURE]: 'Mengatur konfigurasi grup',
  [PERMISSIONS.AUTOMATION_READ]: 'Melihat otomasi dan jadwal',
  [PERMISSIONS.AUTOMATION_CREATE]: 'Membuat otomasi / pengingat',
  [PERMISSIONS.AUTOMATION_CANCEL]: 'Membatalkan otomasi',
  [PERMISSIONS.MONITORING_READ]: 'Melihat monitoring dan sinyal organisasi',
  [PERMISSIONS.MONITORING_MANAGE]: 'Mengatur monitoring organisasi',
  [PERMISSIONS.SKILLS_READ]: 'Melihat daftar skill',
  [PERMISSIONS.SKILLS_PROPOSE]: 'Mengusulkan skill baru',
  [PERMISSIONS.SKILLS_APPROVE]: 'Menyetujui dan mengaktifkan skill',
  [PERMISSIONS.SYSTEM_STATUS_READ]: 'Melihat status sistem',
  [PERMISSIONS.SYSTEM_CONFIGURE]: 'Mengubah konfigurasi sistem',
  [PERMISSIONS.SYSTEM_SAFE_MODE]: 'Mengaktifkan Safe Mode',
}

/** Guard: pastikan semua permission di katalog punya deskripsi. */
export function validatePermissionCatalog(): void {
  const kurang: string[] = []
  for (const permission of ALL_PERMISSIONS) {
    if (!PERMISSION_DESCRIPTIONS[permission]) kurang.push(permission)
  }
  if (kurang.length > 0) {
    throw new Error(`Permission tanpa deskripsi: ${kurang.join(', ')}`)
  }
}