# Model Domain OSDA

Dokumen ini menjelaskan entitas inti, batas agregat (aggregate), dan invariant
yang harus selalu benar. Acuan kodenya adalah `packages/db/src/schema/*.ts`,
`packages/contracts/src/enums.ts`, dan `packages/db/src/sql/invariants.ts`.

---

## 1. Pemisahan User / Identity / Member

Spesifikasi produk (§06) memisahkan tiga hal yang sering tergabung di sistem lain.
Pemisahan ini ditegakkan langsung oleh skema di `packages/db/src/schema/identity.ts`:

```
        ┌──────────────┐
        │    users     │  akun untuk MASUK (email/sandi, status akun)
        │  (tabel users)│
        └──────┬───────┘
               │ 1
               │
               │ N
   ┌───────────▼────────────┐        ┌──────────────────────────┐
   │      identities        │        │        members           │
   │ sarana identifikasi:   │        │ ORANG sebagai anggota    │
   │ WhatsApp, email, Google│        │ organisasi: kelas,       │
   │ provider_subject       │        │ angkatan, divisi, status │
   └────────────────────────┘        └───────────┬──────────────┘
                                                 │
                    ┌────────────────────────────┼──────────────┐
                    ▼                            ▼              ▼
           member_period_history          member_roles     position_assignments
```

### Kenapa dipisah?

| Tabel | Pertanyaannya | Contoh baris |
|---|---|---|
| `users` | "Akun apa yang boleh login?" | `Administrator OSDA`, `password_hash` (argon2id), `status`, `gagal_login_berturut` |
| `identities` | "Dengan jalan mana akun ini dikenali?" | `provider='WHATSAPP'`, `provider_subject='6281…@s.whatsapp.net'`, `provider_subject_kanonik='6281…'` |
| `members` | "Siapa orangnya di organisasi?" | `nomor='M-0004'`, `tingkat='X'`, `jurusan='RPL'`, `sub_kelas='1'`, `status='ACTIVE'` |

Alasan pemisahan ini WAJIB:

1. **Satu anggota bisa punya beberapa kanal.** Nomor WhatsApp dapat berubah, email bisa
   ditambahkan kemudian. Menyimpan kanal di tabel `members` akan memaksa migrasi data
   setiap kali kanal berubah.
2. **Logika bisnis tidak boleh bergantung pada format WhatsApp.** Kolom
   `provider_subject` sengaja menyimpan nilai mentah apa adanya; pencocokan lintas klien
   memakai `provider_subject_kanonik`. Komentar di skema menyatakan ini secara eksplisit.
3. **Satu akun bisa menjadi anggota di beberapa organisasi atau beberapa periode.**
   Relasi `members.userId` boleh `NULL` (anggota yang belum punya aksun Web/Mobile) —
   anggota hasil migrasi OSDA BOT memang punya akun, tetapi pendaftaran lewat WhatsApp
   mungkin hanya membuat `member` lebih dulu.
4. **Histori keanggotaan tidak hilang.** `member_period_history` menyimpan riwayat lintas
   periode; `members` menyimpan kondisi terkini.

---

## 2. Entitas Inti

### Organisasi & struktur (`packages/db/src/schema/organization.ts`)

| Tabel | Peran |
|---|---|
| `organizations` | Sekolah/OSIS. Menyimpan `zona_waktu` (bawaan `Asia/Makassar`). |
| `organization_periods` | Periode kepengurusan, mis. `2026/2027`, status `UPCOMING/ACTIVE/ARCHIVED`. |
| `divisions` | Bidang (mis. `BIDA` Bidang Nilai). `koordinator_member_id` menunjuk koordinator. |
| `positions` | Jabatan, **bukan enum di kode**: `KETUA`, `SEKRETARIS`, `BENDAHARA`, … dengan `tingkat` `BOARD/COORDINATOR/STAFF/MEMBER`. |
| `position_assignments` | Penugasan jabatan kepada anggota pada satu periode, boleh membawa `dokumen_id` (SK). |

> "Ketua" tidak ada di kode. Ia adalah baris pada `positions` + penugasan pada
> `position_assignments` + peran pada `member_roles`. Demikian juga "Bendahara".

### Otorisasi (`packages/db/src/schema/authorization.ts`)

| Tabel | Peran |
|---|---|
| `permissions` | Kamus izin `modul.aksi` (38 baris hasil seed), kolom `sensitif`. |
| `roles` | Paket izin. Peran bawaan `bawaan=true` dan `organization_id IS NULL`. |
| `role_permissions` | Tautan peran ↔ izin **beserta cakupan** (PK: `role_id, permission_id, cakupan`). |
| `member_roles` | Pemberian peran kepada anggota, punya `period_id`, `dicabut_pada`. |
| `delegations` | Delegasi sementara. Tidak menambah izin baru — hanya meneruskan izin pemberi. |

