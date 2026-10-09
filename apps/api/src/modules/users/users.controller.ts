/**
 * UsersController — profil pengguna, preferensi, dan dasbor sesuai peran.
 *
 * Endpoint di sini bersifat "milik saya sendiri" (`/me`), sehingga tidak
 * memerlukan izin khusus selain login. Dasbor membatasi data berdasarkan
 * izin efektif pengguna, bukan berdasarkan peran yang di-hardcode.
 */
import { Controller, Get, Patch, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { UsersService } from './users.service.js';
import { SkemaPerbaruiProfil } from './dto/users.dto.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('api/v1/users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly service: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Profil pengguna yang sedang login beserta izin efektif' })
  profil(@PenggunaSekarang() pengguna: PenggunaPermintaan) {
    return this.service.profil(pengguna);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Perbarui profil & preferensi notifikasi milik sendiri' })
  perbaruiProfil(
    @Tubuh(SkemaPerbaruiProfil) masukan: unknown,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.perbaruiProfil(masukan, pengguna);
  }

  @Get('me/dashboard')
  @ApiOperation({
    summary: 'Dasbor sesuai peran (Ketua / Wakil / Sekretaris / Bendahara / Humas / Koordinator / Anggota)',
  })
  @ApiResponse({ status: 200, description: 'Bentuk dasbor tergantung peran pengguna' })
  dasbor(
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.dasbor({}, permintaan, pengguna);
  }
}
