/**
 * Tes aturan domain OSDA.
 *
 * Fokus: alur status (state machine), perhitungan tenggat, dan persentase.
 * Ini bagian yang paling mudah regresi dan paling mahal dampaknya bila salah.
 */
import { describe, expect, it } from 'vitest';

import {
  bolehTransisiProgram,
  bolehTransisiTugas,
  persenDari,
  sudahLewat,
  hariTersisa,
  tanggalHariIni,
  TRANSISI_PROGRAM,
  TRANSISI_TUGAS,
} from '../src/aturan.js';

describe('Alur status tugas', () => {
  it('TODO boleh langsung ke IN_PROGRESS', () => {
    expect(bolehTransisiTugas('TODO', 'IN_PROGRESS')).toBe(true);
  });

  it('TODO boleh ke BLOCKED dan CANCELLED', () => {
    expect(bolehTransisiTugas('TODO', 'BLOCKED')).toBe(true);
    expect(bolehTransisiTugas('TODO', 'CANCELLED')).toBe(true);
  });

  it('TODO tidak boleh langsung ke DONE (harus dikerjakan dulu)', () => {
    expect(bolehTransisiTugas('TODO', 'DONE')).toBe(false);
  });

  it('IN_PROGRESS boleh ke DONE', () => {
    expect(bolehTransisiTugas('IN_PROGRESS', 'DONE')).toBe(true);
  });

  it('DONE boleh dikembalikan ke IN_PROGRESS untuk perbaikan', () => {
    expect(bolehTransisiTugas('DONE', 'IN_PROGRESS')).toBe(true);
  });

  it('DONE tidak boleh langsung ke CANCELLED', () => {
    expect(bolehTransisiTugas('DONE', 'CANCELLED')).toBe(false);
  });

  it('CANCELLED hanya boleh hidup kembali ke TODO', () => {
    expect(bolehTransisiTugas('CANCELLED', 'TODO')).toBe(true);
    expect(bolehTransisiTugas('CANCELLED', 'DONE')).toBe(false);
    expect(bolehTransisiTugas('CANCELLED', 'IN_PROGRESS')).toBe(false);
  });

  it('seluruh status punya aturan transisi yang terdefinisi', () => {
    for (const status of Object.keys(TRANSISI_TUGAS)) {
      expect(Array.isArray(TRANSISI_TUGAS[status as keyof typeof TRANSISI_TUGAS])).toBe(true);
    }
  });
});

describe('Alur status program', () => {
  it('urutan normal DRAFT → PROPOSED → APPROVED → PLANNED → RUNNING → COMPLETED', () => {
    const urutan = ['DRAFT', 'PROPOSED', 'APPROVED', 'PLANNED', 'RUNNING', 'COMPLETED'] as const;
    for (let i = 0; i < urutan.length - 1; i++) {
      expect(bolehTransisiProgram(urutan[i]!, urutan[i + 1]!)).toBe(true);
    }
  });

  it('COMPLETED tidak boleh langsung kembali ke DRAFT', () => {
    expect(bolehTransisiProgram('COMPLETED', 'DRAFT')).toBe(false);
    expect(bolehTransisiProgram('COMPLETED', 'PROPOSED')).toBe(false);
  });

  it('COMPLETED tidak boleh kembali ke RUNNING tanpa koreksi privileged', () => {
    // foremost alasan ada TRANSISI_KOREKSI_PROGRAM.
    expect(bolehTransisiProgram('COMPLETED', 'RUNNING')).toBe(false);
  });

  it('DRAFT tidak boleh langsung menjadi RUNNING', () => {
    expect(bolehTransisiProgram('DRAFT', 'RUNNING')).toBe(false);
    expect(bolehTransisiProgram('DRAFT', 'APPROVED')).toBe(false);
  });

  it('status akhir tidak memiliki transisi keluar', () => {
    expect(TRANSISI_PROGRAM.COMPLETED).toHaveLength(0);
    expect(TRANSISI_PROGRAM.CANCELLED).toHaveLength(0);
  });
});

describe('Perhitungan tenggat', () => {
  const acuan = new Date('2026-06-15T00:00:00Z');

  it('sisa hari positif untuk tenggat mendatang', () => {
    expect(hariTersisa('2026-06-20', acuan)).toBe(5);
  });

  it('sisa hari negatif untuk tenggat yang sudah lewat', () => {
    expect(hariTersisa('2026-06-10', acuan)).toBe(-5);
  });

  it('sisa hari nol untuk tenggat hari ini', () => {
    expect(hariTersisa('2026-06-15', acuan)).toBe(0);
  });

  it('sudahLewat benar untuk tanggal lampau', () => {
    expect(sudahLewat('2026-06-14', acuan)).toBe(true);
  });

  it('sudahLewat salah untuk tanggal mendatang', () => {
    expect(sudahLewat('2026-06-16', acuan)).toBe(false);
  });

  it('sudahLewat menerima objek Date', () => {
    expect(sudahLewat(new Date('2026-06-01T00:00:00Z'), acuan)).toBe(true);
  });
});

describe('Perhitungan persentase', () => {
  it('menghitung persen dengan benar', () => {
    expect(persenDari(1, 4)).toBe(25);
    expect(persenDari(3, 4)).toBe(75);
  });

  it('tidak membagi dengan nol', () => {
    expect(persenDari(5, 0)).toBe(0);
  });

  it('dibatasi pada 0–100', () => {
    expect(persenDari(150, 100)).toBe(100);
    expect(persenDari(-5, 100)).toBe(0);
  });

  it('100% bila pembilang sama dengan penyebut', () => {
    expect(persenDari(10, 10)).toBe(100);
  });
});

describe('Tanggal', () => {
  it('tanggalHariIni menghasilkan format YYYY-MM-DD', () => {
    expect(tanggalHariIni(new Date('2026-06-15T08:30:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
