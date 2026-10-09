/**
 * DTO modul pengguna (profil & preferensi notifikasi).
 */
import { z } from 'zod';

/** Permintaan perbarui profil milik sendiri. */
export const SkemaPerbaruiProfil = z.object({
  nama: z.string().min(2).max(120).optional(),
  telepon: z.string().regex(/^62\d{8,15}$/, 'Nomor telepon harus format 62xxxxxxxxxx').nullable().optional(),
  bahasa: z.enum(['id', 'en']).optional(),
  /** Preferensi notifikasi per jenis & metode. */
  preferensiNotifikasi: z
    .record(
      z.enum(['ATTENDANCE', 'TASK', 'MEETING', 'PROGRAM', 'FINANCE', 'APPROVAL', 'ANNOUNCEMENT', 'SYSTEM']),
      z.object({
        inApp: z.boolean().default(true),
        push: z.boolean().default(true),
        whatsapp: z.boolean().default(false),
      }),
    )
    .optional(),
});

export type PayloadPerbaruiProfil = z.infer<typeof SkemaPerbaruiProfil>;

/** Parameter query dasbor (kosongkan untuk periode aktif). */
export const SkemaKueriDasbor = z.object({
  /** Label tanggal penggal "YYYY-MM" agar bisa melihat masa lalu. */
  bulan: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  /** Paksa suatu ruang kerja (hanya untuk pengujian/koreksi). */
  ruangKerja: z
    .enum(['EXECUTIVE', 'OPERATIONS', 'ADMINISTRATION', 'FINANCE', 'COMMUNICATION', 'DIVISION', 'PERSONAL', 'SYSTEM'])
    .optional(),
});

export type KueriDasbor = z.infer<typeof SkemaKueriDasbor>;

/** Parameter path `:id` anggota di organisasi. */
export const SkemaIdAnggota = z.object({
  id: z.string().uuid('ID anggota harus UUID yang valid.'),
});
