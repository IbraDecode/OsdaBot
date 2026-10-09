# Indeks Dokumen OSDA

Daftar seluruh dokumen di `docs/`, masing-masing dengan satu baris deskripsi dan
"Atom" terkait: nama tabel, nama permission, atau nama berkas kode yang menjadi acuan
utama. Gunakan berkas ini sebagai peta untuk menemukan dokumen yang perlu diubah.

---

## Dokumen Utama

| Berkas | Satu baris deskripsi | Atom terkait |
|---|---|---|
| `ARCHITECTURE.md` | Susunan monorepo `apps/*` + `packages/*`, alur satu permintaan, dan lapisan Client → API → Auth → Authorization → Application → Domain → Repository → Database. | `apps/api/src/bootstrap.ts`, `packages/db/src/schema/index.ts`, `scheduler.service.ts` |
| `DOMAIN_MODEL.md` | Entitas inti, batas agregat, invariant database, dan alasan pemisahan User/Identity/Member (spec §06). | `packages/db/src/schema/identity.ts`, `packages/db/src/schema/*` |
| `DATABASE.md` | Semua 74 tabel dikelompokkan per modul, index unik penting, dan ketergantungan foreign key. | `packages/db/src/schema/*.ts`, `packages/db/src/schema/_base.ts` |

## API & Otorisasi

| Berkas | Satu baris deskripsi | Atom terkait |
|---|---|---|
| `API.md` | Daftar endpoint `/api/v1/*` per modul beserta izin, format pagination/filter/sorting, dan bentuk galat `{error:{code,message,requestId}}`. | `apps/api/src/modules/*/*.controller.ts`, `packages/contracts/src/common.ts` |
| `AUTHORIZATION.md` | RBAC + permission + scope, tiga tingkat pemeriksaan (endpoint, service, resource), resolusi izin efektif, dan delegasi. | `packages/contracts/src/permissions.ts`, `apps/api/src/auth/izin.service.ts`, `apps/api/src/auth/guards/izin.guard.ts` |
| `ROLE_MATRIX.md` | Tabel sepuluh peran bawaan: tujuan, akses, dan apa yang DILARANG (mis. Bendahara tidak boleh ubah absensi/peran/konfigurasi). | `MATRICS_PERAN`, `RUANG_KERJA_PERAN`, `packages/db/src/cli/seed.ts` |

## Modul Operasional

| Berkas | Satu baris deskripsi | Atom terkait |
|---|---|---|
| `ATTENDANCE.md` | Alur absensi, jenis sesi, status `PRESENT/LATE/EXCUSED/SICK/ABSENT`, sumber `WEB/MOBILE/WHATSAPP/ADMIN/QR`, token QR, dan tiga lapis idempotensi. | `packages/db/src/schema/attendance.ts`, `apps/api/src/modules/attendance/attendance.service.ts` |
| `MEETINGS.md` | Rapat, agenda, peserta, notulen beserta versioning `DRAFT→REVIEW→APPROVED→ARCHIVED` dan item tindakan yang bisa menjadi tugas. | `packages/db/src/schema/meetings.ts`, `meeting.minutes.approve` |
| `PROGRAMS.md` | Program kerja, status & transisi sah, ruang kerja program, timeline & milestone, tim, dan evaluasi. | `packages/db/src/schema/programs.ts`, `TRANSISI_PROGRAM`, `TRANSISI_KOREKSI_PROGRAM` |
| `TASKS.md` | Status tugas, aturan `DONE ≠ VERIFIED`, validasi transisi, dan verifikasi oleh `task.verify`. | `packages/db/src/schema/tasks.ts`, `TRANSISI_TUGAS`, `bolehTransisiTugas` |
| `FINANCE.md` | Chart of accounts, ledger immutable, buku kas dihitung dari ledger, anggaran, reimbursement, persetujuan (pemohon ≠ pemberi), QRIS idempotent, dan ambang persetujuan. | `packages/db/src/schema/finance.ts`, `osda_ledger_immutable`, `DEFAULT_AMBANG_PERSETUJUAN`, `trg_payment_settle_once` |
| `DOCUMENTS.md` | Metadata di DB, berkas di object storage privat, versi & penguncian, signed URL, validasi MIME/ukuran, dan surat masuk/keluar. | `packages/db/src/schema/documents.ts`, `trg_dokumen_versi_locked`, `ix_documents_fts` |
| `COMMUNICATION.md` | Pengumuman, audiens, kanal, alur `DRAFT→REVIEW→APPROVED→SCHEDULED→PUBLISHED→ARCHIVED`, dan pelacakan pengiriman. | `packages/db/src/schema/system.ts`, `notification_deliveries`, `packages/notifications/src/penyedia.ts` |

