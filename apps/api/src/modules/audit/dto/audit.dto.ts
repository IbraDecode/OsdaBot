/**
 * DTO audit log.
 */
import { z } from 'zod';

/** Filter daftar audit log. */
export const SkemaFilterAudit = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  aksi: z.string().max(80).optional(),
  entitasTabel: z.string().max(80).optional(),
  actorId: z.string().uuid().optional(),
  dari: z.string().date().optional(),
  sampai: z.string().date().optional(),
  /** Pencarian bebas pada kolom `aksi` dan `entitasTabel`. */
  q: z.string().max(120).optional(),
});

export type FilterAudit = z.infer<typeof SkemaFilterAudit>;

/** Parameter path `:id` log audit. */
export const SkemaIdAudit = z.object({
  id: z.string().uuid('ID audit harus UUID yang valid.'),
});
