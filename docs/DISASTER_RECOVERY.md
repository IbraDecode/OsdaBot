# Pemulihan Bencana (Disaster Recovery)

Dokumen ini menjelaskan strategi cadangan (backup), pemulihan (restore), uji pemulihan,
target RTO/RPO, dan cara memverifikasi berkas cadangan di `~/osda-backup/`.

Terakhir diperiksa: isi `~/osda-backup/` berisi satu pasang berkas:

```
osda-bot-legacy-2026-10-08T15-50-40.json    120 KB   (dump terstruktur — dipakai migrasi)
osda-bot-legacy-2026-10-08T15-50-40.sql      66 KB   (dump SQL — dipakai pemulihan)
```

---

## 1. Apa yang Harus Dicadangkan

| Aset | Cara | Frekuensi yang dianjurkan |
|---|---|---|
| Database PostgreSQL (`organisasi`, `absensi`, `keuangan`, `dokumen`) | `pg_dump` berkala | Setiap hari, disimpan 30 hari |
| Berkas object storage (dokumen, lampiran, bukti) | Replikasi/versi bucket | Kontinu |
| `.env` (rahasia: `JWT_SECRET`, kunci storage, kunci pembayaran) | Brankas rahasia, **bukan** repositori | Saat berubah |
| Direktori sesi WhatsApp (`WHATSAPP_SESSION_DIR`) | Salinan terenkripsi | Saat pairing ulang |
| Dump legacy | `tools/legacy/scripts/dump-legacy.mjs` | Saat cutover & sebelum migrasi besar |

> `ledger_entries`, `audit_logs`, dan `member_period_history` adalah data yang **tidak bisa
> dibuat ulang**. Mereka adalah prioritas utama pemulihan.

---

## 2. Membuat Cadangan

### Cadangan logika PostgreSQL

```bash
# cadangan penuh (disarankan setiap hari)
pg_dump "$DATABASE_URL" \
  --no-owner --no-privileges \
  --format=custom \
  --file "$HOME/osda-backup/osda-$(date +%Y%m%d-%H%M).dump"

# cadangan teks (mudah diperiksa)
pg_dump "$DATABASE_URL" \
  --no-owner --no-privileges \
  --format=plain \
  --file "$HOME/osda-backup/osda-$(date +%Y%m%d-%H%M).sql"
```

### Cadangan terstruktur untuk migrasi/rekonsiliasi

```bash
pnpm legacy:dump    # → ~/osda-backup/osda-bot-legacy-<waktu>.json (+ .sql)
```

### Pemulihan sebagian (point-in-time)

Bila PostgreSQL dijalankan dengan *write-ahead log* (WAL) arsip, RPO bisa diperkecil sampai
menit-level dengan `pg_basebackup` + pemutaran WAL. Konfigurasi ini disarankan untuk basis
data produksi.

---

## 3. Menyimpan & Menguji

| Praktik | Aturan |
|---|---|
| Simpan **minimal tiga salinan** | Satu lokal, satu di gudang data lain, satu salinan terenkripsi offline. |
| Enkripsi | Cadangan berisi data anggota. Simpan terenkripsi (`gpg`/`age`) dan batasi akses. |
| Uji pemulihan | **Minimal sekali sebulan.** Cadangan yang tidak pernah dipulihkan tidak bisa diandalkan. |
| Retensi | 30 hari untuk harian, 12 bulan untuk mingguan (simpan yang tanggal 1). |
| Jangan simpan di direktori aplikasi | `~/osda-backup/` berada di luar repositori — pertahankan. |
| Pantau ukuran | Penurunan ukuran dump tiba-tiba biasanya berarti cadangan gagal, bukan "hemat ruang". |

---

## 4. Memulihkan dari Cadangan

### Langkah 1 — Siapkan database kosong

```bash
# buat basis data baru (atau kosongkan yang lama SETELAH cadangan terverifikasi)
createdb osda_restore
```

### Langkah 2 — Pulihkan dari dump custom

```bash
pg_restore \
  --no-owner --no-privileges \
  --dbname="$DATABASE_URL_RESTORE" \
  "$HOME/osda-backup/osda-20261009-0200.dump"
```

Atau dari dump teks SQL:

```bash
psql "$DATABASE_URL_RESTORE" -f "$HOME/osda-backup/osda-20261009-0200.sql"
```

### Langkah 3 — Bangun ulang invariant

