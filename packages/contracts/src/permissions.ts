/**
 * Peran (role) bawaan OSDA.
 *
 * PENTING: peran di sini hanyalah nama paket izin bawaan, bukan satu-satunya
 * sumber kebenaran. Otorisasi akhir selalu memakai PERMISSION + CAKUPAN (scope),
 * dan seluruh peran/jabatan harus dapat dikonfigurasi lewat database
 * (lihat docs/AUTHORIZATION.md).
 */

/** Kode peran bawaan yang Recognizable oleh sistem. */
export const PERAN_BAWAAN = [
  'SUPER_ADMIN',
  'ADVISOR',
  'CHAIRPERSON',
  'VICE_CHAIRPERSON',
  'SECRETARY',
  'TREASURER',
  'PR',
  'COORDINATOR',
  'STAFF',
  'MEMBER',
] as const;

/** Tipe kode peran bawaan. */
export type KodePeranBawaan = (typeof PERAN_BAWAAN)[number];

/**
 * Setiap Izin (permission) dalam bentuk `modul.aksi`.
 * Modul mengikuti daftar modul inti pada spesifikasi produk.
 */
export const PERMISSION = [
  // Anggota
  'member.read',
  'member.write',
  'member.archive',

  // Absensi
  'attendance.read',
  'attendance.write',
  'attendance.manage',

  // Rapat
  'meeting.read',
  'meeting.create',
  'meeting.manage',
  'meeting.minutes.approve',

  // Program kerja
  'program.read',
  'program.create',
  'program.manage',
  'program.approve',

  // Tugas
  'task.read',
  'task.write',
  'task.verify',

  // Acara
  'event.read',
  'event.create',
  'event.manage',

  // Keuangan — tiap tindakan punya izin sendiri (lihat spec §47)
  'finance.read',
  'finance.write',
  'finance.approve',
  'finance.export',

  // Komunikasi
  'communication.create',
  'communication.publish',

  // Dokumen
  'document.create',
  'document.approve',
  'document.read',

  // Pelaporan
  'report.read',
  'report.export',

  // Persetujuan
  'approval.read',
  'approval.decide',

  // Notifikasi
  'notification.read',

  // Sistem
  'audit.read',
  'settings.manage',
  'integration.manage',
  'period.manage',
] as const;

/** Tipe nama izin. */
export type Izin = (typeof PERMISSION)[number];

/** Seluruh modul yang(ERROR distinct) muncul dari daftar izin. */
export const MODUL_PERMISSION = [
  'member',
  'attendance',
  'meeting',
  'program',
  'task',
  'event',
  'finance',
  'communication',
  'document',
  'report',
  'approval',
  'notification',
  'audit',
  'settings',
  'integration',
  'period',
] as const;

/** Tipe modul. */
export type ModulPermission = (typeof MODUL_PERMISSION)[number];

/**
 * Cakupan (scope) yang menentukan seberapa luas sebuah izin berlaku.
 * - OWN       : hanya miliknya sendiri
 * - DIVISION  : seluruh anggota divisi yang ia kelola
 * - ORGANIZATION: seluruh organisasi
 * - FINANCE   : seluruh data keuangan
 * - SYSTEM    : konfigurasi sistem & audit
 */
export const CAKUPAN = ['OWN', 'DIVISION', 'ORGANIZATION', 'FINANCE', 'SYSTEM'] as const;

/** Tipe cakupan. */
export type Cakupan = (typeof CAKUPAN)[number];

/** Satu paket izin: daftar izin + cakupan default. */
export interface PaketIzin {
  readonly nama: string;
  readonly deskripsi: string;
  readonly izin: readonly Izin[];
  readonly cakupan: readonly Cakupan[];
}

/**
 * Matriks izin bawaan mengikuti ROLE_MATRIX pada spesifikasi produk.
 * Peran khusus organisasi (jabatan) dapat dikonfigurasi di database dan
 * mewarisi paket ini lewat kolom `role_permissions`.
 */
