# Provisioning Organisasi

Cara menyiapkan organisasi **nyata** tanpa bergantung pada seed. Seed mengisi
data fiktif untuk pengembangan; modul ini mengisi data yang benar-benar dipakai.

---

## 1. Masalah yang diselesaikan

Sebelum modul ini ada, satu-satunya cara menyiapkan organisasi adalah
`pnpm osda db:seed` yang membuat organisasi **fiktif**. Artinya:

- Tidak ada jalan untuk=on-board OSIS/LKBB asli.
- `WHATSAPP_ADMIN_PHONE` ada di environment, tapi **tidak pernah** memberi akses
  apa pun ke database. Bot tetap membalas *"aku belum tahu kamu bagian dari
  organisasi mana"* ke semua orang.

---

## 2. Rantai yang harus benar

Izin tidak datang dari satu tempat. Semua rantai berikut harus menyambung:

```
WhatsAppIdentity.userId  ──→  User
                               │
                               └─→  OrganizationMember.userId
                                      │
                                      └─→  MemberRoleBinding
                                              │
                                              └─→  RolePermission
```

Kalau satu mata rantai putus, organisasi ada, permission ada, tapi tidak ada
yang bisa memakainya. Dan gejalanya muncul jauh dari penyebabnya — di
WhatsApp, bukan di database.

---

## 3. Pemakaian

```bash
pnpm osda org:create \\
  --name="OSIS SMA 1 Lombok" \\
  --admin-name="Budi Santoso" \\
  --admin-phone=6285792820173 \\
  --timezone=Asia/Makassar

pnpm osda org:show --slug=osis-sma-1-lombok
pnpm osda org:list
```

`--admin-phone` boleh dihilangkan; nilainya diambil dari
`WHATSAPP_ADMIN_PHONE`.

Opsi lain:

| Opsi | Arti |
|---|---|
| `--slug` | Slug manual. Default dari nama |
| `--timezone` | Default `Asia/Makassar` |
| `--role` | Peran admin. Default `owner` |

---

## 4. Yang disengaja: `verifiedAt` tidak diisi

Provisioning **tidak pernah** mengisi `verifiedAt`.

Nomor di environment adalah **klaim**, bukan bukti. Kalau provisioning
mengisi `verifiedAt`, siapa pun yang bisa menulis `.env` otomatis bisa masuk ke
organisasi. Verifikasi berarti-human adalah langkah terpisah — orangnya harus
membuktikan kepemilikan nomor dari dalam WhatsApp.

Konsekuensi: sampai verifikasi dilakukan, bot akan memperlakukan pengirim
sebagai belum terverifikasi meskipun sudah punya izin.

---

## 5. Idempotensi

Menjalankan `org:create` dua kali aman:

```
Jalankan 1 → Status: nomor baru ditautkan
Jalankan 2 → Status: nomor sudah ada, diperbarui
Anggota     : 1 (tidak jadi 2)
Peran       : 7 (tidak berubah)
```

Ini penting karena perintah ini kemungkinan besar dijalankan ulang saat
meng troubleshoot.

### Kenapa tidak pakai `upsert` dengan kunci gabungan

`OrganizationMember` **tidak punya** unique constraint pada
`(organizationId, searchName)` — hanya index. Menambahkan constraint itu akan
melarang dua anggota bernama sama, dan itu bisa sah di organisasi nyata.

`MemberAlias` juga tidak punya unique pada `(memberId, alias)`.

Jadi keduanya dicek dulu sebelum dibuat. Constrainer itu keputusan bisnis,
bukan urusan modul provisioning.

---

## 6. Permission peran

Permission tiap peran dihapus lalu dibuat ulang:

```ts
await deleteMany({ where: { roleId } })
await createMany({ data: permissions })
```

Bukan ditumpuk. Kalau ditumpuk, izin lama yang sudah tidak berlaku akan tetap
aktif setiap kali template diperbarui.

---

## 7. Balık pemanggilan `org:create`

`org:create` selalu membuat peran, tapi **tidak** pernah menghapus anggota.
Kalau perlu memulai dari nol untuk organisasi uji, hapus manual lewat SQL atau
tambah perintah `org:drop` (belum ada).

---

## 8. Status

| Yang | Status |
|---|---|
| Slugify & validasi nomor | `VERIFIED` |
| Pembuatan organisasi + peran | `VERIFIED` — 7 role dibuat |
| Linking nomor → anggota → peran | `VERIFIED` |
| Rantai izin (RBAC) | `VERIFIED` — owner dapat 50/50 permission |
| Idempotensi | `VERIFIED` — dijalankan 2× di database sungguhan |
| `verifiedAt` dikosongkan | `VERIFIED` |
| Diterima lewat WhatsApp | `NOT VERIFIED` — pairing masih terblokir 429 |
| Onboarding anggota non-admin | **Belum ada** — hanya `linkAdmin` |