/**
 * SettingsController — konfigurasi organisasi, periode kepengurusan, struktur,
 * pengaturan sistem, dan feature flag. Semua butuh izin `settings.manage`,
 * `period.manage`, atau `integration.manage` sesuai aksinya.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { SettingsService } from './settings.service.js';
import {
  SkemaIdFlag,
  SkemaPeriodeBaru,
  SkemaSimpanFeatureFlag,
  SkemaSimpanOrganisasi,
  SkemaSimpanPengaturan,
  SkemaTambahDivisi,
  SkemaTambahJabatan,
} from './dto/settings.dto.js';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('api/v1')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly service: SettingsService) {}

  // ---------------------------------------------------------- Organisasi
  @Get('organizations')
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Daftar organisasi' })
  daftarOrganisasi(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarOrganisasi(permintaan, pengguna);
  }

  @Post('organizations')
  @HttpCode(HttpStatus.CREATED)
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Buat organisasi baru' })
  buatOrganisasi(
    @Tubuh(SkemaSimpanOrganisasi) masukan: unknown,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatOrganisasi(masukan, pengguna);
  }

  // ---------------------------------------------------------- Struktur
  @Get('divisions')
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Daftar divisi organisasi aktif' })
  daftarDivisi(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarDivisi(permintaan, pengguna);
  }

  @Post('divisions')
  @HttpCode(HttpStatus.CREATED)
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Tambah divisi' })
  buatDivisi(
    @Tubuh(SkemaTambahDivisi) masukan: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatDivisi(masukan, permintaan, pengguna);
  }

  @Get('positions')
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Daftar jabatan organisasi aktif' })
  daftarJabatan(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarJabatan(permintaan, pengguna);
  }

  @Post('positions')
  @HttpCode(HttpStatus.CREATED)
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Tambah jabatan — peran sepenuhnya configurable' })
  buatJabatan(
    @Tubuh(SkemaTambahJabatan) masukan: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatJabatan(masukan, permintaan, pengguna);
  }

  // ---------------------------------------------------------- Periode
  @Get('periods')
  @Izin('period.manage')
  @ApiOperation({ summary: 'Daftar periode kepengurusan' })
  daftarPeriode(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarPeriode(permintaan, pengguna);
  }

  @Post('periods')
  @HttpCode(HttpStatus.CREATED)
  @Izin('period.manage')
  @ApiOperation({
    summary: 'Buat periode kepengurusan baru (periode lama diarsipkan, histori tetap)',
    description:
      'Memulai periode baru TIDAK menghapus data lama. Periode lama diubah menjadi ARCHIVED.',
  })
  @ApiForbiddenResponse({ description: 'Tidak punya izin period.manage' })
  buatPeriode(
    @Tubuh(SkemaPeriodeBaru) masukan: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatPeriode(masukan, permintaan, pengguna);
  }

  // ---------------------------------------------------------- Pengaturan
  @Get('settings')
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Daftar pengaturan organisasi' })
  daftarPengaturan(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarPengaturan(permintaan, pengguna);
  }

  @Put('settings')
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Simpan (buat/ubah) satu pengaturan' })
  simpanPengaturan(
    @Tubuh(SkemaSimpanPengaturan) masukan: { kunci: string; nilai: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.simpanPengaturan(masukan, permintaan, pengguna);
  }

  // ---------------------------------------------------------- Feature flag
  @Get('feature-flags')
  @ApiOperation({ summary: 'Daftar feature flag (untuk migrasi bertahap)' })
  daftarFeatureFlag(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarFeatureFlag(permintaan, pengguna);
  }

  @Patch('feature-flags/:id')
  @Izin('settings.manage')
  @ApiOperation({ summary: 'Aktifkan / nonaktifkan feature flag' })
  @ApiResponse({ status: 404, description: 'Feature flag tidak ditemukan' })
  perbaruiFeatureFlag(
    @Parameter(SkemaIdFlag) { id }: { id: string },
    @Tubuh(SkemaSimpanFeatureFlag) masukan: { status: 'ON' | 'OFF' },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.perbaruiFeatureFlag(id, masukan.status, permintaan, pengguna);
  }
}
