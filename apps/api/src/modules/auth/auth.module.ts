/**
 * AuthModule — modul autentikasi & otorisasi.
 *
 * Menggabungkan:
 *  - `AuthService`    : login / logout / refresh / tukar kode WhatsApp
 *  - `LayananIzin`    : resolusi izin efektif dari database
 *  - `LayananToken`   : penerbitan access token (JWT) & refresh token opak
 *  - `StrategiJwtAkses`: strategi passport-jwt untuk `JwtAuthGuard`
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { KONFIGURASI, type Konfigurasi } from '../../config/konfigurasi.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LayananIzin } from '../../auth/izin.service.js';
import { LayananToken } from '../../auth/token.service.js';
import { StrategiJwtAkses } from '../../auth/jwt.strategy.js';

@Module({
  imports: [
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      inject: [KONFIGURASI],
      useFactory: (konfigurasi: Konfigurasi) => ({
        secret: konfigurasi.JWT_SECRET,
        signOptions: { algorithm: 'HS256' as const },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LayananIzin, LayananToken, StrategiJwtAkses],
  exports: [AuthService, LayananIzin, LayananToken, StrategiJwtAkses],
})
export class AuthModule {}
