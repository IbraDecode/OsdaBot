# Keamanan

## Urutan prioritas

Kalau dua aturan bertabrakan, yang menang adalah yang lebih atas:

```
1. Keamanan & otorisasi
2. Integritas data
3. Niat pengguna
4. Arsitektur project
5. Kemampuan yang terimplementasi
6. Instruksi skill
7. Preferensi gaya komunikasi
```

Artinya: gaya komunikasi tidak boleh mengalahkan keamanan. Skill tidak boleh
melewati permission. AI tidak boleh mengarang data.

## Otorisasi

### Default-deny

Permission yang tidak ada di daftar = **tidak boleh**. Tidak ada jalur
"`kalau role admin, semua boleh`".

### 50 permission granular

```
organization.read / organization.update
members.read / create / update / delete / export
roles.read / roles.manage
attendance.read / create / update / delete / export
events.read / create / update / delete
tasks.read / create / update / assign / delete
finance.read / create / update / approve / export
documents.read / create / export / distribute
knowledge.read / knowledge.write
whatsapp.send / bulk_send / group_manage
groups.link / groups.configure
automation.read / create / cancel
monitoring.read / manage
skills.read / propose / approve
system.status_read / configure / safe_mode
```

Setiap permission punya deskripsi (divalidasi oleh test, jadi tidak ada permission
tanpa penjelasan).

### Role template

| Role | Ciri |
|---|---|
| `owner` | Semua permission (wildcard `*`, di-expand saat seed) |
| `admin` | Operasional penuh, **tapi tidak** `system.configure`/`safe_mode` |
| `secretary` | Dokumen, pengumuman, tugas |
| `treasurer` | Keuangan termasuk `finance.approve` |
| `attendance_manager` | Kehadiran |
| `committee` | Dukungan kegiatan |
| `member` | Baca data dasar miliknya saja |

Role `owner` satu-satunya yang punya akses konfigurasi sistem. Ini dicek oleh
test — kalau nanti ada role baru, test akan gagal.

### Admin grup ≠ admin organisasi

Ini ditegakkan di beberapa tempat:

- `whatsapp.get_group_members` mengembalikan catatan eksplisit:
  *"Status admin di grup WhatsApp BUKAN berarti hak administrasi di organisasi."*
- `GroupMembership.isGroupAdmin` hanya menyimpan status admin **grup**.
- Otorisasi hanya membaca `OrganizationRole`, tidak pernah `isGroupAdmin`.

## Scope organisasi

Semua query data organisasi menyertakan `organizationId` dari konteks:

```typescript
// Aman: filter organisasi dari backend
await prisma.attendanceEntry.findMany({
  where: { attendanceEventId, organizationId: context.organizationId },
})
```

`organizationId` **tidak pernah** diambil dari argumen model AI.

Ada dua lapis:

1. **Permission** — "apakah orang ini boleh?"
2. **Scope resource** — "apakah objek ini memang milik organisasi yang sedang
   dibahas?"

Tanpa lapis kedua, orang dengan izin bisa menebak UUID milik organisasi lain.
`AuthorizationService.checkResourceScope()` menutup celah itu.

## Identitas

### Verifikasi

```typescript
MemberIdentityLink {
  memberId, identityId, organizationId,
  verifiedAt: Date | null,   // null = belum terverifikasi
  verifiedBy: UUID | null,
  method: string | null
}
```

Klaim di chat ("aku ketua OSIS") **tidak** membuat `verifiedAt` terisi.
Mention otomatis hanya memakai link terverifikasi.

### Dimensi privilege

Satu orang bisa punya beberapa keanggotaan, tapi hak akses dihitung per
organisasi. Kalau ambigu, sistem bertanya — bukan menebak.

## Approvals

Tool dengan `requiresApproval: true` berhenti sebelum eksekusi dan
meminta persetujuan. Saat ini: `whatsapp.send_message`.

Alasan: pesan yang terkirim **tidak bisa ditarik**, dan penerima bisa salah
orang.

## Prompt injection

### Trust boundary

| Sumber | Tingkat |
|---|---|
| Kebijakan backend | Otoritas sistem |
| Identitas & izin terverifikasi | Otoritas akses |
| Instruksi pengguna terautentikasi | Berlaku dalam batas izin |
| Skill yang disetujui | Panduan kemampuan |
| Dokumen organisasi | Data |
| Pesan yang dikutip | Data konteks |
| Hasil pencarian eksternal | Data tidak tepercaya |
| Teks dari PDF/gambar | Data tidak tepercaya |

Isi dokumen **tidak pernah** diperlakukan sebagai instruksi.

### Pertahanan berlapis

1. Pemisahan instruksi & data (skill & dokumen masuk sebagai konteks terpisah,
   bukan system prompt).
2. Tool allowlist — hanya tool terdaftar.
3. Validasi skema Zod.
4. Otorisasi backend.
5. Validasi scope organisasi.
6. Approval untuk tindakan berisiko.
7. Audit logging.
8. Skill loader menolak metadata tidak valid.

Tidak ada satu kalimat system prompt yang dianggap cukup untuk mencegah
serangan.

## Audit log

`AuditLog` mencatat tindakan penting: aktor, organisasi, aksi, resource, hasil,
`correlationId`, alasan penolakan.

Yang **tidak** disimpan:

- Isi chat lengkap
- Kredensial
- Token API
- Detail pembayaran sensitif

`ToolExecution` menyimpan **ringkasan** input/output, bukan input mentah.
String dipotong 160 karakter.

## Redaksi log

Logger Pino me-redact di level logger, bukan di pemanggil:

```
apiKey, token, authorization, cookie, password, secret,
webhookSecret, sessionKey, creds, req.headers.authorization,
req.headers.cookie, res.headers["set-cookie"]
```

Redaksi di level logger penting supaya tidak bocor karena ada satu pemanggil
yang lupa.

## Secrets

- Semua kredensial dari environment.
- `.env` masuk `.gitignore`.
- `.env.example` **tidak** berisi nilai asli.
- Session WhatsApp di folder terpisah, izin `0700`/`0600`, tidak di-commit.
- API key tidak pernah masuk `SKILL.md`, prompt, log, atau pesan WhatsApp.

## Isolasi multi-tenant

Setiap organisasi punya data terpisah secara logis:

```
Organization A  → members, attendance, tasks, finance, documents
Organization B  → members, attendance, tasks, finance, documents
```

Query lintas organisasi harus punya-justification eksplisit, dan saat ini
**belum ada** mekanisme berbagi antar organisasi. Itu disengaja untuk MVP.

## Batasan saat ini

| Yang belum ada | Dampak |
|---|---|
| Approval engine persisten | `whatsapp.send_message` butuh broker; belum ada UI |
| Rate limit per organisasi | Hanya per pengirim (in-memory) |
| Audit log UI | Hanya query database |
| Enkripsi field sensitif | Tidak ada data sensitif yang dienkripsi |
| 2FA / approval dua pihak | Belum ada |

Fitur ini belum diaktifkan secara default, jadi risikonya terbatas. Lihat
[STATUS-IMPLEMENTASI.md](./STATUS-IMPLEMENTASI.md).