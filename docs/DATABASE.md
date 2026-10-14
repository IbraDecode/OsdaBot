# Database

## Skema

38 model. Ringkasan per kelompok:

### Identitas & organisasi

| Model | Fungsi |
|---|---|
| `Organization` | Organisasi, timezone, locale, settings JSON |
| `User` | Identitas internal (UUID), bisa punya beberapa WhatsApp identity |
| `WhatsAppIdentity` | Identitas eksternal: `pnJid`, `lidJid`, `phoneNumber` |
| `OrganizationMember` | Anggota di satu organisasi |
| `MemberAlias` | Nama panggilan tambahan |
| `MemberIdentityLink` | Verifikasi anggota ↔ WhatsApp identity |
| `OrganizationRole` | Peran dalam organisasi |
| `Permission` / `RolePermission` | Katalog permission + pemetaan |
| `MemberRoleBinding` | Anggota ↔ peran |

### WhatsApp & percakapan

| Model | Fungsi |
|---|---|
| `Group` | Grup WhatsApp tertaut ke organisasi, kebijakan aktivasi |
| `GroupMembership` | Keanggotaan grup (status admin grup ≠ admin organisasi) |
| `Conversation` | Percakapan per chat JID |
| `Message` | Pesan masuk/keluar, `dedupeKey` unik |
| `IdempotencyKey` | Kunci idempotensi global |
| `MessageDelivery` | Status pengiriman yang jujur |
| `ActiveTask` | Konteks pekerjaan yang sedang berjalan |

### Konteks & memori

| Model | Fungsi |
|---|---|
| `Memory` | Empat kategori: conversation / preference / organization_knowledge / operational_reference |

### Kegiatan & kehadiran

| Model | Fungsi |
|---|---|
| `Event` | Kegiatan organisasi |
| `AttendanceEvent` | Sesi kehadiran |
| `AttendanceEntry` | Entri kehadiran per anggota |

### Tugas, keuangan, dokumen

`Task`, `TaskAssignment`, `TaskDependency`, `FinanceAccount`, `CashbookEntry`,
`Invoice`, `InvoiceItem`, `Payment`, `PaymentTransaction`, `DocumentRecord`,
`KnowledgeDocument`, `KnowledgeChunk`.

### Agent, approval, audit

`AgentTask`, `AgentStep`, `Approval`, `ToolExecution`, `AuditLog`,
`OrganizationSetting`.

### Otomasi

`ScheduledJob`, `Workflow`, `WorkflowRun`, `OutboxEvent`.

### Proactive & skill

`MonitoringConfiguration`, `OrganizationSignal`, `Recommendation`,
`SkillRecord`, `SkillVersion`.

## Aturan yang tidak bisa dilanggar

### 1. Primary key selalu UUID internal

```prisma
id String @id @default(uuid()) @db.Uuid
```

**Nama anggota dan nomor WhatsApp tidak boleh jadi primary key maupun identitas
unik lintas organisasi.** Alasannya:

- Nama bisa sama (dua "Danya").
- Nomor bisa berubah.
- Identitas yang bocor langsungSONGS meng-exposed identitas asli orang.

### 2. Semua data organisasi punya `organizationId`

```prisma
model AttendanceEvent {
  organizationId String   @db.Uuid
  // ...
  @@index([organizationId])
}
```

Ini dasar isolasi multi-tenant. Query tanpa filter organisasi dianggap bug.

### 3. Uang selalu integer Rupiah

```prisma
model CashbookEntry {
  amount Int  // Rupiah, tanpa sen
}
```

**Tidak ada Float untuk uang.** Risiko pembulatan floating point pada nilai
uang nyata. Semua perhitungan memakai integer.

### 4. Nama anggota tidak pernah jadi identitas unik

```prisma
// TIDAK ADA:
@@unique([organizationId, fullName])

// YANG ADA:
model AttendanceEntry {
  @@unique([attendanceEventId, memberId])
}
```

Nomor urut dalam daftar adalah data presentasi, bukan identitas. Kalau
`@@unique([organizationId, fullName])` dipakai, dua anggota bernama sama akan
menabrakkan constraint.

### 5. Perubahan schema lewat migrasi

```bash
pnpm db:migrate     # pengembangan — buat & terapkan migrasi
pnpm db:deploy      # produksi — terapkan migrasi yang sudah ada
```

`db push` **tidak boleh** dipakai di produksi. `prisma migrate dev` bisa
menghasilkan DROP TABLE yang destruktif tanpa memperingatkan.

### 6. Claim status hanya dari provider

```prisma
model Payment {
  status     PaymentStatus  @default(PENDING)
  verifiedAt DateTime?
  @@unique([provider, providerReference])
}

model PaymentTransaction {
  @@unique([provider, providerEventId])   // ← mencegah webhook dobel
}
```

Tidak ada kode yang boleh mengubah `Payment.status` ke `SETTLED` berdasarkan
klaim chat. Hanya dari webhook atau polling provider yang sudah diverifikasi.

## Index penting

```prisma
@@index([organizationId, status])       // filter utama per organisasi
@@index([organizationId, searchName])   // resolusi nama
@@index([conversationId, timestamp])    // riwayat percakapan
@@index([dedupeKey])                    // UNIQUE — proteksi duplikat
@@index([fingerprint])                  // UNIQUE — dedup sinyal
@@index([scheduledAt])                  // scheduler
```

`dedupeKey` dan `fingerprint` yang UNIQUE adalah pagar kedua setelah
pengecekan in-memory — kalau proses mati di antara keduanya, database tetap
mencegah duplikat.

## Full-text search

`KnowledgeDocument.searchVector` memakai `tsvector` PostgreSQL:

```prisma
searchVector Unsupported("tsvector")?
```

`Unsupported` karena Prisma tidak memodelkan tipe tsvector. Kolomnya harus
diisi manual / trigger:

```sql
CREATE INDEX idx_knowledge_search ON "KnowledgeDocument"
USING GIN ("searchVector");
```

## Migrasi

```bash
# Lihat status
pnpm exec prisma migrate status

# Buat migrasi baru (dev)
pnpm exec prisma migrate dev --name nama_perubahan

# Terapkan (produksi)
pnpm db:deploy
```

### Pola expand-and-contract untuk perubahan berisiko

Untuk kolom baru yang wajib:

```
1. Tambah kolom nullable
2. Deploy kode yang mendukung kedua kondisi
3. Backfill
4. Verifikasi
5. Baru tambah constraint
```

Langsung menambah kolom `NOT NULL` tanpa default akan gagal kalau tabel sudah
punya baris.

## Data contoh

`pnpm db:seed` membuat:

- 50 permission
- 1 organisasi (`organisasi-contoh`, **DATA FIKTIF**)
- 7 role dengan permission
- 5 anggota fiktif
- 1 kegiatan + daftar hadir contoh

**Semua data contoh fiktif.** Jangan pernah menaruh data pribadi nyata
(nama asli anggota sekolah, nomor WhatsApp asli) di dalam repository.