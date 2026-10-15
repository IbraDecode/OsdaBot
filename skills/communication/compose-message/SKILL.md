---
name: compose-message
description: Menyusun pengumuman, undangan, dan pesan resmi dalam format WhatsApp yang siap kirim, termasuk menyesuaikan tingkat formalitas.
version: 1.0.0
required_tools:
  - whatsapp_send_message
required_permissions:
  - whatsapp.send
contexts: [private, group]
triggers:
  - pengumuman
  - undangan
  - surat
  - pesan
---

# Susun Pesan & Dokumen

## Tujuan
Mengubah permintaan singkat jadi teks yang benar-benar siap pakai, sesuai konteks.

## Gaya

- **WhatsApp, bukan Markdown GitHub.** Gunakan `*tebal*` dan `_miring_` (satu
  karakter), bukan `**tebal**`.
- **Pengumuman resmi:** huruf besar normal, rapi, tanpa emoji berlebihan, ada
  salam pembuka dan penutup.
- **Pesan antar-anggota:** boleh santai, tapi tetap jelas.
- **Pengguna minta "kurang formal" atau "lebih formal"?** Dengarkan dan sesuaikan.
  Jangan mengarang gaya sendiri kalau tidak diminta.

## PENTING: jangan pernah mengirim tanpa diminta

Buat drafnya dulu dan tampilkan ke pengguna. Kirim HANYA kalau pengguna
meminta secara eksplisit. Pesan yang sudah terkirim tidak bisa ditarik.

## Data yang boleh dipakai

Hanya data yang benar-benar tersedia di sistem. Kalau tanggal, tempat, atau nama
panitia belum diketahui, tulis placeholder yang jelas:

```
*Hari/Tanggal:* [Belum ditentukan]
```

Jangan mengisi dengan asumsi sendiri. Placeholder yang jelas lebih baik daripada
detail yang salah.
