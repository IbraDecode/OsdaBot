# Dokumen & Arsip (Documents)

Acuan kode: `packages/db/src/schema/documents.ts`,
`packages/db/src/sql/invariants.ts`, dan
`apps/api/src/modules/` (dokumen dipakai lintas modul).

Prinsip: **metadata di PostgreSQL, berkas di object storage.** PostgreSQL hanya menyimpan
kunci objek (`storage_key`). Akses berkas hanya lewat signed URL berumur pendek dari
bucket privat.

---

## 1. Pemisahan Metadata dan Berkas

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│  PostgreSQL                │        │  Object Storage (S3-compat)  │
│  documents                 │        │  bucket: osda-documents      │
│   judul, kategori, versi    │  key   │  privat, akses via signed URL│
│   storage_key              ├───────►│  org/<id>/program/<id>/…     │
│   checksum_sha256          │        │                              │
│  document_versions         │        └──────────────────────────────┘
└────────────────────────────┘
```

Tabel `storage_buckets` menyimpan konfigurasi bucket per organisasi. Kolom `publik`
**selalu `false`** — komentar di skema menyatakan: "Selalu true di v2 — bucket publik
dilarang", dengan nilai bawaan `false`. Jangan pernah mengubahnya menjadi `true`.

| Kolom | Keterangan |
|---|---|
| `nama`, `prefix` | Nama bucket dan prefiks objek (organisasi sebagai namespace). |
| `publik` | Wajib `false`. |
| `batas_ukuran_bytes` | Batas ukuran satu berkas. |
| `kuota_bytes`, `dipakai_bytes` | Kuota dan pemakaian. |

---

## 2. Dokumen

Tabel `documents`:

| Kolom | Keterangan |
|---|---|
| `judul`, `kategori`, `deskripsi` | Identitas. Kategori contoh: `SURAT_MASUK`, `SURAT_KELUAR`, `PROPOSAL`, `LPJ`, `NOTULEN`, `SK`, `UNDANGAN`. |
| `versi` | Versi aktif saat ini. |
| `status` | `DRAFT`, `REVIEW`, `APPROVED`, `ARCHIVED`. |
| `owner_member_id`, `division_id`, `program_id`, `event_id`, `meeting_id` | Konteks kepemilikan. |
| `storage_key`, `nama_berkas`, `ukuran_bytes`, `mime`, `checksum_sha256` | Metadata versi aktif (denormalisasi agar daftar tidak perlu join). |
| `perlu_persetujuan` | Bawaan `true`. |
| `disetujui_oleh`, `disetujui_pada`, `alasan_penolakan` | Alur persetujuan. |
| `diarsipkan_pada` | Pengarsipan (bukan hapus). |
| `retensi_hari` | `0` = simpan permanen. |
| `tag[]` | Label. |
| `pencarian` | Kolom bantu pencarian teks. |
| `versi_baris` | Optimistic locking. |

Index penting:

```
index('ix_dokumen_org_kategori')  (organization_id, kategori)
index('ix_dokumen_status')        (status)
index('ix_dokumen_pencarian')      (organization_id, pencarian)
uniqueIndex('uq_dokumen_storage_key')  (storage_key)
```

Pencarian teks penuh memakai index GIN (lihat bagian 6).

---

## 3. Versi & Penguncian

Tabel `document_versions` — setiap revisi adalah baris baru:

| Kolom | Keterangan |
|---|---|
| `document_id`, `versi` | Unik: `uq_dokumen_versi`. |
| `storage_key` | Unik: `uq_dokumen_versi_key`. |
| `nama_berkas`, `ukuran_bytes`, `mime`, `checksum_sha256` | Metadata versi ini. |
| `catatan`, `alasan_revisi` | Penjelasan perubahan. |
| `diunggah_oleh`, `diunggah_pada` | Pengunggah. |
| `dikunci`, `dikunci_pada` | `true` setelah disetujui. |

### Trigger penguncian

```sql
CREATE OR REPLACE FUNCTION osda_document_version_locked() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.dikunci THEN
    RAISE EXCEPTION 'Versi dokumen % sudah dikunci dan tidak dapat diubah.', OLD.versi
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dokumen_versi_locked ON document_versions;
CREATE TRIGGER trg_dokumen_versi_locked
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION osda_document_version_locked();
```

Artinya: versi yang sudah `APPROVED` dan dikunci **tidak dapat diubah maupun dihapus**.
Mengubah isinya berarti membuat versi baru dengan `alasan_revisi`.

### Alur versi

```
dokumen D v1 DRAFT
   └── unggah revisi → v2 DRAFT (alasan_revisi wajib)
        └── setujui → v2 APPROVED, dikunci = true
             └── revisi lagi → v3 DRAFT  (v2 tetap utuh)
