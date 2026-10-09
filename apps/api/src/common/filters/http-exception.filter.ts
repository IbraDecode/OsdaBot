/**
 * `HttpExceptionFilter` — satu-satunya bentuk galat yang keluar dari API:
 *
 *   { "error": { "code": "<KODE_ERROR>", "message": "...", "requestId": "..." } }
 *
 * persis seperti kontrak `BentukError` di `@osda/contracts`. Tidak ada
 * pesan mentah driver database yang bocor ke klien: galat internal selalu
 * dikembalikan sebagai `INTERNAL_ERROR` + `requestId`, sedangkan detailnya
 * hanya tercatat di log server.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';

import { HTTP_DARI_KODE_ERROR, KODE_ERROR, type KodeError } from '@osda/contracts';

import { GalatApi } from '../galat.js';
import type { PermintaanBerkonteks } from '../tipe.js';

/** Peta status HTTP → kode error (dipakai untuk HttpException biasa). */
const KODE_DARI_STATUS: Readonly<Record<number, KodeError>> = Object.fromEntries(
  (Object.keys(HTTP_DARI_KODE_ERROR) as KodeError[]).map((kode) => [
    HTTP_DARI_KODE_ERROR[kode],
    kode,
  ]),
) as Record<number, KodeError>;

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly pencatat = new Logger('Galat');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const respons = ctx.getResponse<{
      status: (kode: number) => { send: (isi: unknown) => void };
      header: (nama: string, nilai: string) => unknown;
      raw: unknown;
    }>();
    const permintaan = ctx.getRequest<PermintaanBerkonteks | undefined>();
    const requestId = permintaan?.requestId ?? 'tidak-diketahui';

    const { kode, status, pesan, detail } = this.pecahkan(exception);

    if (status >= 500) {
      this.pencatat.error(
        `[${requestId}] ${kode} ${pesan}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.pencatat.warn(`[${requestId}] ${kode} ${pesan}`);
    }

    if (typeof respons?.header === 'function') {
      respons.header('x-request-id', requestId);
    }

    respons.status(status).send({
      error: {
        code: kode,
        message: pesan,
        requestId,
        ...(detail === undefined ? {} : { detail }),
      },
    });
  }

  /** Ubah berbagai jenis galat menjadi kode error + status HTTP yang konsisten. */
  private pecahkan(exception: unknown): {
    kode: KodeError;
    status: number;
    pesan: string;
    detail?: unknown;
  } {
    if (exception instanceof GalatApi) {
      return {
        kode: exception.kode,
        status: exception.getStatus(),
        pesan: exception.pesan,
        detail: exception.detail,
      };
    }

    if (exception instanceof ZodError) {
      return {
        kode: 'VALIDATION_FAILED',
        status: 400,
        pesan: 'Data yang dikirim tidak valid.',
        detail: exception.issues.map((isu) => ({
          path: isu.path.join('.'),
          kode: isu.code,
          pesan: isu.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const isi = exception.getResponse();
      const pesan = this.pesanDariIsi(isi) ?? exception.message;
      return {
        kode: KODE_DARI_STATUS[status] ?? this.kodeDariStatus(status),
        status,
        pesan,
        detail: this.detailDariIsi(isi),
      };
    }

    return {
      kode: 'INTERNAL_ERROR',
      status: 500,
      pesan: 'Terjadi galat tak terduga di server.',
    };
  }

  private pesanDariIsi(isi: unknown): string | undefined {
    if (typeof isi === 'string') return isi;
    if (typeof isi === 'object' && isi !== null) {
      const obj = isi as { message?: unknown; error?: unknown };
      if (typeof obj.error === 'object' && obj.error !== null) {
        const dalam = (obj.error as { message?: unknown }).message;
        if (typeof dalam === 'string') return dalam;
      }
      if (typeof obj.message === 'string') return obj.message;
      if (Array.isArray(obj.message) && typeof obj.message[0] === 'string') return obj.message[0];
    }
    return undefined;
  }

  private detailDariIsi(isi: unknown): unknown {
    if (typeof isi === 'object' && isi !== null) {
      const obj = isi as { error?: unknown };
      if (typeof obj.error === 'object' && obj.error !== null) {
        const dalam = obj.error as { detail?: unknown };
        if (dalam.detail !== undefined) return dalam.detail;
      }
    }
    return undefined;
  }

  private kodeDariStatus(status: number): KodeError {
    if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) return 'PAYLOAD_TOO_LARGE';
    if (status === HttpStatus.UNSUPPORTED_MEDIA_TYPE) return 'UNSUPPORTED_FILE_TYPE';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHENTICATED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.CONFLICT) return 'CONFLICT';
    return 'UNPROCESSABLE';
  }
}
