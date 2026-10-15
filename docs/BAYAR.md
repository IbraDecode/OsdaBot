# Pembayaran BaturPay

Status: **IMPLEMENTED** · **TESTED** (583 test lulus, 0 gagal)

Semua endpoint, nama field, rentang nilai, dan status diambil dari dokumentasi
resmi BaturPay (`baturpay.vercel.app/docs`). Tidak ada yang dikarang.

---

## 1. Fakta yang dipakai

| Hal | Nilai |
|---|---|
| Base URL | `https://baturpay.vercel.app` |
| Auth | `Authorization: Bearer bp_live_…` |
| Buat QRIS | `POST /v1/charge` |
| Detail | `GET /v1/transactions/:order_id` |
| QR PNG | `GET /v1/transactions/:order_id/qr` (publik) |
| Status | `created · pending · settlement · capture · expire · cancel · deny · refund · partial_refund · chargeback` |
| Error | `{ "error": { "code", "message" } }` |
| Webhook | header `x-baturpay-signature` = hex(HMAC-SHA256(`ts + "." + rawBody`, secret)) |

`amount`: integer Rupiah 1 – 10.000.000.000. `expiry_minutes`: 1 – 1440.
`order_id` unik per akun — duplikat ditolak `409 ORDER_EXISTS`.

---

## 2. Tiga bug uang yang ditemukan di kode yang sudah ada

Adapter ini sudah ada sebelumnya tapi **tidak terpasang di bootstrap dan nol test**.
Membaca ulang terhadap dokumentasi menemukan tiga masalah.

### Bug 1: `capture` dipetakan ke `SETTLED`

Dokumentasi BaturPay:

> `capture` — Berhasil tapi belum final (mid transit — akan jadi `settlement`)

Efeknya `verifiedAt` terisi untuk uang yang **belum final**. Kalau ternyata
sengketa, buku kas sudah mencatat uang yang tidak pernah masuk.

Diperbaiki → `PENDING`. Kurang mencatat bisa diperbaiki manual; lebih mencatat
berarti kas fisik tidak cocok dengan buku.

Ada test lama yang **mengunci perilaku salah ini** (`tests/unit/server.test.ts`) —
perlu diperbarui, bukan hanya kodenya.

### Bug 2: nominal webhook tidak pernah diperiksa

Webhook membawa `amount`. Kode mengabaikannya sepenuhnya — jadi webhook dengan
nominal keliru akan menandai `SETTLED` untuk uang yang tidak pernah masuk.

BaturPay sendiri melakukan pemeriksaan ini pada webhook masuknya
(`AMOUNT_MISMATCH`). Satu-satunya pemeriksaan itu hilang.

Ditambahkan: nominal yang berbeda → `amount_mismatch`, pembayaran **tidak**
diubah.

### Bug 3: refund setelah lunas DIABAIKAN

```ts
if (TERMINAL_STATUSES.has(payment.status) && payment.status !== status)
  return { action: 'ignored' }
```

`SETTLED` termasuk terminal. Jadi `settlement` → `refund` diabaikan.

Uang yang kembali adalah peristiwa uang yang nyata. Mengabaikannya membuat buku
kas menampilkan uang yang **sudah tidak ada** milik organisasi.

Diperbaiki: refund/chargeback setelah lunas **diterima**, dan `verifiedAt`
dikosongkan. Yang tetap ditolak adalah status final yang **turun** ke non-terminal
(mis. webhook lama `pending` yang datang setelah `settlement`).

---

## 3. Yang dijaga

1. **Klaim chat bukan pembayaran.** Tidak ada tool yang menerima "sudah bayar".
   Satu-satunya jalan menuju `SETTLED` adalah webhook yang signature-nya
   terverifikasi. Kalau bisa dicatat dari chat, siapa pun bisa menandai iuran
   lunas tanpa membayar.

2. **Webhook idempoten.** Dokumentasi BaturPay: retry sampai 5 kali dengan
   backoff eksponensial. Event yang sama menghasilkan `providerEventId` yang
   sama, dan unique constraint `(provider, providerEventId)` menolaknya — jadi
   satu pembayaran tetap satu mutasi.

3. **Signature diverifikasi atas RAW BODY.** Kalau body di-parse lalu
   di-serialize ulang, byte bisa berbeda dan HMAC gagal — atau lebih buruk,
   lolos karena encoding berbeda. Raw body ditangkap di content parser Fastify.

4. **Timestamp ikut ditandatangani.** Kalau tidak, webhook lama bisa diputar
   ulang.

5. **Nominal melebihi sisa tagihan ditolak.** QRIS untuk nominal lebih besar dari
   tagihan menghasilkan selisih yang harus ditanyakan.

6. **`payment_create_charge` butuh persetujuan.** Mengirim QRIS adalah tindakan
   yang terlihat dan mendorong orang transfer.

---

## 4. Tool

| Tool | Izin | Risiko | Persetujuan |
|---|---|---|---|
| `payment_create_charge` | `finance.create` | MEDIUM | **Ya** |
| `payment_check_status` | `finance.read` | LOW | Tidak |
| `payment_list` | `finance.read` | LOW | Tidak |

Setiap hasil status mengembalikan field `interpretation` — kalimat yang sudah
aman untuk disampaikan ke pengguna. Diberikan eksplisit supaya model tidak
menebak: `PENDING` bisa berarti "sudah dibayar tapi belum dikonfirmasi" atau
"belum dibayar sama sekali".

---

## 5. Test

`tests/integration/payments.test.ts` — 24 test. Semua terhadap database
sungguhan.

Regresi diverifikasi dengan mematikan perbaikannya:

| Yang dimatikan | Hasil |
|---|---|
| Izinkan refund setelah lunas | `expected 'ignored' to be 'recorded'` |
| Verifikasi nominal | `expected 'recorded' to be 'amount_mismatch'` |
| `capture` bukan final | `expected 'SETTLED' not to be 'SETTLED'` |

Lainnya: nominal pecahan ditolak tanpa menyentuh jaringan; `expiry_minutes`
di luar 1–1440 ditolak; `409 ORDER_EXISTS` diteruskan tanpa mencoba lagi; API
key tidak bocor ke pesan error; signature palsu ditolak; body yang diubah
sedikit langsung gagal; timestamp yang diganti gagal.

---

## 6. Batas yang diketahui

| Batas | Dampak |
|---|---|
| **Belum pernah diuji live ke BaturPay.** | Semua test memakai fetch tiruan. Tidak ada transaksi sungguhan yang pernah dibuat. |
| **Webhook di localhost tidak terkirim.** | `defaultWebhookUrl()` mengembalikan kosong untuk host lokal — benar (verifikasi signature butuh secret dan host yang terjangkau), tapi berarti alur webhook hanya bisa diuji di server sungguhan. |
| **Tidak ada pembatalan atau refund.** | Harus lewat dashboard BaturPay. |
| **Tidak ada rekonsiliasi otomatis.** | Pembayaran di luar sistem tetap tidak terlihat. |
| **`verifiedAt` tidak pernah diisi provisioning.** | Nomor env adalah klaim, bukan bukti — tidak berubah. |
| **`qris_url` tidak disimpan terpisah.** | Ambient-nya tersimpan di `Payment.metadata`; tidak ada endpoint untuk mengambil ulang QR dari sistem kita. |