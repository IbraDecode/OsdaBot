# Pengingat Terjadwal

Pengingat dikirim ke WhatsApp pada waktu tertentu. Yang penting bukan
pengingatnya bisa dikirim, tapi **tidak boleh hilang** dan **tidak boleh
terkirim dua kali**.

---

## 1. Database adalah sumber kebenaran, bukan Redis

Denah paling umum: jadwal disimpan di BullMQ (`delay`), worker memproses
ketika waktunya tiba. Itu kelihatan elegan, tapi:

| Kejadian | Akibatnya |
|---|---|
| Redis di-flush | Job hilang tanpa jejak. Tidak ada yang bisa ditanya "kenapa pengingat kemarin tidak masuk" |
| Worker restart dengan job tertunda | Job tertinggal di Redis, tidak ada yang memuat ulang |
| Deploy dengan versi berbeda | Job lama tidak cocok dengan handler baru |

Yang sekarang: setiap pengingat adalah baris `ScheduledJob` di PostgreSQL.
Worker **mengambil dari database** secara berkala.

- Redis mati → tidak ada yang terkirim, tapi tidak ada yang hilang.
- Worker restart → job dipungut lagi dari database.
- Redis di-flush → job tetap ada di database.

BullMQ (`src/queue/connection.ts`) tetap disiapkan untuk pekerjaan yang
benar-benar antrean — fan-out pekerjaan panjang — bukan untuk ketepatan waktu.

---

## 2. Koneksi Redis (untuk nanti)

Dua hal yang wajib, keduanya diminta BullMQ dan sering dilewatkan:

```ts
maxRetriesPerRequest: null   // BullMQ mensyaratkan ini
enableReadyCheck: false      // host managed sering tidak mendukung
```

`maxRetriesPerRequest` yang salah adalah jebakan yang **tidak menghasilkan
error yang terlihat**. BullMQ memakai ioredis yang sama untuk blocking command;
kalau blocking command gagal, worker berhenti memproses job. Job menumpuk,
tidak ada yang jalan, dan tidak ada yang mengetahuinya.

`enableReadyCheck` dimatikan karena Upstash lewat TLS sering tidak menjawab
`INFO` dengan benar saat handshake.

Koneksi blocking dibuat terpisah (`blockingConnection()`) karena kalau koneksi
utama ditutup, semua Queue dan Worker ikut mati.

---

## 3. Alur satu siklus

```
claimDue(now)
  ├─ Ambil SCHEDULED dengan scheduledAt <= now
  ├─ updateMany(id, status=SCHEDULED → RUNNING)   ← hanya satu worker menang
  ├─ Kalau telat > 10 menit → FAILED, jangan dikirim
  └─ Kembalikan job yang sah

worker.tick()
  ├─ Tanpa chatJid → fail, dilewati (error berulang tidak berguna)
  ├─ sendText()
  │    ├─ status 'failed' → fail() dan dicoba lagi   ← BUKAN success
  │    └─ selain itu      → complete()
  └─ Error exception → fail()
```

---

## 4. Keputusan yang dijaga

| Keputusan | Kenapa |
|---|---|
| `status: 'failed'` **tidak** dihitung sukses | Kalau dicatat `COMPLETED`, pengingat hilang selamanya tanpa pernah sampai ke penerima |
| Telat > 10 menit dibatalkan | Pengingat basi lebih buruk daripada tidak ada — penerima tidak tahu itu untuk acara yang sudah lewat |
| `updateMany` bersyarat `SCHEDULED` saat klaim | Dua worker mengambil job yang sama = pengingat terkirim dua kali |
| `fail()` mengembalikan ke `SCHEDULED` sampai `attempts` habis | Gagal sementara (jaringan) tidak boleh menghapus pengingat secara permanen |
| `cancel()` hanya untuk status `SCHEDULED` | Membatalkan yang sedang dikirim menghasilkan hasil yang ambigu |
| Granularitas idempotensi 1 menit | Perintah yang terkirim ulang karena timeout tidak menggandakan pengingat |

---

## 5. Idempotensi

```ts
buildIdempotencyKey({
  organizationId, chatJid, title, body, scheduledAt,
})
// → reminder:11111111:hsbj0:274c6e35af310
```

Hash isi + slot menit. Berbeda untuk organisasi, isi, dan slot waktu berbeda.

Sebutkan `organizationId` di dalam kunci: kalau tidak, satu organisasi bisa
memblokir pengingat organisasi lain dengan isi sama.

---

## 6. Perintah

```bash
pnpm osda reminder:list --slug=osis-sma-1
pnpm osda reminder:cancel --slug=osis-sma-1
pnpm osda reminder:tick              # jalankan worker sekali
```

`reminder:tick` berguna untuk menguji tanpa menunggu 15 menit, dan untuk
memastikan worker benar-benar terkoneksi.

---

## 7. Verifikasi

Dijalankan terhadap database Neon sungguhan:

```
SCHEDULED_COUNT : 3
CLAIMABLE      : 1        (satu job jatuh tempo, satu belum, satu basi)
JUDUL_DIKIRIM  : Latihan LKBB
STATUS_BASI    : FAILED   (telat 180 menit → dibatalkan)
STATUS_BELUM   : SCHEDULED
IDEMPOTENSI    : BERHASIL (tidak duplikat)
KLAIM_KEDUA    : 0        (job yang sama tidak bisa diklaim dua kali)
```

---

## 8. Yang belum ada

- **Tool untuk AI.** `CAPABILITIES` masih menandai "Jadwal & Pengingat" sebagai
  `planned`. Belum ada `reminder.create` / `reminder.cancel`.
- **Pengingat berulang** (harian, mingguan). Saat ini satu kali.
- **Peringatan lebih awal untuk pengingat yang akan datang** (misal 10 menit sebelum).
- **Belum diuji lewat WhatsApp nyata** — pairing masih terblokir `429
  rate-overlimit`. Yang sudah diuji: seluruh siklus lifecycle di database,
  termasuk kasus `sendText` mengembalikan `failed`.