/**
 * Strategi JWT (access token) untuk `JwtAuthGuard`.
 *
 * Hanya token dengan `typ === 'access'` yang diterima; refresh token bersifat
 * opaque (bukan JWT) dan disimpan sebagai hash di tabel `sessions`, sehingga
 * mencabut sesi cukup satu UPDATE.
 */
import { Inject, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { STRATEGI_JWT } from './guards/jwt-auth.guard.js';
import type { PenggunaPermintaan } from '../common/tipe.js';
import { KONFIGURASI, type Konfigurasi } from '../config/konfigurasi.js';

export class StrategiJwtAkses extends PassportStrategy(Strategy, STRATEGI_JWT) {
  constructor(@Inject(KONFIGURASI) konfigurasi: Konfigurasi) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: konfigurasi.JWT_SECRET,
    });
  }

  async validate(payload: Record<string, unknown>): Promise<PenggunaPermintaan> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Token ini bukan token akses.');
    }
    if (typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Token tidak memuat identitas pengguna.');
    }
    return payload as unknown as PenggunaPermintaan;
  }
}
