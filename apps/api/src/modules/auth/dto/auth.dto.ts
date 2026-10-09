/**
 * Skema khusus modul auth yang belum ada di `@osda/contracts`.
 * Semua skema inti (masuk, tukar identitas, refresh) tetap diambil dari kontrak.
 */
import { z } from 'zod';

/** Badan permintaan segarkan token. */
export const SkemaSegarkan = z.object({
  refreshToken: z.string().min(20).max(500),
});
export type PayloadSegarkan = z.infer<typeof SkemaSegarkan>;

/** Badan permintaan keluar (opsional: mencabut semua sesi). */
export const SkemaKeluar = z.object({
  semuaSesi: z.boolean().default(false),
});
export type PayloadKeluar = z.infer<typeof SkemaKeluar>;

/** Header/konteks teknis sebuah permintaan masuk. */
export const SkemaKonteksMasuk = z.object({
  userAgent: z.string().max(400).nullable().optional(),
  ip: z.string().max(60).nullable().optional(),
});
