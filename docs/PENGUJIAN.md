# Pengujian

## Prinsip

> Kalau bot bilang "sudah diubah" tapi database tidak berubah, **pengujiannya
> yang gagal**, bukan botnya.

Setiap pengujian yang menyentuh perubahan data memeriksa **database**, bukan
teks respons.

## Lapisan

| Lapisan | Apa | Butuh layanan |
|---|---|---|
| Unit | Fungsi murni | Tidak |
| Integrasi | Modul nyata + PostgreSQL | PostgreSQL |
| Live | Provider sungguhan | AI gateway, WhatsApp |

**Tidak ada pengujian otomatis yang mengirim pesan WhatsApp sungguhan.**
Semua memakai `FakeWhatsAppProvider`.

## Menjalankan

```bash
pnpm test                                   # semua test otomatis
pnpm exec vitest run tests/unit             # unit saja
pnpm exec vitest run tests/integration      # integrasi saja
pnpm exec vitest run --coverage             # dengan coverage

# Test live — hanya kalau benar-benar dibutuhkan
RUN_LIVE_TESTS=true pnpm exec vitest run tests/live
```

Test live **dilewati secara default** supaya `pnpm test` di CI tidak pernah
bergantung pada API berbayar.

## Konfigurasi test

`vitest.config.ts` menyediakan nilai environment uji:

- Kalau ada `.env`, nilainya dipakai untuk test integrasi.
- Kalau tidak, unit test tetap jalan dengan nilai palsu.
- `test.env` diterapkan **sebelum modul apa pun dimuat**, jadi modul yang
  memvalidasi env saat boot (`src/config/env.ts`) tidak gagal.

```typescript
const dummy = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/osdabot_test',
  AI_BASE_URL: 'http://127.0.0.1:9/v1',   // tidak akan pernah terhubung
  AI_API_KEY: 'sk-test-key-not-real',
  // ...
}
```

## Unit (392 test) + Integrasi (58 test) + Live (7 test)

### `tests/unit/jid.test.ts`

Normalisasi JID — dasar identitas.

| Kasus | Yang dijamin |
|---|---|
| PN JID | Nomor diekstrak |
| **LID JID** | `phoneNumber === null` — nomor TIDAK diasumsikan |
| Grup `@g.us` | Dikenal sebagai grup |
| Tanpa `@` | `null` — bukan JID |
| Device suffix | Dibuang |
| PN vs LID | **Tidak** dianggap sama |

### `tests/unit/name-normalizer.test.ts`

| Kasus | Yang dijamin |
|---|---|
| `canonicalizeName` | Huruf besar, spasi, tanda baca, gelar depan/belakang, aksen |
| `similarityScore` | Skor 1 untuk identik, tinggi untuk sebagian, rendah untuk tidak berkaitan, toleran typo |
| `decideMatch` | `unique` / `ambiguous` / `none` + margin |
| `cleanNameInput` | Kata perintah dibuang dari nama |

### `tests/unit/attendance-renderer.test.ts`

Skenario produk yang jadi kontrak:

- Judul dari pengguna dipertahankan.
- Penomoran diperbarui saat anggota pindah seksi.
- Alasan ditambahkan.
- Anggota lain tidak berubah.
- Marker bold dari markdown dihormati.
- Footer template.

### `tests/unit/permissions.test.ts`

Invarian keamanan:

- Semua permission punya deskripsi.
- Tidak ada duplikat.
- Semua permission masuk kelompok.
- Role biasa tidak punya wildcard.
- **Role anggota tidak punya `finance.read`, `members.delete`,
  `whatsapp.bulk_send`.**
- Hanya owner punya `system.configure` / `system.safe_mode`.
- Role non-admin tidak bisa menghapus anggota.

### `tests/unit/security.test.ts`

Yang paling penting:

```typescript
it('MENOLAK tool kalau aktor tidak punya izin — walau AI memintanya', async () => {
  const executeSpy = vi.fn()
  registry.register({ ...dangerousTool, execute: executeSpy })

  await registry.execute('test.delete_all', { target: 'semua' }, context)

  expect(result.success).toBe(false)
  expect(executeSpy).not.toHaveBeenCalled()   // ← bukti inti
})
```

