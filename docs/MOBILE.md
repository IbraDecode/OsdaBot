# Aplikasi Mobile (Rencana)

> **Status:** aplikasi Mobile **belum ada kodenya**. Direktori `apps/mobile` masih
> kosong. Dokumen ini adalah rencana teknis dan daftar prinsip keamanan yang harus
> dipenuhi. Jangan menganggap bagian di bawah sebagai sesuatu yang sudah berjalan.

---

## 1. Ringkasan Rencana

| Aspek | Rencana |
|---|---|
| Kerangka | Expo (React Native), TypeScript |
| Target | Android & iOS |
| Bahasa | Bahasa Indonesia |
| Komunikasi | REST ke `/api/v1/*`, token dari `/api/v1/auth/login` |
| Penyimpanan token | `expo-secure-store` (Keychain/Keystore) |
| Push | Notifikasi push lewat `notification_deliveries` (metode `PUSH`) |
| Offline | Antrean aksi lokal, dikirim saat jaringan kembali |

Prinsipnya sama dengan Web: **keputusan otorisasi tetap di API.** Aplikasi mobile hanya
menyembunyikan fitur agar pengalaman pengguna rapi.

---

## 2. Arsitektur Aplikasi

```
Expo App
  │
  ├─ Navigasi berbasis peran
  │    /dasbor        — kartu sesuai peran (DasborAnggota/DasborKoordinator/…)
  │    /absen         — daftar sesi + tombol "Hadir"
  │    /tugas         — tugas saya, tandai selesai
  │    /acara         — acara yang diikuti
  │    /pengumuman    — pengumuman untuk saya
  │    /profil        — profil, preferensi notifikasi, keluar
  │
  ├─ Lapisan data
  │    · klien API (fetch + pengelola token)
  │    · cache lokal sesi & tanggal
  │    · antrean aksi offline
  │
  └─ Integrasi sistem
       · push notification
       · pembukaan tautan dalam (deep link) dari WhatsApp
       · pemindaian QR absensi (expo-camera)
```

Peran yang paling diuntungkan mobile adalah `MEMBER` dan `COORDINATOR`:

- Anggota: absen, lihat tugas, lihat acara, baca pengumuman.
- Koordinator: melihat divisinya, tugas per anggota, kehadiran, program divisi.

---

## 3. Quick Actions (Tindakan Cepat)

Rencana pintasan yang muncul di beranda ponsel (App Shortcuts) dan widget:

| Pintasan | Izin | Aksi |
|---|---|---|
| **Hadir** | `attendance.write` | Membuka langsung halaman absensi sesi yang sedang terbuka; tekan satu tombol untuk mencatat `PRESENT`. |
| **Izin/Sakit** | `attendance.write` | Membuka formulir `EXCUSED`/`SICK` (alasan wajib). |
| **Pindai QR** | `attendance.write` | Membuka pemindai QR dan memanggil `/api/v1/attendance/qr/verifikasi` lalu `absen`. |
| **Tugas saya** | `task.read` | Daftar tugas dengan tenggat terdekat. |
| **Bayar kas** | — | Membuka halaman pembayaran kas periode `OPEN` (QRIS). |
| **Agenda hari ini** | `meeting.read` | Agenda rapat hari ini. |

Aturan penting untuk tindakan cepat:

- Pintasan hanya tampil bila pengguna **benar-benar** memiliki izinnya
  (dibaca dari `GET /api/v1/users/me`).
- Tindakan cepat wajib mengirim `Idempotency-Key` supaya ketukan ganda tidak menghasilkan
  absensi ganda (lihat `ATTENDANCE.md`).
- Tidak boleh ada tindakan cepat untuk tindakan berbahaya (menghapus, menyetujui).

---

## 4. Alur Absensi dari Mobile

```
1. Pindai QR sesi → kirim token ke /api/v1/attendance/qr/verifikasi
2. Bila valid → tampilkan judul sesi, konfirmasi
3. Pengguna tekan "Hadir"
4. POST /api/v1/attendance/sessions/:id/absen
     { memberId, status: 'PRESENT', tokenQr: <token>, idempotencyKey }
5. Respons:
     { id, status, sudahAda: false }      → berhasil
     { id, status, sudahAda: true }       → sudah tercatat (perlakukan sebagai sukses)
     galat ATTENDANCE_ALREADY_RECORDED   → sudah tercatat dari sumber lain
```

Catatan: bila sesi sudah `CLOSED`, API menolak dengan pesan
"kehadiran hanya bisa dicatat saat sesi OPEN". UI harus menonaktifkan tombol.

---

## 5. Pembayaran Kas dari Mobile

Alur QRIS (lihat `FINANCE.md`):

```
1. GET /api/v1/finance/periods            → cari periode kas berstatus OPEN
2. POST /api/v1/finance/payments
     { memberId, jenis: 'KAS', periode: '2026-W41', nominal: 2000, idempotencyKey }
   → menerima { kode, qrString, qrUrl, kedaluwarsaPada, status: 'PENDING' }
3. Tampilkan QR, tunggu webhook provider
4. Bila pengguna membayar di luar aplikasi, tarik ulang:
     GET /api/v1/finance/payments?memberId=…&status=PAID
```

`idempotencyKey` wajib dibuat stabil di perangkat (mis. UUID yang disimpan di storage
lokal per periode). Tanpa itu, ketukan ganda akan membuat dua intent pembayaran.

---

## 6. Keamanan (OWASP MASVS)

