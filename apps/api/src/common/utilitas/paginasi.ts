/**
 * Pembungkus hasil daftar agar konsisten dengan kontrak `HasilDaftar<T>`
 * (`{ data, meta: { page, limit, total, totalPages, hasNext, hasPrev } }`).
 */
import { bungkusDaftar, type HasilDaftar, type Paginasi } from '@osda/contracts';

export { bungkusDaftar };
export type { HasilDaftar, Paginasi };

/** Hitung offset dari parameter halaman. */
export function offsetDari(paginasi: Paginasi): number {
  return (paginasi.page - 1) * paginasi.limit;
}

/** Susun hasil daftar lengkap dengan metadata halaman. */
export function bungkusHasil<T>(data: readonly T[], total: number, paginasi: Paginasi): HasilDaftar<T> {
  return bungkusDaftar([...data], total, paginasi);
}
