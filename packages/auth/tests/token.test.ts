/**
 * Tes utilitas autentikasi.
 *
 * Fokus: hash token harus deterministik, perbandingan harus tahan timing,
 * dan token yang dihasilkan harus cukup kuat serta tidak mengandung karakter
 * yang mudah tertukar saat diketik manual.
 */
import { describe, expect, it } from 'vitest';

import {
  buatTokenAcak,
  hashToken,
  kodeAcak,
  samakanToken,
  satukanIzinBawaan,
  uuidAcak,
  kedaluwarsaDari,
} from '../src/index.js';

describe('Token acak', () => {
  it('menghasilkan token yang berbeda tiap dipanggil', () => {
    const kumpulan = new Set(Array.from({ length: 50 }, () => buatTokenAcak()));
    expect(kumpulan.size).toBe(50);
  });

  it('memiliki panjang minimal 32 karakter', () => {
    expect(buatTokenAcak().length).toBeGreaterThanOrEqual(32);
  });

  it('hanya memuat karakter aman URL', () => {
    // Token masuk ke URL dan header, sehingga harus aman keduanya.
    expect(buatTokenAcak()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('Hash token', () => {
  it('deterministik: token sama menghasilkan hash sama', () => {
    expect(hashToken('token-abc')).toBe(hashToken('token-abc'));
  });

  it('berbeda untuk token berbeda', () => {
    expect(hashToken('token-abc')).not.toBe(hashToken('token-xyz'));
  });

  it('menghasilkan hash sepanjang 64 hex (SHA-256)', () => {
    expect(hashToken('apa saja')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('tidak menyimpan token mentah di dalam hash', () => {
    const token = 'rahasia-super-panjang';
    expect(hashToken(token)).not.toContain(token);
  });

  it('hash dari string kosong tetap valid', () => {
    expect(hashToken('')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Perbandingan token', () => {
  it('benar untuk hash yang sama', () => {
    const h = hashToken('token-sama');
    expect(samakanToken(h, h)).toBe(true);
  });

  it('salah untuk hash yang berbeda', () => {
    expect(samakanToken(hashToken('a'), hashToken('b'))).toBe(false);
  });

  it('menangani hash dengan panjang berbeda tanpa melempar galat', () => {
    expect(samakanToken('abc', 'abcd')).toBe(false);
  });

  it('menangani hash kosong', () => {
    expect(samakanToken('', '')).toBe(true);
  });
});

describe('Kode acak untuk account linking', () => {
  it('menghasilkan kode sepanjang yang diminta', () => {
    expect(kodeAcak()).toHaveLength(8);
    expect(kodeAcak(12)).toHaveLength(12);
  });

  it('tidak memuat karakter yang mudah tertukar (O/0 dan I/1)', () => {
    // Alfabet: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
    // Huruf I dan O serta angka 0 dan 1 sengaja dihilangkan karena mudah
    // tertukar saat dibaca atau diketik manual.
    for (let i = 0; i < 500; i++) {
      expect(kodeAcak(12)).not.toMatch(/[IO01]/);
    }
  });

  it('hanya memuat huruf besar dan angka', () => {
    expect(kodeAcak(16)).toMatch(/^[A-Z0-9]+$/);
  });

  it('berbeda antar pemanggilan', () => {
    const kumpulan = new Set(Array.from({ length: 200 }, () => kodeAcak()));
    expect(kumpulan.size).toBeGreaterThan(150);
  });
});

describe('UUID acak', () => {
  it('tanpa tanda hubung dan panjang 32 hex', () => {
    expect(uuidAcak()).toMatch(/^[a-f0-9]{32}$/);
  });

  it('berbeda tiap pemanggilan', () => {
    expect(uuidAcak()).not.toBe(uuidAcak());
  });
});

describe('Kedaluwarsa', () => {
  it('menambah durasi dari waktu acuan', () => {
    const dari = new Date('2026-01-01T00:00:00Z');
    const hasil = kedaluwarsaDari(60_000, dari);
    expect(hasil.toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });
});

describe('Satukan izin bawaan', () => {
  it('menggabungkan izin dari beberapa peran tanpa duplikat', () => {
    const hasil = satukanIzinBawaan(['CHAIRPERSON', 'TREASURER']);
    expect(hasil.izin.length).toBeGreaterThan(0);
    expect(new Set(hasil.izin).size).toBe(hasil.izin.length);
  });

  it('cakupan digabungkan unik', () => {
    const hasil = satukanIzinBawaan(['MEMBER', 'TREASURER']);
    expect(new Set(hasil.cakupan).size).toBe(hasil.cakupan.length);
  });

  it('peran dengan lebih banyak izin memberi superset yang lebih besar', () => {
    const anggota = satukanIzinBawaan(['MEMBER']);
    const ketua = satukanIzinBawaan(['CHAIRPERSON']);
    expect(ketua.izin.length).toBeGreaterThan(anggota.izin.length);
  });

  it('peran tak dikenal menghasilkan daftar kosong, bukan galat', () => {
    const hasil = satukanIzinBawaan(['PERAN_TIDAK_ADA' as never]);
    expect(hasil.izin).toEqual([]);
  });
});
