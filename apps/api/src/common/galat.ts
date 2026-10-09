/**
 * Galat API dengan bentuk standar `{ error: { code, message, requestId } }`
 * sesuai kontrak `BentukError` pada `@osda/contracts`.
 *
 * Kode error SELALU diambil dari `KODE_ERROR` — tidak ada kode buatan sendiri.
 */
import { HttpException } from '@nestjs/common';

import { HTTP_DARI_KODE_ERROR, type KodeError } from '@osda/contracts';

/** Galat bisnis/otorisasi yang bisa dilempar dari service & guard. */
export class GalatApi extends HttpException {
  readonly kode: KodeError;
  readonly pesan: string;
  readonly detail: unknown;

  constructor(kode: KodeError, pesan: string, detail?: unknown) {
    super(
      {
        error: {
          code: kode,
          message: pesan,
          ...(detail === undefined ? {} : { detail }),
        },
      },
      HTTP_DARI_KODE_ERROR[kode],
    );
    this.kode = kode;
    this.pesan = pesan;
    this.detail = detail;
  }
}

/** Galat validasi masukan (Zod). */
export function galatValidasi(detail?: unknown, pesan = 'Data yang dikirim tidak valid.'): GalatApi {
  return new GalatApi('VALIDATION_FAILED', pesan, detail);
}

/** Belum terautentikasi. */
export function galatBelumMasuk(pesan = 'Sesi masuk tidak valid. Silakan masuk kembali.'): GalatApi {
  return new GalatApi('UNAUTHENTICATED', pesan);
}

/** Sudah terautentikasi tapi izin tidak cukup. */
export function galatIzinDitolak(pesan = 'Anda tidak memiliki izin untuk tindakan ini.'): GalatApi {
  return new GalatApi('PERMISSION_DENIED', pesan);
}

/** Data tidak ditemukan. */
export function galatTidakDitemukan(pesan = 'Data tidak ditemukan.'): GalatApi {
  return new GalatApi('NOT_FOUND', pesan);
}

/** Konflik data (duplikat kode, idx idempotensi, dsb). */
export function galatKonflik(pesan = 'Data sudah ada atau bertentangan.'): GalatApi {
  return new GalatApi('CONFLICT', pesan);
}

/** Token sudah kedaluwarsa. */
export function galatTokenKedaluwarsa(
  pesan = 'Token sudah kedaluwarsa. Silakan segarkan token Anda.',
): GalatApi {
  return new GalatApi('TOKEN_EXPIRED', pesan);
}

/** Duplikat kode unik dari database (kode 23505). */
export function galatDuplikat(pesan = 'Data dengan kode yang sama sudah ada.'): GalatApi {
  return new GalatApi('DUPLICATE_RECORD', pesan);
}

/** Transisi status tidak sah. */
export function galatTransisi(pesan: string): GalatApi {
  return new GalatApi('INVALID_STATE_TRANSITION', pesan);
}

/** Galat tak terduga di sisi server. */
export function galatInternal(pesan = 'Terjadi galat tak terduga di server.'): GalatApi {
  return new GalatApi('INTERNAL_ERROR', pesan);
}

/** Terlalu banyak permintaan. */
export function galatBatasLaju(pesan = 'Terlalu banyak permintaan. Coba lagi nanti.'): GalatApi {
  return new GalatApi('RATE_LIMITED', pesan);
}
