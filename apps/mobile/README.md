# OSDA Mobile

Aplikasi Mobile OSDA Platform berbasis **Expo (React Native)** dengan
`expo-router` (navigasi berbasis berkas).

## Prinsip

1. **Mobile-first, bukan potongannya Web.** Navigasi bawah hanya lima:
   Beranda, Tugas, Notifikasi, Profil. Fitur berat seperti keuangan lengkap
   dan laporan tetap di Web Dashboard.
2. **Quick action.** Empat aksi besar di beranda: `ABSEN`, `IZIN`, `TUGAS`,
   `AGENDA`. Ketiganya memanggil backend yang sama dengan Web dan WhatsApp.
3. **Keamanan (OWASP MASVS).** Token disimpan di `expo-secure-store`
   (Keychain / Android Keystore), bukan AsyncStorage. Tidak ada secret di
   dalam kode. Tautan dalam dan TLS diverifikasi oleh sistem.
4. **Tidak ada akses database langsung.** Semua data lewat REST API OSDA.

## Menjalankan

```bash
cp .env.example .env
# isi EXPO_PUBLIC_API_URL dengan URL API yang bisa dijangkau perangkatmu
pnpm install
pnpm --filter @osda/mobile dev
```

Pindai QR code dengan aplikasi **Expo Go**, atau jalankan di emulator.

## Struktur

```
src/
├── app/                # Halaman (expo-router berbasis berkas)
│   ├── _layout.tsx     # Root layout: penyedia sesi + safe area
│   ├── masuk.tsx       # Halaman masuk
│   └── (tabs)/         # Navigasi tab bawah
│       ├── index.tsx       # Beranda (anggota)
│       ├── tugas.tsx       # Tugas + status verifikasi
│       ├── notifikasi.tsx  # Notifikasi
│       └── profil.tsx      # Profil & izin efektif
├── components/ui.tsx   # Komponen UI dasar
├── contexts/sesi.tsx   # Konteks sesi (token TIDAK ada di sini)
└── lib/api.ts          # Klien API + penyimpanan aman
```
