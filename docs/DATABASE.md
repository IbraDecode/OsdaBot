# Basis Data OSDA

Seluruh skema ada di `packages/db/src/schema/`. Terverifikasi di basis data:
**74 tabel** pada skema `public`. Dokumen ini mengelompokkannya per modul, mencatat
index unik penting, dan menjelaskan ketergantungan foreign key.

---

## 0. Konvensi Bersama

Didefinisikan di `packages/db/src/schema/_base.ts`:

| Helper | Bentuk | Kegunaan |
|---|---|---|
| `pk()` | `uuid('id').defaultRandom()` | Primer kunci UUID v4 agar ID tidak tertebak di URL. |
| `dibuatPada()` | `timestamp with time zone default now()` | Waktu dibuat, selalu diisi database. |
| `diubahPada()` | `timestamp with time zone default now()` | Waktu ubah, diperbarui trigger `trg_updated_at`. |
| `dihapusPada()` | `timestamp with time zone` (nullable) | Soft delete. |
| `versiBaris()` | `timestamp with time zone default now()` | Versi baris untuk optimistic locking. |
| `uang(nama)` | `bigint mode number` | Nominal rupiah penuh, tanpa pecahan. |
| `dibuatOleh()` / `diubahOleh()` | `uuid` (nullable) | Jejak aktor. |

Nama kolom memakai bahasa Indonesia (`nama`, `dibuat_pada`, `diubah_pada`), nama tabel
memakai bahasa Indonesia juga. Enum database didefinisikan di berkas yang sama dan
mencerminkan nilai di `packages/contracts/src/enums.ts`.

---

## 1. Fondasi Organisasi (5 tabel)

Berkas: `packages/db/src/schema/organization.ts`

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `organizations` | `nama`, `singkat`, `jenis`, `nama_sekolah`, `npsn`, `zona_waktu` (bawaan `Asia/Makassar`), `aktif` | `uq_organisasi_singkat` |
| `organization_periods` | `nama` (mis. `2026/2027`), `mulai_pada`, `selesai_pada`, `status` (`UPCOMING/ACTIVE/ARCHIVED`), `diarsipkan_pada` | `uq_period_org_nama` (organization_id, nama) + `uq_periode_aktif` parsial (`status='ACTIVE'`) |
| `divisions` | `kode` (mis. `BIDA`), `nama`, `id_divisi_induk`, `koordinator_member_id`, `urutan`, `aktif` | `uq_divisi_org_kode` (organization_id, kode) |
| `positions` | `kode` (`KETUA`, `SEKRETARIS`, …), `tingkat` (`BOARD/COORDINATOR/STAFF/MEMBER`), `butuh_sk` | `uq_jabatan_org_kode` |
| `position_assignments` | `period_id`, `member_id`, `position_id`, `division_id`, `mulai_pada`, `selesai_pada`, `dokumen_id` (SK) | — |

Ketergantungan: `organization_periods/divisions/positions/position_assignments` → `organizations.id`
(`on delete: cascade`). `divisions.period_id` → `organization_periods.id` (`set null`).

---

## 2. Identity (8 tabel)

