/**
 * AuthController — endpoint masuk, keluar, segarkan token, dan tukar kode
 * account linking dari WhatsApp.
 *
 * Endpoint `login`, `refresh`, dan `whatsapp/exchange` bersifat publik
 * (dilindungi rate limit khusus auth); `logout` butuh token akses yang sah.
 */
import { Controller, HttpCode, HttpStatus, Post, Req, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HasilMasuk, HasilTukarIdentitas } from '@osda/contracts';
import { SkemaMasuk, SkemaTukarIdentitas, type MasukanMasuk, type MasukanTukarIdentitas } from '@osda/contracts';

import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import { Publik } from '../../common/decorators/publik.decorator.js';
import { Tubuh } from '../../common/decorators/masukan.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { AuthService, type KonteksSesi } from './auth.service.js';
import {
  SkemaKeluar,
  SkemaSegarkan,
  type PayloadKeluar,
  type PayloadSegarkan,
} from './dto/auth.dto.js';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Publik()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Masuk dengan email & kata sandi' })
  @ApiResponse({ status: 200, description: 'Berhasil masuk.' })
  @ApiResponse({ status: 401, description: 'Email atau kata sandi salah.' })
  masuk(
    @Tubuh(SkemaMasuk) masukan: MasukanMasuk,
    @Req() permintaan: PermintaanBerkonteks,
  ): Promise<HasilMasuk> {
    return this.authService.masuk(masukan.email, masukan.password, this.konteksSesi(permintaan));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Keluar & cabut sesi saat ini' })
  @ApiResponse({ status: 200, description: 'Sesi dicabut.' })
  async keluar(
    @Tubuh(SkemaKeluar) masukan: PayloadKeluar,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ): Promise<{ berhasil: boolean }> {
    await this.authService.keluar(pengguna.sub, pengguna.sid, masukan.semuaSesi === true);
    return { berhasil: true };
  }

  @Publik()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Segarkan access token (rotasi refresh token)' })
  @ApiResponse({ status: 200, description: 'Token baru diterbitkan.' })
  @ApiResponse({ status: 401, description: 'Sesi sudah berakhir.' })
  segarkan(
    @Tubuh(SkemaSegarkan) masukan: PayloadSegarkan,
    @Req() permintaan: PermintaanBerkonteks,
  ): Promise<HasilMasuk> {
    return this.authService.segarkan(masukan.refreshToken, this.konteksSesi(permintaan));
  }

  @Publik()
  @Post('whatsapp/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tukar kode account linking WhatsApp menjadi JWT' })
  @ApiResponse({ status: 200, description: 'Kode valid, token diterbitkan.' })
  @ApiResponse({ status: 404, description: 'Kode tidak valid atau sudah kedaluwarsa.' })
  tukarWhatsapp(
    @Tubuh(SkemaTukarIdentitas) masukan: MasukanTukarIdentitas,
    @Req() permintaan: PermintaanBerkonteks,
  ): Promise<HasilTukarIdentitas> {
    return this.authService.tukarKode(masukan.kode, this.konteksSesi(permintaan));
  }

  /** Ambil user agent & IP untuk dicatat di baris sesi. */
  private konteksSesi(permintaan: PermintaanBerkonteks): KonteksSesi {
    const ua = permintaan.headers?.['user-agent'];
    return {
      userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
      ip: typeof permintaan.ip === 'string' ? permintaan.ip : null,
    };
  }
}
