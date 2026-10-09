/**
 * Pembangkit kode internal (nomor anggota, kode transaksi, kode pengajuan,
 * kunci idempotensi). Kode dibuat di aplikasi agar terbaca manusia, tetapi
 * keunikan tetap ditegakkan oleh unique index di database.
 */
import { customAlphabet } from 'nanoid';

const abjadKode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 6);

/** Awalan tetap + angka acak, mis. `TRX-4F2K9Q`. */
export function kodeDenganAwalan(awalan: string): string {
  return `${awalan}-${abjadKode()}`;
}

/** Nomor anggota manusiawi, mis. `M-0007`. */
export function nomorAnggota(urutan: number): string {
  return `M-${String(urutan).padStart(4, '0')}`;
}

/** Kode tugas berdasarkan tahun & urutan, mis. `TUG-2026-0012`. */
export function kodeTugas(tahun: number, urutan: number): string {
  return `TUG-${tahun}-${String(urutan).padStart(4, '0')}`;
}

/** Kode transaksi kas, mis. `TRX-2026-0012`. */
export function kodeTransaksi(tahun: number, urutan: number): string {
  return `TRX-${tahun}-${String(urutan).padStart(4, '0')}`;
}

/** Kode pengajuan, mis. `PGJ-2026-0012`. */
export function kodePengajuan(tahun: number, urutan: number): string {
  return `PGJ-${tahun}-${String(urutan).padStart(4, '0')}`;
}

/** Kode reimbursement, mis. `RMB-2026-0012`. */
export function kodeReimbursement(tahun: number, urutan: number): string {
  return `RMB-${tahun}-${String(urutan).padStart(4, '0')}`;
}

/** Kode pembayaran, mis. `PAY-4F2K9Q`. */
export function kodePembayaran(): string {
  return kodeDenganAwalan('PAY');
}

/** Referensi provider palsu untuk mode tanpa integrasi payment gateway. */
export function referensiProvider(): string {
  return `REF-${abjadKode()}${Date.now().toString(36).toUpperCase()}`;
}

/** Kunci idempotensi bawaan bila klien tidak mengirim. */
export function kunciIdempotensi(awalan: string): string {
  return `${awalan}-${Date.now().toString(36)}-${abjadKode()}`;
}
