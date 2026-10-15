---
name: read-attachment
description: Membaca isi lampiran PDF atau berkas teks yang dikirim pengguna, lalu menyimpannya ke knowledge base supaya bisa ditanyakan.
version: 1.0.0
required_tools:
  - media_pending
  - media_read_document
  - media_ingest_document
required_permissions:
  - knowledge.read
contexts: [private, group]
triggers:
  - lampiran
  - pdf
  - berkas
  - file
  - dokumen ini
  - ini dia
  - kirim
  - attachment
  - tolong baca
---

# Baca Lampiran

## Tujuan
Membaca berkas yang dikirim pengguna dan membuatnya bisa ditanyakan — tanpa
pernah mengarang isi berkas yang tidak bisa dibaca.

## Aturan yang tidak bisa dilanggar

**1. Jangan pernah mengarang isi lampiran.** Kalau `media_read_document` gagal,
jawab: *"filenya tidak bisa dibaca"*, lalu minta kirim ulang. Mengarang isi dari
nama berkas menghasilkan dokumen palsu yang akan tersimpan sebagai sumber.

**2. PDF hasil pindai tidak bisa dibaca.** Itu kenyataan teknis, bukan kegagalan
sistem. Jelaskan itu ke pengguna, jangan dipaksa membaca.

**3. Hanya PDF dan berkas teks.** Gambar, stiker, audio, video belum didukung.
Kalau pengguna mengirim format lain, bilang format itu belum bisa dibaca.

## Alur yang benar

### Pengguna mengirim PDF tanpa pesan

1. `media_pending` untuk melihat lampiran terakhir dan apakah bisa dibaca.
2. Kalau bisa: `media_read_document` untuk melihat isinya.
3. Kalau isinya aturan/prosedur: `media_ingest_document` supaya bisa
   ditanyakan nanti.
4. Kalau isinya cuma satu dokumen dan tidak perlu dicari: **cukup jawab dari
   `media_read_document`**, jangan simpan tanpa diminta.

### Pengguna mengirim PDF dengan pesan "simpan ini"

Langsung `media_ingest_document`.

## Kalau gagal

| Pesan dari tool | Yang bilang ke pengguna |
|---|---|
| "Lampirannya sudah tidak tersimpan" | "Filenya sudah kedaluwarsa di WhatsApp. Tolong kirim ulang." |
| "PDF ini tidak punya lapisan teks" | "PDF-nya hasil foto/pindai, jadi isinya belum bisa dibaca. Kalau bisa kirim yang versi digital." |
| "Format berkas ini belum bisa dibaca" | "Format itu belum bisa saya baca. PDF atau berkas teks saja yang bisa." |

## Batas penting

- **Media WhatsApp hanya tersedia 15 menit.** Setelah itu harus kirim ulang.
- **Ukuran maksimum 15 MB.** Berkas yang lebih besar dilewati.
- **Tidak ada OCR.** PDF hasil pindai tidak akan pernah terbaca tanpa bantuan
  luar.
- **DOCX belum didukung.**
- **Hanya lampiran terakhir** yang diingat. Kalau pengguna mengirim beberapa
  berkas, yang bisa dibaca adalah yang terakhir.