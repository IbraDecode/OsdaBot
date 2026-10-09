# Keuangan (Finance)

Acuan kode: `packages/db/src/schema/finance.ts`,
`packages/contracts/src/finance.ts`,
`apps/api/src/modules/finance/finance.service.ts`, dan
`apps/api/src/modules/finance/payment.service.ts`.

Aturan utama modul ini:

1. **Saldo tidak pernah disimpan sebagai satu angka.** Semua saldo dihitung dari
   `ledger_entries`.
2. **`ledger_entries` immutable.** Tidak boleh `UPDATE` maupun `DELETE`. Koreksi hanya
   lewat transaksi `ADJUSTMENT` baru.
3. **Setiap operasi uang berada dalam satu batas transaksi database.**
4. **Idempotensi wajib** — `idempotency_key` mencegah pencatatan ganda.

---

## 1. Chart of Accounts

Tabel `accounts` (jenis enum `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`):

| Kolom | Keterangan |
|---|---|
| `kode`, `nama` | Unik per organisasi: `uq_akun_org_kode`. |
| `jenis` | `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`. |
| `induk_id` | Akun induk (hierarki). |
| `require_memo` | Bila `true`, setiap mutasi akun wajib punya keterangan (mis. kas tunai). |
| `adalah_kas` | Akun yang saldonya tampil di buku kas. |
| `posting_otomatis` | Boleh jadi tujuan posting dari pengajuan. |
| `aktif` | Penanda akun masih dipakai. |

Struktur bawaan yang tersemai (22 akun terverifikasi di basis data):

```
ASSET    1 ASET · 101 Kas Tunai (kas) · 102 Kas QRIS/Bank (kas) · 103 Kas Petty Cash (kas)
LIABILITY 2 KEWAJIBAN · 201 Utang kepada Anggota
EQUITY    3 MODAL · 301 Saldo Awal Periode
REVENUE   4 PENDAPATAN · 401 Iuran Anggota · 402 Pendapatan Acara · 403 Sponsor
          404 Donasi · 405 Pendapatan Lain-lain
EXPENSE   5 PENGELUARAN · 501 Belanja Kegiatan · 502 ATK & Administrasi
          503 Transport & Akomodasi · 504 Publikasi & Dokumentasi
          505 Refund / Reimbursement · 506 Utilitas & Internet · 507 Pengeluaran Lain-lain
```

Angka satu digit (`1`–`5`) adalah akun induk; angka berakhiran `xx` adalah akun rinci.
Migrasi menambahkan akun `101`, `102`, `401`, dan `501` bila belum ada
(`on conflict (organization_id, kode) do update set nama = excluded.nama`).

---

## 2. Periode Keuangan

`financial_periods`:

| Kolom | Keterangan |
|---|---|
| `nama` | Mis. `Kas 2026/2027`. |
| `mulai_pada`, `selesai_pada` | Rentang tanggal. |
| `saldo_awal` | Saldo awal; pada dasarnya dihitung dari periode sebelumnya. |
| `status` | `OPEN` atau `CLOSED`. |
| `ditutup_pada`, `ditutup_oleh` | Penutupan periode. |

Invariant: **hanya satu periode `OPEN` per organisasi**
(`uq_periode_keuangan_aktif`, indeks unik parsial) — sama seperti invariant periode
kepengurusan. Tidak boleh ada dua periode terbuka bersamaan.

---

## 3. Buku Kas Dihitung dari Ledger

Tidak ada tabel "saldo" atau "kas_balance". Buku kas dihitung setiap kali diminta.

### Fungsi database (`packages/db/src/sql/invariants.ts`)

