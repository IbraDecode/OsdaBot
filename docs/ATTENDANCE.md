# Absensi (Attendance)

Modul absensi menangani rapat, acara, latihan, kegiatan, dan komite. Acuan kode:
`packages/db/src/schema/attendance.ts`, `packages/contracts/src/enums.ts`, dan
`apps/api/src/modules/attendance/attendance.service.ts`.

---

## 1. Jenis Sesi

Enum `jenis_absensi` di `packages/db/src/schema/_base.ts`:

| Nilai | Kegunaan |
|---|---|
| `MEETING` | Rapat rutin/koordinasi (jenis yang dipakai data hasil migrasi). |
| `EVENT` | Kegiatan besar hasil program kerja. |
| `ACTIVITY` | Kegiatan harian/divisi. |
| `TRAINING` | Pelatihan atau workshop. |
| `COMMITTEE` | Rapat panitia. |

Semua jenis mengikuti alur yang sama, sehingga absensi dari WhatsApp, Mobile, Web, dan
pemindaian QR menghasilkan bentuk data yang identik.

### Status sesi

```
DRAFT ──(buka)──> OPEN ──(tutup)──> CLOSED
   │                │
   └────(…)─────────┴────> CANCELLED
```

Aturan yang ditegakkan `AttendanceService`:

- `bukaSesi()` hanya menerima sesi berstatus **DRAFT** (galat `galatTransisi` bila tidak).
- `tutupSesi()` hanya menerima sesi berstatus **OPEN**.
- Pencatatan kehadiran **hanya boleh saat status OPEN**. Bila sesi sudah `CLOSED`
  atau `CANCELLED`, service melempar galat konflik dengan pesan
  "kehadiran hanya bisa dicatat saat sesi OPEN".
- Scheduler latar (`apps/api/src/modules/sistem/scheduler.service.ts`) menutup sesi
  yang kedaluwarsa secara otomatis lewat `tutupSesiKedaluwarsa()`, dilindungi advisory
  lock Postgres agar aman pada multi-instance.

---

## 2. Siapa yang Wajib Hadir

`attendance_sessions` menyimpan daftar pembatas:

| Kolom | Efek |
|---|---|
| `hanya_division_ids[]` | Daftar divisi yang wajib absen. Kosong = seluruh anggota aktif. |
| `hanya_jabatan_ids[]` | Daftar jabatan yang wajib absen. |
| `member_ids[]` | Daftar anggota eksplisit. |
| `wajib_hadir` | Bawaan `true`. Bila `false`, kehadiran bersifat sukarela. |
| `batas_keterlambatan_menit` | Bawaan 15. Di atas batas → status `LATE` dengan `menit_keterlambatan`. |
| `qr_ttl_detik` | Bawaan 120. Umur token QR. |

### Pembekuan peserta

Saat sesi dibuka, `bekukanPeserta()` menyalin seluruh anggota yang memenuhi kriteria ke
tabel `attendance_participants`. Ini penting karena:

- anggota yang bergabung **setelah** sesi dibuka tidak otomatis menjadi wajib;
- anggota yang diarsipkan tetap punya rekap yang konsisten;
- rekap "siapa yang belum absen" bisa dihitung tanpa menyentuh daftar anggota terkini.

---

## 3. Status Kehadiran

Enum `status_hadir`:

| Status | Arti | Wajib alasan? | Dihitung "hadir"? |
|---|---|---|---|
| `PRESENT` | Hadir | Tidak | Ya |
| `LATE` | Hadir tetapi terlambat | Tidak | Ya |
| `EXCUSED` | Izin | **Ya, minimal 3 karakter** | Tidak (terhitung terpisah) |
| `SICK` | Sakit | **Ya, minimal 3 karakter** | Tidak |
| `ABSENT` | Tidak hadir tanpa keterangan | Tidak | Tidak |

- `STATUS_TERHADIR` di `packages/contracts/src/enums.ts` = `['PRESENT', 'LATE']`.
- `ALASAN_HADIR_WAJB` = `['EXCUSED', 'SICK']`.

Invariant database `chk_alasan_wajib` (`packages/db/src/sql/invariants.ts`):

