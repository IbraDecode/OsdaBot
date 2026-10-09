/**
 * Modul pemeriksaan kesehatan.
 *
 *   - `/api/v1/health/live` : API hidup (tidak menyentuh database)
 *   - `/api/v1/health/ready`: siap melayani trafik (database dapat dijangkau)
 *
 * Keduanya juga tersedia langsung di `/health/live` dan `/health/ready` untuk
 * probe load balancer yang tidak memakai prefix versi.
 */
import { Controller, Get, Inject} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { cekKesehatan } from '@osda/db';

import { Publik } from '../../common/decorators/publik.decorator.js';
import { LayananDatabase } from '../../database/database.service.js';

@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  @Publik()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — API masih berjalan' })
  @ApiResponse({ status: 200, description: 'API hidup.' })
  hidup(): { status: string; waktu: string } {
    return { status: 'hidup', waktu: new Date().toISOString() };
  }

  @Publik()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — database dapat dijangkau' })
  @ApiResponse({ status: 200, description: 'Siap melayani trafik.' })
  @ApiResponse({ status: 503, description: 'Database tidak dapat dijangkau.' })
  async siap(): Promise<{ status: string; database: { ok: boolean; detail?: string } }> {
    const hasil = await this.dbSvc.kesehatan();
    return {
      status: hasil.ok ? 'siap' : 'belum-siap',
      database: hasil,
    };
  }
}

/** Helper dipakai rute health langsung di instance Fastify (tanpa prefix). */
export async function kesehatanRingkas(
  dbSvc: LayananDatabase,
): Promise<{ ok: boolean; detail?: string }> {
  return cekKesehatan(await dbSvc.ambilDb());
}
