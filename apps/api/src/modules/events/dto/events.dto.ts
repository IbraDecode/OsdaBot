/**
 * DTO modul acara. Skema inti (`SkemaBuatAcara`, `SkemaFilterAcara`,
 * `SkemaTambahPesertaAcara`) berasal dari `@osda/contracts`.
 */
import { z } from 'zod';

/** Parameter path `:id` acara. */
export const SkemaIdAcara = z.object({
  id: z.string().uuid('ID acara harus UUID yang valid.'),
});

/** Query kalender: rentang tanggal + tipe entitas. */
export const SkemaKalender = z.object({
  dari: z.string().date().optional(),
  sampai: z.string().date().optional(),
  tipe: z.enum(['MEETING', 'EVENT', 'DEADLINE', 'ATTENDANCE', 'PUBLICATION', 'PERIOD']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PayloadKalender = z.infer<typeof SkemaKalender>;
