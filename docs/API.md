# API OSDA

Seluruh endpoint berada di bawah prefiks `/api/v1`, kecuali rute kesehatan
(`/health/live`, `/health/ready`) dan dokumentasi (`/api/docs`, `/api/docs-json`).
Aplikasi dibangun dengan NestJS 11 di atas Fastify 5 — lihat
`apps/api/src/bootstrap.ts`.

---

## 1. Aturan Umum

### Header yang wajib dikirim

| Header | Nilai | Keterangan |
|---|---|---|
| `Authorization` | `Bearer <access_token>` | Wajib untuk semua endpoint kecuali yang bertanda `@Publik()`. |
| `x-organization-id` | UUID organisasi | Menentukan organisasi aktif. Bila kosong, dipakai organisasi pertama milik pengguna (`OrganizationGuard`). |
| `x-request-id` | string ≤ 64 karakter | Opsional. Bila tidak ada, API membuat sendiri. Nilai ini dikembalikan pada setiap galat dan dicatat di `audit_logs.request_id`. |
| `Idempotency-Key` | string | Untuk operasi tulis bernominal (pembayaran, transaksi, absensi). Bila tidak diberikan, service biasa membuat sendiri — periksa tiap modul. |
| `Content-Type` | `application/json` | Kecuali unggah berkas (multipart). |

### Bentuk sukses & galat

Sukses mengembalikan objek langsung, atau pembungkus daftar (lihat bagian 2).
**Setiap galat**, apa pun penyebabnya, dibentuk oleh `HttpExceptionFilter`
(`apps/api/src/common/filters/http-exception.filter.ts`):

```json
{
  "error": {
    "code": "SESSION_CLOSED",
    "message": "Sesi absensi sudah ditutup.",
    "requestId": "a1b2c3d4e5f6",
    "detail": null
  }
}
```

Kode error didefinisikan di `packages/contracts/src/common.ts` (`KODE_ERROR`) dan
dipetakan ke status HTTP:

| Kode | HTTP | Kapan muncul |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Skema Zod menolak masukan. `detail` berisi `path`, `kode`, `pesan` per isu. |
| `INVALID_STATE_TRANSITION` | 409 | Transisi status tidak sah (mis. `DONE → TODO`). |
| `DUPLICATE_RECORD` | 409 | Data kembar. |
| `UNAUTHENTICATED` | 401 | Token tidak ada / tidak sah. |
| `INVALID_CREDENTIALS` | 401 | Email atau sandi salah saat login. |
| `TOKEN_EXPIRED` | 401 | Token akses kedaluwarsa. |
| `FORBIDDEN` / `PERMISSION_DENIED` | 403 | Izin kurang. Pesan menyebut izin mana yang dibutuhkan. |
| `OBJECT_ACCESS_DENIED` / `SCOPE_DENIED` | 403 | Objek di luar cakupan (mis. divisi lain). |
| `NOT_FOUND` | 404 | Entitas tidak ada (termasuk JID WhatsApp yang belum terdaftar). |
| `CONFLICT` | 409 | Bentrok umum. |
| `ATTENDANCE_ALREADY_RECORDED` | 409 | Anggota sudah absen di sesi itu. |
| `SESSION_CLOSED` / `SESSION_NOT_OPEN` | 409 | Sesi absensi belum dibuka atau sudah ditutup. |
| `APPROVAL_ALREADY_RESOLVED` | 409 | Persetujuan sudah diputuskan. |
| `DOCUMENT_VERSION_IMMUTABLE` | 409 | Versi dokumen sudah dikunci. |
| `LEDGER_IMMUTABLE` | 409 | Upaya mengubah entri ledger. |
| `RATE_LIMITED` | 429 | Melewati batas permintaan (`RATE_LIMIT_PER_MINUTE`). |
| `PAYLOAD_TOO_LARGE` | 413 | Badan permintaan > 2 MB (unggah berkas pakai multipart). |
| `UNSUPPORTED_FILE_TYPE` | 415 | MIME tidak diizinkan. |
| `INTEGRATION_UNAVAILABLE` | 503 | Penyedia eksternal (WhatsApp, pembayaran, storage) tidak siap. |
| `STORAGE_UNAVAILABLE` | 503 | Object storage gagal. |
| `INTERNAL_ERROR` | 500 | Kegagalan tak terduga. Pesan asli driver database **tidak pernah** bocor ke klien. |

