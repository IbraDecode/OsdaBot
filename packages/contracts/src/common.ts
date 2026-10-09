/**
 * Skema & tipe umum yang dipakai semua endpoint API.
 */
import { z } from 'zod';

/** Kode error API. Format errortetap: `{ error: { code, message, requestId } }`. */
export const KODE_ERROR = [
  // 400
  'VALIDATION_FAILED',
  'INVALID_STATE_TRANSITION',
  'DUPLICATE_RECORD',
  // 401 / 403
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'PERMISSION_DENIED',
  'OBJECT_ACCESS_DENIED',
  'SCOPE_DENIED',
  // 404
  'NOT_FOUND',
  // 409
  'CONFLICT',
  'ATTENDANCE_ALREADY_RECORDED',
  'SESSION_CLOSED',
  'SESSION_NOT_OPEN',
  'APPROVAL_ALREADY_RESOLVED',
  'DOCUMENT_VERSION_IMMUTABLE',
  'LEDGER_IMMUTABLE',
  // 402 / 50
  'PAYMENT_REQUIRED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'INTEGRATION_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  // 413
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  // 415/422
  'UNPROCESSABLE',
] as const;

export type KodeError = (typeof KODE_ERROR)[number];

/** Bentuk error standar seluruh API. */
export interface BentukError {
  readonly error: {
    readonly code: KodeError;
    readonly message: string;
    readonly requestId: string;
    readonly detail?: unknown;
  };
}

/** Skema error untuk dokumentasi OpenAPI. */
export const SkemaError = z.object({
  error: z.object({
    code: z.enum(KODE_ERROR),
    message: z.string(),
    requestId: z.string(),
    detail: z.unknown().optional(),
  }),
});

/** Kode status HTTP yang dipetakan ke kode error. */
export const HTTP_DARI_KODE_ERROR: Readonly<Record<KodeError, number>> = {
  VALIDATION_FAILED: 400,
  INVALID_STATE_TRANSITION: 409,
  DUPLICATE_RECORD: 409,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  PERMISSION_DENIED: 403,
  OBJECT_ACCESS_DENIED: 403,
  SCOPE_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ATTENDANCE_ALREADY_RECORDED: 409,
  SESSION_CLOSED: 409,
  SESSION_NOT_OPEN: 409,
  APPROVAL_ALREADY_RESOLVED: 409,
  DOCUMENT_VERSION_IMMUTABLE: 409,
  LEDGER_IMMUTABLE: 409,
  PAYMENT_REQUIRED: 402,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  INTEGRATION_UNAVAILABLE: 503,
  STORAGE_UNAVAILABLE: 503,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  UNPROCESSABLE: 422,
};

// ============================================================
// Pagination
// ============================================================

/** Parameter pagination berbasis halaman (default). */
export const SkemaPaginasi = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Paginasi = z.infer<typeof SkemaPaginasi>;

/** Parameter pagination berbasis kursor — untuk daftar besar seperti audit & ledger. */
export const SkemaKursor = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type Kursor = z.infer<typeof SkemaKursor>;

/** Pembungkus hasil daftar dengan informasi halaman. */
export interface HasilDaftar<T> {
  readonly data: readonly T[];
  readonly meta: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrev: boolean;
  };
}

/** Pembungkus hasil daftar dengan kursor. */
export interface HasilKursor<T> {
  readonly data: readonly T[];
  readonly meta: {
    readonly nextCursor: string | null;
    readonly hasNext: boolean;
  };
}

/** Bangun pembungkus hasil daftar. */
export function bungkusDaftar<T>(data: T[], total: number, p: Paginasi): HasilDaftar<T> {
  const totalPages = Math.max(1, Math.ceil(total / p.limit));
  return {
    data,
    meta: {
      page: p.page,
      limit: p.limit,
      total,
      totalPages,
      hasNext: p.page < totalPages,
      hasPrev: p.page > 1,
    },
  };
}

/** Bentuk (shape) parameter pengurutan — dipakai saat memperpanjang skema filter. */
export const BENTUK_URUT = {
  sortBy: z.string().max(64).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
} as const;

/** Parameter pengurutan yang aman (whitelist di server, bukan interpolasi bebas). */
export const SkemaUrut = z.object(BENTUK_URUT);
export type Urut = z.infer<typeof SkemaUrut>;

// ============================================================
// Format & validasi umum
// ============================================================

/** Nomor telepon Indonesia dalam format internasional tanpa tanda plus. */
export const SkemaTelepon = z
  .string()
  .regex(/^62\d{8,15}$/, 'Nomor telepon harus format 62xxxxxxxxxx tanpa tanda plus');

/** Alamat surel dengan normalisasi huruf kecil. */
export const SkemaSurel = z.string().email().max(254).transform((v) => v.toLowerCase().trim());

/** Kode pos Indonesia. */
export const SkemaKodePos = z.string().regex(/^\d{5}$/, 'Kode pos harus 5 digit');

/** Tanggal tanpa waktu (YYYY-MM-DD). */
export const SkemaTanggal = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');

/** Waktu 24 jam (HH:mm). */
export const SkemaWaktu = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format waktu harus HH:mm');

/** Nama orang: huruf, spasi, titik, tanda hubung. */
export const SkemaNama = z
  .string()
  .min(2, 'Nama minimal 2 karakter')
  .max(120, 'Nama maksimal 120 karakter')
  .regex(/^[\p{L}\s.'-]+$/u, 'Nama hanya boleh huruf, spasi, titik, atau tanda hubung');

/** Jumlah uang dalam rupiah penuh (tanpa titik desimal). */
export const SkemaNominal = z
  .number()
  .int('Nominal harus bilangan bulat (rupiah penuh)')
  .nonnegative('Nominal tidak boleh negatif')
  .max(1_000_000_000_000, 'Nominal terlalu besar');

/** Penghapusan logis: arsip, bukan hapus keras. */
export const SkemaAlasanArsip = z.object({
  alasan: z.string().min(3).max(500),
});

/** Filter rentang tanggal. */
export const SkemaRentangTanggal = z.object({
  dari: SkemaTanggal.optional(),
  sampai: SkemaTanggal.optional(),
});

/** Metadata sumber permintaan untuk audit. */
export interface KonteksAktor {
  readonly userId: string | null;
  readonly organizationId: string | null;
  readonly sumber: 'API' | 'WEB' | 'MOBILE' | 'WHATSAPP' | 'SYSTEM' | 'MIGRATION';
  readonly ip?: string;
  readonly userAgent?: string;
  readonly requestId: string;
}

/** Ubah undefined menjadi null (database tidak menerima undefined). */
export function menjadiNull<T>(nilai: T | undefined | null): T | null {
  return nilai ?? null;
}

/** Format nominal rupiah untuk tampilan teks. */
export function formatRupiah(nominal: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(nominal);
}

/** Format tanggal Indonesia ringkas. */
export function formatTanggal(tanggal: string | Date): string {
  const d = typeof tanggal === 'string' ? new Date(tanggal) : tanggal;
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeZone: 'Asia/Makassar',
  }).format(d);
}
