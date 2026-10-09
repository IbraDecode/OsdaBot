/**
 * Kontrak autentikasi & otorisasi.
 */
import { z } from 'zod';
import { SkemaNominal, SkemaSurel, SkemaTelepon } from './common.js';
import {
  JENIS_PERSETUJUAN,
  STATUS_PERSETUJUAN,
  type JenisPersetujuan,
  type StatusPersetujuan,
} from './enums.js';
import {
  CAKUPAN,
  PERAN_BAWAAN,
  type Cakupan,
  type KodePeranBawaan,
} from './permissions.js';
import type { ProfilKarang } from './profile.js';

// ============================================================
// Kredensial & sesi
// ============================================================

/** Permintaan masuk dengan surel + kata sandi. */
export const SkemaMasuk = z.object({
  email: SkemaSurel,
  password: z.string().min(8, 'Kata sandi minimal 8 karakter').max(200),
});
export type MasukanMasuk = z.infer<typeof SkemaMasuk>;

/** Permintaan kirim tautan masuk tanpa kata sandi (passwordless). */
export const SkemaMintaTautanMasuk = z.object({
  email: SkemaSurel,
});
export type MasukanMintaTautanMasuk = z.infer<typeof SkemaMintaTautanMasuk>;

/** Permintaan laundry dari WhatsApp / tautan dalam. */
export const SkemaTukarIdentitas = z.object({
  kode: z.string().min(6).max(64),
});
export type MasukanTukarIdentitas = z.infer<typeof SkemaTukarIdentitas>;

/** Pengguna yang sedang login beserta izin efektifnya. */
export interface ProfilPengguna {
  readonly userId: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly name: string;
  readonly status: string;
  readonly memberId: string | null;
  readonly organizationIds: readonly string[];
  readonly peran: readonly { kode: string; nama: string; cakupan: readonly Cakupan[] }[];
  readonly izin: readonly string[];
  readonly jabatanIds: readonly string[];
}

/** Hasil berhasil masuk. */
export interface HasilMasuk {
  readonly aksesToken: string;
  readonly refreshToken: string;
  readonly kedaluwarsaPada: string;
  readonly pengguna: ProfilPengguna;
}

/** Hasil tukar identitas WhatsApp. */
export interface HasilTukarIdentitas {
  readonly aksesToken: string;
  readonly refreshToken: string;
  readonly pengguna: ProfilPengguna;
}

// ============================================================
//Klaim token (JWT payload) */
export type KlaimToken = {
  readonly sub: string;
  readonly org: readonly string[];
  readonly roles: readonly string[];
  readonly perms: readonly string[];
  readonly scopes: readonly Cakupan[];
  readonly jti: string;
  readonly sid: string;
  readonly typ: 'access' | 'refresh';
};

// ============================================================
//Otorisasi
// ============================================================

/** Hasil pemeriksaan otorisasi oleh backend. */
export interface HasilOtorisasi {
  readonly diizinkan: boolean;
  readonly alasan?: string;
  readonly cakupan: readonly Cakupan[];
}

/** Permintaan pengubahan peran bawaan (super admin). */
export const SkemaPeranBawaanPayload = z.object({
  kode: z.enum(PERAN_BAWAAN),
  nama: z.string().min(2).max(100),
  deskripsi: z.string().max(500).optional(),
  izin: z.array(z.string()),
  cakupan: z.array(z.enum(CAKUPAN)),
  bawaan: z.boolean().default(true),
});
export type PayloadPeranBawaan = z.infer<typeof SkemaPeranBawaanPayload>;

/** Permintaan menugaskan peran kepada anggota. */
export const SkemaTugasPeran = z.object({
  memberId: z.string().uuid(),
  peranKode: z.string().min(2).max(64),
  jabatanId: z.string().uuid().nullable().optional(),
  mulaiPada: z.string().date().optional(),
  selesaiPada: z.string().date().nullable().optional(),
});
export type PayloadTugasPeran = z.infer<typeof SkemaTugasPeran>;

// ============================================================
// Persetujuan
// ============================================================

/** Permintaan membuat persetujuan. */
export const SkemaBuatPersetujuan = z.object({
  jenis: z.enum(JENIS_PERSETUJUAN),
  entitasId: z.string().uuid(),
  ringkasan: z.string().min(3).max(300),
  nominal: SkemaNominal.optional(),
  pemohonId: z.string().uuid().optional(),
  penerimaKode: z.array(z.string().min(2).max(64)).min(1),
});
export type PayloadBuatPersetujuan = z.infer<typeof SkemaBuatPersetujuan>;

/** Keputusan atas permintaan persetujuan. */
export const SkemaPutuskanPersetujuan = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED', 'CANCELLED']),
  komentar: z.string().max(1000).optional(),
});
export type PayloadPutuskanPersetujuan = z.infer<typeof SkemaPutuskanPersetujuan>;

export interface PermintaanPersetujuan {
  readonly id: string;
  readonly jenis: JenisPersetujuan;
  readonly entitasId: string;
  readonly ringkasan: string;
  readonly nominal: number | null;
  readonly pemohonId: string | null;
  readonly pemohonNama: string | null;
  readonly status: StatusPersetujuan;
  readonly penerimaKode: readonly string[];
  readonly komentar: string | null;
  readonly dibuatPada: string;
  readonly diselesaikanPada: string | null;
}

// ============================================================
// Profil & preferensi
// ============================================================

/** Permintaan memperbarui profil milik sendiri. */
export const SkemaPerbaruiProfil = z.object({
  nama: z.string().min(2).max(120).optional(),
  telepon: SkemaTelepon.nullable().optional(),
  bio: z.string().max(500).optional(),
  bahasa: z.enum(['id', 'en']).optional(),
});
export type PayloadPerbaruiProfil = z.infer<typeof SkemaPerbaruiProfil>;

/** Preferensi notifikasi per pengguna. */
export interface PreferensiNotifikasi {
  readonly attendance: { inApp: boolean; push: boolean; whatsapp: boolean };
  readonly task: { inApp: boolean; push: boolean; whatsapp: boolean };
  readonly meeting: { inApp: boolean; push: boolean; whatsapp: boolean };
  readonly program: { inApp: boolean; push: boolean; whatsapp: boolean };
  readonly finance: { inApp: boolean; push: boolean; whatsapp: boolean };
  readonly approval: { inApp: boolean; push: boolean; whatsapp: boolean };
  readonly announcement: { inApp: boolean; push: boolean; whatsapp: boolean };
  readonly system: { inApp: boolean; push: boolean; whatsapp: boolean };
}

export type { ProfilKarang } from './profile.js';
export type { KodePeranBawaan, Cakupan };
