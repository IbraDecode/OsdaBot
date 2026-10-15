---
name: create-document
description: Membuat dokumen resmi dalam PDF seperti surat izin, surat tugas, sertifikat peserta, daftar hadir, dan rekap absensi.
version: 1.0.0
required_tools:
  - document_create
  - document_list
  - document_send
  - document_templates
required_permissions:
  - documents.read
contexts: [private, group]
triggers:
  - surat
  - surat izin
  - surat tugas
  - sertifikat
  - dokumen
  - pdf
  - daftar hadir
  - rekap
  - absensi
  - izin
  - tugas
  - sertifikat peserta
---

# Buat Dokumen

## Tujuan
Membuat dokumen resmi yang benar-benar bisa dipakai — bukan sekadar teks yang
ditulis di chat.

## Aturan yang tidak bisa dilanggar

**1. Jangan menulis surat sebagai teks chat.** Kalau pengguna minta surat izin,
itu dokumen PDF yang bisa dicetak dan ditandatangani. Menulis surat di chat
menghasilkan dokumen yang tidak bisa dipakai sebagai dokumen.

**2. Surat izin tanpa alasan tidak boleh dibuat.** Tanya dulu alasannya ke pengguna.
Surat tanpa alasan bukan keputusan — hanya formalitas.

**3. Isi daftar diambil dari database, bukan dari teks.** Untuk daftar hadir dan
rekap, WAJIB pakai `attendanceEventId` dari `attendance_get`. Kalau kamu menulis
nama sendiri ke PDF, dokumennya berisi kehadiran orang yang tidak pernah
dikonfirmasi siapa pun.

**4. Nama yang ambigu jangan ditebak.** Kalau dua anggota namanya sama,
tanyakan ke pengguna. Surat resmi atas nama orang yang salah tidak bisa ditarik
kembali.

## Alur yang benar

### Surat izin / surat tugas / sertifikat

1. Kalau pengguna menyebut nama orang, `organization_search_members` dulu.
2. Pastikan **alasan** ada untuk surat izin dan surat tugas.
3. `document_create` dengan `template`, `memberName`, `reason`, dan
   `eventTitle` bila disebut.
4. Sebutkan **nomor dokumen** yang dikembalikan ke pengguna. Nomor itu resmi.

### Daftar hadir / rekap absensi

1. `attendance_list_events` atau `attendance_get` untuk menemukan daftarnya.
2. Ambil `attendanceEventId` dari hasilnya.
3. `document_create` dengan `template` dan `attendanceEventId` itu.
4. Kalau pengguna juga mau dikirim, isi `sendTo`.

## Kalau ada yang tidak bisa dibuat

Jangan mengarang. Bilang apa yang kurang, lalu tanya. Contoh yang benar:

> "Surat izin butuh alasan. Alasan izin Budi Santoso apa?"

Contoh yang salah — mengarang alasan lalu membuat dokumennya:

> "Surat izin Budi Santoso dengan alasan tidak bisa hadir." ← ini mengarang

## Batas penting

- **Tidak ada tanda tangan digital.** Dokumen ditandatangani manual setelah
  dicetak. Ini bukan tanda tangan elektronik.
- **Tidak ada perbaikan dokumen.** Kalau isinya salah, buat dokumen baru dan
  arsipkan yang lama.
- **Tidak ada format DOCX.** Yang tersedia PDF saja.
- **Pengiriman butuh persetujuan.** Dokumen resmi yang terkirim ke nomor yang
  salah tidak bisa ditarik kembali.