# Web Dashboard (Rencana)

> **Status:** aplikasi Web **belum ada kodenya**. Direktori `apps/web` masih kosong.
> Dokumen ini adalah rencana teknis yang harus diikuti saat aplikasi dibuat, lengkap
> dengan kontrak yang **sudah ada** di `packages/contracts`. Jangan menganggap bagian
> di bawah sebagai sesuatu yang sudah berjalan.

---

## 1. Ringkasan Rencana

| Aspek | Rencana |
|---|---|
| Kerangka | Next.js (App Router), TypeScript |
| Bahasa | Bahasa Indonesia sepenuhnya untuk UI |
| Komunikasi | REST `fetch` ke `/api/v1/*` dengan token dari `/api/v1/auth/login` |
| State | Server Components untuk membaca, Server Actions/Route Handlers untuk menulis |
| Gaya | Tailwind CSS + komponen headless (pilihan tim) |
| Uji | Vitest untuk unit, Playwright untuk alur penting |

Tumpukan (stack) yang **tidak** dipakai: tidak ada ORM, tidak ada koneksi database
langsung dari Web, tidak ada perhitungan izin di sisi klien sebagai satu-satunya penjaga.

---

## 2. Arsitektur Usia Permintaan

```
Browser
  │
  ├─ Middleware Next.js
  │    · melampirkan Bearer token dari cookie httpOnly
  │    · mengirim header x-organization-id
  │    · mengalihkan ke /masuk bila belum login
  │
  ├─ Server Component (membaca)
  │    · memanggil API dengan token pengguna
  │    · memakai bentuk data dari @osda/contracts
  │
  ├─ Route Handler / Server Action (menulis)
  │    · memvalidasi dengan skema Zod yang sama dari @osda/contracts
  │    · meneruskan Idempotency-Key untuk operasi bernominal
  │
  └─ Client Component (interaktif)
       · hanya UI; tidak menyimpan izin sebagai sumber kebenaran
```

Prinsip: **semua keputusan otorisasi tetap di API.** Klien menyembunyikan menu
berdasarkan `perms` agar pengguna tidak frustasi, tetapi server tetap menolak.

---

## 3. Sidebar Dinamis Berdasarkan Permission

Aturannya: **sidebar disusun dari `perms`, bukan dari nama peran.**

### Sumber data

`GET /api/v1/users/me` mengembalikan:

```json
{
  "sub": "…", "nama": "…", "memberId": "…",
  "org": ["…"],
  "roles": ["TREASURER"],
  "perms": ["finance.read", "finance.write", "finance.export", "program.read", "…"],
  "scopes": ["FINANCE"]
}
```

### Pola pendaftaran menu

```ts
// contoh pola — BUKAN kode final
const MENU = [
  { label: 'Dasbor',        href: '/',                    izin: [] },
  { label: 'Anggota',       href: '/anggota',             izin: ['member.read'] },
  { label: 'Absensi',       href: '/absensi',             izin: ['attendance.read'] },
  { label: 'Rapat',         href: '/rapat',               izin: ['meeting.read'] },
  { label: 'Tugas',         href: '/tugas',               izin: ['task.read'] },
  { label: 'Program',       href: '/program',             izin: ['program.read'] },
  { label: 'Acara',         href: '/acara',               izin: ['event.read'] },
  { label: 'Keuangan',      href: '/keuangan',            izin: ['finance.read'] },
  { label: 'Dokumen',       href: '/dokumen',             izin: ['document.read'] },
  { label: 'Pengumuman',    href: '/pengumuman',          izin: ['communication.create'] },
  { label: 'Laporan',       href: '/laporan',             izin: ['report.read'] },
  { label: 'Audit',         href: '/audit',               izin: ['audit.read'] },
  { label: 'Pengaturan',    href: '/pengaturan',          izin: ['settings.manage'] },
];

const menuTerlihat = MENU.filter(
  (m) => m.izin.length === 0 || m.izin.every((i) => perms.includes(i)),
);
```

### Tingkat dinamis

