/**
 * DTO modul program kerja. Skema inti dari kontrak; tambahan kebutuhan lokal.
 */
import { z } from 'zod';
import { SkemaTanggal } from '@osda/contracts';

/** Parameter path `:id` program. */
export const SkemaIdProgram = z.object({
  id: z.string().uuid('ID program harus UUID yang valid.'),
});

/** Tambah anggota tim program. */
export const SkemaTambahTim = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(100),
  peran: z.enum(['OWNER', 'KETUA', 'ANGGOTA', 'PENGAWAS', 'PEMBIAYA']).default('ANGGOTA'),
  deskripsiPeran: z.string().max(500).nullable().optional(),
});
export type PayloadTambahTim = z.infer<typeof SkemaTambahTim>;

/** Milestone / tonggak waktu (kontrak `SkemaTambahTonggakWaktu`). */
export { SkemaTambahTonggakWaktu } from '@osda/contracts';

/** Filter program (dari kontrak) plus rentang tanggal. */
export const SkemaCariProgram = z.object({
  status: z.string().max(20).optional(),
  divisionId: z.string().uuid().optional(),
  dari: SkemaTanggal.optional(),
  sampai: SkemaTanggal.optional(),
});