Juga: `AuthorizationService` gagal-closed saat database error, scope
organisasi terpisah, validasi input menolak JSON rusak, batas jumlah tool call.

### `tests/unit/skills.test.ts`

- Front-matter di-parse dengan benar.
- Metadata tidak valid **ditolak**, bukan dipakai setengah-setengah.
- Skill nyata di repo termuat tanpa masalah.
- Skill yang butuh izin yang tidak dimiliki **disaring**.
- Skill tidak pernah memberi izin sendiri.

### `tests/unit/server.test.ts`

Verifikasi signature BaturPay:

- Signature benar diterima.
- Secret salah ditolak.
- **Body dimodifikasi ditolak** — ini skenario serangan: ubah amount dari
  25.000 jadi 1.000 tapi pakai signature body asli.
- Timestamp berbeda ditolak (anti-replay).
- Panjang salah & non-hex ditolak tanpa melempar error.
- `timingSafeEqual` dipakai, bukan `===`.
- Status tak dikenal → `undefined`, bukan default berbahaya.

### `tests/unit/pairing-config.test.ts`

12 test yang mengunci empat akar masalah pairing:

- `platformIdOf(companionBrowserIdentity())` = `CHROME` (bukan `OTHER_WEB_CLIENT`).
- **Regresi:** `Browsers.ubuntu('OSDABOT')` menghasilkan `OTHER_WEB_CLIENT` —
  konfigurasi yang membuat server balas `400 bad-request`.
- Semua nama browser yang dikenali lolos; nama sembarang ditolak (pencocokan eksak).
- `shouldReconnect(515)` = `true` — `restartRequired` berarti restart, bukan logout.
- Kode logout/forbidden/419/411/440/405/463 tetap `false`.

Test ini sengaja **menyalin** logika `getCompanionWebClientType()` dari Baileys.
Kalau Baileys mengubah pemetaannya, test gagal — bukan diam-diam merusak pairing.

### `tests/unit/outbox.test.ts` (15 test)

- Pemetaan status provider: hanya `failed` yang jadi `failed`.
- **`unknown`/`pending`/`sending` → `unknown`, TIDAK di-retry.** Ini inti modul.
- Handler yang melempar error → retry dengan backoff.
- Melebihi batas percobaan → `FAILED` dan **tidak dihapus**.
- Topik tanpa handler → ditunda, **tidak di-drop**.
- Hanya satu dispatcher bisa mengambil satu event.
- `recoverStuckSending` memindahkan event ber-lease habis ke `UNKNOWN`, bukan
  mengirim ulang.
- `needReconciliation` mengumpulkan `UNKNOWN` + `FAILED`.

### `tests/unit/pairing-frames.test.ts` (12 test)

Pembacaan frame server saat pairing:

- **Regresi:** membaca `code='429'` (kutip tunggal — format asli Baileys).
- Membaca kode lain dan kutip ganda.
- **Memverifikasi format terhadap `binaryNodeToString` Baileys sungguhan**,
  bukan tebakan dokumentasi.
- `isRateLimited` hanya true untuk `429`; acknowledgement `companion_hello`
  tidak boleh salah dikira penolakan.

Diverifikasi: mengembalikan regex ke versi lama (`code=".."`) membuat 4 test
gagal. Bug ini membuat guard rate limit tidak pernah aktif, sehingga daemon
terus mencoba dan memperpanjang blokir.

### `tests/unit/reminder-tools.test.ts` (24 test)

- **Zona waktu terverifikasi dengan angka**: 09:00 Makassar → 01:00Z,
  09:00 Jakarta → 02:00Z, 09:00 UTC → 09:00Z.
- **Tengah malam bergeser hari**: 00:30 Makassar → 19 Oct 16:30Z.
- Format waktu tidak lengkap **ditolak**, bukan ditebak.
- **`chatJid` berasal dari konteks**, bukan dari input model.
- Grup yang tidak tertaut ke organisasi → ditolak.
- **Beberapa grup cocok → ambigu**, bukan dipilih salah satu.
- Pengingat di masa lalu / terlalu jauh → ditolak.
- `reminder.cancel` memblokir pengingat organisasi lain.
- Semua tool punya permission; `cancel` selalu butuh persetujuan.

