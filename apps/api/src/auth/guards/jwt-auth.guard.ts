/**
 * `JwtAuthGuard` — memverifikasi bearer token lalu menempelkan klaim ke request.
 *
 * Endpoint yang ditandai `@Publik()` dilewati (login, refresh, webhook, health,
 * dokumentasi). Token dengan `typ !== 'access'` DITOLAK agar refresh token
 * tidak bisa dipakai sebagai token akses.
 */
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { KUNCI_PUBLIK } from '../../common/decorators/publik.decorator.js';
import { galatBelumMasuk, galatTokenKedaluwarsa } from '../../common/galat.js';

/** Nama strategi passport yang dipakai guard ini. */
export const STRATEGI_JWT = 'osda-jwt';

@Injectable()
export class JwtAuthGuard extends AuthGuard(STRATEGI_JWT) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    if (this.apakahPublik(context)) return true;
    return super.canActivate(context) as boolean | Promise<boolean>;
  }

  override handleRequest<TUser>(error: unknown, pengguna: TUser, info?: unknown): TUser {
    if (error) throw error;
    if (!pengguna) {
      const nama = (info as { name?: string } | undefined)?.name ?? '';
      if (nama === 'TokenExpiredError') {
        throw galatTokenKedaluwarsa();
      }
      throw galatBelumMasuk();
    }
    return pengguna;
  }

  /** Periksa metadata `@Publk()` pada handler lalu pada class. */
  private apakahPublik(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(KUNCI_PUBLIK, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