```sql
ALTER TABLE attendance_records
  ADD CONSTRAINT chk_alasan_wajib CHECK (
    status IN ('PRESENT', 'LATE', 'ABSENT')
    OR (alasan IS NOT NULL AND length(trim(alasan)) >= 3)
  );
```

Service memeriksa hal yang sama lebih dulu (`catatHadir`, `ubahManual`) sehingga
pengguna menerima galat `VALIDATION_FAILED` yang jelas, bukan galat basis data mentah.

---

## 4. Sumber Kehadiran

Enum `sumber_absensi`: `WEB`, `MOBILE`, `WHATSAPP`, `ADMIN`, `QR`.

| Sumber | Kapan dipakai |
|---|---|
| `WHATSAPP` | Anggota mengirim `HADIR`/`IZIN`/`SAKIT` ke bot. |
| `QR` | `catatHadir` dipanggil dengan `tokenQr` — backend menandai sumber `QR`. |
| `WEB` | Absensi dari Web Dashboard. |
| `MOBILE` | Absensi dari aplikasi mobile. |
| `ADMIN` | Dibuat atau diubah otomatis oleh sistem/pengurus. Baris `ABSENT` otomatis memakai sumber ini. |

### Bagaimana backend menentukan sumber

Sumber **tidak pernah** diambil dari badan permintaan. Menyalinnya dari klien
akan membuat anggota bisa menandai absensinya sendiri sebagai `ADMIN`.

`apps/api/src/common/utilitas/sumber-kanal.ts` menentukan sumber berurutan:

1. **Header `x-osda-sumber`** — dipasang client resmi (Web, Mobile, Bot).
   Nilai di luar daftar yang diizinkan jatuh ke bawaan, bukan diterima apa adanya.
2. **USER_AGENT** — untuk klien yang tidak memasang header
   (`osda-bot`/`whatsapp` → `WHATSAPP`, `expo`/`okhttp`/`react-native` → `MOBILE`).
3. **Bawaan `WEB`.**

Pengecualian: bila permintaan membawa `tokenQr`, backend menandai sumber `QR`
secara langsung, karena pemindai QR adalah bukti yang tidak bisa dipalsukan klien.

Catatan migrasi: `tools/legacy/scripts/migrate-to-v2.mjs` memakai `ADMIN` untuk
baris yang dibuat otomatis, dan hanya memberi `WHATSAPP` pada status yang benar
diisi anggota (`PRESENT`, `LATE`, `EXCUSED`, `SICK`).

> Uji end-to-end memverifikasi hal ini: absensi berheader `x-osda-sumber: WHATSAPP`
> tercatat dengan sumber `WHATSAPP`, sedangkan permintaan biasa tercatat `WEB`.

---

## 5. Token QR

Tabel `attendance_qr_tokens` menyimpan token **sekali pakai**:

| Kolom | Keterangan |
|---|---|
| `jti` | Identitas token, disalin ke `attendance_records.qr_token_jti` agar jejak audit mudah dilacak. |
| `token_hash` | Hanya hash yang disimpan; token mentah tidak pernah masuk database. |
| `berlaku_sampai` | Kedaluwarsa (dihitung dari `qr_ttl_detik`, bawaan 120 detik). |
| `dipakai_pada` | Diisi setelah dipakai. |
| `dipakai_oleh_member_id` | Anggota yang memakai token. |
| `dibatalkan` | Bila pengurus membatalkan. |

### Alur pemeriksaan

```
POST /api/v1/attendance/qr/verifikasi   { "token": "…" }
   │
   ├─ hash token, cari di attendance_qr_tokens
   ├─ tidak ditemukan        → { valid: false, pesan: 'Token QR tidak dikenali.' }
   ├─ sudah dipakai          → { valid: false, pesan: 'Token QR sudah dipakai.' }
   ├─ dibatalkan             → { valid: false, pesan: 'Token QR sudah dibatalkan.' }
   ├─ sesi tidak OPEN        → { valid: false, pesan: 'Sesi berstatus … bukan OPEN.' }
   ├─ kedaluwarsa            → { valid: false, pesan: 'Token QR sudah kedaluwarsa.' }
   └─ sah → { valid: true, sessionId, judul }
```

