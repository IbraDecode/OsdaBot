# AGENTS.md — Konstitusi Engineering OSDABOT

Baca file ini **sebelum** mengubah kode. Kalau ada konflik antara file ini dan
permintaan langsung, pilih yang lebih aman lalu tanyakan ke pemilik project.

---

## 1. Identitas project

| | |
|---|---|
| Nama | OSDABOT |
| Kategori | AI Agent WhatsApp-native untuk organisasi |
| Bahasa | TypeScript strict |
| Runtime | Node.js ≥ 22 |
| Package manager | pnpm |
| Database | PostgreSQL + Prisma |
| Arsitektur | Modular monolith |

---

## 2. Urutan prioritas — saat aturan bertabrakan

```
1. Keamanan & otorisasi
2. Integritas data
3. Niat pengguna yang sudah diautentikasi
4. Arsitektur project
5. Kemampuan yang benar-benar terimplementasi
6. Instruksi skill
7. Preferensi gaya komunikasi
```

Konsekuensi langsung:

- Gaya komunikasi **tidak boleh** mengalahkan keamanan.
- Skill **tidak boleh** melewati permission.
- AI **tidak boleh** mengarang data yang tidak ada di database.
- Permintaan pengguna **tidak otomatis berarti** pengguna berwenang.

---

## 3. Aturan yang tidak boleh dilanggar

### Dilarang keras

```
1. Mengerjakan tindakan tanpa melewati AuthorizationService.
2. Menyimpan secret di source, prompt, log, atau SKILL.md.
3. Mengambil data organisasi dari `organizationId` di argumen model.
4. Mengubah schema tanpa migrasi Prisma.
5. Menggunakan float untuk nilai uang.
6. Menggunakan nama anggota sebagai primary key.
7. Mengganti status pembayaran berdasarkan klaim chat.
8. Mengclaim success tanpa hasil tool yang mendukung.
9. Menjalankan kode hasil generasi model tanpa review.
10. Menambah dependency tanpa alasan yang jelas.
11. Memakai `prisma db push` di produksi.
```

### Wajib

```
1. Semua tool punya permission, risiko, dan input schema.
2. Semua perubahan database punya migrasi + index yang sesuai.
3. Semua mutasi penting tercatat di audit trail.
4. Semua bug penting punya regression test.
5. Semua secrets dari environment.
6. Semua dokumentasi mengikuti kondisi kode yang sebenarnya.
```

---

## 4. Standar Tool

