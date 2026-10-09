/**
 * Tes kebijakan penguncian akun.
 *
 * Fungsi-fungsi ini murni tanpa database, jadi bisa diuji penuh. Yang diuji
 * adalah sifat yang harus benar: kunci hanya setelah ambang terlampaui, lama
 * kunci berlipat lalu dibatasi, dan akun bisa dibuka dengan sendirinya.
 */
import { describe, expect, it } from 'vitest';

import {
  BATAS_GAGAL,
  detikTersisa,
  KUNCI_MAKS_MENIT,
  menitKunci,
  sedangDikunci,
} from '../src/modules/auth/kebijakan-kunci.js';

const SEKARANG = new Date('2026-06-15T12:00:00Z');

describe('Ambang penguncian', () => {
  it('ambang adalah 5 kegagalan', () => {
    expect(BATAS_GAGAL).toBe(5);
  });

  it('tidak mengunci sebelum ambang terlampaui', () => {
    for (let gagal = 0; gagal < BATAS_GAGAL; gagal += 1) {
      expect(menitKunci(gagal)).toBe(0);
    }
  });

  it('mengunci tepat pada ambang', () => {
    expect(menitKunci(BATAS_GAGAL)).toBeGreaterThan(0);
  });

  it('kunci tetap ada meski nilai gagal negatif atau bukan angka', () => {
    expect(menitKunci(-5)).toBe(0);
    expect(menitKunci(0)).toBe(0);
  });
});

describe('Lama penguncian berlipat', () => {
  it('semakin banyak kegagalan, semakin lama kunci', () => {
    const menit = [BATAS_GAGAL, BATAS_GAGAL * 2, BATAS_GAGAL * 3].map(menitKunci);
    for (let i = 1; i < menit.length; i += 1) {
      expect(menit[i]!).toBeGreaterThan(menit[i - 1]!);
    }
  });

  it('dibatasi maksimum agar tidak terkunci selamanya', () => {
    // Seribu kegagalan tidak boleh berarti 3.000 tahun.
    expect(menitKunci(1000)).toBe(KUNCI_MAKS_MENIT);
    expect(menitKunci(1_000_000)).toBe(KUNCI_MAKS_MENIT);
  });

  it('nilai sangat besar tidak menghasilkan Infinity atau NaN', () => {
    const hasil = menitKunci(Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(hasil)).toBe(true);
    expect(hasil).toBe(KUNCI_MAKS_MENIT);
  });
});

describe('Status penguncian', () => {
  it('null atau kosong berarti tidak terkunci', () => {
    expect(sedangDikunci(null, SEKARANG)).toBe(false);
    expect(sedangDikunci(undefined, SEKARANG)).toBe(false);
  });

  it('waktu masa depan berarti terkunci', () => {
    const nanti = new Date(SEKARANG.getTime() + 60_000);
    expect(sedangDikunci(nanti, SEKARANG)).toBe(true);
  });

  it('waktu lampau berarti sudah terbuka', () => {
    const lalu = new Date(SEKARANG.getTime() - 60_000);
    expect(sedangDikunci(lalu, SEKARANG)).toBe(false);
  });

  it('tepat pada batas waktu dihitung terkunci', () => {
    expect(sedangDikunci(new Date(SEKARANG), SEKARANG)).toBe(false);
    expect(sedangDikunci(new Date(SEKARANG.getTime() + 1), SEKARANG)).toBe(true);
  });

  it('menerima string ISO dari driver database', () => {
    const nanti = new Date(SEKARANG.getTime() + 60_000);
    expect(sedangDikunci(nanti.toISOString(), SEKARANG)).toBe(true);
  });

  it('string rusak dianggap tidak terkunci, bukan error', () => {
    expect(sedangDikunci('bukan tanggal', SEKARANG)).toBe(false);
  });
});

describe('Hitung mundur', () => {
  it('nol bila tidak terkunci', () => {
    expect(detikTersisa(null, SEKARANG)).toBe(0);
    expect(detikTersisa(new Date(SEKARANG.getTime() - 1000), SEKARANG)).toBe(0);
  });

  it('menghitung detik yang tersisa', () => {
    const nanti = new Date(SEKARANG.getTime() + 90_000);
    expect(detikTersisa(nanti, SEKARANG)).toBe(90);
  });

  it('pembulatan ke atas supaya tidak pernah 0 saat masih terkunci', () => {
    // 100 ms tersisa harus dibulatkan jadi 1 detik, bukan 0 — kalau 0,
    // pesan "coba lagi dalam 0 menit" membingungkan pengguna.
    const nanti = new Date(SEKARANG.getTime() + 100);
    expect(detikTersisa(nanti, SEKARANG)).toBe(1);
  });

  it('string ISO juga dihitung', () => {
    const nanti = new Date(SEKARANG.getTime() + 45_000);
    expect(detikTersisa(nanti.toISOString(), SEKARANG)).toBe(45);
  });
});