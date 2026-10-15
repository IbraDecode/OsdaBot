# Mesin Dokumen

Status: **IMPLEMENTED** · **TESTED** (517 test lulus, 0 gagal)

---

## 1. Kenapa PDFKit, bukan Chromium

Hasil riset, bukan preferensi:

| Pilihan | Biaya | Cocok untuk |
|---|---|---|
| Puppeteer/Chromium | ~300 MB + browser | Layout dari HTML/CSS |
| pdf-lib | perlu `@pdf-lib/fontkit` | Edit PDF yang sudah ada |
| **PDFKit** | ~5 MB, tanpa browser | Layout digambar langsung |

Surat izin, surat tugas, sertifikat, dan daftar hadir layoutnya tetap dan
digambar langsung dari data. Menarik Chromium 300 MB untuk menggambar empat
paragraf berarti membawa 300 MB yang tidak pernah dipakai.

---

## 2. Font: kenapa harus embedding

PDF dengan font standar (Helvetica, Times) **hanya bisa menulis Latin-1**. Nama
orang di Indonesia bisa mengandung karakter di luar itu, dan kalau font tidak
mendukung, hasilnya kotak kosong atau teks hilang tanpa memberitahu.

Jadi font TrueType (DejaVu Sans) di-embed ke setiap dokumen. PDFKit melakukan
subsetting otomatis, jadi ukuran berkas tetap kecil (±17 KB per surat).

Kalau font tidak ditemukan, sistem **menolak** dengan pesan jelas — bukan
menghasilkan PDF yang isinya hilang sebagian.

---

## 3. Aturan yang dijaga

1. **Dokumen resmi tanpa isi bukan dokumen.** Surat izin tanpa nama atau alasan
   ditolak. Surat tanpa alasan bukan keputusan, hanya formalitas.

2. **Isi daftar berasal dari database, bukan dari teks model.** PDF daftar hadir
   mengambil baris dari `AttendanceEntry` yang benar-benar ada. Kalau model boleh
   menulis nama sendiri ke PDF, dokumennya berisi kehadiran orang yang tidak
   pernah dikonfirmasi siapa pun.

3. **Nomor dokumen tidak pernah bentrok.** `SURAT/2026/001`,
   `SERTIFIKAT/2026/001`, dan seterusnya per jenis. Dicari dari **kolom sendiri**
   (`documentNumber`), bukan dari teks judul — menentukannya dari judul rapuh:
   ubah judul, nomor ikut berubah atau bentrok.

4. **Nama anggota yang ambigu ditolak.** Surat resmi atas nama orang yang salah
   tidak bisa ditarik kembali.

5. **Mengirim dokumen butuh persetujuan.** `document_send` ber-`requiresApproval`.

6. **Path traversal ditolak.** Kunci penyimpanan yang mencoba keluar dari
   direktori ditolak.

---

## 4. Tool

| Tool | Izin | Risiko | Persetujuan |
|---|---|---|---|
| `document_create` | `documents.create` | MEDIUM | Tidak |
| `document_list` | `documents.read` | LOW | Tidak |
| `document_send` | `documents.distribute` | HIGH | **Ya** |
| `document_templates` | `documents.read` | LOW | Tidak |

## 5. Templat

| Templat | Isi |
|---|---|
| `surat_izin` | Surat izin tidak mengikuti kegiatan |
| `surat_tugas` | Surat tugas mengerjakan tugas kegiatan |
| `sertifikat` | Sertifikat peserta kegiatan |
| `daftar_hadir` | Daftar hadir siap cetak & tanda tangan |
| `rekap_absensi` | Rekapitulasi absensi |

---

## 6. Bug yang ditemukan

### Tool mati tanpa skill — dan sudah terjadi dua kali

Tool dokumen dibuat lengkap dengan testnya, tapi **tidak ada `SKILL.md`**.
Hasilnya: agent menjawab dengan benar ("Surat izin PDF sudah dibuat") tapi tidak
pernah memanggil tool — dia menulis suratnya sebagai teks chat.

Penyebabnya: tool yang tidak ada di `required_tools` skill **tidak pernah
dikirim ke model**. Model tidak bisa memakai tool yang tidak dia lihat.

Bug yang sama sebelumnya: semua nama tool pakai titik → gateway menolak
seluruhnya dengan 400. Gejala dari sisi pengguna identik: *"gabisa ya"*.

**Perbaikan struktural:** `tests/integration/tool-reachability.test.ts`
menjadikan keterjangkauan tool lewat skill sebagai **invarian**. Tool yang tidak
terjangkau harus dicantumkan di `TANPA_SKILL` **dengan alasannya**.

Test itu langsung menemukan **4 tool mati lain** yang sudah lama ada:

```
organization_get_events, reminder_create, reminder_list, reminder_cancel
```

Tiga di antaranya adalah kemampuan yang sudah saya kerjakan dan
 diklaim aktif — pengingat terjadwal. Tidak bisa dipakai karena tidak ada
 skill-nya. Sekarang ada `skills/schedule/manage-reminder/SKILL.md`.

### Path validation ditelan `catch`

```ts
async get(key: string) {
  try { return await readFile(this.resolveKey(key)) }
  catch { return null }        // ← menelan penolakan path traversal
}
```

Validasi dilakukan di dalam `try`, jadi penolakan kunci berbahaya tertangkap dan
mengembalikan `null`. Path traversal lolos dengan diam-diam. Validasi dipindah
ke luar `try`.

Regression test-nya diverifikasi dengan mematikan validasinya:
`promise resolved "undefined" instead of rejecting`.

### `STORAGE_DRIVER=s3` meminta yang tidak ada

Env menerima `s3` dan mewajibkan semua variabel AWS, tapi tidak ada
implementasinya. Diam-diam jatuh ke disk lokal lebih berbahaya: operator
menyiapkan bucket, lalu dokumen resmi tersimpan di disk container yang hilang saat
restart. Sekarang `s3` **menolak boot** dengan pesan yang menyebut cara
memperbaikinya.

---

## 7. Verifikasi

Percakapan nyata:

```
> buatkan surat izin untuk Budi Santoso karena sakit, kegiatan Latihan LKBB besok
   organization_search_members=success | document_create=success

DOKUMEN DB: SURAT/2026/001 · Surat Izin · 17167 byte
HEADER     : %PDF-1.3
EOF        : %%EOF
```

---

## 8. Batas yang diketahui

| Batas | Dampak |
|---|---|
| **Tidak ada tanda tangan digital.** | Dokumen ditandatangani manual setelah dicetak. |
| **Tidak ada perbaikan dokumen.** | Isi salah → buat baru dan arsipkan yang lama. |
| **Tidak ada DOCX.** | PDF saja. |
| **Penyimpanan lokal saja.** | `STORAGE_DRIVER=s3` ditolak, bukan diam-diam jatuh ke lokal. |
| **Berkas hilang tidak bisa dipulihkan.** | `DocumentRecord` bisa ada tanpa berkasnya; itu terdeteksi dan dilog, tapi tidak ada salinan. |
| **Nomor bisa bentrok bila dua dokumen dibuat bersamaan.** | Penomoran membaca lalu menulis tanpa lock baris. Untuk satu organisasi yang menulis manual, jarang terjadi; untuk batch besar, belum aman. |
| **Agent kadang tidak menyebut nomor dokumen.** | Balasan kadang hanya "Surat izin PDF sudah dibuat" tanpa nomor. Skill sudah menyuruh menyebutnya, tapi tidak dipatuhi konsisten. |