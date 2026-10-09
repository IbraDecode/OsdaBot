# @osda/bot — OSDA Bot v2 (client WhatsApp ringan)

Bot WhatsApp untuk OSDA Platform. Dibangun dengan `@whiskeysockets/baileys`
(rc14) dan **hanya sebagai client ringan terhadap OSDA API**.

```
WhatsApp → Message Adapter → Identity Resolver → Command Router
         → OSDA API (REST) → Domain → Database → Response
```

## Aturan arsitektur (wajib dipegang)

1. **Bot tidak pernah menyentuh database.** Tidak ada driver SQL, tidak ada
   `SELECT`, tidak ada tabel `members` lokal. Semua operasi bisnis lewat
   `API_URL` (default `http://localhost:4000/api/v1`) dengan bearer token
   `API_BOT_TOKEN`.
2. **Identitas selalu diambil dari JID pengirim**, tidak pernah dari nama yang
   diketik. JID stabil = PN (`62xxx@s.whatsapp.net`); LID (`@lid`) hanya
   cadangan sementara (lihat `src/whatsapp/lidMapping.ts`).
3. **Peran & izin datang dari API** (`POST /identity/whatsapp/resolve`).
   Bot tidak menyimpan daftar admin/moderator sendiri.
4. **Normalisasi profil memakai `@osda/contracts`** (`normalisasiProfil`,
   `keTitleCase`, `labelKelas`) sehingga Web, Mobile, dan Bot menghasilkan data
   yang identik.
5. **Semua balasan berbahasa Indonesia dan berawal emoji penanda**:
   `✅` sukses · `⚠️` peringatan · `🔒` ditutup/ditolak · `📢` instruksi ·
   `📋` daftar · `📊` rekap/keuangan · `ℹ️` informasi netral.

## Menjalankan

```bash
# 1) dari akar monorepo
pnpm install

# 2) siapkan konfigurasi bot
cp apps/bot/.env.example apps/bot/.env
#    isi WHATSAPP_ENABLED, WHATSAPP_PHONE_NUMBER, API_URL, API_BOT_TOKEN

# 3) mode pengembangan (tanpa build)
pnpm --filter @osda/bot dev          # tsx watch src/main.ts
pnpm --filter @osda/bot start        # tsx src/main.ts

# 4) build + PM2 (nama proses: osda-bot-v2)
pnpm --filter @osda/bot build
pm2 start apps/bot/ecosystem.config.cjs
pm2 logs osda-bot-v2
```

`WHATSAPP_ENABLED=false` membuat bot **tetap berjalan tanpa menghubungi server
WhatsApp** — berguna untuk uji coba API dan agar kata sandi pairing tidak
terpakai di lingkungan CI/staging.

### Pairing WhatsApp

- Isi `WHATSAPP_PHONE_NUMBER` (format `62xxx`) → bot otomatis meminta kode
  pairing 8 digit dan menampilkannya di log.
- Kosongkan nomor → bot menampilkan **QR code** di terminal.
- Sesi disimpan di `WHATSAPP_SESSION_DIR` (default `./whatsapp-session`).
  Folder ini **sangat sensitif** dan sudah masuk `.gitignore`.
- Sesi ditolak server (401/logout) → bot membersihkan kredensial rusak,
  melakukan *self-heal*, lalu melakukan pairing ulang (maksimal 3 kali).

## Perintah

| Anggota (tanpa garis miring) | Keterangan |
| --- | --- |
| `DAFTAR Nama Lengkap Kelas` | daftar / ubah data diri |
| `HADIR` | catat hadir rapat |
| `IZIN <alasan>` / `SAKIT <alasan>` | tidak hadir beserta alasan |
| `STATUS` | status absensi hari ini |
| `AGENDA` | agenda rapat terdekat |
| `TUGAS` | daftar tugas yang ditugaskan ke pengirim |
| `KAS` | status kas + tunggakan pribadi |
| `PROFIL` | data diri & rekap kehadiran |
| `BANTUAN` | daftar perintah |

| Pengurus (garis miring) | Izin yang dibutuhkan |
| --- | --- |
| `/rekap` | `attendance.read` |
| `/reminder` | `attendance.read` |
| `/rapat` | `meeting.read` |
| `/tugas` | `task.read` |
| `/program` | `program.read` |
| `/kas` | `finance.read` |
| `/absenin <nama> <HADIR/IZIN/SAKIT> [alasan]` | `attendance.manage` |
| `/daftarin <nama> <kelas> [nomor]` | `member.write` |
| `/listanggota` | `member.read` |

