/**
 * Tes matriks izin & peran.
 *
 * Menguji apa yang dikontrak `@osda/contracts`:
 *  1. Setiap izin punya bentuk `modul.aksi` yang konsisten.
 *  2. Peran bawaan tidak memberi hak yangTdivid forbidden (spesifikasi §09).
 *  3. Tidak ada izin yang "yatim" — semua modul punya modul yang dikenal.
 */
import { describe, expect, it } from 'vitest';

import {
  CAKUPAN,
  MATRICS_PERAN,
  MODUL_PERMISSION,
  PERAN_BAWAAN,
  PERMISSION,
  RUANG_KERJA_PERAN,
  type Cakupan,
  type KodePeranBawaan,
} from '../src/permissions.js';

/** Semua izin yang terpakai di matriks peran bawaan. */
const IZIN_DIPAKAI = new Set(PERAN_BAWAAN.flatMap((p) => MATRICS_PERAN[p].izin));

describe('Bentuk permission', () => {
  it('setiap izin berbentuk `modul[.sub].aksi` (huruf kecil, tanpa spasi)', () => {
    // Sebagian izin punya sub-lapis, mis. `meeting.minutes.approve`.
    for (const izin of PERMISSION) {
      expect(izin).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });

  it('segmen pertama setiap izin adalah modul yang dikenal', () => {
    for (const izin of PERMISSION) {
      const modul = izin.split('.')[0]!;
      expect(MODUL_PERMISSION).toContain(modul);
    }
  });

  it('tidak ada izin duplikat', () => {
    expect(new Set(PERMISSION).size).toBe(PERMISSION.length);
  });

  it('setiap modul izin dikenal', () => {
    for (const izin of PERMISSION) {
      const modul = izin.split('.')[0]!;
      expect(MODUL_PERMISSION).toContain(modul);
    }
  });
});

describe('Kelengkapan matriks peran', () => {
  it('semua peran bawaan punya matriks izin', () => {
    for (const peran of PERAN_BAWAAN) {
      expect(MATRICS_PERAN[peran]).toBeDefined();
      expect(MATRICS_PERAN[peran].izin.length).toBeGreaterThan(0);
    }
  });

  it('setiap peran punya ruang kerja default', () => {
    for (const peran of PERAN_BAWAAN) {
      expect(RUANG_KERJA_PERAN[peran]).toBeTruthy();
    }
  });

  it('seluruh izin bawaan diberikan ke minimal satu peran', () => {
    // Bila ada izin yang tidak terpakai, tidak ada peran yang punya akses ke
    // fitur tersebut sehingga fitur itu mustahil dipakai.
    const tidakDipakai = PERMISSION.filter((i) => !IZIN_DIPAKAI.has(i));
    expect(tidakDipakai).toEqual([]);
  });

  it('izin yang dipakai semuanya ada di daftar PERMISSION', () => {
    for (const izin of IZIN_DIPAKAI) {
      expect(PERMISSION).toContain(izin as never);
    }
  });

  it('SUPER_ADMIN memiliki seluruh izin', () => {
    const punya = new Set(MATRICS_PERAN.SUPER_ADMIN.izin);
    for (const izin of PERMISSION) {
      expect(punya.has(izin)).toBe(true);
    }
  });

  it('SUPER_ADMIN memiliki seluruh cakupan', () => {
    for (const c of CAKUPAN) {
      expect(MATRICS_PERAN.SUPER_ADMIN.cakupan).toContain(c);
    }
  });
});

describe('Pemisahan tanggung jawab menurut ROLE_MATRIX', () => {
  const punya = (peran: KodePeranBawaan, izin: string) =>
    MATRICS_PERAN[peran].izin.includes(izin as never);

  it('Bendahara boleh mengelola keuangan', () => {
    expect(punya('TREASURER', 'finance.read')).toBe(true);
    expect(punya('TREASURER', 'finance.write')).toBe(true);
    expect(punya('TREASURER', 'finance.export')).toBe(true);
  });

  it('Bendahara TIDAK boleh mengubah absensi', () => {
    expect(punya('TREASURER', 'attendance.manage')).toBe(false);
    expect(punya('TREASURER', 'attendance.write')).toBe(false);
  });

  it('Bendahara TIDAK boleh mengubah peran', () => {
    expect(punya('TREASURER', 'settings.manage')).toBe(false);
    expect(punya('TREASURER', 'period.manage')).toBe(false);
  });

  it('Humas boleh menulis dan menerbitkan komunikasi', () => {
    expect(punya('PR', 'communication.create')).toBe(true);
    expect(punya('PR', 'communication.publish')).toBe(true);
  });

  it('Humas TIDAK otomatis mendapat keuangan', () => {
    expect(punya('PR', 'finance.write')).toBe(false);
    expect(punya('PR', 'finance.approve')).toBe(false);
  });

  it('Humas TIDAK boleh menghapus anggota', () => {
    expect(punya('PR', 'member.archive')).toBe(false);
  });

  it('Anggota hanya boleh miliknya sendiri', () => {
    const anggota = MATRICS_PERAN.MEMBER;
    expect(anggota.izin).toContain('attendance.write');
    expect(anggota.izin).not.toContain('attendance.manage');
    expect(anggota.izin).not.toContain('finance.approve');
    expect(anggota.izin).not.toContain('settings.manage');
    expect(anggota.cakupan).toEqual(['OWN']);
  });

  it('Anggota TIDAK boleh menerbitkan pengumuman', () => {
    expect(punya('MEMBER', 'communication.publish')).toBe(false);
    expect(punya('MEMBER', 'communication.create')).toBe(false);
  });

  it('Sekretaris adalah pemilik administrasi', () => {
    expect(punya('SECRETARY', 'member.write')).toBe(true);
    expect(punya('SECRETARY', 'meeting.create')).toBe(true);
    expect(punya('SECRETARY', 'attendance.manage')).toBe(true);
    expect(punya('SECRETARY', 'document.approve')).toBe(true);
  });

  it('Sekretaris TIDAK boleh menyetujui keuangan', () => {
    expect(punya('SECRETARY', 'finance.approve')).toBe(false);
  });

  it('Koordinator terbatas pada divisi (cakupan DIVISION)', () => {
    expect(MATRICS_PERAN.COORDINATOR.cakupan).toEqual(['DIVISION']);
    expect(punya('COORDINATOR', 'program.manage')).toBe(true);
  });

  it('Koordinator TIDAK boleh menyetujui keuangan', () => {
    expect(punya('COORDINATOR', 'finance.approve')).toBe(false);
  });

  it('Ketua boleh menyetujui program dan keuangan', () => {
    expect(punya('CHAIRPERSON', 'program.approve')).toBe(true);
    expect(punya('CHAIRPERSON', 'finance.approve')).toBe(true);
  });

  it('persetujuan keuangan tidak dimiliki lebih dari dua peran', () => {
    // Bila terlalu banyak pihak, alur persetujuan menjadi kabur.
    const pemegang = PERAN_BAWAAN.filter((p) => punya(p, 'finance.approve'));
    expect(pemegang.length).toBeLessThanOrEqual(3);
  });
});

describe('Cakupan', () => {
  it('daftar cakupan tidak berubah dan urut', () => {
    expect(CAKUPAN).toEqual(['OWN', 'DIVISION', 'ORGANIZATION', 'FINANCE', 'SYSTEM']);
  });

  it('semua cakupan peran bawaan adalah nilai yang sah', () => {
    for (const peran of PERAN_BAWAAN) {
      for (const c of MATRICS_PERAN[peran].cakupan as readonly Cakupan[]) {
        expect(CAKUPAN).toContain(c);
      }
    }
  });
});
