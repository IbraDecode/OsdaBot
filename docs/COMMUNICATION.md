# Komunikasi & Notifikasi (Communication)

Acuan kode: `packages/db/src/schema/system.ts`,
`packages/notifications/src/penyedia.ts`,
`apps/api/src/modules/communications/communications.service.ts`, dan
`apps/api/src/modules/notifications/notifications.service.ts`.

Modul ini melayani kebutuhan Humas (`PR`) untuk menyampaikan informasi ke anggota melalui
beberapa kanal sekaligus, sekaligus mencatat status pengirimannya.

---

## 1. Pengumuman

Tabel `announcements`:

| Kolom | Keterangan |
|---|---|
| `judul`, `isi` | Isi pengumuman. |
| `ringkasan` | Cuplikan ~160 karakter untuk daftar & pratinjau WhatsApp. |
| `audiens` | `ALL`, `BOARD`, `DIVISION`, `EVENT`, `CUSTOM`. |
| `division_ids[]`, `jabatan_ids[]`, `member_ids[]` | Penyaring audiens detail. Dipakai bila `audiens` = `DIVISION` atau `CUSTOM`. |
| `kanal[]` | Daftar kanal pengiriman: `WEB`, `MOBILE`, `WHATSAPP`, `EMAIL`. |
| `prioritas` | `LOW`, `NORMAL`, `HIGH`, `CRITICAL`. |
| `status` | `DRAFT`, `REVIEW`, `APPROVED`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED`. |
| `pin` | Disematkan di daftar. |
| `perlu_persetujuan` | Bawaan `true`. |
| `idempotency_key` | Mencegah scheduler mengirim dua kali. |
| `lampiran_dokumen_ids[]` | Lampiran (metadata dokumen). |
| `tanggal_terbit` | Tanggal terbit efektif. |
| `jadwalkan_pada`, `terbit_pada` | Jadwal & waktu terbit sebenarnya (timestamp dengan zona waktu). |
| `total_penerima`, `total_terkirim`, `total_terbaca`, `total_gagal` | Denormalisasi hasil pengiriman. |
| `disetujui_oleh`, `disetujui_pada`, `alasan_penolakan` | Alur persetujuan. |
| `program_id`, `event_id` | Konteks kegiatan. |

Pencarian memakai index GIN `ix_announcements_fts`:

```sql
CREATE INDEX IF NOT EXISTS ix_announcements_fts
  ON announcements USING GIN (to_tsvector('simple', coalesce(judul, '') || ' ' || coalesce(isi, '')));
```

---

## 2. Audiens

Kombinasi `audiens` + kolom penyaring menentukan siapa yang menerima:

| `audiens` | Resolusi penerima |
|---|---|
| `ALL` | Seluruh anggota aktif organisasi. |
| `BOARD` | Anggota dengan jabatan tingkat `BOARD`. |
| `DIVISION` | Anggota yang `division_id`-nya ada di `division_ids[]`. |
| `EVENT` | Peserta/panitia acara pada `event_id`. |
| `CUSTOM` | Anggota pada `member_ids[]`, ditambah penyaring `division_ids[]`/`jabatan_ids[]`. |

Resolusi dilakukan sekali saat pengumuman diterbitkan, lalu hasilnya disimpan ke
`announcement_recipients` — sehingga pengumuman yang sudah terbit punya daftar penerima
yang pasti dan tidak berubah bila keanggotaan berubah.

---

## 3. Alur Status Pengumuman

```
DRAFT ──(ajukan)──> REVIEW ──(setujui)──> APPROVED ──(jadwalkan)──> SCHEDULED
  │                                      │                              │
  │                                      │                              │ terbit
  │                                      │                              ▼
  │                                      └──(terbit langsung)──> PUBLISHED
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
                                                                    (arsipkan)
                                                                        ▼
                                                                   ARCHIVED