Kemudian klien memanggil `POST /api/v1/attendance/sessions/:id/absen` membawa token
yang sama, dan catatan tercatat dengan `sumber: 'QR'`.

Sifat token menurut komentar pada skema: short-lived, signed (HMAC dengan rahasia sisi
server yang disimpan di `attendance_sessions.qr_secret`), session-bound, dan non-reusable.
Setiap kali token kedaluwarsa, token baru diterbitkan (kolom `qr_terakhir_diatur_pada`).

---

## 6. Aturan Idempotensi

Absensi adalah operasi yang paling sering terpicu dua kali (jaringan seluler, ketukan
ganda, pesan WhatsApp masuk dua kali). Karena itu ada **tiga lapis** idempotensi:

### Lapis 1 — `idempotency_key` klien

```
POST /api/v1/attendance/sessions/:id/absen
{ "memberId": "…", "status": "PRESENT", "idempotencyKey": "bot:62812…:2026-09-22" }
```

Bila kunci sudah pernah dipakai pada sesi yang sama, service mengembalikan
`{ id, status, sudahAda: true }` **tanpa menulis apa pun**. Ini bukan galat — klien
perlakukan sebagai sukses.

### Lapis 2 — indeks unik per (sesi, anggota)

```
uniqueIndex('uq_hadir_sesi_member').on(t.sessionId, t.memberId)
```

