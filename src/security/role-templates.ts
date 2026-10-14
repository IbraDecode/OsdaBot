/**
 * Role default per organisasi.
 *
 * Catatan penting soal keamanan:
 * -. Admin grup WhatsApp BUKAN otomatis admin organisasi. Itu dua hal berbeda.
 * - Role di sini adalah template.-copy ke organisasi saat dibuat.
 * - Semua role (termasuk OWNER) tetap dicek lewat permission eksplisit.
 */

export interface RoleTemplate {
  key: string
  name: string
  description: string
  permissions: string[]
}

export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  SECRETARY: 'secretary',
  TREASURER: 'treasurer',
  ATTENDANCE_MANAGER: 'attendance_manager',
  COMMITTEE: 'committee',
  MEMBER: 'member',
} as const

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]

/**
 * Template role default.
 *
 * Sengaja tidak ada peran "moderator" yang bisa segalanya: setiap peran punya
 * batas jelas supaya saat audit jelas terlihat siapa sebenarnya boleh apa.
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: SYSTEM_ROLES.OWNER,
    name: 'Pemilik Organisasi',
    description: 'Pemilik penuh organisasi. Akun bootstrap pertama.',
    permissions: ['*'],
  },
  {
    key: SYSTEM_ROLES.ADMIN,
    name: 'Administrator',
    description: 'Mengelola seluruh operasional organisasi.',
    permissions: [
      'organization.read',
      'organization.update',
      'members.read',
      'members.create',
      'members.update',
      'members.delete',
      'members.export',
      'roles.read',
      'roles.manage',
      'attendance.read',
      'attendance.create',
      'attendance.update',
      'attendance.delete',
      'attendance.export',
      'events.read',
      'events.create',
      'events.update',
      'events.delete',
      'tasks.read',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.delete',
      'finance.read',
      'finance.create',
      'finance.update',
      'finance.export',
      'documents.read',
      'documents.create',
      'documents.export',
      'documents.distribute',
      'knowledge.read',
      'knowledge.write',
      'whatsapp.send',
      'whatsapp.bulk_send',
      'whatsapp.group_manage',
      'groups.link',
      'groups.configure',
      'automation.read',
      'automation.create',
      'automation.cancel',
      'monitoring.read',
      'monitoring.manage',
      'skills.read',
      'skills.propose',
      'skills.approve',
      'system.status_read',
    ],
  },
  {
    key: SYSTEM_ROLES.SECRETARY,
    name: 'Sekretaris',
    description: 'Dokumen, pengumuman, dan komunikasi resmi.',
    permissions: [
      'organization.read',
      'members.read',
      'attendance.read',
      'events.read',
      'events.create',
      'events.update',
      'tasks.read',
      'tasks.create',
      'tasks.update',
      'documents.read',
      'documents.create',
      'documents.export',
      'knowledge.read',
      'knowledge.write',
      'whatsapp.send',
      'automation.read',
    ],
  },
  {
    key: SYSTEM_ROLES.TREASURER,
    name: 'Bendahara',
    description: 'Catatan kas, tagihan, dan persetujuan keuangan.',
    permissions: [
      'organization.read',
      'members.read',
      'finance.read',
      'finance.create',
      'finance.update',
      'finance.approve',
      'finance.export',
      'documents.read',
      'documents.create',
      'documents.export',
      'whatsapp.send',
    ],
  },
  {
    key: SYSTEM_ROLES.ATTENDANCE_MANAGER,
    name: 'Pengelola Kehadiran',
    description: 'Mengelola daftar hadir dan konfirmasi anggota.',
    permissions: [
      'organization.read',
      'members.read',
      'attendance.read',
      'attendance.create',
      'attendance.update',
      'attendance.export',
      'events.read',
      'whatsapp.send',
    ],
  },
  {
    key: SYSTEM_ROLES.COMMITTEE,
    name: 'Panitia',
    description: 'Mendukung pelaksanaan kegiatan.',
    permissions: [
      'organization.read',
      'members.read',
      'attendance.read',
      'attendance.update',
      'events.read',
      'tasks.read',
      'tasks.create',
      'tasks.update',
      'documents.read',
      'documents.create',
      'whatsapp.send',
    ],
  },
  {
    key: SYSTEM_ROLES.MEMBER,
    name: 'Anggota',
    description: 'Melihat data dasar dan kepentinannya sendiri.',
    permissions: [
      'organization.read',
      'attendance.read',
      'events.read',
      'tasks.read',
      'documents.read',
    ],
  },
]

/** Ambil template berdasarkan key. */
export function findRoleTemplate(key: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((role) => role.key === key)
}

/**
 * Ekspansi permission bertanda '*' (dipakai hanya oleh OWNER).
 * Simpel dan eksplisit — bukan wildcard runtime yang sulit diuji.
 */
export function expandPermissions(permissions: string[], allPermissions: string[]): string[] {
  if (permissions.includes('*')) return [...allPermissions]
  const unik = new Set(permissions)
  return [...unik].filter((p) => p !== '*')
}