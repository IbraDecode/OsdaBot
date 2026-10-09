# Matriks Peran (Role Matrix)

Dokumen ini memetakan sepuluh peran bawaan OSDA. Daftar izin diambil langsung dari
`MATRICS_PERAN` di `packages/contracts/src/permissions.ts`; jumlah baris
`role_permissions` yang terverifikasi di database juga dicantumkan untuk memastikan
seed berjalan benar.

> **Peringatan:** peran di bawah hanyalah *paket izin bawaan*. Otorisasi akhir selalu
> memakai **permission + cakupan** (lihat `AUTHORIZATION.md`). Organisasi bebas membuat
> peran baru lewat tabel `roles`.

---

## 1. Ringkasan

| Peran | Nama tampil | Jumlah izin | Cakupan bawaan | Baris `role_permissions` | Ruang kerja Web |
|---|---|---|---|---|---|
| `SUPER_ADMIN` | Administrator Sistem | 38 (semua) | OWN, DIVISION, ORGANIZATION, FINANCE, SYSTEM | 162 | `SYSTEM` |
| `ADVISOR` | Pembina | 19 | DIVISION, ORGANIZATION, FINANCE | 53 | `EXECUTIVE` |
| `CHAIRPERSON` | Ketua | 30 | ORGANIZATION, FINANCE | 58 | `EXECUTIVE` |
| `VICE_CHAIRPERSON` | Wakil Ketua | 23 | DIVISION, ORGANIZATION | 46 | `OPERATIONS` |
| `SECRETARY` | Sekretaris | 23 | ORGANIZATION | 23 | `ADMINISTRATION` |
| `TREASURER` | Bendahara | 11 | FINANCE | 11 | `FINANCE` |
| `PR` | Humas | 13 | DIVISION, ORGANIZATION | 26 | `COMMUNICATION` |
| `COORDINATOR` | Koordinator Bidang | 18 | DIVISION | 18 | `DIVISION` |
| `STAFF` | Staf | 13 | DIVISION | 13 | `OPERATIONS` |
| `MEMBER` | Anggota | 11 | OWN | 11 | `PERSONAL` |

Ruang kerja diambil dari `RUANG_KERJA_PERAN`. **Penting:** sidebar Web disusun dari
permission, bukan dari nama ruang kerja — lihat `WEB.md`.

---

## 2. SUPER_ADMIN — Administrator Sistem

**Tujuan.** Mengelola organisasi, pengguna, peran, integrasi, pengaturan, dan audit.
Ini satu-satunya peran yang memegang seluruh izin.

**Akses.**
- Seluruh 38 permission, termasuk `settings.manage`, `integration.manage`,
  `period.manage`, dan `audit.read`.
- Semua cakupan: `OWN`, `DIVISION`, `ORGANIZATION`, `FINANCE`, `SYSTEM`.

**Dilarang / batasan.**
- Tidak boleh menjadi "pintu belakang" untuk melewati invariant. Bahkan SUPER_ADMIN
  tidak dapat mengubah `ledger_entries` (trigger `trg_ledger_immutable`), menghapus
  `audit_logs` (`trg_audit_append_only`), atau menyetujui pengajuannya sendiri
  (`trg_no_self_approval_expense`).
- Tidak boleh menghapus anggota yang punya histori — pakai arsip (`member.archive`).
- Karena memegang `audit.read`, setiap tindakannya sendiri tercatat; jangan memakai akun
  ini untuk operasi harian. Buat akun per peran yang sesuai.

---

## 3. ADVISOR — Pembina

**Tujuan.** Memberi bimbingan, memantau kinerja, dan menyetujui hal sensitif.

**Akses.**
- Membaca anggota, absensi, rapat, program, tugas, acara, dokumen, keuangan, laporan.
- `attendance.manage` — boleh menangani sesi absensi.
- `meeting.manage` dan `meeting.minutes.approve` — mengelola rapat dan menyetujui notulen.
- `program.approve` — menyetujui program kerja.
- `task.verify` — memverifikasi tugas.
- `approval.read` dan `approval.decide` — ikut serta dalam alur persetujuan.
- `audit.read` — memantau jejak audit.
- Cakupan: `DIVISION`, `ORGANIZATION`, `FINANCE`.

