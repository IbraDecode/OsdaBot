# Otorisasi: RBAC, Permission, dan Cakupan

Dokumen ini menjelaskan bagaimana OSDA memutuskan "siapa boleh melakukan apa".
Acuan kode: `packages/contracts/src/permissions.ts`,
`packages/db/src/schema/authorization.ts`,
`apps/api/src/auth/izin.service.ts`, dan
`apps/api/src/auth/guards/*`.

---

## 1. Prinsip Dasar

1. **Peran (role) bukan satu-satunya otorisasi.** Yang menentukan akhir adalah
   **permission + cakupan (scope)**. Peran hanyalah "paket izin" yang nyaman dikelola.
2. **Tidak ada daftar peran yang di-hardcode sebagai aturan.** `PERAN_BAWAAN` dan
   `MATRICS_PERAN` di `packages/contracts` hanyalah nilai awal untuk seed dan cadangan.
   Organisasi boleh membuat peran sendiri lewat tabel `roles`.
3. **Otorisasi selalu diperiksa di backend** pada tiga tingkat (lihat bagian 3).
4. **Sumber kebenaran = database.** `LayananIzin.muatIzinEfektif()` membaca
   `member_roles → roles → role_permissions → permissions`. Bila database belum berisi
   peran untuk anggota tersebut, baru dipakai `satukanIzinBawaan(['MEMBER'])` dari
   `@osda/auth` sebagai paket cadangan.

---

## 2. Permission

Permission selalu berbentuk `modul.aksi`. Daftar lengkap ada di
`packages/contracts/src/permissions.ts` (`PERMISSION`) — total **38 izin** yang
diseed ke tabel `permissions` (terverifikasi: 38 baris).

### Anggota
`member.read`, `member.write`, `member.archive`

### Absensi
`attendance.read`, `attendance.write`, `attendance.manage`

### Rapat
`meeting.read`, `meeting.create`, `meeting.manage`, `meeting.minutes.approve`

### Program kerja
`program.read`, `program.create`, `program.manage`, `program.approve`

### Tugas
`task.read`, `task.write`, `task.verify`

### Acara
`event.read`, `event.create`, `event.manage`

### Keuangan
`finance.read`, `finance.write`, `finance.approve`, `finance.export`

### Komunikasi
`communication.create`, `communication.publish`

### Dokumen
`document.create`, `document.approve`, `document.read`

### Pelaporan
`report.read`, `report.export`

### Persetujuan
`approval.read`, `approval.decide`

### Notifikasi
`notification.read`

### Sistem
`audit.read`, `settings.manage`, `integration.manage`, `period.manage`

Kolom `permissions.sensitif` menandai modul yang perubahannya perlu audit tambahan
(dilihat di `packages/db/src/cli/seed.ts` melalui `MODUL_SENSITIF`).

---

## 3. Tiga Tingkat Pemeriksaan

```
Tingkat 1 — ENDPOINT (guard)
   apps/api/src/auth/guards/izin.guard.ts
   Membaca metadata @Izin('...') dan mencocokkannya dengan klaim `perms` di dalam
   token. Tidak ada query database pada tahap ini.

Tingkat 2 — SERVICE (operasi yang diizinkan)
   Helper `pastikanIzin(pengguna, [...])` di berkas guard yang sama.
   Dipakai ketika satu service method bisa dipanggil dari beberapa endpoint dengan
   syarat berbeda, atau ketika izin baru diketahui setelah data dibaca.

Tingkat 3 — RESOURCE (objek spesifik)
   Pemeriksaan kepemilikan/komposisi objek: apakah anggota ini anggota divisi
   tujuan? apakah sesi absensi itu milik organisasi aktif? apakah pengumuman itu
   ditujukan kepadanya? Gagal di sini memakai kode OBJECT_ACCESS_DENIED atau
   SCOPE_DENIED.
```

### Detail Tingkat 1

- `IzinGuard` membaca `KUNCI_IZIN` dari handler lalu kelas (`getAllAndOverride`).
- Bila route bertanda `@Publik()`, guard langsung mengembalikan `true`.
- Bila tidak ada metadata izin, guard juga mengembalikan `true` — **jangan** biarkan
  endpoint tulis tanpa metadata.
- Semua izin yang diminta harus terpenuhi (**AND**). Untuk logika "salah satu dari",
  buat decorator khusus.
- Galatnya `galatIzinDitolak(...)` dengan pesan yang menyebut izin mana yang kurang.
- `JwtAuthGuard` berjalan sebelum `IzinGuard`; bila token tidak ada, `IzinGuard`
  melempar `galatBelumMasuk()`.

Urutan guard global di `bootstrap.ts`:

```
JwtAuthGuard  →  IzinGuard  →  OrganizationGuard  →  RoleCodeGuard
```

