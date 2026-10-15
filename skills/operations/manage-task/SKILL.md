---
name: manage-task
description: Membuat tugas, menugaskan orang, mengatur tenggat, menandai selesai, dan melihat tugas yang lewat tenggat atau masih tertahan.
version: 1.0.0
required_tools:
  - task_create
  - task_list
  - task_complete
  - task_update
  - task_assign
  - task_delete
required_permissions:
  - tasks.read
  - tasks.create
  - tasks.update
  - tasks.assign
contexts: [private, group]
triggers:
  - tugas
  - task
  - kerjaan
  - todolist
  - to-do
  - ditugaskan
  - menugaskan
  - lewat tenggat
  - tenggat
  - deadline
  - sudah selesai
  - belum selesai
---

# Kelola Tugas

## Tujuan
Buat pekerjaan yang jelas siapa yang mengerjakan dan kapan batasnya, dan
statusnya bisa dijawab dari data — bukan dari ingatan.

## Tugas BUKAN pengingat

Dua hal ini mirip tapi berbeda, dan salah memblokir gagal:

| | Tugas | Pengingat |
|---|---|---|
| Ada yang mengerjakan | Ya | Tidak |
| Punya penugas | Ya | Tidak |
| Ada tenggat | Ya | Bisa |
| Sumber | `task_create` | `schedule_reminder` |

Kalau orang bilang "ingetin aku besok pagi transfer kas" → **pengingat**.
Kalau orang bilang "Budi harus transfer kas besok" → **tugas**.

Jangan tumpang tindih. Jangan buat tugas untuk sesuatu yang cuma perlu_Base
ingat-ingat, dan jangan buat pengingat untuk pekerjaan yang punya penugas.

## Alur yang benar

### Menjawab "tugas saya apa saja"

1. Kalau nama orang disebut, pakai `task_list` dengan `assigneeName`.
2. Kalau tidak, `task_list` tanpa saringan — itu daftar terbuka organisasi.
3. **Sertakan `taskId` di jawaban kalau pengguna mungkin mau lanjut acting.**
   Judul saja tidak cukup untuk menandai selesai dengan aman.

### Membuat tugas

1. `task_create` dengan judul berupa perintah kerja, bukan topik
   ("Siapkan proposal" lebih baik dari "Proposal").
2. `assigneeNames` diisi kalau ada yang ditugaskan.
3. `dueAt` hanya kalau ada tenggat yang disebut. **Jangan mengarang
   tenggat** — kalau tidak ada, biarkan kosong.
4. Kalau tugas harus menunggu tugas lain, `dependsOnTitles`. Jangan dipakai
   untuk urutan bebas.

### Menandai selesai

**Selalu `task_complete`.** Jangan pernah `task_update` dengan status selesai —
tool itu akan menolak dan mengarahkan ke sini.

Kalau `task_complete` ditolak karena ada tugas lain yang belum selesai:

1. **Tunjukkan yang menghambat ke pengguna.**
2. **Tanya**, jangan langsung ulangi dengan `acknowledgeUnfinishedDependencies`.
   Mengakui urutan dibalik tanpa orang menyetujui berarti "selesai" jadi tidak
   jujur.
3. Kalau pengguna memang bilang urutannya tidak penting, baru ulangi dengan
   pengakuan itu — dan sebutkan bahwa tugasnya sebenarnya masih bergantung.

## Hal yang harus jujur ke pengguna

- **Nama yang ambigu tidak ditebak.** Kalau ada dua "Budi", tanyakan. Salah
  menandai tugas berarti memberi status yang salah untuk pekerjaan orang.
- **Judul yang cocok banyak tidak ditebak.** Kalau tiga tugas mengandung
  "proposal", tanyakan yang mana — jangan pilih yang pertama.
- **Tugas yang tertahan tetap ditampilkan**, ditandai `blocked` dengan
  keterangan apa yang menghambat. Jangan disembunyikan supaya daftar terlihat
  bersih.
- **Anggota dari luar organisasi ditolak.** Ini bukan aturan yang bisa dinegosiasikan.
- **Menghapus tugas yang punya tanggungan ditolak.** Sebutkan tanggungan itu
  sebelum bertanya apakah dipaksa.

## Batas penting

- **Tidak ada pengingat otomatis untuk tugas.** Tugas yang lewat tenggat baru
  terlihat kalau ditanyakan. Kalau orang minta "ingatkan kalau lewat
  tenggat", itu fitur yang belum ada — katakan begitu, jangan janjikan.
- **Tidak ada rekaman progres.** Tugas hanya punya status, bukan catatan
  harian. Kalau orang minta "update kemajuan mingguan", itu belum bisa.
- **Tidak ada tugas berulang.** "Setiap Senin" bukan satu tugas — buat
  beberapa, atau jadikan pengingat.
- **Satu tugas satu kegiatan.** Kalau judulnya berisi "dan", itu kemungkinan
  dua tugas. Tanya dulu sebelum memisahkannya.