---
name: answer-from-knowledge
description: Menjawab pertanyaan dari pengetahuan organisasi — menjawab pertanyaan tentang aturan, prosedur, dan keputusan dari dokumen resmi yang tersimpan, lalu menyimpan dokumen baru ke knowledge base.
version: 1.0.0
required_tools:
  - knowledge_search
  - knowledge_ingest
  - knowledge_ingest_document
  - knowledge_list
  - knowledge_archive
required_permissions:
  - knowledge.read
contexts: [private, group]
triggers:
  - aturan
  - prosedur
  - prosedur
  - sop
  - tidak boleh
  - boleh atau tidak
  - kapan deadline
  - berapa
  - ketentuan
  - ketetapan
  - keputusan
  - musyawarah
  - notulen
  - pedoman
  - apa aturan
  - apakah boleh
  - savez apa
  - simpan aturan
---

# Jawab dari Dokumen Organisasi

## Tujuan
Menjawab pertanyaan tentang organisasi **dari dokumen yang benar-benar ada**,
bukan dari ingatan model.

## Aturan yang tidak bisa dilanggar

**1. Jangan pernah menjawab tanpa sumber.** Kalau `knowledge_search` mengembalikan
`found: false`, jawab: *"dokumennya belum ada, belum bisa saya jawab"*. Lalu
tawarkan menyimpan aturan itu sebagai dokumen.

Ini aturan terpenting di skill ini. Model bisa saja "tahu" bahwa iuran organisasi
biasanya Rp 20.000 — dan itu bisa salah, dan kalau dipakai untuk keputusan nyata
akibatnya orang dirugikan.

**2. Sebutkan sumbernya.** Setiap jawaban dari dokumen harus menyebut judul
dokumennya. Kutipan tanpa sumber tidak bisa diverifikasi, dan pertanyaan
"kapan ini berubah?" jadi tidak bisa dijawab.

**3. Jangan menyimpan dugaan.** `knowledge_ingest` hanya untuk apa yang organisasi
benar-benar sepakati: hasil rapat, aturan tertulis, SOP yang berlaku. Kalau
pengguna bertanya "kira-kira iurannya berapa?" dan tidak ada dokumennya, itu
**pertanyaan**, bukan dokumen.

## Alur yang benar

### Menjawab pertanyaan

1. `knowledge_list` dulu kalau tidak yakin dokumennya sudah ada.
2. `knowledge_search` dengan istilah kunci — bukan kalimat panjang.
3. Kalau `found: true`: jawab dari kutipannya dan sebut judul dokumennya.
4. Kalau `found: false`: bilang tidak ada dokumennya. **Jangan isi dari ingatan.**

Contoh yang benar:

> Iuran bulanan Rp 25.000, paling lambat tanggal 10 setiap bulan.
> Sumber: "Peraturan OSIS" ayat 1.

Contoh yang salah — mengarang:

> Iuran biasanya Rp 20.000 sampai Rp 25.000 tergantung kegiatan.
> ← Ini tidak ada di dokumen mana pun.

### Menyimpan dokumen

1. Pastikan teksnya **keputusan organisasi**, bukan pertanyaan atau dugaan.
2. `knowledge_ingest` dengan isi **persis** seperti diberikan — jangan diringkas.
   Ringkasan yang keliru lebih berbahaya daripada dokumen lengkap.
3. Kalau ada masa berlaku, isi `validUntil`.

### Memasukkan PDF yang sudah dibuat

Kalau dokumen PDF sudah dibuat (lewat `document_create`) dan isinya ingin bisa
ditanyakan, pakai `knowledge_ingest_document` dengan `documentId`-nya.

Kalau jawabannya "PDF tidak punya lapisan teks", berarti dokumennya hasil
pindai/foto. **Jangan karang isinya.**katakan saja tidak bisa dibaca.

### Mengarsipkan

`knowledge_archive` kalau aturan sudah diganti. Jangan dihapus — riwayatnya
dipakai untuk menjawab "kapan ini berubah?".

## Batas penting

- **Hanya dokumen yang dikirim lewat chat atau tersimpan yang bisa dicari.**
  Berkas PDF/Word belum dibaca isinya — belum ada ekstraksi teksnya.
- **Tidak ada pencarian di web.** Semua jawaban dari dokumen internal.
- **Stemming Bahasa Indonesia punya batasan.** Kata turunan bisa tidak cocok
  ("hadir" vs "ketidakhadiran"). Sistem sudah punya pencarian cadangan, tapi
  tetap bisa gagal untuk kata yang jauh berbeda bentuknya.
- **Menyimpan butuh izin `knowledge.write`.** Kalau tidak punya, dia bisa
  mencarinya tapi tidak bisa menyimpan. Jangan menjanjikan bisa menyimpan
  kalau ternyata tidak.