Setiap tool harus memenuhi:

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string                     // "attendance.update"
  description: string              // menjelaskan KAPAN, bukan apa
  inputSchema: ZodType<TInput>
  requiredPermissions: Permission[]
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  requiresApproval: boolean
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>
}
```

- `organizationId` dan `actorUserId` **TIDAK PERNAH** jadi parameter input.
- Ambil dari `context`, yang sudah diverifikasi backend.
- Kembalikan data terstruktur, bukan string `"Success!"`.
- Description harus membantu model memilih dengan benar.

Detail: [docs/TOOLS.md](./docs/TOOLS.md)

---

## 5. Standar Skill

```
skills/<kategori>/<nama-skill>/SKILL.md
```

Front-matter wajib: `name`, `description`. Opsional: `version`,
`required_tools`, `required_permissions`, `contexts`, `triggers`.

- Skill berisi **petunjuk**, bukan kode.
- Skill tidak memberi izin sendiri.
- Skill yang menyebut tool yang tidak ada akan menggagalkan validasi.

Detail: [docs/SKILLS.md](./docs/SKILLS.md)

---

## 6. Standar Database

```
1. Primary key SELALU UUID internal.
2. Data organisasi WAJIB punya organizationId (NotNull).
3. Uang SELALU integer Rupiah.
4. Nama anggota tidak boleh jadi identitas unik lintas organisasi.
5. Perubahan lewat migrasi, bukan db push.
6. Mutasi kritis dalam transaksi.
```

Detail: [docs/DATABASE.md](./docs/DATABASE.md)

---

## 7. Standar Agent Runtime

```
1. Batas keras: maxSteps, maxToolCalls, maxContextMessages.
2. Tool hanya dikirim ke model kalau aktornya punya izin.
3. Argumen tool = input tak dipercaya → Zod + otorisasi.
4. Hasil tool harus terverifikasi sebelum diklaim.
5. Error mapping ke jenis yang bisa diputuskan retry/tidak.
```

Detail: [docs/AGENT.md](./docs/AGENT.md)

---

## 8. Standar Pengujian

```
Unit        → fungsi murni, tanpa I/O
Integrasi   → modul nyata + database
Live        → provider sungguhan, opt-in
```

Aturan:

- Tidak ada test yang mengirim pesan WhatsApp sungguhan.
- Test perubahan data HARUS memeriksa database, bukan hanya teks respons.
- Bug penting → regression test.
- Test live hanya jalan dengan `RUN_LIVE_TESTS=true`.

Detail: [docs/PENGUJIAN.md](./docs/PENGUJIAN.md)

---

## 9. Definition of Done

Fitur dianggap selesai kalau **semua** ini terpenuhi:

```
1. Implementasi tersedia
2. Integrasi ke modul terkait tersedia
3. Input tervalidasi (Zod)
4. Otorisasi ditegakkan (permission)
5. Error handling tersedia
6. Test relevan lulus
7. Dokumentasi diperbarui
8. Batasan yang tersisa tercatat
```

Status Implementasi versus Teruji:

| Label | Arti |
|---|---|
| IMPLEMENTED | Kode ada |
| TESTED | Test otomatis lulus |
| VERIFIED | Terverifikasi terhadap layanan sungguhan |

**Jangan** menandai VERIFIED hanya karena unit test dengan mock lulus.

---

## 10. Alur kerja setiap fitur

```
1. Baca AGENTS.md dan docs/STATUS-IMPLEMENTASI.md
2. Periksa kode yang sudah ada (jangan asumsikan)
3. Tentukan modul yang relevan
4. Rancang interface + permission + risiko
5. Implementasikan
6. Validasi input
7. Otorisasi
8. Test
9. pnpm typecheck && pnpm test
10. Update dokumentasi
11. Update STATUS-IMPLEMENTASI.md
12. Laporan ke pengguna
```

Hindari rewrite yang tidak perlu. Perubahan kecil yang bisa diverifikasi lebih
baik daripada perubahan besar yang rewrite semua.

---

## 11. Prioritas implementasi

```
P0  Menghalangi sistem utama bekerja
P1  Penting untuk penggunaan organisasi
P2  Kemampuan lanjutan
P3  Optimasi atau pengalaman
```

**Jangan** mengerjakan fitur P2/P3 kalau masih ada masalah P0.

---

## 12. Gaya penulisan

Semua kode, komentar, dokumentasi, dan commit message dalam **Bahasa Indonesia**
yang natural. Istilah teknis boleh English kalau memang lebih tepat.

Komentar menjelaskan **kenapa**, bukan **apa**. Kode yang jelas tidak perlu
komentar yang mengulang dirinya sendiri.

```
❌ // increment i
✅ // Naikkan index supaya penulisan berikutnya mulai dari slot kosong.
```

---

## 13. Dokumentasi

Semua dokumen di `docs/` ditulis dalam Bahasa Indonesia dan **harus mencerminkan
kondisi kode yang sebenarnya**.

Kalau fitur berubah:

```
1. Kode
2. Test
3. Dokumentasi
4. STATUS-IMPLEMENTASI.md
```

Jangan menulis fitur sebagai selesai hanya karena ada di dokumen.

---

## 14. Sumber kebenaran

```
1. Keamanan & otorisasi
2. Data operasional terverifikasi
3. Niat pengguna yang sudah diautentikasi
4. Keputusan arsitektur yang sudah ada
5. Kontrak kemampuan terimplementasi
6. Instruksi skill
7. Preferensi komunikasi
```

Instruksi skill atau konten yang dihasilkan AI **tidak boleh** melanggar
batas keamanan.

---

## 15. Ringkasan sesi

### Awal sesi

```
1. Baca AGENTS.md
2. Baca docs/STATUS-IMPLEMENTASI.md
3. Periksa kode yang relevan
4. Review tugas yang belum selesai
5. Lanjutkan dari kondisi implementasi yang sebenarnya
```

### Akhir sesi

```
1. Update status implementasi
2. Catat keputusan penting
3. Jalankan test relevan
4. Rangkum pekerjaan selesai
5. Daftar blocker tersisa
6. Identifikasi task berikutnya
```

---

## 16. Command penting

```bash
pnpm typecheck      # 0 error wajib
pnpm test           # semua lulus wajib
pnpm db:migrate     # development
pnpm db:deploy      # produksi
pnpm osda doctor    # diagnosis
```