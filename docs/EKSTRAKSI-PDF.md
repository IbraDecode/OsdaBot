# Ekstraksi PDF ke Knowledge Base

Status: **IMPLEMENTED** · **TESTED** (546 test lulus, 0 gagal)

---

## 1. Celah yang ditutup

Sebelumnya knowledge engine hanya bisa mencari **teks yang dikirim lewat chat**.
PDF yang dibuat mesin dokumen — surat izin, sertifikat, daftar hadir — **tidak**
bisa ditanyakan isinya. Jadi kemampuan yang dijanjikan "dokumen organisasi bisa
ditanyakan" hanya berlaku separuh.

Sekarang: `document_create` → `knowledge_ingest_document` → `knowledge_search`.

---

## 2. Kenapa `unpdf`

Hasil riset, bukan preferensi:

| Library | Masalah |
|---|---|
| pdf-parse | Menarik `canvas` (native). Gagal build di serverless — dan gagalnya muncul **saat runtime produksi**, bukan saat build. |
| pdfjs-dist | ~2 MB, API tingkat rendah; harus memanggil `getTextContent` sendiri. |
| **unpdf** | Nol dependency, tanpa native, satu fungsi. |

---

## 3. Yang dijaga

1. **PDF tanpa lapisan teks DITOLAK, bukan dikarang.** PDF hasil pindai adalah
   sekumpulan gambar. PDF.js mengembalikan string kosong — dan itu informasi
   yang berguna. Isinya **tidak boleh** ditebak dari nama berkas.

2. **Deteksi lewat magic bytes (`%PDF-`), bukan ekstensi.** Nama berkas datang
   dari luar dan tidak bisa dipercaya.

3. **Dokumen terenkripsi ditolak dengan pesan jelas**, bukan error parser mentah
   yang tidak bisa ditindaklanjuti.

4. **Batas 200 halaman.** PDF 500 halaman butuh waktu dan memori yang tidak
   sebanding dengan nilainya.

---

## 4. Bug yang ditemukan

### `Buffer` Node harus jadi `Uint8Array` polos

```ts
getDocumentProxy(buffer)              // ✗ PARSE_FAILED
getDocumentProxy(new Uint8Array(buf)) // ✓ berhasil
```

`Buffer` adalah subclass `Uint8Array` dengan offset dan panjang sendiri.
PDF.js membaca `byteOffset`/`byteLength` — kalau tidak dikonversi, ia membaca
dari offset yang salah.

Test "membaca teks dari PDF yang benar" gagal **sebelum** perbaikan dan lulus
sesudah — itu bukti regresinya, bukan asumsi.

### `destroy()` ada di sebagian versi PDF.js saja

Dipanggil lewat pemeriksaan `typeof`, plus `cleanup()` sebagai cadangan. PDF yang
tidak ditutup menahan memori untuk seluruh proses.

---

## 5. Verifikasi

```
PDF : DAFTAR/2026/001  Pedoman-Kehadiran-Uji.pdf  17242 byte
TEKS: "OSIS SMKN 2 MATARAM | Pedoman Kehadiran Uji | Nomor: DAFTAR/2026/001 |
       Daftar Hadir | NO NAMA KELAS TANDA | TANGAN | Budi Santoso | X AKL 1 |
       OSIS SMKN 2 MATARAM, 15 Oktober | 2026 | Ahmad Fauzi | Ketua Osis"

INGEST: 185 karakter, 1 bagian

TANYA "nama siapa yang ada di daftar" -> 1 sumber
TANYA "siapa ketua osis"              -> 1 sumber
```

Dan lewat percakapan:

```
> buat dokumen PDF "Pedoman Kehadiran" berisi daftar hadir …
   BALASAN: PDF *Pedoman Kehadiran* berhasil dibuat.

> masukkan isi dokumen PDF dengan id d66fa735-… ke knowledge base
   BALASAN: Isi PDF *Pedoman-Kehadiran* berhasil diekstraksi dan disimpan ke
            knowledge base organisasi.
```

---

## 6. Batas yang diketahui

| Batas | Dampak |
|---|---|
| **Hanya PDF.** | DOCX dan gambar tidak diekstrak. |
| **Tidak ada OCR.** | PDF hasil pindai/foto ditolak. Ini batas nyata: sistem tidak akan mengarang isi dokumen yang tidak bisa dibaca. |
| ~~Hanya dokumen yang sudah dibuat sistem~~ | **Sudah ditutup.** Lampiran dari chat bisa diunduh dengan `downloadMediaById` dan diekstrak. Lihat `docs/LAMPIRAN.md`. |
| **Urutan teks bisa kacau** pada dokumen dua kolom. | Isi terbaca, urutan baris tidak dijamin benar. |
| **Ekstraksi dipanggil langsung** di dalam tool. | PDF besar bisa membuat tool lambat. Untuk berkas besar, seharusnya lewat worker. |