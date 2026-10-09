# OSDA Platform

**OSIS Digital Administration & Operations Platform**

> *"Satu sistem untuk mengelola organisasi, satu sumber data untuk semua."*

---

## Apa Ini

OSDA bukan lagi sekadar WhatsApp bot. OSDA adalah platform digital untuk
operasional OSIS yang terdiri dari backend API, Web Dashboard, Mobile App,
WhatsApp Bot, mesin notifikasi, penjadwal otomatis, sistem keuangan, sistem
dokumen & pelaporan, serta audit.

Semua client memakai **backend dan database yang sama**.

```
        ┌──────────────────────┐
        │    OSDA BACKEND      │
        │    API + DOMAIN      │
        └──────────┬───────────┘
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
  WEB DASH    MOBILE APP    WHATSAPP BOT
      │            │            │
      └────────────┼────────────┘
                   ▼
              PostgreSQL
```

**Database adalah sumber kebenaran. Client bukan sumber kebenaran. WhatsApp
bukan database.**

---

## Prinsip

- **Sederhana untuk anggota.** `HADIR`, `IZIN`, `SAKIT`, tugas hari ini.
- **Lengkap untuk pengurus.** intoleransi absensi, notulen, keuangan, laporan.
- **Terukur untuk pimpinan.** Dasbor berbeda untuk setiap peran.
- **Aman untuk organisasi.** Otorisasi tiga lapis, audit tak dapat dihapus.

---

## Prasyarat

| Kebutuhan | Versi |
|---|---|
| Node.js | 22 atau lebih baru |
| pnpm | 11 |
| PostgreSQL | 15 atau lebih baru (Neon / self-hosted) |

Redis **tidak wajib** — scheduler memakai advisory lock PostgreSQL.
Docker **tidak wajib** — `infra/docker-compose.yml` disediakan untuk
kenyamanan.

---

## Menjalankan (5 menit)

```bash
# 1. Salin konfigurasi
cp .env.example .env

# 2. Isi DATABASE_URL di .env, lalu siapkan database
pnpm install
pnpm db:migrate
pnpm db:seed

# 3. Jalankan API + Web
pnpm --filter @osda/api dev     # http://localhost:4000
pnpm --filter @osda/web dev     # http://localhost:3000
```

Buka `http://localhost:3000/login` dan masuk dengan kredensial seed
(`admin@osis.local` / `GantiPassword123!` — **segera ganti**).

Dokumentasi API interaktif: `http://localhost:4000/api/docs`

### Sebagai alternatif, dengan Docker

```bash
docker compose up -d postgres
pnpm db:migrate && pnpm db:seed
docker compose --profile app up -d
```

---

## Struktur Repositori

```
osda/
├── apps/
│   ├── api/       NestJS + Fastify — 16 modul fitur
│   ├── web/       Next.js App Router — dasbor per peran
│   ├── bot/       WhatsApp (Baileys) — client ringan
│   └── mobile/    Expo (React Native) — standalone
├── packages/
│   ├── contracts/ Kontrak tunggal: izin, enum, skema Zod, tipe
│   ├── db/        Skema Drizzle, migrasi, invariant SQL
│   ├── auth/      Hash token, kode acak, izin bawaan
│   ├── domain/    Aturan domain murni
│   ├── notifications/ Mesin notifikasi + adapter penyedia
│   └── config/    Konfigurasi TypeScript bersama
├── tools/
│   ├── legacy/    Migrasi data bot v0.4 → v2
│   └── scripts/   Pemeriksaan dokumentasi & arsitektur
├── infra/         Dockerfile & docker-compose
├── docs/          21 dokumen wajib
└── AGENTS.md      Petunjuk untuk AI agent
```

---

## Modul

| # | Modul | Ringkas |
|---|---|---|
| 1 | Identity | User, Identity, Member — dipisah tegas |
| 2 | Members | Pendaftaran, kelas, jabatan, status, arsip |
| 3 | Attendance | 5 jenis sesi, 5 status, 5 sumber, token QR |
| 4 | Permissions | Izin, permintaan izin, persetujuan |
| 5 | Meetings | Rapat, agenda, peserta, notulen berversi |
| 6 | Tasks | Tugas, **DONE ≠ VERIFIED**, verifikasi |
| 7 | Programs | Program kerja, ruang kerja, timeline, evaluasi |
| 8 | Events | Acara, panitia, peserta, absensi |
| 9 | Finance | Chart of accounts, **ledger immutable**, anggaran |
| 10 | Documents | Metadata di DB, berkas di object storage |
| 11 | Communications | Pengumuman, kampanye, pelacakan kirim |
| 12 | Notifications | In-app, push, WhatsApp, email |
| 13 | Reports | Laporan absensi, anggota, keuangan, tugas |
| 14 | Audit | Log append-only untuk setiap aksi sensitif |
| 15 | Settings | Organisasi, periode, jabatan, feature flag |
| 16 | Integrations | WhatsApp, QRIS, email, object storage |

---

## Peran & Dasbor

Tiap peran mendapat bentuk dasbor yang **berbeda**:

| Peran | Ruang Kerja | Fokus |
|---|---|---|
| Ketua | EXECUTIVE | Gambaran menyeluruh, persetujuan |
| Wakil Ketua | OPERATIONS | Apa yang belum selesai |
| Sekretaris | ADMINISTRATION | Absensi, rapat, notulen, arsip |
| Bendahara | FINANCE | Kas, anggaran, reimbursement |
| Humas | COMMUNUNICATION | Pengumuman, kampanye |
| Koordinator | DIVISION | Satu bidang/divisi |
| Anggota | PERSONAL | Absensi, tugas, pengumuman |

