/**
 * Definisi menu sidebar OSDA BOT — OSIS SMKN 2 Mataram.
 *
 * Menu disusun lengkap sesuai konsep desain utama:
 * Dashboard, Anggota, Kehadiran, Rapat, Program Kerja, Tugas,
 * Keuangan, Pengumuman, Dokumen, Kalender, Laporan, Pengaturan.
 */
import type { IkonNama } from '@/components/ikon';

export interface ItemMenu {
  readonly label: string;
  readonly href: string;
  readonly izin?: string;
  readonly keterangan?: string;
  readonly ikon: IkonNama;
}

export interface GrupMenu {
  readonly nama: string;
  readonly item: readonly ItemMenu[];
}

export const GRUP_MENU: readonly GrupMenu[] = [
  {
    nama: 'Utama',
    item: [
      {
        label: 'Dashboard',
        href: '/',
        ikon: 'dasbor',
        keterangan: 'Ringkasan eksekutif & operasional organisasi',
      },
      {
        label: 'Anggota',
        href: '/members',
        izin: 'member.read',
        ikon: 'anggota',
        keterangan: 'Daftar pengurus & anggota per divisi',
      },
      {
        label: 'Kehadiran',
        href: '/attendance',
        izin: 'attendance.read',
        ikon: 'absensi',
        keterangan: 'Statistik presensi, sesi, dan rekap kehadiran',
      },
      {
        label: 'Rapat',
        href: '/meetings',
        izin: 'meeting.read',
        ikon: 'rapat',
        keterangan: 'Jadwal rapat, agenda pembahasan, dan notulen',
      },
    ],
  },
  {
    nama: 'Aktivitas & Proyek',
    item: [
      {
        label: 'Program Kerja',
        href: '/programs',
        izin: 'program.read',
        ikon: 'program',
        keterangan: 'Program kerja, linimasa progres & anggaran',
      },
      {
        label: 'Tugas',
        href: '/tasks',
        izin: 'task.read',
        ikon: 'tugas',
        keterangan: 'Daftar tugas, penanggung jawab & verifikasi',
      },
      {
        label: 'Kalender',
        href: '/calendar',
        ikon: 'kalender',
        keterangan: 'Kalender kegiatan & agenda tahunan OSIS',
      },
    ],
  },
  {
    nama: 'Administrasi',
    item: [
      {
        label: 'Keuangan',
        href: '/finance',
        izin: 'finance.read',
        ikon: 'keuangan',
        keterangan: 'Kas organisasi, arus kas, dan bukti transaksi',
      },
      {
        label: 'Pengumuman',
        href: '/announcements',
        ikon: 'pengumuman',
        keterangan: 'Pusat publikasi informasi resmi organisasi',
      },
      {
        label: 'Dokumen',
        href: '/documents',
        ikon: 'dokumen',
        keterangan: 'Arsip berkas, SK, dan administrasi surat',
      },
      {
        label: 'Laporan',
        href: '/reports',
        izin: 'report.read',
        ikon: 'laporan',
        keterangan: 'Rekapitulasi dan laporan berkala',
      },
    ],
  },
  {
    nama: 'Sistem',
    item: [
      {
        label: 'Notifikasi',
        href: '/notifications',
        ikon: 'lonceng',
        keterangan: 'Pusat pemberitahuan Anda',
      },
      {
        label: 'Pengaturan',
        href: '/settings',
        izin: 'settings.manage',
        ikon: 'pengaturan',
        keterangan: 'Konfigurasi organisasi dan akun',
      },
    ],
  },
];
