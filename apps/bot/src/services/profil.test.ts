import { describe, expect, it } from 'vitest';

import { normalisasiKelas, pecahNamaKelas, profilDariMasukan } from './profil.js';

describe('pecahNamaKelas', () => {
  it('memisahkan nama dan kelas', () => {
    expect(pecahNamaKelas('Ibra Ramdan X TKJ 3')).toEqual({
      nama: 'Ibra Ramdan',
      kelas: 'X TKJ 3',
    });
  });

  it('menandai kelas mulai dari kata "kelas" (dibuang saat normalisasi)', () => {
    expect(pecahNamaKelas('Muhammad Ibra Ramdan kelas X TKJ 3')?.kelas).toBe('kelas X TKJ 3');
  });

  it('menolak masukan tanpa penanda kelas', () => {
    expect(pecahNamaKelas('Ibra Ramdan')).toBeNull();
  });

  it('menolak masukan kosong', () => {
    expect(pecahNamaKelas('   ')).toBeNull();
  });
});

describe('normalisasiKelas', () => {
  it('mengubah romawi menjadi angka angkatan', () => {
    expect(normalisasiKelas('XI AKL 1')).toBe('11 AKL 1');
    expect(normalisasiKelas('XII MPK')).toBe('12 MPK');
    expect(normalisasiKelas('X TKJ 3')).toBe('10 TKJ 3');
  });

  it('membuang kata pembuka kelas', () => {
    expect(normalisasiKelas('kelas X TKJ 3')).toBe('10 TKJ 3');
  });

  it('mempendekkan nama jurusan panjang', () => {
    expect(normalisasiKelas('XI teknik komputer dan jaringan 2')).toBe('11 TKJ 2');
  });
});

describe('profilDariMasukan', () => {
  it('membaca format "Nama Kelas"', () => {
    expect(profilDariMasukan('Ibra Ramdan X TKJ 3')).toEqual({
      nama: 'Ibra Ramdan',
      tingkat: 'X',
      jurusan: 'TKJ',
      subKelas: '3',
      labelKelas: 'X TKJ 3',
    });
  });

  it('membaca romawi XI/XII dengan benar', () => {
    expect(profilDariMasukan('Reva Nur XI AKL 1')?.labelKelas).toBe('XI AKL 1');
    expect(profilDariMasukan('Favian Rizky XII MPK')?.labelKelas).toBe('XII MPK 1');
  });

  it('sub-kelas kosong diisi 1 (aturan kontrak)', () => {
    expect(profilDariMasukan('Sari Melati XI AKL')?.subKelas).toBe('1');
  });

  it('membaca masukan yang ditulis dengan kata "kelas"', () => {
    expect(profilDariMasukan('Muhammad Ibra Ramdan kelas X TKJ 3')?.labelKelas).toBe('X TKJ 3');
  });

  it('menolak masukan tanpa kelas', () => {
    expect(profilDariMasukan('Ibra Ramdan')).toBeNull();
  });
});
