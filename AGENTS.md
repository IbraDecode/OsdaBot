# AGENTS.md — OSDA Platform (Petunjuk untuk AI Agent)

Berkas ini memberitahu AI agent apa yang harus diketahui agar bisa bekerja dengan
aman dan konsisten di repositori ini. **Baca sebelum mengubah apa pun.**

---

## 1. Apa itu OSDA Platform

**OSDA Platform** adalah sistem operasi organisasi untuk OSIS: satu backend,
satu database, empat client (Web Dashboard, Mobile, WhatsApp Bot, dan API
untuk integrasi).

Prinsip yang tidak boleh dilanggar:

> **Database adalah satu-satunya sumber kebenaran. Client bukan sumber
> kebenaran. WhatsApp bukan database.**

---

## 2. Perintah Penting

```bash
# Instalasi
pnpm install

#/typecheck seluruh repo (WAJIB dijalankan sebelum selesai)
pnpm typecheck

# Uji coba semua aplikasi sekaligus
pnpm dev

# Database
pnpm db:migrate                 # terapkan migrasi + trigger invariant
pnpm db:seed                    # isi permission, peran, organisasi, admin
pnpm db:studio                  # jelajahi database

# Migrasi dari bot lama
node tools/legacy/scripts/dump-legacy.mjs    # cadangan
node tools/legacy/scripts/migrate-to-v2.mjs  # migrasi
node tools/legacy/scripts/reconcile.mjs      # verifikasi (harus 0 selisih)

# Pemeriksaan aturan
pnpm docs:check                # 21 dokumen wajib tersedia
pnpm check:architecture         # tidak ada klien akses DB langsung
```

> **Hindari `pnpm build`.** Repository ini punya banyak workspace dan build
> penuh bisa memakan lebih dari 10 menit. Gunakan `pnpm typecheck` untuk
> memvalidasi perubahan.

---

## 3. Peta Repo

```
apps/
├── api/          NestJS + Fastify. Semua modul Fitur.
├── web/          Next.js App Router. Dasbor_switchboard.
├── bot/          Baileys WhatsApp — client ringan, tanpa akses DB.
└── mobile/       Expo (standalone, tidak ikut workspace instalasi)

packages/
├── contracts/    Kontrak tunggal: permission, enum, skema Zod, tipe DTO.
├── db/           Skema Drizzle + migrasi + invariant SQL.
├── auth/         Utilitas autentikasi (hash token, kode, izin bawaan).
├── domain/       Aturan domain murni (alur status, perhitungan).
├── notifications/ Mesin notifikasi + adapter penyedia.
└── config/       Konfigurasi TypeScript bersama.

tools/
├── legacy/       Perkakas migrasi data bot v0.4.
└── scripts/      Pemeriksaan dokumentasi & aturan arsitektur.

docs/             21 dokumen wajib (semua Bahasa Indonesia).
infra/            Berkas deployment & docker-compose.
```

---

## 4. Alur Data (WAJIB dipatuhi)

```
Client (Web / Mobile / Bot)
  → REST API /api/v1/*
  → Autentikasi (JWT)
  → Otorisasi (permission + scope)
  → Application Service
  → Domain
  → Repository
  → PostgreSQL
```

**DILARANG:**

```
Web    → database
Mobile → database
Bot    → database
```

Pemeriksaan ini otomatis: `pnpm check:architecture` akan gagal bila ada klien
yang mengimpor `@osda/db`, `drizzle-orm`, `postgres`, `pg`, atau `DATABASE_URL`.

---

## 5. Aturan Otorisasi

Otorisasi punya **tiga tingkat** dan semuanya dijalankan di backend:

1. **Endpoint** — `IzinGuard` memeriksa metadata `@Izin('modul.aksi')`.
2. **Layanan** — `pastikanIzin(pengguna, [...])` sebelum tindakan sensitif.
3. **Objek** — cek kepemilikan di dalam `service`, bukan hanya di filter URL.

Cakupan (scope): `OWN`, `DIVISION`, `ORGANIZATION`, `FINANCE`, `SYSTEM`.

Peran **bukan** satu-satunya authorization. Peran hanya paket izin. Sumber
kebenaran akhir ada di tabel `member_roles` → `roles` → `role_permissions`.

---

## 6. Aturan Domain yang Sering Terlanggar

