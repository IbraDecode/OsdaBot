/**
 * Pemformat tampilan untuk Dasbor OSDA.
 *
 * Catatan: paket `@osda/contracts` juga menyediakan `formatRupiah` dan
 * `formatTanggal`, tetapi modul tersebut menarik `zod` ke bundel klien.
 * Karena dasbor hanya perlu menampilkan angka & tanggal,format yang sama
 * diulang di sini agar bundel tetap ramping. Zona waktu mengikuti kontrak:
 * Asia/Makassar (WITA).
 */

const ZONA_WAKTU = 'Asia/Makassar';

const formatAngka = new Intl.NumberFormat('id-ID');
const formatUang = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});
const formatTanggalPanjang = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeZone: ZONA_WAKTU,
});
const formatTanggalPendek = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: ZONA_WAKTU,
});
const formatWaktu = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: ZONA_WAKTU,
});
const formatJamPendek = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: '2-digit',
  timeZone: ZONA_WAKTU,
});

/** Angka biasa: 1234567 → "1.234.567". */
export function angka(nilai: number): string {
  return formatAngka.format(nilai);
}

/** Nominal rupiah: 1500000 → "Rp1.500.000". */
export function rupiah(nilai: number): string {
  return formatUang.format(nilai);
}

/** Persentase singkat: 82.4 → "82,4%". */
export function persen(nilai: number, maksimalDesimal = 1): string {
  return `${new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: maksimalDesimal,
  }).format(nilai)}%`;
}

/** Tanggal panjang Indonesia: "9 Oktober 2026". */
export function tanggal(nilai: string | null | undefined): string {
  if (!nilai) return '—';
  const tanggalObjek = new Date(nilai);
  if (Number.isNaN(tanggalObjek.getTime())) return '—';
  return formatTanggalPanjang.format(tanggalObjek);
}

/** Tanggal pendek Indonesia: "09 Okt 2026". */
export function tanggalPendek(nilai: string | null | undefined): string {
  if (!nilai) return '—';
  const tanggalObjek = new Date(nilai);
  if (Number.isNaN(tanggalObjek.getTime())) return '—';
  return formatTanggalPendek.format(tanggalObjek);
}

/** Waktu lokal: "08.30". */
export function waktu(nilai: string | null | undefined): string {
  if (!nilai) return '—';
  const tanggalObjek = new Date(nilai);
  if (Number.isNaN(tanggalObjek.getTime())) return '—';
  return formatWaktu.format(tanggalObjek);
}

/** Gabungan tanggal + waktu: "09 Okt 2026 08.30". */
export function tanggalWaktu(nilai: string | null | undefined): string {
  if (!nilai) return '—';
  const tanggalObjek = new Date(nilai);
  if (Number.isNaN(tanggalObjek.getTime())) return '—';
  return `${formatTanggalPendek.format(tanggalObjek)} ${formatWaktu.format(tanggalObjek)}`;
}

/** Waktu saja untuk string "HH:mm" dari API. */
export function jamSaja(nilai: string | null | undefined): string {
  if (!nilai) return '—';
  return nilai.slice(0, 5);
}

/** Sisa hari terhadap hari ini: "-2" berarti terlambat 2 hari. */
export function sisaHari(nilai: string | null | undefined): number | null {
  if (!nilai) return null;
  const tujuan = new Date(nilai).getTime();
  if (Number.isNaN(tujuan)) return null;
  const hariIni = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((tujuan - hariIni) / 86_400_000);
}

/** Label sisa hari yang enak dibaca: "3 hari lagi", "terlambat 2 hari". */
export function labelSisaHari(nilai: string | null | undefined): string {
  const sisa = sisaHari(nilai);
  if (sisa === null) return '—';
  if (sisa === 0) return 'hari ini';
  if (sisa === 1) return 'besok';
  if (sisa > 1) return `${sisa} hari lagi`;
  return `terlambat ${Math.abs(sisa)} hari`;
}

/** Inisial nama untuk avatar teks: "Favian Rapha" → "FR". */
export function inisial(nama: string): string {
  const bagian = nama
    .split(' ')
    .map((kata) => kata.trim())
    .filter((kata) => kata.length > 0);
  if (bagian.length === 0) return '?';
  const pertama = bagian[0] ?? '';
  if (bagian.length === 1) return pertama.slice(0, 2).toUpperCase();
  const kedua = bagian[1] ?? '';
  return `${pertama.charAt(0)}${kedua.charAt(0)}`.toUpperCase();
}

/** Ubah status teknis menjadi label ramah: "IN_PROGRESS" → "Sedang dikerjakan". */
export function labelStatus(status: string): string {
  const peta: Readonly<Record<string, string>> = {
    ACTIVE: 'Aktif',
    INACTIVE: 'Tidak aktif',
    ALUMNI: 'Alumni',
    SUSPENDED: 'Diskors',
    REMOVED: 'Dikeluarkan',
    PENDING: 'Menunggu',
    APPROVED: 'Disetujui',
    REJECTED: 'Ditolak',
    POSTED: 'Tercatat',
    DRAFT: 'Draf',
    REVIEW: 'Ditinjau',
    SCHEDULED: 'Terjadwal',
    ONGOING: 'Berlangsung',
    COMPLETED: 'Selesai',
    CANCELLED: 'Dibatalkan',
    OPEN: 'Dibuka',
    CLOSED: 'Ditutup',
    RUNNING: 'Berjalan',
    PLANNED: 'Direncanakan',
    PROPOSED: 'Diajukan',
    TODO: 'Belum mulai',
    IN_PROGRESS: 'Sedang dikerjakan',
    BLOCKED: 'Terhambat',
    DONE: 'Selesai',
    UNVERIFIED: 'Belum diverifikasi',
    VERIFIED: 'Terverifikasi',
    PUBLISHED: 'Terbit',
    ARCHIVED: 'Diarsipkan',
    ON: 'Aktif',
    OFF: 'Nonaktif',
    PAID: 'Dibayar',
    SUBMITTED: 'Diajukan',
  };
  return peta[status] ?? status;
}