| Tingkat | Cara | Catatan |
|---|---|---|
| Menu utama | Filter berdasarkan izin minimal | Satu izin cukup untuk akses umum. |
| Tab/sublab | Filter lebih spesifik | Mis. tab "Verifikasi" hanya tampil bila `task.verify` ada. |
| Tombol aksi | Filter per aksi | Tombol "Setujui" hanya tampil bila `approval.decide`/`finance.approve` ada. |
| Cakupan | Saring data | `scopes` menentukan apakah pengguna melihat seluruh organisasi atau hanya divisinya. |

### Ruang kerja per peran

`RUANG_KERJA_PERAN` (`packages/contracts/src/permissions.ts`) memberi ruang kerja
bawaan:

| Peran | Ruang kerja |
|---|---|
| `SUPER_ADMIN` | `SYSTEM` |
| `ADVISOR`, `CHAIRPERSON` | `EXECUTIVE` |
| `VICE_CHAIRPERSON`, `STAFF` | `OPERATIONS` |
| `SECRETARY` | `ADMINISTRATION` |
| `TREASURER` | `FINANCE` |
| `PR` | `COMMUNICATION` |
| `COORDINATOR` | `DIVISION` |
| `MEMBER` | `PERSONAL` |

Nilai ini menentukan **halaman awal** (landing) pengguna, bukan hak akses. Misalnya
Bendahara mendarat di `/keuangan`, Koordinator mendarat di `/divisi`.

---

## 4. Dasbor per Peran

Kontrak dasbor sudah ada lengkap di `packages/contracts/src/dashboard.ts`. Bentuk
respons **berbeda per peran** — jangan pernah menampilkan satu bentuk untuk semua orang.
Endpoint: `GET /api/v1/users/me/dashboard`.

| Peran | Tipe kontrak | `ruangKerja` | Isi utama |
|---|---|---|---|
| Ketua | `DasborKetua` | `EXECUTIVE` | Absensi hari ini, rapat hari ini, program (total/berjalan/selesai/terlambat/progres rata-rata), tugas per divisi, keuangan (saldo, pemasukan/pengeluaran bulan ini, utilisasi anggaran), persetujuan yang menunggu, tren absensi, aktivitas, pengumuman. |
| Wakil Ketua | `DasborWakil` | `OPERATIONS` | Tugas terlambat, terblokir, menunggu verifikasi, tanpa PIC; daftar per divisi; tren kehadiran; sesi tanpa rekap; follow-up (TUGAS/IZIN/PERSETUJUAN/LAPORAN); tenggat terdekat. |
| Sekretaris | `DasborSekretaris` | `ADMINISTRATION` | Administrasi: anggota, rapat, notulen, surat, arsip. |
| Bendahara | `DasborBendahara` | `FINANCE` | Kas, pemasukan/pengeluaran, reimbursement & pengeluaran menunggu persetujuan, iuran. |
| Humas | `DasborHumas` | `COMMUNICATION` | Pengumuman, kampanye, statistik pengiriman. |
| Koordinator | `DasborKoordinator` | `DIVISION` | Data satu divisi (`division`, `koordinator`), anggota aktif, tugas terlambat, program berjalan, persen kehadiran. |
| Anggota | `DasborAnggota` | `PERSONAL` | Absensi pribadi, tugas pribadi, pengumuman, status iuran. |

Bentuk umum dipakai bersama: `Kartu` (label, nilai, satuan, delta, arah, tautan,
peringatan), `TitikTren` (tanggal, nilai, label), dan `KonteksDasbor`
(`organizationId`, `periodId`, `periodNama`, `cakupan`, `batasWaktu`).

Panduan implementasi dasbor:

1. Pada server, pilih komponen dasbor berdasarkan `peran` pada respons API —
   **bukan** berdasarkan pengecekan izin di klien.
2. Gunakan `Kartu` untuk angka ringkas; beri `peringatan: true` untuk hal yang butuh
   tindakan (mis. tugas terlambat).
3. Semua tautan di dasbor harus mengarah ke halaman yang memang bisa diakses peran itu.
4. Jangan menampilkan angka keuangan kepada peran yang tidak punya `finance.read`.

---

## 5. Halaman Utama yang Direncanakan