Berkas: `packages/db/src/schema/identity.ts`

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `users` | `nama`, `email`, `telepon`, `password_hash` (argon2id), `status`, `bahasa`, `preferensi_notifikasi` (jsonb), `gagal_login_berturut`, `dikunci_sampai` | `uq_users_email`, `uq_users_telepon` |
| `identities` | `user_id`, `provider` (`WHATSAPP/EMAIL/GOOGLE/PASSWORD`), `provider_subject` (mentah), `provider_subject_kanonik`, `whatsapp_lid`, `metadata` | `uq_identity_provider_subjek`, `uq_identity_kanonik` |
| `members` | `organization_id`, `period_id`, `user_id` (boleh NULL), `nomor` (mis. `M-0004`), `nama`, `tingkat`, `jurusan`, `sub_kelas`, `nis`, `nisn`, `division_id`, `status`, `bergabung_pada`, `diarsipkan_pada`, `legacy_id`, `legacy_tabel` | `uq_member_org_nomor`, `uq_member_org_nisn`, `uq_member_org_legacy` (organization_id, legacy_tabel, legacy_id) |
| `member_period_history` | `member_id`, `period_id`, `status`, `bergabung_pada`, `selesai_pada`, `catatan` | — |
| `account_link_requests` | `identity_id`, `provider_subject`, `member_id`, `user_id`, `kode`, `berlaku_sampai`, `dipakai_pada`, `gagal_percobaan` | `uq_link_kode` |
| `sessions` | `user_id`, `refresh_token_hash`, `user_agent`, `ip`, `jaringan`, `terakhir_dipakai_pada`, `kedaluwarsa_pada`, `dicabut_pada`, `alasan_pencabutan` | `uq_sesi_refresh` |
| `one_time_tokens` | `user_id`, `tipe`, `token_hash`, `metadata`, `berlaku_sampai`, `dipakai_pada` | `uq_ott_token` |
| `auth_policies` | `organization_id`, `kunci`, `nilai` (jsonb) | `uq_auth_policy` (organization_id, kunci) |

Ketergantungan: `identities`, `sessions`, `one_time_tokens` → `users.id` (`cascade`);
`members` → `organizations.id` (`cascade`), `organization_periods.id` (`set null`),
`users.id` (`set null` — anggota belum tentu punya akun login);
`account_link_requests` → `identities` (`set null`), `members` (`set null`), `users` (`cascade`).

---

## 3. Authorization (5 tabel)

Berkas: `packages/db/src/schema/authorization.ts`

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `permissions` | `kode` (`finance.approve`), `modul`, `aksi`, `deskripsi`, `sensitif` | `uq_permission_kode` |
| `roles` | `organization_id` (NULL = peran global), `kode`, `nama`, `bawaan`, `tingkat_jabatan`, `tunggal`, `cakupan_default`, `warisi_dari_kode`, `urutan` | `uq_role_global_kode` parsial (`organization_id is null`), `uq_role_org_kode` parsial (`organization_id is not null`) |
| `role_permissions` | `role_id`, `permission_id`, `cakupan`, `kondisi` (jsonb) | PK komposit `(role_id, permission_id, cakupan)` |
| `member_roles` | `organization_id`, `member_id`, `role_id`, `period_id`, `position_assignment_id`, `division_id`, `mulai_pada`, `selesai_pada`, `diberikan_oleh`, `dicabut_pada` | — |
| `delegations` | `pemberi_member_id`, `penerima_member_id`, `permission_id` (NULL = semua izin pemberi), `alasan`, `mulai_pada`, `selesai_pada`, `dicabut_pada`, `versi_baris` | — |

Ketergantungan: `roles` → `organizations.id` (`cascade`);
`role_permissions` → `roles`, `permissions` (`cascade`);
`member_roles` → `members`, `roles`, `organization_periods` (`cascade`);
`delegations` → `members` (pemberi & penerima, `cascade`), `permissions` (`cascade`).

Index parsial pada `roles` perlu diperhatikan: **kode peran global unik hanya untuk baris
dengan `organization_id IS NULL`**, dan unik per organisasi untuk sisanya.

---

## 4. Attendance (5 tabel)

Berkas: `packages/db/src/schema/attendance.ts`

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `attendance_sessions` | `jenis` (`MEETING/EVENT/ACTIVITY/TRAINING/COMMITTEE`), `judul`, `tanggal`, `status` (`DRAFT/OPEN/CLOSED/CANCELLED`), `hanya_division_ids[]`, `hanya_jabatan_ids[]`, `member_ids[]`, `batas_keterlambatan_menit` (bawaan 15), `qr_ttl_detik` (bawaan 120), `qr_secret`, `rekap_*`, `idempotency_key`, `legacy_id` | `uq_sesi_idempotensi` (organization_id, idempotency_key) |
| `attendance_records` | `session_id`, `member_id`, `status` (`PRESENT/LATE/EXCUSED/SICK/ABSENT`), `alasan`, `sumber` (`WEB/MOBILE/WHATSAPP/ADMIN/QR`), `menit_keterlambatan`, `qr_token_jti`, `diubah_oleh`, `alasan_perubahan`, `idempotency_key` | `uq_hadir_sesi_member` (session_id, member_id), `uq_hadir_idempotensi` (session_id, idempotency_key) |
| `attendance_qr_tokens` | `session_id`, `jti`, `token_hash`, `dibuat_pada`, `berlaku_sampai`, `dipakai_pada`, `dipakai_oleh_member_id`, `dibatalkan` | `uq_qr_token` |
| `permission_requests` | `session_id`, `member_id`, `jenis` (`EXCUSED/SICK`), `alasan`, `bukti_dokumen_id`, `status` (`PENDING/APPROVED/REJECTED/CANCELLED`), `kode` | `uq_izin_sesi_member`, `uq_izin_kode` |
| `attendance_participants` | `session_id`, `member_id`, `wajib`, `sudah_absen`, `ditampilkan` | `uq_peserta_sesi_member` |

