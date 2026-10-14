# Outbox — Event yang Tidak Boleh Hilang

Dispatcher event yang ditulis **di dalam transaksi** yang sama dengan perubahan
bisnis. Kalau transaksinya commit, event-nya pasti ada. Kalau rollback, event-nya
juga tidak ada. Tidak ada celah di antaranya.

Modul ini sudah berfungsi dan teruji, tapi **belum ada yang menulis event ke
outbox**. `AttendanceService` dan tool lain masih mengirim langsung.

---

## 1. Masalah yang dipecahkan

Event yang dibuat di luar tabel pengirim punya dua kemungkinan buruk:

| Denah | Kalau proses mati di tengah |
|---|---|
| Tulis event dulu, kirim setelahnya | Event hilang selamanya |
| Kirim dulu, tulis event setelahnya | Pesan terkirim tapi tidak tercatat |

Di kedua kasus, tidak ada yang bisa menjawab "apakah ini sudah terkirim?".

Polanya:

```
await prisma.$transaction(async (tx) => {
  await tx.attendanceEntry.create(...)
  await new OutboxWriter(tx).emit({ topic: 'attendance.notify', payload: {...} })
})
```

Commit → perubahan DAN event ada. Rollback → keduanya tidak ada.

---

## 2. Yang paling penting: status `unknown`

`DeliveryStatus` di schema punya nilai `UNKNOWN` dengan peringatan:

> *"WAJIB direkonsiliasi sebelum retry — jangan diasumsikan gagal."*

`unknown` berarti timeout lalu proses mati. Pesan **mungkin sudah terkirim**.

Mengirim ulang tanpa rekonsiliasi berarti penerima bisa menerima pesan yang
sama dua kali. Untuk pengumuman organisasi, itu tidak bisa diterima.

### Pemetaan status provider

| Status provider | Hasil dispatch | Efek |
|---|---|---|
| `delivered` | `delivered` | selesai |
| `provider_accepted` | `accepted` | selesai dari sisi outbox; status akhir ada di `MessageDelivery` |
| `failed` | `failed` | aman di-retry |
| `unknown` | `unknown` | **tidak di-retry** |
| `pending` | `unknown` | **tidak di-retry** |
| `sending` | `unknown` | **tidak di-retry** |

Hanya `failed` yang di-retry. Semua yang tidak pasti menjadi `UNKNOWN`.

---

## 3. Pemulihan event yang menggantung

Event yang tersisa di `SENDING` berarti proses mati saat sedang mengirim.

`OutboxEvent` **tidak punya** kolom `updatedAt`, jadi tidak ada cara tahu kapan
event terakhir disentuh. Sebagai gantinya, `availableAt` dipakai sebagai
**lease**:

- Saat event diklaim, `availableAt` diset ke `now + 5 menit`.
- Kalau masih `SENDING` setelah lease habis, prosesnya pasti mati.

Pemulihan memindahkannya ke `UNKNOWN` — **bukan** mengirim ulang. Hasilnya tidak
diketahui, dan itu memang tidak diketahui.

Dijalankan sekali saat worker start.

---

## 4. Topik tanpa handler

Event untuk topik yang tidak ada handler-nya:

- **Tidak di-drop** — kalau di-drop, event hilang.
- **Tidak langsung `FAILED`** — itu akan tersembunyi di antara event lain yang
  gagal.
- Ditunda 10 menit dengan pesan jelas, lalu dicoba lagi.

Handler yang sama untuk topik yang sama ditolak saat registrasi — registry
diam-diam menimpa handler adalah cara yang bagus untuk mencari bug.

---

## 5. Retry

| Keadaan | Aksi |
|---|---|
| Handler melempar error | Retry dengan backoff eksponensial |
| `outcome: 'failed'` | Retry dengan backoff eksponensial |
| Melebihi `MAX_ATTEMPTS` (5) | `FAILED` — **tidak dihapus**, bisa diperiksa |
| `outcome: 'unknown'` | `UNKNOWN` — **tidak pernah di-retry** |

Backoff: 30 detik, 60, 120, ... dibatasi 1 jam.

---

## 6. Perintah

```bash
pnpm osda outbox:list     # event yang perlu rekonsiliasi manusia
pnpm osda outbox:tick     # jalankan dispatcher sekali
```

`outbox:list` menampilkan event `UNKNOWN` dan `FAILED` beserta alasannya.
`UNKNOWN` = mungkin sudah terkirim, jangan dikirim ulang tanpa dicek.

---

## 7. Verifikasi

Dijalankan terhadap database Neon sungguhan:

```
EVENT DITULIS    : 3a131e5c-... (ditulis DALAM transaksi)
STATUS           : PENDING

HASIL delivered -> terkirim=2  status=DELIVERED
HASIL failed    -> gagal=1     status=PENDING     (retry dengan backoff)
HASIL unknown   -> unknown=1   status=UNKNOWN     ← tidak di-retry
HASIL noHandler -> tanpaHandler=1  status=PENDING  ← tidak di-drop

SETELAH UNKNOWN : diproses ulang = 0   ← bukti tidak masuk retry
STATUS MASIH    : UNKNOWN
```

---

## 8. Yang belum ada

- **Belum ada yang menulis event.** Semua pengiriman masih langsung.
- **Belum ada rekonsiliasi manual.** `outbox:list` menampilkan, tapi tidak ada
  perintah untuk menandai `UNKNOWN` sebagai sudah dicek atau belum.
- **Belum ada handler di luar `whatsapp.message.send`.** Topik `attendance.notify`
  sudah didefinisikan tapi belum ada implementasinya.
- **Belum diuji lewat WhatsApp nyata** — pairing masih terblokir 429. Yang sudah
  diuji: seluruh siklus lifecycle di database, termasuk kasus `unknown` dan
  pemulihan event `SENDING` yang menggantung.