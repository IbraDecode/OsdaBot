---
name: manage-finance
description: Mencatat pemasukan dan pengeluaran kas, membuat tagihan beserta rinciannya, serta menerima pembayaran dan menandai status lunas atau belum.
version: 1.0.0
required_tools:
  - finance_list_accounts
  - finance_create_account
  - finance_record_entry
  - finance_create_invoice
  - finance_list_invoices
  - finance_record_payment
  - finance_recent_entries
  - finance_cancel_invoice
  - finance_restore_invoice
required_permissions:
  - finance.read
contexts: [private, group]
triggers:
  - kas
  - uang
  - iuran
  - tagihan
  - bayar
  - pembayaran
  - pemasukan
  - pengeluaran
  - saldo
  - keuangan
  - bendahara
---

# Kelola Keuangan

## Tujuan
Menjaga buku kas dan daftar tagihan tetap benar, tanpa mengarang angka dan
tanpa menandai lunas sebelum uang benar-benar diterima.

## Dua hal yang tidak bisa ditawar

1. **Nominal SELALU rupiah bulat.** Tidak ada pecahan. Kalau pengguna
   menyebut `25.500,50`, tanyakan bagian sennya — jangan dibulatkan sendiri.
   Pembulatan yang tidak terlihat adalah sumber selisih yang tidak pernah bisa
   dilacak ke struk.

2. **Jangan tandai lunas berdasarkan klaim chat saja.** `PAYMENT_EXCEEDS_INVOICE`
   berarti ada selisih yang harus ditanyakan: salah transfer, atau salah baca
   nominal. Menerimanya berarti uang hilang tanpa jejak. Kalau pengguna
   mengatakan "sudah bayar Rp 150.000" untuk tagihan Rp 100.000, jangan catat
   — tanyakan dulu selisihnya mau diapakan.

## Alur yang benar

### Mencatat mutasi kas

1. **`finance_list_accounts` lebih dulu.** Kalau **belum ada rekening sama
   sekali**, buat dulu dengan `finance_create_account` — tanpa rekening tidak
   ada tempat mencatat uang, dan itu bukan alasan untuk bilang "gagal".

2. Kalau organisasi punya lebih dari satu rekening, wajib sebutkan yang mana.
   Kalau hanya satu, tool memilih otomatis.

3. **`finance_record_entry`** dengan `type: 'income'` atau `'expense'`.
   Jangan pernah mengirim `totalAmount`, `saldo`, atau `sisa` — tool menghitung
   sendiri dari mutasi.

4. **Pengeluaran yang melebihi saldo akan ditolak.** Itu memang benar: saldo
   kas tidak boleh minus. Kalau pengguna tetap ingin mencatat, tanyakan
   apakah uangnya memang sudah ada, atau berarti saldo awal belum dicatat.

### Membuat tagihan

1. **Buat rinciannya, jangan totalnya.** `finance_create_invoice` menghitung
   total dari `jumlah x harga satuan`. Kalau kamu mengirim `totalAmount`,
   parameter itu DITOLAK karena tidak dikenal — dan itu memang benar, karena
   total yang diinput terpisah bisa berbeda dari rinciannya sejak awal.

2. **`memberName` diisi kalau tagihan untuk satu orang.** Kalau iuran untuk
   semua orang sekaligus, buat satu tagihan tanpa anggota lalu catat pembayaran
   per orang.

3. **Nama yang ambigu ditolak.** Kalau ada dua anggota bernama sama, jangan
   pilih salah satu — tanyakan ke pengguna.

### Menerima pembayaran

1. **`finance_list_invoices` untuk cari tagihan yang dimaksud.** Jangan
   mengarang `invoiceId`.

2. **`finance_record_payment` dengan nominal yang benar-benar dibayar.**
   Status berubah otomatis: `partial` kalau belum lunas, `paid` kalau penuh.

3. **Pastikan ada rekening.** Kalau organisasi punya beberapa rekening dan
   pengguna tidak menyebut yang mana, tool menolak. Itu pertanyaan yang harus
   balik ke pengguna, bukan ditebak.

### Mencari tagihan yang menunggak

