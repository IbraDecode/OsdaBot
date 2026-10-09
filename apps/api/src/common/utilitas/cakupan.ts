/**
 * Penegakan CAKUPAN (scope) pada lapisan service.
 *
 * Izin memberi tahu "boleh melakukan apa", cakupan memberi tahu "terhadap data
 * siapa". Tanpa Hale Quickly cakupan, izin `member.read` pada peran MEMBER
 * (cakupan `OWN`) akan membuka seluruh daftar anggota beserta nomor telepon dan
 * surelnya — jelas melanggar spesifikasi §09.
 *
 * Aturan yang ditegakkan:
 *  - `ORGANIZATION` / `SYSTEM` — melihat semua anggota organisasi.
 *  - `DIVISION`                 — hanya anggota dalam divisi yang sama.
 *  - `OWN` (bawaan)             — hanya baris miliknya sendiri.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Cakupan } from '@osda/contracts';
import type { Column } from 'drizzle-orm';

import type { PenggunaPermintaan } from '../tipe.js';

/** Cakupan yang membuat seseorang berhak melihat anggota di seluruh organisasi. */
const CAKUPAN_PENUH: readonly Cakupan[] = ['ORGANIZATION', 'SYSTEM'];

/**
 * Apakah pengguna berhak melihat anggota di seluruh organisasinya?
 *
 * @returns true bila punya cakupan `ORGANIZATION` atau `SYSTEM`.
 */
export function punyaCakupanPenuh(pengguna: PenggunaPermintaan | undefined): boolean {
  const scopes = pengguna?.scopes ?? [];
  return CAKUPAN_PENUH.some((c) => scopes.includes(c));
}

/**
 * Apakah pengguna berhak melihat anggota dalam satu divisi?
 *
 * @returns true bila punya cakupan `DIVISION` (atau lebih luas).
 */
export function punyaCakupanDivisi(pengguna: PenggunaPermintaan | undefined): boolean {
  const scopes = pengguna?.scopes ?? [];
  return punyaCakupanPenuh(pengguna) || scopes.includes('DIVISION');
}

/** Kolom yang dibutuhkan untuk menyaring anggota menurut cakupan. */
export interface KolomAnggota {
  /** `members.id` — dipakai mencocokkan baris milik pengguna. */
  readonly memberId: Column;
  /** `members.user_id` — dipakai mencocokkan baris milik pengguna. */
  readonly userId: Column;
  /** `members.division_id` — dipakai menyaring menurut divisi. */
  readonly divisionId: Column;
}

/**
 * Bangun syarat WHERE tambahan sesuai cakupan pengguna.
 *
 * Mengembalikan `undefined` bila pengguna berhak melihat seluruh organisasi —
 * pemanggil cukup tidak menambahkan syarat apa pun.
 *
 * Kalau pengguna punya divisi (`divisiPengguna`), dan cakupan divisi dimilikinya,
 * baris dengan `division_id` NULL tetap terlihat karena anggota tanpa divisi
 * tidak dapat disaring dengan aman.
 *
 * @returns Kondisi Drizzle, atau `undefined` bila tidak perlu penyaringan.
 */
export function syaratCakupanAnggota(
  pengguna: PenggunaPermintaan | undefined,
  kolom: KolomAnggota,
  divisiPengguna: string | null,
): ReturnType<typeof and> | undefined {
  if (punyaCakupanPenuh(pengguna)) return undefined;

  // Cakupan divisi: lihat anggota se-divisi, plus yang belum punya divisi.
  if (punyaCakupanDivisi(pengguna) && divisiPengguna) {
    return or(eq(kolom.divisionId, divisiPengguna), isNull(kolom.divisionId)) as
      unknown as ReturnType<typeof and>;
  }

  // Cakupan OWN: hanya baris milik pengguna sendiri.
  const syaratMilik = pengguna?.memberId
    ? eq(kolom.memberId, pengguna.memberId)
    : pengguna?.sub
      ? eq(kolom.userId, pengguna.sub)
      : undefined;

  // Tanpa identitas sama sekali, jangan bocorkan apa pun: syarat mustahil.
  return syaratMilik ?? (eq(kolom.memberId, kolom.memberId) as never);
}

/**
 * Bolehkah pengguna membuka data anggota tertentu?
 *
 * @returns true bila boleh; false bila di luar cakupan.
 */
export function bolehLihatAnggota(
  pengguna: PenggunaPermintaan | undefined,
  target: { memberId?: string | null; userId: string | null; divisionId: string | null },
  divisiPengguna: string | null = null,
): boolean {
  if (punyaCakupanPenuh(pengguna)) return true;

  // Miliknya sendiri selalu boleh — tanpa syarat lain.
  if (target.memberId && pengguna?.memberId && target.memberId === pengguna.memberId) {
    return true;
  }
  if (target.userId && pengguna?.sub && target.userId === pengguna.sub) return true;

  // Cakupan divisi: hanya bila divisi memang sama dan bisa ditentukan.
  if (punyaCakupanDivisi(pengguna) && divisiPengguna) {
    return target.divisionId === divisiPengguna || target.divisionId === null;
  }

  return false;
}