| Aturan | Cara menegakkan |
|---|---|
| **DONE ≠ VERIFIED** | `Tugas.verifikasi` terpisah; izin `task.verify` |
| Program tidak bisa mundur bebas | `bolehTransisiProgram()` dari kontrak |
| Notulen APPROVED immutable | Versi baru + trigger `document_versions` |
| Ledger immutable | Trigger `trg_ledger_immutable` |
| Pemohon ≠ pemberi persetujuan | Trigger `trg_no_self_approval_*` |
| IZIN/SAKIT wajib alasan | Check constraint + service |
| Absensi idempotent | `UNIQUE (session_id, idempotency_key)` |
| Pembayaran tidak dobel | `UNIQUE (organization_id, referensi_provider)` |
| Member tidak dihapus | Soft delete (`diarsipkan_pada`) |
| Periode lama tidak hilang | Periode lama jadi `ARCHIVED` |

---

## 7. Kontrak Bersama

**Jangan pernah membuat tipe atau enum sendiri di client.** Semua berasal dari
`@osda/contracts`:

```ts
import {
  PERMISSION,            // daftar izin
  MATRICS_PERAN,         // paket izin bawaan per peran
  STATUS_HADIR,          // enum status
  TRANSISI_PROGRAM,      // transisi status yang sah
  bolehTransisiTugas,    // helper validasi
  SkemaMasuk,            // skema Zod
  type FilterAnggota,    // tipe hasil inferensi Zod
} from '@osda/contracts';
```

Bila butuh nilai baru, tambahkan di kontrak **lebih dahulu**, baru pakai di
API, baru pakai di client. Jangan sebaliknya.

---

## 8. Bahasa & Gaya

- **Semua** komentar, nama variabel, nama fungsi, pesan galat, label UI, dan
  teks dokumentasi memakai **Bahasa Indonesia**.
- Istilah teknis (`endpoint`, `commit`, `token`, `middleware`) boleh.
- TypeScript strict. Hindari `any`; pakai tipe dari kontrak.
- Jangan menambah dependensi tanpa alasan kuat yang tertulis di AGENTS.md.
- Kesalahan selalu berbentuk:
  ```json
  { "error": { "code": "...", "message": "...", "requestId": "..." } }
  ```

---

## 9. Aturan Database

- Skema didefinisikan di `packages/db/src/schema/*.ts` (Drizzle).
- Setelah mengubah skema:
  ```bash
  pnpm --filter @osda/db generate   # membuat berkas migrasi
  pnpm db:migrate                   # terapkan
  ```
- **Jangan pernah** memakai `db:push` di staging/production.
- Invariant berada di `packages/db/src/sql/invariants.ts` — letakkan aturan
  yang tidak boleh dilanggar di sana, bukan di kode aplikasi saja.
- Nominal uang adalah bilangan bulat rupiah penuh (`bigint` mode `number`).

---

## 10. Kesalahan yang Pernah Terjadi (Hindari)

1. **Menulis `request.user` vs `request.pengguna`.** Passport menaruh hasil
   validasi JWT di `request.user`. Selalu pakai helper
   `ambilPengguna(permintaan)` dari `common/utilitas/pengguna-permintaan.ts`.
   Salah baca di sini menyebabkan 401 palsu.
2. **`import type` untuk kelas yang di-inject Nest.** Harus `import` biasa,
  dan tambahkan `@Inject(Kelas)` pada parameter constructor.
3. **Identifier dengan tanda hubung** (`rata-rataHadir`) — TypeScript
   mengeparsanya sebagai pengurangan. Gunakan `rataRataHadir`.
4. **Menyimpan saldo kas sebagai angka tunggal.** Saldo selalu dihitung dari
   `ledger_entries`.
5. **Menghapus anggota secara keras.** Gunakan arsip agar histori utuh.

---

## 11. Alur Kerja yang Disarankan untuk AI Agent

1. Baca dokumen terkait di `docs/` (setiap modul punya sendiri).
2. Periksa `pnpm typecheck` — harus hijau SEBELUM mengubah apa pun.
3. Kerjakan perubahan SATU modul.
4. Jalankan `pnpm typecheck` lagi.
5. Jalankan `pnpm check:architecture` bila menyentuh akses data.
6. Perbarui dokumen modul bila perilaku berubah.
7. **Jangan commit kecuali diminta.**

---

## 12. Gemini/Claude Collaboration

Bila menggunakan beberapa agent sekaligus:

- **Satu agent = satu modul.** Jangan dua agent menulis modul yang sama.
- **Tugas read-only** (riset, review dokumentasi) boleh paralel.
- Setelah agent selesai, selalu jalankan `pnpm typecheck` sebagai verifikasi
  tunggal — jangan percaya laporan agent.
- Sebelum konfirmasi: bacalah `git status` dan `git diff` sebelum commit.

---

## Catatan Tambahan

- `apps/mobile` tidak ikut workspace instalasi (butuh toolchain native).
  Jalankan sendiri dari foldernya.
- `docs/atom-index.md` adalah indeks seluruh dokumen.
- Git repository: `https://github.com/IbraDecode/OsdaBot.git`
