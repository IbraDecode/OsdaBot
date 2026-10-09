/**
 * Tipe bersama lapisan web (permintaan, konteks aktor, pengguna terautentikasi).
 *
 * Objek yang menempel pada `request` Fastify:
 *   - `requestId`    : identitas satu permintaan, dikembalikan pada setiap galat
 *   - `organizationId`: organisasi aktif (dari header `x-organization-id`)
 *   - `pengguna`     : klaim JWT pengguna yang sedang login
 */
import type { Cakupan, KlaimToken, SumberAudit } from '@osda/contracts';

/**
 * Klaim token akses. Selain klaim standar kontrak (`sub`, `org`, `roles`,
 * `perms`, `scopes`, `jti`, `sid`, `typ`), token membawa `memberId` & `nama`
 * supaya penulisan data tidak perlu satu query tambahan per permintaan.
 */
export type KlaimAkses = KlaimToken & {
  readonly memberId: string | null;
  readonly nama: string;
};

/** Pengguna yang sedang login, ditempelkan oleh `JwtAuthGuard`. */
export type PenggunaPermintaan = KlaimAkses;

/** Konteks aktor untuk audit (cerminan `KonteksAktor` pada kontrak). */
export interface KonteksAktorPermintaan {
  readonly userId: string | null;
  readonly organizationId: string | null;
  readonly sumber: SumberAudit;
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Permintaan Fastify yang sudah diperkaya guard & interceptor. */
export interface PermintaanBerkonteks {
  requestId: string;
  organizationId: string | null;
  pengguna?: PenggunaPermintaan;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  method: string;
  url: string;
  routeOptions?: { url?: string };
}