Ketergantungan: `attendance_sessions` → `organizations` (`cascade`), `organization_periods` (`set null`).
Catatan: `meeting_id` dan `event_id` pada `attendance_sessions` **tidak punya foreign key**
(enum Drizzle sengaja dibiarkan longgar karena rapat/acara dibuat belakangan).
`attendance_records` → `attendance_sessions`, `members` (`cascade`);
`attendance_qr_tokens` → `attendance_sessions` (`cascade`), `members` (`set null`);
`permission_requests` → `attendance_sessions`, `members` (`cascade`).

---

## 5. Operations — Rapat & Tugas (11 tabel)

### Rapat (`packages/db/src/schema/meetings.ts`)

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `meetings` | `judul`, `tanggal`, `waktu_mulai`, `waktu_selesai`, `jenis` (`RUTIN/KALENDER/DARURAT/DIVISI/PROGRAM`), `pembicara[]`, `division_ids[]`, `jabatan_ids[]`, `status` (`SCHEDULED/ONGOING/COMPLETED/CANCELLED`), `session_id`, `undangan_terkirim_pada`, `pengingat_terkirim` (jsonb), `revisi` | `uq_rapat_undangan_slot` (organization_id, tanggal, waktu_mulai) |
| `meeting_agenda` | `meeting_id`, `judul`, `pembicara`, `durasi_menit`, `urutan`, `dibahas` | — |
| `meeting_participants` | `meeting_id`, `member_id`, `wajib`, `hadir`, `status_hadir`, `sudah_dibaca_undangan` | `uq_peserta_rapat_member` |
| `meeting_minutes` | `meeting_id`, `organization_id`, `nomor` (mis. `001/PMR/III/2026`), `versi`, `ringkasan`, `pembahasan`, `keputusan[]`, `status` (`DRAFT/REVIEW/APPROVED/ARCHIVED`), `alasan_revisi`, `dikunci_pada`, `penulis_id`, `disetujui_oleh` | `uq_notulen_rapat_versi` (meeting_id, versi) |
| `meeting_action_items` | `minutes_id`, `isi`, `penanggung_jawab_member_id`, `batas_waktu`, `prioritas`, `task_id`, `selesai` | — |
| `meeting_attachments` | `meeting_id`, `document_id`, `jenis`, `keterangan` | — |

### Tugas (`packages/db/src/schema/tasks.ts`)

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `tasks` | `kode`, `judul`, `status` (`TODO/IN_PROGRESS/BLOCKED/DONE/CANCELLED`), `verifikasi` (`UNVERIFIED/VERIFIED/REJECTED`), `butuh_verifikasi`, `prioritas`, `batas_waktu`, `progres`, `lampiran_dokumen_ids[]`, `tags[]`, `division_tujuan_id`, `parent_id`, `versi_baris` | `uq_tugas_kode` (organization_id, kode) |
| `task_assignees` | `task_id`, `member_id`, `utama`, `diterima_pada`, `selesai_pada`, `progres` | `uq_tugas_assignee` |
| `task_activity` | `task_id`, `member_id`, `tipe` (`DIBUAT/STATUS/KOMENTAR/VERIFIKASI/DITUGASKAN`), `status_sebelum`, `status_sesudah`, `metadata` | — |
| `task_dependencies` | `task_id`, `bergantung_pada_task_id` | `uq_task_dep` |
| `task_checklists` | `task_id`, `isi`, `selesai`, `selesai_oleh`, `urutan` | — |

