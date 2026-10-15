# Lampiran Pesan (Media)

Status: **IMPLEMENTED** · **TESTED** (559 test lulus, 0 gagal)

---

## 1. Dua masalah nyata yang ditutup

### 1. Pesan media tanpa caption dibuang sepenuhnya

Di `baileys-provider.ts` ada:

```ts
// Hanya pesan teks (dan caption media) yang diproses untuk sekarang.
if (!normalized.text) return
```

Dan di pipeline:

```ts
if (!message.text || message.text.trim() === '') {
  return { action: 'skip', reason: 'empty_text' }
}
```

Hasilnya: **PDF yang dikirim tanpa keterangan hilang sebelum sampai ke agent.**
Pengguna mengirim berkas, tidak ada yang terjadi — persis gejala "botnya gabisa ya".

Sekarang lampiran dikenali:

```ts
const adaLampiran =
  message.type === 'document' || message.type === 'image' || message.type === 'video'

if (!adaTeks && !adaLampiran) {
  return { action: 'skip', reason: 'empty_text' }
}
```

Pesan kosong **tanpa** lampiran tetap ditolak — kalau semua lampiran dianggap
"pesan", spam teks kosong ikut diproses.

### 2. Lampiran tidak bisa diunduh sama sekali

`downloadMediaMessage` butuh `WAMessage` **mentah** (`mediaKey`, `directPath`),
bukan bentuk yang sudah dinormalisasi. Kalau bentuk itu hilang, lampiran tidak
bisa diunduh lagi.

Jadi pesan mentah disimpan di cache berumur:

| Batas | Nilai | Alasan |
|---|---|---|
| Jumlah | 100 pesan | Pesan mentah cukup besar; tanpa batas, memori habis |
| Masa berlaku | 15 menit | Media WhatsApp ikut kedaluwarsa |
| Ukuran unduhan | 15 MB | Satu lampiran besar bisa menjatuhkan proses |

Hanya `document` dan `image` yang disimpan. Stiker dan audio tidak punya teks
yang bisa dipakai, dan menyimpannya hanya mengisi cache dengan pesan yang tidak
pernah bisa dibaca.

---

## 2. Yang dijaga

1. **Lampiran milik percakapan lain tidak bisa diambil.** Id pesan bukan
   parameter tool — ia datang lewat `context.pendingMedia`, yang diisi handler
   dari percakapan yang sedang berjalan. Kalau id-nya parameter bebas, model
   bisa meminta berkas dari chat lain hanya dengan menyebut id-nya.

2. **Format ditentukan dari ISI berkas, bukan nama berkas.** Nama datang dari
   luar dan tidak bisa dipercaya. Deteksi lewat magic bytes (`%PDF-`) dan
   pemeriksaan karakter kontrol.

3. **Tidak ada OCR.** PDF hasil pindai adalah gambar. Mengarang isinya dari nama
   berkas akan menghasilkan dokumen palsu yang tersimpan sebagai sumber.

4. **Tidak ada unduhan otomatis.** Tidak ada yang mengunduh lampiran tanpa
   pengguna memintanya — itu yang membuat batas ukuran bisa diterima.

---

## 3. Tool

| Tool | Izin | Risiko |
|---|---|---|
| `media_pending` | `knowledge.read` | LOW |
| `media_read_document` | `knowledge.read` | LOW |
| `media_ingest_document` | `knowledge.write` | MEDIUM |

Alurnya: `media_pending` → `media_read_document` → `media_ingest_document`.

---

## 4. Test

`tests/integration/media.test.ts` — 13 test.

- **Pesan media tanpa caption TIDAK dibuang** (dokumen, gambar).
- Pesan kosong tanpa lampiran tetap ditolak.
- `media_pending` melaporkan lampiran + apakah bisa dibaca.
- **Format yang belum ditandai** sebagai tidak terbaca.
- **Membaca teks dari PDF lampiran** — isinya benar-benar terbaca.
- **Lampiran kedaluwarsa ditolak** dengan pesan "tolong kirim ulang".
- **Berkas rusak tidak menghasilkan teks palsu** — pesannya bisa dibaca manusia.
- Isi lampiran yang disimpan **benar-benar bisa dicari**.

### Dua kesalahan saat menyusun test

1. **Aktor `null` membuat 6 test gagal.** RBAC menolak di lapisan izin
   **sebelum** tool dipanggil — jadi tidak ada yang pernah sampai ke jalur yang
   mau diuji. Persis pelajaran yang sama dari test persetujuan; sekarang sudah
   jadi pola: pakai aktor nyata.

2. **Perbaikan harus diverifikasi.** Mematikan perbaikan "lampiran dianggap
   pesan" membuat test gagal dengan `expected 'skip' to be 'process'` — bukti
   regresinya, bukan asumsi.

---

## 5. Batas yang diketahui

| Batas | Dampak |
|---|---|
| **Media WhatsApp hanya 15 menit.** | Setelah itu pengguna harus kirim ulang. Ini batas WhatsApp, bukan pilihan kita. |
| **Ukuran dicek setelah unduhan.** | Batasi stream dari sisi Baileys butuh API yang tidak ada di versi ini, jadi satu lampiran besar sempat memakai memori. Jumlah cache dibatasi 100 sebagai gantinya. |
| **DOCX belum didukung.** | Hanya PDF dan berkas teks. |
| **Tidak ada OCR.** | PDF hasil pindai ditolak dengan pesan jelas. |
| **Hanya lampiran terakhir** yang diingat per percakapan. | Kirim beberapa berkas, yang terbaca adalah yang terakhir. |
| **Gambar dianggap lampiran tapi tidak bisa dibaca.** | Pipeline meneruskannya (supaya tidak hilang diam-diam), tapi tool menolaknya dengan penjelasan. |