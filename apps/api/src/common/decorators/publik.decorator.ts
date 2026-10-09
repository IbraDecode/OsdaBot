/**
 * Dekorator `@Publk()` — menandai endpoint yang TIDAK butuh autentikasi
 * (login, refresh, webhook, health check, dokumentasi).
 */
import { SetMetadata } from '@nestjs/common';

/** Kunci metadata publik. */
export const KUNCI_PUBLIK = 'osda:publik';

/** Lewati `JwtAuthGuard`, `IzinGuard`, dan `OrganizationGuard`. */
export const Publik = () => SetMetadata(KUNCI_PUBLIK, true);
