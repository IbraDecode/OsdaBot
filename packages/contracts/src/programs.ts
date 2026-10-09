/**
 * Kontrak program kerja (program) — modul utama OSDA.
 *
 * Program adalah "ruang kerja" (workspace) yang menyatukan timeline, tugas,
 * tim, anggaran, dokumen, rapat, pengumuman, absensi, pengeluaran, dan evaluasi
 * sehingga satu acara OSIS tidak lagi tersebar di WhatsApp.
 */
import { z } from 'zod';
import {
  SkemaNominal,
  SkemaPaginasi,
  SkemaRentangTanggal,
  BENTUK_URUT,
} from './common.js';
import { STATUS_ACARA, STATUS_PROGRAM, TRANSISI_PROGRAM, type StatusAcara, type StatusProgram } from './enums.js';

// ============================================================
// Program kerja
// ============================================================

export const SkemaBuatProgram = z.object({
  organizationId: z.string().uuid(),
  nama: z.string().min(3).max(200),
  tujuan: z.string().min(10).max(2000),
  deskripsi: z.string().max(10000).nullable().optional(),
  divisionId: z.string().uuid().nullable().optional(),
  ownerMemberId: z.string().uuid(),
  mulaiPada: z.string().date(),
  selesaiPada: z.string().date(),
  anggaranDiajukan: SkemaNominal.optional(),
  prioritas: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  timMemberIds: z.array(z.string().uuid()).default([]),
  indikator: z.array(z.string().max(300)).default([]),
});
export type PayloadBuatProgram = z.infer<typeof SkemaBuatProgram>;

export const SkemaPerbaruiProgram = SkemaBuatProgram.partial();

export const SkemaUbahStatusProgram = z.object({
  status: z.enum(STATUS_PROGRAM),
  komentar: z.string().max(1000).optional(),
  /** Wajib bila ingin menjalankan koreksi khusus (mis. COMPLETED → RUNNING). */
  koreksiPrivileged: z.boolean().default(false),
});

export const SkemaFilterProgram = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  divisionId: z.string().uuid().optional(),
  ownerMemberId: z.string().uuid().optional(),
  status: z.enum(STATUS_PROGRAM).optional(),
  aktif: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
})
  .extend({ rentang: SkemaRentangTanggal.partial().optional() })
  .extend(BENTUK_URUT);

export type FilterProgram = z.infer<typeof SkemaFilterProgram>;

export interface Program {
  readonly id: string;
  readonly kode: string;
  readonly organizationId: string;
  readonly periodId: string | null;
  readonly nama: string;
  readonly tujuan: string;
  readonly deskripsi: string | null;
  readonly status: StatusProgram;
  readonly prioritas: string;
  readonly divisionId: string | null;
  readonly divisionNama: string | null;
  readonly ownerMemberId: string;
  readonly ownerNama: string;
  readonly mulaiPada: string;
  readonly selesaiPada: string;
  readonly hariTersisa: number | null;
  readonly overdue: boolean;
  readonly anggaranDiajukan: number | null;
  readonly anggaranDisetujui: number | null;
  readonly realisasiPengeluaran: number;
  readonly progres: number;
  readonly jumlahTugas: number;
  readonly tugasSelesai: number;
  readonly tim: readonly { memberId: string; nama: string; peran: string; jabatan: string | null }[];
  readonly indikator: readonly string[];
  readonly dibuatPada: string;
  readonly disetujuiPada: string | null;
}

/** Ringkasan ruang kerja program (dipakai halaman detail program). */
export interface RuangKerjaProgram {
  readonly program: Program;
  readonly timeline: readonly TonggakWaktu[];
  readonly tugas: readonly unknown[];
  readonly acara: readonly Acara[];
  readonly anggaran: {
    readonly diajukan: number;
    readonly disetujui: number;
    readonly realisasi: number;
    readonly sisa: number;
    readonly persenTerpakai: number;
  };
  readonly dokumen: readonly unknown[];
  readonly absensi: {
    readonly totalSesi: number;
    readonly rataRataHadir: number;
  };
}

/** Tonggak waktu (milestone) program. */
export const SkemaTambahTonggakWaktu = z.object({
  nama: z.string().min(3).max(200),
  tanggal: z.string().date(),
  deskripsi: z.string().max(1000).nullable().optional(),
  selesai: z.boolean().default(false),
});

export interface TonggakWaktu {
  readonly id: string;
  readonly nama: string;
  readonly tanggal: string;
  readonly deskripsi: string | null;
  readonly selesai: boolean;
}

