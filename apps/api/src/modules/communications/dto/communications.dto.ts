/**
 * DTO modul komunikasi (pengumuman & kampanye).
 */
import { z } from 'zod';

/** Parameter path `:id` pengumuman. */
export const SkemaIdPengumuman = z.object({
  id: z.string().uuid('ID pengumuman harus UUID yang valid.'),
});

/** Buat pengumuman. */
export const SkemaBuatPengumuman = z.object({
  judul: z.string().min(3, 'Judul minimal 3 karakter').max(200),
  isi: z.string().min(10, 'Isi minimal 10 karakter').max(5000),
  audiens: z.enum(['ALL', 'BOARD', 'DIVISION', 'EVENT', 'CUSTOM']).default('ALL'),
  divisionIds: z.array(z.string().uuid()).default([]),
  jabatanIds: z.array(z.string().uuid()).default([]),
  memberIds: z.array(z.string().uuid()).default([]),
  kanal: z.array(z.enum(['WEB', 'MOBILE', 'WHATSAPP', 'EMAIL'])).min(1, 'Pilih minimal satu kanal'),
  prioritas: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  perluPersetujuan: z.boolean().default(true),
  jadwalkanPada: z.string().datetime().nullable().optional(),
  lampiranDokumenIds: z.array(z.string().uuid()).default([]),
  pin: z.boolean().default(false),
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
});

export type PayloadBuatPengumumanLokal = z.infer<typeof SkemaBuatPengumuman>;

/** Putuskan pengumuman. */
export const SkemaPutuskanPengumuman = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(1000).optional(),
});

/** Terbitkan pengumuman sekarang. */
export const SkemaTerbitkan = z.object({
  sekarang: z.boolean().default(true),
  lewatiKanal: z.array(z.enum(['WEB', 'MOBILE', 'WHATSAPP', 'EMAIL'])).default([]),
});

/** Buat kampanye. */
export const SkemaBuatKampanye = z.object({
  nama: z.string().min(3, 'Nama kampanye minimal 3 karakter').max(160),
  deskripsi: z.string().max(2000).nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  mulaiPada: z.string().date(),
  selesaiPada: z.string().date(),
});

export type PayloadBuatKampanye = z.infer<typeof SkemaBuatKampanye>;

/** Filter daftar pengumuman. */
export const SkemaFilterPengumuman = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']).optional(),
  audiens: z.enum(['ALL', 'BOARD', 'DIVISION', 'EVENT', 'CUSTOM']).optional(),
  programId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  q: z.string().max(120).optional(),
});

export type FilterPengumuman = z.infer<typeof SkemaFilterPengumuman>;

/** Parameter path `:id` kampanye. */
export const SkemaIdKampanye = z.object({
  id: z.string().uuid('ID kampanye harus UUID yang valid.'),
});