```sql
CREATE OR REPLACE FUNCTION osda_saldo_akun(p_akun_id UUID, sampai DATE DEFAULT CURRENT_DATE)
RETURNS BIGINT AS $$
  SELECT COALESCE(SUM(debit - kredit), 0)::BIGINT
    FROM ledger_entries
   WHERE account_id = p_akun_id AND tanggal <= sampai;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION osda_saldo_organisasi(p_org UUID, sampai DATE DEFAULT CURRENT_DATE)
RETURNS BIGINT AS $$
  SELECT COALESCE(SUM(CASE WHEN a.adalah_kas THEN (l.debit - l.kredit) ELSE 0 END), 0)::BIGINT
    FROM ledger_entries l JOIN accounts a ON a.id = l.account_id
   WHERE l.organization_id = p_org AND l.tanggal <= sampai;
$$ LANGUAGE sql STABLE;
```

### Perhitungan di API

`FinanceService.kas()` mengembalikan `RingkasanKas` yang dihitung dari
`ledger_entries` periode terpilih:

```
saldoAwal      = financial_periods.saldo_awal
totalPemasukan = SUM(debit)
totalPengeluaran = SUM(kredit)
saldoAkhir     = saldoAwal + totalPemasukan - totalPengeluaran
perKategori[]  = agregasi kredit per akun (kode + nama + nominal)
```

Endpoint: `GET /api/v1/finance/kas` (izin `finance.read`). Mendukung filter
`periodeKeuanganId`, `dari`, `sampai`.

**Konsekuensi:** jangan pernah menambahkan kolom "saldo" pada `accounts`. Bila angka
perlu cepat, gunakan cache di lapisan aplikasi dengan masa hidup pendek, bukan di database.

---

## 4. Ledger & Transaksi (Immutable)

Tabel `ledger_entries`:

| Kolom | Keterangan |
|---|---|
| `transaksi_id` | Transaksi asal (`on delete: restrict`). |
| `financial_period_id`, `account_id` | Periode & akun (keduanya `restrict`). |
| `tanggal` | Tanggal efektif. |
| `debit`, `kredit` | Rupiah penuh. |
| `saldo_berjalan` | Denormalisasi saldo berjalan akun. |
| `narration` | Keterangan. |
| `created_by` | Anggota pencatat. |

Invariant:

```sql
CREATE OR REPLACE FUNCTION osda_ledger_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries bersifat immutable. Gunakan transaksi ADJUSTMENT untuk koreksi. (tabel %, operasi %)',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_immutable ON ledger_entries;
CREATE TRIGGER trg_ledger_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION osda_ledger_immutable();
```
```sql
ALTER TABLE ledger_entries ADD CONSTRAINT chk_ledger_nonzero
  CHECK ((debit > 0 AND kredit = 0) OR (kredit > 0 AND debit = 0));
```

Satu entri hanya boleh punya debet **atau** kredit, tidak keduanya, dan tidak boleh nol.

### Cara mengoreksi

```
SALAH catat: pengeluaran Rp50.000 masuk akun 502 (ATK), seharusnya 503 (Transport)

JANGAN ubah baris lama.
BUAT transaksi ADJUSTMENT:
   entri 1: kredit 50.000 pada akun 502  (mengembalikan saldo akun lama)
   entri 2: debit  50.000 pada akun 503  (memasukkan ke akun benar)
```