Ketergantungan penting: `meetings.division_id`, `tasks.division_id`, `tasks.meeting_id`,
`tasks.programId` memakai `set null`; `tasks.diverifikasi_oleh` → `members` (`set null`);
`tasks` → `organizations` (`cascade`).

---

## 6. Programs & Events (9 tabel)

Berkas: `packages/db/src/schema/programs.ts`

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `programs` | `kode`, `nama`, `tujuan`, `latar_belakang`, `status` (`DRAFT/PROPOSED/APPROVED/PLANNED/RUNNING/COMPLETED/CANCELLED`), `prioritas`, `owner_member_id` (`restrict`), `anggaran_diajukan`, `anggaran_disetujui`, `realisasi_pengeluaran`, `mulai_pada`, `selesai_pada`, `indikator[]`, `progres`, `total_tugas`, `tugas_selesai`, `total_acara`, `disetujui_oleh`, `alasan_penolakan`, `versi_baris` | `uq_program_kode` |
| `program_members` | `program_id`, `member_id`, `division_id`, `peran` (`OWNER/KETU/ANGGOTA/PENGAWAS/PEMBIAYA`), `jabatan_id`, `tanggal_bergabung`, `tanggal_keluar` | `uq_program_member` |
| `program_milestones` | `program_id`, `nama`, `tanggal`, `selesai`, `urutan` | — |
| `program_documents` | `program_id`, `document_id`, `jenis` (`PROPOSAL/ANGGARAN/SURAT/DOKUMENTASI/LPJ/LAINNYA`) | `uq_program_dokumen` |
| `program_evaluations` | `program_id`, `capaian`, `kendala`, `pelajaran`, `rekomendasi`, `skor_kualitas`, `skor_keberhasilan`, `dievaluasi_oleh`, `publik` | — |
| `events` | `kode`, `judul`, `tanggal`, `status` (`DRAFT/PLANNED/REGISTRATION/ONGOING/COMPLETED/CANCELLED`), `penanggung_jawab_member_id` (`restrict`), `kapasitas`, `kuota_kelas` (jsonb), `butuh_absensi`, `butuh_pendaftaran`, `session_id`, `biaya_diajukan`, `versi_baris` | `uq_acara_kode` |
| `event_participants` | `event_id`, `member_id`, `peran` (`PESERTA/PANITIA/PANITIA_UTAMA/NARASUMBER`), `divisi`, `tugas`, `hadir` | `uq_acara_peserta` |
| `event_attendance` | `event_id`, `member_id`, `tipe` (`IN/OUT/HADIR/PULANG`), `waktu`, `dicatat_oleh` | `uq_acara_absensi` (event_id, member_id, tipe) |
| `event_schedules` | `event_id`, `judul`, `mulai_pukul`, `selesai_pukul`, `lokasi`, `penanggung_jawab_member_id`, `urutan` | — |

`events.programId` → `programs.id` (`set null`), sehingga acara bisa lahir dari program.

---

## 7. Finance (11 tabel)

