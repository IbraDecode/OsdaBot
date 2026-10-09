/**
 * AuditController — hanya untuk SUPER_ADMIN / pemegang izin `audit.read`.
 *
 * Log audit tidak dapat diubah atau dihapus (trigger database menolaknya).
 * Endpoint di sini murni baca: daftar, detail, dan ringkasan statistik.
 */
import { Controller, Get, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Kueri, Parameter } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { AuditService } from './audit.service.js';
import { SkemaFilterAudit, SkemaIdAudit } from './dto/audit.dto.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('api/v1/audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly service: AuditService) {}

  @Get('logs')
  @Izin('audit.read')
  @ApiOperation({ summary: 'Daftar log audit (filter + paginasi)' })
  @ApiForbiddenResponse({ description: 'Tidak punya izin audit.read' })
  daftar(
    @Kueri(SkemaFilterAudit) kueri: unknown,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftar(kueri as Record<string, unknown>, permintaan, pengguna);
  }

  @Get('logs/:id')
  @Izin('audit.read')
  @ApiOperation({ summary: 'Detail satu log audit' })
  @ApiResponse({ status: 404, description: 'Log audit tidak ditemukan' })
  detail(
    @Parameter(SkemaIdAudit) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.detail(id, pengguna);
  }

  @Get('ringkasan')
  @Izin('audit.read')
  @ApiOperation({ summary: 'Statistik aksi sensitif per jenis' })
  ringkasan(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.ringkasan(permintaan, pengguna);
  }
}
