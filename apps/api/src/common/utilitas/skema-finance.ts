/**
 * Skema filter khusus modul keuangan.
 *
 * Skema inti (SkemaFilterTransaksi, SkemaFilterLedger) berada di
 * `@osda/contracts`. Skema di sini menambahkan pengayaan untuk parameter
 * query yang hanya dipakai API keuangan.
 */
import { SkemaFilterAnggaran, SkemaFilterTransaksi } from '@osda/contracts';

export { SkemaFilterAnggaran, SkemaFilterTransaksi };

/** Filter ledger: bawaan dari kontrak + rentang tanggal. */
export const SkemaFilterLedgerKueri = SkemaFilterTransaksi;

/** Filter kas: ringkasan per mkategori & periode keuangan. */
export const SkemaFilterKas = SkemaFilterTransaksi;

/** Filter laporan keuangan. */
export const SkemaFilterLaporanKeuangan = SkemaFilterAnggaran;

/** Parameter ekspor laporan. */
export const SkemaEksporKeuangan = SkemaFilterTransaksi.extend({
  format: z.enum(['CSV', 'XLSX', 'PDF']).default('CSV'),
});

import { z } from 'zod';
