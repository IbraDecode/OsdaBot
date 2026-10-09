# Program Kerja & Acara (Programs & Events)

Acuan kode: `packages/db/src/schema/programs.ts`,
`packages/contracts/src/programs.ts`, dan
`apps/api/src/modules/programs/programs.service.ts`.

Program adalah **modul utama** OSDA: satu program menyatukan timeline, tugas, tim,
anggaran, dokumen, rapat, pengumuman, absensi, pengeluaran, dan evaluasi dalam satu
tempat, supaya satu kegiatan OSIS tidak lagi tersebar di WhatsApp.

---

## 1. Program Kerja

Tabel `programs`:

| Kolom | Keterangan |
|---|---|
| `kode`, `nama` | Identitas program. `uq_program_kode` `(organization_id, kode)`. |
| `tujuan` | **Wajib diisi saat pengajuan.** |
| `latar_belakang`, `deskripsi` | Konteks. |
| `status` | `DRAFT`, `PROPOSED`, `APPROVED`, `PLANNED`, `RUNNING`, `COMPLETED`, `CANCELLED`. |
| `prioritas` | `LOW`, `NORMAL`, `HIGH`, `URGENT`. |
| `owner_member_id` | Pemilik program, **`on delete: restrict`** — program tidak boleh kehilangan pemilik. |
| `anggaran_diajukan`, `anggaran_disetujui` | Rupiah penuh. |
| `realisasi_pengeluaran` | Denormalisasi untuk laporan cepat; sumber kebenaran tetap `ledger_entries`. |
| `mulai_pada`, `selesai_pada` | Rencana. |
| `mulai_riwayat_pada`, `selesai_riwayat_pada` | Waktu nyata eksekusi (bisa berbeda dari rencana). |
| `indikator[]` | Indikator keberhasilan. |
| `progres` | 0–100, dipakai dasbor. |
| `total_tugas`, `tugas_selesai`, `total_acara` | Denormalisasi progres. |
| `diajukan_pada`, `disetujui_oleh`, `disetujui_pada`, `alasan_penolakan` | Alur pengajuan. |
| `dibatalkan_pada`, `alasan_pembatalan` | Alur pembatalan. |
| `template_id`, `warna`, `ikon`, `cover_url` | Tampilan. |
| `versi_baris` | Optimistic locking. |

---

## 2. Status Program & Transisi Sah

Dua peta transisi ada di `packages/contracts/src/programs.ts`:

### `TRANSISI_PROGRAM` (alur normal)

| Dari | Boleh ke |
|---|---|
| `DRAFT` | `PROPOSED`, `CANCELLED` |
| `PROPOSED` | `APPROVED`, `DRAFT`, `CANCELLED` |
| `APPROVED` | `PLANNED`, `CANCELLED` |
| `PLANNED` | `RUNNING`, `CANCELLED` |
| `RUNNING` | `COMPLETED`, `CANCELLED` |
| `COMPLETED` | *(tidak ada — terminal)* |
| `CANCELLED` | *(tidak ada — terminal)* |

### `TRANSISI_KOREKSI_PROGRAM` (koreksi oleh pengurus)

Memperbolehkan kembali ke status sebelumnya, misalnya:

| Dari | Boleh ke |
|---|---|
| `DRAFT` | `DRAFT`, `PROPOSED`, `CANCELLED` |
| `PROPOSED` | `PROPOSED`, `APPROVED`, `DRAFT`, `CANCELLED` |
| `APPROVED` | `APPROVED`, `PLANNED`, `DRAFT`, `CANCELLED` |
| `PLANNED` | `PLANNED`, `RUNNING`, `APPROVED`, `CANCELLED` |
| `RUNNING` | `RUNNING`, `COMPLETED`, `PLANNED`, `CANCELLED` |
| `COMPLETED` | `COMPLETED`, `RUNNING` |
| `CANCELLED` | `CANCELLED`, `DRAFT` |

Fungsi pemeriksa: `bolehTransisiProgram(dari, ke)`. Keduanya diekspos ulang oleh
`packages/domain/src/aturan.ts` agar API memakai satu definisi.

### Aturan pemakaian

- `POST /api/v1/programs/:id/status` memerlukan izin **`program.approve`**.
- Mengajukan program (`DRAFT → PROPOSED`) biasanya memakai `program.create`.
- Transisi yang tidak sah menghasilkan galat `INVALID_STATE_TRANSITION` (HTTP 409).
- `CANCELLED` **wajib** membawa `alasan_pembatalan`; `APPROVED` menolak `PROPOSED`
  bila alasan penolakan diisi. Validasi ada di service, bukan di database.

---

## 3. Ruang Kerja Program

Satu program adalah ruang kerja sendiri. Semua hal berikut menempel padanya:

| Tabel | Hubungan | Isi |
|---|---|---|
| `tasks` | `tasks.programId` | Tugas program (`on delete: set null`). |
| `meetings` | `meetings.program_id` | Rapat terkait program. |
| `events` | `events.program_id` | Acara turunan program. |
| `budgets` | `budgets.program_id` | Anggaran program. |
| `expense_requests` | `expense_requests.program_id` | Pengajuan pengeluaran program. |
| `reimbursements` | `reimbursements.program_id` | Reimbursement terkait program. |
| `payments` | `payments.program_id` | Pembayaran terkait program. |
| `announcements` | `announcements.program_id` | Pengumuman terkait program. |
| `documents` | `documents.program_id` | Dokumen terkait. |
| `attendance_sessions` | — | Sesi absensi program (lewat `event_id`/`meeting_id`). |

Karena itu, satu halaman program bisa menampilkan tugas, anggaran, dokumen, rapat, dan
evaluasi tanpa menebak-nebak di mana datanya.

---

## 4. Tim Program

`program_members`:

| Kolom | Keterangan |
|---|---|
| `program_id`, `member_id` | Unik: `uq_program_member`. |
| `peran` | `OWNER`, `KETU`, `ANGGOTA`, `PENGAWAS`, `PEMBIAYA`. |
| `division_id`, `jabatan_id` | Divisi/jabatan saat masuk tim. |
| `tanggal_bergabung`, `tanggal_keluar` | Bawaan `tanggal_bergabung = now()`. |
| `deskripsi_peran` | Penjelasan peran. |

Endpoint: `POST /api/v1/programs/:id/tim` — izin `program.manage`.

Peran dalam tim **tidak** sama dengan peran RBAC. Seorang `MEMBER` biasa bisa menjadi
`KETU` sebuah program tanpa mendapat izin organisasi tambahan; wewenangnya tetap BACA
untuk data lain, tetapi ia bertanggung jawab atas program tersebut. Jangan mencampur
`program_members.peran` dengan `member_roles`.

---

## 5. Timeline & Milestone

`program_milestones`:

| Kolom | Keterangan |
|---|---|
| `nama`, `deskripsi` | Tonggak waktu. |
| `tanggal` | Tanggal target. |
| `selesai`, `selesai_pada` | Status penyelesaian. |
| `urutan` | Urutan, dipakai index `ix_milestone_program` `(program_id, tanggal)`. |
| `dibuat_oleh` | Pembuat. |

Endpoint: `POST /api/v1/programs/:id/milestones` — izin `program.manage`.

Milestone adalah patokan progres. `programs.progres` (0–100) bisa dihitung dari
milestone selesai, `tugas_selesai / total_tugas`, atau kombinasi — konsistenkan satu
rumus bila Anda mengubahnya, dan sebutkan rumusnya di komentar service.

---

## 6. Evaluasi

`program_evaluations`:

| Kolom | Keterangan |
|---|---|
| `capaian` | **Wajib.** |
| `kendala`, `pelajaran`, `rekomendasi` | Catatan evaluasi. |
| `skor_kualitas` | `numeric(5,2)`, 0–100. |
| `skor_keberhasilan` | `numeric(5,2)`, 0–100. |
| `dievaluasi_oleh` | Pengisi evaluasi (referensi `members`, `set null`). |
| `dievaluasi_pada` | Bawaan `now()`. |
| `publik` | Bila `true`, evaluasi tampil untuk seluruh anggota; bila `false`, hanya pengurus. |

Endpoint: `POST /api/v1/programs/:id/evaluasi` — izin `program.manage`.

Evaluasi normalnya diisi setelah program berstatus `COMPLETED`, tetapi skema tidak
melarang mengisinya lebih awal (untuk evaluasi berkala). Jangan menambahkan aturan
"hanya boleh setelah COMPLETED" tanpa alasan produk yang jelas.

---

## 7. Acara (Event)

`events`:

| Kolom | Keterangan |
|---|---|
| `kode`, `judul` | `uq_acara_kode` `(organization_id, kode)`. |
| `program_id` | Acara bisa lahir dari program (`set null`). |
| `division_id` | Divisi penyelenggara. |
| `tanggal`, `waktu_mulai`, `waktu_selesai`, `lokasi`, `detail_lokasi` | Waktu & tempat. |
| `status` | `DRAFT`, `PLANNED`, `REGISTRATION`, `ONGOING`, `COMPLETED`, `CANCELLED`. |
| `penanggung_jawab_member_id` | PJ, **`on delete: restrict`**. |
| `kapasitas`, `kuota_kelas` (jsonb) | Batas peserta, mis. `{ "X": 50, "XI": 40 }`. |
| `butuh_absensi` | Bawaan `true` — menghasilkan `attendance_sessions`. |
| `butuh_pendaftaran`, `pendaftaran_mulai_pada`, `pendaftaran_selesai_pada` | Alur pendaftaran. |
| `session_id` | Sesi absensi terkait. |
| `biaya_diajukan` | Estimasi biaya. |
| `sudah_dikomunikasikan` | Penanda HUMAS sudah membuat materi promosi. |
| `progres`, `versi_baris` | Progres & optimistic locking. |