`OrganizationGuard` menentukan `organizationId` dari header `x-organization-id`
(bila kosong, ambil organisasi pertama milik pengguna) dan menolak bila pengguna
meminta organisasi yang bukan miliknya. `RoleCodeGuard` dipakai untuk kasus khusus
yang benar-benar menuntut kode peran (jarang).

---

## 4. Cakupan (Scope)

Cakupan didefinisikan di `CAKUPAN` (`packages/contracts/src/permissions.ts`) dan
menjadi enum database `cakupan`:

| Cakupan | Arti | Contoh pemakaian |
|---|---|---|
| `OWN` | Hanya miliknya sendiri | Anggota melihat tugas sendiri, notifikasi sendiri. |
| `DIVISION` | Seluruh anggota divisi yang ia kelola | Koordinator Bidang mengelola anggota divisinya. |
| `ORGANIZATION` | Seluruh organisasi | Sekretaris mengelola anggota, rapat, surat. |
| `FINANCE` | Seluruh data keuangan | Bendahara membaca/menulis kas; tidak melihat absensi. |
| `SYSTEM` | Konfigurasi sistem & audit | `settings.manage`, `integration.manage`, `audit.read`. |

### Cakupan disimpan per tautan, bukan per peran

Tabel `role_permissions` punya kolom `cakupan` dan primary key komposit
`(role_id, permission_id, cakupan)`. Ini disengaja: satu permission bisa berlaku
`OWN` untuk satu peran dan `ORGANIZATION` untuk peran lain.

Contoh hasil seed (`cakupanUntuk` di `packages/db/src/cli/seed.ts`):

```
izin finance.*            → cakupan FINANCE
izin settings.*/integration.*/audit.*  → cakupan SYSTEM
izin lainnya              → memakai cakupan milik peran tersebut
```

### Cakupan ditegakkan di mana?

- **Guard** hanya memeriksa *izin*, bukan cakupan.
- **Cakupan** ditegakkan di lapisan service:
  - `apps/api/src/common/utilitas/konteks.ts` → `pastikanOrganisasiAktif()` menolak
    bila organisasi tujuan bukan milik pengguna.
  - Service memfilter berdasarkan `divisionId`/`memberId` milik pengguna.
  - Gagal kueri cakupan memakai `galatIzinDitolak(...)` yang berarti
    `SCOPE_DENIED`/`OBJECT_ACCESS_DENIED`.
- `LayananIzin` mengembalikan `scopes` (gabungan cakupan dari seluruh peran pengguna)
  dan dimasukkan ke dalam token sehingga klien bisa menyembunyikan menu, tetapi
  **keputusan akhir tetap di server**.

---

## 5. Resolusi Izin Efektif

`apps/api/src/auth/izin.service.ts` menjalankan urutan berikut:

```
1. Ambil baris users.
2. Ambil seluruh members milik user (satu orang bisa anggota beberapa organisasi).
3. Tentukan anggota aktif (status ACTIVE, kalau tidak ada ambil yang pertama).
4. Ambil peran aktif dari member_roles:
      dicabut_pada IS NULL
      AND (selesai_pada IS NULL OR selesai_pada >= hari ini)
5. Lengkapi pewarisan peran lewat roles.warisi_dari_kode,
   maksimal MAKS_WARISAN = 4 tingkat (mencegah siklus tak berujung).
6. Gabungkan izin & cakupan dari role_permissions + permissions.
7. Bila tidak ada peran sama sekali → pakai paket bawaan MEMBER.
```

Hasilnya (`IzinEfektif`) berisi: `userId`, `nama`, `status`, `memberId`,
`organizationIds`, `peran[]` (kode, nama, cakupan), `izin[]`, `scopes[]`.

### Masuk ke token

`apps/api/src/auth/token.service.ts` menaruh klaim berikut ke dalam access token (JWT HS256):

| Klaim | Isi |
|---|---|
| `sub` | ID `users`. |
| `memberId`, `nama` | Ditambahkan agar penulisan data tidak perlu query tambahan per permintaan. |
| `org` | Daftar ID organisasi milik pengguna. |
| `roles` | Daftar kode peran. |
| `perms` | Daftar izin efektif. |
| `scopes` | Daftar cakupan efektif. |
| `jti`, `sid`, `typ` | Identitas token, identitas sesi, tipe token (`access`). |

Karena `perms` ada di dalam token, `IzinGuard` tidak perlu menyentuh database —
permintaan tetap cepat. Konsekuensinya: **setelah peran seseorang diubah, token lamanya
masih berlaku sampai kedaluwarsa**. Untuk mencabut segera, cabut sesinya
(`sessions.dicabut_pada`) atau hapus peran di `member_roles`.

---

## 6. Delegasi

Tabel `delegations` memungkinkan seorang anggota meminjamkan wewenangnya untuk sementara
(mis. Ketua berhalangan, Wakil menjalankan persetujuan). Aturan penting:

