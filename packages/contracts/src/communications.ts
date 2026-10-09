/**
 * Kontrak komunikasi (Humas): pengumuman, kampanye, dan pelacakan pengiriman.
 *
 * Satu pengumuman dibuat sekali; backend yang menentukan kanal pengiriman
 * berdasarkan audiens, prioritas, dan preferensi masing-masing penerima.
 */
import { z } from 'zod';
import { SkemaPaginasi, SkemaUrut, BENTUK_URUT,
} from './common.js';
import {
  AUDIENS,
  KANAL,
  PRIORITAS_NOTIFIKASI,
  STATUS_KOMUNIKASI,
  STATUS_PENGIRIMAN,
  type Audiens,
  type Kanal,
  type StatusKomunikasi,
  type StatusPengiriman,
} from './enums.js';

export const SkemaBuatPengumuman = z.object({
  organizationId: z.string().uuid(),
  judul: z.string().min(3, 'Judul minimal 3 karakter').max(200),
  isi: z.string().min(10, 'Isi minimal 10 karakter').max(5000),
  audiens: z.enum(AUDIENS).default('ALL'),
  divisionIds: z.array(z.string().uuid()).default([]),
  eventId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  jabatanIds: z.array(z.string().uuid()).default([]),
  memberIds: z.array(z.string().uuid()).default([]),
  kanal: z.array(z.enum(KANAL)).min(1, 'Pilih minimal satu kanal'),
  prioritas: z.enum(PRIORITAS_NOTIFIKASI).default('NORMAL'),
  perluPersetujuan: z.boolean().default(true),
  jadwalkanPada: z.string().datetime().nullable().optional(),
  lampiranDokumenIds: z.array(z.string().uuid()).default([]),
  pin: z.boolean().default(false),
});
export type PayloadBuatPengumuman = z.infer<typeof SkemaBuatPengumuman>;

export const SkemaPerbaruiPengumuman = SkemaBuatPengumuman.partial();

export const SkemaPutuskanPengumuman = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(1000).optional(),
});

export const SkemaTerbitkan = z.object({
  /** Abaikan jadwal dan terbitkan sekarang. */
  sekarang: z.boolean().default(false),
  /** Kanal yang diabaikan bila ingin melewati kanal tertentu. */
  lewatiKanal: z.array(z.enum(KANAL)).default([]),
});

export const SkemaFilterPengumuman = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  status: z.enum(STATUS_KOMUNIKASI).optional(),
  audiens: z.enum(AUDIENS).optional(),
  programId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  q: z.string().max(120).optional(),
}).extend(BENTUK_URUT);

export type FilterPengumuman = z.infer<typeof SkemaFilterPengumuman>;

export interface Pengumuman {
  readonly id: string;
  readonly organizationId: string;
  readonly judul: string;
  readonly isi: string;
  readonly ringkasan: string | null;
  readonly audiens: Audiens;
  readonly kanal: readonly Kanal[];
  readonly prioritas: string;
  readonly status: StatusKomunikasi;
  readonly pin: boolean;
  readonly programId: string | null;
  readonly programNama: string | null;
  readonly eventId: string | null;
  readonly eventJudul: string | null;
  readonly perluPersetujuan: boolean;
  readonly jadwalkanPada: string | null;
  readonly terbitPada: string | null;
  readonly totalPenerima: number;
  readonly terkirim: number;
  readonly terbaca: number;
  readonly gagal: number;
  readonly dibuatOleh: string | null;
  readonly dibuatOlehNama: string | null;
  readonly disetujuiOleh: string | null;
  readonly disetujuiPada: string | null;
  readonly dibuatPada: string;
  readonly lampiranDokumenIds: readonly string[];
}

/** Rincian pengiriman per penerima per kanal. */
export interface PengirimanPengumuman {
  readonly id: string;
  readonly memberId: string;
  readonly memberNama: string;
  readonly memberKelas: string;
  readonly kanal: Kanal;
  readonly status: StatusPengiriman;
  readonly percobaan: number;
  readonly pesanGalat: string | null;
  readonly dikirimPada: string | null;
  readonly dibacaPada: string | null;
}

/** Statistik komunikasi untuk dasbor Humas. */
export interface StatistikKomunikasi {
  readonly totalPengumuman: number;
  readonly menungguPersetujuan: number;
  readonly terjadwal: number;
  readonly terbitBulanIni: number;
  readonly totalTerkirim: number;
  readonly totalTerbaca: number;
  readonly tingkatPembacaan: number;
  readonly gagalKirim: number;
  readonly perKanal: readonly {
    readonly kanal: Kanal;
    readonly terkirim: number;
    readonly terbaca: number;
    readonly gagal: number;
  }[];
  readonly antreanTerbit: readonly {
    readonly id: string;
    readonly judul: string;
    readonly jadwalkanPada: string;
    readonly totalPenerima: number;
  }[];
}

// ============================================================
// Kampanye (beberapa pengumuman bertema satu kegiatan)
// ============================================================

export const SkemaBuatKampanye = z.object({
  organizationId: z.string().uuid(),
  nama: z.string().min(3, 'Nama kampanye minimal 3 karakter').max(160),
  deskripsi: z.string().max(2000).nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  mulaiPada: z.string().date(),
  selesaiPada: z.string().date(),
});

export interface Kampanye {
  readonly id: string;
  readonly nama: string;
  readonly deskripsi: string | null;
  readonly programId: string | null;
  readonly eventId: string | null;
  readonly mulaiPada: string;
  readonly selesaiPada: string;
  readonly status: string;
  readonly jumlahPengumuman: number;
  readonly totalTerkirim: number;
  readonly totalTerbaca: number;
}

// ============================================================
// Notifikasi
// ============================================================

export const SkemaFilterNotifikasi = SkemaPaginasi.extend({
  belumDibaca: z.coerce.boolean().optional(),
  jenis: z.string().max(30).optional(),
  prioritas: z.enum(PRIORITAS_NOTIFIKASI).optional(),
}).extend(BENTUK_URUT);

export interface Notifikasi {
  readonly id: string;
  readonly jenis: string;
  readonly judul: string;
  readonly isi: string;
  readonly prioritas: string;
  readonly sudahDibaca: boolean;
  readonly dibacaPada: string | null;
  readonly entitas: { readonly jenis: string; readonly id: string } | null;
  readonly actions: readonly { readonly label: string; readonly url: string; readonly utama: boolean }[];
  readonly dibuatPada: string;
}

export interface RingkasanNotifikasi {
  readonly belumDibaca: number;
  readonly perJenis: readonly { jenis: string; belumDibaca: number }[];
  readonly terbaru: readonly Notifikasi[];
}