export const MATRICS_PERAN: Readonly<Record<KodePeranBawaan, PaketIzin>> = {
  SUPER_ADMIN: {
    nama: 'Administrator Sistem',
    deskripsi: 'Mengelola organisasi, pengguna, peran, integrasi, pengaturan, dan audit.',
    izin: PERMISSION,
    cakupan: ['OWN', 'DIVISION', 'ORGANIZATION', 'FINANCE', 'SYSTEM'],
  },

  ADVISOR: {
    nama: 'Pembina',
    deskripsi: 'Memberi bimbingan, memantau kinerja, menyetujui hal sensitive.',
    izin: [
      'member.read',
      'attendance.read',
      'attendance.manage',
      'meeting.read',
      'meeting.manage',
      'meeting.minutes.approve',
      'program.read',
      'program.approve',
      'task.read',
      'task.verify',
      'event.read',
      'finance.read',
      'document.read',
      'report.read',
      'report.export',
      'approval.read',
      'approval.decide',
      'notification.read',
      'audit.read',
    ],
    cakupan: ['DIVISION', 'ORGANIZATION', 'FINANCE'],
  },

  CHAIRPERSON: {
    nama: 'Ketua',
    deskripsi: 'Memimpin dan melihat keseluruhan kondisi organisasi.',
    izin: [
      'member.read',
      'member.write',
      'attendance.read',
      'attendance.manage',
      'meeting.read',
      'meeting.create',
      'meeting.manage',
      'meeting.minutes.approve',
      'program.read',
      'program.create',
      'program.manage',
      'program.approve',
      'task.read',
      'task.write',
      'task.verify',
      'event.read',
      'event.create',
      'event.manage',
      'finance.read',
      'finance.approve',
      'document.read',
      'document.create',
      'document.approve',
      'communication.create',
      'communication.publish',
      'report.read',
      'report.export',
      'approval.read',
      'approval.decide',
      'notification.read',
    ],
    cakupan: ['ORGANIZATION', 'FINANCE'],
  },

  VICE_CHAIRPERSON: {
    nama: 'Wakil Ketua',
    deskripsi: 'Mengendalikan operasional: menelusuri apa yang belum selesai.',
    izin: [
      'member.read',
      'attendance.read',
      'attendance.manage',
      'meeting.read',
      'meeting.create',
      'meeting.manage',
      'program.read',
      'program.create',
      'program.manage',
      'program.approve',
      'task.read',
      'task.write',
      'task.verify',
      'event.read',
      'event.create',
      'event.manage',
      'document.read',
      'document.create',
      'communication.create',
      'report.read',
      'approval.read',
      'approval.decide',
      'notification.read',
    ],
    cakupan: ['DIVISION', 'ORGANIZATION'],
  },

  SECRETARY: {
    nama: 'Sekretaris',
    deskripsi: 'Pusat administrasi organisasi: anggota, rapat, notulen, surat, arsip.',
    izin: [
      'member.read',
      'member.write',
      'member.archive',
      'attendance.read',
      'attendance.write',
      'attendance.manage',
      'meeting.read',
      'meeting.create',
      'meeting.manage',
      'program.read',
      'program.create',
      'task.read',
      'task.write',
      'event.read',
      'event.create',
      'document.read',
      'document.create',
      'document.approve',
      'report.read',
      'report.export',
      'approval.read',
      'approval.decide',
      'notification.read',
    ],
    cakupan: ['ORGANIZATION'],
  },

  TREASURER: {
    nama: 'Bendahara',
    deskripsi: 'Mengelola keuangan organisasi. TIDAK boleh mengubah absensi, peran, atau konfigurasi sistem.',
    izin: [
      'finance.read',
      'finance.write',
      'finance.export',
      'program.read',
      'event.read',
      'report.read',
      'report.export',
      'approval.read',
      'document.read',
      'notification.read',
      'member.read',
    ],
    cakupan: ['FINANCE'],
  },

  PR: {
    nama: 'Humas',
    deskripsi: 'Mengelola komunikasi internal dan eksternal. Tidak otomatis dapat keuangan.',
    izin: [
      'communication.create',
      'communication.publish',
      'member.read',
      'event.read',
      'event.create',
      'document.read',
      'document.create',
      'document.approve',
      'program.read',
      'report.read',
      'approval.read',
      'approval.decide',
      'notification.read',
    ],
    cakupan: ['DIVISION', 'ORGANIZATION'],
  },

  COORDINATOR: {
    nama: 'Koordinator Bidang',
    deskripsi: 'Mengelola satu bidang/divisi: anggota, tugas, program, absensi, laporan.',
    izin: [
      'member.read',
      'attendance.read',
      'attendance.write',
      'meeting.read',
      'meeting.create',
      'program.read',
      'program.create',
      'program.manage',
      'task.read',
      'task.write',
      'task.verify',
      'event.read',
      'event.create',
      'event.manage',
      'document.read',
      'document.create',
      'report.read',
      'notification.read',
    ],
    cakupan: ['DIVISION'],
  },

  STAFF: {
    nama: 'Staf',
    deskripsi: 'Mendukung operasional harian tanpa hak persetujuan.',
    izin: [
      'member.read',
      'attendance.read',
      'attendance.write',
      'meeting.read',
      'meeting.create',
      'task.read',
      'task.write',
      'event.read',
      'event.create',
      'document.read',
      'document.create',
      'communication.create',
      'notification.read',
    ],
    cakupan: ['DIVISION'],
  },

  MEMBER: {
    nama: 'Anggota',
    deskripsi: 'Berparticipasi: absen, mengerjakan tugas, mengikuti acara, membaca pengumuman.',
    izin: [
      'member.read',
      'attendance.read',
      'attendance.write',
      'meeting.read',
      'task.read',
      'task.write',
      'event.read',
      'program.read',
      'document.read',
      'finance.read',
      'notification.read',
    ],
    cakupan: ['OWN'],
  },
} as const;

/**
 * Nama ruang kerja (workspace) pada Web Dashboard.
 * Setiap peran bawaan memiliki ruang kerja default, tetapi sidebar Web
 * tetap disusun berdasarkan permission, bukan berdasarkan peran.
 */
export const RUANG_KERJA_PERAN: Readonly<Record<KodePeranBawaan, string>> = {
  SUPER_ADMIN: 'SYSTEM',
  ADVISOR: 'EXECUTIVE',
  CHAIRPERSON: 'EXECUTIVE',
  VICE_CHAIRPERSON: 'OPERATIONS',
  SECRETARY: 'ADMINISTRATION',
  TREASURER: 'FINANCE',
  PR: 'COMMUNICATION',
  COORDINATOR: 'DIVISION',
  STAFF: 'OPERATIONS',
  MEMBER: 'PERSONAL',
} as const;

/** Kode ruang kerja. */
export type RuangKerja = (typeof RUANG_KERJA_PERAN)[KodePeranBawaan];
