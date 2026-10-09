/**
 * TasksController — tugas organisasi.
 *
 * Izin: `task.read` untuk membaca, `task.write` untuk membuat/mengubah status &
 * berkomentar, `task.verify` untuk memverifikasi penyelesaian tugas.
 */
import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SkemaBuatTugas,
  SkemaFilterTugas,
  SkemaPerbaruiTugas,
  SkemaUbahStatusTugas,
  SkemaVerifikasiTugas,
  type FilterTugas,
  type PayloadBuatTugas,
  type Tugas,
  type PayloadUbahStatusTugas,
  type PayloadVerifikasiTugas,
} from '@osda/contracts';

import { z } from 'zod';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { TasksService } from './tasks.service.js';
import { SkemaIdTugas, SkemaKomentarTugas, type PayloadKomentarTugas } from './dto/tasks.dto.js';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('api/v1/tasks')
export class TasksController {
  constructor(@Inject(TasksService) private readonly service: TasksService) {}

  @Get()
  @Izin('task.read')
  @ApiOperation({ summary: 'Daftar tugas (filter + paginasi)' })
  daftar(
    @Kueri(SkemaFilterTugas) filter: FilterTugas,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftar(filter, permintaan, pengguna);
  }

  @Get(':id')
  @Izin('task.read')
  @ApiOperation({ summary: 'Detail tugas' })
  detail(
    @Parameter(SkemaIdTugas) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Tugas> {
    return this.service.detail(id, permintaan, pengguna);
  }

  @Get(':id/aktivitas')
  @Izin('task.read')
  @ApiOperation({ summary: 'Riwayat status & komentar tugas' })
  aktivitas(
    @Parameter(SkemaIdTugas) { id }: { id: string },
    @Kueri(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) })) query: { limit: number },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.aktivitas(id, query.limit, permintaan, pengguna);
  }

  @Post()
  @Izin('task.write')
  @ApiOperation({ summary: 'Buat tugas baru' })
  buat(
    @Tubuh(SkemaBuatTugas) masukan: PayloadBuatTugas,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Tugas> {
    return this.service.buat(masukan, permintaan, pengguna);
  }

  @Patch(':id')
  @Izin('task.write')
  @ApiOperation({ summary: 'Perbarui detail tugas' })
  perbarui(
    @Parameter(SkemaIdTugas) { id }: { id: string },
    @Tubuh(SkemaPerbaruiTugas) masukan: Record<string, unknown>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Tugas> {
    return this.service.perbarui(id, masukan, permintaan, pengguna);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @Izin('task.write')
  @ApiOperation({ summary: 'Ubah status tugas (transisi divalidasi kontrak)' })
  @ApiResponse({ status: 409, description: 'Transisi status tidak diizinkan' })
  ubahStatus(
    @Parameter(SkemaIdTugas) { id }: { id: string },
    @Tubuh(SkemaUbahStatusTugas) masukan: PayloadUbahStatusTugas,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.ubahStatus(id, masukan, permintaan, pengguna);
  }

  @Post(':id/verifikasi')
  @HttpCode(HttpStatus.OK)
  @Izin('task.verify')
  @ApiOperation({ summary: 'Verifikasi penyelesaian tugas' })
  verifikasi(
    @Parameter(SkemaIdTugas) { id }: { id: string },
    @Tubuh(SkemaVerifikasiTugas) masukan: PayloadVerifikasiTugas,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.verifikasi(id, masukan, permintaan, pengguna);
  }

  @Post(':id/komentar')
  @HttpCode(HttpStatus.CREATED)
  @Izin('task.write')
  @ApiOperation({ summary: 'Tambahkan komentar pada tugas' })
  komentar(
    @Parameter(SkemaIdTugas) { id }: { id: string },
    @Tubuh(SkemaKomentarTugas) masukan: PayloadKomentarTugas,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.komentar(id, masukan, permintaan, pengguna);
  }
}
