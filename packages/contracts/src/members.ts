/**
 * Kontrak anggota & organisasi.
 */
import { z } from 'zod';
import {
  SkemaKodePos,
  SkemaNama,
  SkemaPaginasi,
  SkemaSurel,
  SkemaTelepon,
  SkemaUrut, BENTUK_URUT,
} from './common.js';
import { STATUS_ANGGOTA, STATUS_PERIODE, TINGKAT_JABATAN, type StatusAnggota } from './enums.js';
import { TINGKAT_KELAS, type TingkatKelas } from './profile.js';

// ============================================================
// Organisasi
// ============================================================

export const SkemaBuatOrganisasi = z.object({
  nama: z.string().min(2).max(160),
  singkat: z.string().min(2).max(20),
  jenis: z.enum(['OSIS', 'PRUKID', 'YOUTH', 'OTHER']).default('OSIS'),
  namaSekolah: z.string().min(2).max(160),
  npsn: z.string().max(20).nullable().optional(),
  alamat: z.string().max(400).nullable().optional(),
  kodePos: SkemaKodePos.nullable().optional(),
  telepon: SkemaTelepon.nullable().optional(),
  email: SkemaSurel.nullable().optional(),
  zonaWaktu: z.string().default('Asia/Makassar'),
});
export type PayloadBuatOrganisasi = z.infer<typeof SkemaBuatOrganisasi>;

export const SkemaBuatPeriode = z.object({
  organizationId: z.string().uuid(),
  nama: z.string().min(4).max(40),
  mulaiPada: z.string().date(),
  selesaiPada: z.string().date(),
  status: z.enum(STATUS_PERIODE).default('UPCOMING'),
});
export type PayloadBuatPeriode = z.infer<typeof SkemaBuatPeriode>;

export interface Organisasi {
  readonly id: string;
  readonly nama: string;
  readonly singkat: string;
  readonly jenis: string;
  readonly namaSekolah: string;
  readonly zonaWaktu: string;
  readonly aktif: boolean;
}

export interface Periode {
  readonly id: string;
  readonly organizationId: string;
  readonly nama: string;
  readonly mulaiPada: string;
  readonly selesaiPada: string;
  readonly status: string;
}

// ============================================================
// Divisi, Jabatan, Jabatan
// ============================================================

export const SkemaBuatDivisi = z.object({
  organizationId: z.string().uuid(),
  periodId: z.string().uuid(),
  nama: z.string().min(2).max(100),
  kode: z.string().min(2).max(20),
  deskripsi: z.string().max(500).nullable().optional(),
  idDivisiInduk: z.string().uuid().nullable().optional(),
  koordinatorMemberId: z.string().uuid().nullable().optional(),
});
export type PayloadBuatDivisi = z.infer<typeof SkemaBuatDivisi>;

export const SkemaBuatJabatan = z.object({
  organizationId: z.string().uuid(),
  nama: z.string().min(2).max(100),
  kode: z.string().min(2).max(30),
  tingkat: z.enum(TINGKAT_JABATAN).default('MEMBER'),
  urutan: z.number().int().min(0).max(999).default(100),
  deskripsi: z.string().max(500).nullable().optional(),
});
export type PayloadBuatJabatan = z.infer<typeof SkemaBuatJabatan>;

export const SkemaTugasJabatan = z.object({
  memberId: z.string().uuid(),
  jabatanId: z.string().uuid(),
  periodId: z.string().uuid(),
  mulaiPada: z.string().date().optional(),
  selesaiPada: z.string().date().nullable().optional(),
});
export type PayloadTugasJabatan = z.infer<typeof SkemaTugasJabatan>;

// ============================================================
// Anggota
// ============================================================

export const SkemaDaftarAnggota = z.object({
  nama: SkemaNama,
  email: SkemaSurel.nullable().optional(),
  telepon: SkemaTelepon.nullable().optional(),
  tingkat: z.enum(TINGKAT_KELAS),
  jurusan: z.string().max(40).nullable().optional(),
  subKelas: z.string().max(5).nullable().optional(),
  nis: z.string().max(30).nullable().optional(),
  nisn: z.string().max(30).nullable().optional(),
  divisionId: z.string().uuid().nullable().optional(),
  jabatanIds: z.array(z.string().uuid()).default([]),
  bergabungPada: z.string().date().optional(),
});
export type PayloadDaftarAnggota = z.infer<typeof SkemaDaftarAnggota>;

export const SkemaPerbaruiAnggota = SkemaDaftarAnggota.partial().extend({
  status: z.enum(STATUS_ANGGOTA).optional(),
});

export const SkemaFilterAnggota = SkemaPaginasi.extend({
  q: z.string().max(120).optional(),
  status: z.enum(STATUS_ANGGOTA).optional(),
  tingkat: z.enum(TINGKAT_KELAS).optional(),
  jurusan: z.string().max(40).optional(),
  divisionId: z.string().uuid().optional(),
  jabatanId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  tanpaUser: z.coerce.boolean().optional(),
}).extend(BENTUK_URUT);

export type FilterAnggota = z.infer<typeof SkemaFilterAnggota>;

export interface Anggota {
  readonly id: string;
  readonly userId: string | null;
  readonly nomor: string;
  readonly nama: string;
  readonly tingkat: TingkatKelas;
  readonly jurusan: string | null;
  readonly subKelas: string | null;
  readonly labelKelas: string;
  readonly nis: string | null;
  readonly nisn: string | null;
  readonly email: string | null;
  readonly telepon: string | null;
  readonly divisionId: string | null;
  readonly divisionNama: string | null;
  readonly jabatan: readonly { id: string; nama: string; kode: string; tingkat: string }[];
  readonly status: StatusAnggota;
  readonly bergabungPada: string;
  readonly dibuatPada: string;
}

export interface RingkasanAnggota {
  readonly id: string;
  readonly nama: string;
  readonly labelKelas: string;
  readonly status: StatusAnggota;
}

/** Statistik anggota untuk dasbor. */
export interface StatistikAnggota {
  readonly total: number;
  readonly aktif: number;
  readonly alumni: number;
  readonly nonaktif: number;
  readonly tanpaUser: number;
  readonly perTingkat: readonly { tingkat: string; jumlah: number }[];
  readonly perJurusan: readonly { jurusan: string; jumlah: number }[];
}