### `tests/unit/reminders.test.ts` (22 test)

- Kunci idempotensi stabil, berbeda untuk isi/org/slot waktu berbeda.
- Granularitas slot 1 menit (dokumentasi eksplisit, bukan asumsi).
- Hanya satu worker bisa mengklaim satu job (`updateMany` bersyarat).
- Pengingat >10 menit telat **dibatalkan**, bukan dikirim.
- `fail` mengembalikan ke SCHEDULED atau menyerah sesuai `attempts`.
- `cancel` tidak bisa membatalkan job yang sedang `RUNNING`.
- **`status: 'failed'` tidak dihitung sukses** — kalau tidak, pengingat hilang
  selamanya tanpa pernah sampai ke penerima.
- Job tanpa `chatJid` dilewati, bukan dicoba.

### `tests/unit/member-onboarding.test.ts` (25 test)

Impor anggota massal:

- Parser: format lengkap, komentar, nomor kosong, nomor bertanda kurung.
- **Nomor yang disebut tapi salah ditolak**; **nomor kosong diizinkan**
  (daftar hadir bekerja lewat nama).
- **Nama yang hanya simbol ditolak** — `canonicalizeName('!!!')` mengembalikan
  `'!!!'`, bukan string kosong.
- Baris salah tidak menghentikan baris lain.
- Nama yang sudah ada digabung, tidak diduplikasi.
- Peran yang sudah ada dipertahankan saat impor ulang.
- Maksimal 500 anggota per batch.
- `verifiedAt` tidak pernah diisi.
- Alias peran Indonesia → kunci kanonik; kunci tak dikenal dikembalikan
  apa adanya supaya pesan galat menyebut input asli.

### `tests/unit/provisioning.test.ts` (21 test)

Provisioning organisasi — perintah yang memberi akses ke data organisasi:

- Slug: huruf turun, slug kosong ditolak, panjang dibatasi.
- Nomor telepon: hanya digits + kode negara; `+`, spasi, kurung dibuang.
- **Nomor tidak valid ditolak SEBELUM menyentuh database.**
- `verifiedAt` **tidak pernah** diisi provisioning — nomor di environment adalah
  klaim, bukan bukti.
- **Idempoten:** nomor sama dua kali tidak membuat anggota/peran/alias ganda.
- Peran yang tidak dikenal ditolak.
- Permission peran **dihapus lalu dibuat ulang**, bukan ditumpuk.

### `tests/unit/approval-gate.test.ts` (6 test)

Gerbang persetujuan. Termasuk **regresi keamanan**:

- Tool `MEDIUM` dengan `requiresApproval: true` **harus** meminta persetujuan.
- Broker tidak terpasang → tool **ditolak**, bukan dilewati.
- `chatJid` dan `correlationId` diteruskan ke broker.
- Persetujuan ditolak → `PERMISSION_DENIED`, tool tidak jalan.

Sudah diverifikasi: mengembalikan gerbang ke versi lama
(`&& riskLevel === 'HIGH'`) membuat 4 test gagal.

### `tests/unit/approvals.test.ts` (27 test)

Parser niat + mesin persetujuan:

- `"iya"` → approve, `"batal"` → reject, `"batal semua"` → reject_all.
- **Tidak ada substring matching**: `oktober`, `iyausername`, `stopped` → `none`.
- **Tidak ada tebakan**: `tidak boleh kirim ke grup` → `none` (diteruskan ke agent).
- Pesan > 40 karakter → `none`.
- Hash payload stabil terhadap urutan kunci, berbeda untuk tipe berbeda.
- Orang yang bukan pemohon → ditolak.
- **Payload berubah → persetujuan dibatalkan.**
- `updateMany` count 0 → tidak ada eksekusi kedua.
- Approval tanpa `chatJid` → dicatat tapi tidak dikirim (tidak bisa dijawab).

### `tests/unit/approval-executor.test.ts` (7 test)

- Konteks eksekusi dibangun dari baris `Approval`, bukan dari argumen.
- Izin dicabut setelah persetujuan → **tidak** dieksekusi.
- Sudah punya `executedAt` → tidak dijalankan lagi.
- Kegagalan tool dibungkus jadi pesan, tidak melempar keluar.

