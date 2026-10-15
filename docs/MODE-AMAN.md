# Mode Aman (Tombol Darurat)

Status: **IMPLEMENTED** · **TESTED** (12 test integrasi)

---

## 1. Masalah yang diselesaikan

Bot ini mengirim pesan ke orang sungguhan. Kalau sampai salah — prompt kacau,
tool yang salah sasaran, loop yang tidak berhenti — satu-satunya cara
menghentikannya adalah `kill`.

Dan `kill` punya dua masalah:

1. **Mematikan proses bukan berarti memperbaiki.** Kalau penyebabnya ada di
   prompt atau konfigurasi, proses yang dinyalakan ulang akan mengulang
   kesalahan yang sama.
2. **Mematikan proses menghapus bukti.** Setelah restart, tidak ada yang bisa
   melihat apa yang sebenarnya dikirim.

Mode aman menjawab keduanya: bot berhenti bertindak, tapi pesan masuk **tetap
dicatat** — jadi operator bisa melihat apa yang terjadi tanpa menambah
masalah.

---

## 2. Apa yang berhenti, dan apa yang tidak

| Tetap jalan | Berhenti |
|---|---|
| Pencatatan pesan masuk | Panggilan ke penyedia AI |
| Resolusi identitas | Panggilan tool apa pun |
| Endpoint HTTP tetap hidup | Pengiriman pesan ke orang |
| Pencatatan audit | Pengerjaan approval yang sudah disetujui |

Jadi: **tidak ada satu pun efek samping ke dunia luar.** Persis itulah yang
dibutuhkan saat insiden.

### Kenapa tabel ini penting

Mode aman yang hanya sebagian lebih berbahaya dari tidak ada sama sekali —
orang mengira sudah aman padahal tidak. Yang paling sering terlewat adalah
**pesan yang sudah antre**: outbox sengaja memisahkan pengirim dan penerima,
jadi pesan bisa masuk antrean saat bot masih normal lalu dikirim berjam-jam
kemudian, termasuk tepat setelah operator menyalakan mode aman.

Kalau gerbang hanya dipasang di jalur pesan masuk, antrean yang sudah jadi
tetap terkirim. Itu kegagalan yang lebih buruk daripada tidak punya mode aman,
karena operator **mengira** sudah aman.

---

## 3. Tiga gerbang, tiga jalur berbeda

| Titik | Menangkap |
|---|---|
| `MessageHandler.handle()` | Pesan masuk — lapisan paling awal, sebelum AI |
| `ToolRegistry.execute()` | Semua tool dari agent runtime |
| `WhatsAppOutboxHandler` | Semua pesan keluar, termasuk yang sudah antre |
| `ToolApprovalExecutor` | Approval yang sudah disetujui sebelumnya |

Yang keempat mudah terlewat: executor memanggil `definition.execute`
**langsung**, bukan lewat `ToolRegistry.execute`. Apa pun yang dipasang di
registry **tidak** menangkapnya. Kalau mode aman hanya dipasang di registry,
persetujuan yang sudah diberikan sebelum mode aman dinyalakan akan tetap
dieksekusi — persis tindakan yang paling ingin dihentikan.

Letak gerbang di `MessageHandler` juga disengaja:

- **Setelah** penyimpanan pesan — kalau tidak, insidennya tidak punya jejak,
  dan "bot diam" jadi tidak bisa dibedakan dari "bot mati".
- **Setelah** identitas — supaya catatan auditnya punya organisasi dan pelaku.
- **Sebelum** AI — tidak ada biaya, tidak ada balasan salah ke orang.

---

## 4. Kenapa di database

Karena bot restart.

Penyimpanan di memory akan hilang tepat di saat paling dibutuhkan: setelah
insiden, ketika yang dilakukan adalah menyalakan ulang untuk melihat apakah
masalahnya sudah beres.

Tabel `SystemFlag` **sengaja tidak punya `organizationId`** — ini kendali
tingkat sistem, bukan data organisasi. Tombol darurat yang ikut terhapus
bersama organisasinya, atau terisolasi per organisasi, bukan tombol darurat.

Verifikasi: test membuat `SafeModeService` baru tanpa cache sama sekali, lalu
memastikan `aktif()` masih mengembalikan `true`.

