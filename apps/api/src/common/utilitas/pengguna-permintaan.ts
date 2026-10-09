/**
 * Helper membaca pengguna yang sedang login dari objek permintaan.
 *
 * Passport menempelkan hasil `validate()` pada `request.user`. Sebagian guard
 * saling menyalinnya ke `request.pengguna` agar lebih eksplisit. Helper ini
 * menerima KEDUANYA supaya tidak ada guard yang salah membaca dan keliru
 * mengembalikan 401 padahal pengguna sudah masuk.
 */
import type { PenggunaPermintaan } from '../tipe.js';

/** Bentuk minimal permintaan yang sudah dilewati `JwtAuthGuard`. */
interface PermintaanBerpengguna {
  user?: PenggunaPermintaan;
  pengguna?: PenggunaPermintaan;
}

/** Ambil pengguna yang sedang login, atau `undefined` bila belum masuk. */
export function ambilPengguna(
  permintaan: PermintaanBerpengguna | undefined,
): PenggunaPermintaan | undefined {
  return permintaan?.user ?? permintaan?.pengguna;
}