### `tests/unit/phone-config.test.ts`

Dua nomor WhatsApp punya peran berbeda. Test ini mengunci perbedaan itu:

- `maskPhone` menyembunyikan bagian tengah, tidak pernah mengembalikan nomor
  lengkap.
- Format dengan `+`, spasi, atau tanda hubung ditolak.
- Nomor di luar 8–15 digit ditolak.
- **Nomor bot yang sama dengan nomor admin ditolak** — guardrail agar akun
  pemilik tidak ikut ter-link sebagai bot.

## Integrasi (35 test)

`tests/integration/vertical-slice.test.ts` — modul **nyata**, provider **di-mock**.

### Pipeline

- Pesan sendiri sendiri → skip.
- Pesan kosong → skip.
- Pesan private → proses.
- Grup belum tertaut → skip.
- **Dedupe**: pesan dengan id sama hanya diproses sekali.
- `dedupeKey` hanya bergantung pada account + message id (bukan isi pesan).

### Kebijakan grup

- Pesan tanpa sebutan bot → skip.
- Pesan yang menyebut "osda" → proses.
- Grup `activation: OFF` → skip.

### Identity (terhadap database sungguhan)

- Anggota unik ditemukan.
- **Alias tunggal → unik** (nama panggilan yang jelas).
- **Alias yang dipakai >1 orang → ambiguous**.
- Anggota tidak ada → `none`.
- Nama dengan gelar ("Bapak Ibra Ramdan") → unik.

### Attendance service

- Format dipertahankan saat render.
- **Idempoten**: tambah anggota dua kali → satu entri.
- Ubah hanya field yang diberikan.
- **"ganti alasannya" tidak menghapus status**.
- **Entri dari organisasi lain ditolak**.
- Rekap per status benar.

### Agent runtime dengan tool nyata

- Menjalankan pencarian anggota lalu menjawab.
- **Tool di luar izin ditolak** — dan orang tidak jadi dibuat di database.
- Batas jumlah tool call menghentikan loop.
- Tool call dengan JSON rusak ditolak.
- **Aktor tanpa izin menerima nol tool** di prompt.

## Live (10 test)

`tests/live/ai-provider.live.test.ts` — hanya jalan dengan `RUN_LIVE_TESTS=true`.

| Uji | Hasil terverifikasi |
|---|---|
| Provider bisa dihubungi | ✅ |
| Menjawab bahasa Indonesia | ✅ |
| **Memilih tool yang benar** untuk "osda ubah Danya jadi izin karena ada meeting" | ✅ `attendance.update`, `status=EXCUSED`, reason berisi "meeting` |

Dua tool sengaja dibuat mirip supaya model tidak bisa asal memilih yang
pertama.

Test live punya timeout 120 detik — model reasoning butuh lebih lama dari
default 30 detik.

## Yang belum diuji

| Area | Status | Alasan |
|---|---|---|
| Pairing WhatsApp live | ❌ | Tidak ada nomor yang boleh ditautkan |
| Pengiriman pesan live | ❌ | Tidak boleh mengirim ke kontak sungguhan |
| Group mention live | ❌ | Butuh grup uji yang disetujui |
| BaturPay live | ❌ | Tidak ada key sandbox |
| Redis / BullMQ | ❌ | Worker belum diimplementasi |
| Pemulihan setelah restart | ❌ | Belum ada job terjadwal |

Status ini jujur: modul di atas **terimplementasi**, tapi **belum terverifikasi
terhadap layanan sungguhan**.

## Standard regresi

Setiap perubahan baru wajib menjalankan:

```bash
pnpm typecheck && pnpm test
```

Yang tidak boleh rusak:

- [x] Normalisasi pesan WhatsApp
- [x] Kebijakan aktivasi grup
- [x] Resolusi identitas & ambiguitas
- [x] Otorisasi backend
- [x] Isolasi organisasi
- [x] Format daftar hadir
- [x] Idempoten attendance
- [ ] Pemulihan setelah restart (belum ada)
- [ ] Job terjadwal (belum ada)