---

## 2. Pagination, Filter, Sorting

### Pagination berbasis halaman (default)

Skema `SkemaPaginasi` (`packages/contracts/src/common.ts`):

```
GET /api/v1/members?page=2&limit=50
```

Respons selalu berbentuk `HasilDaftar<T>`:

```json
{
  "data": [ … ],
  "meta": { "page": 2, "limit": 50, "total": 137, "totalPages": 3, "hasNext": true, "hasPrev": true }
}
```

`limit` dibatasi 1–100 (default 20). Helper `bungkusDaftar` / `bungkusHasil` dan
`offsetDari` ada di `apps/api/src/common/utilitas/paginasi.ts` — **selalu** pakai helper itu
agar bentuk respons konsisten.

### Pagination berbasis kursor (daftar besar)

Untuk daftar yang sangat panjang (audit log, ledger), tersedia `SkemaKursor`:

```
GET /api/v1/audit/logs?cursor=<nilai>&limit=100
```

Respons:

```json
{ "data": [ … ], "meta": { "nextCursor": "…", "hasNext": true } }
```

Batas `limit` untuk kursor adalah 1–200 (default 50).

### Filter & pengurutan

Parameter pengurutan memakai `SkemaUrut` (`sortBy`, `sortDir: 'asc' | 'desc'`).
`sortBy` **selalu diperiksa terhadap daftar kolom yang diizinkan di server** — string
dari klien tidak pernah ditempelkan langsung ke SQL. Filter khusus tiap modul memakai
skema terpisah, misalnya:

- `SkemaFilterSesi` — daftar sesi absensi (`jenis`, `status`, `dari`, `sampai`).
- `SkemaKueriNotifikasi` — daftar notifikasi pengguna.
- `SkemaRentangTanggal` — filter `dari`/`sampai` dengan format `YYYY-MM-DD`.

Validasi memakai `ValidationPipe` Zod dengan `whitelist: true` dan
`forbidNonWhitelisted: true` — **field asing akan ditolak**, bukan diabaikan.

---

## 3. Auth

`apps/api/src/modules/auth/auth.controller.ts` — prefiks `api/v1/auth`.

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | publik | Masuk dengan email & sandi. Mengembalikan `HasilMasuk` (akses token, refresh token, masa berlaku). |
| `POST` | `/api/v1/auth/refresh` | publik | Menukar refresh token dengan pasangan token baru (rotasi). |
| `POST` | `/api/v1/auth/logout` | login | Mencabut sesi aktif. `{ semuaSesi: true }` mencabut semua sesi. |
| `POST` | `/api/v1/auth/whatsapp/exchange` | publik | Menukar kode account linking WhatsApp menjadi JWT. |

Endpoint publik ditandai dekorator `@Publik()` dan tetap dibatasi rate limit. Bot
WhatsApp memakai endpoint resolusi identitas (lihat `WHATSAPP.md`) agar bisa mengenali
anggota tanpa tahu apa pun tentang database.

---

## 4. Users & Profil

`apps/api/src/modules/users/users.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/users/me` | login | Profil sendiri beserta izin efektif (`perms`, `scopes`, `roles`, `org`). |
| `PATCH` | `/api/v1/users/me` | login | Ubah profil & preferensi notifikasi milik sendiri. |
| `GET` | `/api/v1/users/me/dashboard` | login | Dasbor sesuai peran (bentuk respons bergantung peran). |

Respons `GET /me` adalah acuan resmi untuk klien yang ingin menyusun sidebar:
`perms` adalah daftar izin, `scopes` adalah daftar cakupan.

---

## 5. Members

`apps/api/src/modules/members/members.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/members` | `member.read` | Daftar anggota, mendukung `page`, `limit`, `sortBy`, `sortDir`, filter status/divisi. |
| `GET` | `/api/v1/members/:id` | `member.read` | Detail satu anggota. |
| `POST` | `/api/v1/members` | `member.write` | Tambah anggota. |
| `PATCH` | `/api/v1/members/:id` | `member.write` | Ubah data anggota. |
| `DELETE` | `/api/v1/members/:id` | `member.archive` | **Arsipkan**, bukan hapus. Mengharuskan `alasan` minimal 3 karakter (`SkemaAlasanArsip`). |
| `GET` | `/api/v1/members/:id/attendance-recap` | `member.read` | Rekap kehadiran satu anggota. |

