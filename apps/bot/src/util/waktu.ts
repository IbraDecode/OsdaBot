/**
 * Utilitas waktu — semua perhitungan "hari ini" memakai zona waktu sekolah
 * (mis. Asia/Makassar) supaya absensi tidak bergeser karena zona waktu server.
 */
import { konfig } from '../config.js';

const NAMA_HARI = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
] as const;

/** Tanggal hari ini dalam format `YYYY-MM-DD` menurut zona waktu tertentu. */
export function tanggalHariIni(zonaWaktu: string = konfig.zonaWaktu): string {
  const bagian = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaWaktu,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return bagian;
}

/** Nama hari dalam Bahasa Indonesia untuk sebuah tanggal `YYYY-MM-DD`. */
export function namaHari(tanggal: string): string {
  const waktu = new Date(`${tanggal}T00:00:00`);
  if (Number.isNaN(waktu.getTime())) return '';
  return NAMA_HARI[waktu.getDay()] ?? '';
}

/** Jam sekarang (`HH:mm`) menurut zona waktu tertentu. */
export function jamSekarang(zonaWaktu: string = konfig.zonaWaktu): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zonaWaktu,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

/** Selisih hari antara dua tanggal `YYYY-MM-DD` (positif = tanggal kedua lebih baru). */
export function selisihHari(dari: string, ke: string): number {
  const a = new Date(`${dari}T00:00:00`).getTime();
  const b = new Date(`${ke}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
