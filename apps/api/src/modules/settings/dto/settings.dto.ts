/**
 * DTO modul pengaturan (organisasi, periode, struktur, feature flag).
 */
import { z } from 'zod';

/** Organisasi baru. */
export const SkemaSimpanOrganisasi = z.object({
  nama: z.string().min(2).max(160),
  singkat: z.string().min(2).max(20),
  jenis: z.enum(['OSIS', 'PRUKID', 'YOUTH', 'OTHER']).default('OSIS'),
  namaSekolah: z.string().min(2).max(160),
  npsn: z.string().max(20).nullable().optional(),
  alamat: z.string().max(400).nullable().optional(),
  kodePos: z.string().regex(/^\d{5}$/, 'Kode pos harus 5 digit').nullable().optional(),
  telepon: z.string().regex(/^62\d{8,15}$/, 'Nomor telepon harus format 62xxxxxxxxxx').nullable().optional(),
  email: z.string().email().nullable().optional(),
  zonaWaktu: z.string().default('Asia/Makassar'),
});

/** Divisi baru. */
export const SkemaTambahDivisi = z.object({
  organizationId: z.string().uuid(),
  periodId: z.string().uuid(),
  nama: z.string().min(2).max(100),
  kode: z.string().min(2).max(20),
  deskripsi: z.string().max(500).nullable().optional(),
  idDivisiInduk: z.string().uuid().nullable().optional(),
  koordinatorMemberId: z.string().uuid().nullable().optional(),
});

/** Jabatan baru. */
export const SkemaTambahJabatan = z.object({
  organizationId: z.string().uuid(),
  nama: z.string().min(2).max(100),
  kode: z.string().min(2).max(30),
  tingkat: z.enum(['BOARD', 'COORDINATOR', 'STAFF', 'MEMBER']).default('MEMBER'),
  urutan: z.number().int().min(0).max(999).default(100),
  deskripsi: z.string().max(500).nullable().optional(),
});

/** Periode kepengurusan baru. */
export const SkemaPeriodeBaru = z.object({
  organizationId: z.string().uuid(),
  nama: z.string().min(4).max(40),
  mulaiPada: z.string().date(),
  selesaiPada: z.string().date(),
});

/** Pengaturan satu kunci. */
export const SkemaSimpanPengaturan = z.object({
  kunci: z.string().min(2).max(80),
  nilai: z.string().min(1).max(4000),
  deskripsi: z.string().max(500).optional(),
  tipe: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
});

/** Feature flag. */
export const SkemaSimpanFeatureFlag = z.object({
  status: z.enum(['ON', 'OFF']),
  persentase: z.number().int().min(0).max(100).optional(),
});

/** Parameter path `:id` feature flag. */
export const SkemaIdFlag = z.object({
  id: z.string().uuid('ID feature flag harus UUID yang valid.'),
});

/** Nama lama yang dipakai controller sama dengan nama DTO. */
export const SkemaIdPeriode = SkemaPeriodeBaru;