Status transaksi `POSTED` berarti sudah masuk ledger. Transaksi baru bisa berstatus
`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, lalu `POSTED`. Kolom penting
`transactions`: `kode` (`uq_transaksi_kode`), `jenis` (`INCOME`/`EXPENSE`/`TRANSFER`/
`REIMBURSEMENT`/`ADJUSTMENT`), `arah` (`IN`/`OUT` terhadap kas), `account_id` &
`account_tujuan_id` (untuk `TRANSFER`), `nominal` (wajib > 0, `chk_nominal_positif`),
`status`, `expense_request_id`/`reimbursement_id`/`payment_id` (asal transaksi),
`dicatat_oleh`/`disetujui_oleh`/`diposting_pada` (jejak aktor), `idempotency_key`
(`uq_transaksi_idempotensi`), dan `versi_baris`.

### Persetujuan transaksi

`POST /api/v1/finance/transactions/:id/approve` (izin `finance.approve`):

- Transaksi yang sudah diputus tidak bisa diputus lagi
  (`galatTransisi` → `APPROVAL_ALREADY_RESOLVED`).
- **Pencatat transaksi tidak boleh menyetujui transaksinya sendiri** —
  `galatIzinDitolak('Pencatat tidak boleh menyetujui transaksinya sendiri.')`.
- Bila disetujui, status berpindah ke `APPROVED` lalu `POSTED` dalam satu transaksi.

---

## 5. Anggaran

`budgets` dan `budget_items`:

| Tabel | Kolom penting |
|---|---|
| `budgets` | `kode`, `nama`, `total_diajukan`, `total_disetujui`, `status` (`DRAFT/SUBMITTED/APPROVED/ACTIVE/REVISED/CLOSED`), `revisi`, `parent_id`, `financial_period_id` (`restrict`) |
| `budget_items` | `budget_id`, `account_id` (`restrict`), `keterangan`, `nominal`, `realisasi` (denormalisasi untuk laporan cepat) |

Revisi anggaran **menaikkan nomor revisi**, bukan menimpa baris lama
(`parent_id` menunjuk versi sebelumnya). Endpoint: `GET`/`POST /api/v1/finance/budgets`
(`finance.read`/`finance.write`) dan `GET /api/v1/finance/reports/anggaran`
(`finance.export`).

---

## 6. Pengajuan (Expense / Income Request)

`expense_requests`:

| Kolom | Keterangan |
|---|---|
| `kode`, `jenis` (`EXPENSE`/`INCOME`) | Identitas. |
| `account_id`, `nominal`, `keterangan`, `tanggal` | Isi pengajuan. |
| `status` | `SUBMITTED`, `REVIEWED`, `APPROVED`, `REJECTED`, `PAID`, `CANCELLED`. |
| `pemohon_member_id` | Pemohon (`restrict`). |
| `direview_oleh`, `direview_pada` | Pemeriksa. |
| `disetujui_oleh`, `disetujui_pada` | Pemberi persetujuan. |
| `dibayar_oleh`, `dibayar_pada`, `metode_pembayaran`, `bukti_transfer` | Pelaksanaan pembayaran. |
| `transaksi_id` | Transaksi kas yang dihasilkan setelah posting. |
| `bukti_dokumen_id` | Lampiran bukti. |
| `idempotency_key` | Unik (`uq_pengajuan_idempotensi`). |

Alur:

```
Anggota/Bendahara buat pengajuan  (finance.write)   status SUBMITTED
   → Bendahara / sekretariat tinjau                  status REVIEWED
     → disetujui                                     status APPROVED
       → dibayar + transaksi kas dibuat              status PAID
         → transaksi POSTED + ledger_entries
```

Endpoint keputusan: `POST /api/v1/finance/requests/:id/decide` (izin `finance.approve`).
Aturan: pengajuan yang sudah diputus tidak bisa diputus lagi, dan
**pemohon tidak boleh memutuskan pengajuannya sendiri**
(`galatIzinDitolak('Pemohon tidak boleh memutuskan pengajuannya sendiri.')`).

---

## 7. Reimbursement & Ambang Persetujuan

`reimbursements` mirip `expense_requests`, tetapi `member_id` (bukan `pemohon_member_id`)
adalah anggota yang meminta penggantian. Status:
`SUBMITTED`, `REVIEWED`, `APPROVED`, `PAID`, `REJECTED`, `CANCELLED`.

### Ambang persetujuan

Didefinisikan di `packages/contracts/src/finance.ts`:

```ts
export const DEFAULT_AMBANG_PERSETUJUAN: AmbangPersetujuan = {
  reimburseTanpaPersetujuanBawaan: 100_000,
  expensePerluPersetujuanKetua: 500_000,
  expensePerluPersetujuanKetuaUntuk: ['INCOME', 'EXPENSE'],
};
```

| Kondisi | Konsekuensi |
|---|---|
| Reimbursement ≤ Rp100.000 | Boleh disetujui tanpa persetujuan Ketua (tetap butuh reviewer). |
| Reimbursement > Rp100.000 | Perlu persetujuan berjenjang (`approval_requests`). |
| Pengajuan `INCOME`/`EXPENSE` > Rp500.000 | Perlu persetujuan Ketua. |

Nilai-nilai ini bersifat default dan **dapat dikonfigurasi**. Bila Anda mengubahnya,
ubah di kontrak dan sesuaikan dokumen ini.

### Aturan pemohon ≠ pemberi persetujuan

Selain pemeriksaan di service, database menegakkannya lewat dua trigger:

```sql
CREATE TRIGGER trg_no_self_approval_expense
  BEFORE UPDATE ON expense_requests
  FOR EACH ROW EXECUTE FUNCTION osda_no_self_approval();