Cadangan dump berisi trigger & fungsi karena `SQL_INVARIANT` dijalankan saat migrasi.
Bila tidak, pasang ulang:

```bash
export DATABASE_URL="$DATABASE_URL_RESTORE"
pnpm db:migrate      # idempoten; memuat packages/db/src/sql/invariants.ts
```

### Langkah 4 — Verifikasi

Lihat bagian 6.

### Langkah 5 — Alihkan lalu lintas

1. Hentikan API lama (`pm2 stop osda-api` atau hentikan container).
2. Perbarui `DATABASE_URL` aplikasi.
3. Nyalakan API, periksa `/health/ready` (harus 200).
4. Nyalakan bot WhatsApp; verifikasi perintah `STATUS` berjalan.
5. Jalankan `pnpm legacy:reconcile` bila pemulihan menyangkut pasca-migrasi.

---

## 5. Verifikasi Pemulihan dari `~/osda-backup/`

Berikut pemeriksaan konkret yang bisa dijalankan.

### 5.1 Pastikan berkasnya utuh

```bash
ls -lh ~/osda-backup/
# Harapan: minimal satu pasang .json + .sql dengan tanggal terbaru

# cek kedaluwarsa: jangan memakai cadangan lebih tua dari RPO (1 hari)
find ~/osda-backup -name '*.sql' -mtime +1 -print    # seharusnya kosong

# untuk dump kustom, uji ketahanan internal arsip:
pg_restore --list ~/osda-backup/osda-20261009-0200.dump | head
```

### 5.2 Verifikasi isi dump terstruktur (JSON)

```bash
node -e "
const fs=require('fs');
const f=fs.readdirSync(process.env.HOME+'/osda-backup')
  .filter(x=>x.endsWith('.json')).sort().pop();
const d=JSON.parse(fs.readFileSync(process.env.HOME+'/osda-backup/'+f,'utf8'));
for (const [k,v] of Object.entries(d.tabel ?? {})) {
  console.log(k.padEnd(22), Array.isArray(v)? v.length : '-');
}
"
```

### 5.3 Verifikasi setelah restore (SQL)

Jalankan pada basis data yang sudah dipulihkan:

```sql
-- 1. Jumlah tabel harus 74
select count(*) from information_schema.tables where table_schema = 'public';

-- 2. Data inti masih ada
select count(*) from members;                  -- 50 (49 migrasi + 1 admin)
select count(*) from attendance_records;       -- 490
select count(*) from attendance_sessions;      -- 10
select count(*) from dues_periods;             -- 3
select count(*) from dues_status where status = 'LUNAS';  -- 11
select count(*) from transactions;             -- 33
select count(*) from ledger_entries;           -- 33
select count(*) from permissions;              -- 38
select count(*) from roles;                    -- 10

-- 3. Invariant khusus masih terpasang (harap 6 baris)
select tgname, tgrelid::regclass::text as tabel
  from pg_trigger
 where not tgisinternal and tgname in (
   'trg_ledger_immutable','trg_audit_append_only',
   'trg_dokumen_versi_locked','trg_no_self_approval_expense',
   'trg_no_self_approval_reimburse','trg_payment_settle_once'
 ) order by tabel;

-- 4. Index unik parsial masih ada
select indexname from pg_indexes
 where indexname in ('uq_periode_aktif','uq_periode_keuangan_aktif');

-- 5. Fungsi saldo masih ada
select proname from pg_proc where proname in ('osda_saldo_akun','osda_saldo_organisasi');

-- 6. Ledger tidak rusak
select count(*) from ledger_entries where debit = 0 and kredit = 0;   -- harus 0
select osda_saldo_organisasi((select id from organizations limit 1)); -- saldo kas terhitung
```

### 5.4 Verifikasi aplikasi

```bash
curl -s localhost:4000/health/ready | head      # { "status": "siap", ... }
curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@osis.local","password":"…"}'
```

### 5.5 Rekonsiliasi pasca-migrasi

```bash
pnpm legacy:reconcile
```

Semua baris harus bertanda `✓` dan berakhir dengan "✓ Semua jumlah cocok.".

---

## 6. RTO & RPO

| Ukuran | Target | Catatan |
|---|---|---|
| **RTO** (waktu pulih) | **4 jam** | Dari cadangan terakhir sampai API melayani penulisan kembali. |
| **RPO** (kehilangan data) | **1 hari** | Dengan cadangan harian tanpa WAL. |
| RPO (dengan WAL/PITR) | **≤ 15 menit** | Direkomendasikan untuk produksi. |
| Waktu pemulihan parsial (tabel) | 1 jam | `pg_restore --table=…` bila hanya sebagian tabel yang rusak. |
| Waktu uji pemulihan | 1 jam | Sisihkan jendela bulanan untuk latihan. |

