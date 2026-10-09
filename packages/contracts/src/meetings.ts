/**
 * Kontrak rapat, agenda, dan notulen.
 */
import { z } from 'zod';
import { SkemaPaginasi, SkemaRentangTanggal, SkemaUrut, SkemaWaktu, BENTUK_URUT,
} from './common.js';
import { STATUS_NOTULEN, STATUS_RAPAT, type StatusNotulen, type StatusRapat } from './enums.js';

// ============================================================
// Rapat
// ============================================================

export const SkemaBuatRapat = z.object({
  organizationId: z.string().uuid(),
  periodId: z.string().uuid().optional(),
  judul: z.string().min(3).max(160),
  deskripsi: z.string().max(2000).nullable().optional(),
  tanggal: z.string().date(),
  waktuMulai: SkemaWaktu,
  waktuSelesai: SkemaWaktu,
  lokasi: z.string().max(200).nullable().optional(),
  jenis: z.enum(['RUTIN', 'KALENDER', 'DARURAT', 'DIVISI', 'PROGRAM']).default('RUTIN'),
  pembicara: z.array(z.string().min(2).max(120)).default([]),
  divisionId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  buatSesiAbsensi: z.boolean().default(true),
  wajibHadirSemua: z.boolean().default(false),
  divisionIds: z.array(z.string().uuid()).default([]),
});
export type PayloadBuatRapat = z.infer<typeof SkemaBuatRapat>;

export const SkemaPerbaruiRapat = SkemaBuatRapat.partial();

export const SkemaFilterRapat = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  status: z.enum(STATUS_RAPAT).optional(),
  jenis: z.string().optional(),
  divisionId: z.string().uuid().optional(),
}).extend({ rentang: SkemaRentangTanggal.partial().optional() }).extend(BENTUK_URUT);

export type FilterRapat = z.infer<typeof SkemaFilterRapat>;

export interface Rapat {
  readonly id: string;
  readonly organizationId: string;
  readonly periodId: string | null;
  readonly judul: string;
  readonly deskripsi: string | null;
  readonly tanggal: string;
  readonly waktuMulai: string;
  readonly waktuSelesai: string;
  readonly lokasi: string | null;
  readonly jenis: string;
  readonly status: StatusRapat;
  readonly pembicara: readonly string[];
  readonly divisionId: string | null;
  readonly programId: string | null;
  readonly sessionId: string | null;
  readonly totalPeserta: number;
  readonly sudahHadir: number;
  readonly notulenId: string | null;
  readonly dibuatOleh: string | null;
  readonly dibuatPada: string;
}

// ============================================================
// Agenda & peserta
// ============================================================

export const SkemaTambahAgenda = z.object({
  judul: z.string().min(3).max(200),
  deskripsi: z.string().max(2000).nullable().optional(),
  pembicara: z.string().max(120).nullable().optional(),
  durasiMenit: z.number().int().min(1).max(480).optional(),
  urutan: z.number().int().min(0).max(999).default(0),
});
export type PayloadTambahAgenda = z.infer<typeof SkemaTambahAgenda>;

export interface AgendaRapat {
  readonly id: string;
  readonly rapatId: string;
  readonly judul: string;
  readonly deskripsi: string | null;
  readonly pembicara: string | null;
  readonly durasiMenit: number | null;
  readonly urutan: number;
}

export const SkemaTambahPeserta = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(500),
  wajib: z.boolean().default(true),
});
export type PayloadTambahPeserta = z.infer<typeof SkemaTambahPeserta>;

export interface PesertaRapat {
  readonly memberId: string;
  readonly nama: string;
  readonly kelas: string;
  readonly wajib: boolean;
  readonly hadir: boolean;
  readonly statusHadir: string | null;
}

// ============================================================
// Notulen
// ============================================================

export const SkemaBuatNotulen = z.object({
  rapatId: z.string().uuid(),
  ringkasan: z.string().min(10).max(4000),
  pembahasan: z.string().max(20000).nullable().optional(),
  nomor: z.string().max(40).nullable().optional(),
});
export type PayloadBuatNotulen = z.infer<typeof SkemaBuatNotulen>;

export const SkemaPerbaruiNotulen = z.object({
  ringkasan: z.string().min(10).max(4000).optional(),
  pembahasan: z.string().max(20000).optional(),
  /** Alasan revisi wajib diisi bila mengubah notulen yang sudah APPROVED. */
  alasanRevisi: z.string().min(5).max(500).optional(),
});

export const SkemaPutuskanNotulen = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(1000).optional(),
});
export type PayloadPutuskanNotulen = z.infer<typeof SkemaPutuskanNotulen>;

export interface Notulen {
  readonly id: string;
  readonly rapatId: string;
  readonly versi: number;
  readonly nomor: string | null;
  readonly ringkasan: string;
  readonly pembahasan: string | null;
  readonly keputusan: readonly string[];
  readonly itemTindakan: readonly ItemTindakan[];
  readonly penulisId: string | null;
  readonly penulisNama: string | null;
  readonly status: StatusNotulen;
  readonly disetujuiOleh: string | null;
  readonly disetujuiPada: string | null;
  readonly dibuatPada: string;
}

export const SkemaTambahKeputusan = z.object({
  isi: z.string().min(3).max(1000),
  urutan: z.number().int().min(0).max(999).default(0),
});

export const SkemaTambahItemTindakan = z.object({
  isi: z.string().min(3).max(1000),
  penanggungJawabMemberId: z.string().uuid().optional(),
  batasWaktu: z.string().date().nullable().optional(),
  prioritas: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
});

export interface ItemTindakan {
  readonly id: string;
  readonly isi: string;
  readonly penanggungJawabMemberId: string | null;
  readonly penanggungJawabNama: string | null;
  readonly batasWaktu: string | null;
  readonly prioritas: string;
  readonly selesai: boolean;
}

/** Riwayat versi notulen —versi yang APPROVED tidak pernah ditimpa. */
export interface VersiNotulen {
  readonly versi: number;
  readonly status: StatusNotulen;
  readonly ringkasan: string;
  readonly alasanRevisi: string | null;
  readonly dibuatOleh: string | null;
  readonly dibuatPada: string;
  readonly disetujuiPada: string | null;
}
