/**
 * Kontrak dokumen & penyimpanan objek.
 *
 * Berkas besar TIDAK disimpan di PostgreSQL. Database hanya menyimpan metadata
 * dan kunci objek; isi berkas berada di object storage yang privat dan diakses
 * melalui signed URL yang berumur pendek.
 */
import { z } from 'zod';
import { SkemaPaginasi, SkemaUrut, BENTUK_URUT,
} from './common.js';
import { KATEGORI_DOKUMEN_BAWAAN, STATUS_DOKUMEN, type StatusDokumen } from './enums.js';

/** MIME yang diizinkan untuk unggahan. */
export const MIME_IZIN = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

/** Ekstensi yang diizinkan, mengikuti daftar MIME di atas. */
export const EKSTENSI_IZIN = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
] as const;

/** Batas ukuran unggahan: 25 MB. */
export const MAKS_UKURAN_BYTES = 25 * 1024 * 1024;

export const SkemaBuatDokumen = z.object({
  judul: z.string().min(3, 'Judul minimal 3 karakter').max(200),
  kategori: z.string().min(2).max(40),
  deskripsi: z.string().max(2000).nullable().optional(),
  periodId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  meetingId: z.string().uuid().nullable().optional(),
  divisionId: z.string().uuid().nullable().optional(),
 /** Daftar anggota yang boleh membaca dokumen ini. Kosong = semua anggota. */
 AccessibleMemberIds: z.array(z.string().uuid()).default([]),
  perluPersetujuan: z.boolean().default(true),
});
export type PayloadBuatDokumen = z.infer<typeof SkemaBuatDokumen>;

export const SkemaUnggahVersi = z.object({
  storageKey: z.string().min(3).max(500),
  namaBerkas: z.string().min(1).max(255),
  ukuranBytes: z.number().int().positive().max(MAKS_UKURAN_BYTES),
  mime: z.enum(MIME_IZIN),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/, 'Checksum harus SHA-256 hex 64 karakter'),
  catatan: z.string().max(500).nullable().optional(),
  alasanRevisi: z.string().min(5).max(500).optional(),
});
export type PayloadUnggahVersi = z.infer<typeof SkemaUnggahVersi>;

export const SkemaPutuskanDokumen = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(1000).optional(),
});

export const SkemaFilterDokumen = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  kategori: z.string().max(40).optional(),
  status: z.enum(STATUS_DOKUMEN).optional(),
  programId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  divisionId: z.string().uuid().optional(),
  q: z.string().max(120).optional(),
}).extend(BENTUK_URUT);

export type FilterDokumen = z.infer<typeof SkemaFilterDokumen>;

export interface Dokumen {
  readonly id: string;
  readonly organizationId: string;
  readonly judul: string;
  readonly kategori: string;
  readonly deskripsi: string | null;
  readonly versi: number;
  readonly status: StatusDokumen;
  readonly ownerMemberId: string | null;
  readonly ownerNama: string | null;
  readonly periodId: string | null;
  readonly programId: string | null;
  readonly programNama: string | null;
  readonly eventId: string | null;
  readonly meetingId: string | null;
  readonly divisionId: string | null;
  readonly ukuranBytes: number;
  readonly mime: string | null;
  readonly namaBerkas: string | null;
  readonly perluPersetujuan: boolean;
  readonly jumlahAnggota: number;
  readonly dibuatPada: string;
  readonly disetujuiOleh: string | null;
  readonly disetujuiPada: string | null;
  readonly diarsipkanPada: string | null;
}

export interface VersiDokumen {
  readonly id: string;
  readonly versi: number;
  readonly storageKey: string;
  readonly namaBerkas: string;
  readonly ukuranBytes: number;
  readonly mime: string;
  readonly checksumSha256: string;
  readonly catatan: string | null;
  readonly alasanRevisi: string | null;
  readonly diunggahOleh: string | null;
  readonly diunggahOlehNama: string | null;
  readonly diunggahPada: string;
  readonly dikunci: boolean;
}

/** Signed URL berumur pendek untuk mengunduh berkas. */
export interface TautanUnduh {
  readonly url: string;
  readonly berlakuSampai: string;
  readonly namaBerkas: string;
}

/** Hasil pemeriksaan berkas sebelum diizinkan disimpan. */
export interface HasilValidasiBerkas {
  readonly diterima: boolean;
  readonly alasan?: string;
  readonly mimeAsli?: string;
  readonly ekstensiAsli?: string;
}
