/**
 * MembersController — anggota organisasi.
 *
 * Semua endpoint wajib izin sesuai aksi (`member.read`, `member.write`,
 * `member.archive`). `DELETE` tidak pernah menghapus baris: ia hanya mengarsipkan
 * anggota agar histori kehadiran, tugas, dan keuangan tetap utuh.
 */
import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SkemaDaftarAnggota,
  SkemaFilterAnggota,
  SkemaPerbaruiAnggota,
  type FilterAnggota,
  type PayloadDaftarAnggota,
} from '@osda/contracts';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { MembersService } from './members.service.js';
import {
  SkemaArsipkanAnggota,
  SkemaIdAnggota,
  SkemaRekapAnggota,
  type PayloadArsipkanAnggota,
  type RekapAnggotaQuery,
} from './dto/members.dto.js';

@ApiTags('members')
@ApiBearerAuth()
@Controller('api/v1/members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly membersService: MembersService) {}

  @Get()
  @Izin('member.read')
  @ApiOperation({ summary: 'Daftar anggota (filter + paginasi)' })
  @ApiForbiddenResponse({ description: 'Tidak punya izin member.read' })
  daftar(
    @Kueri(SkemaFilterAnggota) filter: FilterAnggota,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.membersService.daftar(filter, permintaan, pengguna);
  }

  @Get(':id')
  @Izin('member.read')
  @ApiOperation({ summary: 'Detail anggota' })
  @ApiResponse({ status: 404, description: 'Anggota tidak ditemukan' })
  detail(
    @Parameter(SkemaIdAnggota) parameter: { id: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.membersService.detail(parameter.id, permintaan, pengguna);
  }

  @Post()
  @Izin('member.write')
  @ApiOperation({ summary: 'Daftarkan anggota baru' })
  tambah(
    @Tubuh(SkemaDaftarAnggota) masukan: PayloadDaftarAnggota,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.membersService.buat(masukan, permintaan, pengguna);
  }

  @Patch(':id')
  @Izin('member.write')
  @ApiOperation({ summary: 'Perbarui data anggota' })
  perbarui(
    @Parameter(SkemaIdAnggota) parameter: { id: string },
    @Tubuh(SkemaPerbaruiAnggota) masukan: Partial<PayloadDaftarAnggota>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.membersService.perbarui(
      parameter.id,
      masukan as unknown as Parameters<MembersService['perbarui']>[1],
      permintaan,
      pengguna,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Izin('member.archive')
  @ApiOperation({ summary: 'Arsipkan anggota (soft delete, bukan hapus keras)' })
  arsipkan(
    @Parameter(SkemaIdAnggota) parameter: { id: string },
    @Tubuh(SkemaArsipkanAnggota) masukan: PayloadArsipkanAnggota,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.membersService.arsipkan(parameter.id, masukan, permintaan, pengguna);
  }

  @Get(':id/attendance-recap')
  @Izin('member.read')
  @ApiOperation({ summary: 'Rekap kehadiran satu anggota' })
  rekapKehadiran(
    @Parameter(SkemaIdAnggota) parameter: { id: string },
    @Kueri(SkemaRekapAnggota) query: RekapAnggotaQuery,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.membersService.rekapKehadiran(
      parameter.id,
      { dari: query.dari, sampai: query.sampai, limit: query.limit },
      permintaan,
      pengguna,
    );
  }
}
