/**
 * Kontrak keuangan — anggaran, transaksi, ledger, reimbursement, pembayaran.
 *
 * Prinsip yang dipegang di modul ini:
 * 1. Semua angka uang adalah bilangan bulat rupiah penuh (tanpa pecahan).
 * 2. Saldo TIDAK PERNAH disimpan sebagai angka tunggal; saldo dihitung dari
 *    ledger_entries yang immutable.
 * 3. Setiap perubahan uang berada dalam satu batas transaksi (transactional).
 * 4. Pemohon tidak boleh menjadi pemberi persetujuan atas pengajuannya sendiri.
 */
import { z } from 'zod';
import { SkemaNominal, SkemaPaginasi, SkemaRentangTanggal, SkemaUrut, BENTUK_URUT,
} from './common.js';
import {
  ARAH_TRANSAKSI,
  JENIS_AKUN,
  JENIS_TRANSAKSI,
  METODE_PEMBAYARAN,
  STATUS_ANGGARAN,
  STATUS_PENGAJUAN,
  STATUS_PERIODE_KEUANGAN,
  STATUS_REIMBURSEMENT,
  STATUS_TRANSAKSI,
  type ArahTransaksi,
  type JenisAkun,
  type JenisTransaksi,
  type MetodePembayaran,
  type StatusAnggaran,
  type StatusPeriodeKeuangan,
  type StatusReimbursement,
  type StatusTransaksi,
} from './enums.js';

// ============================================================
// Chart of accounts
// ============================================================

export const SkemaBuatAkun = z.object({
  kode: z.string().min(2).max(20),
  nama: z.string().min(3).max(120),
  jenis: z.enum(JENIS_AKUN),
  indukId: z.string().uuid().nullable().optional(),
  deskripsi: z.string().max(500).nullable().optional(),
  aktif: z.boolean().default(true),
});
export type PayloadBuatAkun = z.infer<typeof SkemaBuatAkun>;

export interface Akun {
  readonly id: string;
  readonly kode: string;
  readonly nama: string;
  readonly jenis: JenisAkun;
  readonly indukId: string | null;
  readonly saldo: number;
  readonly aktif: boolean;
}

// ============================================================
// Periode keuangan
// ============================================================

export const SkemaBuatPeriodeKeuangan = z.object({
  organizationId: z.string().uuid(),
  periodId: z.string().uuid().optional(),
  nama: z.string().min(3).max(80),
  mulaiPada: z.string().date(),
  selesaiPada: z.string().date(),
  saldoAwal: SkemaNominal.default(0),
});
export type PayloadBuatPeriodeKeuangan = z.infer<typeof SkemaBuatPeriodeKeuangan>;

export interface PeriodeKeuangan {
  readonly id: string;
  readonly organizationId: string;
  readonly nama: string;
  readonly mulaiPada: string;
  readonly selesaiPada: string;
  readonly saldoAwal: number;
  readonly status: StatusPeriodeKeuangan;
  readonly ditutupPada: string | null;
  readonly ditutupOleh: string | null;
}

// ============================================================
// Anggaran
// ============================================================

export const SkemaBuatAnggaran = z.object({
  organizationId: z.string().uuid(),
  periodId: z.string().uuid().optional(),
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  nama: z.string().min(3).max(160),
  totalDiajukan: SkemaNominal,
  periodeKeuanganId: z.string().uuid(),
  catatan: z.string().max(1000).nullable().optional(),
  butir: z.array(
    z.object({
      akunId: z.string().uuid(),
      keterangan: z.string().min(2).max(200),
      nominal: SkemaNominal,
    }),
  ).default([]),
});
export type PayloadBuatAnggaran = z.infer<typeof SkemaBuatAnggaran>;

export const SkemaFilterAnggaran = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  programId: z.string().uuid().nullable().optional(),
  status: z.enum(STATUS_ANGGARAN).optional(),
}).extend(BENTUK_URUT);

export interface Anggaran {
  readonly id: string;
  readonly kode: string;
  readonly organizationId: string;
  readonly nama: string;
  readonly programId: string | null;
  readonly programNama: string | null;
  readonly totalDiajukan: number;
  readonly totalDisetujui: number;
  readonly realisasi: number;
  readonly sisa: number;
  readonly persenTerpakai: number;
  readonly status: StatusAnggaran;
  readonly periodeKeuanganId: string;
  readonly butir: readonly {
    readonly id: string;
    readonly akunKode: string;
    readonly akunNama: string;
    readonly keterangan: string;
    readonly nominal: number;
    readonly realisasi: number;
  }[];
  readonly disetujuiOleh: string | null;
  readonly disetujuiPada: string | null;
  readonly dibuatPada: string;
}