```

`documents.versi` menunjuk versi aktif, dan kolom `storage_key`, `mime`,
`ukuran_bytes`, `checksum_sha256` pada `documents` adalah salinan dari versi aktif itu.

---

## 4. Hak Akses Dokumen

Tabel `document_access`:

| Kolom | Keterangan |
|---|---|
| `document_id` | Dokumen yang dibatasi. |
| `member_id`, `role_code`, `division_id` | Pihak yang diberi akses (bisa per orang, per peran, atau per divisi). |
| `hanya_baca` | Bawaan `true`. `false` berarti boleh diedit. |
| `berlaku_sampai` | Masa berlaku akses. |
| `diberikan_oleh` | Pemberi akses. |

Aturan yang dinyatakan skema: **daftar kosong berarti semua anggota dengan izin
`document.read` boleh membaca** (dan tetap dibatasi cakupan/scope). Jadi jangan menyematkan
baris `document_access` kosong secara eksplisit untuk membuat dokumen "privat" — gunakan
daftar bertanda tertentu, atau ubah aturannya di service dan catat di dokumen ini.

---

## 5. Validasi Berkas

### Batas ukuran

- Badan permintaan umum dibatasi **2 MB** (`bodyLimit: 2 * 1_024 * 1_024`) —
  lihat `apps/api/src/bootstrap.ts`.
- Unggahan berkas memakai `@fastify/multipart` dengan batas `fileSize` dari
  `UPLOAD_MAKS_BYTE` pada konfigurasi.
- Berkas yang melebihi batas menghasilkan galat `PAYLOAD_TOO_LARGE` (HTTP 413).

### Validasi MIME

MIME diperiksa saat unggah. Nilai yang tidak diizinkan menghasilkan
`UNSUPPORTED_FILE_TYPE` (HTTP 415). Tabel berikut adalah kategori yang lazim dipakai;
daftar putih pastinya harus diverifikasi pada skema DTO modul yang Anda ubah:

| Kategori | Contoh MIME |
|---|---|
| Berkas kantor | `application/pdf`, `application/msword`, `application/vnd.openxmlformats-…` |
| Lembar kerja | `application/vnd.ms-excel`, `application/vnd.openxmlformats.spreadsheetml.sheet` |
| Gambar | `image/png`, `image/jpeg`, `image/webp` |
| Arsip | `application/zip` |

> Penting: `mime` yang dilaporkan klien **tidak boleh dipercaya begitu saja**. Lakukan
> pemeriksaan isi (magic bytes) bila memungkinkan, dan simpan always `checksum_sha256`.

### `checksum_sha256`

Digunakan untuk memverifikasi berkas yang diunduh dari storage sama dengan yang diunggah.
Selalu simpan saat membuat versi baru — kolomnya wajib (`checksumSha256` NOT NULL pada
`document_versions`).

---

## 6. Pencarian Teks Penuh

Index GIN dibuat otomatis oleh `SQL_INVARIANT`:

```sql
CREATE INDEX IF NOT EXISTS ix_documents_fts
  ON documents USING GIN (to_tsvector('simple', coalesce(judul, '') || ' ' || coalesce(deskripsi, '')));
