/**
 * AttendanceController — sesi absensi & catatan kehadiran.
 *
 * Semua endpoint tulis wajib izin: `attendance.write` untuk mencatat kehadiran,
 * `attendance.manage` untuk membuat/membuka/menutup sesi dan mengubah catatan
 * secara manual.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SkemaBuatSesi,
  SkemaBukaSesi,
  SkemaCatatHadir,
  SkemaFilterSesi,
  SkemaTutupSesi,
  SkemaUbahHadirManual,
  SkemaVerifikasiQr,
  type FilterSesi,
  type PayloadBuatSesi,
  type PayloadBukaSesi,
  type PayloadCatatHadir,
  type PayloadTutupSesi,
  type PayloadUbahHadirManual,
  type PayloadVerifikasiQr,
  type RekapSesi,
} from '@osda/contracts';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { AttendanceService } from './attendance.service.js';
import { SkemaIdSesi } from './dto/attendance.dto.js';
import { z } from 'zod';

/** Parameter path id catatan kehadiran (ubah manual). */
const SkemaIdCatatan = z.object({ id: z.string().uuid() });

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('api/v1/attendance')
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly service: AttendanceService) {}

  @Get('sessions')
  @Izin('attendance.read')
  @ApiOperation({ summary: 'Daftar sesi absensi' })
  daftarSesi(
    @Kueri(SkemaFilterSesi) filter: FilterSesi,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarSesi(filter as unknown as Record<string, unknown>, permintaan, pengguna);
  }

  @Post('sessions')
  @Izin('attendance.manage')
  @ApiOperation({ summary: 'Buat sesi absensi baru' })
  buatSesi(
    @Tubuh(SkemaBuatSesi) masukan: PayloadBuatSesi,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatSesi(masukan, permintaan, pengguna);
  }

  @Post('sessions/:id/buka')
  @HttpCode(HttpStatus.OK)
  @Izin('attendance.manage')
  @ApiOperation({ summary: 'Buka sesi absensi (terbitkan token QR)' })
  bukaSesi(
    @Parameter(SkemaIdSesi) { id }: { id: string },
    @Tubuh(SkemaBukaSesi) masukan: PayloadBukaSesi,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.bukaSesi(id, masukan, permintaan, pengguna);
  }

  @Post('sessions/:id/tutup')
  @HttpCode(HttpStatus.OK)
  @Izin('attendance.manage')
  @ApiOperation({ summary: 'Tutup sesi absensi & hitung rekap' })
  tutupSesi(
    @Parameter(SkemaIdSesi) { id }: { id: string },
    @Tubuh(SkemaTutupSesi) masukan: PayloadTutupSesi,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tutupSesi(id, masukan, permintaan, pengguna);
  }

  @Get('sessions/:id/recap')
  @Izin('attendance.read')
  @ApiOperation({ summary: 'Rekap kehadiran satu sesi' })
  rekapSesi(
    @Parameter(SkemaIdSesi) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<RekapSesi> {
    return this.service.rekapSesi(id, permintaan, pengguna);
  }

  @Post('sessions/:id/absen')
  @Izin('attendance.write')
  @ApiOperation({ summary: 'Catat kehadiran (idempoten via idempotencyKey)' })
  @ApiResponse({ status: 409, description: 'Kehadiran sudah tercatat' })
  catatHadir(
    @Parameter(SkemaIdSesi) parameter: { id: string },
    @Tubuh(SkemaCatatHadir) masukan: PayloadCatatHadir,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.catatHadir(
      { ...masukan, sessionId: parameter.id },
      permintaan,
      pengguna,
    );
  }

  @Post('qr/verifikasi')
  @HttpCode(HttpStatus.OK)
  @Izin('attendance.write')
  @ApiOperation({ summary: 'Verifikasi token QR absensi' })
  verifikasiQr(
    @Tubuh(SkemaVerifikasiQr) masukan: PayloadVerifikasiQr,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.verifikasiQr(masukan.token, permintaan, pengguna);
  }

  @Post('records/:id/manual')
  @HttpCode(HttpStatus.OK)
  @Izin('attendance.manage')
  @ApiOperation({ summary: 'Ubah catatan kehadiran secara manual (dengan alasan)' })
  ubahManual(
    @Parameter(SkemaIdCatatan) { id }: { id: string },
    @Tubuh(SkemaUbahHadirManual) masukan: PayloadUbahHadirManual,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.ubahManual(id, masukan, permintaan, pengguna);
  }
}
