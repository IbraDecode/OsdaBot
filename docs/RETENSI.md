# Retensi Data

Status: **IMPLEMENTED** · **TESTED** (12 test integrasi)

---

## 1. Masalah yang diselesaikan

Tiga modul terakhir semuanya menambah baris tanpa batas:

| Tabel | Menambah |
|---|---|
| `AgentTask` + `AgentStep` | satu baris induk + beberapa anak, **per pesan** |
| `ToolExecution` | satu baris **per pemanggilan tool** — bisa puluhan per pesan |
| `OutboxEvent` | satu baris per pesan keluar, tidak pernah dihapus |

Untuk pilot terbatas ini aman. Berjalan berbulan-bulan, tabel-tabel ini tumbuh
tanpa henti dan tidak ada yang memperingatkan — termasuk operatornya.

Angka di database pengembangan saat modul ini dibuat: `ToolExecution` 2349,
`AuditLog` 705, `OutboxEvent` menumpuk, dan `Invoice` **1276 baris transaksi
nyata**.

---

## 2. Aturan yang tidak bisa dilanggar

### Daftar putih, bukan daftar hitam

Hanya tabel yang **tertulis** di `KEBIJAKAN` yang boleh dihapus. Tabel baru
yang ditambahkan kemudian terlindungi secara bawaan.

Alasannya sederhana: penghapusan yang salah pada data bisnis tidak bisa
dibatalkan.

### Bukti pada level tipe

```ts
type Irisan = Extract<NamaTabel, (typeof TABEL_BISNIS)[number]>
type TumpangTindih = [Irisan] extends [never] ? true : never

const _bukti: TumpangTindih = true
```

Kalau ada `NamaTabel` yang sekaligus ada di `TABEL_BISNIS`, irisan bukan
`never`, tipenya berubah, dan **build gagal**. Jadi "tidak bisa menimpa data
bisnis" dijamin compiler, bukan konvensi.

#### Bentuk pertamanya salah, dan baru ketahuan setelah diuji terpisah

Saya menulisnya `[Exclude<A, B>] extends [A] ? true : never`. Itu terlihat benar
dan lulus — padahal **lolos total**.

`[X] extends [Y]` adalah pemeriksaan **subtipe**, bukan kesamaan. Kalau
`NamaTabel` punya `'AgentTask' | 'AuditLog'` dan irisan kosong, `Exclude`
mengembalikan `NamaTabel` utuh, dan `NamaTabel` jelas *assignable* ke
`NamaTabel` — hasilnya `true` selalu, tumpang tindih atau tidak.

Jadi bentuk itu akan lulus selamanya, termasuk kalau nanti ada kebijakan yang
benar-benar menyentuh data bisnis.

Bentuk yang benar adalah `Extract` lalu `[never]`. Bedanya baru ketahuan karena
bentuknya diuji terpisah lebih dulu di file kecil: menyisipkan `'Invoice'` ke
`NamaTabel` **harus** membuat build gagal, dan versi pertama tidak melakukannya.

### Pengaman runtime

Bukti level tipe menutup salah ketik. Yang ditutup pengaman runtime: data dari
luar tipe — berkas konfigurasi, panggilan API, hasil perubahan masa depan.

---

## 3. Kebijakan

| Tabel | Umur | Kenapa |
|---|---|---|
| `AgentTask` | 30 hari | Rekaman operasional, bukan bukti |
| `AgentStep` | 30 hari | Selalu ikut induknya |
| `ToolExecution` | 90 hari | menjawab "tool apa yang gagal" bahkan setelah rekaman jalannya dihapus |
| `AuditLog` | 365 hari | Jejak kepatuhan |
| `OutboxEvent` | 30 hari | **hanya** yang `DELIVERED`/`FAILED`/`UNKNOWN` |

### Kenapa hanya yang selesai di outbox