// ============================================================
// Pengajuan pengeluaran & pemasukan
// ============================================================

export const SkemaBuatPengajuan = z.object({
  organizationId: z.string().uuid(),
  jenis: z.enum(['EXPENSE', 'INCOME']),
  akunId: z.string().uuid(),
  nominal: SkemaNominal.positive('Nominal harus lebih dari nol'),
  keterangan: z.string().min(3).max(500),
  tanggal: z.string().date(),
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  anggaranId: z.string().uuid().nullable().optional(),
  pemohonMemberId: z.string().uuid().optional(),
  buktiDokumenId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().max(100).optional(),
});
export type PayloadBuatPengajuan = z.infer<typeof SkemaBuatPengajuan>;

export const SkemaPutuskanPengajuan = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(1000).optional(),
  /** Bendahara menyatakan sudah membayar setelah disetujui. */
  tandaiDibayar: z.boolean().default(false),
  metodePembayaran: z.enum(METODE_PEMBAYARAN).optional(),
  buktiTransfer: z.string().max(200).nullable().optional(),
});

export const SkemaFilterTransaksi = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  programId: z.string().uuid().nullable().optional(),
  jenis: z.enum(JENIS_TRANSAKSI).optional(),
  arah: z.enum(ARAH_TRANSAKSI).optional(),
  status: z.enum(STATUS_TRANSAKSI).optional(),
  akunId: z.string().uuid().optional(),
}).extend({ rentang: SkemaRentangTanggal.partial().optional() }).extend(BENTUK_URUT);

export type FilterTransaksi = z.infer<typeof SkemaFilterTransaksi>;

export interface Transaksi {
  readonly id: string;
  readonly kode: string;
  readonly organizationId: string;
  readonly jenis: JenisTransaksi;
  readonly arah: ArahTransaksi;
  readonly akunId: string;
  readonly akunKode: string;
  readonly akunNama: string;
  readonly nominal: number;
  readonly keterangan: string;
  readonly tanggal: string;
  readonly status: StatusTransaksi;
  readonly programId: string | null;
  readonly programNama: string | null;
  readonly eventId: string | null;
  readonly pengajuanId: string | null;
  readonly pemohonId: string | null;
  readonly pemohonNama: string | null;
  readonly disetujuiOleh: string | null;
  readonly disetujuiPada: string | null;
  readonly dipostingPada: string | null;
  readonly dibuatPada: string;
}

// ============================================================
// Ledger (buku besar) — immutable
// ============================================================

export interface EntriLedger {
  readonly id: string;
  readonly transaksiId: string;
  readonly periodeKeuanganId: string;
  readonly akunId: string;
  readonly akunKode: string;
  readonly tanggal: string;
  readonly debet: number;
  readonly kredit: number;
  readonly saldoBerjalan: number;
  readonly narration: string;
  readonly createdAt: string;
}

export const SkemaFilterLedger = SkemaPaginasi.extend({
  organizationId: z.string().uuid().optional(),
  akunId: z.string().uuid().optional(),
  periodeKeuanganId: z.string().uuid().optional(),
}).extend({ rentang: SkemaRentangTanggal.partial().optional() }).extend(BENTUK_URUT);

// ============================================================
// Kas / buku kas (cashbook)
// ============================================================

/** Kas dihitung SELALU dari ledger, tidak pernah disimpan sebagai angka tunggal. */
export interface Kas {
  readonly organizationId: string;
  readonly periodeKeuanganId: string;
  readonly nama: string;
  readonly saldoAwal: number;
  readonly totalPemasukan: number;
  readonly totalPengeluaran: number;
  readonly saldoAkhir: number;
  readonly periode: { readonly dari: string; readonly sampai: string };
  readonly perKategori: readonly { akunKode: string; akunNama: string; nominal: number }[];
  readonly belumLunas: readonly { memberId: string; nama: string; nominal: number }[];
}

/** Ringkasan untuk dasbor Bendahara. */
export interface RingkasanKeuangan {
  readonly saldoSaatIni: number;
  readonly pemasukanBulanIni: number;
  readonly pengeluaranBulanIni: number;
  readonly saldoBulanLalu: number;
  readonly pendingReimbursement: number;
  readonly pendingExpense: number;
  readonly utilizationAnggaran: readonly {
    readonly programId: string;
    readonly programNama: string;
    readonly disetujui: number;
    readonly realisasi: number;
    readonly persen: number;
  }[];
}

