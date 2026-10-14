# Skill

Skill adalah **kemampuan yang dijelaskan dalam Markdown**. Skill berisi
petunjuk, bukan kode.

## Prinsip

> **Skill menjelaskan bagaimana AI menggunakan kemampuan. Eksekusi tetap
> dilakukan oleh Tool Registry.**

Implikasinya:

- Skill **tidak bisa** menjalankan kode.
- Skill **tidak bisa** memberi izin sendiri.
- Skill yang menyebut permission yang tidak dimiliki akan **disaring** saat
  prompt disusun.
-_permission yang tertulis di `SKILL.md` adalah **dokumentasi alasan**, bukan
  sumber kebenaran. Kebenarannya tetap di `AuthorizationService`.

## Format

```
skills/
├── attendance/
│   └── manage-attendance/
│       └── SKILL.md
├── communication/
│   └── compose-message/
│       └── SKILL.md
└── organization/
    └── manage-members/
        └── SKILL.md
```

### Front-matter

```markdown
---
name: manage-attendance
description: Mengelola daftar hadir organisasi secara percakapan.
version: 1.0.0
required_tools:
  - attendance.get
  - attendance.update
  - attendance.add_member
required_permissions:
  - attendance.read
  - attendance.update
contexts: [private, group]
triggers:
  - daftar hadir
  - absen
  - izin
---

# Kelola Kehadiran
...
```

### Field wajib

| Field | Wajib | Keterangan |
|---|---|---|
| `name` | ✅ | Huruf kecil, angka, tanda hubung saja |
| `description` | ✅ | Menjelaskan apa yang dilakukan |
| `version` | — | Default `1.0.0` |
| `required_tools` | — | Tool yang dibutuhkan |
| `required_permissions` | — | Izin yang dibutuhkan |
| `contexts` | — | `[private]`, `[group]`, `[both]`. Default keduanya |
| `triggers` | — | Keyword untuk pre-filtering |

Skill yang tidak punya `name` atau `description`, atau namanya pakai karakter
terlarang (`Skill_With_Underscore`), **ditolak** saat load.

Skill yang gagal dimuat **tidak** menyebabkan crash — dicatat sebagai issue
dan dilewati.

## Parser front-matter

Parser yang dipakai (`parseFrontMatter`) sengaja **bukan** pustaka YAML penuh.

Alasannya:

- Kita hanya butuh subset kecil: `key: value` dan daftar.
- Parser YAML penuh menambah permukaan serangan (anchor, alias, merge) tanpa
  manfaat nyata di sini.
- Tidak ada dependensi tambahan.

Yang didukung:

```yaml
name: nilai-teks
version: "1.0.0"
required_tools:            # daftar multi-baris
  - tool.satu
  - tool.dua
required_permissions: [a, b, c]   # daftar sebaris
```

## Pemilihan skill

`SkillRegistry.select()` melakukan pre-filter untuk mengurangi beban prompt:

1. Konteks cocok (private/group).
2. Aktor **memiliki** seluruh `required_permissions`.
3. Urutkan berdasarkan jumlah `triggers` yang muncul di pesan.

Yang penting dipahami: **pre-filter hanya mengurangi beban prompt, bukan
keputusan akhir.** Keputusan akhir tetap di model + Tool Registry.

Kalau tidak ada skill yang cocok, agent diberi tahu ia tidak punya tool yang
bisa dipanggil — dan diminta untuk jujur, bukan mengarang.

## Skill yang tersedia

### `manage-attendance`

Mengelola daftar hadir. Aturan kunci yang ditegakkan:

1. Pastikan daftar yang dimaksud sebelum mengubah.
2. Jangan pernah mengarang anggota — selalu cari dulu.
3. Kalau nama ambigu — **berhenti dan tanya**.
4. Ubah hanya field yang diminta.
5. Tampilkan ulang daftar setelah perubahan.

### `manage-members`

Melihat, mencari, menambahkan anggota. Termasuk membaca daftar dari teks:

```
1. Ni Ketut Rianti (X MPK 1)
2. Danya Sefti Cahyani (X AKL 3)
```

Deteksi duplikasi sebelum menyimpan. Menambahkan anggota **tidak**
otomatis menghubungkan nomor WhatsApp-nya.

### `compose-message`

Menyusun pengumuman, undangan, dan pesan resmi.

Aturan format WhatsApp (bukan Markdown GitHub). Placeholder untuk data yang
belum diketahui:

```
*Hari/Tanggal:* [Belum ditentukan]
```

**Jangan pernah mengirim tanpa diminta.** Buat draf dulu.

## Menulis skill baru

Checklist:

1. `SKILL.md` di foldernya sendiri.
2. Front-matter lengkap dengan `name` & `description`.
3. `required_tools` **benar-benar** dipanggil di isi skill.
4. `required_permissions` sesuai dengan yang dibutuhkan.
5. `description` menjelaskan KAPAN skill dipakai — itu yang dibaca model.
6. Tambahkan aturan negatives ("jangan menebak nama orang") — bukan cuma
   langkah positif.
7. Test: `pnpm exec vitest run tests/unit/skills.test.ts`

## Batasan saat ini

| Yang belum ada | Dampak |
|---|---|
| Validasi bahwa `required_tools` benar-benar terdaftar | Skill bisa menyebut tool yang belum ada |
| Skill versioning di database | `SkillRecord`/`SkillVersion` ada tapi belum dipakai |
| Skill Factory (generate draft) | Belum ada |
| Approval untuk aktivasi skill | Belum ada |

Skill Factory sengaja ditunda: menghasilkan skill dari percakapan membuka
permukaan baru. Kalau dibuat, harus ada validasi ketat bahwa skill baru
tidak memperkenalkan akses privileged yang belum disetujui.