Perintah yang tidak dikenal dijawab dengan `BANTUAN`. Pesan obrolan biasa
(kata pertama bukan kata kunci huruf besar dan tidak diawali garis miring)
dibiarkan diam agar bot tidak mengganggu grup.

## Konfigurasi (`.env`)

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `WHATSAPP_ENABLED` | ya | `true` mengaktifkan koneksi Baileys |
| `WHATSAPP_PHONE_NUMBER` | untuk pairing code | nomor bot format `62xxx` |
| `WHATSAPP_SESSION_DIR` | ya | folder kredensial Baileys |
| `API_URL` | ya | base URL OSDA API (`…/api/v1`) |
| `API_BOT_TOKEN` | ya | token bot dikirim sebagai `Bearer` |
| `LOG_LEVEL` | opsional | `debug`/`info`/`warn`/`error` |
| `API_TIMEOUT_MS`, `API_RETRY` | opsional | timeout & jumlah retry |
| `NOTIFIKASI_AKTIF`, `NOTIFIKASI_INTERVAL_MS` | opsional | polling notifikasi |
| `NOTIFIKASI_KIRIM_KE` | opsional | JID tujuan bila notifikasi tanpa penerima |

## Endpoint OSDA API yang dipakai bot

Bot sudah menyiapkan seluruh panggilan di `src/api/client.ts` (lihat konstanta
`JALUR`). Bila `apps/api` belum menyediakan salah satunya, pakai endpoint setara
yang paling dekat — **jangan pernah menggantinya dengan akses database**.

| Metode | Jalur | Dipakai untuk |
| --- | --- | --- |
| `GET` | `/health` | cek koneksi saat boot |
| `POST` | `/identity/whatsapp/resolve` | JID → member + peran + izin |
| `POST` | `/identity/whatsapp/register` | `DAFTAR` & `/daftarin` |
| `GET` | `/members`, `/members/{id}` | detail & daftar anggota |
| `GET` | `/attendance/sessions` | cari sesi absensi hari ini |
| `POST` | `/attendance/records` | `HADIR`/`IZIN`/`SAKIT` |
| `POST` | `/attendance/records/manual` | `/absenin` |
| `GET` | `/attendance/records` | riwayat catatan pribadi |
| `GET` | `/attendance/sessions/{id}/recap`, `/attendance/recap/member/{id}` | `/rekap`, `PROFIL` |
| `GET` | `/meetings`, `/tasks`, `/programs` | `AGENDA`, `TUGAS`, `/program` |
| `GET` | `/finance/cash`, `/finance/summary` | `KAS`, `/kas` |
| `GET` | `/notifications` | notifier WhatsApp |

Seluruh permintaan membawa header `Authorization: Bearer <API_BOT_TOKEN>` dan
`X-OSDA-Sumber: WHATSAPP` agar jejak audit jelas. Galat dibaca dari bentuk
`{ error: { code, message } }`; request ulang (retry) hanya untuk gangguan
sementara (jaringan, 5xx, 429).

## Struktur berkas

```
src/main.ts                    entrypoint + graceful shutdown + heartbeat
src/config.ts                  pembacaan .env & normalisasi nilai
src/router.ts                  command router (perintah anggota & pengurus)
src/api/client.ts              REST client OSDA API (satu-satunya akses data)
src/whatsapp/baileys.ts        socket, creds.update, self-heal 401, reconnect
src/whatsapp/account.ts        normalisasi JID (PN/LID) + adapter pesan masuk
src/whatsapp/lidMapping.ts     cache LID ↔ PN
src/whatsapp/mention.ts        ekstraksi mention & format nomor
src/services/identity-resolver.ts  JID → member (via API) + cache
src/services/gerbang-pengurus.ts   pengecekan izin perintah pengurus
src/services/profil.ts         parser "Nama Kelas" + jembatan ke kontrak
src/services/templates.ts      seluruh teks balasan bot
src/services/whatsapp-notifier.ts  polling notifikasi → WhatsApp
src/commands/*.ts              handler perintah
```

## Pemecahan masalah

| Gejala | Solusi |
| --- | --- |
| Log `OSDA API belum bisa dihubungi` | nyalakan `apps/api`, periksa `API_URL` |
| Balasan `BOT BELUM TERAUTENTIKASI` | perbarui `API_BOT_TOKEN` |
| Perintah pengurus dijawab `PERINTAH KHUSUS PENGURUS` | akun WhatsApp belum punya izin; atur di Web/Mobile |
| Tidak ada QR/kode pairing | periksa `WHATSAPP_ENABLED=true` dan `WHATSAPP_SESSION_DIR` |
| Koneksi terus 401 lalu pairing ulang | normal (self-heal); bila berulang, hapus folder sesi manual |