Angka-angka di atas adalah sasaran awal; sesuaikan dengan kebutuhan sekolah setelah
pemulihan benar-benar diuji.

---

## 7. Prosedur Pemulihan sesuai Skenario

### Skenario A — Database rusak, berkas storage utuh

1. Verifikasi berkas di `~/osda-backup/` (bagian 5.1).
2. Siapkan basis data baru, pulihkan (bagian 4).
3. Jalankan `pnpm db:migrate` untuk memastikan invariant.
4. Verifikasi (bagian 5.3–5.5).
5. Nyalakan API & bot.

### Skenario B — Aplikasi hilang, database & storage utuh

1. Pas ulang repositori (`git clone` + `pnpm install`).
2. Salin `.env` dari brankas rahasia (**jangan** dari repositori).
3. `pnpm db:migrate` bila perlu, lalu `pnpm --filter @osda/api start`.
4. Nyalakan bot; periksa `WHATSAPP_SESSION_DIR` masih ada (jika hilang, pairing ulang).

### Skenario C — Object storage hilang

1. Metadata `documents`/`document_versions` masih utuh, tetapi `storage_key` menunjuk objek
   yang tidak ada.
2. Pulihkan bucket dari salinan/replikasi.
3. Verifikasi `checksum_sha256` setiap berkas terhadap metadata.
4. Berkas yang tidak dapat dipulihkan: tandai di catatan, jangan hapus metadata — bukti
   bahwa berkas pernah ada tetap berharga.

### Skenario D — Salah kelola data (mis. absensi salah massal)

1. **Jangan** memulihkan seluruh database — itu akan menghapus data yang benar.
2. Periksa audit log (`GET /api/v1/audit/logs`) untuk menemukan batch yang salah.
3. Koreksi lewat aplikasi: `ubahManual` untuk absensi, transaksi `ADJUSTMENT` untuk
   keuangan, versi baru untuk dokumen.
4. Catat kejadiannya sebagai baris audit baru.

### Skenario E — Kredensial bocor

1. Cabut semua sesi: `update sessions set dicabut_pada = now(), alasan_pencabutan = '…';`
2. Rotasi `JWT_SECRET` dan `JWT_REFRESH_SECRET` (semua token lama otomatis tidak sah).
3. Rotasi kunci storage & kunci pembayaran (`integration_configs`).
4. Reset sandi akun terpengaruh; panggil pengguna untuk masuk ulang.

---

## 8. Pelatihan & Uji Coba

Rutinitas yang dianjurkan:

| Kegiatan | Frekuensi |
|---|---|
| Cek keberadaan & ukuran cadangan | Harian (otomatis) |
| Pulihkan ke basis data uji | Bulanan |
| Latihan skenario A (basis data rusak) | Tiga bulanan |
| Tinjau `RTO`/`RPO` dan procedur | Setahun atau setelah setiap insiden |
| Uji pencabutan sesi massal | Tiga bulanan |

Setiap latihan harus diakhiri dengan laporan singkat: waktu mulai, waktu selesai, data
yang hilang (seharusnya nol), dan perbaikan prosedur.

---

## Catatan untuk AI agent

1. Jangan pernah menghapus berkas di `~/osda-backup/` sebagai bagian dari skenario
   "membersihkan ruang". Itu satu-satunya dump legacy yang menjadi acuan rekonsiliasi.
2. Jangan menulis prosedur pemulihan yang berupa `DELETE FROM ledger_entries`. Koreksi
   selalu transaksi `ADJUSTMENT`.
3. Setelah memulihkan basis data, **selalu** jalankan `pnpm db:migrate` untuk memastikan
   trigger dan index parsial masih terpasang; dump yang lama bisa saja tidak memuatnya.
4. `audit_logs` dan `legacy_id_mappings` tidak boleh hilang. Bila pemulihan menunjukkan
   baris tersebut bernilai nol padahal seharusnya ada, hentikan proses dan periksa dumpnya.
5. Verifikasi angka pemulihan memakai angka rekonsiliasi yang terdokumentasi di
   `MIGRATION.md` (49/10/470/3/11/33) — jangan memakai perkiraan sendiri.
