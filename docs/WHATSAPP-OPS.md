# Operasional WhatsApp

## Dua nomor, dua peran — jangan tertukar

| Variabel | Isi | Arti |
|---|---|---|
| `WHATSAPP_LINK_PHONE` | `6285177653481` | Nomor akun **BOT** yang ditautkan ke Baileys |
| `WHATSAPP_ADMIN_PHONE` | `6285792820173` | Nomor **pemilik/admin** yang mengendalikan |

Keduanya **harus berbeda**. Validasi boot akan menolak kalau sama.

### Kenapa ini mudah tertukar

`WHATSAPP_OWNER_PHONE` (nama lama) ambigu. Tapi yang sebenarnya dikirim ke
`sock.requestPairingCode(nomor)` adalah nomor yang akan **ditautkan sebagai
bot**. Kalau diisi nomor pemilik, akun pemilik ikut ter-link sebagai bot — dan
itu tidak jelas terjadi kalau tidak ditelusuri.

Jadi penamaan sekarang:

- `LINK_PHONE` = yang ditautkan.
- `ADMIN_PHONE` = yang mengendalikan, tidak pernah dikirim ke WhatsApp.

## Format nomor

```
digits + kode negara, tanpa '+', '-', spasi, atau kurung
Indonesia: 62xxxxxxxxx
Lombok:    6281234567890
```

Validasi boot menolak kalau panjangnya di luar 8–15 digit.

### Nama browser saat pairing

```ts
browser: ['Ubuntu', 'Chrome', '22.04.4']
```

Elemen kedua **wajib** `Chrome`. Ini bukan nama tampilan — itu identifier tipe
browser yang divalidasi server. Pakai nama merek sendiri (`OSDABOT`) membuat
server menolak pairing dengan `400 bad-request`.

Nomor di log selalu disamarkan (`maskPhone`):

```
6285177653481  →  6285*******81
```

## Pairing

### Pairing code (disarankan di server)

```bash
pnpm osda:pair --code
```

Output:

```
  Nomor bot : 6285177653481
  Kode      : K98KH14T

  1. Buka WhatsApp di nomor bot
  2. Perangkat Tertaut → Tautkan Perangkat
  3. Masukkan kode: K98KH14T
```

Lalu di WhatsApp **nomor bot** (`6285177653481`), buka Perangkat Tertaut →
Tautkan Perangkat → masukkan kode.

### QR (pindai dari HP)

```bash
pnpm osda:pair
```

QR digambar di terminal. Pindai dari WhatsApp **nomor bot** → Perangkat
Tertaut → Tautkan Perangkat.

### Setelah pairing

```bash
pnpm start              # jalankan bot
pnpm osda whatsapp:status
```

## Melepas pairing

```bash
rm -rf auth_info_baileys
```

Atau lewat aplikasi: `provider.logout()` yang menghapus session di sisi
WhatsApp sekaligus folder lokal.

## Pemeriksaan cepat

```bash
pnpm osda whatsapp:status   # session, nomor bot, nomor admin
pnpm osda doctor            # diagnosis keseluruhan
```

---

# Troubleshooting

## Kode ditolak / tidak bisa ditautkan

**Baca [`WHATSAPP-PAIRING.md`](./WHATSAPP-PAIRING.md)** — ada riset lengkap
soal ini.

Ringkasnya, penyebab yang sudah ditemukan & diperbaiki:

1. `browser[1]` harus persis `Chrome` (atau Edge/Firefox/IE/Opera/Safari).
   Nama merek sendiri → `platformId 9` → server balas `400 bad-request`.
2. 515 (`restartRequired`) harus di-reconnect — itu permintaan restart dari
   server setelah pairing sukses.
3. `isNewLogin` harus ditangani — Baileys mengirimnya tanpa field `connection`.
4. `initAuthCreds()` wajib dipanggil saat belum ada session.

## `Cannot read properties of undefined (reading 'public')`

Gejalanya muncul saat handshake Noise, di `noise-handler.ts`.

**Penyebab:** `authState.creds` diisi objek kosong `{}` saat `creds.json` belum
ada. Baileys butuh `initAuthCreds()` yang menghasilkan `noiseKey`,
`signedIdentityKey`, `signedPreKey`, dan `advSecretKey`.

**Perbaikan:** `loadSession()` harus memanggil `initAuthCreds()` kalau tidak
ada creds tersimpan. Ini sudah diperbaiki di `session-store.ts`.

Kalau masih muncul, hapus session dan ulangi pairing.

## `Connection Closed` saat meminta pairing code

**Penyebab:** `requestPairingCode()` dipanggil sebelum socket siap menerima IQ.

**Perbaikan:** tunggu QR dibuat (bukti handshake selesai), lalu retry
maksimal 3 kali dengan jeda yang bertambah. Sudah diterapkan di `cli/pair.ts`.

**Catatan penting:** jangan menunggu status `connected`. Status itu **hanya**
muncul setelah pairing berhasil — jadi tidak bisa dipakai sebagai penanda
socket siap.

## QR tidak muncul

1. Cek koneksi internet.
2. Hapus session: `rm -rf auth_info_baileys`.
3. Jalankan ulang. QR expired setelah 60 detik (lama pertama) lalu 20 detik —
   pindai yang terbaru.
4. Kalau sering gagal, tunggu beberapa menit. WhatsApp membatasi percobaan
   pairing dari IP yang sama (error 405).

## Koneksi sering putus

| Gejala | Penyebab | Solusi |
|---|---|---|
| Putus lalu connect ulang | Normal | Biarkan |
| Putus terus-menerus | Sesi basi / IP berubah | `rm -rf auth_info_baileys` lalu pairing ulang |
| 401 / perlu auth ulang | Sesi dicabut dari HP | Pairing ulang |
| 440 | Session dipakai proses lain | Pastikan hanya 1 proses memakai `auth_info_baileys` |

## Bot tidak membalas di grup

Bot hanya merespons kalau:

- Disebut (`@Osda` atau teks "osda ...").
- Pesan membalas pesan bot.
- Grup sudah ditautkan ke organisasi.
- Kebijakan grup bukan `OFF`.

Cek:

```bash
pnpm osda whatsapp:status
```

Kalau grup belum ditautkan, pipeline akan melewati pesan dengan alasan
`group_not_linked`. Lihat log saat pesan masuk.

## Log tidak menampilkan apa-apa

Level `info` untuk modul Baileys sengaja dinaikkan ke `warn`. Pada level
`info`, Baileys mencetak `helloMsg` dan `node` yang berisi kunci
registrasi — itu materi kriptografis yang tidak boleh masuk log.

Kalau perlu trace sementara:

```bash
LOG_LEVEL=debug pnpm start
```

Tetap saja logger Baileys tidak akan naik ke `info`.