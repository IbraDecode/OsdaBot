# Knowledge Engine

Status: **IMPLEMENTED** · **TESTED** (540 test lulus, 0 gagal)

---

## 1. Kemampuan paling rawan mengarang

Semua kemampuan lain di bot ini menulis atau menghitung data yang sudah ada.
Knowledge engine berbeda: ia **menjawab pertanyaan dari teks**.

Kalau pencarian gagal dan sistem diam-diam menjawab dari ingatan model,
hasilnya terdengar benar tapi tidak ada sumbernya. Untuk pertanyaan
"berapa iuran?", "kapan deadline?", jawaban salah berarti orang salah bertindak
dengan uangnya.

Jadi aturannya:

1. **Tidak boleh menjawab tanpa sumber.** Kalau pencarian kosong, jawabannya
   "dokumennya belum ada".
2. **Dokumen kedaluwarsa tidak dipakai.** Menjawab dengan aturan lama sama
   berbahaya dengan menjawab tanpa sumber.
3. **Offset disimpan** supaya kutipan bisa ditelusuri ke dokumen asal.

---

## 2. Pencarian Bahasa Indonesia native

PostgreSQL 18 punya konfigurasi teks `indonesian` dengan stemming:

```
Pertanyaan : "berapa iuran bulanan"
tsvector   : 'iur':4 'bulan':5,15 'bulan':5   (dari dokumen)
tsquery    : 'apa' & 'iur' & 'bulan'        (dari pertanyaan)
```

### Bug yang ditemukan: AND vs OR

`websearch_to_tsquery` memakai **AND**: semua kata kunci harus muncul. Itu
benar untuk pencarian strict, tapi **selalu gagal untuk pertanyaan natural**:

```
pertanyaan : "berapa iuran bulanan"
dokumen    : "Iuran bulanan sebesar Rp 25.000 dibayar tanggal 10"
hasil      : 0 hasil   ← padahal dokumen itu persis yang dicari
```

"berapa" tidak ada di dokumen, jadi seluruh query gagal. Pertanyaan yang
lebih baik tetap gagal begitu saja.

Perbaikannya: operand `&` diganti `|`, relevansi diurus `ts_rank`. Kata
ekstra menurunkan peringkat, bukan menghilangkan hasil.

### Pencarian cadangan: substring

Stemming Indonesia punya batasan nyata:

```
pertanyaan : "gimana kalau tidak hadir"
dokumen    : "Ketidakhadiran tanpa keterangan resmi akan dicatat sebagai alfa"
```

Stemmer mengubah "hadir" → "hadir" dan "ketidakhadiran" → bentuk lain.
Keduanya tidak cocok — padahal **"hadir" ada sebagai substring** di dalam kata
itu.

Jadi kalau full-text tidak menemukan apa pun, pencarian cadangan `ILIKE` dijalankan
dengan skor kecil (0,01) supaya tidak mengalahkan kecocokan yang sudah-ranked.

Kalau dua-duanya gagal, jawabannya tetap kosong. Tidak ada jalur yang
menghasilkan jawaban tanpa sumber.

---

## 3. Indeks

Indeks GIN **ekspresi**, bukan kolom `tsvector` yang dipelihara trigger:

```sql
CREATE INDEX "KnowledgeChunk_cari_indonesia_idx"
  ON "KnowledgeChunk" USING GIN (to_tsvector('indonesian', "content"));
```

Alasan: kalau trigger gagal diam-diam, isi indeks tidak sinkron dan dokumen
yang ada tidak bisa dicari — pertanyaan dijawab "tidak ada datanya" padahal
datanya ada. Itu lebih buruk daripada pencarian lambat.

Kolom `KnowledgeDocument.searchVector` memang ada di schema tapi ditandai
`Unsupported` Prisma, jadi tidak bisa ditulis lewat ORM dan tidak dipakai.

---

## 4. Tool

| Tool | Izin | Risiko | Persetujuan |
|---|---|---|---|
| `knowledge_search` | `knowledge.read` | LOW | Tidak |
| `knowledge_list` | `knowledge.read` | LOW | Tidak |
| `knowledge_ingest` | `knowledge.write` | MEDIUM | Tidak |
| `knowledge_archive` | `knowledge.write` | MEDIUM | **Ya** |

`knowledge_search` mengembalikan `found: boolean` — bukan array kosong — supaya
model bisa membedakan "tidak ditemukan" dari "belum ditanyakan".

---

## 5. Verifikasi

Percakapan nyata:

```
> simpan aturan ini sebagai dokumen: Peraturan Uji Chat.
  Iuran bulanan Rp 25.000 dibayar tanggal 10. Absensi wajib diisi saat kegiatan.
   knowledge_list | knowledge_ingest = success
   BALASAN: Dokumen *Peraturan Uji Chat* sudah disimpan dengan isi persis seperti yang kamu kirim

> berapa iuran bulanan kita
   knowledge_search = success
   BALASAN: Iuran bulanan kita *Rp 25.000*, dibayar tanggal *10* setiap bulan.

DOKUMEN DB: [{ "title": "Peraturan Uji Chat", "status": "verified" }]
```

---

## 6. Bug yang ditemukan saat pengerjaan

**Kurung penutup hilang** — `create({` tanpa `)`. Gejalanya muncul sebagai
`TS1005` di baris **12 baris kemudian**, tepat di baris yang benar. Menebak dari
pesan error tidak berhasil.

**Nested template literal** di dalam `${...}` tidak valid JavaScript, dan
laporan error-nya menunjuk ke baris yang benar-benar tidak bersalah.

**`$queryRaw` harus dipanggil sebagai TAG**, bukan fungsi dengan kurung:

```ts
prisma.$queryRaw`SELECT ...`     // benar
prisma.$queryRaw(`SELECT ...`)   // Prisma melempar "is a tag function"
```

**Parameter `target` diabaikan** di `buatPotongan` kalau dokumen masih di bawah
`MAKS_POTONGAN` — pemanggil yang meminta potongan kecilnya dapat satu potongan
besar.

**Fallback mengabaikan filter tipe dokumen.** Pengguna yang menyaring "hanya
peraturan" tetap mendapat dokumen bertipe lain, dan tidak ada yang tahu
penyebabnya.

---

## 7. Batas yang diketahui

| Batas | Dampak |
|---|---|
| ~~Hanya teks, bukan PDF~~ | **Sudah ditutup.** PDF bisa diekstraksi dengan `knowledge_ingest_document`. Lihat `docs/EKSTRAKSI-PDF.md`. DOCX masih belum. |
| **Stemming Indonesia terbatas.** | "hadir" vs "ketidakhadiran" butuh pencarian cadangan. Kata yang jauh berbeda bentuknya masih bisa gagal. |
| **Tidak ada pencarian web.** | Semua dari dokumen internal. |
| **Tidak berbagi antar organisasi. | Knowledge base tidak berbagi antar organisasi — benar, tapi berarti onboarding baru mulai dari nol. |
| **Tidak ada versi dokumen.** | Mengganti isi dokumen = menyimpan dokumen baru. Tidak ada riwayat perubahan, jadi "kapan aturan ini berubah?" tidak bisa dijawab. |
| **Agent kadang tidak menyebut sumber.** | Balasan benar tapi judul dokumennya tidak disebut. Skill menyuruhnya, tapi tidak dipatuhi konsisten. |