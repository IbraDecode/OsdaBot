# Migrasi dari OSDA BOT v0.4

Dokumen ini menjelaskan proses migrasi data dari OSDA BOT v0.4 ke OSDA Platform v2,
beserta **hasil rekonsiliasi nyata**. Acuan kode: `tools/legacy/scripts/*.mjs`.

---

## 1. Ringkasan

Skrip migrasi: `tools/legacy/scripts/migrate-to-v2.mjs`.
Skrip rekonsiliasi: `tools/legacy/scripts/reconcile.mjs`.
Dump: `tools/legacy/scripts/dump-legacy.mjs`, hasil di `~/osda-backup/`.

Alur yang ditegakkan (spec §79):

```
DATA LAMA (dump JSON/backup SQL)
   → mapping (pemetaan kolom lama → entitas baru)
   → skema v2
   → validasi
   → rekonsiliasi
   → cutover
```

Aturan yang dinyatakan skrip:

- Semua entri membawa `legacy_id` agar asal-usulnya bisa dilacak.
- Skrip hanya **membaca** dump; tidak pernah mengubah data lama.
- Idempoten: baris yang sudah dimigrasi dilewati, tidak digandakan.
- Histori anggota, absensi, dan keuangan tetap tersedia.

---

## 2. Persiapan

```bash
# 1. Siapkan database v2 (migrasi + invariant)
pnpm db:seed

# 2. Dump database lama → ~/osda-backup/*.json (+ .sql)
pnpm legacy:dump

# 3. Migrasi
pnpm legacy:migrate

# 4. Rekonsiliasi
pnpm legacy:reconcile
```

Prasyarat (dicek skrip):

- Ada minimal satu baris `organizations` dan satu baris `organization_periods`.
- `.env` di `/home/jelastic/osda` memuat `DATABASE_URL`.

Berkas dump yang dipakai adalah **berkas `.json` terbaru** menurut urutan abjad
(`readdirSync(...).filter(f => f.endsWith('.json')).sort().pop()`).

---

## 3. Pemetaan Tabel

| Tabel legacy | Tabel v2 | Catatan |
|---|---|---|
| `members` | `users` → `identities` → `members` | Akun dibuat agar anggota bisa masuk Web/Mobile; identity provider `WHATSAPP`. |
| `members.class` | `members.tingkat` + `jurusan` + `sub_kelas` | Dipecah dengan `pecahKelas()`: `"X RPL 1"` → `X` / `RPL` / `1`. |
| `members.account_id` | `identities.provider_subject` + `provider_subject_kanonik` | `nomorDariJid()` membersihkan JID: `6281…@s.whatsapp.net` → `6281…`. |
| `attendance_sessions` | `attendance_sessions` | `jenis` selalu `MEETING`; `batas_keterlambatan_menit = 15`; `qr_ttl_detik = 120`. |
| `attendance` | `attendance_records` | Termasuk pembuatan `ABSENT` otomatis. |
| `moderators` | `member_roles` (peran `STAFF`) | Melalui `beriPeran()`. |
| `treasurers` | `member_roles` (peran `TREASURER`) | Melalui `beriPeran()`. |
| `kas_weeks` | `dues_periods` | Kode periode ISO week dihitung dengan `kodePeriodeKas()`. |
| `kas_payments` | `dues_status` + `transactions` + `ledger_entries` | Dua entri ledger per pembayaran lunas. |
| `kas_expenses` | `transactions` + `ledger_entries` | Dua entri ledger per pengeluaran. |
| semua di atas | `legacy_id_mappings` | Peta `legacy_tabel` + `legacy_id` → `target_tabel` + `target_id`. |

---

## 4. Pemetaan Nilai

### Status kehadiran

| Legacy | v2 |
|---|---|
| `HADIR` | `PRESENT` |
| `TERLAMBAT` | `LATE` |
| `ALPHA` | `ABSENT` |
| `IZIN` | `EXCUSED` |
| `SAKIT` | `SICK` |

Sumber absensi:

- Status yang boleh dikirim anggota (`PRESENT`, `LATE`, `EXCUSED`, `SICK`) → `WHATSAPP`.
- Sisanya (termasuk `ABSENT` otomatis) → `ADMIN` (`SUMBER_SISTEM`).

### Status anggota

| Legacy | v2 |
|---|---|
| `active` | `ACTIVE` |
| `inactive` | `INACTIVE` |
| `alumni` | `ALUMNI` |
| `suspended` | `SUSPENDED` |
| `removed` | `REMOVED` (**dilewati**, tidak dimigrasi) |

Anggota berstatus `removed` sengaja tidak dimigrasi — itulah sebabnya rekonsiliasi
membandingkan "anggota aktif" saja.

### Status sesi & periode kas

- Sesi: `OPEN` → `OPEN`, selain itu → `CLOSED`.
- `kas_weeks.status`: `OPEN` → `OPEN`, selain itu → `CLOSED`.

### Pembayaran

- `status = 'paid'` (huruf kecil apa adanya) → `dues_status.status = 'LUNAS'` dan
  menghasilkan transaksi + ledger.