> Catatan: `enumStatusAcara` **tidak punya** peta transisi eksplisit seperti program.
> Bila Anda perlu memvalidasi transisi acara, tambahkan `TRANSISI_ACARA` di
> `packages/contracts` — jangan menuliskannya inline di service.

### Peserta & panitia

`event_participants`:

| Kolom | Keterangan |
|---|---|
| `peran` | `PESERTA`, `PANITIA`, `PANITIA_UTAMA`, `NARASUMBER`. |
| `divisi`, `tugas` | Tugas panitia. |
| `terdaftar_pada` | Bawaan `now()`. |
| `hadir`, `hadir_pada` | Kehadiran. |
| `dibatalkan_pada`, `alasan_pembatalan` | Pembatalan pendaftaran. |

Unik: `uq_acara_peserta` `(event_id, member_id)`.

### Absensi acara

`event_attendance` — khusus acara, memakai model berbeda dari `attendance_records`:

| Kolom | Keterangan |
|---|---|
| `tipe` | `IN`, `OUT`, `HADIR`, `PULANG`. |
| `waktu` | Bawaan `now()`. |
| `dicatat_oleh`, `catatan` | Pencatat. |

Unik: `uq_acara_absensi` `(event_id, member_id, tipe)` — satu anggota bisa punya dua
baris (mis. `IN` dan `OUT`).

### Jadwal acara

`event_schedules` menyimpan rundown:

| Kolom | Keterangan |
|---|---|
| `judul`, `deskripsi` | Kegiatan. |
| `mulai_pukul`, `selesai_pukul` | Waktu. |
| `lokasi`, `penanggung_jawab_member_id`, `urutan` | Tempat, PIC, urutan. |

Endpoint: `GET /api/v1/events/:id/kalender` (izin `event.read`).

---

## 8. Dokumen Program

`program_documents` menautkan dokumen ke program dengan kategori:

| Nilai `jenis` | Keterangan |
|---|---|
| `PROPOSAL` | Proposal kegiatan. |
| `ANGGARAN` | Rincian anggaran. |
| `SURAT` | Surat izin/permohonan. |
| `DOKUMENTASI` | Foto/video. |
| `LPJ` | Laporan pertanggungjawaban. |
| `LAINNYA` | Lain-lain. |

Unik: `uq_program_dokumen` `(program_id, document_id)`. Berkasnya ada di object
storage; tabel ini hanya menyimpan metadata — lihat `DOCUMENTS.md`.

---

## 9. Ringkasan Endpoint

| Metode | Jalur | Izin |
|---|---|---|
| `GET` | `/api/v1/programs` | `program.read` |
| `GET` | `/api/v1/programs/:id` | `program.read` |
| `POST` | `/api/v1/programs` | `program.create` |
| `PATCH` | `/api/v1/programs/:id` | `program.manage` |
| `POST` | `/api/v1/programs/:id/status` | `program.approve` |
| `POST` | `/api/v1/programs/:id/tim` | `program.manage` |
| `POST` | `/api/v1/programs/:id/milestones` | `program.manage` |
| `POST` | `/api/v1/programs/:id/evaluasi` | `program.manage` |
| `GET` | `/api/v1/events` | `event.read` |
| `POST` | `/api/v1/events` | `event.create` |
| `PATCH` | `/api/v1/events/:id` | `event.manage` |
| `POST` | `/api/v1/events/:id/peserta` | `event.create` |
| `GET` | `/api/v1/events/:id/kalender` | `event.read` |

---

## Catatan untuk AI agent

1. Selalu pakai `bolehTransisiProgram` dari `@osda/contracts` (diekspos ulang
   `@osda/domain`). Jangan menulis `if (status === 'RUNNING')` di service — nanti
   berbeda dari kontrak.
2. `programs.owner_member_id` dan `events.penanggung_jawab_member_id` memakai
   `on delete: restrict`. Menghapus anggota yang merupakan pemilik program akan gagal —
   alihkan kepemilikan lebih dulu.
3. `realisasi_pengeluaran`, `total_tugas`, `tugas_selesai` adalah denormalisasi. Bila Anda
   mengubah cara menghitungnya, sertakan komentar menjelaskan dari mana angkanya dan
   kapan disinkronkan.
4. `program_members.peran` adalah peran organisasi dalam program, **bukan** peran RBAC.
   Jangan memberi izin tambahan berdasarkan peran tim.
5. Acara tidak punya `TRANSISI_ACARA`. Bila fitur Anda menuntut validasi transisi acara,
   definisikan di kontrak terlebih dahulu, jangan di service.
