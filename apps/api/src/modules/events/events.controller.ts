/**
 * EventsController — acara (event), peserta, dan kalender terpadu.
 *
 * Izin: `event.read` untuk membaca, `event.create` untuk membuat & mendaftarkan
 * peserta, `event.manage` untuk mengubah acara.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SkemaBuatAcara,
  SkemaFilterAcara,
  type Acara,
  type FilterAcara,
  type PayloadBuatAcara,
} from '@osda/contracts';
import { z } from 'zod';
import { SkemaTambahPesertaAcara } from '@osda/contracts';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { EventsService } from './events.service.js';
import { SkemaIdAcara, SkemaKalender } from './dto/events.dto.js';

@ApiTags('events')
@ApiBearerAuth()
@Controller('api/v1/events')
export class EventsController {
  constructor(@Inject(EventsService) private readonly service: EventsService) {}

  @Get()
  @Izin('event.read')
  @ApiOperation({ summary: 'Daftar acara (filter + paginasi)' })
  daftar(
    @Kueri(SkemaFilterAcara) filter: FilterAcara,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftar(filter, permintaan, pengguna);
  }

  @Get(':id')
  @Izin('event.read')
  @ApiOperation({ summary: 'Detail acara' })
  detail(
    @Parameter(SkemaIdAcara) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Acara> {
    return this.service.detail(id, permintaan, pengguna);
  }

  @Post()
  @Izin('event.create')
  @ApiOperation({ summary: 'Buat acara baru' })
  buat(
    @Tubuh(SkemaBuatAcara) masukan: PayloadBuatAcara,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Acara> {
    return this.service.buat(masukan, permintaan, pengguna);
  }

  @Patch(':id')
  @Izin('event.manage')
  @ApiOperation({ summary: 'Perbarui acara' })
  perbarui(
    @Parameter(SkemaIdAcara) { id }: { id: string },
    @Tubuh(z.object({ judul: z.string().min(3).max(200).optional() })) masukan: Record<string, unknown>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Acara> {
    return this.service.perbarui(
      id,
      masukan as Partial<PayloadBuatAcara>,
      permintaan,
      pengguna,
    );
  }

  @Post(':id/peserta')
  @HttpCode(HttpStatus.CREATED)
  @Izin('event.create')
  @ApiOperation({ summary: 'Daftarkan peserta/panitia acara' })
  tambahPeserta(
    @Parameter(SkemaIdAcara) { id }: { id: string },
    @Tubuh(
      z.object({
        memberIds: z.array(z.string().uuid()).min(1).max(1000),
        peran: z.enum(['PESERTA', 'PANITIA', 'PANITIA_UTAMA']).default('PESERTA'),
      }),
    )
    masukan: z.infer<typeof SkemaTambahPesertaAcara>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tambahPeserta(id, masukan, permintaan, pengguna);
  }

  @Get(':id/kalender')
  @Izin('event.read')
  @ApiOperation({ summary: 'Kalender terpadu organisasi' })
  kalender(
    @Kueri(SkemaKalender) query: { dari?: string; sampai?: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.kalender(
      permintaan.organizationId ?? pengguna.org[0] ?? '',
      query,
    );
  }
}
