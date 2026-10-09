/**
 * Pengunci global (advisory lock) PostgreSQL.
 *
 * Scheduler OSDA TIDAK memakai Redis/BullMQ. Untuk mencegah pekerjaan latar
 * (pengingat, tutup sesi absensi, terbit pengumuman terjadwal) berjalan dua
 * kali saat aplikasi dijalankan multi-instance, setiap siklus pekerjaan
 * mengambil advisory lock Postgres terlebih dahulu:
 *
 *   pg_try_advisory_xact_lock(kunci)
 *
 * Lock dilepas otomatis saat transaksi selesai (commit/rollback), sehingga
 * instance yang kalah cukup memasukkan diri dan menunggu siklus berikutnya.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { dalamTransaksi, sql, type Tx } from '@osda/db';

import { LayananDatabase } from './database.service.js';

/** Hasil eksekusi `db.execute` yang bentuknya berbeda antar driver. */
type HasilEksekusiMentah = { rows?: unknown[] } | unknown[];

function ambilBarisPertama(hasil: HasilEksekusiMentah): Record<string, unknown> | undefined {
  const baris = Array.isArray(hasil) ? hasil : (hasil.rows ?? []);
  return baris[0] as Record<string, unknown> | undefined;
}

@Injectable()
export class LayananPengunci {
  private readonly pencatat = new Logger('Pengunci');

  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  /**
   * Jalankan `pekerjaan` bila lock berhasil diambil.
   * Mengembalikan `null` bila instance lain sedang memegang lock.
   */
  async denganKunci<T>(kunci: number, pekerjaan: () => Promise<T>): Promise<T | null> {
    const db = await this.dbSvc.ambilDb();
    try {
      return await dalamTransaksi(db, async (tx: Tx) => {
        const hasil = (await tx.execute(
          sql`select pg_try_advisory_xact_lock(${kunci})::boolean as terkunci`,
        )) as HasilEksekusiMentah;
        const terkunci = ambilBarisPertama(hasil)?.terkunci === true;
        if (!terkunci) {
          this.pencatat.debug(`Lock ${kunci} dipegang instance lain — siklus dilewati.`);
          return null;
        }
        return await pekerjaan();
      });
    } catch (galat) {
      this.pencatat.warn(`Pekerjaan dengan lock ${kunci} gagal: ${(galat as Error).message}`);
      return null;
    }
  }
}
