/**
 * DTO modul keuangan. Skema inti (akun, periode, anggaran, pengajuan,
 * transaksi, ledger, reimbursement, payment intent, webhook) dari `@osda/contracts`.
 */
import { z } from 'zod';
import {
  SkemaNominal,
  SkemaTanggal,
} from '@osda/contracts';

/** Parameter path `:id` umum. */
export const SkemaIdFinansial = z.object({
  id: z.string().uuid('ID harus UUID yang valid.'),
});

/** Parameter path akun. */
export const SkemaIdAkun = z.object({
  id: z.string().uuid('ID akun harus UUID yang valid.'),
});

/** Parameter path periode keuangan. */
export const SkemaIdPeriodeKeuangan = z.object({
  id: z.string().uuid('ID periode keuangan harus UUID yang valid.'),
});

/** Body keputusan atas pengajuan (kontrak `SkemaPutuskanPengajuan`). */
export { SkemaPutuskanPengajuan } from '@osda/contracts';

/** Body keputusan reimbursement. */
export const SkemaPutuskanReimbursement = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(1000).optional(),
  tandaiDibayar: z.boolean().default(false),
  metodePembayaran: z.enum(['CASH', 'QRIS', 'BANK_TRANSFER', 'EWALLET']).optional(),
  referensiPembayaran: z.string().max(200).nullable().optional(),
});

/** Filter laporan keuangan. */
export const SkemaFilterLaporan = z.object({
  dari: SkemaTanggal.optional(),
  sampai: SkemaTanggal.optional(),
  frekuensi: z.enum(['HARIAN', 'MINGGUAN', 'BULANAN', 'TAHUNAN', 'KUSTOM']).default('BULANAN'),
  periodeKeuanganId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
});

/** Query kas (buku kas). */
export const SkemaKas = z.object({
  periodeKeuanganId: z.string().uuid().optional(),
  dari: SkemaTanggal.optional(),
  sampai: SkemaTanggal.optional(),
});

/** Persetujuan transaksi. */
export const SkemaSetujuiTransaksi = z.object({
  komentar: z.string().max(1000).optional(),
});

/** Buat transaksi kas (dicatat manual oleh Bendahara). */
export const SkemaBuatTransaksi = z.object({
  organizationId: z.string().uuid(),
  akunId: z.string().uuid(),
  accountTujuanId: z.string().uuid().nullable().optional(),
  jenis: z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'REIMBURSEMENT', 'ADJUSTMENT']),
  arah: z.enum(['IN', 'OUT']),
  nominal: SkemaNominal.positive('Nominal harus lebih dari nol'),
  keterangan: z.string().min(3).max(500),
  tanggal: SkemaTanggal,
  programId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().max(100).optional(),
});

/** Audit aksi keuangan yang dipakai endpoint approve. */
export const SkemaPutuskanTransaksi = z.object({
  keputusan: z.enum(['APPROVED', 'REJECTED']),
  komentar: z.string().max(1000).optional(),
});