```

Aturan:

- Dibuat dengan status `DRAFT` (`POST /api/v1/announcements`, izin `communication.create`).
- Persetujuan: `POST /api/v1/announcements/:id/approve` (izin `communication.publish`).
- Terbit: `POST /api/v1/announcements/:id/publish` (izin `communication.publish`).
- Bila `jadwalkan_pada` diisi dan belum tiba, status menjadi `SCHEDULED`; scheduler
  menerbitkannya ketika waktunya tiba.
- `ARCHIVED` adalah status akhir; pengumuman yang diarsipkan tidak dikirim lagi.
- Bila `perlu_persetujuan = false`, alur `DRAFT → PUBLISHED` diperbolehkan tanpa tahap
  `APPROVED`. Pastikan service Anda memeriksa kolom ini alih-alih mengasumsikan alur panjang.

Peran: `PR` memegang `communication.create` **dan** `communication.publish`.
`VICE_CHAIRPERSON` dan `STAFF` hanya punya `create` — mereka bisa menyusun draf tetapi
tidak bisa menerbitkan.

---

## 4. Kanal

Enum `kanal`: `WEB`, `MOBILE`, `WHATSAPP`, `EMAIL`. Satu pengumuman bisa dikirim ke
beberapa kanal sekaligus karena `kanal` adalah array.

| Kanal | Penyedia | Catatan |
|---|---|---|
| `WEB` | Tampilan web / notifikasi in-app | Ditulis ke `notifications`. |
| `MOBILE` | Push notification | Lewat `notification_deliveries.metode = PUSH`. |
| `WHATSAPP` | `PenyediaWhatsapp` di `packages/notifications` | Menggunakan konfigurasi integrasi `WHATSAPP`. |
| `EMAIL` | `PenyediaEmail` — **stub** | Mengembalikan `berhasil: false`, `pesanGalat: 'Penyedia email belum dikonfigurasi.'`. Implementasi SMTP direncanakan di worker terpisah. |

`MesinNotifikasi` mengirim ke beberapa kanal dan **kegagalan satu kanal tidak menggagalkan
kanal lain** — inilah yang membuat inti sistem tetap bekerja walau WhatsApp mati.

---

## 5. Pelacakan Pengiriman

Tabel `announcement_recipients` — satu baris per (pengumuman, anggota, kanal):

| Kolom | Keterangan |
|---|---|
| `status` | `PENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`. |
| `percobaan` | Jumlah percobaan. |
| `pesan_galat` | Pesan galat bila `FAILED`. |
| `pesan_id` | ID pesan di provider (mis. ID pesan WhatsApp). |
| `dikirim_pada`, `diterima_pada`, `dibaca_pada` | Cap waktu. |
| `dedup_key` | **Anti-spam:** pesan identik tidak dikirim dua kali dalam 24 jam. |

Unik: `uq_penerima_kanal` `(announcement_id, member_id, kanal)`.
Index: `ix_penerima_status`, `ix_penerima_member`.

Statistik pada `announcements` (`total_penerima`, `total_terkirim`, `total_terbaca`,
`total_gagal`) diperbarui dari baris penerima — jangan mengubah angkanya manual.

Endpoint statistik: `GET /api/v1/communications/stats`.

---

## 6. Notifikasi In-App

Tabel `notifications` bersifat **per pengguna** (bukan per anggota):

| Kolom | Keterangan |
|---|---|
| `user_id` | Penerima (referensi `users`, `cascade`). |
| `member_id` | Alias member agar pencarian mudah. |
| `jenis` | `ATTENDANCE`, `TASK`, `MEETING`, `PROGRAM`, `FINANCE`, `APPROVAL`, `ANNOUNCEMENT`, `SYSTEM`. |
| `prioritas` | `LOW`, `NORMAL`, `HIGH`, `CRITICAL`. |
| `judul`, `isi` | Isi notifikasi. |
| `entitas_jenis`, `entitas_id` | Objek pemicu, mis. `{ jenis: 'TASK', id: '…' }`. |
| `actions` (jsonb) | Tombol aksi berupa tautan dalam ke Web/Mobile. |
| `dedup_key` | Unik `(user_id, dedup_key)` lewat `uq_notif_dedup` — mencegah notifikasi ganda. |
| `dibaca_pada`, `kedaluwarsa_pada` | Status baca & pembersihan otomatis. |

Endpoint:

| Metode | Jalur | Izin |
|---|---|---|
| `GET` | `/api/v1/notifications` | login (hanya milik sendiri) |
| `GET` | `/api/v1/notifications/ringkasan` | login |
| `POST` | `/api/v1/notifications/:id/read` | login |
| `POST` | `/api/v1/notifications/read-all` | login |

Modul ini tidak memakai izin `notification.read`; pembatasannya adalah kepemilikan baris.
Selalu filter `user_id` = pengguna yang login.

---

## 7. Outbox: `notification_deliveries`

Pola **outbox** memastikan notifikasi tidak hilang:

1. Dalam satu transaksi database, perubahan bisnis ditulis **bersamaan** dengan baris
   `notification_deliveries`.
2. Worker mengirimkan baris berstatus `PENDING` sesuai `jadwalkan_pada`.
3. Kegagalan pengiriman dapat diulang dengan aman karena `job_key` unik.

| Kolom | Keterangan |
|---|---|
| `notification_id`, `announcement_id` | Sumber (notifikasi atau pengumuman). |
| `user_id`, `member_id` | Penerima. |
| `metode` | `IN_APP`, `PUSH`, `WHATSAPP`, `EMAIL`. |
| `kanal` | `WEB`, `MOBILE`, `WHATSAPP`, `EMAIL`. |
| `status`, `percobaan`, `pesan_galat`, `pesan_id` | Status pengiriman. |
| `job_key` | **Unik** (`uq_delivery_job`) — kunci job worker, sumber idempotensi. |
| `jadwalkan_pada`, `dikirim_pada` | Waktu. |

Manfaat outbox menurut komentar skema:

- tidak ada notifikasi hilang bila integrasi gagal;
- pengiriman dapat diulang dengan aman.

Antrean memakai fallback in-process bila `REDIS_URL` kosong (lihat `.env.example`).

---

## 8. Kampanye

Tabel `campaigns` mengelompokkan beberapa pengumuman dalam satu rangkaian:

| Kolom | Keterangan |
|---|---|
| `nama`, `deskripsi` | Identitas kampanye. |
| `mulai_pada`, `selesai_pada` | Rentang waktu. |
| `status` | `PLANNED`, `ACTIVE`, `COMPLETED`, `CANCELLED` (bawaan `PLANNED`). |
| `announcement_ids[]` | Pengumuman yang terkait. |
| `budget` | Anggaran promosi (opsional). |
| `program_id`, `event_id` | Konteks kegiatan. |

Endpoint: `GET /api/v1/campaigns` (login), `POST /api/v1/campaigns`
(izin `communication.create`).

---

## 9. Ringkasan Endpoint

| Metode | Jalur | Izin |
|---|---|---|
| `GET` | `/api/v1/announcements` | `communication.create` |
| `GET` | `/api/v1/announcements/:id` | `communication.create` |
| `POST` | `/api/v1/announcements` | `communication.create` |
| `POST` | `/api/v1/announcements/:id/approve` | `communication.publish` |
| `POST` | `/api/v1/announcements/:id/publish` | `communication.publish` |
| `GET` | `/api/v1/campaigns` | login |
| `POST` | `/api/v1/campaigns` | `communication.create` |
| `GET` | `/api/v1/communications/stats` | login |
| `GET` | `/api/v1/notifications` | login |
| `GET` | `/api/v1/notifications/ringkasan` | login |
| `POST` | `/api/v1/notifications/:id/read` | login |
| `POST` | `/api/v1/notifications/read-all` | login |

---

## Catatan untuk AI agent

1. Status pengumuman punya enam nilai (`DRAFT` → `ARCHIVED`), **bukan** empat seperti
   dokumen. Jangan menyamakan `status_dokumen` dengan `status_komunikasi`.
2. Selalu tulis baris `notification_deliveries` dalam transaksi yang sama dengan
   perubahan bisnis. Jangan mengirim notifikasi langsung dari controller — itu yang
   membuat notifikasi hilang saat proses mati di tengah.
3. `PenyediaEmail` masih stub. Bila fitur Anda menuntut email, tambahkan penyedia baru di
   `packages/notifications/src/penyedia.ts` dan konfigurasi SMTP, jangan memanggil SMTP
   langsung dari service.
4. `announcement_recipients.dedup_key` adalah mekanisme anti-spam (24 jam). Jangan
   menghapusnya demi "memastikan pesan terkirim" — gunakan `percobaan` sebagai gantinya.
5. `notifications` tidak diberi guard izin karena milik pengguna. Bila Anda menambahkan
   endpoint yang menampilkan notifikasi orang lain (mis. admin), tambahkan pemeriksaan
   izin eksplisit di service.
