# Tugas (Tasks)

Acuan kode: `packages/db/src/schema/tasks.ts`,
`packages/contracts/src/tasks.ts`, dan
`apps/api/src/modules/tasks/tasks.service.ts`.

Prinsip terpenting modul ini: **`DONE` belum berarti `VERIFIED`.** Untuk tugas yang
butuh verifikasi, penutupan harus dikonfirmasi orang lain lewat izin `task.verify`.

---

## 1. Tabel Terkait

| Tabel | Peran |
|---|---|
| `tasks` | Tugas itu sendiri. |
| `task_assignees` | Penugasan (many-to-many dengan anggota). |
| `task_activity` | Komentar & riwayat status (jejak audit + activity feed). |
| `task_dependencies` | Dependensi antar tugas. |
| `task_checklists` | Daftar periksa internal tugas. |

---

## 2. Kolom Tugas

| Kolom | Keterangan |
|---|---|
| `kode` | Kode internal, unik `(organization_id, kode)` lewat `uq_tugas_kode`. |
| `judul`, `deskripsi` | Isi tugas. |
| `status` | `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`. |
| `verifikasi` | `UNVERIFIED`, `VERIFIED`, `REJECTED`. |
| `butuh_verifikasi` | Bawaan **`true`**. Bila `true`, `DONE` belum menutup tugas sampai diverifikasi. |
| `prioritas` | `LOW`, `NORMAL`, `HIGH`, `URGENT` (bawaan `NORMAL`). |
| `batas_waktu` | Tenggat. |
| `mulai_dikerjakan_pada`, `selesai_pada` | Waktu eksekusi. |
| `diverifikasi_pada`, `diverifikasi_oleh`, `verifikasi_komentar` | Hasil verifikasi. |
| `progres` | 0–100 untuk bar progres UI. |
| `lampiran_dokumen_ids[]` | Metadata dokumen (bukan berkas). |
| `tags[]` | Label. |
| `division_id`, `division_tujuan_id` | Divisi pemilik vs divasi **tujuan** eksekusi. |
| `program_id`, `meeting_id`, `parent_id` | Konteks. |
| `dibuat_oleh` | Pembuat. |
| `versi_baris` | Optimistic locking. |

Perbedaan `division_id` dan `division_tujuan_id` penting: yang pertama adalah divisi
pemilik tugas, yang kedua adalah divisi yang mengerjakan. Koordinator bidang mengerjakan
tugas di `division_tujuan_id`, bukan di `division_id`.

---

## 3. Status Tugas & Transisi Sah

`TRANSISI_TUGAS` (`packages/contracts/src/tasks.ts`):

| Dari | Boleh ke |
|---|---|
| `TODO` | `IN_PROGRESS`, `BLOCKED`, `CANCELLED` |
| `IN_PROGRESS` | `DONE`, `BLOCKED`, `TODO`, `CANCELLED` |
| `BLOCKED` | `TODO`, `IN_PROGRESS`, `CANCELLED` |
| `DONE` | `IN_PROGRESS` (dibuka kembali) |
| `CANCELLED` | `TODO` (dihidupkan kembali) |

Ciri penting:

- **Tidak ada** `DONE → VERIFIED`; verifikasi disimpan di kolom terpisah (`verifikasi`),
  bukan mengganti `status`.
- `DONE` hanya bisa kembali ke `IN_PROGRESS` — dipakai bila hasil verifikasi REJECTED.
- `CANCELLED` hanya bisa kembali ke `TODO`.
- `COMPLETED` atau `VERIFIED` **bukan** status tugas. Jangan menambahkannya ke enum.

Pemeriksa: `bolehTransisiTugas(dari, ke)`. Dipakai
`POST /api/v1/tasks/:id/status`. Transisi tidak sah menghasilkan
`INVALID_STATE_TRANSITION` (HTTP 409).

---

## 4. DONE ≠ VERIFIED

Ini aturan inti modul. Dua kolom berbeda menyimpan dua hal berbeda:

```
tasks.status       : TODO → IN_PROGRESS → DONE      (pelaksana)
tasks.verifikasi   : UNVERIFIED → VERIFIED | REJECTED (pemeriksa, izin task.verify)
```

Mari kita bedakan dengan jelas:

| Yang dilakukan | Siapa | Izin | Efek |
|---|---|---|---|
| Menandai selesai | Assignee / pembuat | `task.write` | `status = DONE`, `verifikasi` tetap `UNVERIFIED` bila `butuh_verifikasi = true` |
| Memverifikasi | Penguji (atasan/koordinator) | `task.verify` | `verifikasi = VERIFIED`, `diverifikasi_pada`, `diverifikasi_oleh`, `verifikasi_komentar` terisi |
| Menolak hasil | Penguji | `task.verify` | `verifikasi = REJECTED`; `status` dikembalikan ke `IN_PROGRESS` |

Tabel ini membuat pemisahan itu eksplisit:

```
butuh_verifikasi = true  (bawaan)
   status = DONE + verifikasi = UNVERIFIED  → tugas BELUM selesai (menunggu pemeriksaan)
   status = DONE + verifikasi = VERIFIED   → tugas SELESAI
   status = DONE + verifikasi = REJECTED   → hasil ditolak, kembali IN_PROGRESS

butuh_verifikasi = false
   status = DONE → langsung dianggap selesai
```

Index pendukung: `ix_tugas_perlu_verifikasi`
`(organization_id, butuh_verifikasi, status)` — dipakai untuk daftar "tugas yang menunggu
verifikasi" agar query dasbor cepat.

