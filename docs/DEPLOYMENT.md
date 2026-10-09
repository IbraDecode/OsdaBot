# DEPLOYMENT — OSDA Platform

Dokumen ini menjelaskan cara menjalankan OSDA Platform di lingkungan
development, staging, dan production.

> **Prinsip utama:** database adalah satu-satunya sumber kebenaran. Deployment
> tidak boleh memindahkan state ke client mana pun.

---

## 1. Komponen yang Dideploy

| Komponen | Peran | Wajib? |
|---|---|---|
| `apps/api` | Backend REST + scheduler | Ya |
| `apps/web` | Dasbor untuk pengurus | Ya |
| `apps/bot` | Worker WhatsApp | Opsional |
| `apps/mobile` | Aplikasi Expo (dibangun terpisah) | Opsional |
| PostgreSQL | Sumber kebenaran | Ya |
| Redis | Antrean (opsional — ada fallback in-process) | Tidak |
| Object storage | Dokumen & lampiran | Ya (untuk dokumen) |

Yang WAJIB jalan bersama: API dan PostgreSQL. Bot boleh mati tanpa
menghentikan sistem — ini persis prinsip "core tetap berjalan walaupun satu
integration gagal" (spesifikasi §93.30).

---

## 2. Lingkungan

Tiga lingkungan terpisah. **Jangan pernah memakai database production untuk
development.**

| Lingkungan | URL API | Database | Peran |
|---|---|---|---|
| Development | `http://localhost:4000` | PGlite atau Neon dev | Pengembangan |
| Staging | `https://api.staging.osda.example` | Neon branch staging | Uji sebelum production |
| Production | `https://api.osda.example` | Neon production | Operasional |

Variabel environment yang wajib ada di setiap lingkungan:

```
NODE_ENV=production
DATABASE_URL=postgresql://...        # WAJIB
JWT_SECRET=...                       # WAJIB, ≥32 karakter, unik per lingkungan
JWT_REFRESH_SECRET=...               # WAJIB, harus BERBEDA dari JWT_SECRET
CORS_ORIGINS=https://osda.example
REDIS_URL=                           # kosongkan bila tidak memakai antrean
STORAGE_BUCKET=osda-documents
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
```

> ⚠️ **Jangan pernah** memakai `JWT_SECRET` yang sama di staging dan
> production. Token dari satu lingkungan akan valid di lingkungan lain.

---

## 3. Persiapan Database

```bash
# 1. Terapkan seluruh migrasi skema + trigger invariant
pnpm db:migrate

# 2. Isi permission, peran, organisasi, jabatan, chart of accounts, admin
pnpm db:seed
```

`db:migrate` memasang trigger yang menegakkan invariant:

- `ledger_entries` immutable (menolak UPDATE dan DELETE)
- versi dokumen yang sudah disetujui terkunci
- pemohon ≠ pemberi persetujuan (keuangan)
- alasan wajib untuk status IZIN / SAKIT
- `audit_logs` append-only
- hanya satu periode aktif per organisasi
- pembayaran tidak dapat di-settle dua kali

Setelah migrasi, **verifikasi jumlah tabel**:

```bash
psql "$DATABASE_URL" -c "select count(*) from information_schema.tables where table_schema='public'"
# HarAPAN: 74
```

---

## 4. Menjalankan API

### 4.1 Build & jalankan

```bash
pnpm install --frozen-lockfile
pnpm --filter @osda/api build
node apps/api/dist/main.js
```

Untuk pengembangan:

```bash
pnpm --filter @osda/api dev     # mode watch
```

### 4.2 pm2

Berkas contoh: `apps/api/ecosystem.config.cjs`.

```bash
pm2 start apps/api/ecosystem.config.cjs
pm2 save
pm2 startup        # agar hidup lagi setelah server reboot
```

### 4.3 Cek kesehatan

```bash
curl http://localhost:4000/health/live    # proses hidup
curl http://localhost:4000/health/ready   # database siap
```

`/health/live` tidak pernah menyentuh database, sehingga tetap menjawab meski
database mati. `/health/ready` mengecek database dan integrasi wajib.

Load balancer / reverse proxy harus mengarahkan health check ke `/health/live`.

---

## 5. Menjalankan Web

```bash
pnpm --filter @osda/web build
pnpm --filter @osda/web start
```

Variabel yang dibutuhkan saat build (Next.js membacanya saat build):

```
NEXT_PUBLIC_API_URL=https://api.osda.example
```

> `NEXT_PUBLIC_*` ikut terkirim ke browser. **Jangan pernah** menaruh
> kredensial di variabel bereprefiks tersebut.

---

## 6. Menjalankan Bot WhatsApp

```bash
pnpm --filter @osda/bot build
pm2 start apps/bot/ecosystem.config.cjs
```

Bot membutuhkan:

```
WHATSAPP_ENABLED=true
WHATSAPP_PHONE_NUMBER=628xxxxxxxxxx
WHATSAPP_SESSION_DIR=/var/lib/osda/whatsapp-session
API_URL=http://localhost:4000
```