---

## 5. Caching dan langsungnya efek

Pengecekan membaca database pada setiap pesan dan setiap tool call. Itu jalur
terpanas sistem, jadi hasilnya di-cache **2 detik**.

Yang dijaga: `set()` memperbarui cache **sebelum** menulis ke database.

Kalau urutannya dibalik, ada jendela beberapa milidetik — atau ratusan saat
database lambat — di mana setiap tool call masih melihat "normal". Jendelanya
pendek, tapi justru itu masalahnya: yang tidak terlihat tidak pernah dilaporkan.

Kalau penulisan database gagal, cache tetap berisi "aman". Itu **lebih aman**
daripada sebaliknya, jadi dibiarkan — tapi dicatat keras, karena operator akan
mengira flag-nya tersimpan padahal akan hilang saat restart.

---

## 6. Bukti, bukan klaim

Setiap kali ada yang diblokir, kejadiannya masuk `AuditLog` dengan
`reasonCode: SAFE_MODE_ON`.

Tanpa catatan, "bot diam" dan "bot mati" tidak bisa dibedakan — dan itu persis
kebingungan yang muncul saat insiden.

### Yang TIDAK masuk jejak

Isi pesan. Hanya tujuan dan panjangnya.

`AuditLog` dibaca banyak orang, dan pesan bisa berisi data pribadi anggota.
Versi pertama sempat memasukkan 60 karakter pertama pesan — dan test langsung
menangkapnya, karena komentarnya sendiri sudah berbunyi "tidak menyimpan isi
chat". Komentar yang bertentangan dengan kodenya adalah tanda yang cukup.

---

## 7. Pemakaian

### Terminal

```bash
pnpm osda safe-mode:status
pnpm osda safe-mode:on bot mengirim dokumen ke grup yang salah
pnpm osda safe-mode:off
```

Alasan setelah `safe-mode:on` dicatat di flag, jadi beberapa hari kemudian
masih ada yang tahu kenapa tombolnya ditekan.

### HTTP

```bash
curl -X POST http://127.0.0.1:8080/admin/safe-mode \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true, "reason": "grup salah"}'
```

---

## 8. Keamanan endpoint

Route `/admin/*` **dibuat hanya kalau `SYSTEM_ADMIN_TOKEN` diset**. Kalau
kosong, route-nya tidak ada sama sekali — bukan "ada tapi menolak".

Route yang "ada tapi 403" masih memberi tahu pemindai bahwa ada sesuatu yang
bisa dicoba.

Perbandingan token pakai `timingSafeEqual`, dengan panjang dibandingkan lebih
dulu karena `timingSafeEqual` menolak panjang berbeda. Panjang token bukan
rahasia; yang tidak boleh bocor adalah apakah tebakan panjangnya benar.

Kalau `SERVER_HOST` bukan loopback tapi token kosong, boot memberi peringatan.
Tidak error, karena `/health` dan webhook pembayaran tetap berguna di jaringan
dan operator mungkin memang administering lewat SSH tunnel — yang ditolak
hanya akses ke kendali tanpa token.

---

## 9. Yang belum ada

| Batas | Akibatnya |
|---|---|
| Tidak ada transisi bertahap | Bot berhenti total, tidak bisa "diam tapi tetap jawab pertanyaan sederhana" |
| Tidak ada kedaluwarsa otomatis | Mode aman yang lupa dimatikan akan mematikan bot selamanya |
| Tidak ada kendali lewat WhatsApp | Harus lewat terminal atau HTTP — sesuai keputusan arsitektur, tidak ada dashboard |
| Tidak ada batas per organisasi | Satu orang bisa mengaktifkan mode aman dan menghentikan semua organisasi |

Yang terakhir adalah **batas yang diketahui dan diterima**: mode aman adalah
kendali tingkat sistem, bukan per organisasi. Kalau dibutuhkan
per-organisasi, modelnya perlu `organizationId` — dan itu keputusan tersendiri,
bukan sekadar menambah kolom.

Yang paling berbahaya di daftar ini adalah **tidak ada kedaluwarsa** —
`ActiveTask` punya kedaluwarsa, `IdempotencyKey` punya batas umur, mode aman
tidak. Ini yang paling layak jadi PR berikutnya.