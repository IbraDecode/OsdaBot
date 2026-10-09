/**
 * Penentu ruang kerja (workspace) default pengguna.
 *
 * PENTING: sidebar & menu TIDAK dibangun dari nama peran (hardcode peran),
 * melainkan dari daftar izin efektif pengguna (spec §34). Fungsi di bawah hanya
 * dipakai satu hal: menentukan ruang kerja mana yang ditampilkan lebih dulu
 * agar dasbor awal terasa personal.
 */
import { RUANG_KERJA_PERAN, type KodePeranBawaan } from '@osda/contracts/permissions';

/** Urutan prioritas peran — peran lebih tinggi menentukan ruang kerja. */
const URUTAN_PRIORITAS: readonly KodePeranBawaan[] = [
  'CHAIRPERSON',
  'ADVISOR',
  'SUPER_ADMIN',
  'VICE_CHAIRPERSON',
  'SECRETARY',
  'TREASURER',
  'PR',
  'COORDINATOR',
  'STAFF',
  'MEMBER',
];

/** Label ruang kerja untuk tampilan UI. */
export const LABEL_RUANG_KERJA: Readonly<Record<string, string>> = {
  EXECUTIVE: 'Ruang Kerja Pimpinan',
  OPERATIONS: 'Ruang Kerja Operasional',
  ADMINISTRATION: 'Ruang Kerja Administrasi',
  FINANCE: 'Ruang Kerja Keuangan',
  COMMUNICATION: 'Ruang Kerja Komunikasi',
  DIVISION: 'Ruang Kerja Divisi',
  PERSONAL: 'Ruang Kerja Pribadi',
  SYSTEM: 'Ruang Kerja Sistem',
};

/**
 * Tentukan ruang kerja default dari daftar kode peran pengguna.
 * Bila tidak ada yang cocok, jatuh ke `PERSONAL` (dasbor anggota).
 */
export function ruangKerjaDariPeran(kodePeran: readonly string[]): string {
  const kodeTersedia = new Set(kodePeran.map((kode) => kode.toUpperCase()));
  for (const kode of URUTAN_PRIORITAS) {
    if (kodeTersedia.has(kode)) return RUANG_KERJA_PERAN[kode];
  }
  return 'PERSONAL';
}

/** Label ramah untuk sebuah kode ruang kerja. */
export function labelRuangKerja(ruangKerja: string): string {
  return LABEL_RUANG_KERJA[ruangKerja] ?? ruangKerja;
}