/** Evaluasi / laporan akhir program. */
export const SkemaEvaluasiProgram = z.object({
  capaian: z.string().min(10).max(5000),
  kendala: z.string().max(5000).nullable().optional(),
  pelajaran: z.string().max(5000).nullable().optional(),
  rekomendasi: z.string().max(5000).nullable().optional(),
  skorKualitas: z.coerce.number().min(0).max(100).optional(),
});

export interface EvaluasiProgram {
  readonly id: string;
  readonly programId: string;
  readonly capaian: string;
  readonly kendala: string | null;
  readonly pelajaran: string | null;
  readonly rekomendasi: string | null;
  readonly dievaluasiOleh: string | null;
  readonly dievaluasiPada: string;
}

// ============================================================
// Acara (event)
// ============================================================

export const SkemaBuatAcara = z.object({
  organizationId: z.string().uuid(),
  programId: z.string().uuid().nullable().optional(),
  judul: z.string().min(3).max(200),
  deskripsi: z.string().max(10000).nullable().optional(),
  tanggal: z.string().date(),
  waktuMulai: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  waktuSelesai: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  lokasi: z.string().max(200).nullable().optional(),
  penanggungJawabMemberId: z.string().uuid(),
  kapasitas: z.number().int().min(1).max(100000).nullable().optional(),
  divisionId: z.string().uuid().nullable().optional(),
  butuhAbsensi: z.boolean().default(true),
  butuhPendaftaran: z.boolean().default(false),
  biayaDiajukan: SkemaNominal.optional(),
});
export type PayloadBuatAcara = z.infer<typeof SkemaBuatAcara>;

export const SkemaFilterAcara = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  divisionId: z.string().uuid().optional(),
  status: z.enum(STATUS_ACARA).optional(),
  akanDatang: z.coerce.boolean().optional(),
})
  .extend({ rentang: SkemaRentangTanggal.partial().optional() })
  .extend(BENTUK_URUT);

export type FilterAcara = z.infer<typeof SkemaFilterAcara>;

export interface Acara {
  readonly id: string;
  readonly organizationId: string;
  readonly programId: string | null;
  readonly programNama: string | null;
  readonly judul: string;
  readonly deskripsi: string | null;
  readonly tanggal: string;
  readonly waktuMulai: string | null;
  readonly waktuSelesai: string | null;
  readonly lokasi: string | null;
  readonly status: StatusAcara;
  readonly penanggungJawabMemberId: string;
  readonly penanggungJawabNama: string | null;
  readonly kapasitas: number | null;
  readonly jumlahPendaftaran: number;
  readonly divisionId: string | null;
  readonly sessionId: string | null;
  readonly dibuatPada: string;
}

/** Peserta acara (committee vs peserta umum). */
export const SkemaTambahPesertaAcara = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(1000),
  peran: z.enum(['PESERTA', 'PANITIA', 'PANITIA_UTAMA']).default('PESERTA'),
});

export interface PesertaAcara {
  readonly memberId: string;
  readonly nama: string;
  readonly kelas: string;
  readonly peran: string;
  readonly terdaftarPada: string;
  readonly hadir: boolean;
}

// ============================================================
// Workflow
// ============================================================

/** Daftar transisi status program yang sah — dipakai UI dan validasi backend. */
export const TRANSISI_PROGRAM_PUBLIK = TRANSISI_PROGRAM;

/** Periksa apakah transisi status program diperbolehkan. */
export function bolehTransisiProgram(dari: StatusProgram, ke: StatusProgram): boolean {
  return TRANSISI_PROGRAM[dari].includes(ke);
}

/** Transisi status program yang hanya boleh dilakukan lewat koreksi privileged. */
export const TRANSISI_KOREKSI_PROGRAM: Readonly<Record<StatusProgram, readonly StatusProgram[]>> = {
  DRAFT: ['DRAFT', 'PROPOSED', 'CANCELLED'],
  PROPOSED: ['PROPOSED', 'APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['APPROVED', 'PLANNED', 'DRAFT', 'CANCELLED'],
  PLANNED: ['PLANNED', 'RUNNING', 'APPROVED', 'CANCELLED'],
  RUNNING: ['RUNNING', 'COMPLETED', 'PLANNED', 'CANCELLED'],
  COMPLETED: ['COMPLETED', 'RUNNING'],
  CANCELLED: ['CANCELLED', 'DRAFT'],
};
