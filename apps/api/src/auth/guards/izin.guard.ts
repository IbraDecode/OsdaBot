/**
 * `IzinGuard` — otorisasi tingkat fungsi (function-level authorization).
 *
 * Izin yang dibutuhkan dibaca dari metadata `@Izin('modul.aksi')`. Pemeriksaan
 * memakai daftar izin efektif yang sudah ada di dalam token, sehingga TIDAK ada
 * query database tambahan pada setiap permintaan (rius = reusable).
 *
 * Semua izin yang ditandai WAJIB terpenuhi (AND). Untuk memakai alternatif
 * "salah satu dari", buat decorator khusus dengan logika OR.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Izin as IzinKontrak } from '@osda/contracts';

import { KUNCI_IZIN } from '../../common/decorators/izin.decorator.js';
import { KUNCI_PUBLIK } from '../../common/decorators/publik.decorator.js';
import { galatBelumMasuk, galatIzinDitolak } from '../../common/galat.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { ambilPengguna } from '../../common/utilitas/pengguna-permintaan.js';

/** Cek apakah pengguna punya seluruh izin yang diminta. */
export function punyaSemuaIzin(pengguna: PenggunaPermintaan, izin: readonly IzinKontrak[]): boolean {
  return izin.every((i) => pengguna.perms.includes(i));
}

/** Pesan galat yang menjelaskan izin mana yang kurang. */
export function pesanIzinKurang(izin: readonly IzinKontrak[]): string {
  return `Izin yang dibutuhkan belum dimiliki: ${izin.join(', ')}.`;
}

@Injectable()
export class IzinGuard implements CanActivate {
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

    const dibutuhkan = this.reflector.getAllAndOverride<IzinKontrak[]>(KUNCI_IZIN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!dibutuhkan || dibutuhkan.length === 0) return true;

    const permintaan = context.switchToHttp().getRequest<PermintaanBerkonteks>();
    const pengguna = ambilPengguna(permintaan);
    if (!pengguna) throw galatBelumMasuk();

    if (!punyaSemuaIzin(pengguna, dibutuhkan)) {
      throw galatIzinDitolak(pesanIzinKurang(dibutuhkan));
    }
    return true;
  }
}

/** Pemeriksaan izin untuk dipakai ulang di dalam service (bukan guard). */
export function pastikanIzin(pengguna: PenggunaPermintaan | undefined, izin: readonly IzinKontrak[]): void {
  if (!pengguna) throw galatBelumMasuk();
  if (!punyaSemuaIzin(pengguna, izin)) throw galatIzinDitolak(pesanIzinKurang(izin));
}
