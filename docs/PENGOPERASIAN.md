# Pengoperasian

## Prasyarat

- Node.js ≥ 22 (diuji di 24.21)
- pnpm 11
- PostgreSQL 14+ (Neon/Supabase/RDS)
- Redis (untuk worker — belum dipakai di milestone sekarang)

## Menjalankan

### Pengembangan

```bash
pnpm install

cp .env.example .env
# Isi .env

pnpm db:migrate          # buat & terapkan migrasi
pnpm db:seed             # data contoh (fiktif)

pnpm dev                 # mode watch
```

### Produksi

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:deploy           # migrasi (bukan migrate dev!)
pnpm start
```

### Perintah lain

```bash
pnpm typecheck           # cek tipe
pnpm test                # test otomatis
pnpm test:coverage       # dengan coverage
pnpm osda <perintah>     # CLI operasional
```

## CLI

```
pnpm osda status          # status komponen (DB, AI, session, tool, skill)
pnpm osda doctor          # diagnosis masalah konfigurasi
pnpm osda tools           # daftar tool + izin + risiko
pnpm osda skills          # daftar skill termuat
pnpm osda capabilities    # kemampuan aktif
pnpm osda whatsapp:status # status session WhatsApp
pnpm osda whatsapp:files  # isi folder session
pnpm osda:pair           # pairing WhatsApp (--code untuk pairing code)
pnpm osda org:list        # daftar organisasi
pnpm osda db:seed         # isi data contoh
pnpm osda help            # daftar perintah
```

Setiap perintah **membaca kondisi nyata** dari sistem — tidak ada yang hanya
mencetak teks statis.

## Health check

### `GET /health`

Liveness — apakah proses hidup.

```json
{ "status": "ok", "uptimeSeconds": 120 }
```

### `GET /ready`

Readiness — apakah dependency siap menerima pekerjaan.

```json
{
  "status": "ready",
  "checks": [
    { "name": "postgresql", "ok": true, "latencyMs": 1162 },
    { "name": "whatsapp", "ok": true, "detail": "connected" },
    { "name": "tools", "ok": true, "detail": "15 tool" },
    { "name": "skills", "ok": true, "detail": "3 skill" }
  ]
}
```

Returns 503 kalau ada check yang gagal.

`/health` dan `/ready` hanya mengekspos **nama komponen dan status**, bukan
kredensial atau konfigurasi.

## Pairing WhatsApp

### Pairing code (disarankan)

```bash
pnpm osda:pair --code
```

Nomor bot dibaca dari `WHATSAPP_LINK_PHONE`. Kode ditampilkan di terminal,
lalu dimasukkan dari WhatsApp **nomor bot** → Perangkat Tertaut → Tautkan
Perangkat.

### Lewat QR

```bash
pnpm osda:pair
```

QR digambar di terminal. Pindai dari HP.

### Catatan nomor

| Variabel | Arti |
|---|---|
| `WHATSAPP_LINK_PHONE` | Nomor akun **BOT** yang ditautkan |
| `WHATSAPP_ADMIN_PHONE` | Nomor **pemilik/admin**, tidak dikirim ke WhatsApp |

Keduanya wajib berbeda. Pairing code berlaku **satu perangkat** per nomor.

Rincian: [WHATSAPP-OPS.md](./WHATSAPP-OPS.md)

## Troubleshooting

### Gagal boot: "Konfigurasi lingkungan tidak valid"

Aplikasi gagal cepat dengan daftar persis apa yang salah. Perbaiki `.env`,
lalu jalankan ulang. Ini disengaja — lebih baik gagal saat boot daripada
berjalan dengan konfigurasi salah.

### Gagal boot: "Environment variable not found: DATABASE_URL"

`.env` tidak terbaca. Pastikan file ada di direktori kerja dan bernama `.env`.
Jalankan perintah dari root repository.

### WhatsApp tidak terhubung

```bash
pnpm osda whatsapp:status
pnpm osda whatsapp:files
```

| Gejala | Penyebab | Solusi |
|---|---|---|
| `credentials: belum ada` | Belum pernah pairing | Jalankan `pnpm start` lalu pairing |
| `auth_required` | Sesi kedaluwarsa / logout | Pairing ulang |
| `reconnecting` berulang | Rate limit server (405/463) | tunggu, jangan ulangi pairing |
| Socket langsung mati | Session dipakai proses lain | Pastikan hanya 1 proses memakai `auth_info_baileys` |

### WhatsApp sering putus (408)

Penyebab umum: `decryptWithSessions` memblokir event loop 10–50 detik karena
session yang sudah basi. Mitigasi:

- Jangan naikkan `keepAliveIntervalMs` ke angka ekstrem (mis. `999999`) —
  itu justru memperburuk.
- Pantau `retryCount` di log.
- Kalau sering, pertimbangkan sesi baru.

### AI provider lambat

```bash
pnpm osda doctor
```

Model reasoning butuh 20–60 detik untuk permintaan kompleks. Ini normal.
Timeout default 60 detik.

### Permission denied padahal seharusnya boleh

Periksa:

1. Aktor punya keanggotaan yang **aktif** di organisasi itu?
2. Perannya punya permission itu?
3. Aktor di ResolveSender mengembalikan `userId`?

```sql
SELECT m.id, m.fullName, m.isActive, u.id AS user_id
FROM "OrganizationMember" m
LEFT JOIN "User" u ON u.id = m."userId"
WHERE m."organizationId" = '<org-id>';
```

`user_id` NULL = identitas WhatsApp belum terhubung ke user internal, jadi
permission tidak bisa dihitung.

### Ambang nama terlalu ketat / terlalu longgar

```sql
SELECT fullName, searchName FROM "OrganizationMember"
WHERE searchName LIKE '%danya%';
```

Kalau `searchName` tidak terisi benar, normalisasi gagal. Perbaiki `searchName`:

```typescript
searchNameFor('Bapak Danya Sefti')  // → 'danya sefti'
```

## Log

Struktur terstruktur (JSON di produksi):

```json
{
  "level": "info",
  "time": "2026-10-14T17:00:00.000Z",
  "event": "tool selesai",
  "tool": "attendance.update",
  "correlationId": "…",
  "durationMs": 35
}
```

Development memakai `pino-pretty` agar mudah dibaca.

### Yang tidak pernah masuk log

- API key, token, Authorization header, cookie
- Kredensial & session WhatsApp
- Isi pesan lengkap
- Detail pembayaran individu

`ToolExecution` menyimpan **ringkasan** input/output (string dipotong 160
karakter), bukan input mentah.

### Correlation ID

Satu pesan pengguna yang memicu beberapa tool call punya satu
`correlationId`. Semua log di alur itu bisa dicari dengan ID tersebut.

## Graceful shutdown

SIGINT / SIGTERM akan:

1. Hentikan server HTTP
2. Tutup koneksi WhatsApp
3. Tutup koneksi database

Batas waktu 20 detik sebelum proses dipaksa mati.

## Deployment

### Docker ( forthcoming)

Belum ada `Dockerfile`. Untuk sekarang:

```bash
pnpm build && pnpm start
```

Dianjurkan dijalankan di systemd atau supervisor agar otomatis restart.

### Termux

Bisa dipakai untuk pengembangan dan pengujian lokal. **Tidak cocok untuk
produksi** — Android bisa menghentikan proses latar belakang karena pengaturan
daya atau kondisi sistem, dan OSDABOT butuh WhatsApp Gateway yang hidup terus
menang.

## Backup

Yang perlu di-backup:

| Data | Cara |
|---|---|
| PostgreSQL | `pg_dump` berkala |
| Session WhatsApp | **Sensitif** — lindungi, jangan backup publik |
| Skill | Git |
| Konfigurasi | Rahasia — backup terenkripsi |

Belum ada sistem backup otomatis. Untuk produksi, ini **wajib** ditambahkan
sebelum dipakai dengan data nyata.

## Batasan operasional saat ini

| Batasan | Dampak |
|---|---|
| Belum ada Docker | Deployment manual |
| Belum ada backup otomatis | Risiko kehilangan data |
| Belum ada monitoring/alerting | Masalah baru diketahui saat cek log |
| Redis belum dipakai | Tidak ada job terjadwal |
| Session WhatsApp hanya lokal | Tidak bisa di-scale horizontal |

Semuanya tercatat di [STATUS-IMPLEMENTASI.md](./STATUS-IMPLEMENTASI.md).