**Dilarang.**
- Tidak memiliki `member.write` maupun `member.archive` — tidak boleh menambah/mengubah/mengarsipkan anggota.
- Tidak memiliki izin keuangan tulis: `finance.write`, `finance.approve`, `finance.export` tidak dimilikinya.
- Tidak memiliki `settings.manage`, `integration.manage`, atau `period.manage`.
- Tidak boleh membuat rapat baru (`meeting.create`) ataupun program (`program.create`).
- Sebagai pemberi persetujuan, tidak boleh menjadi pemohon pada objek yang sama.

---

## 4. CHAIRPERSON — Ketua

**Tujuan.** Memimpin dan melihat keseluruhan kondisi organisasi.

**Akses.**
- Anggota: `member.read`, `member.write` (bukan arsip).
- Absensi: `attendance.read`, `attendance.manage`.
- Rapat: keempat izin rapat termasuk `meeting.minutes.approve`.
- Program: `program.read`, `program.create`, `program.manage`, `program.approve`.
- Tugas: `task.read`, `task.write`, `task.verify`.
- Acara: `event.read`, `event.create`, `event.manage`.
- Keuangan: `finance.read`, `finance.approve` (menyetujui, bukan mencatat).
- Dokumen: `document.read`, `document.create`, `document.approve`.
- Komunikasi: `communication.create`, `communication.publish`.
- Laporan: `report.read`, `report.export`.
- Persetujuan: `approval.read`, `approval.decide`.
- Cakupan: `ORGANIZATION`, `FINANCE`.

**Dilarang.**
- Tidak memiliki `member.archive` — mengarsipkan anggota adalah wewenang Sekretaris.
- Tidak memiliki `finance.write` — Ketua **menyetujui**, tetapi tidak mencatat transaksi
  kas. Pemisahan ini mencegah satu orang mengendalikan seluruh alur uang.
- Tidak memiliki `task.create` khusus; namun `task.write` sudah mencakup pembuatan.
- Tidak memiliki `settings.manage`, `integration.manage`, `period.manage`, `audit.read`.
- Tidak boleh menyetujui pengajuan yang ia ajukan sendiri (trigger database + aturan
  pemohon ≠ pemberi persetujuan).

---

## 5. VICE_CHAIRPERSON — Wakil Ketua

**Tujuan.** Mengendalikan operasional: menelusuri apa yang belum selesai.

**Akses.**
- Anggota: `member.read`.
- Absensi: `attendance.read`, `attendance.manage`.
- Rapat: `meeting.read`, `meeting.create`, `meeting.manage` (bukan `meeting.minutes.approve`).
- Program: `program.read`, `program.create`, `program.manage`, `program.approve`.
- Tugas: `task.read`, `task.write`, `task.verify`.
- Acara: `event.read`, `event.create`, `event.manage`.
- Dokumen: `document.read`, `document.create` (bukan `document.approve`).
- Komunikasi: `communication.create` (bukan `communication.publish`).
- Laporan: `report.read`.
- Persetujuan: `approval.read`, `approval.decide`.
- Cakupan: `DIVISION`, `ORGANIZATION`.

**Dilarang.**
- Tidak memiliki `meeting.minutes.approve` — persetujuan notulen ada pada Ketua, Sekretaris, dan Pembina.
- Tidak memiliki `member.write` maupun `member.archive`.
- Tidak memiliki akses keuangan sama sekali (`finance.*` tidak ada).
- Tidak memiliki `communication.publish` dan `document.approve`.
- Tidak memiliki `report.export` — ekspor laporan adalah wewenang lain.

---

## 6. SECRETARY — Sekretaris

**Tujuan.** Pusat administrasi organisasi: anggota, rapat, notulen, surat, arsip.

**Akses.**
- Anggota: `member.read`, `member.write`, `member.archive`.
- Absensi: `attendance.read`, `attendance.write`, `attendance.manage`.
- Rapat: `meeting.read`, `meeting.create`, `meeting.manage`.
- Program: `program.read`, `program.create`.
- Tugas: `task.read`, `task.write`.
- Acara: `event.read`, `event.create`.
- Dokumen: `document.read`, `document.create`, `document.approve`.
- Laporan: `report.read`, `report.export`.
- Persetujuan: `approval.read`, `approval.decide`.
- Cakupan: `ORGANIZATION`.

**Dilarang.**
- Tidak memiliki `meeting.minutes.approve` — Sekretaris menulis notulen, tetapi tidak
  menyalakannya sendiri (pemisahan penulis & penyetuju).
