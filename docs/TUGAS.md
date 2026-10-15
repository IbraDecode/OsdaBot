# Sistem Tugas

Status: **IMPLEMENTED** · **TESTED** (33 test integrasi)

---

## 1. Yang sebenarnya ada

| Lapisan | Isi |
|---|---|
| Tabel | `Task`, `TaskAssignment`, `TaskDependency` |
| Layanan | `src/tasks/service.ts` |
| Tool | `task_create`, `task_list`, `task_complete`, `task_update`, `task_assign`, `task_delete` |
| Skill | `skills/operations/manage-task/SKILL.md` |
| Izin | `tasks.read`, `tasks.create`, `tasks.update`, `tasks.assign`, `tasks.delete` |

Ketiga tabel sudah ada di schema sejak awal dan **tidak pernah dipakai**.
Saya menuliskannya sebagai "mati" di `docs/AUDIT.md`, jadi ini utangnya yang
dibayar, bukan fitur baru yang tidak jelas asalnya.

---

## 2. Batas organisasi — dicek, bukan diasumsikan

`TaskAssignment` hanya menautkan dua UUID: `taskId` dan `memberId`. **Tidak
ada constraint database yang memastikan keduanya milik organisasi yang sama.**

Tanpa pemeriksaan di layanan, tugas organisasi A bisa ditugaskan ke anggota
organisasi B — dan judul tugas, keterangannya, sertaimenter jawabannya ikut
terbawa lintas perusahaan.

Pemeriksaan dilakukan **sebelum** penulisan apa pun, dan pesannya menyebut
nama yang salah + organisasinya. Tugas milik organisasi lain yang dijadikan
dependensi sengaja **tidak** dibedakan dari yang tidak ada: membocorkan
keberadaannya lewat pesan error juga kebocoran.

Verifikasi: `pastikanAnggotaMilik`, `pastikanTugasMilik`.

---

## 3. Siklus dependensi ditolak

`A bergantung pada B` dan `B bergantung pada A` membuat keduanya tidak akan
pernah bisa diselesaikan. Bukan masalah tampilan — datanya jadi salah dan tidak
ada jalan keluar.

Pemeriksaan menelusuri graf dari `dependsOnTaskId`. Kalau `taskId` bisa
dicapai dari sana, lingkaran tertutup dan penambahan ditolak.

### Bug yang saya buat sendiri lalu temukan lewat test

Versi pertama saya memeriksa siklus dengan cara yang **salah tempat**: cek
apakah tugas-tugas yang dirujuk saling terhubung, lalu anggap itu lingkaran.

```
sudah ada: A → B
membuat C dengan dependsOn = [A, B]
```

Itu **bukan** lingkaran — C hanya menunggu dua hal. Versi pertama akan
**menolak** kasus yang sah. Yang membuat saya sadar: waktu menulis test "dua
dependensi yang saling terhubung tidak boleh ditolak", saya berpikir "tunggu,
itu memang bukan lingkaran".

Perbaikannya: tugas yang baru dibuat belum punya sisi masuk sama sekali, jadi
secara struktur tidak mungkin membentuk lingkaran. Yang diperiksa hanya
penambahan dependensi ke tugas yang **sudah ada**.

Verifikasi: `pastikanTakSiklus`, test `lingkaran panjang DITOLAK` (A → B → C,
ditutup dengan C → A — satu hop saja akan lolos).

---

## 4. "Selesai" hanya lewat satu pintu

Satu-satunya jalan ke `status: 'done'` adalah `TaskService.complete()`.

`update()` **menolak** `status: 'done'` di level tipe. Kalau diterima, model
akan menemukan jalan yang lebih ringkas dan melewati seluruh pemeriksaan
dependensi — dan jalur yang longgar biasanya yang dipakai.

Di level tool, `task_update` tetap **menerima** `done` di skema input lalu
mengalihkan ke `task_complete` dengan pesan jelas. Alasannya: model akan wajar
saja mengirim `status: "done"` ke tool mana pun yang bisa mengubah status.
Menolaknya dengan "enum tidak cocok" hanya menambah satu percobaan sia-sia.

### Kalau dependensinya belum selesai

Ditolak, dan yang menghambat disebutkan. Kalau pengguna memang menyatakan
urutannya tidak penting, operasi diulang dengan pengakuan eksplisit — dan
dicatat di log sebagai peringatan.

