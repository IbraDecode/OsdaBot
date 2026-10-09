/**
 * MeetingsController — rapat, agenda, peserta, dan notulen berversi.
 *
 * Izin: `meeting.read` untuk membaca, `meeting.create` untuk membuat &
 * menambah agenda/peserta, `meeting.minutes.approve` untuk menyetujui notulen,
 * `meeting.manage` untuk perubahan struktur rapat.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SkemaBuatNotulen,
  SkemaBuatRapat,
  SkemaFilterRapat,
  SkemaPutuskanNotulen,
  SkemaTambahAgenda,
  SkemaTambahPeserta,
  type FilterRapat,
  type PayloadBuatNotulen,
  type PayloadBuatRapat,
  type PayloadPutuskanNotulen,
  type PayloadTambahAgenda,
  type PayloadTambahPeserta,
  type Rapat,
} from '@osda/contracts';
import { z } from 'zod';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { MeetingsService } from './meetings.service.js';
import { SkemaIdNotulen, SkemaIdRapat } from './dto/meetings.dto.js';

@ApiTags('meetings')
@ApiBearerAuth()
@Controller('api/v1/meetings')
export class MeetingsController {
  constructor(@Inject(MeetingsService) private readonly service: MeetingsService) {}

  @Get()
  @Izin('meeting.read')
  @ApiOperation({ summary: 'Daftar rapat (filter + paginasi)' })
  daftar(
    @Kueri(SkemaFilterRapat) filter: FilterRapat,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftar(filter, permintaan, pengguna);
  }

  @Get(':id')
  @Izin('meeting.read')
  @ApiOperation({ summary: 'Detail rapat' })
  detail(
    @Parameter(SkemaIdRapat) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Rapat> {
    return this.service.detail(id, permintaan, pengguna);
  }

  @Post()
  @Izin('meeting.create')
  @ApiOperation({ summary: 'Buat rapat baru (+ sesi absensi otomatis)' })
  buat(
    @Tubuh(SkemaBuatRapat) masukan: PayloadBuatRapat,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Rapat> {
    return this.service.buat(masukan, permintaan, pengguna);
  }

  @Post(':id/agenda')
  @HttpCode(HttpStatus.CREATED)
  @Izin('meeting.create')
  @ApiOperation({ summary: 'Tambah agenda rapat' })
  tambahAgenda(
    @Parameter(SkemaIdRapat) { id }: { id: string },
    @Tubuh(SkemaTambahAgenda) masukan: PayloadTambahAgenda,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tambahAgenda(id, masukan, permintaan, pengguna);
  }

  @Post(':id/participants')
  @HttpCode(HttpStatus.CREATED)
  @Izin('meeting.create')
  @ApiOperation({ summary: 'Tambah peserta rapat' })
  tambahPeserta(
    @Parameter(SkemaIdRapat) { id }: { id: string },
    @Tubuh(SkemaTambahPeserta) masukan: PayloadTambahPeserta,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tambahPeserta(id, masukan, permintaan, pengguna);
  }

  @Post(':id/minutes')
  @HttpCode(HttpStatus.CREATED)
  @Izin('meeting.create')
  @ApiOperation({ summary: 'Buat notulen (versi baru bila sudah ada)' })
  buatNotulen(
    @Parameter(SkemaIdRapat) { id }: { id: string },
    @Tubuh(SkemaBuatNotulen) masukan: PayloadBuatNotulen,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatNotulen(id, masukan, permintaan, pengguna);
  }

  @Post(':id/minutes/:mid/approve')
  @HttpCode(HttpStatus.OK)
  @Izin('meeting.minutes.approve')
  @ApiOperation({ summary: 'Setujui / tolak notulen (versi APPROVED terkunci)' })
  @ApiResponse({ status: 409, description: 'Notulen sudah disetujui' })
  putuskanNotulen(
    @Parameter(SkemaIdRapat) { id }: { id: string },
    @Parameter(SkemaIdNotulen) { mid }: { mid: string },
    @Tubuh(SkemaPutuskanNotulen) masukan: PayloadPutuskanNotulen,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.putuskanNotulen(id, mid, masukan, permintaan, pengguna);
  }

  @Get(':id/minutes')
  @Izin('meeting.read')
  @ApiOperation({ summary: 'Riwayat versi notulen' })
  riwayatNotulen(
    @Parameter(SkemaIdRapat) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.riwayatNotulen(id, permintaan, pengguna);
  }
}
