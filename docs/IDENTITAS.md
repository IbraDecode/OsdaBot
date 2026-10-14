# Identity Engine

## Masalah yang diselesaikan

Bot organisasi selalu berhadapan dengan pertanyaan: **"yang mana?"**

> "osda tambahin Danya"
> "osda ubah Ibra jadi izin"

Database punya `Danya Sefti Cahyani`, `Danya Putri Rahma`, dan
`Ni Ketut Danya`. Satu kata "Danya" bisa berarti tiga orang.

Dua pendekatan yang **salah**:

```typescript
// SALAH 1 — hardcoded
if (name.includes('danya')) return hardcodedMember

// SALAH 2 — ambil yang paling cocok tanpa batas
const best = candidates.sort(byScore)[0]
```

Keduanya menghasilkan perubahan data pada orang yang salah. Untuk daftar
kehadiran, itu merusak kepercayaan terhadap seluruh sistem.

## Normalisasi nama

Sebelum pencocokan, nama dinormalisasi ke bentuk kanonik:

```
"Bapak Danya Sefti Cahyani, S.Kom"
              ↓
  "danya sefti cahyani"
```

Langkah-langkahnya:

1. Gabung gelar bertanda titik dulu (`S.Kom` → `skom`). Kalau titik dihapus
   lebih dulu, gelar pecah jadi dua token dan tidak dikenali.
2. Buang gelar di depan (h, hj, s, sd, bpk, ib, kak…) dan di belakang
   (spd, skom, ssi, sh, se…).
3. Lowercase, buang tanda baca, buang aksen (`Sébastien` → `sebastien`).
4. Rapatkan spasi berlebih.

Bentuk ini disimpan di kolom `searchName` supaya query database tidak perlu
normalisasi ulang.

## Skor kecocokan

`similarityScore()` mengembalikan 0..1:

```
skor = cakupanKueri × 0.7 + cakupanKandidat × 0.3
```

- **Cakupan kueri** (bobot 0.7): berapa bagian dari yang diketik pengguna yang
  ditemukan. Ini yang utama — kalau pengguna mengetik "Danya" dan ada yang
  namanya Danya, itu sinyal kuat.
- **Cakupan kandidat** (bobot 0.3): seberapa lengkap kecococannya dengan nama
  penuh. Ini yang menolak nama yang cuma cocok satu huruf depan.

Kecocokan **prefiks** diberi bobot 0.95, bukan 0.7. "dany" → "danya" hampir
 pasti orang yang sama; ketik cepat di WhatsApp sangat umum.

Contoh skor:

| Kueri | Kandidat | Skor |
|---|---|---|
| `danya` | `Danya` | 1.00 |
| `dany` | `Danya` | 0.95 |
| `Danya` | `Danya Sefti Cahyani` | 0.80 |
| `Danya` | `Ahmad Fauzi` | 0.00 |

## Keputusan: unik / ambigu / tidak ditemukan

`decideMatch()` tidak mengembalikan "yang terbaik" — mengembalikan
**klasifikasi**:

```
SKOR_TERATAS >= 0.62  DAN  (skor_teratas - skor_kedua) >= 0.18  →  unique
skor_teratas < 0.62                                     →  none
selain itu                                              →  ambiguous
```

Margin 0.18 itu penting. Kalau dua anggota skornya 0.80 dan 0.75, sistem
**harus bertanya** — bukan memilih yang 0.80. Selisih 0.05 tidak cukup untuk
mengubah data kehadiran.

### Prioritas kecocokan persis

Sebelum pencocokan fuzzy, sistem memeriksa nama, panggilan, dan alias yang
**persis sama** setelah normalisasi:

- Tepat satu cocok → `unique` (walau nama lengkapnya beda)
- Lebih dari satu cocok → `ambiguous`

Contoh nyata:

| Data | Hasil untuk kueri "Danya" |
|---|---|
| Hanya `Danya Sefti` punya alias `Danya` | **unique** — alias tunggal sudah menafsirkan |
| `Danya Putri` dan `Dava` sama-sama punya alias `Dany` | **ambiguous** untuk "Dany" |

Ini distinction yang penting: nama panggilan tunggal di sekolah sering
memang unik, dan memaksa user menjelaskan ulang itu membosankan.

## Verifikasi identitas

**Klaim identitas di chat bukan bukti.**

Kalau seseorang bilang "aku ketua OSIS", sistem **tidak** memberikan akses
admin. Yang bisa diandalkan hanya `MemberIdentityLink` yang `verifiedAt`-nya
terisi.

```typescript
MemberIdentityLink {
  memberId, identityId, organizationId,
  verifiedAt   // null = belum terverifikasi
  verifiedBy   // siapa yang memverifikasi
  method       // bagaimana diverifikasi
}
```

Mention otomatis **hanya** boleh memakai link terverifikasi. Kalau nomor belum
terverifikasi, sistem bilang terus terang dan tidak mengarang nomor.

## Pergantian dimensi identitas

Satu orang bisa punya:

- Identitas WhatsApp (PN + LID, satu atau lebih)
- Keanggotaan di beberapa organisasi

Hak akses dihitung **per organisasi**. Someone yang sekretaris OSIS tidak
otomatis punya izin sekretaris di LKBB atau MPK.

Kalau pengirim punya beberapa keanggotaan dan pesan datang dari chat pribadi,
OSDABOT tidak menebak — ia bertanya organisasi mana yang dimaksud.

## Normalisasi JID

```
6281234567890@s.whatsapp.net     → PN, nomor = 6281234567890
6281234567890:12@s.whatsapp.net  → PN, device suffix dibuang
123456789012345@lid              → LID, nomor = null (TIDAK bisa diasumsikan)
628123@c.us                      → PN (alias lama)
12036304290123456789@g.us        → grup
```

`getPhoneNumber()` untuk LID mengembalikan `null`. Ini disengaja: LID adalah ID
numerik acak, bukan nomor telepon.

`isSameJid()` **tidak** menganggap PN dan LID sama. Mapping hanya sah lewat
`signalRepository.lidMapping` Baileys atau rekaman di database.

## Menguji

```bash
pnpm exec vitest run tests/unit/name-normalizer.test.ts tests/unit/jid.test.ts
```

Test integrasi ambiguitas ada di
`tests/integration/vertical-slice.test.ts` — di situ benar-benar ada dua anggota
dengan alias `Dany` yang sama, dan sistem wajib menolak menebak.