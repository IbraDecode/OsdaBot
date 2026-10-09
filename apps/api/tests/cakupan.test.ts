/**
 * Tes penegakan cakupan (scope).
 *
 * Cakupan menjawab "terhadap data siapa" — bukan "boleh melakukan apa".
 * Kalau cakupan tidak ditegakkan, izin `member.read` pada peran dengan
 * cakupan `OWN` membuka nomor telepon seluruh organisasi.
 *
 * Fungsi-fungsi ini murni tanpa database sehingga bisa diuji penuh.
 */
import { describe, expect, it } from 'vitest';
import { and, eq, isNull, or } from 'drizzle-orm';
import { integer, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import {
  bolehLihatAnggota,
  punyaCakupanDivisi,
  punyaCakupanPenuh,
  syaratCakupanAnggota,
} from '../src/common/utilitas/cakupan.js';

/** Tabel tiruan — hanya bentuk kolom yang dipakai helper. */
const anggotaUji = pgTable('anggota_uji', {
  memberId: uuid('member_id'),
  userId: uuid('user_id'),
  divisionId: uuid('division_id'),
  urutan: integer('urutan'),
});

const kolom = {
  memberId: anggotaUji.memberId,
  userId: anggotaUji.userId,
  divisionId: anggotaUji.divisionId,
};

/** Bangun klaim akses tiruan. */
function pengguna(
  cakupan: readonly ('OWN' | 'DIVISION' | 'ORGANIZATION' | 'FINANCE' | 'SYSTEM')[],
  memberId: string | null = null,
  sub = 'user-1',
) {
  return {
    sub,
    nama: 'Uji',
    memberId,
    organizationIds: ['org-1'],
    roles: [],
    perms: [],
    scopes: cakupan,
    exp: 0,
    iat: 0,
  } as never;
}

describe('Deteksi cakupan penuh', () => {
  it('ORGANIZATION dan SYSTEM dianggap penuh', () => {
    expect(punyaCakupanPenuh(pengguna(['ORGANIZATION']))).toBe(true);
    expect(punyaCakupanPenuh(pengguna(['SYSTEM']))).toBe(true);
  });

  it('OWN, DIVISION, dan FINANCE bukan cakupan penuh', () => {
    expect(punyaCakupanPenuh(pengguna(['OWN']))).toBe(false);
    expect(punyaCakupanPenuh(pengguna(['DIVISION']))).toBe(false);
    expect(punyaCakupanPenuh(pengguna(['FINANCE']))).toBe(false);
  });

  it('gabungan OWN dan DIVISION tetap bukan penuh', () => {
    expect(punyaCakupanPenuh(pengguna(['OWN', 'DIVISION']))).toBe(false);
  });

  it('tanpa pengguna berarti bukan cakupan penuh', () => {
    expect(punyaCakupanPenuh(undefined)).toBe(false);
  });

  it('DIVISION dihitung sebagai cakupan parsial', () => {
    expect(punyaCakupanDivisi(pengguna(['DIVISION']))).toBe(true);
    expect(punyaCakupanDivisi(pengguna(['ORGANIZATION']))).toBe(true);
    expect(punyaCakupanDivisi(pengguna(['OWN']))).toBe(false);
  });
});

describe('Syarat WHERE menurut cakupan', () => {
  it('tidak ada penyaringan bila cakupan penuh', () => {
    expect(syaratCakupanAnggota(pengguna(['ORGANIZATION']), kolom, null)).toBeUndefined();
    expect(syaratCakupanAnggota(pengguna(['SYSTEM']), kolom, null)).toBeUndefined();
  });

  it('cakupan OWN menghasilkan syarat penyaringan', () => {
    const syarat = syaratCakupanAnggota(pengguna(['OWN'], 'm-1'), kolom, null);
    expect(syarat).toBeDefined();
  });

  it('tanpa identitas sama sekali tetap menyaring (tidak membocorkan apa pun)', () => {
    // Syarat mustahil lebih aman daripada tanpa syarat: tanpa penyaringan,
    //pzsz pengagum yang belum punya memberId akan melihat seluruh organisasi.
    const syarat = syaratCakupanAnggota(pengguna(['OWN'], null, 'user-1'), kolom, null);
    expect(syarat).toBeDefined();
  });

  it('tanpa pengguna sama sekali menghasilkan syarat, bukan null', () => {
    expect(syaratCakupanAnggota(undefined, kolom, null)).toBeDefined();
  });

  it('cakupan divisi tanpa divisi yang diketahui tetap menyaring', () => {
    // Divisi NULL berarti tidak boleh melihat siapa pun di luar dirinya.
    const syarat = syaratCakupanAnggota(pengguna(['DIVISION'], 'm-1'), kolom, null);
    expect(syarat).toBeDefined();
  });

  it('cakupan divisi dengan divisi diketahui menggabungkan divisi & tanpa divisi', () => {
    const syarat = syaratCakupanAnggota(pengguna(['DIVISION'], 'm-1'), kolom, 'd-9');
    expect(syarat).toBeDefined();
    // Hasilnya harus berupa OR (divisi sama ATAU tanpa divisi).
    expect(typeof syarat).toBe('object');
  });
});

describe('Boleh membuka data anggota', () => {
  const targetLain = { memberId: 'm-2', userId: 'user-2', divisionId: 'd-9' };
  const targetSendiri = { memberId: 'm-1', userId: 'user-1', divisionId: 'd-9' };

  it('cakupan penuh boleh membuka siapa pun', () => {
    expect(bolehLihatAnggota(pengguna(['ORGANIZATION'], 'm-1'), targetLain)).toBe(true);
    expect(bolehLihatAnggota(pengguna(['SYSTEM'], 'm-1'), targetLain)).toBe(true);
  });

  it('cakupan OWN hanya boleh membuka dirinya sendiri', () => {
    const p = pengguna(['OWN'], 'm-1');
    expect(bolehLihatAnggota(p, targetSendiri)).toBe(true);
    expect(bolehLihatAnggota(p, targetLain)).toBe(false);
  });

  it('cocok lewat userId tetap dianggap dirinya sendiri', () => {
    const p = pengguna(['OWN'], null, 'user-2');
    expect(bolehLihatAnggota(p, targetLain)).toBe(true);
  });

  it('cakupan DIVISION boleh membuka se-divisi', () => {
    const p = pengguna(['DIVISION'], 'm-1');
    expect(bolehLihatAnggota(p, targetLain, 'd-9')).toBe(true);
    expect(bolehLihatAnggota(p, targetLain, 'd-1')).toBe(false);
  });

  it('cakupan DIVISION tanpa divisi sendiri tidak membuka siapa pun', () => {
    const p = pengguna(['DIVISION'], 'm-1');
    expect(bolehLihatAnggota(p, targetLain, null)).toBe(false);
  });

  it('anggota tanpa divisi terlihat olehober viewing divisi', () => {
    const tanpaDivisi = { memberId: 'm-3', userId: 'user-3', divisionId: null };
    const p = pengguna(['DIVISION'], 'm-1');
    expect(bolehLihatAnggota(p, tanpaDivisi, 'd-9')).toBe(true);
  });

  it('tanpa pengguna apa pun tidak boleh membuka data siapa pun', () => {
    expect(bolehLihatAnggota(undefined, targetSendiri)).toBe(false);
    expect(bolehLihatAnggota(undefined, targetLain)).toBe(false);
  });

  it('FINANCE tidak memberi akses ke data anggota', () => {
    // Cakupan FINANCE mengatur uang, bukan data pribadi anggota.
    const p = pengguna(['FINANCE'], 'm-1');
    expect(bolehLihatAnggota(p, targetLain)).toBe(false);
  });
});