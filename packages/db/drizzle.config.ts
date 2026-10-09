import { defineConfig } from 'drizzle-kit';

/**
 * Konfigurasi Drizzle Kit.
 *
 * Catatan penting:
 * - Semua statement hasil generate TIDAK diedit manual. Untuk perubahan yang
 *   memerlukan penyesuaian data, tulis migration SQL manual di
 *   `drizzle/manual/` dan jalankan lewat `pnpm --filter @osda/db migrate`.
 * - `db:push` hanya untuk pengembangan lokal yang datanya boleh dibuang. Jangan
 *   pernah dipakai di staging/production (dapat menghapus kolom tanpa peringatan).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    // URL default hanya untuk mesin lokal dan BUKAN kredensial nyata.
    //和环境 yang sebenarnya selalu menyuplai DATABASE_URL lewat environment.
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/osda',
  },
  verbose: true,
  strict: true,
  migrations: {
    table: '__osda_migrations',
    schema: 'public',
  },
});
