# Keamanan (Security)

Dokumen ini menjelaskan kontrol keamanan yang **benar-benar ada** di OSDA Platform:
tempatnya di kode dan bagaimana cara mengujinya. Acuan: `apps/api/src/bootstrap.ts`,
`apps/api/src/auth/*`, `apps/api/src/common/*`, dan `.env.example`.

---

## 1. Autentikasi

### Alur

```
POST /api/v1/auth/login  { email, password }
   │
   ├─ Layanan Auth memuat pengguna berdasarkan email
   ├─ argon2.verify(password, password_hash)
   ├─ gagal → INVALID_CREDENTIALS (401) + increment gagal_login_berturut
   ├─ jika gagal berturut-turut berlebih → periksa users.dikunci_sampai
   └─ berhasil:
        · buat baris sessions (refresh_token_hash, user_agent, ip, jaringan)
        · terbitkan access token (JWT HS256) + refresh token
        · perbarui users.login_terakhir_pada, reset gagal_login_berturut
```

### Token

| Token | Bentuk | Masa berlaku | Penyimpanan |
|---|---|---|---|
| Akses | JWT HS256, klaim `sub, memberId, nama, org, roles, perms, scopes, jti, sid, typ` | `JWT_ACCESS_TTL` (bawaan 15 menit) | Klien (Web: cookie httpOnly; Mobile: SecureStore) |
| Refresh | string acak opak 256 bit | `JWT_REFRESH_TTL` (bawaan 30 hari) | Hanya **hash SHA-256** di `sessions.refresh_token_hash` |

Karena refresh token hanya disimpan sebagai hash, pencabutan sesi (logout, ganti sandi)
cukup satu `UPDATE` pada `sessions.dicabut_pada` — token yang beredar langsung tidak sah.

### Rotasi token

`POST /api/v1/auth/refresh`:

1. Hash refresh token yang dikirim klien.
2. Cari baris `sessions` dengan hash itu; pastikan belum kedaluwarsa dan belum dicabut.
3. Terbitkan pasangan token **baru** dan catat `terakhir_dipakai_pada`.
4. Token lama tidak dapat dipakai lagi (sesi mengacu pada hash terbaru).

### Endpoint autentikasi

| Metode | Jalur | Catatan |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Publik, dibatasi rate limit. |
| `POST` | `/api/v1/auth/refresh` | Publik, dibatasi rate limit. |
| `POST` | `/api/v1/auth/logout` | Butuh token; `{ semuaSesi: true }` mencabut semua sesi. |
| `POST` | `/api/v1/auth/whatsapp/exchange` | Menukar kode *account linking* menjadi JWT. |

### Pencegahan tebak sandi

- `users.gagal_login_berturut` dihitung per akun.
- `users.dikunci_sampai` menahan akun untuk sementara.
- Rate limit per IP (bagian 2) membatasi percobaan di tingkat jaringan.
- Endpoint publik (`@Publik()`) **tetap** dibatasi rate limit — jangan menganggap
  `@Publik()` berarti tanpa batas.

### Otorisasi

Lihat `AUTHORIZATION.md` dan `ROLE_MATRIX.md`. Ringkasnya: izin ada di dalam token,
diperiksa `IzinGuard` di tingkat endpoint, diulang `pastikanIzin` di tingkat service, dan
dilengkapi pemeriksaan kepemilikan objek di tingkat resource.

---

## 2. Rate Limiting

Dikonfigurasi di `apps/api/src/bootstrap.ts` memakai `@fastify/rate-limit`:

```ts
await daftarPlugin(app, fastifyRateLimit, {
  max: konfigurasi.RATE_LIMIT_MAKS,
  timeWindow: konfigurasi.RATE_LIMIT_JENDELA,
});
```

Nilai berasal dari `.env.example`: `RATE_LIMIT_PER_MINUTE=120` (permintaan per menit per IP).
Melewati batas menghasilkan `RATE_LIMITED` (HTTP 429).

Bot WhatsApp memiliki batasnya sendiri di `apps/bot/src/router.ts`: 20 pesan per menit
per pengirim (`JENDELA_RATE_MS = 60_000`, `BATAS_PESAN_JENDELA = 20`).

---

## 3. CORS

```ts
app.enableCors({
  origin: [...konfigurasi.CORS_ORIGINS],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
});
```

- Daftar asal berasal dari `CORS_ORIGINS` (dipisah koma), contoh:
  `http://localhost:3000,http://localhost:8081`.
- `credentials: true` diperlukan karena Web memakai cookie berisi token.
- Jangan pernah memakai `origin: '*'` bersama `credentials: true`.

---

## 4. CSRF

