/**
 * Layanan penerbitan token akses & refresh.
 *
 * - Access token  : JWT (HS256) berisi klaim kontrak `sub, org, roles, perms,
 *                   scopes, jti, sid, typ` + `memberId` & `nama`.
 * - Refresh token : string acak opak (256 bit) yang HANYA disimpan sebagai
 *                   SHA-256 hash di tabel `sessions`, sehingga pencabutan sesi
 *                   (logout / ganti sandi) cukup satu UPDATE.
 */
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { buatTokenAcak, hashToken, uuidAcak } from '@osda/auth';

import type { Cakupan, KlaimToken } from '@osda/contracts';

import { KONFIGURASI, type Konfigurasi } from '../config/konfigurasi.js';

/** Data pengguna yang perlu dimuat ke dalam token. */
export interface MuatanToken {
  readonly sub: string;
  readonly memberId: string | null;
  readonly nama: string;
  readonly org: readonly string[];
  readonly roles: readonly string[];
  readonly perms: readonly string[];
  readonly scopes: readonly Cakupan[];
}

/** Hasil penerbitan sepasang token. */
export interface HasilToken {
  readonly aksesToken: string;
  readonly refreshToken: string;
  readonly refreshTokenHash: string;
  readonly jti: string;
  readonly kedaluwarsaPada: Date;
  readonly refreshKedaluwarsaPada: Date;
}

@Injectable()
export class LayananToken {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(KONFIGURASI) private readonly konfigurasi: Konfigurasi,
  ) {}

  /** Terbitkan access token + refresh token untuk satu sesi. */
  async terbitkan(muatan: MuatanToken, sesiId: string): Promise<HasilToken> {
    const jti = uuidAcak();
    const klaim: KlaimToken & { memberId: string | null; nama: string } = {
      sub: muatan.sub,
      memberId: muatan.memberId,
      nama: muatan.nama,
      org: [...muatan.org],
      roles: [...muatan.roles],
      perms: [...muatan.perms],
      scopes: [...muatan.scopes],
      jti,
      sid: sesiId,
      typ: 'access',
    };

    const aksesToken = await this.jwt.signAsync(klaim, {
      secret: this.konfigurasi.JWT_SECRET,
      expiresIn: this.konfigurasi.AKSES_TOKEN_MENIT * 60,
    });

    const refreshToken = buatTokenAcak();
    return {
      aksesToken,
      refreshToken,
      refreshTokenHash: hashToken(refreshToken),
      jti,
      kedaluwarsaPada: new Date(Date.now() + this.konfigurasi.AKSES_TOKEN_MENIT * 60_000),
      refreshKedaluwarsaPada: new Date(
        Date.now() + this.konfigurasi.REFRESH_TOKEN_HARI * 86_400_000,
      ),
    };
  }

  /** Hash refresh token yang datang dari klien (untuk dicari di `sessions`). */
  hashRefresh(token: string): string {
    return hashToken(token);
  }

  /** Masa berlaku token akses dalam detik (dipakai respons login). */
  get aksesTokenDetik(): number {
    return this.konfigurasi.AKSES_TOKEN_MENIT * 60;
  }

  /** Masa berlaku kode tukar identitas (menit). */
  get kodeLinkMenit(): number {
    return this.konfigurasi.KODE_LINKING_MENIT;
  }
}
