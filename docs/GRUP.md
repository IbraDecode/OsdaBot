# Grup WhatsApp

Status: **IMPLEMENTED** · **TESTED** (479 test lulus, 0 gagal)

---

## 1. Kenapa bot tidak merespons di grup

Alasannya satu, dan tidak intuitif:

```
grup belum tertaut ke organisasi  →  pesan dilewati (group_not_linked)
```

Grup yang tidak tertaut **tidak punya konteks organisasi**. Tanpa itu, bot tidak
tahu harus menjawab sebagai siapa, dan data mana yang boleh dibuka.

 Dan bot tidak diam-diam. Pesan dari grup yang belum tertaut dicatat di
tabel `seen_groups`, dan operator melihat daftarnya lewat:

```bash
pnpm osda group:pending
```

Sebelum perubahan ini, grup yang belum tertaut **ditolak tanpa jejak**.
Akibatnya bot terlihat "rusak" tanpa penjelasan apa pun — persis complaint yang
dialami pengguna.

---

## 2. Cara menautkan grup

### Otomatis (disarankan)

Saat bot menyala dan soket benar-benar terhubung, bot memindai **semua grup yang
diikuti** dan mencatat yang belum tertaut:

```bash
pnpm osda group:pending
```

Bot ikut mencetak di log:

```
INFO: daftar grup diperiksa
  totalGrup: 3
  perluTaut: 1
WARN: ada grup yang belum tertaut — bot TIDAK akan merespons di sana sampai ditautkan
  grup: ["📝 ABSENSI & PERIZINAN (120363411304978267@g.us)"]
```

### Manual

```bash
pnpm osda group:link --jid=120363411304978267@g.us --org=osis-smkn-2-mataram
```

`--org` menerima **id, slug, atau nama**.

> **Bug yang sudah diperbaiki:** versi awal mengirim nilai `--org` ke kolom `id`
> apa adanya. Kolom itu bertipe `@db.Uuid`, jadi PostgreSQL menolak dengan
> `Error creating UUID, invalid character: found 'o' at 1` — pesan yang tidak
> membantu operator sama sekali. Sekarang `id` hanya ikut dicocokkan kalau
> nilainya memang berbentuk UUID.

### Perintah lain

| Perintah | Guna |
|---|---|
| `group:pending` | Grup yang mengirim pesan tapi belum tertaut |
| `group:list` | Grup yang sudah tertaut |
| `group:link` | Hubungkan grup ke organisasi |
| `group:activation --jid= --mode=` | Ubah kapan bot merespons |
| `group:unlink` | Lepas tautan (riwayat tidak ikut terhapus) |

---

## 3. Kapan bot merespons di grup

Default: **`MENTION_OR_REPLY`**. Bot hanya merespons kalau:

- Bot di-`@mention`, atau
- Namanya disebut (`osda`, `osdabot`, `bot`, atau nama bot dari `WHATSAPP_BOT_NAME`).

Ubah dengan:

```bash
pnpm osda group:activation --jid=<JID> --mode=ALL_MESSAGES   # semua pesan
pnpm osda group:activation --jid=<JID> --mode=OFF            # tidak pernah
```

> **Kenapa default-nya bukan `ALL_MESSAGES`:** bot yang membalas semua pesan di
> grup boros token dan menyela percakapan orang. Itu harus diminta eksplisit.
> Ada regression test yang menjaga hal ini.

---

## 4. Menautkan grup = memberikan izin

Menautkan grup berarti memberi akses ke **data organisasi**: daftar anggota,
buku kas, daftar hadir. Jadi ini bukan catatan, tapi pemberian izin.

Aturan yang dijaga:

1. **Satu grup = satu organisasi.** `jid` unik global. Grup yang sama tidak
   boleh dimiliki dua organisasi — kalau bisa, isi grup jadi dua sumber
   kebenaran.

2. **Aktivasi default aman.** `MENTION_OR_REPLY`, bukan `ALL_MESSAGES`.

3. **Melepas tautan tidak menghapus riwayat.** `group:unlink` menghapus
   barisnya sendiri; data kehadiran dan pengingat **tetap**. Menghapus riwayat
   tanpa diminta adalah keputusan manusia, bukan efek samping.

4. **Grup kosong tidak ikut terhapus.** `sinkronSubjek()` hanya menyentuh
   kolom `subject`. Aktivasi, arsip, dan tautan tetap milik keputusan operator.

---

## 5. Dua bug yang ditemukan lewat pengujian nyata

### Bug semantik NULL SQL

Untuk menyimpan subjek grup, kode pertama memakai:

```ts
updateMany({ where: { jid, NOT: { subject: subjekBaru } } })
```

Ini **tidak cocok** untuk baris dengan `subject IS NULL`. Di SQL,
`NULL <> 'x'` menghasilkan `NULL`, bukan `TRUE` — jadi baris dengan subjek
kosong lolos tanpa pernah tersimpan.

Dampak yang terlihat: grup yang tertaut tampil `(tanpa subjek)` padahal
namanya jelas ada, dan operator tidak bisa mengidentifikasi grupnya.

Perbaikannya:

```ts
updateMany({ where: { jid, OR: [{ subject: null }, { subject: { not: subjekBaru } }] } })
```

**Test double Prisma tidak bisa memodelkan semantik NULL SQL.** Karena itu
regression test-nya harus integrasi ke database sungguhan. Unit test akan
lulus dua-duanya.

### Pemindaian sebelum soket terhubung

Kode pertama memindai daftar grup tepat setelah `connect()` resolve. Tapi
`connect()` resolve **sebelum socket open**, jadi pemindaian gagal dengan
`Connection Closed`. Karena kegagalannya ditelan diam-diam, hasilnya: bot tidak
pernah menemukan grup padahal jelas ada.

Perbaikannya: pindai di event `connection` saat state `connected`.

---

## 6. Batas yang diketahui

| Batas | Dampak |
|---|---|
| **Bot hanya merespons kalau disebut** | `MENTION_OR_REPLY` adalah default. Untuk grup yang ramai, ini memang benar — tapi kalau pengguna ingin "balas semua", harus diubah manual. |
| **Tidak ada pengaturan per-anggota di grup** | Policy-nya per-grup, bukan per-orang. |
| **Tidak ada moderasi** | Bot tidak bisa memblokir anggota, dan tidak ada rate limiting per grup selain batas global. |
| **Satu grup hanya satu organisasi** | Kalau organisasi memang butuh dua grup, keduanya harus punya JID berbeda — yang sudah otomatis begitu. |
| **Subjek grup berasal dari event WhatsApp** | `groupFetchAllParticipating` kadang mengembalikan metadata tanpa `subject`; sumber subjek yang lengkap adalah event `groups.update`. |
| **Tidak ada undo** | `group:unlink` menghapus tautan. Tidak ada cara mengembalikannya selain `group:link` lagi. |