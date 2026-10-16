---
name: collect-payment
description: Membuat QRIS pembayaran QRIS/GoPay lewat BaturPay untuk sebuah tagihan, lalu mengecek status pembayarannya.
version: 1.0.0
required_tools:
  - payment_create_charge
  - payment_check_status
  - payment_list
  - payment_send_qris
required_permissions:
  - finance.read
contexts: [private, group]
triggers:
  - bayar
  - qr
  - qris
  - scan
  - gopay
  - link pembayaran
  - tagih
  - kirim qr
  - kirim gambar
  - qris-nya
  - gambarnya
  - cara bayar
  - sudah masuk belum
  - cek pembayaran
---

# Tampung Pembayaran (BaturPay)

## Tujuan
Meminta pembayaran lewat QRIS, dan memberitahu statusnya **jujur**.

## Aturan yang paling penting di skill ini

**1. Pembayaran dianggap lunas HANYA dari penyedia — tidak pernah dari chat.**

Kalau pengguna bilang "sudah aku bayar":
- Kalau dia memang baru saja membayar (statusnya masih `PENDING`) →
  **`payment_check_status`**, lalu jawab apa yang hasilnya.
- Kalau statusnya `SETTLED` → memang sudah masuk.
- Kalau statusnya masih `PENDING` → jawab **"belum ada pembayaran dari kamu
  yang tercatat"**, bukan "sudah bayar". Kemungkinan besar yang dimaksud
  transaksi lain dengan nominal sama.

**Jangan pernah menyatakan "sudah lunas" hanya karena pengguna bilang begitu.**

**2. `capture` BUKAN berarti uang masuk.** Status itu berarti "berhasil tapi belum
final". Katakan "sudah dibayar tapi belum dikonfirmasi-final", bukan "sudah
masuk".

**3. Buat QRIS butuh persetujuan.** Sistem akan meminta persetujuan sebelum
membuat. Jangan mengirim tanpa itu.

## Alur yang benar

### Mengirim permintaan pembayaran

1. `finance_list_invoices` untuk menemukan tagihan yang dimaksud.
2. Kalau nominal yang diminta **melebihi sisa tagihan** — tanyakan dulu.
   Jangan buat apa adanya.
3. `payment_create_charge` dengan `invoiceId`. Sistem meminta persetujuan.
4. Setelah disetujui, kirim **`qrisUrl`-nya** ke anggota dengan kalimat jelas
  (screen-friendly):
   > Ini QRIS untuk iuran X. Scan pakai GoPay/QRIS, Rp 25.000.

5. **Jangan** menyatakan "sudah bayar". Yang benar: "sudah diminta, tinggal dibayar."

### Mengirim gambar QRIS

**Pakai `payment_send_qris` setiap kali pengguna meminta gambarnya.**

`payment_check_status` mengembalikan `qrisUrl` sebagai teks — itu sudah cukup
untuk pengguna yang mau menyalin tautan. Tapi kalau permintaannya "kasih
gambarnya", "tampilkan QR-nya", atau "gimana cara bayarnya", itu permintaan
**gambar**, dan jawabannya `payment_send_qris` — bukan mengulangi tautannya
sebagai teks.

Dua hal yang sering terlewat di sini:

1. **Jangan buat transaksi baru** kalau `payment_send_qris` bilang transaksinya
   tidak ditemukan. Tanyakan dulu. Membuat order kedua untuk tagihan yang sama
   menghasilkan dua permintaan transfer — dan pengguna tidak tahu mana yang benar.
2. **Mengirim gambar tidak mengubah status apa pun.** Status hanya berubah lewat
   webhook penyedia. Jangan bilang "sudah dikirim, tinggal scan".

### Memeriksa status

`payment_check_status` dengan `orderId`. Gunakan field `interpretation` yang
dikembalikan — itu kalimat yang sudah aman untuk disampaikan.

Field `qrisUrl` juga dikembalikan di sini, jadi "mana linknya" tidak perlu
membuat charge baru.

### Daftar pembayaran

`payment_list` untuk "siapa yang belum bayar" atau "transaksi yang mana".

## Kalau BaturPay belum dikonfigurasi

Tool akan bilang "pembayaran otomatis belum dikonfigurasi". Jawab begitu apa
adanya dan tawarkan mencatat manual lewat `finance_record_payment`.

Jangan menjanjikan QRIS kalau ternyata tidak bisa dibuat.

## Batas penting

- **Tidak ada pembatalan/refund dari sini.** Kalau perlu, lewat dashboard
  BaturPay.
- **QRIS berlaku terbatas** (default 60 menit, maks 1440). Setelah kedaluwarsa,
  perlu QRIS baru.
- **Kuota 500 transaksi/bulan** di mode `own`. Setelah habis, `QUOTA_EXCEEDED`.
- **Tidak ada penalti otomatis** untuk yang telat bayar.
- **Satu order_id = satu charge.** Kalau charge gagal, jangan buat order_id
  lain dengan sengaja — itu menghasilkan transaksi ganda.
- **`payment_send_qris` hanya ke percakapan asal.** Tidak bisa mengirim ke nomor
  lain. Kalau memang harus, lewat `whatsapp_send_message` yang butuh persetujuan.