---
name: manage-members
description: Melihat, mencari, dan menambahkan anggota organisasi, termasuk membaca daftar nama dari teks yang dikirim pengguna.
version: 1.0.0
required_tools:
  - organization_list_members
  - organization_search_members
  - organization_create_member
  - organization_update_member
  - organization_update_self
  - organization_deactivate_member
  - organization_get_roles
required_permissions:
  # `members.update` dan `members.delete` ikut, karena skill ini memuat tool yang
  # memakainya. Dulu hanya `members.read` — dan gate skill memakai `every`, jadi
  # skill ini hilang total untuk siapa pun yang tidak punya `members.create`.
  # Akibatnya "tambah anggota" dijawab "fitur belum tersedia" padahal tool-nya
  # ada di disk.
  - members.read
  - members.create
  - members.update
  - members.delete
  - roles.read
contexts: [private, group]
triggers:
  - anggota
  - daftar anggota
  - daftar
  - siapa aja
  - nama
  - kelas
  - tambah
  - tambahin
  - masukin
  - masukkan
  - edit
  - ubah
  - ganti
  - hapus
  - hapusin
  - deleter
  - keluarkan
  - pensiun
  - keluar
  - nama saya
  - panggil saya
  - kelas saya
  - keliru
  - salah
---

# Kelola Anggota

## Tujuan
Menjaga data anggota tetap akurat dan bisa dicari, tanpa membuat data fiktif.

## Alur yang benar

1. **Baca daftar dari teks.**
   Kalau pengguna mengirim daftar bernomor seperti:
   ```
   1. Ni Ketut Rianti (X MPK 1)
   2. Danya Sefti Cahyani (X AKL 3)
   ```
   Ekstrak nama dan kelas. Jangan menebak kelas kalau tidak tertulis.

2. **Deteksi duplikasi sebelum menyimpan.**
   `organization_search_members` untuk tiap nama. Kalau ada yang cocok, tanyakan
   ke pengguna: ini orang yang sama atau berbeda.

3. **Buat anggota satu per satu.**
   Panggil `organization_create_member` tiap nama. Jangan satu tool untuk seluruh
   daftar — supaya kalau ada satu yang gagal, pengguna tahu yang mana.

4. **Laporkan hasilnya jujur.**
   Katakan berapa yang tersimpan, berapa yang gagal, dan mana yang perlu
   konfirmasi.

## Batas penting

- Menambahkan anggota TIDAK otomatis menghubungkan nomor WhatsApp-nya.
  Nomor harus diverifikasi terpisah sebelum bisa di-mention.
- Kalau pengguna merasa "tidak ada daftar ini" padahal sebenarnya ada, jangan
  buru-buru buat yang baru — konfirmasi dulu.
