/**
 * Definisi menu sidebar.
 *
 * ATURAN (spec §34): setiap item menu WAJIB memakai daftar IZIN pengguna,
 * bukan nama peran. Item yang izinnya tidak dimiliki disembunyikan oleh UI;
 * backend tetap menjadi penjaga akhir setiap aksi (jangan pernah bergantung
 * pada penyembunyian menu ini sebagai pengaman).
 */
import type { IkonNama } from '@/components/ikon';

/** Satu item menu sidebar. */
export interface ItemMenu {
  readonly label: string;
  readonly href: string;
  /** Izin yang dibutuhkan untuk melihat item ini. */
  readonly izin?: string;
  /** Keterangan singkat yang tampil sebagai tooltip. */
  readonly keterangan?: string;
  readonly ikon: IkonNama;
}

/** Sekumpulan item menu yang tergabung dalam satu judul grup. */
export interface GrupMenu {
  readonly nama: string;
  readonly item: readonly ItemMenu[];
}

export const GRUP_MENU: readonly GrupMenu[] = [
  {
    nama: 'Umum',
    item: [
      {
        label: 'Dasbor',
        href: '/',
        ikon: 'dasbor',
        keterangan: 'Ringkasan sesuai ruang kerja Anda',
      },
      {
        label: 'Notifikasi',
        href: '/notifications',
        ikon: 'lonceng',
        keterangan: 'Pemberitahuan milik Anda',
      },
    ],
  },
  {
    nama: 'Keanggotaan',
    item: [
      {
        label: 'Anggota',
        href: '/members',
        izin: 'member.read',
        ikon: 'anggota',
        keterangan: 'Daftar & data anggota organisasi',
      },
      {
        label: 'Absensi',
        href: '/attendance',
        izin: 'attendance.read',
        ikon: 'absensi',
        keterangan: 'Sesi absensi dan rekap kehadiran',
      },
      {
        label: 'Rapat',
        href: '/meetings',
        izin: 'meeting.read',
        ikon: 'rapat',
        keterangan: 'Rapat, agenda, dan notulen',
      },
    ],
  },
  {
    nama: 'Program & Tugas',
    item: [
      {
        label: 'Program',
        href: '/programs',
        izin: 'program.read',
        ikon: 'program',
        keterangan: 'Program kerja beserta progresnya',
      },
      {
        label: 'Tugas',
        href: '/tasks',
        izin: 'task.read',
        ikon: 'tugas',
        keterangan: 'Tugas, status, dan verifikasi',
      },
    ],
  },
  {
    nama: 'Keuangan & Laporan',
    item: [
      {
        label: 'Keuangan',
        href: '/finance',
        izin: 'finance.read',
        ikon: 'keuangan',
        keterangan: 'Kas, transaksi, dan anggaran',
      },
      {
        label: 'Laporan',
        href: '/reports',
        izin: 'report.read',
        ikon: 'laporan',
        keterangan: 'Unduh laporan CSV',
      },
    ],
  },
  {
    nama: 'Sistem',
    item: [
      {
        label: 'Pengaturan',
        href: '/settings',
        izin: 'settings.manage',
        ikon: 'pengaturan',
        keterangan: 'Pengaturan organisasi & feature flag',
      },
    ],
  },
];
