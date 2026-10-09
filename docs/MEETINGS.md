# Rapat & Notulen (Meetings)

Acuan kode: `packages/db/src/schema/meetings.ts`,
`apps/api/src/modules/meetings/meetings.service.ts`, dan
`packages/contracts/src/enums.ts`.

---

## 1. Rapat

Tabel `meetings` menyimpan satu rapat. Kolom penting:

| Kolom | Keterangan |
|---|---|
| `judul`, `deskripsi` | Identitas rapat. |
| `tanggal`, `waktu_mulai`, `waktu_selesai` | Waktu pelaksanaan. |
| `jenis` | `RUTIN`, `KALENDER`, `DARURAT`, `DIVISI`, `PROGRAM` (bawaan `RUTIN`). |
| `pembicara[]` | Daftar narasumber/pembicara. |
| `division_ids[]`, `jabatan_ids[]` | Divisi dan jabatan yang wajib hadir. Kosong = semua. |
| `audiens_deskripsi` | Ringkasan peserta yang diundang, mis. "Ketua, Sekretaris, seluruh koordinator". |
| `status` | `SCHEDULED`, `ONGOING`, `COMPLETED`, `CANCELLED`. |
| `session_id` | Sesi absensi yang dihasilkan rapat ini. |
| `undangan_terkirim_pada` | Kapan undangan dikirim. |
| `pengingat_terkirim` (jsonb) | Jejak pengingat H-1 dan H-1 jam. |
| `revisi` | Counter untuk sinkronisasi realtime (bukan versi notulen). |
| `program_id`, `division_id` | Bila rapat terkait program atau divisi tertentu. |

### Aturan slot

```
uniqueIndex('uq_rapat_undangan_slot').on(t.organizationId, t.tanggal, t.waktuMulai)
```

Satu organisasi tidak bisa punya dua rapat pada tanggal dan jam mulai yang sama.

### Hubungan dengan absensi

`meetings.session_id` menunjuk ke `attendance_sessions`. Arah hubungannya:

```
meetings 1 ── 1 attendance_sessions
     │                   │
     └─ saat rapat dibuat/dibuka, sesi absensi jenis MEETING dibuat
```

Catatan teknis: `attendance_sessions.meeting_id` **tidak punya foreign key**
(lihat `DATABASE.md`), sehingga `meetings.session_id` adalah arah referensi yang aktif.

---

## 2. Agenda

`meeting_agenda` menyimpan butir agenda:

| Kolom | Keterangan |
|---|---|
| `judul`, `deskripsi` | Isi agenda. |
| `pembicara` | Penyaji agenda. |
| `durasi_menit` | Perkiraan durasi. |
| `mulai_pukul`, `selesai_pukul` | Boleh kosong saat agenda dibuat; diisi saat rapat berjalan. |
| `urutan` | Urutan agenda, dipakai index `ix_agenda_rapat` `(meeting_id, urutan)`. |
| `dibahas` | Penanda apakah agenda sudah dibahas. |

---

## 3. Peserta

`meeting_participants`:

| Kolom | Keterangan |
|---|---|
| `member_id`, `division_id` | Peserta dan divisinya saat diundang. |
| `wajib` | Apakah kehadirannya wajib. |
| `hadir`, `hadir_pada` | Status kehadiran. |
| `status_hadir` | Salinan dari `attendance_records` agar rekap rapat tidak perlu join. |
| `sudah_dibaca_undangan` | Penanda undangan telah dibaca. |
| `alasan_tidak_hadir` | Alasan bila tidak hadir. |

Index unik `uq_peserta_rapat_member` `(meeting_id, member_id)` mencegah peserta ganda.

---

## 4. Notulen dengan Versioning

`meeting_minutes` adalah bagian paling ketat dari modul ini. Prinsipnya:
**notulen yang sudah disetujui tidak boleh ditimpa**. Setiap revisi membuat versi
baru; versi lama tetap utuh sebagai bukti historis.

| Kolom | Keterangan |
|---|---|
| `nomor` | Nomor resmi, mis. `001/PMR/III/2026`. |
| `versi` | Nomor versi, dimulai dari 1. |
| `ringkasan`, `pembahasan` | Isi notulen. |
| `keputusan[]` | Keputusan yang diambil (array teks). |
| `status` | `DRAFT`, `REVIEW`, `APPROVED`, `ARCHIVED`. |
| `alasan_revisi` | **Wajib** bila membuat revisi. |
| `dikunci_pada` | Kunci setelah disetujui. |
| `penulis_id` | Penulis (referensi ke `members`). |
| `disetujui_oleh`, `disetujui_pada`, `komentar_persetujuan` | Pemeriksa. |
| `diarsipkan_pada` | Waktu pengarsipan. |

### Alur status

