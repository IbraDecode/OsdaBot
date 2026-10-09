/**
 * Hash token & resolusi izin efektif.
 *
 * Refresh token disimpan HANYA sebagai hash di tabel `sessions`. Token
 * dihasilkan dari sumber acak kriptografis sehingga hash satu arah yang cepat
 * (SHA-256) sudah memadai — berbeda dengan kata sandi manusia yang memakai
 * argon2id.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  MATRICS_PERAN,
  PERAN_BAWAAN,
  type Cakupan,
  type Izin as IzinKontrak,
  type KodePeranBawaan,
} from '@osda/contracts';

/** Buat token acak yang tidak bisa ditebak (256 bit). */
export function buatTokenAcak(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash token untuk penyimpanan (satu arah, deterministik). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Bandingkan dua hash token tanpa bocor informasi lewat waktu eksekusi. */
export function samakanToken(hashA: string, hashB: string): boolean {
  const a = Buffer.from(hashA, 'utf8');
  const b = Buffer.from(hashB, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Kumpulan izin efektif + cakupan yang dimiliki sebuah daftar peran bawaan. */
export interface PaketIzinEfektif {
  readonly izin: readonly IzinKontrak[];
  readonly cakupan: readonly Cakupan[];
}

/**
 * Satukan paket izin bawaan dari beberapa kode peran.
 * Peran yang tidak dikenali diabaikan — sumber kebenaran akhir tetap database.
 */
export function satukanIzinBawaan(
  kodePeran: readonly string[],
): PaketIzinEfektif {
  const izin = new Set<IzinKontrak>();
  const cakupan = new Set<Cakupan>();

  for (const kode of kodePeran) {
    if (!(PERAN_BAWAAN as readonly string[]).includes(kode)) continue;
    const paket = MATRICS_PERAN[kode as KodePeranBawaan];
    for (const i of paket.izin) izin.add(i);
    for (const c of paket.cakupan) cakupan.add(c);
  }

  return { izin: [...izin], cakupan: [...cakupan] };
}