CREATE TRIGGER trg_no_self_approval_reimburse
  BEFORE UPDATE ON reimbursements
  FOR EACH ROW EXECUTE FUNCTION osda_no_self_approval_reimburse();
```

Pesan galatnya: "Pemohon tidak boleh menyetujui pengajuannya sendiri." dan
"Anggota tidak boleh menyetujui reimbursement-nya sendiri."

---

## 8. Pembayaran QRIS

### `payments`

| Kolom | Keterangan |
|---|---|
| `kode`, `jenis` (`KAS/IURAN/EVENT/PROGRAM/OTHER`), `periode` (mis. `2026-W10`) | Identitas. |
| `nominal`, `metode` (`CASH/QRIS/BANK_TRANSFER/EWALLET`) | Isi. |
| `status` | `PENDING`, `PAID`, `FAILED`, `EXPIRED`, `REFUNDED`. |
| `idempotency_key` | **Wajib**, unik per organisasi (`uq_payment_idempotensi`). |
| `referensi_provider` | Unik per organisasi (`uq_payment_referensi`) — inti idempotensi webhook. |
| `qr_string`, `qr_url`, `kedaluwarsa_pada` | Data QRIS (kedaluwarsa 30 menit). |
| `dibayar_pada`, `bukti_transfer` | Konfirmasi. |
| `transaksi_id` | Transaksi kas yang dihasilkan. |
| `jumlah_webhook` | Berapa kali webhook dipanggil (observability). |

### Alur idempotent

```
1. Klien panggil POST /api/v1/finance/payments
     dengan idempotency_key.
   Bila sudah ada baris dengan kunci itu → kembalikan intent lama (TIDAK buat baru).

2. Provider mengirim webhook ke POST /api/v1/webhooks/payment
   a. Simpan event ke webhook_events (unik provider + event_id).
      Bila duplikat → "Event sudah diproses sebelumnya." (tidak ubah apa pun).
   b. Cari pembayaran lewat referensi_provider.
      Babila status sudah PAID → "Pembayaran sudah diselesaikan."
   c. Bila nominal webhook ≠ nominal intent → galatDuplikat.
   d. Dalam SATU transaksi database:
        payments.status       → PAID, dibayar_pada, jumlah_webhook + 1
        transactions          → INSERT jenis INCOME, arah IN, status POSTED
        ledger_entries        → INSERT debit pada akun kas
        payments.transaksi_id → diisi
   e. Tandai webhook_events diproses = true.
   f. catatAudit('PAYMENT_SETTLED', 'payments', …)
