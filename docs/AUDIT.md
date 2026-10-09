# Audit Log

Acuan kode: `packages/db/src/schema/system.ts` (tabel `audit_logs`),
`apps/api/src/common/interceptors/audit.interceptor.ts`,
`apps/api/src/common/utilitas/konteks.ts` (`catatAudit`),
dan `packages/db/src/sql/invariants.ts`.

Audit log menjawab pertanyaan: **siapa mengubah apa, kapan, dari mana, dan berhasil atau
tidak** — bahkan bertahun-tahun kemudian.

---

## 1. Prinsip Append-Only

`audit_logs` tidak boleh diubah maupun dihapus:

```sql
CREATE OR REPLACE FUNCTION osda_audit_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs bersifat append-only: % tidak diizinkan.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_logs;
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION osda_audit_append_only();
```

Konsekuensi:

- **Tidak ada** endpoint `PATCH`/`DELETE` untuk audit. Yang ada hanya `GET`
  (`/api/v1/audit/logs`, `/api/v1/audit/logs/:id`, `/api/v1/audit/ringkasan`).
- Koreksi atas catatan audit dilakukan dengan menambah baris baru, bukan mengubah yang lama.

---

## 2. Struktur Tabel

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | Kunci primer acak. |
| `organization_id` | uuid → `organizations` (`set null`) | Organisasi tempat aksi terjadi. |
| `aksi` | text | Nama aksi, mis. `EXPENSE_APPROVED`, `PAYMENT_SETTLED`, `MEMBER_ARCHIVED`. |
| `entitas_tabel` | text | Tabel objek yang disentuh, mis. `attendance`, `tasks`, `payments`. |
| `entitas_id` | uuid | ID objek. |
| `actor_id` | uuid → `users` (`set null`) | Pengguna yang bertindak. |
| `actor_member_id` | uuid → `members` (`set null`) | Anggota yang bertindak. |
| `sumber` | enum | `API`, `WEB`, `MOBILE`, `WHATSAPP`, `SYSTEM`, `MIGRATION`. |
| `ip` | text | Alamat IP. |
| `user_agent` | text | Agen pengguna. |
| `request_id` | text | ID permintaan; **dapat disambungkan ke log aplikasi**. |
| `sebelum` | jsonb | Nilai sebelum perubahan. |
| `sesudah` | jsonb | Nilai sesudah perubahan. |
| `field_diubah` | text | Daftar field yang berubah. |
| `berhasil` | boolean | Apakah operasi berhasil. |
| `pesan_galat` | text | Pesan galat bila gagal. |
| `created_at` | timestamptz | Waktu pencatatan. |

Index:

```
idx_audit_org_created   (organization_id, created_at)
idx_audit_aksi          (aksi, created_at)
idx_audit_entitas       (entitas_tabel, entitas_id)
idx_audit_actor         (actor_id)
idx_audit_request       (request_id)
```

---

## 3. Apa yang Dicatat

### Audit otomatis (interceptor)

`AuditInterceptor` mencatat **setiap permintaan tulis**
(`POST`, `PATCH`, `PUT`, `DELETE`) milik pengguna terautentikasi yang bukan route publik.

- Nama aksi diambil dari metadata dekorator audit bila ada; bila tidak, dari peta pola rute
  (`PETA_AKSI`); bila tetap tidak cocok, nilai bawaannya adalah `SETTINGS_CHANGED`.
- Pencatatan bersifat **fire-and-forget**: kegagalan menulis audit tidak boleh membuat
  permintaan pengguna gagal (`catch` hanya mencatat peringatan).
- Interceptor menulis `ip`, `user_agent`, `request_id`, `berhasil`, dan `pesan_galat`.
  `sebelum`, `sesudah`, dan `field_diubah` ditulis `null` oleh interceptor — nilai itu
  diisi oleh penulisan audit manual di service.

Cuplikan `PETA_AKSI` (`apps/api/src/common/interceptors/audit.interceptor.ts`):

