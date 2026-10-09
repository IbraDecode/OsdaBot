/**
 * Konfigurasi aplikasi dari environment.
 *
 * Semua variabel divalidasi dengan Zod SEKALI saat aplikasi mulai, supaya
 * konfigurasi yang salah gagal cepat (fail fast) alih-alih muncul sebagai
 * galat aneh di tengah permintaan.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

/** Boolean yang bisa dibaca dari teks environment ("1", "true", "off", …). */
const SkemaBooleanTeks = z
  .union([z.boolean(), z.string()])
  .transform((nilai, ctx) => {
    if (typeof nilai === 'boolean') return nilai;
    const teks = nilai.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'aktif', 'ya'].includes(teks)) return true;
    if (['0', 'false', 'no', 'off', 'nonaktif', ''].includes(teks)) return false;
    ctx.addIssue({ code: 'custom', message: 'Harus bernilai boolean (true/false).' });
    return false;
  });

/**
 * Daftar teks yang dipisah koma → array string.
 * Dipakai sesuai kebutuhan; `bacaKonfigurasi` memakai versi pecah manual
 * agar nilai bawaan tetap berupa teks sederhana.
 */
export function pecahDaftarTeks(nilai: string): string[] {
  return nilai
    .split(',')
    .map((bagian) => bagian.trim())
    .filter((bagian) => bagian.length > 0);
}

/** Skema lengkap environment aplikasi API. */
export const SkemaEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  PUBLIC_API_URL: z.string().min(1).default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi.'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter.'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET minimal 32 karakter.'),
  AKSES_TOKEN_MENIT: z.coerce.number().int().min(1).max(1_440).default(30),
  REFRESH_TOKEN_HARI: z.coerce.number().int().min(1).max(365).default(30),
  KODE_LINKING_MENIT: z.coerce.number().int().min(1).max(120).default(15),

  /** Daftar origin CORS dipisah koma; dipecah saat validasi. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((nilai) => pecahDaftarTeks(nilai))
    .pipe(z.array(z.string().min(1)).min(1, 'Minimal satu origin CORS wajib diisi.')),
  RATE_LIMIT_MAKS: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_JENDELA: z.string().min(1).default('1 minute'),
  RATE_LIMIT_AUTH_MAKS: z.coerce.number().int().min(1).default(10),

  UPLOAD_MAKS_BYTE: z.coerce.number().int().min(1_024).default(10 * 1_024 * 1_024),

  SCHEDULER_AKTIF: SkemaBooleanTeks.default(false),
  SCHEDULER_INTERVAL_DETIK: z.coerce.number().int().min(5).max(3_600).default(60),
  ID_KUNCI_SCHEDULER: z.coerce.number().int().default(48_211),
});

/** Tipe konfigurasi aplikasi. */
export type Konfigurasi = z.infer<typeof SkemaEnv>;

/** Nama kode injeksi untuk objek konfigurasi. */
export const KONFIGURASI = 'KONFIGURASI';

/**
 * Muat berkas `.env` paling atas (dari cwd naik ke akar monorepo) ke
 * `process.env`. Nilai yang sudah ada TIDAK ditimpa.
 *
 * Dipakai karena `pnpm --filter @osda/api dev` dijalankan dari folder paket,
 * sedangkan `.env` berada di akar monorepo.
 */
export function muatEnvDariAkar(namaBerkas = '.env'): string | null {
  let folder = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const kandidat = resolve(folder, namaBerkas);
    if (existsSync(kandidat)) {
      for (const baris of readFileSync(kandidat, 'utf8').split('\n')) {
        const bersih = baris.trim();
        if (!bersih || bersih.startsWith('#')) continue;
        const idx = bersih.indexOf('=');
        if (idx < 0) continue;
        const kunci = bersih.slice(0, idx).trim();
        let nilai = bersih.slice(idx + 1).trim();
        if (
          (nilai.startsWith('"') && nilai.endsWith('"')) ||
          (nilai.startsWith("'") && nilai.endsWith("'"))
        ) {
          nilai = nilai.slice(1, -1);
        }
        if (process.env[kunci] === undefined) process.env[kunci] = nilai;
      }
      return kandidat;
    }
    const induk = dirname(folder);
    if (induk === folder) break;
    folder = induk;
  }
  return null;
}

/** Baca & validasi environment menjadi objek konfigurasi. */
export function bacaKonfigurasi(sumber: NodeJS.ProcessEnv = process.env): Konfigurasi {
  const hasil = SkemaEnv.safeParse(sumber);
  if (!hasil.success) {
    const rincian = hasil.error.issues
      .map((isu) => `  - ${isu.path.join('.') || '(root)'}: ${isu.message}`)
      .join('\n');
    throw new Error(`Konfigurasi environment tidak valid:\n${rincian}`);
  }
  return hasil.data;
}

/** Cari berkas `.env` dengan menaik dari folder aplikasi ke akar monorepo. */
export function cariEnvPath(namaBerkas = '.env'): string {
  let folder = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const kandidat = resolve(folder, namaBerkas);
    if (existsSync(kandidat)) return kandidat;
    const induk = dirname(folder);
    if (induk === folder) break;
    folder = induk;
  }
  // Tidak ditemukan — kembalikan path bawaan agar ConfigModule tidak galat.
  return resolve(process.cwd(), namaBerkas);
}