- Tidak memiliki `program.manage`, `program.approve`, `task.verify`.
- Tidak memiliki akses keuangan (`finance.*`) dan tidak memiliki `event.manage`.
- Tidak memiliki `communication.*`, `settings.manage`, `period.manage`, `audit.read`.

---

## 7. TREASURER — Bendahara

**Tujuan.** Mengelola keuangan organisasi. Deskripsi di kontrak menyatakan tegas:
**"TIDAK boleh mengubah absensi, peran, atau konfigurasi sistem."**

**Akses.**
- Keuangan: `finance.read`, `finance.write`, `finance.export`.
- Membaca `program.read`, `event.read` (untuk konteks anggaran).
- `report.read`, `report.export`.
- `approval.read`, `document.read`, `notification.read`, `member.read`.
- Cakupan: `FINANCE`.

**Dilarang — ini bagian terpenting dari dokumen ini.**
- **Tidak boleh mengubah absensi.** Tidak memiliki `attendance.write`, `attendance.manage`,
  maupun `attendance.read`. Ia tidak bisa membuka/menutup sesi, tidak bisa mencatat kehadiran,
  dan tidak bisa mengubah catatan kehadiran secara manual.
- **Tidak boleh mengubah peran.** Tidak memiliki `settings.manage` maupun izin apa pun
  atas `roles`, `member_roles`, `permissions`.
- **Tidak boleh mengubah konfigurasi sistem.** Tidak memiliki `settings.manage`,
  `integration.manage`, `period.manage`, `audit.read`.
- **Tidak boleh menyetujui pengajuannya sendiri.** Trigger `trg_no_self_approval_expense`
  dan `trg_no_self_approval_reimburse` menolaknya di tingkat database.
- Tidak memiliki `finance.approve` — Bendahara mencatat & mengelola, tetapi persetujuan
  pengeluaran berada pada Ketua (melalui `approval.decide`). Selaras dengan
  `DEFAULT_AMBANG_PERSETUJUAN` di `packages/contracts/src/finance.ts`.

---

## 8. PR — Humas

**Tujuan.** Mengelola komunikasi internal dan eksternal. Kontrak menyatakan:
**"Tidak otomatis dapat keuangan."**

**Akses.**
- Komunikasi: `communication.create`, `communication.publish`.
- Anggota: `member.read` (untuk menentukan audiens).
- Acara: `event.read`, `event.create`.
- Dokumen: `document.read`, `document.create`, `document.approve`.
- Program: `program.read`.
- Laporan: `report.read`.
- Persetujuan: `approval.read`, `approval.decide`.
- Cakupan: `DIVISION`, `ORGANIZATION`.

**Dilarang.**
- Tidak memiliki satu pun izin `finance.*` — tidak bisa melihat kas, transaksi, maupun
  laporan keuangan.
- Tidak memiliki `event.manage`, `meeting.*`, `attendance.*`, `task.*`.
- Tidak memiliki `member.write` maupun `member.archive`.
- Tidak memiliki `settings.manage`, `period.manage`, `audit.read`.

---

## 9. COORDINATOR — Koordinator Bidang

**Tujuan.** Mengelola satu bidang/divisi: anggota, tugas, program, absensi, laporan.

**Akses.**
- Anggota: `member.read`.
- Absensi: `attendance.read`, `attendance.write` (bukan `attendance.manage` — tidak bisa
  membuat/membuka/menutup sesi).
- Rapat: `meeting.read`, `meeting.create`.
- Program: `program.read`, `program.create`, `program.manage`.
- Tugas: `task.read`, `task.write`, `task.verify`.
- Acara: `event.read`, `event.create`, `event.manage`.
- Dokumen: `document.read`, `document.create`.
- Laporan: `report.read`.
- Cakupan: `DIVISION` — semuanya dibatasi divisi yang ia kelola.

**Dilarang.**
- Tidak memiliki `attendance.manage`: tidak boleh membuat sesi absensi, menerbitkan token
  QR, mengubah catatan kehadiran secara manual, maupun menutup sesi.
- Tidak memiliki `program.approve` — persetujuan program ada pada Ketua/Wakil/Pembina.
- Tidak memiliki `meeting.manage` dan `meeting.minutes.approve`.
- Tidak memiliki `member.write` dan seluruh izin keuangan.
- Tidak memiliki `report.export`, `communication.*`, `document.approve`.