Berkas: `packages/db/src/schema/finance.ts`

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `accounts` | `kode` (mis. `101`), `nama`, `jenis` (`ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE`), `induk_id`, `require_memo`, `adalah_kas`, `posting_otomatis` | `uq_akun_org_kode` |
| `financial_periods` | `nama`, `mulai_pada`, `selesai_pada`, `saldo_awal`, `status` (`OPEN/CLOSED`) | `uq_periode_keuangan_nama` + `uq_periode_keuangan_aktif` parsial |
| `budgets` | `kode`, `nama`, `total_diajukan`, `total_disetujui`, `status` (`DRAFT/SUBMITTED/APPROVED/ACTIVE/REVISED/CLOSED`), `revisi`, `parent_id`, `versi_baris` | `uq_anggaran_kode` |
| `budget_items` | `budget_id`, `account_id`, `keterangan`, `nominal`, `realisasi` | — |
| `expense_requests` | `kode`, `jenis` (`EXPENSE/INCOME`), `account_id`, `nominal`, `status` (`SUBMITTED/REVIEWED/APPROVED/REJECTED/PAID/CANCELLED`), `pemohon_member_id`, `direview_oleh`, `disetujui_oleh`, `dibayar_oleh`, `metode_pembayaran`, `bukti_transfer`, `transaksi_id`, `idempotency_key` | `uq_pengajuan_kode`, `uq_pengajuan_idempotensi` |
| `transactions` | `kode`, `jenis` (`INCOME/EXPENSE/TRANSFER/REIMBURSEMENT/ADJUSTMENT`), `arah` (`IN/OUT`), `account_id`, `account_tujuan_id`, `nominal`, `status` (`DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/POSTED`), `expense_request_id`, `diposting_pada`, `idempotency_key`, `versi_baris` | `uq_transaksi_kode`, `uq_transaksi_idempotensi` |
| `ledger_entries` | `transaksi_id`, `account_id`, `tanggal`, `debit`, `kredit`, `saldo_berjalan`, `narration`, `created_by` | — |
| `reimbursements` | `kode`, `member_id`, `account_id`, `nominal`, `status` (`SUBMITTED/REVIEWED/APPROVED/PAID/REJECTED/CANCELLED`), `disetujui_oleh`, `referensi_pembayaran`, `transaksi_id`, `idempotency_key`, `versi_baris` | `uq_reimburse_kode`, `uq_reimburse_idempotensi` |
| `payments` | `kode`, `member_id`, `jenis` (`KAS/IURAN/EVENT/PROGRAM/OTHER`), `periode` (mis. `2026-W10`), `nominal`, `metode` (`CASH/QRIS/BANK_TRANSFER/EWALLET`), `status` (`PENDING/PAID/FAILED/EXPIRED/REFUNDED`), `idempotency_key` (wajib), `referensi_provider`, `qr_string`, `qr_url`, `kedaluwarsa_pada`, `jumlah_webhook`, `transaksi_id` | `uq_payment_kode`, `uq_payment_idempotensi`, `uq_payment_referensi` |
| `dues_periods` | `kode` (mis. `KAS-2026-W39`), `nama`, `frekuensi` (`MINGGUAN/BULANAN/KUSTOM`), `periode`, `mulai_pada`, `selesai_pada`, `nominal`, `status` (`OPEN/CLOSED`), `batas_pembayaran` | `uq_dues_org_periode` |
| `dues_status` | `dues_period_id`, `member_id`, `kewajiban` (`WAJIB/OPSIONAL/BELEGA/GRATIS`), `status` (`LUNAS/BELUM/TERLAMBAT/DINONAKTIFKAN`), `nominal`, `payment_id`, `dibayar_pada` | `uq_dues_status` (dues_period_id, member_id) |

Ketergantungan yang perlu diingat: `accounts`, `transactions`, `ledger_entries`,
`budgets.financial_period_id` memakai **`restrict`** — data keuangan tidak boleh terhapus
oleh penghapusan baris lain. `expense_requests` → `accounts` (`restrict`), `programs`/`events`
(`set null`), `pemohon_member_id` (`restrict`).

---

## 8. Documents (6 tabel)

Berkas: `packages/db/src/schema/documents.ts`

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `documents` | `judul`, `kategori` (`SURAT_MASUK/SURAT_KELUAR/PROPOSAL/LPJ/NOTULEN/SK/UNDANGAN/…`), `versi`, `status` (`DRAFT/REVIEW/APPROVED/ARCHIVED`), `owner_member_id`, `storage_key`, `nama_berkas`, `ukuran_bytes`, `mime`, `checksum_sha256`, `perlu_persetujuan`, `retensi_hari`, `tag[]`, `pencarian` | `uq_dokumen_storage_key` |
| `document_versions` | `document_id`, `versi`, `storage_key`, `ukuran_bytes`, `mime`, `checksum_sha256`, `alasan_revisi`, `dikunci`, `dikunci_pada` | `uq_dokumen_versi` (document_id, versi), `uq_dokumen_versi_key` |
| `document_access` | `document_id`, `member_id`, `role_code`, `division_id`, `hanya_baca`, `berlaku_sampai` | — |
| `letters` | `arah` (`MASUK/KELUAR`), `nomor`, `tanggal`, `pengirim`, `penerima`, `instansi_pengirim`, `ringkasan`, `perlu_tindak_lanjut`, `batas_tindak_lanjut`, `document_id` | `uq_surat_org_nomor` |
| `document_categories` | `kode`, `nama`, `bawaan`, `retensi_hari`, `perlu_persetujuan`, `urutan` | `uq_kategori_org_kode` |
| `storage_buckets` | `nama`, `publik` (selalu false), `prefix`, `batas_ukuran_bytes`, `kuota_bytes`, `dipakai_bytes` | `uq_bucket_org` |

