/**
 * Kontrak tugas (task).
 *
 * Aturan penting: status DONE belum berarti VERIFIED. Untuk tugas penting,
 * penyelesaian harus diverifikasi orang lain melalui izin `task.verify`.
 */
import { z } from 'zod';
import { SkemaPaginasi, SkemaUrut, BENTUK_URUT,
} from './common.js';
import { PRIORITAS_TUGAS, STATUS_TUGAS, STATUS_VERIFIKASI, type PrioritasTugas, type StatusTugas, type StatusVerifikasi } from './enums.js';

// ============================================================
// Tugas
// ============================================================

export const SkemaBuatTugas = z.object({
  organizationId: z.string().uuid(),
  judul: z.string().min(3).max(200),
  deskripsi: z.string().max(4000).nullable().optional(),
  assigneeMemberIds: z.array(z.string().uuid()).min(1).max(50),
  prioritas: z.enum(PRIORITAS_TUGAS).default('NORMAL'),
  batasWaktu: z.string().date().nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  divisionId: z.string().uuid().nullable().optional(),
  divisionTujuanId: z.string().uuid().nullable().optional(),
  meetingId: z.string().uuid().nullable().optional(),
  butuhVerifikasi: z.boolean().default(true),
  lampiranIds: z.array(z.string().uuid()).default([]),
  parentId: z.string().uuid().nullable().optional(),
});
export type PayloadBuatTugas = z.infer<typeof SkemaBuatTugas>;

export const SkemaPerbaruiTugas = z.object({
  judul: z.string().min(3).max(200).optional(),
  deskripsi: z.string().max(4000).nullable().optional(),
  assigneeMemberIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  prioritas: z.enum(PRIORITAS_TUGAS).optional(),
  batasWaktu: z.string().date().nullable().optional(),
  divisionId: z.string().uuid().nullable().optional(),
  butuhVerifikasi: z.boolean().optional(),
});

export const SkemaUbahStatusTugas = z.object({
  status: z.enum(STATUS_TUGAS),
  catatan: z.string().max(500).optional(),
  /** Wajib diisi bila menutup tugas yang ditandai BLOCKED. */
  alasan: z.string().min(3).max(300).optional(),
});

export const SkemaVerifikasiTugas = z.object({
  keputusan: z.enum(['VERIFIED', 'REJECTED']),
  komentar: z.string().min(3).max(500),
});

export const SkemaFilterTugas = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  divisionId: z.string().uuid().optional(),
  assigneeMemberId: z.string().uuid().optional(),
  dibuatOleh: z.string().uuid().optional(),
  status: z.enum(STATUS_TUGAS).optional(),
  prioritas: z.enum(PRIORITAS_TUGAS).optional(),
  overdue: z.coerce.boolean().optional(),
  butuhVerifikasi: z.coerce.boolean().optional(),
}).extend(BENTUK_URUT);

export type FilterTugas = z.infer<typeof SkemaFilterTugas>;
export type PayloadUbahStatusTugas = z.infer<typeof SkemaUbahStatusTugas>;
export type PayloadVerifikasiTugas = z.infer<typeof SkemaVerifikasiTugas>;

export interface Tugas {
  readonly id: string;
  readonly kode: string;
  readonly organizationId: string;
  readonly judul: string;
  readonly deskripsi: string | null;
  readonly status: StatusTugas;
  readonly verifikasi: StatusVerifikasi;
  readonly butuhVerifikasi: boolean;
  readonly prioritas: PrioritasTugas;
  readonly batasWaktu: string | null;
  readonly overdue: boolean;
  readonly programId: string | null;
  readonly programNama: string | null;
  readonly divisionId: string | null;
  readonly divisionNama: string | null;
  readonly assignee: readonly { memberId: string; nama: string; kelas: string; selesai: boolean }[];
  readonly dibuatOleh: string | null;
  readonly dibuatOlehNama: string | null;
  readonly parentId: string | null;
  readonly lampiranIds: readonly string[];
  readonly progres: number;
  readonly dibuatPada: string;
  readonly selesaiPada: string | null;
  readonly diverifikasiPada: string | null;
  readonly diverifikasiOleh: string | null;
}

/** Komentar & riwayat perubahan status tugas. */
export interface CatatanTugas {
  readonly id: string;
  readonly tipe: 'KOMENTAR' | 'STATUS' | 'VERIFIKASI' | 'DIBUAT';
  readonly isi: string;
  readonly statusSebelum: StatusTugas | null;
  readonly statusSesudah: StatusTugas | null;
  readonly oleh: string | null;
  readonly olehNama: string | null;
  readonly dibuatPada: string;
}

/** Peta transisi status tugas yang sah. */
export const TRANSISI_TUGAS: Readonly<Record<StatusTugas, readonly StatusTugas[]>> = {
  TODO: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'BLOCKED', 'TODO', 'CANCELLED'],
  BLOCKED: ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  DONE: ['IN_PROGRESS'],
  CANCELLED: ['TODO'],
};

/** Apakah transisi status tugas diperbolehkan. */
export function bolehTransisiTugas(dari: StatusTugas, ke: StatusTugas): boolean {
  return TRANSISI_TUGAS[dari].includes(ke);
}

// ============================================================
// Izin (permission request) — anggota meminta izin tidak hadir
// ============================================================

export const SkemaBuatIzin = z.object({
  sessionId: z.string().uuid(),
  jenis: z.enum(['EXCUSED', 'SICK']).default('EXCUSED'),
  alasan: z.string().min(5).max(300),
  lampiranId: z.string().uuid().nullable().optional(),
});
export type PayloadBuatIzin = z.infer<typeof SkemaBuatIzin>;

export const SkemaPutuskanIzin = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(500).optional(),
});

export interface PermintaanIzin {
  readonly id: string;
  readonly memberId: string;
  readonly memberNama: string;
  readonly sessionId: string;
  readonly sessionJudul: string;
  readonly jenis: string;
  readonly alasan: string;
  readonly status: string;
  readonly decidedBy: string | null;
  readonly dibuatPada: string;
}