---

## 10. STAFF — Staf

**Tujuan.** Mendukung operasional harian tanpa hak persetujuan.

**Akses.**
- Anggota: `member.read`.
- Absensi: `attendance.read`, `attendance.write`.
- Rapat: `meeting.read`, `meeting.create`.
- Tugas: `task.read`, `task.write`.
- Acara: `event.read`, `event.create`.
- Dokumen: `document.read`, `document.create`.
- Komunikasi: `communication.create`.
- Cakupan: `DIVISION`.

**Dilarang.**
- Tidak memiliki hak persetujuan apa pun: tanpa `approval.decide`, `task.verify`,
  `document.approve`, `finance.approve`, `meeting.minutes.approve`.
- Tidak memiliki `attendance.manage`, dan tidak memiliki izin program apa pun
  (STAFF tidak punya `program.read`, `program.create`, maupun `program.manage`).
- Tidak memiliki `event.manage`, `member.write`, `report.*`.

---

## 11. MEMBER — Anggota

**Tujuan.** Berpartisipasi: absen, mengerjakan tugas, mengikuti acara, membaca pengumuman.

**Akses.**
- `member.read`, `attendance.read`, `attendance.write` (menandai kehadiran sendiri).
- `meeting.read`, `task.read`, `task.write`.
- `event.read`, `program.read`.
- `document.read`.
- `finance.read` (transparansi kas kepada anggota).
- `notification.read`.
- Cakupan: `OWN`.

**Dilarang.**
- Tidak memiliki `attendance.manage` — anggota tidak boleh membuka/menutup sesi,
  menerbitkan QR, atau mengubah catatan kehadiran orang lain.
- Tidak memiliki `task.verify` — anggota menandai tugas selesai (`DONE`), tetapi
  verifikasi dilakukan orang lain.
- Tidak memiliki `meeting.create`, `event.create`, `program.create`,
  `communication.*`, `document.create`, `report.*`, `approval.*`.

---

## 12. Pemisahan Wewenang yang Perlu Dijaga

| Pemisahan | Siapa yang bertindak | Siapa yang tidak boleh |
|---|---|---|
| Mencatat vs menyetujui pengeluaran | Bendahara (`finance.write`) | Ketua menyetujui (`finance.approve`) — Bendahara tidak boleh menyetujui punnya sendiri |
| Menulis vs menyetujui notulen | Sekretaris (`meeting.create`) | `meeting.minutes.approve` hanya dimiliki Ketua & Pembina (di luar SUPER_ADMIN) — bukan penulisnya |
| Mengerjakan vs memverifikasi tugas | Assignee (`task.write`) | `task.verify` harus orang lain |
| Mengajukan vs memutuskan izin tidak hadir | Anggota (`attendance.write`) | `permission_requests` diputuskan pengurus dengan `attendance.manage` |
| Mengubah data vs mengubah peran | Sekretaris/Ketua | Hanya `settings.manage`/`period.manage` yang mengubah struktur |

---

## Catatan untuk AI agent

1. Jangan pernah menambah cabang berdasarkan `pengguna.roles.includes('TREASURER')`.
   Pakai pemeriksaan izin — matriks ini bisa berubah lewat database.
2. Bila menambah izin baru, perbarui `PERMISSION` di `packages/contracts` **dan**
   tambahkan ke paket peran yang relevan di `MATRICS_PERAN`, lalu seed ulang.
   Jangan lupa bahwa jumlah baris `role_permissions` akan berubah.
3. `MEMBER` sengaja memiliki `finance.read` dengan cakupan `OWN` — jangan "memperbaiki"
   ini menjadi `FINANCE` tanpa alasan produk; transparansi iuran adalah fitur.
4. Saat menambah endpoint absensi, ingat bahwa `attendance.write` dan
   `attendance.manage` adalah dua izin berbeda: anggota/koordinator/staf punya `write`
   untuk mencatat kehadiran, tetapi hanya `manage` boleh membuat/mengubah sesi.
5. Setiap kali Anda menambah aturan "X tidak boleh Y", tulis juga invariant/trigger-nya di
   `packages/db/src/sql/invariants.ts` bila bisa ditegakkan database — matriks di dokumen
   ini adalah dokumentasi, bukan penjaga.
