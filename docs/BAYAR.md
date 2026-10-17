# Pembayaran BaturPay

Status: **IMPLEMENTED** · **TESTED** (727 test lulus, 0 gagal)

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
| `payment_send_qris` | `finance.read` | LOW | Tidak |

### `payment_send_qris` — kirim gambarnya, bukan cuma tautannya

Ditambahkan setelah pemakaian nyata: pengguna membuat QRIS, lalu bertanya
*"kasi gambar qrisnya"*, dan bot menjawab jujur bahwa gambarnya tidak ada.

Botnya **tidak berbohong**. Ia melaporkan tepat apa yang tool berikan. Yang tidak
lengkap adalah tool-nya:

1. `payment_check_status` dan `payment_list` mengembalikan status tapi **tidak
   mengembalikan `qrisUrl`** — padahal ada di `Payment.metadata`. Jawaban
   "mana linknya?" jadi "tidak ada".
2. `WhatsAppProvider.sendImage` sudah ada sejak awal dan **tidak pernah dipakai
   tool mana pun**. Jadi permintaan gambar tidak punya jalan sama sekali.

Keduanya diperbaiki. `qrisUrl` diturunkan dari `orderId` — deterministik, tanpa
perlu memanggil penyedia lagi — dan dikirim ke percakapan **asal** saja.

Tidak butuh persetujuan, dan itu disengaja: tujuannya hanya chat yang memintanya,
jadi tidak ada pihak ketiga yang terlibat. Berbeda dengan `document_send`, yang
bisa mengirim ke orang lain dan karena itu butuh persetujuan.

| Aturan | Kenapa |
|---|---|
| Tidak ada parameter `to` | QRIS menautkan orang ke tagihan tertentu. Meneruskannya ke nomor yang salah berarti orang yang salah bisa membayar tagihan yang bukan miliknya. Skema-nya `strict()`, jadi `to` di luar skema **ditolak**, bukan diabaikan diam-diam. |
| Order yang tidak ada → `NOT_FOUND` | Membuat order baru diam-diam menghasilkan dua permintaan transfer untuk satu tagihan, dan pengguna tidak tahu mana yang benar. |
| Mengirim gambar **tidak mengubah status** | Status hanya berubah lewat webhook penyedia. Kalau kirim gambar bisa mengubah status, bot bisa bilang "sudah bayar" tanpa satu rupiah pun masuk. |

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
| **`qris_url` tidak disimpan terpisah.** | Ambient-nya tersimpan di `Payment.metadata`; tidak ada endpoint untuk mengambil ulang QR dari sistem kita. Tautan tetap bisa dibentuk ulang dari `orderId`, tapi hanya untuk `baseUrl` yang sedang aktif — kalau penyedia pindah, tautan lama tidak ikut pindah. |
| **`payment_send_qris` hanya ke percakapan asal.** | Tidak bisa mengirim QRIS ke anggota tertentu. Untuk itu, `whatsapp_send_message` yang dipakai — dan itu butuh persetujuan. |
| **`capture` dari penyedia berarti BELUM lunas.** | `payment_check_status` melaporkan `capture` sebagai belum final. Kalau BaturPay pernah memakai `capture` untuk menandai pelunasan, bot akan terlihat salah sampai webhook diterima. |