```

Kolom `pencarian` pada `documents` adalah bantu untuk pencarian sederhana yang dijaga
service. Index `ix_dokumen_pencarian` `(organization_id, pencarian)` mendukungnya.

---

## 7. Kategori Dokumen

`document_categories` membuat kategori dapat dikonfigurasi organisasi:

| Kolom | Keterangan |
|---|---|
| `kode`, `nama`, `deskripsi` | Identitas kategori. |
| `bawaan` | `true` untuk kategori bawaan agar tidak terhapus. |
| `retensi_hari` | Retensi default kategori (`0` = permanen). |
| `perlu_persetujuan` | Apakah dokumen kategori ini perlu persetujuan. |
| `urutan`, `aktif` | Urutan tampilan & penanda aktif. |

Unik: `uq_kategori_org_kode` `(organization_id, kode)`.

---

## 8. Surat Masuk & Surat Keluar

Tabel `letters` milik Sekretaris:

| Kolom | Keterangan |
|---|---|
| `arah` | `MASUK` atau `KELUAR`. |
| `nomor`, `tanggal` | Nomor surat wajib, unik per organisasi (`uq_surat_org_nomor`). |
| `pengirim`, `penerima`, `instansi_pengirim` | Pihak terkait. |
| `ringkasan` | **Wajib.** Ringkasan isi surat. |
| `perlu_tindak_lanjut`, `batas_tindak_lanjut`, `selesai_pada` | Tindak lanjut. |
| `document_id` | Berkas surat (metadata dokumen). |
| `dicatat_oleh` | Pencatat. |

Index pendukung: `ix_surat_tindak_lanjut` `(organization_id, perlu_tindak_lanjut)` untuk
daftar surat yang menunggu respons.

---

## 9. Lampiran Lintas Modul

Dokumen dipakai sebagai lampiran di berbagai tempat:

| Pemakai | Kolom |
|---|---|
| `meeting_attachments` | `document_id`, `jenis` (`LAMPIRAN`/`UNDANGAN`/…) |
| `program_documents` | `document_id`, `jenis` (`PROPOSAL`/`ANGGARAN`/`SURAT`/`DOKUMENTASI`/`LPJ`/`LAINNYA`) |
| `expense_requests` | `bukti_dokumen_id` |
| `reimbursements` | `bukti_dokumen_id` |
| `permission_requests` | `bukti_dokumen_id` |
| `announcements` | `lampiran_dokumen_ids[]` |
| `tasks` | `lampiran_dokumen_ids[]` |
| `position_assignments` | `dokumen_id` (SK) |

Perhatikan: kolom-kolom `dokumen_id`/`bukti_dokumen_id`/`document_id` pada beberapa tabel
**tidak punya foreign key**. Itu berarti aplikasi wajib memverifikasi keberadaan dokumen
sendiri. Jangan mengandalkan integritas referensial database di sini.

---

## 10. Alur Singkat

```
1. Klien minta izin unggah  → API memvalidasi MIME & ukuran
2. Klien unggah berkas (multipart) → object storage, menghasilkan storage_key
3. API menyimpan document_versions (versi baru) + memperbarui documents.versi
4. Dokumen berstatus DRAFT → REVIEW → APPROVED (dikunci) → ARCHIVED
5. Pihak berizin meminta tautan → API membuat signed URL berumur pendek
6. Pemeriksa mengunduh → API bisa memverifikasi checksum_sha256
```

Status dokumen memakai enum `status_dokumen`: `DRAFT`, `REVIEW`, `APPROVED`, `ARCHIVED`.
Persetujuan dokumen memakai izin `document.approve` (lihat `ROLE_MATRIX.md`).

---

## Catatan untuk AI agent

1. Jangan pernah membuat bucket publik atau menyimpan berkas di filesystem lokal aplikasi.
   `storage_buckets.publik` harus tetap `false`; akses selalu lewat signed URL.
2. Bila menambah versi baru, `documents.storage_key`, `mime`, `ukuran_bytes`, dan
   `checksum_sha256` harus ikut diperbarui supaya daftar dokumen tidak menampilkan
   metadata versi lama.
3. Kolom `dokumen_id` pada `position_assignments` dan `bukti_dokumen_id` pada
   `expense_requests`/`reimbursements`/`permission_requests` tidak punya foreign key —
   validasi keberadaannya di service.
4. Jangan mengubah trigger `trg_dokumen_versi_locked` menjadi memungkinkan "edit kecil"
   versi terkunci. Bila memang perlu, buat versi baru — itulah gunanya versioning.
5. MIME dari klien tidak boleh dipercaya. Tambahkan pemeriksaan magic bytes bila Anda
   menambah endpoint unggah baru, dan selalu simpan `checksum_sha256`.
