/**
 * ReportsController — mesin laporan (absensi, anggota, program, tugas, keuangan).
 *
 * Izin:
 *  - `report.read`   : menghitung / melihat isi laporan
 *  - `report.export` : mengunduh CSV/XLSX/PDF
 *
 * Laporan selalu dihitung dari database, tidak pernah dari riwayat chat.
 */
import { Controller, Get, Param, Post, Res, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Kueri } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { ReportsService } from './reports.service.js';
import { SkemaKueriLaporan } from './dto/reports.dto.js';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('api/v1/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}

  @Get('attendance')
  @Izin('report.read')
  @ApiOperation({ summary: 'Laporan absensi per sesi' })
  absensi(
    @Kueri(SkemaKueriLaporan) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.laporanAbsensi(kueri as Record<string, unknown>, permintaan, pengguna);
  }

  @Get('members')
  @Izin('report.read')
  @ApiOperation({ summary: 'Laporan daftar anggota & keanggotaan' })
  anggota(
    @Kueri(SkemaKueriLaporan) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.laporanAnggota(kueri as Record<string, unknown>, permintaan, pengguna);
  }

  @Get('finance')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Laporan keuangan (ledger)' })
  @ApiForbiddenResponse({ description: 'Tidak punya izin finance.read' })
  keuangan(
    @Kueri(SkemaKueriLaporan) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.laporanKeuangan(kueri as Record<string, unknown>, permintaan, pengguna);
  }

  @Get('programs')
  @Izin('report.read')
  @ApiOperation({ summary: 'Laporan program (anggaran & progress)' })
  program(
    @Kueri(SkemaKueriLaporan) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.laporanProgram(kueri as Record<string, unknown>, permintaan, pengguna);
  }

  @Get('tasks')
  @Izin('report.read')
  @ApiOperation({ summary: 'Laporan tugas (status, verifikasi, tenggat)' })
  tugas(
    @Kueri(SkemaKueriLaporan) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.laporanTugas(kueri as Record<string, unknown>, permintaan, pengguna);
  }

  @Post(':jenis/export')
  @Izin('report.export')
  @ApiOperation({
    summary: 'Unduh laporan sebagai CSV (XLSX/PDF dibuat di worker)',
    description: 'Membutuhkan izin `report.export`. Ekspor keuangan hanya untuk peran yang diizinkan.',
  })
  @ApiForbiddenResponse({ description: 'Tidak punya izin report.export' })
  async ekspor(
    @Param('jenis') jenis: 'ABSENSI' | 'ANGGOTA' | 'KEUANGAN' | 'PROGRAM' | 'TUGAS',
    @Kueri(SkemaKueriLaporan) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
    @Res() res: any,
  ) {
    const hasil = await this.service.ekspor(
      jenis,
      'CSV',
      kueri as Record<string, unknown>,
      permintaan,
      pengguna,
    );
    const balasan = res as unknown as {
      header: (k: string, v: string) => unknown;
      send: (v: unknown) => unknown;
    };
    void balasan.header('Content-Type', 'text/csv; charset=utf-8');
    void balasan.header('Content-Disposition', `attachment; filename="${hasil.namaBerkas}"`);
    void balasan.send(hasil.csv);
  }
}
