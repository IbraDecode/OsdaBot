/**
 * Dekorator `@PenggunaSekarang()` — menyuntikkan pengguna yang sedang login
 * ke parameter controller. Bila diberi nama field, hanya field itu yang
 * dikembalikan, mis. `@PenggunaSekarang('sub')`.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { PenggunaPermintaan } from '../tipe.js';

/** Bentuk permintaan yang sudah dilewati `JwtAuthGuard`. */
interface PermintaanDenganPengguna {
  /** Passport menempelkan hasil `validate()` ke `user`. */
  user?: PenggunaPermintaan;
  /** Ada guard lain yang menyalinnya ke `pengguna` agar lebih eksplisit. */
  pengguna?: PenggunaPermintaan;
}

export const PenggunaSekarang = createParamDecorator(
  (field: keyof PenggunaPermintaan | undefined, ctx: ExecutionContext) => {
    const permintaan = ctx.switchToHttp().getRequest<PermintaanDenganPengguna>();
    // Passport menaruh hasil validasi JWT di `request.user`.
    const pengguna = permintaan.user ?? permintaan.pengguna;
    if (!pengguna) return undefined;
    return field ? pengguna[field] : pengguna;
  },
);