```
/members$                                  → MEMBER_CREATED
/members/[^/]+/arsipkan$                   → MEMBER_ARCHIVED
/members/                                  → MEMBER_UPDATED
/attendance/sessions/[^/]+/absen$          → ATTENDANCE_RECORDED
/attendance/sessions/[^/]+/tutup$         → ATTENDANCE_SESSION_CLOSED
/meetings$                                  → MEETING_CREATED
/meetings/[^/]+/minutes/[^/]+/approve$     → MINUTES_APPROVED
/tasks/[^/]+/verifikasi$                    → TASK_VERIFIED
/programs$                                  → PROGRAM_CREATED
/programs/[^/]+/status$                     → PROGRAM_APPROVED
/finance/transactions$                      → EXPENSE_CREATED
/finance/transactions/[^/]+/approve$        → EXPENSE_APPROVED
/announcements/[^/]+/publish$               → ANNOUNCEMENT_PUBLISHED
/settings                                    → SETTINGS_CHANGED
/users$                                      → USER_CREATED
```

### Audit manual (service)

`catatAudit()` di `apps/api/src/common/utilitas/konteks.ts` dipakai untuk aksi yang
**wajib** punya jejak lengkap, misalnya penyelesaian pembayaran:

```ts
await catatAudit(this.dbSvc, {
  organizationId: pembayaran.organizationId,
  aksi: 'PAYMENT_SETTLED',
  entitasTabel: 'payments',
  entitasId: pembayaran.id,
  sesudah: { referensi: payload.orderId, nominal: pembayaran.nominal },
});
```

Bentuk data yang diterima: `organizationId`, `aksi`, `entitasTabel`, `entitasId`,
`pengguna`, `requestId`, `sebelum`, `sesudah`, `berhasil`.

---

## 4. Kolom Rahasia yang Tidak Direkam

Komentar pada skema dan interceptor menyatakan: **nilai rahasia TIDAK dicatat** — hanya
metadata teknis. Berikut daftar kolom yang tidak boleh pernah masuk ke `sebelum`,
`sesudah`, maupun `field_diubah`:

| Tabel | Kolom yang **tidak boleh** dicatat | Alasan |
|---|---|---|
| `users` | `password_hash` | Rahasia autentikasi. |
| `sessions` | `refresh_token_hash` | Token sesi. |
| `one_time_tokens` | `token_hash`, `metadata` (bila berisi token) | Token sekali pakai. |
| `identities` | `provider_subject` bila memuat nomor penuh dan pengguna meminta kerahasiaan | Nomor pribadi; simpan bentuk terkanonik bila memang perlu. |
| `integration_configs` | `config_terenkripsi` | Kredensial AES-256-GCM. |
| `webhook_events` | `payload` (bagian tanda tangan) | Rahasia webhook. |
| `payments` | `qr_string` bila memuat data sensitif | Data pembayaran. |
| `auth_policies` | `nilai` bila memuat kebijakan rahasia | Tergantung isi. |
| `attendance_sessions` | `qr_secret` | Rahasia penanda tangan token QR. |

Aturan praktis saat Anda menambahkan audit manual:

1. Buat **daftar putih** field yang boleh dicatat, jangan daftar hitam. Daftar putih jauh
   lebih aman karena kolom baru otomatis tidak ikut tercatat.
2. Sanitasi **sebelum** memanggil `catatAudit` — di lapisan service, bukan setelah menyimpan.
3. Jangan pernah menyalin objek baris database utuh ke `sebelum`/`sesudah`; pilih field
   yang relevan.

---

## 5. Contoh Isi Audit

### Contoh 1 — Persetujuan pengeluaran (manual dari service)

```json
{
  "id": "b4f1c2d3-4e5f-6789-abcd-0123456789ab",
  "organization_id": "0f8b7a66-1111-4222-8333-444455556666",
  "aksi": "EXPENSE_APPROVED",
  "entitas_tabel": "expense_requests",
  "entitas_id": "77aa88bb-99cc-4dde-8011-223344556677",
  "actor_id": "3c9d1e00-aaaa-4bbb-8ccc-ddddeeeeffff",
  "actor_member_id": "99aa11bb-22cc-4ddd-8eee-ff0011223344",
  "sumber": "API",
  "ip": "10.20.30.40",
  "user_agent": "Mozilla/5.0 … Chrome/126",
  "request_id": "9f2c1a7b3d4e5f60",
  "sebelum": { "status": "SUBMITTED" },
  "sesudah": { "status": "APPROVED", "disetujuiOleh": "99aa11bb-…" },
  "field_diubah": "status,disetujui_oleh",
  "berhasil": true,
  "pesan_galat": null,
  "created_at": "2026-10-08T09:12:44.512+08:00"
}
```