Karena token dikirim melalui cookie, Web Dashboard rentan CSRF bila tidak dilindungi.
Kontrol yang ada dan yang harus dipatuhi:

| Kontrol | Status |
|---|---|
| Cookie token diberi flag `httpOnly`, `SameSite`, dan `Secure` (produksi) | Diatur saat Web dibuat (lihat `WEB.md`). |
| `x-organization-id` harus cocok dengan organisasi milik pengguna (`OrganizationGuard`) | Sudah ada. |
| Token akses berumur pendek (15 menit) membatasi jendela serangan | Sudah ada. |
| Endpoint tulis **tidak** menerima permintaan lintas-situs sederhana karena format `Authorization: Bearer` tidak otomatis dikirim browser | Berlaku bila Web memakai header, bukan cookie. |
| Validasi `Origin`/`Referer` pada permintaan tulis | Wajib ditambahkan saat Web dibuat. |

Rekomendasi: gunakan **header `Authorization`** untuk Web bila memungkinkan, atau pasang
pemeriksaan CSRF token di Route Handler bila memakai cookie.

---

## 5. Header Keamanan

`@fastify/helmet` dipasang di bootstrap:

```ts
await daftarPlugin(app, fastifyHelmet, {
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
});
```

Header yang ditambahkan helmet antara lain: `X-Content-Type-Options`,
`X-Frame-Options`, `X-DNS-Prefetch-Control`, `Strict-Transport-Security`,
`Referrer-Policy`, dan `Content-Security-Policy` (diaktifkan penuh di produksi).

Catatan: `crossOriginEmbedderPolicy` dimatikan karena Swagger UI perlu memuat aset lintas
asal. Bila Anda menonaktifkan header lain, catat alasannya di kode.

---

## 6. Hashing Sandi

- Argon2 **argon2id** dipakai untuk `users.password_hash`:

```ts
await argon2.hash('OsdaMigrasi#2026', { type: argon2.argon2id })
```

- Parameter hashing bawaan argon2 (memori & waktu) digunakan tanpa penyesuaian khusus.
- Akun yang masuk lewat *identity* (WhatsApp, Google) boleh punya `password_hash` NULL —
  kolomnya memang nullable.
- Migrasi membuat sandi sementara `OsdaMigrasi#2026` untuk setiap anggota hasil migrasi;
  komentar di skrip menyatakan administrator **WAJIB** meresetnya setelah cutover.
- Tidak ada endpoint yang mengembalikan `password_hash`; nilai ini juga tidak pernah
  masuk ke audit log.

---

## 7. Batas Masukan & Unggahan

| Kontrol | Nilai | Lokasi |
|---|---|---|
| `bodyLimit` | 2 MB | `apps/api/src/bootstrap.ts` |
| `fileSize` multipart | `UPLOAD_MAKS_BYTE` (konfigurasi) | `apps/api/src/bootstrap.ts` |
| Validasi Zod | `whitelist: true`, `forbidNonWhitelisted: true` | `ValidationPipe` |
| Nomor telepon | `^62\d{8,15}$` | `SkemaTelepon` |
| Nominal | bulat, non-negatif, maksimal 1 triliun | `SkemaNominal` |
| Tanggal | `^\d{4}-\d{2}-\d{2}$` | `SkemaTanggal` |
| Waktu | `^([01]\d|2[0-3]):[0-5]\d$` | `SkemaWaktu` |
| Nama | 2–120 karakter, huruf/spasi/titik/tanda hubung | `SkemaNama` |
| `requestId` | ≤ 64 karakter, diabaikan bila lebih | `genReqId` di bootstrap |

Karena `forbidNonWhitelisted: true`, field asing **ditolak**, bukan diabaikan diam-diam.
Ini mencegah *mass assignment* (mis. pengguna menambahkan `role: 'SUPER_ADMIN'` pada
payload profil).

---

## 8. Penyimpanan Rahasia

- `.env` **tidak boleh** dikomit (lihat instruksi di `.env.example`).
- `JWT_SECRET` dan `JWT_REFRESH_SECRET` wajib diganti di produksi
  (generasi: `openssl rand -base64 48`).
- Kredensial integrasi disimpan terenkripsi **AES-256-GCM** pada
  `integration_configs.config_terenkripsi`. Kolom ini **tidak boleh** pernah
  dikembalikan oleh API.
- Bucket object storage wajib privat (`storage_buckets.publik = false`).
- Direktori sesi WhatsApp (`WHATSAPP_SESSION_DIR`) berisi kredensial Baileys dan wajib
  dikecualikan dari repositori.

---

## 9. OWASP API Security Top 10