Catatan: `members.nomor` dibuat manusiawi (`M-0001`); klien tidak boleh mengirimnya
bebas bila service sudah punya pembangkit kode.

---

## 6. Attendance

`apps/api/src/modules/attendance/attendance.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/attendance/sessions` | `attendance.read` | Daftar sesi (`SkemaFilterSesi`). |
| `POST` | `/api/v1/attendance/sessions` | `attendance.manage` | Buat sesi baru. |
| `POST` | `/api/v1/attendance/sessions/:id/buka` | `attendance.manage` | Buka sesi & terbitkan token QR. |
| `POST` | `/api/v1/attendance/sessions/:id/tutup` | `attendance.manage` | Tutup sesi & hitung rekap. |
| `GET` | `/api/v1/attendance/sessions/:id/recap` | `attendance.read` | Rekap kehadiran satu sesi. |
| `POST` | `/api/v1/attendance/sessions/:id/absen` | `attendance.write` | Catat kehadiran; idempoten via `idempotencyKey`. |
| `POST` | `/api/v1/attendance/qr/verifikasi` | `attendance.write` | Verifikasi token QR. |
| `POST` | `/api/v1/attendance/records/:id/manual` | `attendance.manage` | Ubah catatan kehadiran manual; **wajib** menyertakan alasan perubahan. |

Detail aturan ada di `ATTENDANCE.md`.

---

## 7. Meetings

`apps/api/src/modules/meetings/meetings.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/meetings` | `meeting.read` | Daftar rapat. |
| `GET` | `/api/v1/meetings/:id` | `meeting.read` | Detail rapat. |
| `POST` | `/api/v1/meetings` | `meeting.create` | Buat rapat. |
| `POST` | `/api/v1/meetings/:id/agenda` | `meeting.create` | Tambah agenda. |
| `POST` | `/api/v1/meetings/:id/participants` | `meeting.create` | Tambah peserta. |
| `POST` | `/api/v1/meetings/:id/minutes` | `meeting.create` | Buat/versi notulen. |
| `POST` | `/api/v1/meetings/:id/minutes/:mid/approve` | `meeting.minutes.approve` | Setujui notulen (mengunci versi). |
| `GET` | `/api/v1/meetings/:id/minutes` | `meeting.read` | Daftar versi notulen. |

---

## 8. Tasks

`apps/api/src/modules/tasks/tasks.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/tasks` | `task.read` | Daftar tugas. |
| `GET` | `/api/v1/tasks/:id` | `task.read` | Detail tugas. |
| `GET` | `/api/v1/tasks/:id/aktivitas` | `task.read` | Jejak aktivitas & komentar. |
| `POST` | `/api/v1/tasks` | `task.write` | Buat tugas. |
| `PATCH` | `/api/v1/tasks/:id` | `task.write` | Ubah tugas. |
| `POST` | `/api/v1/tasks/:id/status` | `task.write` | Ubah status (memvalidasi transisi). |
| `POST` | `/api/v1/tasks/:id/verifikasi` | `task.verify` | Verifikasi tugas yang sudah `DONE`. |
| `POST` | `/api/v1/tasks/:id/komentar` | `task.write` | Tambah komentar aktivitas. |

---

## 9. Programs & Events

`apps/api/src/modules/programs/programs.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/programs` | `program.read` | Daftar program kerja. |
| `GET` | `/api/v1/programs/:id` | `program.read` | Detail program. |
| `POST` | `/api/v1/programs` | `program.create` | Buat program. |
| `PATCH` | `/api/v1/programs/:id` | `program.manage` | Ubah program. |
| `POST` | `/api/v1/programs/:id/status` | `program.approve` | Ubah status program (validasi transisi). |
| `POST` | `/api/v1/programs/:id/tim` | `program.manage` | Kelola tim program. |
| `POST` | `/api/v1/programs/:id/milestones` | `program.manage` | Kelola milestone. |
| `POST` | `/api/v1/programs/:id/evaluasi` | `program.manage` | Isi evaluasi. |

