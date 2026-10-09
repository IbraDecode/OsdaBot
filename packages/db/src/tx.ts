/**
 * Helper batas transaksi (transaction boundary).
 *
 * Semua operasi yang mengubah uang atau memindahkan status WAJIB dibungkus
 * fungsi ini. Ini yang menjamin spec §44: "Transaction boundary harus jelas".
 *
 * Contoh:
 *   await dalamTransaksi(db, async (tx) => {
 *     const trx = await tx.insert(transactions).values(...).returning();
 *     await tx.insert(ledgerEntries).values(...);
 *   });
 */
import type { Db } from './client.js';

/** Bentuk transaction yang dikirim ke callback. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = any;

export interface OpsiTransaksi {
  /** Label untuk pelacakan log (mis. "POSTING_TRANSAKSI"). */
  label?: string;
  /** Level isolasi. Default READ COMMITTED cukup untuk PostgreSQL. */
  level?: 'read committed' | 'repeatable read' | 'serializable';
  /** Retry otomatis bila terjadi serialization failure. */
  maksPercobaan?: number;
  /** Jeda antar percobaan (ms), bertambah secara progresif. */
  jedaPercobaanMs?: number;
}

/**
 * Jalankan callback di dalam satu transaksi database.
 * Rollback otomatis bila callback melempar error.
 */
export async function dalamTransaksi<T>(
  db: Db,
  callback: (tx: Tx) => Promise<T>,
  opsi: OpsiTransaksi = {},
): Promise<T> {
  const maks = opsi.maksPercobaan ?? 3;
  let percobaanTerakhir: unknown;

  for (let percobaan = 1; percobaan <= maks; percobaan++) {
    try {
      return await db.transaction(callback as never, {
        isolationLevel: opsi.level,
        accessMode: 'read write',
        deferrable: false,
      } as never);
    } catch (e) {
      percobaanTerakhir = e;
      // 40001 = serialization_failure, 40P01 = deadlock_detected
      const kode = (e as { code?: string })?.code;
      const bisaDiulang = kode === '40001' || kode === '40P01';
      if (!bisaDiulang || percobaan === maks) throw e;
      const jeda = (opsi.jedaPercobaanMs ?? 50) * 2 ** (percobaan - 1);
      await new Promise((r) => setTimeout(r, jeda));
    }
  }
  throw percobaanTerakhir;
}

/**
 * Jalankan callback di dalam transaksi SERIALIZABLE bila memang butuh
 * strict consistency (mis. penguncian saldo kas).
 */
export function dalamTransaksiSerializable<T>(
  db: Db,
  callback: (tx: Tx) => Promise<T>,
  label?: string,
): Promise<T> {
  return dalamTransaksi(db, callback, { level: 'serializable', label, maksPercobaan: 5 });
}

/** Batonkan fungsi tx menjadi implementasi repository yang bisa diuji. */
export function denganTx<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
