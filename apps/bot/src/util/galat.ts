/**
 * Utilitas galat — mengubah galat menjadi informasi yang aman untuk pengguna.
 */
import { KesalahanApi } from '../api/client.js';

/**
 * Kode galat yang aman ditampilkan ke anggota.
 * Detail internal (stack, pesan server) tidak pernah dikirim ke WhatsApp.
 */
export function kodeGalat(galat: unknown): string | undefined {
  if (galat instanceof KesalahanApi) return galat.kode;
  return undefined;
}

/** Pesan singkat untuk log (tanpa membocorkan data sensitif). */
export function pesanGalatSingkat(galat: unknown): string {
  if (galat instanceof KesalahanApi) return `${galat.kode} (${galat.status})`;
  if (galat instanceof Error) return galat.message;
  return String(galat);
}
