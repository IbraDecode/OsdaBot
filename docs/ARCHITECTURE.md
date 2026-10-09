# Arsitektur OSDA Platform

Dokumen ini menjelaskan susunan kode OSDA Platform v2, pembagian lapisan (layering),
dan arah ketergantungan antar paket. Isinya mengikuti kode yang benar-benar ada di
repositori `osda` pada saat dokumen ditulis.

---

## 1. Gambaran Umum

OSDA Platform adalah **monorepo pnpm + Turborepo** tunggal untuk seluruh kegiatan
OSIS. Satu repositori memuat:

| Direktori | Paket | Isi |
|---|---|---|
| `apps/api` | `@osda/api` | Backend NestJS 11 di atas Fastify 5. Seluruh aturan bisnis berjalan di sini. |
| `apps/web` | (belum ada kode) | Direktori cadangan untuk Web Dashboard Next.js. Lihat `WEB.md`. |
| `apps/bot` | `@osda/bot` | Client WhatsApp berbasis Baileys. Tidak punya database sendiri. |
| `apps/mobile` | (belum ada kode) | Direktori cadangan untuk aplikasi Expo. Lihat `MOBILE.md`. |
| `packages/contracts` | `@osda/contracts` | Skema Zod, daftar enum, daftar permission, bentuk error. Satu bahasa untuk semua klien. |
| `packages/db` | `@osda/db` | Skema Drizzle 74 tabel, SQL invariant, CLI migrasi/seed. |
| `packages/domain` | `@osda/domain` | Aturan transisi status dan perhitungan kecil (tenggat, progres, persen). |
| `packages/auth` | `@osda/auth` | Pembangkit token acak, hashing token, penggabung izin bawaan. |
| `packages/notifications` | `@osda/notifications` | Mesin pengirim notifikasi + penyedia kanal (console, whatsapp, email). |
| `packages/config` | `@osda/config` | Helper konfigurasi bersama. |
| `tools/legacy` | `@osda/legacy-tools` | Skrip migrasi dari OSDA BOT v0.4. Lihat `MIGRATION.md`. |

Prinsip utama: **tidak ada aplikasi yang mengakses database selain `@osda/api`**.
Bot WhatsApp, Web, dan Mobile semuanya berbicara lewat REST API. Lihat
`apps/bot/src/api/client.ts` — bot hanya memanggil `fetch` ke jalur `/api/v1/*`.

---

## 2. Diagram Lapisan

```
┌──────────────────────────────────────────────────────────────────────┐
│ KLIEN                                                                │
│  Web (Next.js)   Mobile (Expo)   Bot WhatsApp (Baileys)   Admin/CLI  │
└───────┬──────────────────┬───────────────┬───────────────────┬───────┘
        │ HTTP/JSON        │ HTTP/JSON     │ HTTP/JSON         │ SQL
        ▼                  ▼               ▼                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ API  (apps/api — NestJS + Fastify)                                   │
│                                                                      │
│  ┌────────────┐   ┌──────────────┐   ┌───────────────────────────┐   │
│  │ Controller │ → │   Service    │ → │       Repository          │   │
│  │  (rute,    │   │ (aturan bisnis│   │  (Drizzle query builder)  │   │
│  │   DTO/Zod) │   │  + transaksi) │   │                           │   │
│  └────────────┘   └──────────────┘   └─────────────┬─────────────┘   │
│         │                                          │                 │
│  ┌──────▼──────────────────────────────────────────▼───────────┐     │
│  │ Guard & Interceptor global (bootstrap.ts)                   │     │
│  │  JwtAuthGuard → IzinGuard → OrganizationGuard → RoleCodeGuard│    │
│  │  CurrentUserInterceptor → AuditInterceptor                  │     │
│  │  HttpExceptionFilter (bentuk galat tunggal)                 │     │
│  └─────────────────────────────────────────────────────────────┘     │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐   ┌────────────────────┐   ┌───────────────────────┐
│ packages/     │   │ packages/db        │   │ packages/notifications│
│ contracts     │   │  schema (74 tabel) │   │  MesinNotifikasi      │
│ domain        │   │  sql/invariants.ts │   │  + penyedia kanal     │
│ auth          │   │                    │   │                       │
└───────────────┘   └─────────┬──────────┘   └───────────────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │  PostgreSQL             │
                 │  - 74 tabel             │
                 │  - trigger & constraint │
                 │  - index unik & parsial │
                 └─────────────────────────┘
```

### Alur satu permintaan

