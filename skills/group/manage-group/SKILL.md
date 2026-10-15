---
name: manage-group
description: Melihat grup WhatsApp yang diikuti bot, menautkannya ke organisasi supaya bot merespons di sana, dan mengatur kapan bot menjawab.
version: 1.0.0
required_tools:
  - group_list_joined
  - group_link
  - group_set_activation
required_permissions:
  - groups.configure
contexts: [private]
triggers:
  - grup
  - group
  - bot gabisa
  - bot tidak merespons
  - bot diam
  - tautkan
  - hubungkan grup
  - di grup
---

# Kelola Grup WhatsApp

## Tujuan
Membuat bot berlaku di grup yang benar, dan tidak mengganggu di grup yang
seharusnya tenang.

## Yang wajib diketahui pengguna

**Bot yang ditambahkan ke grup tapi belum tertaut akan diam total.** Pesannya
tidak sampai ke bot, dan bot tidak memberi tahu apa pun. Ini yang paling sering
dial-report sebagai "bot gabisa ya".

Jadi kalau pengguna bilang bot tidak merespons di grup: **panggil
`group_list_joined` lebih dulu**, jangan langsung menyuruh mencoba-coba.

## Alur yang benar

### Mendiagnosis "bot gabisa"

1. `group_list_joined` — daftar grup beserta status tertaut.
2. Kalau ada yang `BELUM tertaut`, Activity itu sebabnya. Jelaskan ke pengguna,
   jangan diamkan.
3. Kalau semuanya tertaut, masalahnya kemungkinan lain: pesan tidak menyebut
   nama bot. Ingatkan: tulis `osda ...` atau mention.

### Menautkan grup

1. `group_link` dengan JID grup. **Sistem akan meminta persetujuan** — itu
   benar, karena menautkan grup berarti memberi grup itu akses ke data
   organisasi (anggota, kas, absensi).
2. Setelah disetujui, jelaskan ke pengguna bahwa bot **hanya akan merespons
   kalau namanya disebut**.

### Mengatur kapan bot menjawab

- `MENTION_OR_REPLY` (default) — hanya kalau disebut atau di-mention.
- `ALL_MESSAGES` — semua pesan. **Boros token dan menyela percakapan orang.**
  Jangan dipakai tanpa diminta.
- `OFF` — tidak pernah. Pakai ini kalau grup terlalu ramai.

## Hal yang harus jujur Oportun said

- Kalau ada **lebih dari satu** grup belum tertaut, jangan menebak. Tanyakan
  yang mana. Menautkan grup yang salah memberi akses data ke chat yang tidak
  seharusnya.
- Kalau grup **sudah milik organisasi lain**, jangan menawarkan memindahkannya.
  Satu grup hanya boleh dimiliki satu organisasi.
- Kalau grup punya **nama yang sama persis**, itu tetap grup yang berbeda.
  Bedakan dari JID-nya, bukan dari namanya.

## Batas penting

- **Menautkan hanya lewat chat pribadi.** Di grup, metadata grup tidak bisa
  dibaca dengan aman — grup yang belum tertaut tidak tahu organisasinya.
- **Tidak ada moderasi.** Bot tidak bisa memblokir anggota grup, dan tidak ada
  rate limiting per grup selain batas global.
- **Tidak ada pengaturan per-anggota.** Policy-nya per-grup, bukan per-orang.