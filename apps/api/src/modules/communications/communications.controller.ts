/**
 * CommunicationsController — pusat komunikasi Humas.
 *
 * Izin:
 *  - `communication.create` : membuat & memperbarui pengumuman
 *  - `communication.publish` : menyetujui & menerbitkan
 */
import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import { Publik } from '../../common/decorators/publik.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { CommunicationsService } from './communications.service.js';
import {
  SkemaBuatKampanye,
  SkemaBuatPengumuman,
  SkemaFilterPengumuman,
  SkemaIdKampanye,
  SkemaIdPengumuman,
  SkemaPutuskanPengumuman,
  SkemaTerbitkan,
} from './dto/communications.dto.js';

@ApiTags('communications')
@ApiBearerAuth()
@Controller('api/v1')
export class CommunicationsController {
  constructor(@Inject(CommunicationsService) private readonly service: CommunicationsService) {}

  @Get('announcements')
  @Izin('communication.create')
  @ApiOperation({ summary: 'Daftar pengumuman (filter + paginasi)' })
  daftar(
    @Kueri(SkemaFilterPengumuman) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftar(kueri as Record<string, unknown>, permintaan, pengguna);
  }

  @Get('announcements/:id')
  @ApiOperation({ summary: 'Detail pengumuman' })
  @ApiResponse({ status: 404, description: 'Pengumuman tidak ditemukan' })
  detail(
    @Parameter(SkemaIdPengumuman) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.detail(id, permintaan, pengguna);
  }

  @Post('announcements')
  @HttpCode(HttpStatus.CREATED)
  @Izin('communication.create')
  @ApiOperation({ summary: 'Buat pengumuman baru (DRAFT)' })
  buat(
    @Tubuh(SkemaBuatPengumuman) masukan: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buat(masukan as Record<string, unknown>, permintaan, pengguna);
  }

  @Post('announcements/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Izin('communication.publish')
  @ApiOperation({ summary: 'Setujui / tolak pengumuman' })
  @ApiForbiddenResponse({ description: 'Tidak punya izin communication.publish' })
  putuskan(
    @Parameter(SkemaIdPengumuman) { id }: { id: string },
    @Tubuh(SkemaPutuskanPengumuman) masukan: { keputusan: 'APPROVED' | 'REJECTED'; komentar?: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.putuskan(id, masukan.keputusan, masukan.komentar, permintaan, pengguna);
  }

  @Post('announcements/:id/publish')
  @HttpCode(HttpStatus.OK)
  @Izin('communication.publish')
  @ApiOperation({
    summary: 'Terbitkan pengumuman ke kanal yang dipilih',
    description: 'Penerima dipilih backend berdasarkan audiens; pengiriman WhatsApp dikerjakan worker terpisah.',
  })
  terbitkan(
    @Parameter(SkemaIdPengumuman) { id }: { id: string },
    @Tubuh(SkemaTerbitkan) masukan: { lewatiKanal?: string[] },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.terbitkan(id, masukan.lewatiKanal ?? [], permintaan, pengguna);
  }

  // ------------------------------------------------------------ Kampanye
  @Get('campaigns')
  @ApiOperation({ summary: 'Daftar kampanye' })
  daftarKampanye(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarKampanye(permintaan, pengguna);
  }

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @Izin('communication.create')
  @ApiOperation({ summary: 'Buat kampanye baru' })
  buatKampanye(
    @Tubuh(SkemaBuatKampanye) masukan: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatKampanye(masukan as Record<string, unknown>, permintaan, pengguna);
  }

  // ------------------------------------------------------------ Statistik
  @Get('communications/stats')
  @ApiOperation({ summary: 'Statistik komunikasi untuk dasbor Humas' })
  statistik(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.statistik(permintaan, pengguna);
  }
}