Rujukan: OWASP API Security Top 10 (2023). Pemetaan terhadap OSDA:

| # | Risiko | Kontrol di OSDA |
|---|---|---|
| API1 | *Broken Object Level Authorization* | Pemeriksaan tingkat resource di service: `pastikanOrganisasiAktif()`, filter `organization_id`/`division_id`/`user_id` pada setiap query. Gagal → `OBJECT_ACCESS_DENIED`. |
| API2 | *Broken Authentication* | Argon2id, kunci akun setelah gagal berulang, rotasi refresh token, sesi dapat dicabut, endpoint publik dibatasi rate limit. |
| API3 | *Broken Object Property Level Authorization* | `whitelist` + `forbidNonWhitelisted` pada semua masukan. Response dipetakan eksplisit (mis. `kePaymentIntent`, `keSesi`), bukan `select *` mentah. |
| API4 | *Unrestricted Resource Consumption* | Rate limit per IP, `bodyLimit`, batas `limit` pagination (1–100 halaman, 1–200 kursor), `query timeout` Postgres, advisory lock pada scheduler. |
| API5 | *Broken Function Level Authorization* | `@Izin()` pada setiap endpoint tulis, diulang di service dengan `pastikanIzin`. |
| API6 | *Unrestricted Access to Sensitive Business Flows* | Idempotensi wajib untuk absensi, transaksi, pembayaran; `trg_payment_settle_once`; `dedup_key` notifikasi & pengiriman WhatsApp. |
| API7 | *Server Side Request Forgery* | Tidak ada endpoint yang mengambil URL dari pengguna. Tautan dalam hanya dari `PUBLIC_WEB_URL`. |
| API8 | *Security Misconfiguration* | Helmet, CORS khusus, bucket privat, kredensial terenkripsi, `.env` tidak dikomit, health endpoint hanya melaporkan status. |
| API9 | *Improper Inventory Management* | Kontrak versi tunggal (`VERSI_KONTRAK`), endpoint lama ditandai `@Deprecated` pada Swagger ketika ada pengganti. |
| API10 | *Unsafe Consumption of APIs* | `webhook_events` memverifikasi tanda tangan (`signature_valid`), menyimpan event id, memproses sekali; `amankanHasil()` di bot membuang respons yang bentuknya tidak sesuai. |

---

## 10. Webhook

`POST /api/v1/webhooks/payment`:

- Dijalankan pada port terpisah (`WEBHOOK_PORT`, bawaan 4001) bila diinginkan.
- Setiap event dicatat ke `webhook_events` dengan `signature_valid` dan `event_id`.
- Satu event hanya diproses sekali (`uq_webhook_event` pada `provider + event_id`).
- Nominal webhook harus sama dengan nominal intent, jika tidak galat.
- Rahasia webhook diatur `PAYMENT_WEBHOOK_SECRET`.

---

## 11. Daftar Periksa Sebelum Rilis

- [ ] `JWT_SECRET` & `JWT_REFRESH_SECRET` diganti, bukan nilai contoh.
- [ ] `CORS_ORIGINS` hanya berisi domain resmi.
- [ ] `NODE_ENV=production` agar CSP helmet aktif penuh.
- [ ] `RATE_LIMIT_PER_MINUTE` disesuaikan beban.
- [ ] Akun migrasi sudah direset sandinya (lihat `MIGRATION.md`).
- [ ] `WHATSAPP_SESSION_DIR` tidak masuk repositori.
- [ ] `integration_configs.config_terenkripsi` tidak pernah tampil di respons API.
- [ ] Endpoint publik sudah diperiksa (`@Publik()` hanya untuk login/refresh/exchange/health).
- [ ] Response tidak memuat kolom sandi/token (cek DTO dan pemetaan `ke*`).

---

## Catatan untuk AI agent

1. Jangan menandai endpoint `@Publik()` demi kemudahan pengujian. Bila memang perlu,
   batasi dengan rate limit khusus dan catat alasannya.
2. Jangan mengembalikan objek database mentah. Selalu petakan ke bentuk kontrak — itu yang
   mencegah `password_hash` dan `config_terenkripsi` bocor.
3. Jangan menulis `UPDATE ledger_entries`, `DELETE audit_logs`, atau mengubah versi dokumen
   yang dikunci; ketiganya ditolak trigger database.
4. Idempotensi bukan hal opsional pada alur uang dan absensi. Bila menambah endpoint
   bernominal, wajib ada `idempotency_key` unik per organisasi.
5. Bila menambah integrasi eksternal baru, daftarkan di `integration_configs` dan simpan
   kredensial terenkripsi — jangan pernah menaruhnya di `.env` yang dikomit.
