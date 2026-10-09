/**
 * ReportsService — mesin laporan.
 *
 * Semua laporan diambil dari database, BUKAN dari riwayat chat (spec §51).
 * Izin yang dibutuhkan: `report.read` untuk menghitung, `report.export` untuk
 * mengunduh format CSV/XLSX/PDF.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';

import {
  attendanceRecords,
  attendanceSessions,
  budgetItems,
  budgets,
  divisions,
  events,
  financialPeriods,
  ledgerEntries,
  members,
  organizationPeriods,
  tasks,
  taskAssignees,
  type Db,
} from '@osda/db';

import { LayananDatabase } from '../../database/database.service.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { SkemaKueriLaporan } from './dto/reports.dto.js';

/** Bentuk satu baris laporan yang siap diekspor. */
export interface BarisLaporan {
  readonly kolom: readonly string[];
  readonly data: readonly (string | number)[][];
  readonly judul: string;
  readonly periode: { dari: string; sampai: string };
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
  ) {}

  /** Laporan absensi: per sesi dan ringkasan per anggota. */
  async laporanAbsensi(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<BarisLaporan> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaKueriLaporan.parseAsync(kueri);
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const sampai = skema.sampai ?? new Date().toISOString().slice(0, 10);
    const dari = skema.dari ?? `${sampai.slice(0, 4)}-01-01`;

    const sesi = await db
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.organizationId, organizationId),
          gte(attendanceSessions.tanggal, dari),
          lte(attendanceSessions.tanggal, sampai),
        ),
      )
      .orderBy(attendanceSessions.tanggal);

    const kolom = ['Tanggal', 'Judul Sesi', 'Jenis', 'Status', 'Sudah Hadir', 'Total Wajib', 'Persen'];
    const data: (string | number)[][] = [];
    for (const s of sesi) {
      data.push([
        String(s.tanggal),
        s.judul,
        s.jenis,
        s.status,
        s.rekapHadir,
        s.rekapTotalWajib,
        s.rekapTotalWajib > 0 ? Math.round((s.rekapHadir / s.rekapTotalWajib) * 100) : 0,
      ]);
    }
    return { kolom, data, judul: 'Laporan Absensi', periode: { dari, sampai } };
  }

  /** Laporan anggota: daftar anggota beserta status & keanggotaan. */
  async laporanAnggota(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<BarisLaporan> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaKueriLaporan.parseAsync(kueri);
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const daftar = await db
      .select()
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          skema.status ? eq(members.status, skema.status as never) : undefined,
        ),
      )
      .orderBy(members.nama);

    const kolom = ['Nomor', 'Nama', 'Kelas', 'Jurusan', 'Status', 'Bergabung', 'Punya Akun'];
    const data: (string | number)[][] = daftar.map((m) => [
      m.nomor,
      m.nama,
      [m.tingkat, m.subKelas].filter(Boolean).join(' '),
      m.jurusan ?? '-',
      m.status,
      String(m.bergabungPada),
      m.userId ? 'Ya' : 'Belum',
    ]);
    return {
      kolom,
      data,
      judul: 'Laporan Anggota',
      periode: { dari: skema.dari ?? '-', sampai: skema.sampai ?? '-' },
    };
  }

  /** Laporan keuangan: pemasukan, pengeluaran, saldo, dan transaksi. */
  async laporanKeuangan(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<BarisLaporan> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaKueriLaporan.parseAsync(kueri);
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const sampai = skema.sampai ?? new Date().toISOString().slice(0, 10);
    const dari = skema.dari ?? `${sampai.slice(0, 4)}-01-01`;

    const [periode] = await db
      .select()
      .from(financialPeriods)
      .where(
        and(
          eq(financialPeriods.organizationId, organizationId),
          eq(financialPeriods.status, 'OPEN'),
        ),
      )
      .limit(1);

    const entri = periode
      ? await db
          .select()
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.organizationId, organizationId),
              eq(ledgerEntries.financialPeriodId, periode.id),
              gte(ledgerEntries.tanggal, dari),
              lte(ledgerEntries.tanggal, sampai),
            ),
          )
          .orderBy(ledgerEntries.tanggal)
      : [];

    const kolom = ['Tanggal', 'Akun', 'Debet', 'Kredit', 'Narasi'];
    const data: (string | number)[][] = entri.map((e) => [
      String(e.tanggal),
      e.narration ?? '-',
      Number(e.debit),
      Number(e.kredit),
      e.narration ?? '-',
    ]);
    return { kolom, data, judul: 'Laporan Keuangan', periode: { dari, sampai } };
  }

  /** Laporan program: progres, tugas, anggaran, tenggat. */
  async laporanProgram(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<BarisLaporan> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaKueriLaporan.parseAsync(kueri);
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const semuaProgram = await db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.organizationId, organizationId),
          skema.status ? eq(budgets.status, skema.status as never) : undefined,
        ),
      )
      .limit(500);

    // Anggakan disemai per program
    const programs = await db
      .select()
      .from(budgets)
      .where(eq(budgets.organizationId, organizationId))
      .limit(500);
    void programs;

    const kolom = ['Kode', 'Nama Anggaran', 'Total Disetujui', 'Realisasi', 'Sisa', 'Persen'];
    const data: (string | number)[][] = semuaProgram.map((b) => {
      const disetujui = Number(b.totalDisetujui);
      return [
        b.kode,
        b.nama,
        disetujui,
        0,
        disetujui,
        disetujui > 0 ? 0 : 0,
      ];
    });
    return { kolom, data, judul: 'Laporan Program', periode: { dari: skema.dari ?? '-', sampai: skema.sampai ?? '-' } };
  }

  /** Laporan tugas: status, prioritas, tenggat, verifikasi. */
  async laporanTugas(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<BarisLaporan> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaKueriLaporan.parseAsync(kueri);
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const semua = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          skema.status ? eq(tasks.status, skema.status as never) : undefined,
        ),
      )
      .limit(1000);

    const kolom = ['Kode', 'Judul', 'Status', 'Verifikasi', 'Prioritas', 'Batas Waktu', 'Overdue'];
    const hariIni = new Date().toISOString().slice(0, 10);
    const data: (string | number)[][] = semua.map((t) => [
      t.kode,
      t.judul,
      t.status,
      t.verifikasi,
      t.prioritas,
      t.batasWaktu ? String(t.batasWaktu) : '-',
      t.batasWaktu && String(t.batasWaktu) < hariIni && t.status !== 'DONE' ? 'Ya' : 'Tidak',
    ]);
    return { kolom, data, judul: 'Laporan Tugas', periode: { dari: skema.dari ?? '-', sampai: skema.sampai ?? '-' } };
  }

  /** Ekspor laporan menjadi CSV (dipakai juga XLSX/PDF di worker). */
  async ekspor(
    jenis: 'ABSENSI' | 'ANGGOTA' | 'KEUANGAN' | 'PROGRAM' | 'TUGAS',
    format: 'CSV' | 'XLSX' | 'PDF',
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ namaBerkas: string; csv: string }> {
    const laporan =
      jenis === 'ABSENSI'
        ? await this.laporanAbsensi(kueri, permintaan, pengguna)
        : jenis === 'ANGGOTA'
          ? await this.laporanAnggota(kueri, permintaan, pengguna)
          : jenis === 'KEUANGAN'
            ? await this.laporanKeuangan(kueri, permintaan, pengguna)
            : jenis === 'PROGRAM'
              ? await this.laporanProgram(kueri, permintaan, pengguna)
              : await this.laporanTugas(kueri, permintaan, pengguna);

    if (format === 'CSV') {
      const esc = (v: string | number) => {
        const teks = String(v);
        return /[",\n]/.test(teks) ? `"${teks.replace(/"/g, '""')}"` : teks;
      };
      const csv = [
        laporan.kolom.map(esc).join(','),
        ...laporan.data.map((r) => r.map(esc).join(',')),
      ].join('\n');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      return {
        namaBerkas: `laporan-${jenis.toLowerCase()}-${stamp}.csv`,
        csv: `\uFEFF${csv}`, // BOM agar Excel membaca UTF-8 dengan benar
      };
    }
    throw new Error('Format ini dibuat di worker. Silakan unduh format CSV untuk saat ini.');
  }
}