---

## 9. Communication & Notifications (5 tabel)

Berkas: `packages/db/src/schema/system.ts` (bagian komunikasi)

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `announcements` | `judul`, `isi`, `ringkasan`, `audiens` (`ALL/BOARD/DIVISION/EVENT/CUSTOM`), `division_ids[]`, `jabatan_ids[]`, `member_ids[]`, `kanal[]` (`WEB/MOBILE/WHATSAPP/EMAIL`), `prioritas`, `status` (`DRAFT/REVIEW/APPROVED/SCHEDULED/PUBLISHED/ARCHIVED`), `pin`, `perlu_persetujuan`, `idempotency_key`, `tanggal_terbit`, `jadwalkan_pada`, `terbit_pada`, `total_penerima`, `total_terkirim`, `total_terbaca`, `total_gagal` | — |
| `announcement_recipients` | `announcement_id`, `member_id`, `kanal`, `status` (`PENDING/SENT/DELIVERED/READ/FAILED`), `percobaan`, `pesan_galat`, `pesan_id`, `dibaca_pada`, `dedup_key` | `uq_penerima_kanal` (announcement_id, member_id, kanal) |
| `campaigns` | `nama`, `mulai_pada`, `selesai_pada`, `status` (`PLANNED/ACTIVE/COMPLETED/CANCELLED`), `announcement_ids[]`, `budget` | — |
| `notifications` | `user_id`, `member_id`, `jenis` (`ATTENDANCE/TASK/MEETING/PROGRAM/FINANCE/APPROVAL/ANNOUNCEMENT/SYSTEM`), `prioritas`, `judul`, `isi`, `entitas_jenis`, `entitas_id`, `actions` (jsonb), `dedup_key`, `dibaca_pada`, `kedaluwarsa_pada` | `uq_notif_dedup` (user_id, dedup_key) |
| `notification_deliveries` | `notification_id`, `announcement_id`, `user_id`, `member_id`, `metode` (`IN_APP/PUSH/WHATSAPP/EMAIL`), `kanal`, `status`, `percobaan`, `pesan_id`, `job_key`, `jadwalkan_pada` | `uq_delivery_job` |

`notification_deliveries` adalah implementasi **outbox pattern**: ditulis dalam satu
transaksi dengan perubahan bisnis, lalu worker mengirimnya.

---

## 10. System (9 tabel)

Berkas: `packages/db/src/schema/system.ts` (bagian sistem)

