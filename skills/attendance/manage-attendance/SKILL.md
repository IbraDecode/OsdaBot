---
name: manage-attendance
description: Mengelola daftar hadir organisasi secara percakapan — membuat daftar, menambah anggota, mengubah status dan alasan, serta menampilkan daftar dengan format yang dipertahankan.
version: 1.0.0
required_tools:
  - attendance_list_events
  - attendance_get
  - attendance_create
  - attendance_add_member
  - attendance_update
  - attendance_get_unconfirmed
required_permissions:
  - attendance.read
  - attendance.update
contexts: [private, group]
triggers:
  - daftar hadir
  - absen
  - kehadiran
  - izin
  - konfirmasi
  - hadir
---

# Kelola Kehadiran

## Tujuan
Membantu pengelola dan anggota mengelola daftar hadir lewat bahasa sehari-hari, tanpa
menyuruh mereka menghafal perintah atau ID.

## Alur yang benar

1. **Pastikan daftar yang dimaksud.**
   Kalau pengguna tidak menyebut daftar secara eksplisit, pakai daftar terakhir yang
   aktif di percakapan itu. Kalau belum pernah ada daftar di percakapan ini, cek
   `attendance.list_events` untuk melihat yang terbaru.

2. **Jangan pernah mengarang anggota.**
   Setiap kali pengguna menyebut nama orang, WAJIB jalankan
   `organization.search_members` lebih dulu.

3. **Kalau nama ambigu — berhenti dan tanya.**
   Dua anggota bernama "Ibra" itu dua orang berbeda. Jangan pilih yang paling mirip.
   Tampilkan kandidatnya beserta kelas, lalu tunggu jawaban pengguna.

4. **Ubah hanya field yang diminta.**
   - "ubah status jadi izin" → ubah `status` saja.
   - "ganti alasannya meeting" → ubah `reason` saja.
   - "yang lain tetap" → jangan sentuh kolom lain.

5. **Tampilkan ulang daftar setelah perubahan.**
   Pakai hasil `rendered` dari tool. Renderer memakai cetakan format yang tersimpan,
   jadi format WhatsApp pengguna tetap terjaga.

## Aturan format

- Kalau pengguna pernah memberikan daftar dalam format tertentu, pertahankan.
- Jangan mengganti penomoran, gaya heading, atau urutan seksi.
- Pemisahan status mengikuti cetakan yang disimpan; biasanya ada seksi `*IZIN*`,
  `*SAKIT*`, `*ALPA*`, dan `*BELUM KONFIRMASI*`.

## Yang tidak boleh dilakukan

- Menambah entri ganda untuk anggota yang sama — `attendance.add_member` sudah
  idempoten, tapi tetap periksa hasilnya.
- Mengubah anggota lain saat hanya satu yang disebut.
- Menghakimi alasan izin. Catat apa adanya.
- Menganggap "belum membalas chat" sama dengan "belum konfirmasi".
