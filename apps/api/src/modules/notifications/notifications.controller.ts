/**
 * NotificationsController — notifikasi in-app untuk Web & Mobile.
 *
 * Setiap pengguna hanya bisa melihat notifikasinya sendiri (object-level
 * authorization) — itu ditegakkan lagi di service, bukan hanya di filter URL.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Kueri, Parameter } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { NotificationsService } from './notifications.service.js';
import { SkemaIdNotifikasi, SkemaKueriNotifikasi } from './dto/notifications.dto.js';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Daftar notifikasi milik pengguna yang login' })
  @ApiResponse({ status: 200, description: 'Berhasil' })
  daftar(
    @Kueri(SkemaKueriNotifikasi) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftar(kueri as never, permintaan, pengguna);
  }

  @Get('ringkasan')
  @ApiOperation({ summary: 'Ringkasan: jumlah belum dibaca + notifikasi terbaru' })
  ringkasan(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.ringkasan(permintaan, pengguna);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tandai satu notifikasi sudah dibaca' })
  @ApiResponse({ status: 404, description: 'Notifikasi tidak ditemukan' })
  tandaiDibaca(
    @Parameter(SkemaIdNotifikasi) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tandaiDibaca(id, permintaan, pengguna);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tandai semua notifikasi milik pengguna sudah dibaca' })
  tandaiSemuaDibaca(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tandaiSemuaDibaca(permintaan, pengguna);
  }
}
