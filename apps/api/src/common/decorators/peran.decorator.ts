/**
 * Dekorator `@Peran('SECRETARY')` — pembatas tambahan berbasis peran.
 *
 * Peran BUKAN sumber kebenaran utama: otorisasi akhir selalu memakai
 * izin + cakupan sesuai `@Izin(...)`. Dekorator ini hanya untuk kasus yang
 * memang eksplisit per peran bawaan (mis. audit log khusus SUPER_ADMIN).
 */
import { SetMetadata } from '@nestjs/common';

/** Kunci metadata peran. */
export const KUNCI_PERAN = 'osda:peran-dibutuhkan';

/** Kode peran bawaan yang dikenali sistem. */
export const PERAN_BAWAAN_KODE = [
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

export type KodePeranDekorator = (typeof PERAN_BAWAAN_KODE)[number];

/** Tandai peran bawaan yang boleh mengakses endpoint. */
export const Peran = (...peran: KodePeranDekorator[]) => SetMetadata(KUNCI_PERAN, peran);