`apps/api/src/modules/events/events.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/events` | `event.read` | Daftar acara. |
| `GET` | `/api/v1/events/:id` | `event.read` | Detail acara. |
| `POST` | `/api/v1/events` | `event.create` | Buat acara. |
| `PATCH` | `/api/v1/events/:id` | `event.manage` | Ubah acara. |
| `POST` | `/api/v1/events/:id/peserta` | `event.create` | Tambah peserta/panitia. |
| `GET` | `/api/v1/events/:id/kalender` | `event.read` | Jadwal acara (rundown). |

---

## 10. Finance

`apps/api/src/modules/finance/finance.controller.ts` — dua prefiks pada berkas yang sama:
`api/v1/finance` dan `api/v1/webhooks`.

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/finance/accounts` | `finance.read` | Chart of accounts. |
| `POST` | `/api/v1/finance/accounts` | `finance.write` | Tambah akun. |
| `GET` | `/api/v1/finance/periods` | `finance.read` | Periode keuangan. |
| `POST` | `/api/v1/finance/periods` | `finance.write` | Buat periode keuangan. |
| `GET` | `/api/v1/finance/budgets` | `finance.read` | Daftar anggaran. |
| `POST` | `/api/v1/finance/budgets` | `finance.write` | Buat anggaran. |
| `GET` | `/api/v1/finance/transactions` | `finance.read` | Daftar transaksi. |
| `POST` | `/api/v1/finance/transactions` | `finance.write` | Catat transaksi kas. |
| `POST` | `/api/v1/finance/transactions/:id/approve` | `finance.approve` | Setujui transaksi. |
| `GET` | `/api/v1/finance/ledger` | `finance.read` | Buku besar (immutable). |
| `GET` | `/api/v1/finance/kas` | `finance.read` | Buku kas (dihitung dari ledger). |
| `GET` | `/api/v1/finance/requests` | `finance.read` | Daftar pengajuan. |
| `POST` | `/api/v1/finance/requests` | `finance.write` | Ajukan pengeluaran/pemasukan. |
| `POST` | `/api/v1/finance/requests/:id/decide` | `finance.approve` | Putuskan pengajuan. |
| `GET` | `/api/v1/finance/reimbursements` | `finance.read` | Daftar reimbursement. |
| `POST` | `/api/v1/finance/reimbursements` | `finance.write` | Ajukan reimbursement. |
| `POST` | `/api/v1/finance/reimbursements/:id/decide` | `finance.approve` | Putuskan reimbursement. |
| `POST` | `/api/v1/finance/payments` | `finance.write` | Buat payment intent QRIS (idempoten). |
| `GET` | `/api/v1/finance/payments` | `finance.read` | Daftar pembayaran. |
| `GET` | `/api/v1/finance/reports/kas` | `finance.export` | Laporan kas. |
| `GET` | `/api/v1/finance/reports/anggaran` | `finance.export` | Laporan realisasi anggaran. |
| `GET` | `/api/v1/finance/reports/ledger` | `finance.export` | Ekspor buku besar. |
| `POST` | `/api/v1/webhooks/payment` | webhook provider | Callback pembayaran (dipisah dari `/api/v1/finance` agar mudah dibatasi port/rate limit). |

---

## 11. Communications

`apps/api/src/modules/communications/communications.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/announcements` | `communication.create` | Daftar pengumuman. |
| `GET` | `/api/v1/announcements/:id` | `communication.create` | Detail pengumuman. |
| `POST` | `/api/v1/announcements` | `communication.create` | Buat pengumuman (status `DRAFT`). |
| `POST` | `/api/v1/announcements/:id/approve` | `communication.publish` | Setujui pengumuman. |
| `POST` | `/api/v1/announcements/:id/publish` | `communication.publish` | Terbitkan & kirim ke kanal. |
| `GET` | `/api/v1/campaigns` | login | Daftar kampanye. |
| `POST` | `/api/v1/campaigns` | `communication.create` | Buat kampanye. |
| `GET` | `/api/v1/communications/stats` | login | Statistik pengiriman. |

---

## 12. Notifications

`apps/api/src/modules/notifications/notifications.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/notifications` | login | Daftar notifikasi milik pengguna (hanya milik sendiri). |
| `GET` | `/api/v1/notifications/ringkasan` | login | Jumlah belum dibaca + notifikasi terbaru. |
| `POST` | `/api/v1/notifications/:id/read` | login | Tandai satu sudah dibaca. |
| `POST` | `/api/v1/notifications/read-all` | login | Tandai semua sudah dibaca. |

Modul ini **tidak memakai** `notification.read` di guard karena notifikasi bersifat
pribadi; pembatasannya adalah kepemilikan baris (`user_id`).

---

## 13. Reports

`apps/api/src/modules/reports/reports.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/reports/attendance` | `report.read` | Laporan kehadiran. |
| `GET` | `/api/v1/reports/members` | `report.read` | Laporan anggota. |
| `GET` | `/api/v1/reports/finance` | `finance.read` | Laporan keuangan. |
| `GET` | `/api/v1/reports/programs` | `report.read` | Laporan program. |
| `GET` | `/api/v1/reports/tasks` | `report.read` | Laporan tugas. |
| `POST` | `/api/v1/reports/:jenis/export` | `report.export` | Ekspor (`jenis` = `attendance`/`members`/`finance`/`programs`/`tasks`). |

---

## 14. Audit

`apps/api/src/modules/audit/audit.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/audit/logs` | `audit.read` | Daftar audit (gunakan kursor untuk riwayat panjang). |
| `GET` | `/api/v1/audit/logs/:id` | `audit.read` | Detail satu entri audit. |
| `GET` | `/api/v1/audit/ringkasan` | `audit.read` | Ringkasan aktivitas. |

`audit_logs` bersifat append-only: tidak ada endpoint untuk mengubah atau menghapus.

---

## 15. Settings, Organisasi, Periode

`apps/api/src/modules/settings/settings.controller.ts`

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/organizations` | `settings.manage` | Daftar organisasi. |
| `POST` | `/api/v1/organizations` | `settings.manage` | Buat organisasi. |
| `GET` | `/api/v1/divisions` | `settings.manage` | Daftar divisi. |
| `POST` | `/api/v1/divisions` | `settings.manage` | Buat divisi. |
| `GET` | `/api/v1/positions` | `settings.manage` | Daftar jabatan (peran dikonfigurasi penuh). |
| `POST` | `/api/v1/positions` | `settings.manage` | Tambah jabatan. |
| `GET` | `/api/v1/periods` | `period.manage` | Daftar periode kepengurusan. |
| `POST` | `/api/v1/periods` | `period.manage` | Buat periode baru; periode lama menjadi `ARCHIVED` — histori tidak dihapus. |
| `GET` | `/api/v1/settings` | `settings.manage` | Daftar pengaturan organisasi. |
| `PUT` | `/api/v1/settings` | `settings.manage` | Simpan/ubah satu pengaturan. |
| `GET` | `/api/v1/feature-flags` | login | Daftar feature flag (untuk migrasi bertahap). |
| `PATCH` | `/api/v1/feature-flags/:id` | `settings.manage` | Aktifkan/nonaktifkan flag. |