### Modul operasional

| Tabel | Peran |
|---|---|
| `attendance_sessions` | Sesi absensi (jenis `MEETING/EVENT/ACTIVITY/TRAINING/COMMITTEE`). |
| `attendance_records` | Catatan kehadiran, unik `(session_id, member_id)`. |
| `attendance_qr_tokens` | Token QR sekali pakai, hanya hash yang disimpan. |
| `permission_requests` | Permintaan izin/sakit (`EXCUSED`/`SICK`) yang harus diputuskan. |
| `attendance_participants` | Foto siapa yang wajib hadir, dibekukan saat sesi dibuka. |
| `meetings`, `meeting_agenda`, `meeting_participants`, `meeting_minutes`, `meeting_action_items`, `meeting_attachments` | Rapat dan notulensinya. |
| `tasks`, `task_assignees`, `task_activity`, `task_dependencies`, `task_checklists` | Tugas beserta jejak aktivitasnya. |
| `programs`, `program_members`, `program_milestones`, `program_documents`, `program_evaluations` | Program kerja sebagai agregat besar. |
| `events`, `event_participants`, `event_attendance`, `event_schedules` | Acara turunan program. |
| `accounts`, `financial_periods`, `budgets`, `budget_items`, `expense_requests`, `transactions`, `ledger_entries`, `reimbursements`, `payments`, `dues_periods`, `dues_status` | Keuangan. |
| `documents`, `document_versions`, `document_access`, `letters`, `document_categories`, `storage_buckets` | Dokumen & arsip. |
| `announcements`, `announcement_recipients`, `campaigns`, `notifications`, `notification_deliveries`, `approval_requests`, `approval_recipients`, `activity_log`, `audit_logs`, `settings`, `feature_flags`, `integration_configs`, `webhook_events`, `legacy_id_mappings` | Komunikasi, notifikasi, persetujuan, sistem. |

---

## 3. Aggregate & Batas Konsistensi

Agregat adalah kumpulan objek yang perubahannya harus konsisten dalam satu transaksi.

| Agregat | Akar | Anggota agregat | Batas |
|---|---|---|---|
| Organisasi | `organizations` | periode, divisi, jabatan, penugasan, peran lokal | Selalu ditentukan `organization_id`. |
| Sesi absensi | `attendance_sessions` | `attendance_records`, `attendance_qr_tokens`, `permission_requests`, `attendance_participants` | Penghapusan sesi menghapus catatan turunannya (`on delete: cascade`). |
| Rapat | `meetings` | agenda, peserta, notulen, item tindakan, lampiran | Notulen punya indeks unik `(meeting_id, versi)`. |
| Tugas | `tasks` | assignee, aktivitas, dependensi, checklist | Catatan aktivitas **tidak boleh** dihapus. |
| Program | `programs` | anggota program, milestone, dokumen, evaluasi, acara, tugas, anggaran | `programs.owner_member_id` memakai `on delete: restrict` — program tidak boleh kehilangan pemilik. |
| Transaksi keuangan | `transactions` | `ledger_entries` | Entri ledger memakai `on delete: restrict` dan dilarang diubah. |
| Dokumen | `documents` | `document_versions`, `document_access` | Versi yang dikunci tidak boleh diubah. |
| Pengumuman | `announcements` | `announcement_recipients`, `notification_deliveries` | Penerima unik per `(pengumuman, anggota, kanal)`. |

**Aturan praktis:** bila sebuah perubahan menyentuh lebih dari satu tabel dalam satu agregat,
lakukan di dalam satu transaksi database. Untuk agregat berbeda (mis. program + keuangan),
hubungkan lewat ID dan biarkan konsistensi eventual — jangan pakai transaksi lintas agregat
besar.

---

## 4. Invariant yang Ditegakkan Database

Invariant didefinisikan di `packages/db/src/sql/invariants.ts` dan dijalankan setelah migrasi
Drizzle. Database adalah **lapis pertahanan terakhir**: aplikasi memeriksa lebih dulu, database
menolak bila terlambat.