Direktori `WHATSAPP_SESSION_DIR` berisi kredensial bot. **Perlakukan sebagai
rahasia**: batasi izin (`chmod 700`), jangan pernah masuk git, jangan pernah
di-backup ke lokasi publik.

Satu kali pairing dilakukan lewat QR code atau kode numerik. Setelah itu,
simpan kredensial; bot tidak perlu disg everytime.

---

## 7. Migrasi dari Bot v0.4

Rangkaian perintah lengkap ada di `docs/MIGRATION.md`. Ringkasnya:

```bash
# 1. Dump cadangan (WAJIB sebelum mengubah apa pun)
node tools/legacy/scripts/dump-legacy.mjs

# 2. Jalankan migrasi ke skema v2
node tools/legacy/scripts/migrate-to-v2.mjs

# 3. Rekonsiliasi — hasil harus 0 selisih
node tools/legacy/scripts/reconcile.mjs
```

---

## 8. Migrasi Skema Saat Production

Urutan yang aman:

1. Cadangkan database (`pg_dump` — lihat `docs/DISASTER_RECOVERY.md`).
2. Terapkan migrasi (`pnpm db:migrate`).
3. Jalankan smoke test endpoint utama.
4. Bila gagal: kembalikan dari cadangan.

Migrasi OSDA sengaja ditulis **tidak destruktif** — kolom baru nullable, tabel
baru terpisah, tidak ada DROP COLUMN pada fase ini. Bila migrasi gagal di
tengah jalan, transaksi membatalkan dirinya sendiri.

---

## 9. Scheduler

Tidak memakai Redis. Scheduler memakai `setInterval` yang dilindungi
**advisory lock PostgreSQL**:

```sql
SELECT pg_try_advisory_lock(<kunci>)
```

Hanya satu instance yang menjalankan tugas berkala, sehingga aman dijalankan
di beberapa instance sekaligus. Bila nanti butuh skala lebih besar, ganti
dengan BullMQ tanpa mengubah kode layanan — yang berubah hanya lapisan
antrean.

---

## 10. Pemantauan

Endpoint yang wajib dipantau:

| Metrik | Endpoint |
|---|---|
| Latensi API | timing tiap request (log JSON) |
| Laju galat | `/health/ready` |
| Keberhasilan absensi | laporan absensi harian |
| Keberhasilan notifikasi | tabel `notification_deliveries` |
| Koneksi WhatsApp | `GET /api/v1/integrations` |
| Webhook pembayaran | tabel `webhook_events` |
| Kesehatan database | `/health/ready` + `pg_stat_activity` |

Setiap respons galat menyertakan `requestId`. Field yang sama masuk ke
`audit_logs` dan log aplikasi, sehingga satu insiden bisa ditelusuri dari
akhir ke awal.

---

## 11. Cadangan

| Objek | Frekuensi | Retensi |
|---|---|---|
| Database (pg_dump) | Harian | 30 hari |
| Metadata dokumen | Harian | 30 hari |
| Konfigurasi (tanpa secret) | Setiap rilis | Permanen |
| Kredensial bot | **Jangan** di-backup ke lokasi publik | — |

> Secret tidak pernah ikut dalam arsip cadangan. Cadangan berisi data dan
> metadata konfigurasi saja. Pemulihan penuh dijelaskan di
> `docs/DISASTER_RECOVERY.md`.

---

## 12. Daftar Periksa Rilis

Sebelum rilis ke production:

- [ ] Semua secret berganti dari nilai bawaan
- [ ] `JWT_SECRET` dan `JWT_REFRESH_SECRET` berbeda satu sama lain
- [ ] `NODE_ENV=production`
- [ ] `pnpm db:migrate` berjalan sukses
- [ ] `/health/ready` mengembalikan `"siap"`
- [ ] Login Web berhasil
- [ ] Absensi tercatat dari Web **dan** WhatsApp, lalu muncul sama di keduanya
- [ ] `/api/v1/audit/logs` mencatat aksi sensitif
- [ ] Object storage **tidak** bisa diakses publik
- [ ] Cadangan harian berjalan
- [ ] Uji restore dilakukan minimal sebulan sekali
- [ ] `pnpm check:architecture` lulus

---

## Catatan untuk AI agent

1. **Jangan pernah** menambahkan akses database langsung di `apps/web`,
   `apps/mobile`, atau `apps/bot`. Klien hanya boleh memanggil REST API.
2. **Jangan pernah** menaruh secret di kode, termasuk di berkas konfigurasi
   yang di-commit. Pakai environment variable atau secret manager.
3. **Jangan pernah** menjalankan `db:reset` di production. CLI tersebut sudah
   menolak bila `NODE_ENV=production`.
4. Saat menambah kolom baru, buat nullable terlebih dahulu, isi nilai,
   baru pasang `NOT NULL`. Migration yang merusak data tidak diterima.
5. Bila menambah integrasi eksternal, buat adapter di `@osda/notifications`
   dan pastikan kegagalan integrasi itu **tidak** menggagalkan permintaan
   utama.
6. Setelah mengubah skema di `packages/db/src/schema`, jalankan
   `pnpm --filter @osda/db generate` lalu `pnpm db:migrate`. Jangan pernah
   memakai `db:push` di staging atau production.
