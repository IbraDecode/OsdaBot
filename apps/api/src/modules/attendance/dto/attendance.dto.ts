/**
 * DTO modul absensi. Skema inti (`SkemaBuatSesi`, `SkemaBukaSesi`,
 * `SkemaTutupSesi`, `SkemaCatatHadir`, `SkemaVerifikasiQr`) dari kontrak.
 */
import { z } from 'zod';

/** Parameter path `:id` untuk sesi absensi. */
export const SkemaIdSesi = z.object({
  id: z.string().uuid('ID sesi harus UUID yang valid.'),
});
export type IdSesi = z.infer<typeof SkemaIdSesi>;

/** Parameter path `:id` anggota (dipakai endpoint absen manual). */
export const SkemaIdUntukSesi = z.object({
  id: z.string().uuid('ID harus UUID yang valid.'),
});