- Selain itu → `dues_status.status = 'BELUM'`, tanpa transaksi.

### Nomor WhatsApp

```js
function nomorDariJid(accountId) {
  const digit = String(accountId).split('@')[0].split(':').replace(/\D/g, '');
  return digit.startsWith('62') ? digit : `62${digit}`;
}
```

### Kode periode kas (ISO week)

```js
function kodePeriodeKas(year, week) { … }
// Contoh hasil di database: KAS-2026-W39, KAS-2026-W40, KAS-2026-W41
```

Fungsi ini memperhitungkan bahwa 4 Januari selalu berada di ISO week 1.

---

## 5. Idempotensi Skrip

Tahap mana pun yang dijalankan ulang akan melewati baris yang sudah ada:

| Tahap | Cara deteksi |
|---|---|
| Anggota | `members.legacy_id` sudah ada → ambil ID lama, lewati. |
| Pengguna | `on conflict (telepon) do update set nama = excluded.nama`. |
| Identity | `on conflict do nothing`. |
| Sesi | `attendance_sessions.idempotency_key = 'legacy-sesi-<id>'`. |
| Absensi | `attendance_records.idempotency_key = 'legacy-absen-<id>'` (dan `legacy-absen-auto-…`). |
| Transaksi | `transactions.kode` sudah ada → lewati (`catatLedger` memeriksa lebih dulu). |
| Peran | `member_roles` sudah punya kombinasi organisasi+anggota+peran → lewati. |
| Peta ID | `on conflict (legacy_tabel, legacy_id) do update set target_id`. |

Karena itu, menjalankan `legacy:migrate` dua kali aman — dan memang pada basis data
terdapat tanda bahwa migrasi dijalankan lebih dari sekali (lihat bagian 6).

---

## 6. Hasil Rekonsiliasi (Nyata)

Berikut keluaran `pnpm legacy:reconcile` (dump `osda-bot-legacy-2026-10-08T15-50-40.json`):

```
Rekonsiliasi migrasi OSDA v0.4 → v2

----------------------------------------------------------------------------
✓ anggota aktif                      legacy=   49  v2=   49
✓ sesi absensi                       legacy=   10  v2=   10
✓ catatan absensi eksplisit          legacy=  470  v2=  470
✓ periode kas                        legacy=    3  v2=    3
✓ pembayaran sudah lunas             legacy=   11  v2=   11
✓ pengeluaran kas                    legacy=    0  v2=    0
----------------------------------------------------------------------------

Isi database v2:
  organizations                 1 baris
  organization_periods          1 baris
  users                        50 baris
  identities                   49 baris
  members                      50 baris
  member_roles                  7 baris
  attendance_sessions          10 baris
  attendance_records          490 baris
  accounts                     22 baris
  financial_periods             1 baris
  dues_periods                  3 baris
  dues_status                  12 baris
  transactions                 33 baris
  ledger_entries               33 baris
  permissions                  38 baris
  roles                        10 baris
  role_permissions            421 baris
  documents                     0 baris
  notifications                0 baris
  audit_logs                    0 baris

Invariant database:
✓ audit_logs dapat ditulis (0 baris)
✓ tidak ada entri ledger bernilai nol
✓ semua IZIN/SAKIT memiliki alasan minimal 3 karakter
✓ anggota tanpa akun login: 0

✓ Semua jumlah cocok.
```

### Penjelasan angka

| Angka | Penjelasan |
|---|---|
| 49 anggota aktif | Anggota legacy berstatus `removed` tidak dimigrasi. `members` berisi 50 baris karena 1 di antaranya adalah akun administrator hasil seed (`M-0001`, `legacy_id IS NULL`). |
| 50 `users`, 49 `identities` | Satu pengguna per anggota migrasi + 1 administrator seed. Identity `WHATSAPP` hanya dibuat untuk anggota migrasi. |
| 10 sesi, 490 `attendance_records` | 470 catatan eksplisit dari dump + 20 baris `ABSENT` otomatis (`legacy-absen-auto-…`) = 10 sesi × 49 anggota. |
| Komposisi catatan | `PRESENT` 294, `EXCUSED` 121, `SICK` 5, `ABSENT` 70. Dari 470 eksplisit: 294+121+5 = 420 dan 50 berstatus `ABSENT` (legacy `ALPHA`) disimpan dengan sumber `ADMIN`. Sisa 20 `ABSENT` dibuat otomatis oleh skrip migrasi. |
| 3 periode kas | `KAS-2026-W39`, `KAS-2026-W40`, `KAS-2026-W41`, masing-masing nominal Rp2.000, status `OPEN`. |
| 12 `dues_status` | 11 berstatus `LUNAS` dan 1 `BELUM`. |
| 33 `transactions` & 33 `ledger_entries` | 22 transaksi berakhiran `-IURAN`/`-KAS` (11 pembayaran lunas × 2 sisi: pendapatan iuran dan kas) dan 11 transaksi ber-kode `KAS-P<n>` dari format kode migrasi sebelumnya (sisa proses yang dijalankan lebih dari sekali). Total nominal Rp66.000. |
| 7 `member_roles` | 1 `SUPER_ADMIN` (administrator seed), 1 `TREASURER`, dan 5 `STAFF` (dari tabel `moderators`). |
| 22 `accounts` | Chart of accounts bawaan hasil seed + akun tambahan dari migrasi. |
| 38 `permissions`, 10 `roles`, 421 `role_permissions` | Hasil `pnpm db:seed`. |
| 0 `audit_logs` | Migrasi tidak menulis audit otomatis; audit mulai terisi setelah API dipakai. |

