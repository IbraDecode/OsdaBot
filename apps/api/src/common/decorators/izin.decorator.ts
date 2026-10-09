/**
 * Dekorator `@Izin('member.read')` — menandai izin yang WAJIB dimiliki
 * pengguna untuk memanggil sebuah endpoint.
 *
 * Izin yang boleh dipakai hanya yang ada di daftar `PERMISSION`
 * (`@osda/contracts`); TypeScript akan menolak string lain.
 */
import { SetMetadata } from '@nestjs/common';

import type { Izin as IzinKontrak } from '@osda/contracts';

/** Kunci metadata izin. */
export const KUNCI_IZIN = 'osda:izin-dibutuhkan';

/** Tandai satu atau lebih izin yang dibutuhkan (semua wajib terpenuhi). */
export const Izin = (...izin: IzinKontrak[]) => SetMetadata(KUNCI_IZIN, izin);

/** Kunci metadata modul sensitif (dipakai audit interceptor). */
export const KUNCI_AUDIT = 'osda:audit-aksi';

/** Tandai aksi audit spesial, mis. `@AuditAksi('MEMBER_ARCHIVED')`. */
export const AuditAksi = (aksi: string) => SetMetadata(KUNCI_AUDIT, aksi);
