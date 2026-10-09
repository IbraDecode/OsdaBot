/**
 * Kontrak absensi — sesi, catatan kehadiran, dan token QR.
 */
import { z } from 'zod';
import { SkemaPaginasi, SkemaRentangTanggal, SkemaUrut, SkemaWaktu, BENTUK_URUT,
} from './common.js';
import {
  JENIS_ABSENSI,
  SUMBER_ABSENSI,
  STATUS_HADIR,
  STATUS_SESI,
  type JenisAbsensi,
  type StatusHadir,
  type StatusSesi,
  type SumberAbsensi,
} from './enums.js';

// ============================================================
// Sesi absensi
// ============================================================

export const SkemaBuatSesi = z
  .object({
    organizationId: z.string().uuid(),
    periodId: z.string().uuid().optional(),
    jenis: z.enum(JENIS_ABSENSI),
    judul: z.string().min(3).max(160),
    tanggal: z.string().date(),
    mulaiPada: z.string().datetime().optional(),
    selesaiPada: z.string().datetime().optional(),
    waktuMulai: SkemaWaktu.optional(),
    waktuSelesai: SkemaWaktu.optional(),
    lokasi: z.string().max(200).nullable().optional(),
    meetingId: z.string().uuid().nullable().optional(),
    eventId: z.string().uuid().nullable().optional(),
    wajibHadir: z.boolean().default(true),
    hanyaDivisionId: z.array(z.string().uuid()).default([]),
    idempotencyKey: z.string().max(100).optional(),
  })
  .refine(
    (v) => !v.mulaiPada || !v.selesaiPada || new Date(v.selesaiPada) > new Date(v.mulaiPada),
    { message: 'Waktu selesai harus setelah waktu mulai', path: ['selesaiPada'] },
  );
export type PayloadBuatSesi = z.infer<typeof SkemaBuatSesi>;

export const SkemaBukaSesi = z.object({
  dibukaPada: z.string().datetime().optional(),
  tutupPada: z.string().datetime().optional(),
  qrTtlDetik: z.number().int().min(30).max(600).default(120),
});
export type PayloadBukaSesi = z.infer<typeof SkemaBukaSesi>;

export const SkemaTutupSesi = z.object({
  tutupPada: z.string().datetime().optional(),
  tandaiHadirSebagaiTidakHadir: z.boolean().default(true),
  kirimRekap: z.boolean().default(true),
});
export type PayloadTutupSesi = z.infer<typeof SkemaTutupSesi>;

export const SkemaFilterSesi = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  jenis: z.enum(JENIS_ABSENSI).optional(),
  status: z.enum(STATUS_SESI).optional(),
}).extend({ rentang: SkemaRentangTanggal.partial().optional() }).extend(BENTUK_URUT);

export type FilterSesi = z.infer<typeof SkemaFilterSesi>;

export interface SesiAbsensi {
  readonly id: string;
  readonly organizationId: string;
  readonly periodId: string | null;
  readonly jenis: JenisAbsensi;
  readonly judul: string;
  readonly tanggal: string;
  readonly waktuMulai: string | null;
  readonly waktuSelesai: string | null;
  readonly lokasi: string | null;
  readonly status: StatusSesi;
  readonly dibukaPada: string | null;
  readonly ditutupPada: string | null;
  readonly qrAktif: boolean;
  readonly totalWajib: number;
  readonly sudahHadir: number;
  readonly sudahAbsen: number;
  readonly dibuatOleh: string | null;
  readonly dibuatPada: string;
}

// ============================================================
// Catatan kehadiran
// ============================================================

export const SkemaCatatHadir = z.object({
  sessionId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  status: z.enum(STATUS_HADIR),
  alasan: z.string().max(300).optional(),
  catatan: z.string().max(300).optional(),
  tokenQr: z.string().max(200).optional(),
  idempotencyKey: z.string().max(100).optional(),
});
export type PayloadCatatHadir = z.infer<typeof SkemaCatatHadir>;

export const SkemaUbahHadirManual = z.object({
  status: z.enum(STATUS_HADIR),
  alasan: z.string().min(3).max(300),
  catatan: z.string().max(300).optional(),
});
export type PayloadUbahHadirManual = z.infer<typeof SkemaUbahHadirManual>;

export const SkemaFilterCatatan = SkemaPaginasi.extend({
  sessionId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  status: z.enum(STATUS_HADIR).optional(),
  sumber: z.enum(SUMBER_ABSENSI).optional(),
}).extend({ rentang: SkemaRentangTanggal.partial().optional() }).extend(BENTUK_URUT);

export type FilterCatatan = z.infer<typeof SkemaFilterCatatan>;

export interface CatatanHadir {
  readonly id: string;
  readonly sessionId: string;
  readonly memberId: string;
  readonly memberNama: string;
  readonly memberKelas: string;
  readonly status: StatusHadir;
  readonly alasan: string | null;
  readonly catatan: string | null;
  readonly sumber: SumberAbsensi;
  readonly direkamPada: string;
  readonly diubahOleh: string | null;
}

/** Ringkasan rekap absensi satu sesi — dipakai Secretary, Ketua, dan Bot /rekap. */
export interface RekapSesi {
  readonly sessionId: string;
  readonly judul: string;
  readonly tanggal: string;
  readonly status: StatusSesi;
  readonly totalWajib: number;
  readonly hadir: readonly RingkasanAnggotaAbsen[];
  readonly izin: readonly RingkasanAnggotaAbsen[];
  readonly sakit: readonly RingkasanAnggotaAbsen[];
  readonly tidakHadir: readonly RingkasanAnggotaAbsen[];
  readonly belumAbsen: readonly RingkasanAnggotaAbsen[];
  readonly statistik: {
    readonly hadir: number;
    readonly izin: number;
    readonly sakit: number;
    readonly tidakHadir: number;
    readonly belumAbsen: number;
    readonly persenHadir: number;
  };
}

export interface RingkasanAnggotaAbsen {
  readonly memberId: string;
  readonly nama: string;
  readonly kelas: string;
  readonly alasan: string | null;
  readonly direkamPada: string | null;
}

/** Rekap absensi milik seorang anggota. */
export interface RekapAnggota {
  readonly memberId: string;
  readonly nama: string;
  readonly periode: { readonly dari: string; readonly sampai: string };
  readonly totalSesi: number;
  readonly hadir: number;
  readonly terlambat: number;
  readonly izin: number;
  readonly sakit: number;
  readonly tidakHadir: number;
  readonly persenKehadiran: number;
  readonly rincian: readonly {
    readonly sessionId: string;
    readonly judul: string;
    readonly tanggal: string;
    readonly status: StatusHadir;
    readonly alasan: string | null;
  }[];
}

// ============================================================
// QR absensi
// ============================================================

/** Token QR bersifat sementara, terikat sesi, dan tidak dapat dipakai ulang. */
export interface TokenQr {
  readonly token: string;
  readonly sessionId: string;
  readonly berlakuSampai: string;
  readonly kodeIsi: string;
}

export const SkemaVerifikasiQr = z.object({
  token: z.string().min(10).max(400),
});
export type PayloadVerifikasiQr = z.infer<typeof SkemaVerifikasiQr>;
