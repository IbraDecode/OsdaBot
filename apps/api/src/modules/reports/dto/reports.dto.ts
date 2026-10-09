/**
 * DTO modul laporan.
 */
import { z } from 'zod';

/** Parameter path `:id` (tidak dipakai — laporan selalu agregat). */
export const SkemaIdLaporan = z.object({
  id: z.string().uuid('ID laporan harus UUID yang valid.'),
});

/** Parameter kueri laporan: periode, status, format, jenis. */
export const SkemaKueriLaporan = z.object({
  dari: z.string().date().optional(),
  sampai: z.string().date().optional(),
  status: z.string().max(40).optional(),
  /** Jumlah baris maksimum pada satu laporan (0 = semua). */
  limit: z.coerce.number().int().min(1).max(5000).default(500),
  /** Jenis laporan untuk ekspor. */
  jenis: z.enum(['ABSENSI', 'ANGGOTA', 'KEUANGAN', 'PROGRAM', 'TUGAS']).optional(),
  /** Format ekspor (hanya diperbolehkan dengan izin `report.export`). */
  format: z.enum(['CSV', 'XLSX', 'PDF']).default('CSV'),
});

export type KueriLaporan = z.infer<typeof SkemaKueriLaporan>;
