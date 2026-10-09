/**
 * DTO modul tugas. Skema inti (`SkemaBuatTugas`, `SkemaPerbaruiTugas`,
 * `SkemaUbahStatusTugas`, `SkemaVerifikasiTugas`, `SkemaFilterTugas`) dari kontrak.
 */
import { z } from 'zod';

/** Parameter path `:id` tugas. */
export const SkemaIdTugas = z.object({
  id: z.string().uuid('ID tugas harus UUID yang valid.'),
});

/** Komentar tugas (belum ada di kontrak). */
export const SkemaKomentarTugas = z.object({
  isi: z.string().min(2, 'Komentar minimal 2 karakter').max(2000),
});
export type PayloadKomentarTugas = z.infer<typeof SkemaKomentarTugas>;

/** Daftar riwayat aktivitas tugas. */
export const SkemaFilterAktivitas = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