### Catatan tentang entri ganda

Tabel `transactions` mengandung 11 baris ber-kode `KAS-P<n>` (tanpa akhiran) di samping
22 baris berakhiran `-IURAN`/`-KAS`. Ini terjadi karena `catatLedger()` bersifat idempoten
per **kode**, dan format kode pada skrip pernah berubah; baris berformat lama tidak
dihapus oleh rerun berikutnya. Ledger yang memuat baris ganda sebaiknya dibersihkan dengan
transaksi `ADJUSTMENT` — **bukan** dengan `DELETE` (dilarang trigger
`trg_ledger_immutable`).

---

## 7. Peran & Akses Akun Migrasi

- Setiap anggota migrasi mendapat `users.password_hash` dari
  `argon2.hash('OsdaMigrasi#2026', { type: argon2.argon2id })`.
- Komentar di skrip menyatakan sandi ini hanya **placeholder**; administrator **WAJIB**
  mereset sandi setiap anggota setelah cutover.
- `users.telepon_diverifikasi_pada` diisi `now()` karena nomor berasal dari WhatsApp bot.
- `members.nomor` dibentuk `M-0001`, `M-0004`, … dari `member_id` legacy
  (`'M-' + String(a.member_id).padStart(4, '0')`).
- Peran diberikan hanya untuk `treasurers` → `TREASURER` dan `moderators` → `STAFF`.
  Sisanya memakai paket bawaan `MEMBER` (melalui `satukanIzinBawaan(['MEMBER'])` bila
  database belum punya peran untuk anggota tersebut).

---

## 8. Akun & Periode Keuangan yang Dibuat Migrasi

| Akun | Kode | Jenis | Kas |
|---|---|---|---|
| Kas Tunai | `101` | ASSET | ✓ |
| Kas QRIS / Bank | `102` | ASSET | ✓ |
| Iuran Anggota | `401` | REVENUE | — |
| Belanja Kegiatan | `501` | EXPENSE | — |

Periode keuangan dibuat dengan nama `Kas <nama periode>`, mis. `Kas 2026/2027`,
berkisar 1 Juli tahun pertama sampai 30 Juni tahun berikutnya, `saldo_awal = 0`,
status `OPEN`.

Pembayaran lunas dicatat dengan dua entri ledger:

```
Entri 1: debit  nominal pada akun 401 Iuran Anggota   (sisi pendapatan)
Entri 2: debit  nominal pada akun 102 Kas QRIS        ( bila method = 'qris')
          atau akun 101 Kas Tunai                     ( bila bukan qris )
```

Pengeluaran (bila ada) dicatat dua entri:

```
Entri 1: kredit nominal pada akun 501 Belanja Kegiatan
Entri 2: kredit nominal pada akun 101 Kas Tunai
```

---

## 9. Verifikasi Setelah Migrasi

1. Jalankan `pnpm legacy:reconcile` — semua baris harus bertanda `✓` dan
   "Semua jumlah cocok.".
2. Periksa invariant yang dilaporkan skrip:
   - tidak ada entri ledger bernilai nol,
   - semua `EXCUSED`/`SICK` punya alasan ≥ 3 karakter,
   - tidak ada anggota tanpa akun login.
3. Periksa manual:
   ```sql
   select count(*) from members where legacy_id is not null;   -- 49
   select count(*) from attendance_records;                    -- 490
   select status, count(*) from attendance_records group by 1;
   select kode, nama, nominal, status from dues_periods;
   ```
4. Reset sandi seluruh anggota hasil migrasi dan minta mereka masuk ulang.

---

## Catatan untuk AI agent

1. Jangan mengubah isi `tools/legacy/scripts/*.mjs` agar "lebih rapi" — perubahannya perlu
   diuji terhadap dump lama. Bila format kode transaksi diubah, baris berformat lama akan
   tetap ada dan menghasilkan duplikat logis.
2. Jangan pernah menghapus baris `ledger_entries` atau `transactions` untuk membersihkan
   duplikat migrasi. Buat transaksi `ADJUSTMENT`.
3. `legacy_id` dan `legacy_id_mappings` adalah aset audit. Jangan menghapusnya setelah
   cutover; rekonsiliasi dan pelacakan kepemilikan data bergantung padanya.
4. Migrasi membuat sandi placeholder. Bila Anda menambah fitur "paksa ganti sandi saat
   login pertama", jangan menyandarkan ke kolom baru pada `users` — cukup periksa apakah
   `users.login_terakhir_pada IS NULL`.
5. Anggota berstatus `removed` tidak dimigrasi. Bila diminta memperbaikinya, ingat bahwa
   itu akan mengubah hitungan rekonsiliasi dan butuh pertimbangan histori.
