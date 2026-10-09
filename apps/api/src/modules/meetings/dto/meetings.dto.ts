/**
 * DTO modul rapat. Skema inti (`SkemaBuatRapat`, `SkemaTambahAgenda`,
 * `SkemaTambahPeserta`, `SkemaBuatNotulen`, `SkemaPutuskanNotulen`) dari kontrak.
 */
import { z } from 'zod';

/** Parameter path `:id` rapat. */
export const SkemaIdRapat = z.object({
  id: z.string().uuid('ID rapat harus UUID yang valid.'),
});

/** Parameter path `:id` notulen. */
export const SkemaIdNotulen = z.object({
  mid: z.string().uuid('ID notulen harus UUID yang valid.'),
});

/** Query daftar rapat (filter dari kontrak + `q`). */
export const SkemaCariRapat = z.object({
  q: z.string().max(120).optional(),
  status: z.string().max(20).optional(),
  jenis: z.string().max(20).optional(),
  dari: z.string().date().optional(),
  sampai: z.string().date().optional(),
});
