/**
 * Scheduler latar (TANPA Redis / BullMQ).
 *
 * Setiap siklus pekerjaan mengambil advisory lock Postgres
 * (`pg_try_advisory_xact_lock`) lebih dulu, sehingga ketika aplikasi dijalankan
 * multi-instance hanya satu instance yang bekerja pada siklus tersebut.
 * Instance yang kalah langsung melewati siklus tanpa error.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import { attendanceSessions } from '@osda/db';

import type { Konfigurasi } from '../../config/konfigurasi.js';
import { LayananDatabase } from '../../database/database.service.js';
import { LayananPengunci } from '../../database/pengunci.service.js';

/** Kendali penjadwal yang dikembalikan ke `main.ts`. */
export interface KendaliPenjadwal {
  readonly timer: NodeJS.Timeout | null;
  hentikan(): void;
}

const TIDAK_ADA_JADWAL: KendaliPenjadwal = { timer: null, hentikan: () => undefined };

@Injectable()
export class SchedulerService {
  private readonly pencatat = new Logger('Scheduler');

  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
    @Inject(LayananPengunci) private readonly pengunci: LayananPengunci,
  ) {}

  /** Jalankan penjadwal bila `SCHEDULER_AKTIF` bernilai true. */
  static mulai(
    app: NestFastifyApplication,
    konfigurasi: Konfigurasi,
  ): KendaliPenjadwal {
    if (!konfigurasi.SCHEDULER_AKTIF) {
      Logger.log('Scheduler tidak diaktifkan (SCHEDULER_AKTIF=false).');
      return TIDAK_ADA_JADWAL;
    }

    const dbSvc = app.get(LayananDatabase);
    const pengunci = app.get(LayananPengunci);
    const layanan = new SchedulerService(dbSvc, pengunci);
    const intervalMs = konfigurasi.SCHEDULER_INTERVAL_DETIK * 1000;

    const timer = setInterval(() => {
      void pengunci
        .denganKunci(konfigurasi.ID_KUNCI_SCHEDULER, () => layanan.jalankanSiklus())
        .catch((galat: unknown) => {
          Logger.warn(`Siklus scheduler gagal: ${(galat as Error).message}`);
        });
    }, intervalMs);

    timer.unref?.();
    Logger.log(
      `Scheduler aktif setiap ${konfigurasi.SCHEDULER_INTERVAL_DETIK} detik ` +
        `(advisory lock ${konfigurasi.ID_KUNCI_SCHEDULER}).`,
    );

    return {
      timer,
      hentikan: () => {
        clearInterval(timer);
        Logger.log('Scheduler dihentikan.');
      },
    };
  }

  /** Satu siklus pekerjaan latar. */
  async jalankanSiklus(): Promise<{ sesiDitutup: number }> {
    const sesiDitutup = await this.tutupSesiKedaluwarsa();
    if (sesiDitutup > 0) {
      this.pencatat.log(`${sesiDitutup} sesi absensi ditutup otomatis.`);
    }
    return { sesiDitutup };
  }

  /**
   * Tutup sesi absensi yang waktunya sudah lewat tetapi masih berstatus OPEN.
   * Histori kehadiran tetap utuh — hanya status sesi yang diperbarui.
   */
  private async tutupSesiKedaluwarsa(): Promise<number> {
    const db = await this.dbSvc.ambilDb();
    const sekarang = new Date().toISOString();

    const hasil = await db
      .update(attendanceSessions)
      .set({ status: 'CLOSED', selesaiPada: sekarang.slice(0, 10) })
      .where(
        and(
          eq(attendanceSessions.status, 'OPEN'),
          sql`${attendanceSessions.selesaiPada} is not null`,
          sql`${attendanceSessions.selesaiPada} < ${sekarang}`,
        ),
      )
      .returning({ id: attendanceSessions.id });

    return hasil.length;
  }
}

/** Titik masuk yang dipakai `main.ts`. */
export function mulaiScheduler(
  app: NestFastifyApplication,
  konfigurasi: Konfigurasi,
): KendaliPenjadwal {
  return SchedulerService.mulai(app, konfigurasi);
}

export function hentikanScheduler(kendali: KendaliPenjadwal): void {
  kendali.hentikan();
}
