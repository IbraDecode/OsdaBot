# @osda/web — Dasbor OSDA (Next.js)

Dasbor Web untuk OSDA Platform (_OSIS Digital Administration & Operations Platform_).
Seluruh data diambil lewat **REST API OSDA** (bawaan `http://localhost:4000`) —
aplikasi ini **tidak pernah** mengakses database langsung.

## Teknologi

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS v4 via `@tailwindcss/postcss` (tanpa file konfigurasi kompleks)
- `@osda/contracts` sebagai satu-satunya sumber tipe, izin, dan enum

## Menjalankan

```bash
# dari akar monorepo
pnpm install

# salin variabel lingkungan lalu sesuaikan bila perlu
cp apps/web/.env.example apps/web/.env.local

# jalankan dasbor (port 3000)
pnpm --filter @osda/web dev
```

Pastikan API OSDA sudah berjalan terlebih dahulu:

```bash
pnpm --filter @osda/api dev     # http://localhost:4000
```

Dokumentasi OpenAPI tersedia di <http://localhost:4000/api/docs>.

## Perintah lain

```bash
pnpm --filter @osda/web typecheck   # tsc --noEmit (dipakai sebagai lint)
pnpm --filter @osda/web build       # build produksi
```

> Catatan lingkungan: bila variabel `NODE_ENV` di shell Anda bernilai
> `development` (seperti pada beberapa lingkungan hosting), jalankan build
> dengan `NODE_ENV=production pnpm --filter @osda/web build`. Tanpa itu
> Next 16 bisa gagal saat mem-prerender halaman.

## Struktur

```
src/
  app/
    (auth)/login/            halaman masuk (email + kata sandi)
    (aplikasi)/              layout + seluruh halaman dasbor
      page.tsx               dasbor sesuai ruang kerja pengguna
      members|attendance|meetings|tasks|programs|
      finance|reports|settings|notifications/page.tsx
  components/
    dasbor/                  satu berkas per bentuk dasbor (ketua, wakil, …)
    ui/                      kartu, tabel, tombol, badge, spinner, input, select, modal
    sidebar.tsx topbar.tsx   sidebar DINAMIS + topbar
    ikon.tsx                 ikon inline
  contexts/sesi.tsx          pengguna + izin efektif + cakupan
  lib/
    api-client.ts            klien fetch (Bearer, refresh token, galat → UX)
    menu.ts                  daftar menu beserta izin yang dibutuhkan
    ruang-kerja.ts           RUANG_KERJA_PERAN → ruang kerja default
    use-ambil.ts             hook ambil data API
```

## Aturan penting

1. **Izin lebih dulu, peran kemudian.** Sidebar dan tombol dibangun dari daftar
   izin efektif pengguna (`punyaIzin(...)`), bukan dari nama peran. Menyembunyikan
   menu hanya untuk kenyamanan — **backend tetap menjadi penjaga akhir** setiap
   aksi (JwtAuthGuard + IzinGuard + OrganizationGuard).
2. **Satu bentuk dasbor per peran.** `GET /api/v1/users/me/dashboard` mengirim
   bentuk yang berbeda: `EXECUTIVE` → DasborKetua, `OPERATIONS` → DasborWakil,
   `ADMINISTRATION` → DasborSekretaris, `FINANCE` → DasborBendahara,
   `COMMUNICATION` → DasborHumas, `DIVISION` → DasborKoordinator,
   `PERSONAL` → DasborAnggota.
3. **Galat selalu `{ error: { code, message, requestId } }`** dan diterjemahkan
   `src/lib/api-client.ts` menjadi pesan Bahasa Indonesia yang jelas.
4. **Semua komentar dan label UI Bahasa Indonesia.**

## Catatan teknis

- Klien memakai `fetch` bawaan (tidak ada axios) agar bundel tetap ramping.
- Nilai runtime dari kontrak (`RUANG_KERJA_PERAN`, `STATUS_*`,
  `TINGKAT_KELAS`) diimpor dari subpath modul sumbernya
  (`@osda/contracts/enums`, `@osda/contracts/permissions`,
  `@osda/contracts/profile`). Sebabnya: bundler Turbopack tidak dapat mengikuti
  rantai `export *` di `packages/contracts/src/index.ts` karena impor di sana
  memakai ekstensi `.js` padahal berkasnya `.ts`. Tipe tetap diimpor dari
  `@osda/contracts` (impor tipe dihapus saat bundling).
- `@osda/contracts` masuk ke `transpilePackages` karena paket itu dikirim sebagai
  sumber TypeScript, bukan hasil build.
- `src/app/global-error.tsx` disediakan agar batas galat global memakai teks
  Bahasa Indonesia (ia menggantikan root layout, jadi wajib memuat
  `<html>`/`<body>` sendiri).