Endpoint verifikasi: `POST /api/v1/tasks/:id/verifikasi` dengan izin **`task.verify`**.
Tugas yang belum `DONE` tidak boleh diverifikasi.

---

## 5. Validasi Transisi di Service

Saat mengubah status, service memeriksa berurutan:

```
1. Izin        → pastikanIzin(pengguna, ['task.write'])
2. Eksistensi  → tugas ada & milik organisasi aktif (galat NOT_FOUND)
3. Transisi    → bolehTransisiTugas(statusSekarang, statusBaru)
                 salah → galatTransisi → INVALID_STATE_TRANSITION
4. Dependensi  → bila ada task_dependencies belum selesai, status DONE ditolak
5. Catat       → task_activity tipe STATUS/VERIFIKASI dengan status_sebelum & status_sesudah
```

Pemeriksaan izin dilakukan di **dua** tempat: guard (`@Izin('task.write')`) dan lagi di
service (`pastikanIzin`) karena method yang sama bisa dipanggil dari alur lain (mis.
konversi item notulen menjadi tugas).

---

## 6. Penugasan

`task_assignees`:

| Kolom | Keterangan |
|---|---|
| `task_id`, `member_id` | Unik: `uq_tugas_assignee`. |
| `utama` | PIC utama; **hanya PIC utama boleh menugaskan ulang**. |
| `diterima_pada` | Kapan anggota menerima tugas. |
| `selesai_pada` | Kapan anggota menyelesaikan porsinya. |
| `progres` | Progres individual bila tugas dibagi ke beberapa orang. |
| `ditugaskan_oleh` | Pemberi tugas. |

Catatan penting dari skema: PIC utama boleh menugaskan ulang, anggota biasa tidak.
Jangan buat endpoint yang membiarkan assignee biasa menambah anggota lain.

---

## 7. Aktivitas

`task_activity` mencatat tipe `DIBUAT`, `STATUS`, `KOMENTAR`, `VERIFIKASI`,
`DITUGASKAN`, termasuk `status_sebelum` dan `status_sesudah`. Tabel ini adalah sumber
activity feed dan jejak audit ringan — **jangan pernah menghapusnya**.

Endpoint: `GET /api/v1/tasks/:id/aktivitas` (izin `task.read`) dan
`POST /api/v1/tasks/:id/komentar` (izin `task.write`).

---

## 8. Dependensi & Checklist

### Dependensi

`task_dependencies` — unik `uq_task_dep` `(task_id, bergantung_pada_task_id)`.
Menandai tugas `DONE` ketika dependensinya belum selesai harus ditolak. Gunakan index
`ix_task_dep_parent` untuk mencari "tugas apa yang menunggu tugas ini".

Jaga juga dari siklus: `A → B → A`. Skema tidak melarangnya, jadi periksa di service.

### Checklist

`task_checklists` — `isi`, `selesai`, `selesai_oleh`, `selesai_pada`, `urutan`.
Checklist bisa otomatis memperbarui `tasks.progres`
(contoh: 2 dari 4 item centang → `progres = 50`). Konsistenkan satu rumus dan tulis
di komentar service.

---

## 9. Tugas dari Rapat

`meeting_action_items.task_id` menghubungkan item tindakan rapat ke tugas.
Alurnya:

```
notulen APPROVED
   → item tindakan dengan penanggung jawab & batas waktu
     → konversi menjadi tasks (kode baru, program_id & meeting_id terisi)
       → task_activity tipe DIBUAT
```

Item yang sudah punya `task_id` tidak boleh dikonversi dua kali.

---

## 10. Ringkasan Endpoint

| Metode | Jalur | Izin |
|---|---|---|
| `GET` | `/api/v1/tasks` | `task.read` |
| `GET` | `/api/v1/tasks/:id` | `task.read` |
| `GET` | `/api/v1/tasks/:id/aktivitas` | `task.read` |
| `POST` | `/api/v1/tasks` | `task.write` |
| `PATCH` | `/api/v1/tasks/:id` | `task.write` |
| `POST` | `/api/v1/tasks/:id/status` | `task.write` |
| `POST` | `/api/v1/tasks/:id/verifikasi` | `task.verify` |
| `POST` | `/api/v1/tasks/:id/komentar` | `task.write` |

---

## Catatan untuk AI agent

1. Jangan pernah menyetel `verifikasi = VERIFIED` ketika hanya memanggil endpoint
   perubahan status. Verifikasi adalah operasi terpisah dengan izin `task.verify`.
2. Jangan menambahkan `COMPLETED` atau `VERIFIED` ke `status_tugas`. Itu akan merusak
   `TRANSISI_TUGAS`, enum database, dan seluruh klien.
3. Saat menampilkan progres program, gunakan `tugas_selesai / total_tugas` dan
   perjelas apakah "selesai" berarti `status = DONE` atau `verifikasi = VERIFIED` —
   dua angka ini bisa berbeda dan pengguna akan mengeluh bila tidak konsisten.
4. `task_dependencies` bisa membentuk siklus karena tidak ada constraint. Periksa
   siklus sebelum menyimpan dependensi baru.
5. Setiap perubahan status **wajib** menulis baris `task_activity`; jika tidak,
   riwayat tugas akan bolong dan dasbor tidak bisa menjelaskan kenapa tugas kembali
   ke `IN_PROGRESS`.
