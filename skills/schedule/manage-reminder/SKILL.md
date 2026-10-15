---
name: manage-reminder
description: Membuat, melihat, dan membatalkan pengingat terjadwal yang dikirim lewat WhatsApp pada waktu tertentu.
version: 1.0.0
required_tools:
  - reminder_create
  - reminder_list
  - reminder_cancel
required_permissions:
  - tasks.read
contexts: [private, group]
triggers:
  - ingatkan
  - pengingat
  - reminder
  - ingatkan saya
  - besok jam
  - nanti jam
  - hari ke
  - minggu depan
  - jadwal
---

# Kelola Pengingat

## Tujuan
Menjadwalkan pengingat yang benar-benar terkirim, dan membatalkan yang tidak
lagi dibutuhkan.

## Yang wajib dilakukan sebelum membuat pengingat

**1. Tanggal harus lengkap.** Kalau pengguna bilang "besok jam 4", hitung
tanggalnya di zona waktu organisasi dan sebutkan tanggal hasil hitungan itu
kembali ke pengguna. "Besok" dipercayai begitu saja bisa meleset satu hari —
dan pengingat yang meleset sehari lebih buruk daripada tidak ada.

**2. Sebutkan apa yang harus diingatkan.** "Ingatkan rapat" belum cukup.
cukup. Tanya apa isinya kalau belum jelas.

**3. Jangan janjikan pengiriman instan.** Pengingat terjadwal dikirim saat
 waktunya tiba, bukan saat dibuat.

## Alur yang benar

### Membuat

1. Pastikan tanggal dan jam sudah lengkap. Kalau pengguna menyebut Relative
   ("besok", "3 hari lagi"), hitung ulang di zona waktu organisasi dan
   konfirmasi hasilnya.
2. `reminder_create` dengan isi pengingat yang sudah jelas.
3. Sampaikan **tanggal dan jam hasil hitungan** ke pengguna, bukan hanya
   sekarang — bukan besok pagi saat pengingatnya sudah lewat.
   sekarang — bukan besok pagi.

### Melihat

`reminder_list` untuk menunjukkan pengingat yang akan datang. Jangan
membuatkan pengingat yang sama dua kali — cek dulu kalau tidak yakin.

### Membatalkan

`reminder_cancel` dengan id dari `reminder_list`.

## Batas penting

- **Tidak ada pengingat berulang.** Satu pengingat = satu waktu. Untuk yang
  berulang, buat satu per waktu.
- **Tidak ada pengingat ke grup.** Pengingat dikirim ke chat tempat dibuat.
- **Kalau bot mati saat waktunya tiba, pengingat tetap tercatat.** Pesan yang
  sudah dikirim tidak dikirim ulang — supaya tidak terkirim dobel.
- **Tidak ada konfirmasi pengingat sampai waktu tiba.** Kalau pengguna ingin
  tahu pengingatnya sudah terkirim, itu di luar kemampuan saat ini.