`PENDING` dan `SENDING` adalah pesan yang **masih harus terkirim**.
Menghapusnya berarti membatalkan pengiriman tanpa ada yang diberi tahu — dan
tidak ada tempat lagi yang tahu pesannya pernah ada.

### Kenapa `Message` tidak boleh dihapus

`Message` adalah konteks percakapan. Menghapusnya berarti bot lupa pernah
berbicara dengan orang itu — dan pengguna yang mengulang pertanyaannya akan
melihat bot yang kehilangan ingatan setiap beberapa menit.

Ini bukan keputusan sementara. Kalau nanti diperlukan, itu keputusan produk
dengan persetujuan pengguna, bukan sekadar kebijakan retensi.

---

## 4. Penghapusan bertahap

Tidak sekali jalan. Menghapus 200 ribu baris dalam satu transaksi menahan kunci
tabel lama sekali dan bisa membuat bot tidak menjawab selama hampir semua
durasi perintah.

Potongan 500 baris, batas 5000 baris per tabel per siklus. Kalau batasnya
terlampaui, `kenaBatas` dilaporkan supaya sisanya tidak hilang tanpa jejak.

---

## 5. Yang dicatat

Hanya **berapa**, bukan **apa**. Audit menyimpan hitungan dan rentang waktu.
Menghapus data lalu menyalinnya ke audit berlawanan dengan tujuannya.

---

## 6. Kode yang saya buang setelah diuji

Awalnya penghapusan `AgentTask` juga menghapus `AgentStep`-nya lebih dulu, dengan
alasan "bergantung pada cascade lebih sulit dibuktikan benar".

Setelah dimatikan dan test-nya tetap lulus, ternyata **cascade
`AgentStep.task` sudah menanganinya dengan benar**. Kode manual itu dihapus:
tidak menambah jaminan apa pun, hanya satu query dan satu tempat lagi yang bisa
salah.

Yang menjaga Cascade sekarang adalah definisi kolomnya di schema — dan test
`langkah ikut terhapus bersama induknya` yang memverifikasinya, supaya mengubah
definisi kolomnya ketahuan.

---

## 7. Pemakaian

```bash
pnpm osda retention:status          # kebijakan + berapa yang akan dihapus
pnpm osda retention:run --dry-run   # hitung saja, tidak menghapus
pnpm osda retention:run             # hapus
```

Otomatis: sekali saat boot, lalu setiap 6 jam. Tidak perlu sering — kebijakan
berdimensi hari.

---

## 8. Mode aman dan `/ready`

Mode aman dilaporkan sebagai **kegagalan readiness**. `/ready` jadi 503 saat
bot sedang ditahan.

Ini keputusan yang disengaja. `/ready` ada supaya sistem pemantau, load
balancer, atau orkestrator tahu bot sedang tidak melayani — dan saat mode aman
dinyalakan, bot memang tidak melayani. Operator yang sengaja menahan bot
**ingin** melihat ini muncul.

Yang tidak boleh terjadi: mode aman menyala diam-diam dan tidak ada satu pun
tanda di luar log terminal yang sedang tidak dibaca siapa pun.

### Yang tetap belum ada: kedaluwarsa otomatis

Mode aman **tidak** kedaluwarsa. Ini keputusan yang saya pertimbangkan
panjang-lebar dan tetap bukan yang mudah:

| Skenario | Akibat |
|---|---|
| Kedaluwarsa, insiden belum selesai | Bot melanjutkan kesalahan yang justru sedang dicari — tanpa pengawasan |
| Tidak kedaluwarsa, operator lupa | Bot diam; tidak ada yang diberi tahu |

Yang kedua lebih mudah dideteksi dan lebih lambat berbahaya. Yang pertama
menggandakan kesalahan yang sedang ditangani.

Jawabannya bukan menambah TTL, tapi membuat "bot diam ini disengaja" terlihat
di `/ready`. Kalau nanti perlu TTL, itu env opsional dengan nilai bawaan
**tidak pernah**, dan operator yang menyalakannya yang memutuskan risiko yang
mau dia terima.