/**
 * Modul konfigurasi global.
 *
 * Konfigurasi dihitung sekali (env sudah dimuat dari `.env` akar monorepo oleh
 * `muatEnvDariAkar()` sebelum aplikasi dibuat) lalu dibagikan ke seluruh modul
 * lewat token `KONFIGURASI`.
 */
import { Global, Module } from '@nestjs/common';

import {
  bacaKonfigurasi,
  KONFIGURASI,
  muatEnvDariAkar,
  cariEnvPath,
  type Konfigurasi,
} from './konfigurasi.js';

export const KONFIGURASI_PROVIDER = {
  provide: KONFIGURASI,
  useFactory: (): Konfigurasi => {
    muatEnvDariAkar();
    return bacaKonfigurasi();
  },
};

@Global()
@Module({
  providers: [KONFIGURASI_PROVIDER],
  exports: [KONFIGURASI],
})
export class KonfigurasiModul {}

export { bacaKonfigurasi, KONFIGURASI, muatEnvDariAkar, cariEnvPath };
export type { Konfigurasi };