| Jalur | Izin minimum | Isi |
|---|---|---|
| `/` | — | Dasbor sesuai peran. |
| `/masuk` | publik | Login email & sandi → `POST /api/v1/auth/login`. |
| `/anggota` | `member.read` | Daftar anggota + detail + formulir. |
| `/absensi` | `attendance.read` | Daftar sesi, buka/tutup (butuh `attendance.manage`), tampilan QR, rekap. |
| `/rapat` | `meeting.read` | Daftar rapat, agenda, peserta, notulen & versi. |
| `/tugas` | `task.read` | Papan tugas, detail, aktivitas, verifikasi (butuh `task.verify`). |
| `/program` | `program.read` | Daftar program, ruang kerja program, milestone, evaluasi. |
| `/acara` | `event.read` | Daftar acara, jadwal, peserta, absensi acara. |
| `/keuangan` | `finance.read` | Chart of accounts, kas, ledger, anggaran, pengajuan, reimbursement, pembayaran. |
| `/dokumen` | `document.read` | Daftar dokumen, versi, unggah, surat masuk/keluar. |
| `/pengumuman` | `communication.create` | Daftar pengumuman, kampanye, statistik pengiriman. |
| `/laporan` | `report.read` | Laporan absensi/anggota/keuangan/program/tugas + ekspor (`report.export`). |
| `/audit` | `audit.read` | Jejak audit. |
| `/pengaturan` | `settings.manage` | Organisasi, divisi, jabatan, periode, pengaturan, feature flag. |

---

## 6. Penanganan Galat & UX

Semua galat API punya bentuk `{ error: { code, message, requestId } }`.
Tampilkan ringkasnya:

| Kode | Tindakan UI |
|---|---|
| `UNAUTHENTICATED` / `TOKEN_EXPIRED` | Arahkan ke `/masuk` (halaman masuk). |
| `PERMISSION_DENIED` / `OBJECT_ACCESS_DENIED` / `SCOPE_DENIED` | Tampilkan halaman "tidak berwenang", jangan tunjukkan data. |
| `VALIDATION_FAILED` | Petakan `detail[].path` ke field formulir. |
| `ATTENDANCE_ALREADY_RECORDED` | Beri pesan bahwa absensi sudah tercatat, jangan kirim ulang. |
| `SESSION_CLOSED` / `SESSION_NOT_OPEN` | Matikan tombol absen. |
| `LEDGER_IMMUTABLE` / `DOCUMENT_VERSION_IMMUTABLE` | Tawarkan membuat koreksi/versi baru. |
| `RATE_LIMITED` | Tampilkan pesan sabar dan matikan tombol sementara. |
| `INTERNAL_ERROR` | Tampilkan `requestId` agar pengguna bisa melaporkannya. |

Jangan pernah menampilkan pesan galat teknikal (query SQL, stack trace) kepada pengguna.

---

## 7. Aturan Keamanan Sisi Klien

- Token akses **jangan** disimpan di `localStorage`. Simpan di cookie `httpOnly` yang
  dibuat oleh Route Handler.
- Refresh token hanya dikirim ke `/api/v1/auth/refresh`.
- Setiap permintaan membawa `x-organization-id`.
- Semua masukan formulir divalidasi dengan skema dari `@osda/contracts` agar pesan
  galatnya sama dengan server.
- Tautan dalam ke Mobile memakai `PUBLIC_API_URL`/`PUBLIC_WEB_URL`.

---

## Catatan untuk AI agent

1. Dokumen ini adalah **rencana**; jangan menulis kode yang mengasumsikan aplikasi Web
   sudah ada. Kalau membuat `apps/web`, mulai dari struktur folder dan konfigurasi dasar.
2. Sidebar harus berbasis `perms`. Jangan membuat sidebar berbasis `roles` — organisasi
   dapat membuat peran baru dan menu akan salah.
3. Dasbor harus memilih komponen berdasarkan `peran` pada respons API, bukan dengan
   menebak dari izin. Bentuk respons berbeda-beda per peran.
4. Jangan menampilkan data keuangan atau audit kepada peran yang tidak punya
   `finance.read`/`audit.read` — meskipun tombolnya disembunyikan.
5. Semua galat ditampilkan dari `error.code`/`error.message`; sertakan `requestId` untuk
   galat 500 agar bisa ditelusuri di log.