```
HTTP POST /api/v1/attendance/sessions/:id/absen
   │
   ├─ 1. Fastify menerima, memberi requestId (genReqId)
   ├─ 2. CurrentUserInterceptor menempel konteks permintaan
   ├─ 3. JwtAuthGuard: verifikasi JWT, isi request.pengguna
   ├─ 4. IzinGuard: cek metadata @Izin('attendance.write')
   ├─ 5. OrganizationGuard: tentukan organizationId (header x-organization-id)
   ├─ 6. ValidationPipe (Zod): bersihkan & validasi body
   ├─ 7. Controller → AttendanceService
   │        ├─ pastikanOrganisasiAktif()
   │        ├─ transaksi database (dalamTransaksi)
   │        ├─ CHECK constraint chk_alasan_wajib (database)
   │        └─ catatAudit() bila perlu
   ├─ 8. AuditInterceptor menulis baris audit (fire-and-forget)
   └─ 9. HttpExceptionFilter memformat setiap galat menjadi
          { error: { code, message, requestId } }
```

---

## 3. Lapisan URL → Database

| Lapisan | Lokasi | Tanggung jawab |
|---|---|---|
| Client | `apps/web`, `apps/mobile`, `apps/bot` | Tampilan & pengalaman pemakai. Tidak boleh memutuskan izin. |
| API | `apps/api/src/modules/*/*.controller.ts` | Menerjemahkan HTTP menjadi pemanggilan service, memetakan DTO Zod. |
| Auth | `apps/api/src/auth/*` | Verifikasi token, resolusi izin efektif, penerbitan sesi. |
| Authorization | `apps/api/src/auth/guards/*` + `@Izin()` | Endpoint-level, lalu service-level (`pastikanIzin`), lalu resource-level. |
| Application | `apps/api/src/modules/*/*.service.ts` | Aturan bisnis, transaksi, idempotensi, orkestrasi. |
| Domain | `packages/domain/src/aturan.ts` | Alur status yang sah dan perhitungan yang dipakai berulang. |
| Repository | Query Drizzle di dalam service | Tidak ada lapisan repository terpisah; pola query hidup di service agar transaksi mudah digabung. |
| Database | `packages/db/src/schema/*.ts` + `packages/db/src/sql/invariants.ts` | Satu-satunya sumber kebenaran. Trigger & constraint menegakkan invariant. |

---

## 4. Peran Tiap Paket

### `packages/contracts`

Satu sumber untuk tipe, skema, dan aturan yang dipakai semua klien.

- `src/permissions.ts` — `PERAN_BAWAAN`, `PERMISSION` (38 izin), `CAKUPAN`, `MATRICS_PERAN`, `RUANG_KERJA_PERAN`.
- `src/enums.ts` — seluruh status domain (`STATUS_TUGAS`, `STATUS_PROGRAM`, `TRANSISI_PROGRAM`, …).
- `src/common.ts` — `KODE_ERROR`, `BentukError`, `SkemaPaginasi`, `SkemaUrut`, `SkemaNominal`, helper `formatRupiah`.
- `src/finance.ts` — `DEFAULT_AMBANG_PERSETUJUAN` (reimbursement tanpa persetujuan Rp100.000; pengeluaran di atas Rp500.000 perlu persetujuan Ketua).

### `packages/db`

- `src/schema/_base.ts` — helper kolom bersama (`pk`, `dibuatPada`, `diubahPada`, `versiBaris`, `uang`) dan seluruh enum database.
- `src/schema/*.ts` — 74 tabel dikelompokkan per modul.
- `src/sql/invariants.ts` — `SQL_INVARIANT`, dijalankan **setelah** migrasi Drizzle (lihat `src/cli/migrate.ts`).
- `src/cli/seed.ts` — menyemai permission, peran bawaan, organisasi, jabatan, divisi, chart of accounts, dan akun administrator.

### `packages/auth`

- Pembangkit token acak (`buatTokenAcak`), hashing token (`hashToken`), UUID acak, serta `satukanIzinBawaan` yang dipakai `LayananIzin` sebagai nilai cadangan bila database belum berisi peran.

### `packages/notifications`

`MesinNotifikasi` mengirim ke beberapa kanal sekaligus; kegagalan satu kanal tidak
menggagalkan kanal lain. Penyedia bawaan: `PenyediaConsole`, `PenyediaWhatsapp`,
`PenyediaEmail` (stub — pesan "belum dikonfigurasi").

---

## 5. Siklus Latar (Scheduler)