---

## 16. Health

| Metode | Jalur | Izin | Keterangan |
|---|---|---|---|
| `GET` | `/health/live` | publik | Probe liveness. |
| `GET` | `/health/ready` | publik | Probe readiness; memeriksa koneksi database, mengembalikan 503 bila belum siap. |
| `GET` | `/api/v1/health/live`, `/api/v1/health/ready` | publik | Padanan berversi (`apps/api/src/modules/health`). |

---

## Catatan untuk AI agent

1. Semangatnya: **tidak boleh ada endpoint yang mengandalkan nama peran**. Cek pakai
   `@Izin('modul.aksi')`, bukan `@Peran('CHAIRPERSON')`.
2. Bila menambah endpoint daftar, gunakan `bungkusHasil()` dari
   `apps/api/src/common/utilitas/paginasi.ts` dan sertakan `sortBy`/`sortDir` yang divalidasi
   terhadap daftar kolom.
3. Jangan menambah `try/catch` yang mengembalikan objek galat sendiri. Lempar `GalatApi`
   (lihat `apps/api/src/common/galat.ts`) dan biarkan `HttpExceptionFilter` yang memformat.
4. Endpoint tulis baru secara otomatis akan tercatat `AuditInterceptor`. Bila butuh nama aksi
   khusus, pakai dekorator audit (`KUNCI_AUDIT`) alih-alih menulis audit manual di service.
5. `notifications` tidak memerlukan izin karena datanya milik pengguna; jangan menambahkan
   `notification.read` di sana — cukup pastikan filter `user_id` selalu dipakai.