| # | Invariant | Penegakan |
|---|---|---|
| 1 | `diubah_pada` selalu diperbarui saat baris diubah | Trigger `trg_updated_at` pada setiap tabel yang punya kolom `diubah_pada` (terverifikasi: 38 tabel). |
| 2 | `ledger_entries` immutable | Trigger `trg_ledger_immutable` (UPDATE/DELETE dinaikkan galat dengan `ERRCODE restrict_violation`). |
| 3 | Versi dokumen yang dikunci tidak boleh diubah | Trigger `trg_dokumen_versi_locked`. |
| 4 | Pemohon ≠ pemberi persetujuan | Trigger `trg_no_self_approval_expense` dan `trg_no_self_approval_reimburse`. |
| 5 | Status `EXCUSED`/`SICK` wajib beralasan (≥ 3 karakter) | CHECK `chk_alasan_wajib` pada `attendance_records`. |
| 6 | Nominal transaksi positif; entri ledger tidak boleh nol | CHECK `chk_nominal_positif`, `chk_ledger_nonzero`. |
| 7 | `audit_logs` append-only | Trigger `trg_audit_append_only`. |
| 8 | Saldo dihitung, tidak disimpan | Fungsi `osda_saldo_akun(akun_id, sampai)` dan `osda_saldo_organisasi(org, sampai)`. |
| 9 | Hanya satu periode kepengurusan `ACTIVE` per organisasi | Index unik parsial `uq_periode_aktif`. |
| 10 | Hanya satu periode keuangan `OPEN` per organisasi | Index unik parsial `uq_periode_keuangan_aktif`. |
| 11 | Pembayaran hanya di-settle sekali | Trigger `trg_payment_settle_once` + indeks unik `payments.referensi_provider`. |
| 12 | Pencarian teks dokumen & pengumuman | Index GIN `ix_documents_fts`, `ix_announcements_fts`. |

---

## 5. Invariant yang Ditegakkan Aplikasi

Hal-hal berikut tidak bisa diperiksa database, sehingga dijaga di service:

- **Idempotensi.** `attendance_records.idempotency_key`, `attendance_sessions.idempotency_key`,
  `transactions.idempotency_key`, `payments.idempotency_key`, `expense_requests.idempotency_key`,
  `notifications.dedup_key`, `announcements.idempotency_key`, `webhook_events` (unik `provider + event_id`).
- **Transisi status sah.** `TRANSISI_PROGRAM`, `TRANSISI_TUGAS`, dan `TRANSISI_KOREKSI_PROGRAM`
  di `packages/contracts/src/enums.ts`.
- **Arsip, bukan hapus.** `members.diarsipkan_pada`, `documents`, `positions.aktif`.
- **Uang dalam rupiah penuh.** Semua kolom uang memakai helper `uang()` = `bigint mode number`
  (lihat komentar di `packages/db/src/schema/_base.ts`).
- **Optimistic locking.** Kolom `versi_baris` dipakai pada tabel yang rawan tabrakan tulis
  (`programs`, `tasks`, `budgets`, `transactions`, `reimbursements`, `payments`, …).

---

## 6. Mengapa PostgreSQL Satu-satunya Sumber Kebenaran

1. **Tidak ada sumber data kedua.** Bot WhatsApp tidak punya tabel sendiri
   (`apps/bot/src/services/identity-resolver.ts` menyatakan ini secara eksplisit).
2. **Invariant tidak bisa dilanggar diam-diam.** Trigger dan CHECK constraint menolak
   perubahan yang merusak ledger, audit, dokumen terkunci, atau absensi ganda.
3. **Perhitungan tunggal.** Saldo kas dihitung dari `ledger_entries`; tidak ada kolom
   "saldo" yang bisa berbeda dengan riwayat.
4. **Otorisasi tunggal.** Peran & izin efektif dihitung dari `member_roles → roles →
   role_permissions → permissions` di `apps/api/src/auth/izin.service.ts`. Daftar di
   `@osda/contracts` hanya cadangan bila database kosong.
5. **Konsistensi multi-klien.** Web, Mobile, dan bot membaca angka yang sama; tidak ada
   cache yang menjadi kebenaran.

---

## Catatan untuk AI agent

1. Jangan pernah menambah kolom "saldo" atau "total" pada tabel keuangan tanpa menuliskannya
   sebagai **denormalisasi** yang jelas asal-usulnya dan cara sinkronnya. Default-nya: hitung
   dari `ledger_entries`.
2. Jangan menambah relasi foreign key tanpa `onDelete` yang eksplisit. Pola yang dominan:
   `cascade` untuk agregat turunan, `set null` untuk relasi opsional, `restrict` untuk data
   keuangan dan pemilik program/acara.
3. Bila menambah invariant baru, tambahkan ke `SQL_INVARIANT` (bukan ke migrasi Drizzle) agar
   `db:seed` dan `db:migrate` menjalankannya otomatis, dan buat idempoten (`DROP … IF EXISTS`).
4. `idempotency_key` pada tabel absensi/keuangan tidak boleh menjadi opsional di sisi service —
   indeks uniknya hanya mencegah duplikat bila nilainya benar-benar dikirim klien.
5. Jangan menghapus baris dari tabel histori (`member_period_history`, `task_activity`,
   `ledger_entries`, `audit_logs`). Koreksi selalu berupa baris baru.
