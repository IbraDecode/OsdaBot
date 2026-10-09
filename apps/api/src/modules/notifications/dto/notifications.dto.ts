/**
 * DTO notifikasi — membungkus skema filter dari `@osda/contracts`.
 */
import { z } from 'zod';

/** Parameter path `:id` notifikasi. */
export const SkemaIdNotifikasi = z.object({
  id: z.string().uuid('ID notifikasi harus UUID yang valid.'),
});

/** Parameter query daftar notifikasi. */
export const SkemaKueriNotifikasi = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  belumDibaca: z.coerce.boolean().optional(),
  jenis: z
    .enum([
      'ATTENDANCE',
      'TASK',
      'MEETING',
      'PROGRAM',
      'FINANCE',
      'APPROVAL',
      'ANNOUNCEMENT',
      'SYSTEM',
    ])
    .optional(),
});

export type KueriNotifikasi = z.infer<typeof SkemaKueriNotifikasi>;

/** Permintaan membuat notifikasi (dipakai modul internal & scheduler). */
export const SkemaBuatNotifikasi = z.object({
  userId: z.string().uuid(),
  jenis: z.enum([
    'ATTENDANCE',
    'TASK',
    'MEETING',
    'PROGRAM',
    'FINANCE',
    'APPROVAL',
    'ANNOUNCEMENT',
    'SYSTEM',
  ]),
  judul: z.string().min(3).max(200),
  isi: z.string().min(3).max(2000),
  prioritas: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  entitasJenis: z.string().max(40).nullable().optional(),
  entitasId: z.string().uuid().nullable().optional(),
  actions: z
    .array(z.object({ label: z.string().max(60), url: z.string().max(500), utama: z.boolean().optional() }))
    .default([]),
  dedupKey: z.string().max(120).nullable().optional(),
});

export type PayloadBuatNotifikasi = z.infer<typeof SkemaBuatNotifikasi>;