Satu anggota hanya punya **satu** catatan per sesi. Bila anggota yang sama mencoba
dicatat lagi (dengan kunci berbeda), service melempar galat
`ATTENDANCE_ALREADY_RECORDED` ("Kehadiran anggota ini sudah tercatat pada sesi
tersebut."). Koreksi bukan membatalkan dan mencatat ulang, melainkan memakai `ubahManual`.

### Lapis 3 — indeks unik per (sesi, kunci)

```
uniqueIndex('uq_hadir_idempotensi').on(t.sessionId, t.idempotencyKey)
```

Menjaga bahwa bahkan pada race condition dua permintaan bersamaan, database hanya
menerima satu baris.

Sesi itu sendiri juga idempoten: `uq_sesi_idempotensi` pada
`(organization_id, idempotency_key)` sehingga scheduler tidak membuka sesi ganda.

---

## 7. Izin & Sakit (Permission Request)

`permission_requests` menampung permintaan izin dari anggota (misalnya melalui WhatsApp):

| Kolom | Keterangan |
|---|---|
| `jenis` | `EXCUSED` (izin) atau `SICK` (sakit). |
| `alasan` | Wajib, minimal 5 karakter menurut `SkemaBuatIzin` (`packages/contracts/src/tasks.ts`). |
| `bukti_dokumen_id` | Lampiran opsional (mis. surat dokter). |
| `status` | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`. |
| `kode` | Nomor permintaan yang bisa dirujuk balik lewat WhatsApp. |
| `decidedBy`, `decidedAt`, `komentar` | Diisi pengurus yang memutuskan. |

Alur:

```
Anggota kirim "IZIN <alasan>" ke bot
   → bot panggil API dengan sumber WHATSAPP
     → permission_requests berstatus PENDING
       → pengurus putuskan (attendance.manage)
         → APPROVED  : attendance_records diisi status EXCUSED
         → REJECTED  : anggota harus hadir atau berstatus ABSENT
```

Index unik `uq_izin_sesi_member` memastikan satu permintaan per anggota per sesi, dan
`uq_izin_kode` memastikan nomor permintaan tidak kembar.

---

## 8. Menutup Sesi & Menghitung Rekap

`tutupSesi()` melakukan tiga hal dalam satu jalur:

1. Mengubah status menjadi `CLOSED` dan mencatat `ditutup_pada`, `ditutup_oleh`.
2. Bila `tandaiHadirSebagaiTidakHadir` bernilai true, memanggil `tandaiTidakHadir()`:
   setiap peserta wajib yang belum punya catatan diisi `ABSENT` dengan sumber `ADMIN`
   dan catatan "Ditandai otomatis saat sesi ditutup." Menggunakan
   `onConflictDoNothing()` agar tidak menimpa catatan yang sudah ada.
3. Menghitung rekap lewat `hitungRekap()` dan menuliskannya ke kolom denormalisasi
   `rekap_total_wajib`, `rekap_hadir`, `rekap_izin`, `rekap_sakit`, `rekap_tidak_hadir`.

Rekap memuat: `totalWajib`, `hadir`, `terlambat`, `izin`, `sakit`, `tidakHadir`,
`belumAbsen`, serta daftar nama per status (dengan `kelas` yang disusun dari
`tingkat + jurusan + subKelas`).

> Catatan: `tandaiTidakHadir` bersifat opsional. Data hasil migrasi menunjukkan 490
> catatan untuk 10 sesi × 49 anggota, di mana 20 baris `ABSENT` dibuat otomatis oleh
> skrip migrasi. Pastikan langkah otomatis ini dijalankan agar "tanpa keterangan" tidak
> berarti "kosong".

---

## 9. Perubahan Manual

`POST /api/v1/attendance/records/:id/manual` (izin `attendance.manage`) mengubah status
sebuah catatan. Service **wajib** menerima `alasan`:

- Bila status baru `EXCUSED`/`SICK`, alasan diverifikasi lebih dulu.
- Baris memperbarui `status`, `alasan`, `catatan`, `diubah_oleh`, `diubah_pada`,
  dan `alasan_perubahan`.

Catatan lama tidak dihapus. Jejak perubahan tersimpan di baris itu sendiri
(`diubah_oleh`, `diubah_pada`, `alasan_perubahan`) dan tercatat di audit lewat
`AuditInterceptor` — perlu dicatat bahwa rute `/attendance/records/:id/manual` tidak
cocok dengan pola apa pun pada `PETA_AKSI`, sehingga aksi audit yang tertulis adalah
nilai bawaan `SETTINGS_CHANGED`. Bila Anda ingin nama aksi yang benar, tambahkan pola
rute pada `apps/api/src/common/interceptors/audit.interceptor.ts`.

---

## 10. Alur Lengkap (Ringkas)

```
Pengurus buat sesi ── POST /attendance/sessions
        │  (status DRAFT, peserta dibekukan sesaat setelah ini)
        ▼
Pengurus buka sesi ── POST /attendance/sessions/:id/buka
        │  status OPEN, token QR terbit (TTL 120 detik)
        ▼
Anggota absen ────── POST /attendance/sessions/:id/absen   (sumber WEB/MOBILE/WHATSAPP/QR)
        │  idempoten lewat idempotencyKey; unik (sesi, anggota)
        ▼
Anggota izin/sakit ─ POST /permission-requests → PENDING → diputuskan pengurus
        ▼
Pengurus tutup sesi ─ POST /attendance/sessions/:id/tutup
           status CLOSED, peserta wajib tanpa catatan → ABSENT, rekap dihitung
```

---

## Catatan untuk AI agent

1. Jangan mengubah `sumber` absensi menjadi bebas. Nilainya hanya
   `WEB/MOBILE/WHATSAPP/ADMIN/QR`; menambah nilai baru berarti mengubah enum PostgreSQL
   (`sumber_absensi`) — perlu migrasi.
2. `menit_keterlambatan` saat ini selalu ditulis `null` oleh `catatHadir`. Bila Anda
   ingin mengisinya, lakukan perhitungan di service berdasarkan
   `batas_keterlambatan_menit`, jangan hanya mengandalkan status `LATE` dari klien.
3. Jangan hapus `attendance_participants` saat sesi dibuka. Baris itu adalah foto siapa
   yang wajib hadir; menghapusnya membuat rekap "belum absen" salah.
4. Setiap perubahan pada aturan absensi harus memperbarui `chk_alasan_wajib` bila
   berhubungan dengan alasan, dan `uq_hadir_sesi_member` bila berhubungan dengan aturan
   satu catatan per anggota.
5. Bot WhatsApp mengirim `sumber: WHATSAPP` dari sisi klien, tetapi keputusan akhir ada
   di API. Jangan pernah mempercayai `sumber` yang dikirim klien untuk audit — bila perlu,
   turunkan dari konteks permintaan.
