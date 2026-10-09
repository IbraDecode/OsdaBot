/**
 * `CurrentUserInterceptor` — memperkaya setiap permintaan dengan:
 *   - `requestId`      : dari header `x-request-id` atau dihasilkan baru
 *   - `organizationId` : organisasi aktif (dipilih guard/organisasi default)
 *
 * `requestId` selalu dikembalikan pada respons galat sehingga mudah dilacak di
 * log & audit tanpa membocokan data internal ke klien.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { HEADER_ORGANISASI } from '../../auth/guards/organization.guard.js';
import { ambilPengguna } from '../utilitas/pengguna-permintaan.js';
import type { PermintaanBerkonteks } from '../tipe.js';

/** Header identitas permintaan. */
export const HEADER_REQUEST_ID = 'x-request-id';

@Injectable()
export class CurrentUserInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const permintaan = context.switchToHttp().getRequest<PermintaanBerkonteks>();
    if (permintaan) {
      permintaan.requestId = this.requestIdDari(permintaan);
      permintaan.organizationId ??=
        this.bacaHeader(permintaan, HEADER_ORGANISASI) ??
        ambilPengguna(permintaan)?.org[0] ??
        null;
    }
    return next.handle().pipe(
      tap(() => {
        // tempat terpasang bila diinginkan jejak waktu respons
      }),
    );
  }

  /** ID permintaan: pakai dari klien bila ada (dibatasi panjang), jika tidak buat baru. */
  private requestIdDari(permintaan: PermintaanBerkonteks): string {
    const dariHeader = this.bacaHeader(permintaan, HEADER_REQUEST_ID);
    if (dariHeader && dariHeader.length <= 64) return dariHeader;
    return nanoid(16);
  }

  private bacaHeader(permintaan: PermintaanBerkonteks, nama: string): string | undefined {
    const nilai = permintaan.headers?.[nama] ?? permintaan.headers?.[nama.toUpperCase()];
    if (Array.isArray(nilai)) return nilai[0];
    return typeof nilai === 'string' && nilai.length > 0 ? nilai : undefined;
  }
}