Aplikasi mobile harus memenuhi praktik berikut. Rujukan: OWASP Mobile Application
Security Verification Standard (MASVS).

### MASVS-STORAGE (Penyimpanan)

| Praktik | Wajib |
|---|---|
| Token akses & refresh disimpan di `expo-secure-store` (Keychain/Keystore) | Ya |
| Tidak ada token di `AsyncStorage`, `localStorage`, log, atau berkas biasa | Ya |
| Cache data sensitif dienkripsi; bersihkan saat logout | Ya |
| Cache keyboard dimatikan untuk field sandi | Ya |

### MASVS-AUTH (Autentikasi)

| Praktik | Wajib |
|---|---|
| Akses token berlaku pendek (`JWT_ACCESS_TTL`, 15 menit bawaan) | Ya |
| Refresh token disimpan aman; hanya dikirim ke `/api/v1/auth/refresh` | Ya |
| Logout memanggil `POST /api/v1/auth/logout` agar sesi dicabut di server | Ya |
| Opsi kunci aplikasi (biometrik/PIN) untuk membuka aplikasi | Disarankan |

### MASVS-NETWORK (Jaringan)

| Praktik | Wajib |
|---|---|
| Semua permintaan memakai HTTPS; tidak ada HTTP polos | Ya |
| Tidak ada *certificate pinning* yang dibuat sembarangan bila belum dipahami | Perhatian |
| Header `x-organization-id` selalu dikirim | Ya |
| Batas waktu permintaan (timeout) dan penanganan galat jaringan | Ya |

### MASVS-PLATFORM (Platform)

| Praktik | Wajib |
|---|---|
| Tidak mengekspor data aplikasi (matikan backup otomatis bila perlu) | Disarankan |
| Tidak menerima *implicit intent* dari aplikasi lain untuk membuka layar sensitif | Ya |
| Tautan dalam (deep link) hanya dari domain resmi (`PUBLIC_WEB_URL`) | Ya |
| Screenshot disembunyikan pada layar sensitif (mis. QR pembayaran) | Disarankan |

### MASVS-RESILIENCE (Ketahanan)

| Praktik | Wajib |
|---|---|
| Deteksi root/jailbreak hanya sebagai peringatan, bukan satu-satunya penjaga | Ya |
| Tidak ada logika izin di sisi klien yang menjadi penjaga tunggal | Ya |
| Aplikasi tetap aman bila API menolak (menangani 401/403 dengan tenang) | Ya |

### MASVS-PRIVACY (Privasi)

| Praktik | Wajib |
|---|---|
| Hanya meminta izin perangkat yang benar-benar dipakai (kamera untuk QR) | Ya |
| Tidak mengumpulkan data pribadi di luar yang dibutuhkan | Ya |
| Pesan galat tidak membocorkan data orang lain | Ya |

---

## 7. Notifikasi Push

1. API menulis baris `notification_deliveries` dengan `metode = 'PUSH'` dalam satu
   transaksi dengan perubahan bisnis (pola outbox).
2. Worker mengirim melalui penyedia push.
3. Aplikasi mendaftarkan token perangkat; saat menekan notifikasi, aplikasi membuka
   tautan dalam sesuai `notifications.actions` (label + url).
4. `notifications.dedup_key` mencegah notifikasi ganda.

Pesan push **tidak boleh** memuat isi sensitif (nominal pengeluaran, status kehadiran
orang lain) — cukup judul; rincian dibuka setelah masuk.

---

## 8. Mode Luring (Offline)

| Data | Strategi |
|---|---|
| Sesi absensi hari ini | Cache pendek (beberapa menit), segarkan saat aplikasi dibuka. |
| Daftar tugas | Cache + penanda waktu; sinkronkan ulang saat online. |
| Absensi | Antrean aksi lokal; kirim saat online dengan `Idempotency-Key` yang sama. |
| Pembayaran | Tidak boleh diantrekan sembarangan — muat ulang status dari API saat online. |

Saat luring, nonaktifkan tombol absen alih-alih mengizinkan pengguna menekan dan
menerima galat yang membingungkan.

---

## 9. Uji yang Perlu Ada

- Absensi dengan token QR kedaluwarsa, sudah dipakai, dan sesi sudah ditutup.
- Absen dua kali dengan `Idempotency-Key` sama → `sudahAda: true`.
- Token kedaluwarsa (401) → refresh otomatis satu kali, lalu logout bila gagal.
- Berganti organisasi (header `x-organization-id` berubah) → data tidak nyangkut.
- Pembayaran QRIS dengan nominal tidak cocok → galat 409 yang jelas.

---

## Catatan untuk AI agent

1. Dokumen ini adalah **rencana**. Jangan menulis kode yang mengasumsikan aplikasi mobile
   sudah ada; `apps/mobile` masih kosong.
2. Jangan pernah menyimpan token di `AsyncStorage`/`localStorage`. Pakai
   `expo-secure-store`.
3. Setiap aksi tulis dari mobile **wajib** membawa `Idempotency-Key`, terutama absensi dan
   pembayaran. Ini yang mencegah data ganda saat jaringan seluler tidak stabil.
4. Jangan menaruh logika izin hanya di klien. `perms` dari `/api/v1/users/me` hanya untuk
   menyembunyikan menu; server tetap bisa menolak.
5. Jangan menampilkan nominal, status kehadiran orang lain, atau isi dokumen di notifikasi
   push. Cukup judul + tautan dalam.
