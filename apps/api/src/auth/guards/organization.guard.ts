/**
 * `OrganizationGuard` — memastikan setiap permintaan punya konteks organisasi.
 *
 * Organisasi aktif diambil dari header `x-organization-id` (Web & Mobile
 * mengirimnya setelah pengguna memilih organisasi). Bila header tidak ada,
 * dipakai organisasi pertama yang dimiliki pengguna.
 *
 * Izin `finance.*` tidak cukup tanpa cakupan FINANCE yang sesuai; penegakan
 * cakupan penuh ada di lapisan service.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { KUNCI_PUBLIK } from '../../common/decorators/publik.decorator.js';
import { galatIzinDitolak } from '../../common/galat.js';
import type { PermintaanBerkonteks } from '../../common/tipe.js';
import { ambilPengguna } from '../../common/utilitas/pengguna-permintaan.js';

/** Header yang membawa organisasi aktif. */
export const HEADER_ORGANISASI = 'x-organization-id';

@Injectable()
export class OrganizationGuard implements CanActivate {
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

    const permintaan = context.switchToHttp().getRequest<PermintaanBerkonteks>();
    const pengguna = ambilPengguna(permintaan);
    if (!pengguna) return true; // sudah ditangani JwtAuthGuard

    const dariHeader = this.bacaHeader(permintaan, HEADER_ORGANISASI);
    const organisasi = dariHeader ?? pengguna.org[0] ?? null;

    if (!organisasi) {
      // Pengguna belum terhubung ke organisasi mana pun.
      return true;
    }

    if (!pengguna.org.includes(organisasi)) {
      throw galatIzinDitolak('Organisasi yang dipilih tidak dapat diakses oleh akun ini.');
    }

    permintaan.organizationId = organisasi;
    return true;
  }

  private bacaHeader(
    permintaan: PermintaanBerkonteks,
    nama: string,
  ): string | undefined {
    const nilai = permintaan.headers?.[nama] ?? permintaan.headers?.[nama.toUpperCase()];
    if (Array.isArray(nilai)) return nilai[0];
    return typeof nilai === 'string' && nilai.length > 0 ? nilai : undefined;
  }
}
