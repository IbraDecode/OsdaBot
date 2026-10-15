---
name: manage-members
description: Melihat, mencari, dan menambahkan anggota organisasi, termasuk membaca daftar nama dari teks yang dikirim pengguna.
version: 1.0.0
required_tools:
  - organization_list_members
  - organization_search_members
  - organization_create_member
  - organization_get_roles
required_permissions:
  - members.read
contexts: [private, group]
triggers:
  - anggota
  - daftar anggota
  - siapa aja
  - nama
  - kelas
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
   `organization.search_members` untuk tiap nama. Kalau ada yang cocok, tanyakan
   ke pengguna: ini orang yang sama atau berbeda.

3. **Buat anggota satu per satu.**
   Panggil `organization.create_member` tiap nama. Jangan satu tool untuk seluruh
   daftar — supaya kalau ada satu yang gagal, pengguna tahu yang mana.

4. **Laporkan hasilnya jujur.**
   Katakan berapa yang tersimpan, berapa yang gagal, dan mana yang perlu
   konfirmasi.

## Batas penting

- Menambahkan anggota TIDAK otomatis menghubungkan nomor WhatsApp-nya.
  Nomor harus diverifikasi terpisah sebelum bisa di-mention.
- Kalau pengguna merasa "tidak ada daftar ini" padahal sebenarnya ada, jangan
  buru-buru buat yang baru — konfirmasi dulu.