Yang **tidak** dianggap menghalangi: dependensi yang `cancelled`. Tugas yang
dibatalkan sudah diputuskan orang untuk tidak dikerjakan; menahannya hanya
menambah jalan buntu yang tidak perlu.

---

## 5. "Lewat tenggat" dihitung saat baca

Tidak ada kolom `overdue` di schema. `overdue` selalu dihitung dari
`dueAt < now && status belum selesai` saat baca.

Kalau disimpan sebagai kolom, jam yang salah tidak akan pernah memperbaikinya
sendiri — tugas yang sudah dikerjakan tetap terbaca "lewat tenggat" selamanya.

Verifikasi: test mencari kolom `overdue` di `information_schema` dan
memastikan hasilnya kosong. Ini mengunci keputusan desainnya, bukan cuma
menguji perilakunya.

---

## 6. Urutan daftar

```
1. lewat tenggat      — sudah terlambat, tanpa kecuali
2. tenggat terdekat   — yang paling sempit waktunya
3. prioritas          — pemutus seri waktu bertumpuk
4. tanpa tenggat      — di akhir
5. dibuat lebih dulu  — stabil
```

### Urutan ini saya ubah karena test saya sendiri membuktikan salah

Versi pertama: **prioritas mendahului tenggat**. Test "lewat tenggat di
depan" saya tulisármads sudah gagal di awal — karena `urutan[1]` adalah tugas
tanpa tenggat dan `urutan[2]` tugas prioritas 1 yang masih punya tenggat.

Alasan perubahan: tugas prioritas 1 yang harus selesai bulan depan bukan lebih
mendesak dari tugas prioritas 5 yang lewat tenggat hari ini. Kalau prioritas
yang lebih dulu, daftar yang dibuka pertama kali selalu diisi tugas yang tidak
sedang terburu — persis yang tidak dilihat orang yang sedang kejar waktu.

Pengurutan dan limit diterapkan **setelah** pengurutan (`BATAS_PEMBACAAN`
baris diambil, diurutkan di aplikasi, lalu dipotong). Kalau database yang
memotong lebih dulu, "3 tugas paling mendesak" bisa mengembalikan tiga tugas
yang paling lama disimpan.

Urutannya dihitung di aplikasi karena `orderBy` Prisma tidak bisa menyatakan
"null di akhir" pada kolom yang bisa null.

---

## 7. Menghapus tugas

Ditolak kalau ada tugas lain yang bergantung padanya, dan tanggungan itu
disebutkan.

`TaskDependency` punya `onDelete: Cascade` di kedua sisi. Tanpa pemeriksaan,
menghapus satu tugas akan menghapus keterikatannya dari semua tugas yang
bergantung padanya — dan tugas-tugas itu kehilangan konteks tanpa ada yang
diberi tahu,	status "menunggu proposal" menggantung tanpa ada yang perlu
ditanya.

Penghapusan paksa tetap ada untuk kasus nyata: tugasnya memang sudah tidak
relevan.

---

## 8. Rujukan yang ambigu tidak ditebak

| Situasi | Perilaku |
|---|---|
| Nama anggota cocok beberapa orang | `AMBIGUOUS_REFERENCE` + daftar kandidat |
| Potongan judul cocok beberapa tugas | `AMBIGUOUS_REFERENCE` + daftar |
| Judul tidak cocok apa pun | `NOT_FOUND` |
| Tugas milik organisasi lain | `NOT_FOUND` (sama seperti tidak ada) |

Memilih satu tanpa bertanya berarti memberi status yang salah untuk pekerjaan
orang — dan itu kesalahan yang **tidak ada yang mengetahuinya**, karena
tugasnya akan terbaca "selesai" padahal belum dikerjakan.

---

## 9. Yang belum ada

| Batas | Akibatnya |
|---|---|
| Tidak ada pengingat otomatis untuk tugas | Tugas yang lewat tenggat baru terlihat kalau ditanyakan |
| Tidak ada rekaman progres | Tugas hanya punya status, bukan catatan harian |
| Tidak ada tugas berulang | "Setiap Senin" harus dibuat manual |
| `ActiveTask` belum dipakai | Menyusun kebutuhan lewat percakapan (tugas yang belum jelas bentuknya) belum ada |
| `WorkflowRun` belum dipakai | Alur kerja otomatis belum ada |

Lima batas itu tercatat di bagian "Batas penting" pada SKILL.md, jadi model
tidak akan menjanjikan kemampuan yang belum ada.