```
DRAFT ──(diajukan untuk ditinjau)──> REVIEW ──(disetujui)──> APPROVED ──> ARCHIVED
  │                                       │
  │                                       └──(ditolak/kembalikan)──> DRAFT  (versi baru)
  │
  └── revisi dari versi APPROVED selalu membuat baris dengan versi = n+1
```

Diagram versi:

```
rapat R
 ├── notulen v1  DRAFT    → REVIEW → (dikembalikan, alasan: "…")
 ├── notulen v2  DRAFT    → REVIEW → APPROVED (dikunci_pada terisi)
 └── notulen v3  DRAFT    → REVIEW → APPROVED   ← v3 tetap boleh, v2 TIDAK berubah
```

Index unik `uq_notulen_rapat_versi` `(meeting_id, versi)` memastikan tidak ada dua
versi bernomor sama untuk satu rapat.

---

## 5. Item Tindakan

`meeting_action_items` menghubungkan hasil rapat ke tindakan nyata:

| Kolom | Keterangan |
|---|---|
| `minutes_id` | Notulen asal item ini. |
| `isi` | Rumusan tindakan. |
| `penanggung_jawab_member_id` | PIC. |
| `batas_waktu` | Tenggat. |
| `prioritas` | `LOW`, `NORMAL`, `HIGH`, `URGENT`. |
| `task_id` | Tugas yang dihasilkan bila item sudah dikonversi menjadi tugas. |
| `selesai`, `selesai_pada` | Status penyelesaian. |

Konversi item tindakan menjadi tugas adalah cara resmenya menjadikan keputusan rapat
menjadi pekerjaan yang terlacak (lihat `TASKS.md`). Item yang sudah punya `task_id`
tidak boleh dikonversi dua kali.

---

## 6. Lampiran

`meeting_attachments` menautkan `document_id` ke rapat:

| Kolom | Keterangan |
|---|---|
| `document_id` | Metadata dokumen (berkasnya ada di object storage). |
| `jenis` | Bawaan `LAMPIRAN`; bisa `UNDANGAN`, `NOTULEN`, `ABSENSI`, … |
| `keterangan` | Penjelasan tambahan. |
| `diunggah_oleh` | Pengunggah. |

Lihat `DOCUMENTS.md` untuk aturan berkas, versi, dan penguncian.

---

## 7. Endpoint

| Metode | Jalur | Izin |
|---|---|---|
| `GET` | `/api/v1/meetings` | `meeting.read` |
| `GET` | `/api/v1/meetings/:id` | `meeting.read` |
| `POST` | `/api/v1/meetings` | `meeting.create` |
| `POST` | `/api/v1/meetings/:id/agenda` | `meeting.create` |
| `POST` | `/api/v1/meetings/:id/participants` | `meeting.create` |
| `POST` | `/api/v1/meetings/:id/minutes` | `meeting.create` |
| `GET` | `/api/v1/meetings/:id/minutes` | `meeting.read` |
| `POST` | `/api/v1/meetings/:id/minutes/:mid/approve` | `meeting.minutes.approve` |

`meeting.minutes.approve` hanya dimiliki `CHAIRPERSON` dan `ADVISOR` di antara peran
bawaan (di luar `SUPER_ADMIN`) — Sekretaris menulis notulen, tetapi tidak menyetujuinya
sendiri. Lihat `ROLE_MATRIX.md`.

---

## 8. Notifikasi & Pengingat

- `undangan_terkirim_pada` diisi setelah undangan dikirim ke seluruh peserta.
- `pengingat_terkirim` (jsonb) mencatat pengingat yang sudah terkirim; sesuai komentar
  skema, pengingat dikirim H-1 hari dan H-1 jam.
- Pengiriman notifikasi peserta dicatat di `notification_deliveries` (pola outbox) —
  lihat `COMMUNICATION.md`.

---

## Catatan untuk AI agent

1. Jangan pernah menghapus versi notulen lama. "Mengubah notulen" berarti membuat baris
   `versi = n+1` dengan `alasan_revisi` terisi. Versi sebelumnya tetap ada.
2. `meeting_minutes` tidak dilindungi trigger `trg_dokumen_versi_locked` (trigger itu
   hanya untuk `document_versions`). Bila Anda ingin penguncian versi notulen setara
   dokumen, tambahkan invariant baru di `SQL_INVARIANT` — jangan mengandalkan hanya
   pemeriksaan service.
3. `revisi` pada `meetings` bukan versi notulen; itu counter untuk sinkronisasi
   realtime. Jangan dipakai untuk versioning isi.
4. `attendance_sessions.meeting_id` tidak punya foreign key. Bila Anda menambahkan
   constraint, pastikan urutan insert (rapat dulu, lalu sesi) dan urutan migrasi sudah
   diperhitungkan.
5. Item tindakan yang sudah punya `task_id` tidak boleh dikonversi ulang; centang
   `task_id IS NULL` sebelum membuat tugas baru.