// ============================================================
// Reimbursement
// ============================================================

export const SkemaBuatReimbursement = z.object({
  organizationId: z.string().uuid(),
  nominal: SkemaNominal.positive('Nominal harus lebih dari nol'),
  keterangan: z.string().min(5).max(500),
  tanggal: z.string().date(),
  akunId: z.string().uuid(),
  programId: z.string().uuid().nullable().optional(),
  buktiDokumenId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().max(100).optional(),
});
export type PayloadBuatReimbursement = z.infer<typeof SkemaBuatReimbursement>;

export interface Reimbursement {
  readonly id: string;
  readonly kode: string;
  readonly memberId: string;
  readonly memberNama: string;
  readonly nominal: number;
  readonly keterangan: string;
  readonly tanggal: string;
  readonly status: StatusReimbursement;
  readonly programId: string | null;
  readonly buktiDokumenId: string | null;
  readonly direviewOleh: string | null;
  readonly disetujuiOleh: string | null;
  readonly dibayarOleh: string | null;
  readonly dibayarPada: string | null;
  readonly metodePembayaran: MetodePembayaran | null;
  readonly referensiPembayaran: string | null;
  readonly dibuatPada: string;
}

// ============================================================
// Pembayaran (payment intent untuk QRIS)
// ============================================================

export const SkemaBuatPaymentIntent = z.object({
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
  nominal: SkemaNominal.positive(),
  keterangan: z.string().min(3).max(300),
  jenis: z.enum(['KAS', 'IURAN', 'EVENT', 'PROGRAM', 'OTHER']).default('KAS'),
  periode: z.string().max(20).nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().max(100),
});
export type PayloadBuatPaymentIntent = z.infer<typeof SkemaBuatPaymentIntent>;

export interface PaymentIntent {
  readonly id: string;
  readonly kode: string;
  readonly memberId: string;
  readonly memberNama: string;
  readonly nominal: number;
  readonly status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';
  readonly metode: MetodePembayaran;
  readonly qrString: string | null;
  readonly qrUrl: string | null;
  readonly referensiProvider: string | null;
  readonly kedaluwarsaPada: string;
  readonly dibayarPada: string | null;
  readonly dibuatPada: string;
}

/** Bentuk webhook masuk dari payment provider. */
export const SkemaWebhookPembayaran = z.object({
  event: z.string().max(80),
  orderId: z.string().min(4).max(120),
  status: z.string().max(40),
  amount: z.coerce.number().int().nonnegative(),
  paidAt: z.string().datetime().optional(),
  signature: z.string().max(400).optional(),
  timestamp: z.coerce.number().int().optional(),
  raw: z.record(z.string(), z.unknown()).default({}),
});
export type PayloadWebhookPembayaran = z.infer<typeof SkemaWebhookPembayaran>;

// ============================================================
// Laporan keuangan
// ============================================================

export interface LaporanKeuangan {
  readonly periode: { readonly dari: string; readonly sampai: string };
  readonly frekuensi: 'HARIAN' | 'MINGGUAN' | 'BULANAN' | 'TAHUNAN' | 'KUSTOM';
  readonly saldoAwal: number;
  readonly totalPemasukan: number;
  readonly totalPengeluaran: number;
  readonly saldoAkhir: number;
  readonly perKategori: readonly {
    readonly akunKode: string;
    readonly akunNama: string;
    readonly pemasukan: number;
    readonly pengeluaran: number;
  }[];
  readonly perProgram: readonly {
    readonly programId: string | null;
    readonly programNama: string;
    readonly pemasukan: number;
    readonly pengeluaran: number;
    readonly anggaran: number;
  }[];
  readonly belumLunas: number;
  readonly outstandingReimbursement: number;
  readonly transaksi: readonly Transaksi[];
}

/** Aturan ambang persetujuan — threshold dapat dikonfigurasi. */
export interface AmbangPersetujuan {
  readonly reimburseTanpaPersetujuanBawaan: number;
  readonly expensePerluPersetujuanKetua: number;
  readonly expensePerluPersetujuanKetuaUntuk: readonly string[];
}

export const DEFAULT_AMBANG_PERSETUJUAN: AmbangPersetujuan = {
  reimburseTanpaPersetujuanBawaan: 100_000,
  expensePerluPersetujuanKetua: 500_000,
  expensePerluPersetujuanKetuaUntuk: ['INCOME', 'EXPENSE'],
};