Sidebar Web dibangun dari **izin efektif**, bukan dari nama peran. Menu yang
tidak diizinkan tidak pernah muncul — namun backend tetap memeriksa ulang
setiap permintaan.

---

## Database

74 tabel dalam 9 kelompok. Yang paling menentukan:

**Ledger tidak dapat diubah.** `ledger_entries` ditolak UPDATE/DELETE oleh
trigger database. Saldo kas selalu dihitung dari ledger, tidak pernah disimpan
sebagai angka tunggal.

**Pemohon tidak menyetujui pengajuannya sendiri.** Dijaga trigger database.

**Absensi idempotent.** `UNIQUE (session_id, idempotency_key)`.

**Pembayaran tidak dapat di-settle dua kali.**
`UNIQUE (organization_id, referensi_provider)`.

**Periode lama tidak pernah hilang.** Pergantian kepengurusan hanya mengubah
periode lama menjadi `ARCHIVED`.

---

## Dokumentasi

Indeks lengkap: [`docs/atom-index.md`](docs/atom-index.md)

| Dokumen | Isi |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Lapisan & aliran data |
| [DATABASE](docs/DATABASE.md) | 74 tabel & index |
| [API](docs/API.md) | Seluruh endpoint |
| [AUTHORIZATION](docs/AUTHORIZATION.md) | RBAC + permission + scope |
| [ROLE_MATRIX](docs/ROLE_MATRIX.md) | Akses tiap peran |
| [FINANCE](docs/FINANCE.md) | Ledger, anggaran, approval |
| [SECURITY](docs/SECURITY.md) | Praktik keamanan |
| [MIGRATION](docs/MIGRATION.md) | Dari bot v0.4 |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Cara rilis ke server |
| [DISASTER_RECOVERY](docs/DISASTER_RECOVERY.md) | Backup & pemulihan |

---

## Migrasi dari OSDA Bot v0.4

Bot lama telah dimigrasi penuh. Datanya tetap tersedia.

```bash
node tools/legacy/scripts/dump-legacy.mjs    # 1. cadangan
node tools/legacy/scripts/migrate-to-v2.mjs  # 2. migrasi
node tools/legacy/scripts/reconcile.mjs      # 3. verifikasi
```

Hasil rekonsiliasi: 49 anggota · 10 sesi · 470 catatan absensi · 3 periode kas
· 11 pembayaran lunas · 33 entri ledger. **Selisih: 0.**

---

## Bekerja dengan AI Agent

Repositori ini siap dipakai sebagai target multi-agent.

```bash
# Tambahkan opencode di dalam repositori
opencode
```

Agen tersedia: `@ketua` (koordinator), `@plan`, `@build`, `@peneliti`
(read-only), `@kode` (implementasi), `@penguji` (verifikasi), `@dokumenter`,
`@peninjau-keamanan`.

Baca [`AGENTS.md`](AGENTS.md) dan [`opencode.json`](opencode.json) untuk aturan
lengkap. All code, comments, dan dokumentasi dalam Bahasa Indonesia.

---

## Perintah Penting

```bash
pnpm typecheck              # validasi seluruh repo (9 workspace)
pnpm test                   # 160 tes unit
pnpm build                  # build produksi (paket bersama → API → Bot)
pnpm start                  # jalankan API dari dist/
pnpm e2e                    # uji alur absensi end-to-end (API harus hidup)
pnpm akun-uji               # buat satu akun uji per peran
pnpm --filter @osda/tools e2e-izin    # uji batas izin (61 pemeriksaan)
pnpm db:migrate             # terapkan migrasi + invariant
pnpm db:seed                # isi data awal
pnpm docs:check             # 21 dokumen wajib tersedia?
pnpm check:architecture     # ada klien akses DB langsung?
pnpm legacy:reconcile       # data lama utuh?
```

## Verifikasi

| Pemeriksaan | Status |
|---|---|
| Typecheck 9 workspace | 0 galat |
| Tes unit | 196 lulus (contracts 26 · auth 23 · domain 24 · notifications 28 · db 27 · api 36 · bot 32) |
| Uji E2E absensi | 28/28 lulus |
| Uji E2E batas izin | 61/61 lulus |
| Rekonsiliasi data lama | selisih 0 |
| Dokumen wajib | 21/21 |
| Aturan arsitektur | terpenuhi |
| Build produksi | `node dist/main.js` jalan |

> **Penting:** setelah mengubah `packages/db`, jalankan
> `pnpm --filter @osda/db build`. API memakai `dist` paket itu, bukan sumber.

## Verifikasi

| Pemeriksaan | Status |
|---|---|
| Typecheck 9 workspace | 0 galat |
| Tes unit | 160 lulus (contracts 26 · auth 23 · domain 24 · notifications 28 · db 27 · bot 32) |
| Uji E2E absensi | 28/28 lulus |
| Rekonsiliasi data lama | selisih 0 |
| Dokumen wajib | 21/21 |
| Aturan arsitektur | terpenuhi |
| Build produksi | `node dist/main.js` jalan |

> **Penting:** setelah mengubah `packages/db`, jalankan
> `pnpm --filter @osda/db build`. API memakai `dist` paket itu, bukan sumber.

---

## Lisensi

MIT — Ibra Decode.
