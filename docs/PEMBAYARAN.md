# Pembayaran (BaturPay)

## Sumber kebenaran: dokumentasi resmi BaturPay

Dokumentasi diambil dari `https://baturpay.vercel.app/docs` dan
`openapi.yaml`. **Tidak ada endpoint, signature, atau autentikasi yang
dikarang.** Semua yang dipakai di sini terverifikasi dari dokumentasi.

```
Base URL : https://baturpay.vercel.app
Auth     : Authorization: Bearer bp_live_...
```

## Endpoint yang dipakai

| Method | Path | Kegunaan |
|---|---|---|
| `POST` | `/v1/charge` | Buat QRIS dinamis |
| `GET` | `/v1/transactions/:order_id` | Detail transaksi |
| `GET` | `/v1/transactions/:order_id/qr` | Gambar QR PNG (publik) |
| `GET` | `/v1/transactions/:order_id/events` | Timeline status |

## Status transaksi

| BaturPay | OSDABOT |
|---|---|
| `created`, `pending` | `PENDING` |
| `settlement`, `capture` | `SETTLED` |
| `expire` | `EXPIRED` |
| `cancel` | `CANCELLED` |
| `deny`, `chargeback` | `FAILED` |
| `refund`, `partial_refund` | `REFUNDED` |

Status terminal **tidak bisa diturunkan** oleh webhook berikutnya.

## Aturan yang tidak boleh dilanggar

### 1. `amount` adalah integer Rupiah

```prisma
amount Int   // 1 s.d. 10.000.000.000
```

Tidak ada sen, tidak ada float. Validasi dilakukan sebelum request:

```typescript
if (!Number.isInteger(input.amount) || input.amount <= 0) {
  return { error: 'Nominal harus bilangan bulat Rupiah lebih besar dari nol.', code: 'INVALID_AMOUNT' }
}
```

### 2. Status hanya berubah dari provider

> **"osda aku udah bayar kas"**

OSDABOT boleh memeriksa catatan pembayaran, tapi **tidak boleh** menyatakan
lunas. Klaim chat bukan bukti. Hanya webhook/polling provider yang terverifikasi
yang boleh mengubah `Payment.status` ke `SETTLED` dan mengisi `verifiedAt`.

### 3. `order_id` adalah idempotensi

BaturPay menolak duplikat dengan `409 ORDER_EXISTS`. Itu persis yang kita mau:

```typescript
order_id: `OSDA-${organizationId.slice(0, 8)}-${invoiceId.slice(0, 8)}`
```

Percobaan ulang dengan `order_id` sama tidak menghasilkan transaksi ganda.

### 4. Webhook diverifikasi dengan HMAC

Format dari dokumentasi:

```
x-baturpay-signature = hex(HMAC-SHA256(timestamp + "." + rawBody, secret))
x-baturpay-timestamp = epoch ms
```

Implementasi:

```typescript
export function verifyBaturPaySignature(
  rawBody: Buffer, timestamp: string, signature: string, secret: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest('hex')

  const provided = Buffer.from(signature, 'hex')
  const computed = Buffer.from(expected, 'hex')

  if (provided.length !== computed.length) return false
  return timingSafeEqual(provided, computed)
}
```

**Raw body wajib.** Kalau body di-parse lalu di-serialize ulang, byte-nya bisa
berbeda dan signature tidak akan cocok. `server.ts` memasang content-type parser
`parseAs: 'buffer'` untuk menyimpan byte asli.

Perbandingan `timingSafeEqual` mencegah serangan timing.

### 5. Webhook dobel tidak boleh berefek ganda

Setiap event dicatat dengan unik constraint:

```prisma
model PaymentTransaction {
  @@unique([provider, providerEventId])
}
```

Kalau webhook sama datang lagi, `create()` gagal dengan pelanggaran unique
constraint → dicatat sebagai `duplicate` dan diabaikan.

Event ID diturunkan dari kombinasi `order_id + status + timestamp` karena
BaturPay tidak mengirim ID eksplisit.

### 6. Kredensial tidak masuk log

- `Authorization` header tidak pernah di-log.
- Logger me-redact `apiKey`, `secret`, `webhookSecret`, `authorization`.
- `BATURPAY_API_KEY` dan `BATURPAY_WEBHOOK_SECRET` hanya dari environment.

Secret webhook **berbeda** dari server key Midtrans. Jangan dicampur.

## Endpoint webhook

```
POST /webhooks/baturpay
```

| Keadaan | Respons |
|---|---|
| Secret belum dikonfigurasi | `503 WEBHOOK_NOT_CONFIGURED` |
| Signature tidak cocok | `401 INVALID_SIGNATURE` |
| Berhasil diproses | `200 { ok: true, action: 'recorded' }` |
| Duplikat | `200 { ok: true, action: 'duplicate' }` |
| Order tidak dikenal | `200 { ok: true, action: 'not_found' }` |

Untuk `not_found`, webhook tetap dibalas 200 supaya BaturPay tidak mencoba
berulang-ulang.

## Model data

```
Payment {
  provider          PaymentProviderName   // BATURPAY | MOCK | MANUAL
  providerReference String?                // order_id BaturPay
  amount            Int
  status            PaymentStatus
  verifiedAt        DateTime?
  @@unique([provider, providerReference])
}

PaymentTransaction {                          // riwayat status
  paymentId       UUID
  status          PaymentStatus
  providerEventId String?
  @@unique([provider, providerEventId])       // ← anti webhook dobel
}
```

## Konfigurasi

```bash
BATURPAY_API_KEY="bp_live_..."
BATURPAY_BASE_URL="https://baturpay.vercel.app"
BATURPAY_WEBHOOK_SECRET="..."
```

API key & webhook secret **wajib diisi berdua**. Kalau hanya satu yang terisi,
aplikasi gagal saat boot — konfigurasi setengah jadi lebih berbahaya daripada
tidak terkonfigurasi.

## Status integrasi

| Aspek | Status |
|---|---|
| Dokumentasi API | ✅ Terverifikasi dari sumber resmi |
| Adapter create charge | ✅ Terimplementasi |
| Verifikasi signature | ✅ Terimplementasi + teruji |
| Idempotensi webhook | ✅ Terimplementasi |
| Finance engine (kas, invoice) | ❌ Belum ada |
| Pengujian live dengan key asli | ❌ Belum dilakukan |
| Finance tool untuk agent | ❌ Belum ada |

Adapter-nya ada dan logikanya terverifikasi terhadap dokumentasi, tapi **belum
diuji dengan transaksi sungguhan**. Jangan menyebutnya "terintegrasi" sebelum
itu terjadi.

## Testing

```bash
# Verifikasi signature (tidak butuh jaringan)
pnpm exec vitest run tests/unit/server.test.ts
```

Belum ada test live BaturPay. Alasan: tidak ada key mode sandbox yang bisa
dipakai di lingkungan build, dan transaksi sungguhan tidak boleh dibuat untuk
testing.