`apps/api/src/modules/sistem/scheduler.service.ts` menjalankan pekerjaan berkala
memakai `setInterval` — **bukan** Redis/BullMQ. Setiap siklus lebih dulu mengambil
advisory lock Postgres (`pg_try_advisory_xact_lock`) lewat
`apps/api/src/database/pengunci.service.ts`, sehingga aman dijalankan pada beberapa
instance API sekaligus: instance yang tidak mendapatkan lock melewati siklus.

Pekerjaan utama: menutup sesi absensi yang sudah kedaluwarsa (`tutupSesiKedaluwarsa`).
Interval diatur `SCHEDULER_INTERVAL_DETIK`, kunci diatur `ID_KUNCI_SCHEDULER`.

---

## 6. Konfigurasi

Konfigurasi dibaca dari `.env` (contoh lengkap di `.env.example`). Nilai penting:

| Variabel | Fungsi |
|---|---|
| `API_PORT`, `API_HOST`, `PUBLIC_API_URL` | Alamat API dan basis URL tautan dalam |
| `CORS_ORIGINS` | Daftar asal yang diizinkan (dipisah koma) |
| `RATE_LIMIT_PER_MINUTE` | Batas permintaan per menit per IP |
| `DATABASE_URL` / `DATABASE_POOL_MAX` | Koneksi PostgreSQL (bila kosong, PGlite lokal dipakai) |
| `REDIS_URL` | Opsional; bila kosong antrean memakai fallback in-process |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Autentikasi |
| `STORAGE_*` | Object storage S3-compatible untuk dokumen |
| `WHATSAPP_*` | Konfigurasi bot Baileys |
| `PAYMENT_*`, `WEBHOOK_PORT` | Penyedia pembayaran QRIS |
| `SEED_*` | Akun administrator pertama untuk `pnpm db:seed` |

---

## 7. Titik Masuk Perintah Penting

```bash
pnpm dev                 # jalankan semua aplikasi (turbo, paralel)
pnpm --filter @osda/api dev
pnpm --filter @osda/bot dev

pnpm db:generate         # hasilkan migrasi Drizzle dari skema
pnpm db:migrate          # jalankan migrasi + SQL invariant
pnpm db:seed             # semai permission, peran, organisasi, akun admin
pnpm db:reset            # kosongkan & bangun ulang

pnpm legacy:dump         # dump database OSDA BOT v0.4 → ~/osda-backup/*.json
pnpm legacy:migrate      # migrasi data lama → skema v2
pnpm legacy:reconcile    # bandingkan jumlah data lama vs v2
```

Dokumentasi OpenAPI tersedia di `/api/docs` (JSON di `/api/docs-json`), health
probe di `/health/live` dan `/health/ready`.

---

## 8. Apa yang Perlu Diingat Saat Mengubah Arsitektur

- **Jangan tambahkan akses database di luar `apps/api`.** Bot sengaja hanya memanggil REST.
- **Jangan pindahkan aturan status ke dalam controller.** Semua transisi sah didefinisikan
  di `packages/contracts/src/enums.ts` dan di-expose ulang oleh `packages/domain`.
- **Jangan mengandalkan daftar peran di kode.** Database (`roles`, `role_permissions`) adalah
  sumber kebenaran; `MATRICS_PERAN` hanya nilai awal seed dan cadangan.

---

## Catatan untuk AI agent

1. Setiap perubahan pada `packages/db/src/schema/*.ts` WAJIB disertai `pnpm db:generate` agar
   migrasi Drizzle ikut terbit — jangan mengubah database produksi dengan tangan.
2. `packages/db/src/sql/invariants.ts` dijalankan terpisah setelah migrasi; bila menambah tabel
   baru, periksa apakah trigger `trg_updated_at` sudah terbentuk (trigger dibuat otomatis untuk
   setiap tabel yang punya kolom `diubah_pada`).
3. `packages/contracts` dan `packages/db` adalah paket dasar. Menambah dependensi dari paket lain
   ke `apps/*` boleh, tetapi jangan membuat `contracts` bergantung pada `db` atau sebaliknya agar
   tidak terjadi siklus.
4. `apps/web` dan `apps/mobile` masih berupa direktori kosong. Jangan menulis dokumen atau kode
   yang menyatakan fitur tersebut sudah ada; gunakan kata "rencana".
5. Scheduler memakai advisory lock Postgres, bukan Redis. Bila menambah pekerjaan berkala baru,
   jangan menghapus pemeriksaan lock karena akan menyebabkan eksekusi ganda saat multi-instance.
