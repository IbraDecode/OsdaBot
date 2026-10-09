/**
 * `AuditInterceptor` — mencatat permintaan yang MENGUBAH data ke `audit_logs`.
 *
 * Yang dicatat hanya operasi tulis (POST/PATCH/PUT/DELETE) milik pengguna
 * terautentikasi, bersama `requestId` agar bisa disambungkan ke log aplikasi.
 * Nilai rahasia (kata sandi, token, secret) TIDAK pernah dicatat — hanya
 * metadata teknis seperti metode, rute, kode status, dan identitas pengguna.
 *
 * Penulisan audit bersifat fire-and-forget: kegagalan menulis audit tidak
 * boleh membuat permintaan pengguna gagal.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { auditLogs } from '@osda/db';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { KUNCI_AUDIT } from '../decorators/izin.decorator.js';
import { KUNCI_PUBLIK } from '../decorators/publik.decorator.js';
import type { PermintaanBerkonteks } from '../tipe.js';
import { LayananDatabase } from '../../database/database.service.js';
import { ambilPengguna } from '../utilitas/pengguna-permintaan.js';

/** Aksi audit bawaan menurut pola rute. */
const PETA_AKSI: readonly (readonly [RegExp, string])[] = [
  [/\/members$/, 'MEMBER_CREATED'],
  [/\/members\/[^/]+\/arsipkan$/, 'MEMBER_ARCHIVED'],
  [/\/members\//, 'MEMBER_UPDATED'],
  [/\/attendance\/sessions\/[^/]+\/absen$/, 'ATTENDANCE_RECORDED'],
  [/\/attendance\/sessions\/[^/]+\/tutup$/, 'ATTENDANCE_SESSION_CLOSED'],
  [/\/attendance\/sessions$/, 'ATTENDANCE_SESSION_CLOSED'],
  [/\/meetings$/, 'MEETING_CREATED'],
  [/\/meetings\/[^/]+\/minutes\/[^/]+\/approve$/, 'MINUTES_APPROVED'],
  [/\/meetings\//, 'MEETING_UPDATED'],
  [/\/tasks\/[^/]+\/verifikasi$/, 'TASK_VERIFIED'],
  [/\/tasks\/[^/]+\/status$/, 'TASK_ASSIGNED'],
  [/\/tasks$/, 'TASK_ASSIGNED'],
  [/\/programs$/, 'PROGRAM_CREATED'],
  [/\/programs\/[^/]+\/status$/, 'PROGRAM_APPROVED'],
  [/\/programs\//, 'PROGRAM_CREATED'],
  [/\/finance\/transactions$/, 'EXPENSE_CREATED'],
  [/\/finance\/transactions\/[^/]+\/approve$/, 'EXPENSE_APPROVED'],
  [/\/webhooks\/payment$/, 'PAYMENT_SETTLED'],
  [/\/announcements$/, 'ANNOUNCEMENT_PUBLISHED'],
  [/\/announcements\/[^/]+\/publish$/, 'ANNOUNCEMENT_PUBLISHED'],
  [/\/periods\/[^/]+\/arsipkan$/, 'PERIOD_ARCHIVED'],
  [/\/settings/, 'SETTINGS_CHANGED'],
  [/\/users$/, 'USER_CREATED'],
  [/\/users\//, 'USER_UPDATED'],
];

const METODE_TULIS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly pencatat = new Logger('Audit');

  constructor(
    private readonly reflector: Reflector,
    private readonly dbSvc: LayananDatabase,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const permintaan = context.switchToHttp().getRequest<PermintaanBerkonteks>();
    const publik =
      this.reflector.getAllAndOverride<boolean>(KUNCI_PUBLIK, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    const metode = String(permintaan?.method ?? 'GET').toUpperCase();
    const pengguna = ambilPengguna(permintaan);

    const perluDicatat =
      !publik && permintaan != null && pengguna != null && METODE_TULIS.has(metode);

    if (!perluDicatat) return next.handle();

    const aksiDariMetadata = this.reflector.getAllAndOverride<string>(KUNCI_AUDIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    const rute = this.ruteDari(permintaan);

    return next.handle().pipe(
      tap(() => {
        void this.catat({
          permintaan,
          aksi: aksiDariMetadata ?? this.tentukanAksi(metode, rute),
          berhasil: true,
          tabel: this.tabelDari(rute),
        });
      }),
      catchError((galat: unknown) => {
        void this.catat({
          permintaan,
          aksi: aksiDariMetadata ?? this.tentukanAksi(metode, rute),
          berhasil: false,
          pesanGalat: (galat as Error)?.message ?? 'galat tidak diketahui',
          tabel: this.tabelDari(rute),
        });
        return throwError(() => galat);
      }),
    );
  }

  /** Tulis entri audit (tidak melempar galat ke pengguna). */
  private async catat(data: {
    permintaan: PermintaanBerkonteks;
    aksi: string;
    berhasil: boolean;
    pesanGalat?: string;
    tabel: string;
  }): Promise<void> {
    try {
      const db = await this.dbSvc.ambilDb();
      await db.insert(auditLogs).values({
        organizationId: data.permintaan.organizationId,
        aksi: data.aksi,
        entitasTabel: data.tabel,
        actorId: ambilPengguna(data.permintaan)?.sub ?? null,
        actorMemberId: ambilPengguna(data.permintaan)?.memberId ?? null,
        sumber: 'API',
        ip: typeof data.permintaan.ip === 'string' ? data.permintaan.ip : null,
        userAgent: this.bacaHeader(data.permintaan, 'user-agent'),
        requestId: data.permintaan.requestId,
        sebelum: null,
        sesudah: null,
        fieldDiubah: null,
        berhasil: data.berhasil,
        pesanGalat: data.pesanGalat ?? null,
      });
    } catch (galat) {
      this.pencatat.warn(`Gagal menulis audit: ${(galat as Error).message}`);
    }
  }

  private tentukanAksi(metode: string, rute: string): string {
    for (const [pola, aksi] of PETA_AKSI) {
      if (pola.test(rute)) return aksi;
    }
    if (metode === 'DELETE') return 'SETTINGS_CHANGED';
    return 'SETTINGS_CHANGED';
  }

  private tabelDari(rute: string): string {
    const bagian = rute.split('?')[0]?.split('/').filter(Boolean) ?? [];
    const idx = bagian.findIndex((b) => b === 'api' || b === 'v1');
    const mulaimu = idx >= 0 ? idx + 2 : 0;
    return bagian[mulaimu] ?? 'api';
  }

  private ruteDari(permintaan: PermintaanBerkonteks): string {
    return permintaan.routeOptions?.url ?? permintaan.url ?? '';
  }

  private bacaHeader(permintaan: PermintaanBerkonteks, nama: string): string | null {
    const nilai = permintaan.headers?.[nama];
    if (Array.isArray(nilai)) return nilai[0] ?? null;
    return typeof nilai === 'string' ? nilai : null;
  }
}