### Contoh 2 — Pembayaran disettle dari webhook

```json
{
  "aksi": "PAYMENT_SETTLED",
  "entitas_tabel": "payments",
  "entitas_id": "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  "sumber": "API",
  "sebelum": null,
  "sesudah": { "referensi": "ORD-9F2C1A7B", "nominal": 2000 },
  "berhasil": true,
  "request_id": "webhook-001"
}
```

### Contoh 3 — Permintaan tulis yang gagal (interceptor)

```json
{
  "aksi": "ATTENDANCE_RECORDED",
  "entitas_tabel": "attendance",
  "actor_id": "3c9d1e00-…",
  "sumber": "API",
  "ip": "10.20.30.55",
  "request_id": "a1b2c3d4e5f6",
  "sebelum": null,
  "sesudah": null,
  "field_diubah": null,
  "berhasil": false,
  "pesan_galat": "Sesi berstatus CLOSED — kehadiran hanya bisa dicatat saat sesi OPEN.",
  "created_at": "2026-10-08T10:03:11.004+08:00"
}
```

**Perhatikan contoh 3:** kegagalan juga dicatat. Audit yang baik mencatat upaya yang
ditolak, bukan hanya keberhasilan.

---

## 6. Membaca Audit

| Endpoint | Izin | Keterangan |
|---|---|---|
| `GET /api/v1/audit/logs` | `audit.read` | Daftar; gunakan pagination kursor untuk riwayat panjang. |
| `GET /api/v1/audit/logs/:id` | `audit.read` | Detail satu entri. |
| `GET /api/v1/audit/ringkasan` | `audit.read` | Ringkasan aktivitas. |

`audit.read` termasuk cakupan `SYSTEM`. Hanya `SUPER_ADMIN` dan `ADVISOR` yang
memilikinya di antara peran bawaan.

Menelusuri satu insiden:

```
1. Catat requestId dari pesan galat yang dilihat pengguna.
2. GET /api/v1/audit/logs?requestId=…  → lihat aksi, aktor, keberhasilan.
3. Ambil entitasTabel + entitasId → telusuri riwayat objek itu di daftar audit.
4. Cocokkan dengan log aplikasi (level error/warn) yang memakai requestId yang sama.
```

---

## 7. Pembersihan & Retensi

- `audit_logs` **tidak punya** mekanisme hapus otomatis, dan tidak boleh dihapus
  (trigger append-only).
- Bila organisasi menuntut retensi terbatas, solusinya adalah **memindahkan** baris lama
  ke basis data arsip terpisah (bukan menghapusnya dari basis produksi), lalu menyimpan
  bukti pemindahan itu sendiri sebagai baris audit baru.

---

## Catatan untuk AI agent

1. Jangan pernah membuat endpoint yang mengubah atau menghapus `audit_logs`. Trigger
   `trg_audit_append_only` akan menolak, dan itu memang disengaja.
2. Saat menambah audit manual, pakai **daftar putih** field. Jangan pernah menyalin baris
   database utuh ke `sebelum`/`sesudah`.
3. Nama aksi sebaiknya UPPER_SNAKE_CASE (`EXPENSE_APPROVED`, `TASK_VERIFIED`). Bila rute
   Anda tidak cocok pola pada `PETA_AKSI`, tambahkan pola baru alih-alih membiarkan semua
   tercatat sebagai `SETTINGS_CHANGED`.
4. Interceptor tidak mencatat route `@Publik()`. Endpoint publik yang mengubah data
   (mis. tukar kode WhatsApp) sebaiknya punya audit manual bila berisiko.
5. Kegagalan juga harus dicatat. Bila Anda menulis audit manual hanya di jalur sukses,
   tambahkan penulisan di jalur gagal dengan `berhasil: false` dan `pesanGalat`.
