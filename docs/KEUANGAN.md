# Layanan Keuangan

Status: **IMPLEMENTED** · **TESTED** (457 test lulus, 0 gagal)

Belum ada integrasi BaturPay. Semua yang tertulis di sini adalah kode yang
benar-benar ada di `src/finance/service.ts` dan `src/tools/finance-tools.ts`.

---

## 1. Empat aturan yang tidak bisa dilanggar

### Uang SELALU integer Rupiah

Tidak ada float, tidak ada pembulatan diam-diam. `0.1 + 0.2 !== 0.3` adalah hal
wajar untuk perhitungan biasa; untuk buku kas, selisih beberapa rupiah yang
tidak pernah cocok dengan struk adalah masalah yang tidak bisa dilacak.

Semua nominal masuk lewat `parseAmount()`:

```ts
parseAmount('25000')     // 25000
parseAmount('25.000')    // 25000
parseAmount('Rp 25.000') // 25000
parseAmount('25.5')      // DITOLAK — pecahan
parseAmount('12.500,50') // DITOLAK — pecahan
```

**Menolak lebih baik daripada membulatkan.** Pembulatan yang tidak terlihat
adalah sumber selisih yang mustahil dilacak. Nilai di luar
`Number.MAX_SAFE_INTEGER` juga ditolak — `isInteger` saja tidak cukup, angka
`MAX_SAFE_INTEGER + 2` masih "bulat" menurut JavaScript tapi sudah di luar
rentang presisi.

### Saldo kas tidak boleh minus

Pengeluaran yang melebihi saldo **ditolak**, bukan diterima lalu pelan-pelan
menjadi bangkrut. Saldo negatif berarti pengeluaran tercatat tanpa uang yang
ada; buku jadi salah dan tidak ada yang bisa memperbaikinya tanpa investigasi.

### Pembayaran harus ATOMIK

Status tagihan, jumlah terbayar, mutasi kas, dan saldo berubah **bersama atau
tidak sama sekali**. Kalau tagihan sudah LUNAS tapi saldo kas belum berubah,
buku kas dan tagihan saling berbohong.

### Pembayaran melebihi tagihan ditolak

Membayar Rp 150.000 untuk tagihan Rp 100.000 berarti ada selisih yang harus
ditanyakan: salah transfer, atau salah baca nominal. Menerimanya berarti uang
hilang tanpa jejak.

> Bug yang pernah terjadi: cek "saldo tidak cukup" disalin ke jalur **penerimaan**
> uang. Akibatnya kas yang mulai dari nol tidak akan pernah bisa menerima apa
> pun — tidak pernah menerima dana pertama. Diperbaiki, dengan regression test.

---

## 2. Tool yang tersedia

| Tool | Izin | Risiko | Kegunaan |
|---|---|---|---|
| `finance_list_accounts` | `finance.read` | LOW | Daftar rekening + saldo |
| `finance_create_account` | `finance.create` | MEDIUM | Buat rekening kas baru |
| `finance_record_entry` | `finance.create` | MEDIUM | Catat pemasukan / pengeluaran |
| `finance_create_invoice` | `finance.create` | MEDIUM | Buat tagihan + rincian |
| `finance_list_invoices` | `finance.read` | LOW | Daftar tagihan + sisa |
| `finance_record_payment` | `finance.update` | MEDIUM | Terima pembayaran |
| `finance_recent_entries` | `finance.read` | LOW | Mutasi kas terbaru |

Semua skema memakai `.strict()`: **parameter yang tidak dikenal DITOLAK**, bukan
diabaikan diam-diam. Kalau diabaikan, model mengira parameter yang ia karang
sudah tersimpan.

`organizationId` dan `actorUserId` **tidak pernah** jadi parameter input.
Keduanya diambil dari `context`, yang sudah diverifikasi backend.

---

## 3. Yang diverifikasi ke database sungguhan

`tests/integration/finance-tools.test.ts` — 25 test.