## Klien

| Berkas | Satu baris deskripsi | Atom terkait |
|---|---|---|
| `WHATSAPP.md` | Bot Baileys: perintah anggota (`HADIR/IZIN/SAKIT/STATUS/AGENDA/TUGAS/KAS`) & pengurus (`/rekap`, `/rapat`, `/tugas`, `/program`, `/kas`, `/absenin`, `/daftarin`, `/listanggota`), dan alur resolver identitas. | `apps/bot/src/router.ts`, `apps/bot/src/services/identity-resolver.ts`, `apps/bot/src/api/client.ts` |
| `MOBILE.md` | Rencana aplikasi Expo: quick actions, alur absensi QR, pembayaran kas, dan keamanan OWASP MASVS. | `apps/mobile/` (kosong), `SkemaCatatHadir`, `notification_deliveries` |
| `WEB.md` | Rencana Next.js: sidebar dinamis berdasarkan permission, dasbor per peran, dan penanganan galat. | `packages/contracts/src/dashboard.ts`, `RUANG_KERJA_PERAN`, `GET /api/v1/users/me` |

## Keamanan & Operasi

| Berkas | Satu baris deskripsi | Atom terkait |
|---|---|---|
| `SECURITY.md` | Autentikasi & rotasi token, rate limiting, CORS, header keamanan, hashing argon2id, batas masukan, dan pemetaan OWASP API Security Top 10. | `apps/api/src/bootstrap.ts`, `apps/api/src/auth/token.service.ts`, `packages/auth` |
| `AUDIT.md` | Audit log append-only, kolom rahasia yang tidak direkam, dan contoh isi baris audit. | `audit_logs`, `AuditInterceptor`, `catatAudit`, `trg_audit_append_only` |
| `MIGRATION.md` | Proses migrasi OSDA BOT v0.4 → v2 beserta hasil rekonsiliasi nyata (49 anggota, 10 sesi, 470 absensi, 3 periode kas, 11 pembayaran lunas, 33 entri ledger). | `tools/legacy/scripts/migrate-to-v2.mjs`, `tools/legacy/scripts/reconcile.mjs`, `legacy_id_mappings` |
| `DISASTER_RECOVERY.md` | Backup, restore, uji pemulihan, RTO/RPO, prosedur per skenario, dan verifikasi cadangan dari `~/osda-backup/`. | `pg_dump`/`pg_restore`, `~/osda-backup/`, `pnpm legacy:reconcile` |

---

## Cara Memakai Indeks Ini

1. Sebelum mengubah kode, cari dokumen yang "Atom terkait"-nya menyebut berkas/tabel
   tersebut.
2. Baca bagian **"## Catatan untuk AI agent"** di akhir dokumen — di sanalah jebakan
   khusus modul itu didokumentasikan.
3. Bila Anda mengubah tabel, permission, atau nama berkas yang tercantum sebagai Atom,
   perbarui dokumen terkait di perubahan yang sama.

## Aturan Pemeliharaan

- Satu dokumen, satu modul. Jangan mencampur absensi dengan keuangan dalam satu berkas.
- Setiap dokumen wajib diakhiri bagian `## Catatan untuk AI agent` berisi 3–5 poin.
- Setiap klaim harus bisa ditelusuri ke nama tabel, nama permission, atau nama berkas
  yang benar-benar ada. Jangan menuliskan hal yang belum ada.
- Bila sebuah rancangan (mis. Web, Mobile) belum punya kode, tulis kata **rencana**
  secara eksplisit agar tidak disalahpahami sebagai sesuatu yang sudah berjalan.

## Catatan untuk AI agent

1. Bila Anda menambah dokumen baru, tambahkan barisnya di tabel di atas beserta "Atom
   terkait" yang mengarah ke nama tabel, nama permission, atau nama berkas kode.
2. Jangan menuliskan klaim yang tidak bisa ditelusuri ke kode. Bila ragu, cek berkasnya
   di `packages/`, `apps/`, atau `tools/` sebelum menulis.
3. Jaga konsistensi penomoran bagian di setiap dokumen; bila Anda menambah bagian,
   sesuaikan nomor berikutnya agar rujukan antarbagian tidak rusak.