`finance_list_invoices` dengan `status: "overdue"`.

**`overdue` dihitung saat dibaca, bukan disimpan sebagai status.** Jadi:

- `status` di hasil adalah status yang sudah memperhitungkan tenggat:
  `"overdue"` kalau lewat, sisanya apa adanya.
- `statusTersimpan` adalah nilai asli di database — biasanya `"unpaid"` atau
  `"partial"`.
- `terlamaHari` berisi banyaknya hari telat. **`null` berarti tidak punya
  tenggat, bukan "0 hari telat"** — dua hal yang sangat berbeda.

Saringan `overdue` dulu mengirim `"overdue"` sebagai nilai kolom `status`,
padahal tidak ada satu pun tagihan yang kolomnya berisi itu. Hasilnya selalu
nol baris: bendahara yang bertanya "tagihan lewat tenggat mana?" dijawab "0
tagihan" padahal ada yang menunggak.

Yang **tidak** masuk hitungan: tagihan `paid`. Menjawab "menunggak 30 hari" untuk
tagihan yang sudah lunas adalah kebohongan.

## Cara membalas

- Sebut nominal dalam rupiah penuh: "Rp 150.000", bukan "150rb".
- Sebut status dengan jelas: LUNAS, BELUM LUNAS, atau SISA Rp 60.000.
- Kalau ada penolakan, sampaikan **alasannya**, bukan hanya "gagal". Pesan error
  dari tool sudah aman untuk ditampilkan ke pengguna.
- Kalau saldo tidak cukup, sebutkan saldo yang tersedia.

### Membatalkan tagihan

**Jangan pernah menjawab "fitur pembatalan belum tersedia" untuk permintaan ini.**

`finance_cancel_invoice` tersedia. Yang benar-benar belum ada adalah pembatalan
**pembayaran** — itu urusan koreksi kas.

1. **Cari dulu.** `finance_list_invoices`, atau `invoiceNumber` kalau diketahui.
   Kalau lebih dari satu cocok, **tanyakan** — membatalkan tagihan yang salah tidak
   bisa dibatalkan efeknya.
2. **Alasan WAJIB.** `reason` tidak boleh kosong. Pembatalan tanpa alasan tidak
   bisa dipertanggungjawabkan, dan tiga bulan lagi tidak ada yang tahu kenapa
   tagihannya hilang.
3. **Tagihan yang sudah lunas akan ditolak.** Itu benar. Kalau memang keliru,
   catat koreksi kas lewat `finance_record_entry` — jangan membatalkan tagihan
   yang uangnya sudah masuk.

Pembatalan **tidak menyentuh uang**. Kalau sudah ada pembayaran parsial, uangnya
tetap tercatat di kas; yang ditutup hanya haknya untuk membayar. Ini disampaikan
apa adanya, karena `"pembayaran Rp X tidak hilang"` mencegah pengguna panik
mengira uangnya hilang.

Kalau ternyata salah batal: `finance_restore_invoice`. Status dipulihkan dari data
pembayaran — `unpaid` kalau belum ada, `partial` kalau sudah sebagian, `paid` kalau
memang sudah lunas. Ada jalur keluar, jadi pembatalan tidak permanen.

## Batas penting

- **Tagihan tidak mengirim pesan.** Tool ini hanya mencatat. Kalau pengguna mau
  pengingat pembayaran, itu urusan skill jadwal dan pengingat.
- **Tidak ada penalti otomatis atau pengingat jatuh tempo.** Kalau pengguna
  minta "tagih yang belum bayar", itu `finance_list_invoices`, bukan mengirim
  pesan otomatis.
- **Tagihan tidak punya tombol ubah tanggal jatuh tempo.** Kalau pengguna
  minta "tenggatnya digeser ke Jumat", sampaikan apa adanya — jangan mengarang
  perubahan yang tidak terjadi.
- **Tidak ada pembatalan pembayaran.** `finance_cancel_invoice` membatalkan TAGIHAN,
  bukan pembayaran. Pembayaran yang salah harus dikoreksi lewat
  `finance_record_entry` — uang yang sudah masuk sudah jadi bagian riwayat kas.