```

Trigger `trg_payment_settle_once` menolak upaya menyettle pembayaran yang sudah `PAID`
dengan `transaksi_id` yang berbeda — lapis ketiga idempotensi.

```
CREATE TRIGGER trg_payment_settle_once
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION osda_payment_settle_once();
```

Akun kas tujuan dipilih sebagai akun aktif dengan `adalah_kas = true` terkecil kodenya
(`akunKasTujuan`). Bila tidak ada, service melempar galat validasi
"Belum ada akun kas aktif untuk organisasi ini."

---

## 9. Iuran Kas (Dues)

`dues_periods`: `kode` (mis. `KAS-2026-W39`), `frekuensi` (`MINGGUAN`/`BULANAN`/`KUSTOM`),
`periode` (ISO week, mis. `2026-W39`), `mulai_pada`, `selesai_pada`, `nominal`,
`status` (`OPEN`/`CLOSED`), `batas_pembayaran` (tanggal akhir tanpa penalti).
Unik: `uq_dues_org_periode` `(organization_id, periode)`.

`dues_status` — status iuran tiap anggota untuk satu periode: `kewajiban`
(`WAJIB`/`OPSIONAL`/`BELEGA`/`GRATIS`), `status` (`LUNAS`/`BELUM`/`TERLAMBAT`/
`DINONAKTIFKAN`), `nominal`, `payment_id`, `dibayar_pada`, `catatan`.
Unik: `uq_dues_status` `(dues_period_id, member_id)`.

---

## 10. Persetujuan Berjenjang

Modul persetujuan memakai dua tabel:

| Tabel | Kolom penting |
|---|---|
| `approval_requests` | `jenis` (`PROGRAM/BUDGET/EXPENSE/REIMBURSEMENT/DOCUMENT/ANNOUNCEMENT/EVENT/MINUTES/LEAVE`), `entitas_tabel`, `entitas_id`, `nominal`, `pemohon_id`, `level_sekarang`, `total_level`, `idempotency_key` |
| `approval_recipients` | `role_code` (**peran, bukan orang**), `level`, `status`, `diputusan_oleh`, `komentar` |

Karena penerima persetujuan disimpan sebagai `role_code`, perubahan siapa yang memegang
jabatan tidak memerlukan perubahan data persetujuan. Satu objek hanya boleh punya satu
permintaan aktif (`uq_approval_idempotensi`).

---

## 11. Ringkasan Endpoint

Daftar lengkap beserta izin ada di `API.md` (bagian 10). Ringkasnya per kelompok izin:

```
finance.read    : accounts, periods, budgets, transactions, ledger, kas,
                  requests, reimbursements, payments
finance.write   : accounts, periods, budgets, transactions, requests,
                  reimbursements, payments
finance.approve : transactions/:id/approve, requests/:id/decide,
                  reimbursements/:id/decide
finance.export  : reports/kas, reports/anggaran, reports/ledger
webhook         : POST /api/v1/webhooks/payment (callback provider)
```

Semuanya berada di bawah prefiks `api/v1/finance`, kecuali webhook yang memakai prefiks
`api/v1/webhooks` agar mudah dibatasi port dan rate limit-nya.

---

## Catatan untuk AI agent

1. Jangan pernah menulis `UPDATE ledger_entries` atau `DELETE FROM ledger_entries`
   — trigger `trg_ledger_immutable` akan menolak. Koreksi selalu transaksi `ADJUSTMENT`.
2. Semua nominal memakai integer rupiah penuh. Jangan pakai float atau `numeric` untuk
   uang; `SkemaNominal` sudah membatasi (bulat, non-negatif, maksimal 1 triliun).
3. Bila menambahkan endpoint pembayaran baru, idempotensi **wajib**: unik
   `(organization_id, idempotency_key)` dan `(organization_id, referensi_provider)`.
   Tanpa itu, webhook ganda akan menghasilkan transaksi kas ganda.
4. Perubahan ambang persetujuan (`DEFAULT_AMBANG_PERSETUJUAN`) berdampak pada seluruh alur
   pengajuan. Bila mengubahnya, tambahkan/migrasikan datanya sebagai *settings* organisasi,
   jangan hanya mengubah konstanta.
5. Bendahara memiliki `finance.write` tetapi tidak `finance.approve`. Jangan menambahkan
   endpoint yang membuat pemberi persetujuan sama dengan pencatat — kedua peran itu
   harus benar-benar berbeda orang, dan trigger database akan menolaknya.