### Penolakan yang harus benar-benar menolak

```
BUG REGRESSION: saldo kas TIDAK BOLEH menjadi minus        → CONFLICT, saldo tetap
BUG REGRESSION: MENOLAK pecahan rupiah                     → VALIDATION_FAILED
BUG REGRESSION: MENOLAK rekening dari organisasi lain       → NOT_FOUND
BUG REGRESSION: MENOLAK pembayaran yang MELEBIHI sisa       → CONFLICT, saldo tetap
BUG REGRESSION: MENOLAK pembayaran kedua saat sudah lunas  → CONFLICT
BUG REGRESSION: MENOLAK tagihan dari organisasi lain        → NOT_FOUND
BUG REGRESSION: nama anggota ambigu TIDAK ditebak           → AMBIGUOUS_REFERENCE
BUG REGRESSION: tool keuangan bagi aktor tanpa izin         → PERMISSION_DENIED
BUG REGRESSION: menerima ke kas ber saldo tipis HARUS berhasil
BUG REGRESSION: tagihan BELUM LUNAS muncul lebih dulu
```

Yang terakhir perlu dijelaskan, karena ia ditemukan lewat pengujian nyata.

### Bug urutan tagihan

Kolom `status` disimpan sebagai **teks**, jadi `orderBy` menurutkannya secara
alfabetis:

```
paid  <  partial  <  unpaid
```

Artinya tagihan yang **sudah lunas** muncul lebih dulu, dan tagihan yang belum
lunas tenggelam di bawahnya. Pertanyaan yang paling sering muncul adalah
"siapa yang belum bayar" — jadi persis yang paling tidak terlihat.

Perbaikannya menyortir berdasarkan prioritas status (`overdue` → `unpaid` →
`partial` → `paid` → `cancelled`), bukan alfabetis.

Regression test-nya diverifikasi dengan mematikan perbaikannya:

```
dengan perbaikan  : 25 lulus
tanpa perbaikan   : "expected 1 to be less than 0"
```

---

## 4. Batas yang diketahui

| Batas | Dampak |
|---|---|
| **Tidak ada pembatalan tagihan.** | Salah tagihan harus dikoreksi manual. |
| **Tidak ada penalti atau pengingat jatuh tempo.** | Tagihan lewat tempo tidak otomatis berstatus `overdue`; status hanya berubah saat pembayaran. |
| **Penyortiran dibatasi 200 tagihan.** | Organisasi dengan lebih dari 200 tagihan bisa kehilangan tagihan tertua dari daftar. Batas ini diketahui, bukan tersembunyi. |
| **Tidak ada rekonsiliasi bank.** | Mutasi kas hanya yang dicatat lewat sistem; mutasi di luar sistem tidak ikut terverifikasi. |
| **`verifyBalance` hanya pemeriksaan.** | Ada perintah `verifyBalance` untuk mencocokkan saldo dengan penjumlahan mutasi. Kalau beda, itu **bug** — jangan "memperbaiki" dengan menyalin hasil hitung ke tabel, karena itu menutupi penyebabnya. |
| **Tidak ada integrasi BaturPay.** | Pembayaran dicatat manual oleh orang. Klaim chat tidak pernah otomatis dianggap pembayaran. |
| **Rekening kosong dihapus saat membuat rekening baru.** | Hanya rekening dengan saldo 0 dan tanpa mutasi. Rekening yang sudah punya riwayat tidak pernah dihapus. |

---

## 5. Yang belum terverifikasi

`tests/integration/finance-tools.test.ts` memakai provider WhatsApp tiruan.
Yang **terverifikasi sungguhan**: database, transaksi, RBAC, pemetaan error,
urutan tagihan.

Yang **belum terverifikasi**: pengiriman pesan keluar lewat soket WhatsApp asli
untuk alur keuangan, dan pengujian lewat nomor manusia yang mengetik "Rp 150.000"
dengan format yang tidak rapi.