/**
 * ProgramsController — program kerja.
 *
 * Izin: `program.read` untuk membaca, `program.create` untuk membuat,
 * `program.manage` untuk mengubah status, tim, milestone, dan evaluasi,
 * `program.approve` untuk menyetujui program serta memakai jalur koreksi.
 */
import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SkemaBuatProgram,
  SkemaEvaluasiProgram,
  SkemaFilterProgram,
  SkemaPerbaruiProgram,
  SkemaTambahTonggakWaktu,
  SkemaUbahStatusProgram,
  type FilterProgram,
  type PayloadBuatProgram,
  type Program,
  type StatusProgram,
} from '@osda/contracts';
import type { z } from 'zod';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { ProgramsService } from './programs.service.js';
import { SkemaIdProgram, SkemaTambahTim } from './dto/programs.dto.js';

/** Bentuk masukan evaluasi, milestone, dan ubah status (dari skema kontrak). */
type PayloadEvaluasi = z.infer<typeof SkemaEvaluasiProgram>;
type PayloadTonggak = z.infer<typeof SkemaTambahTonggakWaktu>;
type PayloadUbahStatus = z.infer<typeof SkemaUbahStatusProgram>;
type PayloadPerbarui = Partial<PayloadBuatProgram>;

@ApiTags('programs')
@ApiBearerAuth()
@Controller('api/v1/programs')
export class ProgramsController {
  constructor(@Inject(ProgramsService) private readonly service: ProgramsService) {}

  @Get()
  @Izin('program.read')
  @ApiOperation({ summary: 'Daftar program kerja' })
  daftar(
    @Kueri(SkemaFilterProgram) filter: FilterProgram,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftar(filter, permintaan, pengguna);
  }

  @Get(':id')
  @Izin('program.read')
  @ApiOperation({ summary: 'Detail program kerja' })
  detail(
    @Parameter(SkemaIdProgram) { id }: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Program> {
    return this.service.detail(id, permintaan, pengguna);
  }

  @Post()
  @Izin('program.create')
  @ApiOperation({ summary: 'Buat program kerja baru' })
  buat(
    @Tubuh(SkemaBuatProgram) masukan: PayloadBuatProgram,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Program> {
    return this.service.buat(masukan, permintaan, pengguna);
  }

  @Patch(':id')
  @Izin('program.manage')
  @ApiOperation({ summary: 'Perbarui data program kerja' })
  perbarui(
    @Parameter(SkemaIdProgram) { id }: { id: string },
    @Tubuh(SkemaPerbaruiProgram) masukan: PayloadPerbarui,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<Program> {
    return this.service.perbarui(id, masukan, permintaan, pengguna);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  // Hanya `program.manage` di tingkat endpoint. Menyetujui program
  // (`program.approve`) diperiksa di service berdasarkan status TUJUAN:
  // koordinator pemilik program harus bisa menjalankan DRAFT → PROPOSED →
  // PLANNED → RUNNING tanpa harus memegang wewenang menyetujui.
  @Izin('program.manage')
  @ApiOperation({ summary: 'Ubah status program (transisi divalidasi kontrak)' })
  @ApiResponse({ status: 409, description: 'Transisi status tidak diizinkan' })
  ubahStatus(
    @Parameter(SkemaIdProgram) { id }: { id: string },
    @Tubuh(SkemaUbahStatusProgram) masukan: PayloadUbahStatus,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.ubahStatus(id, masukan, permintaan, pengguna);
  }

  @Post(':id/tim')
  @HttpCode(HttpStatus.CREATED)
  @Izin('program.manage')
  @ApiOperation({ summary: 'Tambahkan anggota tim program' })
  tambahTim(
    @Parameter(SkemaIdProgram) { id }: { id: string },
    @Tubuh(SkemaTambahTim) masukan: {
      memberIds: string[];
      peran: 'OWNER' | 'KETUA' | 'ANGGOTA' | 'PENGAWAS' | 'PEMBIAYA';
      deskripsiPeran?: string | null;
    },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tambahTim(id, masukan, permintaan, pengguna);
  }

  @Post(':id/milestones')
  @HttpCode(HttpStatus.CREATED)
  @Izin('program.manage')
  @ApiOperation({ summary: 'Tambahkan tonggak waktu (milestone)' })
  tambahMilestone(
    @Parameter(SkemaIdProgram) { id }: { id: string },
    @Tubuh(SkemaTambahTonggakWaktu) masukan: PayloadTonggak,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tambahMilestone(id, masukan, permintaan, pengguna);
  }

  @Post(':id/evaluasi')
  @HttpCode(HttpStatus.CREATED)
  @Izin('program.manage')
  @ApiOperation({ summary: 'Tulis evaluasi akhir program (wajib status COMPLETED)' })
  @ApiResponse({ status: 409, description: 'Program belum selesai' })
  tambahEvaluasi(
    @Parameter(SkemaIdProgram) { id }: { id: string },
    @Tubuh(SkemaEvaluasiProgram) masukan: PayloadEvaluasi,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.tambahEvaluasi(id, masukan, permintaan, pengguna);
  }
}