| Tabel | Kolom penting | Index unik |
|---|---|---|
| `approval_requests` | `jenis` (`PROGRAM/BUDGET/EXPENSE/REIMBURSEMENT/DOCUMENT/ANNOUNCEMENT/EVENT/MINUTES/LEAVE`), `entitas_tabel`, `entitas_id`, `ringkasan`, `nominal`, `pemohon_id`, `status` (`PENDING/APPROVED/REJECTED/CANCELLED`), `level_sekarang`, `total_level`, `idempotency_key` | `uq_approval_idempotensi` |
| `approval_recipients` | `approval_request_id`, `role_code` (bukan orang!), `level`, `status`, `diputusan_oleh` | — |
| `activity_log` | `pesan`, `actor_id`, `actor_nama`, `entitas_jenis`, `entitas_id`, `entitas_label`, `kanal`, `metadata`, `division_id`, `program_id` | — |
| `audit_logs` | `aksi`, `entitas_tabel`, `entitas_id`, `actor_id`, `actor_member_id`, `sumber` (`API/WEB/MOBILE/WHATSAPP/SYSTEM/MIGRATION`), `ip`, `user_agent`, `request_id`, `sebelum` (jsonb), `sesudah` (jsonb), `field_diubah`, `berhasil`, `pesan_galat` | — |
| `settings` | `kunci`, `nilai`, `deskripsi`, `tipe` (`string/number/boolean/json`) | `uq_setting_org_kunci` |
| `feature_flags` | `kunci`, `status` (`ON/OFF`), `persentase` (rollout bertahap), `deskripsi` | `uq_flag_kunci` |
| `integration_configs` | `provider` (`WHATSAPP/QRIS/EMAIL/STORAGE/PUSH`), `status`, `config_terenkripsi` (AES-256-GCM), `metadata`, `terhubung_pada`, `pesan_galat` | `uq_integration_provider` |
| `webhook_events` | `provider`, `event_id`, `tipe`, `signature_valid`, `diproses`, `payload`, `diproses_pada` | `uq_webhook_event` (provider, event_id) |
| `legacy_id_mappings` | `legacy_tabel`, `legacy_id`, `target_tabel`, `target_id`, `catatan` | `uq_legacy_mapping` (legacy_tabel, legacy_id) |

---

## 11. Peta Ketergantungan Utama

```
organizations ──┬──> organization_periods ──> divisions, position_assignments
                │                                │
                │                                ▼
                ├──> members ──┬──> member_roles ──> roles ──> role_permissions ──> permissions
                │             ├──> member_period_history
                │             ├──> attendees (attendance_records) ──> attendance_sessions
                │             ├──> tasks / task_assignees / task_activity
                │             ├──> meetings (peserta, notulen, item tindakan)
                │             ├──> programs (owner restrict) ──> events
                │             ├──> expense_requests / reimbursements / payments
                │             └──> notifications
                └──> accounts ──> transactions ──> ledger_entries   (restrict semua)
                                    ▲
                        budgets / budget_items (financial_periods restrict)

users ──> identities, sessions, one_time_tokens
documents ──> document_versions, document_access
```

Aturan `onDelete` yang dipakai konsisten:

| Nilai | Dipakai untuk | Alasan |
|---|---|---|
| `cascade` | Anak agregat: catatan absensi, agenda, assignee, versi dokumen | Menghapus induk berarti anak tidak punya makna. |
| `set null` | Relasi opsional: `members.user_id`, `meetings.session_id`, `tasks.programId` | Data induk boleh hilang, data anak tetap. |
| `restrict` | Keuangan (`accounts`, `transactions`, `ledger_entries`, `financial_periods`) dan pemilik `programs`/`events` | Dilarang menghapus data yang dirujang catatan uang atau pemilik. |

---

## Catatan untuk AI agent

1. Bila menambah tabel baru, ikuti pola: `id: pk()`, `organization_id` + `references(... cascade)`,
   `dibuatPada()`, `diubahPada()`. Trigger `trg_updated_at` dibuat otomatis hanya untuk tabel yang
   punya kolom `diubah_pada`.
2. Jangan menambah foreign key manual ke `meetings` atau `events` dari `attendance_sessions`
   — kolom `meeting_id`/`event_id` di sana sengaja tanpa constraint agar migrasi urutannya fleksibel.
3. Semua kolom uang WAJIB memakai helper `uang()`. Jangan memakai `numeric` untuk nominal (kecuali
   skor 0–100 seperti `skor_kualitas` yang memang berkoma).
4. Indeks unik parsial (`uq_periode_aktif`, `uq_periode_keuangan_aktif`, `uq_role_global_kode`) mudah
   rusak bila seseorang menambah indeks unik biasa di kolom yang sama — periksa sebelum menambah.
5. `roles.cakupan_default` saat ini masih `NULL` untuk seluruh peran bawaan di basis data. Jangan
   mengandalkan kolom itu untuk otorisasi; cakupan efektif datang dari `role_permissions.cakupan`.