- Delegasi **tidak menambah izin baru** — hanya meneruskan izin yang sudah dimiliki pemberi.
- Selalu punya `mulai_pada` dan `selesai_pada`; `permission_id` boleh `NULL` artinya
  semua izin pemberi.
- `dicabut_pada` menghentikan delegasi sebelum waktunya.
- Pengisi `alasan` wajib, dan baris membawa `versi_baris`.

---

## 7. Peran Bawaan vs Peran Organisasi

| Jenis | `organization_id` | `bawaan` | Keterangan |
|---|---|---|---|
| Peran bawaan | `NULL` | `true` | Sepuluh peran global; indeks unik parsial `uq_role_global_kode`. Tidak boleh dihapus. |
| Peran organisasi | terisi | `false` | Bebas dibuat; indeks unik parsial `uq_role_org_kode`. Bisa `warisi_dari_kode` dari peran lain. |

Kolom lain pada `roles` yang perlu diketahui:

- `tingkat_jabatan` — membatasi peran pada tingkat jabatan tertentu (mis. koordinator).
- `tunggal` — peran yang tidak boleh dipegang lebih dari satu orang.
- `cakupan_default` — cakupan bila permission tidak mencantumkan cakupan.
  **Catatan nyata:** pada basis data saat ini kolom ini masih `NULL` untuk seluruh
  peran bawaan, sehingga `LayananIzin` memakai fallback `'OWN'`. Jangan bergantung
  pada kolom ini sebelum seed diperbarui.
- `urutan` — urutan tampilan.

---

## 8. Contoh Perhitungan Izin

```
Anggota "Ni Putu Ayu Reva Septiari" (M-0006) punya peran TREASURER.

member_roles  → role_id peran TREASURER (period_id = periode aktif)
roles         → kode = 'TREASURER', bawaan = true, cakupan_default = NULL
role_permissions → 11 tautan izin:
   finance.read, finance.write, finance.export, program.read, event.read,
   report.read, report.export, approval.read, document.read,
   notification.read, member.read
   setiap tautan bercakupan FINANCE: sesuai cakupanUntuk() untuk izin finance.*,
   sisanya memakai cakupan bawaan paket TREASURER = ['FINANCE']

IzinEfektif:
   peran  : [{ kode: 'TREASURER', nama: 'Bendahara', cakupan: ['FINANCE'] }]
   izin   : 11 izin di atas
   scopes : ['FINANCE']
```

Akibatnya ia **tidak bisa**: membuka/menutup sesi absensi (`attendance.manage`),
membuat rapat (`meeting.create`), membuat tugas (`task.write`), memberi peran kepada
orang lain (tidak ada izin `settings.manage`), atau menyetujui pengajuannya sendiri
(dilarang juga oleh trigger database `trg_no_self_approval_expense`).

---

## 9. Daftar Periksa Saat Menambah Endpoint

1. Tambahkan `@Izin('modul.aksi')` — jangan pernah mengandalkan `@Publik()` untuk data internal.
2. Tentukan apakah endpoint membaca milik sendiri (`OWN`) atau milik organisasi
   (`ORGANIZATION`). Tambahkan filter `divisionId`/`memberId` bila perlu.
3. Untuk modul keuangan, pastikan minimal memakai `finance.*` **dan** cakupan `FINANCE`.
4. Untuk modul sistem (`settings`, `integration`, `audit`, `period`), pastikan cakupan `SYSTEM`.
5. Tulis pemeriksaan tingkat resource di service, bukan di controller.
6. Periksa apakah endpoint perlu audit otomatis (sudah otomatis untuk POST/PATCH/PUT/DELETE).

---

## Catatan untuk AI agent

1. Jangan memindahkan seluruh peran ke kode. Bila Anda perlu peran baru, buat baris di tabel
   `roles` + `role_permissions` (bisa lewat seed) alih-alih menambah nama peran di TypeScript.
2. Jangan menambah pemeriksaan `if (pengguna.roles.includes('SUPER_ADMIN'))` di service.
   Ganti dengan pemeriksaan izin. `RoleCodeGuard` hanya untuk kasus yang benar-benar butuh
   kode peran.
3. Karena `perms` ada di dalam token, perubahan peran tidak langsung menghapus akses token yang
   sudah terbit. Bila fitur Anda menuntut pencabutan seketika, cabut sesi di tabel `sessions`.
4. Saat menyemai peran baru, ingat bahwa `role_permissions` memakai PK komposit
   `(role_id, permission_id, cakupan)` — memasukkan kombinasi yang sama dua kali akan gagal.
5. `LayananIzin.MAKS_WARISAN = 4`. Bila rantai pewarisan peran lebih dari empat tingkat,
   peran terjauh akan diabaikan tanpa peringatan.
