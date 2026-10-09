/**
 * Aturan domain OSDA.
 *
 * Alur status (state machine) didefinisikan tunggal di `@osda/contracts`.
 * Paket ini mengeksposnya sebagai lapisan domain beserta perhitungan kecil
 * yang dipakai berulang oleh API (tenggat, progres, persentase).
 */
export {
  bolehTransisiProgram,
  bolehTransisiTugas,
  TRANSISI_KOREKSI_PROGRAM,
  TRANSISI_PROGRAM,
  TRANSISI_TUGAS,
} from '@osda/contracts';

/** Sisa hari terhadap tanggal acuan (negatif = sudah lewat). */
export function hariTersisa(batas: string | Date, acuan: Date = new Date()): number {
  const a = typeof batas === 'string' ? new Date(batas) : batas;
  const ms = a.getTime() - acuan.getTime();
  return Math.ceil(ms / 86_400_000);
}

/** Apakah tenggat sudah terlewati (dihitung dari tanggal, bukan jam). */
export function sudahLewat(batas: string | Date, acuan: Date = new Date()): boolean {
  const a = typeof batas === 'string' ? new Date(batas) : batas;
  return acuan.getTime() > a.getTime();
}

/** Persentase aman (0–100) tanpa pembagian nol. */
export function persenDari(pembilang: number, penyebut: number): number {
  if (!penyebut) return 0;
  return Math.min(100, Math.max(0, Math.round((pembilang / penyebut) * 100)));
}

/** Tanggal hari ini dalam format YYYY-MM-DD. */
export function tanggalHariIni(acuan: Date = new Date()): string {
  return acuan.toISOString().slice(0, 10);
}

/** Awal bulan & akhir bulan dari tanggal acuan. */
export function rentangBulan(acuan: Date = new Date()): { dari: string; sampai: string } {
  const awal = new Date(Date.UTC(acuan.getUTCFullYear(), acuan.getUTCMonth(), 1));
  const akhir = new Date(Date.UTC(acuan.getUTCFullYear(), acuan.getUTCMonth() + 1, 0));
  return { dari: awal.toISOString().slice(0, 10), sampai: akhir.toISOString().slice(0, 10) };
}
