/**
 * Klien database OSDA.
 *
 * Mendukung dua mode:
 *  1. PostgreSQL eksternal (DATABASE_URL) — untuk development, staging, production.
 *  2. PGlite (embedded PostgreSQL, berbasis WASM) — untuk pengujian otomatis
 *     dan demo offline tanpa Docker. Aktif bila DATABASE_URL kosong dan
 *     PGLITE_DIR diset.
 *
 * Driver yang dipilih harus menyediakan API yang sama (`tx`), sehingga seluruh
 * repository tidak perlu tahu mode mana yang sedang aktif.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';

import { schema } from './schema/index.js';

/**
 * Tipe database aktif.
 *
 * Postgres eksternal (NodePgDatabase) dan PGlite embedded (PgliteDatabase)
 * sama-sama turunan `PgDatabase`, sehingga tipe ini memuat antarmuka query
 * yang sama untuk keduanya. Parameter HKT dilonggarkan agar kedua driver
 * dianggap kompatibel — pemanggilan query tetap terkontrol oleh skema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema, any>;

/** Koneksi raw PostgreSQL (untuk migrasi manual & dump). */
export type DbPostgres = Awaited<ReturnType<typeof buatDbPostgres>>;
/** Koneksi PGlite embedded. */
export type DbPglite = Awaited<ReturnType<typeof buatDbPglite>>;

/** Baca variabel lingkungan dari berkas `.env` bila ada (tanpa dependensi luar). */
export function muatEnv(path = '.env'): void {
  try {
    const isi = readFileSync(resolve(path), 'utf8');
    for (const baris of isi.split('\n')) {
      const bersih = baris.trim();
      if (!bersih || bersih.startsWith('#')) continue;
      const idx = bersih.indexOf('=');
      if (idx < 0) continue;
      const kunci = bersih.slice(0, idx).trim();
      let nilai = bersih.slice(idx + 1).trim();
      // Buang tanda kutip bila ada
      if (
        (nilai.startsWith('"') && nilai.endsWith('"')) ||
        (nilai.startsWith("'") && nilai.endsWith("'"))
      ) {
        nilai = nilai.slice(1, -1);
      }
      if (process.env[kunci] === undefined) process.env[kunci] = nilai;
    }
  } catch {
    // .env tidak ada — biarkan dari environment sistem
  }
}

/** Apakah memakai mode PGlite (embedded). */
export function memakaiPglite(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (url && url.length > 0) return false;
  return Boolean(process.env.PGLITE_DIR);
}

/** Buat koneksi database (mode PostgreSQL eksternal). */
export async function buatDbPostgres(url?: string) {
  const dbUrl = url ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL belum diatur. Isi .env atau setel PGLITE_DIR untuk mode embedded.',
    );
  }
  const pool = await buatPoolPg(dbUrl);
  return drizzlePostgres(pool, { schema, casing: 'snake_case' });
}

/** Buat koneksi database (mode PGlite embedded). */
export async function buatDbPglite(dir?: string) {
  const folder = dir ?? process.env.PGLITE_DIR ?? './.pgdata';
  const { PGlite } = await import('@electric-sql/pglite');
  const client = new PGlite(folder);
  return drizzlePglite(client, { schema, casing: 'snake_case' });
}

/** Lazy import pg Pool agar tidak ter-load bila tidak dipakai. */
let pgMod: typeof import('pg') | null = null;
async function buatPoolPg(url: string) {
  pgMod ??= await import('pg');
  return new pgMod.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: url.includes('sslmode=require') || url.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

/** Buat koneksi sesuai mode yang aktif. */
export async function buatDb(): Promise<Db> {
  muatEnv();
  return memakaiPglite() ? buatDbPglite() : buatDbPostgres();
}

/** Jalankan seluruh migrasi Drizzle. */
export async function jalankanMigrasi(db: Db): Promise<void> {
  // `src/client.ts` → `../drizzle` = folder migrasi di dalam paket @osda/db
  const folderMigrasi = fileURLToPath(new URL('../drizzle', import.meta.url));
  if (memakaiPglite()) {
    await migratePglite(db as never, { migrationsFolder: folderMigrasi });
  } else {
    await migratePostgres(db as never, { migrationsFolder: folderMigrasi });
  }
}

/** Cek kesehatan koneksi (dipakai /health/ready). */
export async function cekKesehatan(db: Db): Promise<{ ok: boolean; detail?: string }> {
  try {
    await db.execute(sql`select 1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export { schema, sql };
export * from './schema/index.js';
