/**
 * DTO modul anggota — skema tambahan yang belum ada di `@osda/contracts`.
 * Skema inti (`SkemaDaftarAnggota`, `SkemaPerbaruiAnggota`, `SkemaFilterAnggota`,
 * `SkemaAlasanArsip`) selalu diambil dari kontrak.
 */
import { z } from 'zod';
import { SkemaAlasanArsip, SkemaPaginasi, SkemaTanggal } from '@osda/contracts';

/** Parameter path `:id`. */
export const SkemaIdAnggota = z.object({
  id: z.string().uuid('ID anggota harus UUID yang valid.'),
});
export type IdAnggota = z.infer<typeof SkemaIdAnggota>;

/** Arsipkan anggota (soft delete) — WAJIB dengan alasan. */
export const SkemaArsipkanAnggota = SkemaAlasanArsip.extend({
  status: z.enum(['ALUMNI', 'INACTIVE', 'REMOVED']).default('REMOVED'),
});
export type PayloadArsipkanAnggota = z.infer<typeof SkemaArsipkanAnggota>;

/** Query rekap kehadiran satu anggota. */
export const SkemaRekapAnggota = z.object({
  dari: SkemaTanggal.optional(),
  sampai: SkemaTanggal.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type RekapAnggotaQuery = z.infer<typeof SkemaRekapAnggota>;

/** Filter ringkasan anggota (dipakai lintas modul). */
export const SkemaCariAnggota = SkemaPaginasi.extend({
  q: z.string().max(120).optional(),
  divisionId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALUMNI', 'SUSPENDED', 'REMOVED']).optional(),
});
