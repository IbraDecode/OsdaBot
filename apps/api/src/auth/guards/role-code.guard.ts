/**
 * `RoleCodeGuard` — pembatas eksplisit berbasis kode peran bawaan.
 *
 * Dipakai pada titik-titik yang memang harus dibatasi per peran (mis. audit log
 * hanya untuk SUPER_ADMIN), SELAIN pemeriksaan izin dari `@Izin(...)`.
 * Peran tidak pernah menjadi satu-satunya sumber kebenaran otorisasi.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { KUNCI_PERAN } from '../../common/decorators/peran.decorator.js';
import { KUNCI_PUBLIK } from '../../common/decorators/publik.decorator.js';
import { galatBelumMasuk, galatIzinDitolak } from '../../common/galat.js';
import { ambilPengguna } from '../../common/utilitas/pengguna-permintaan.js';
import type { PermintaanBerkonteks } from '../../common/tipe.js';

@Injectable()
export class RoleCodeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(KUNCI_PUBLIK, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true;
    }

    const diizinkan = this.reflector.getAllAndOverride<string[]>(KUNCI_PERAN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!diizinkan || diizinkan.length === 0) return true;

    const permintaan = context.switchToHttp().getRequest<PermintaanBerkonteks>();
    const pengguna = ambilPengguna(permintaan);
    if (!pengguna) throw galatBelumMasuk();

    if (!pengguna.roles.some((kode: string) => diizinkan.includes(kode))) {
      throw galatIzinDitolak(`Tindakan ini hanya untuk peran: ${diizinkan.join(', ')}.`);
    }
    return true;
  }
}
