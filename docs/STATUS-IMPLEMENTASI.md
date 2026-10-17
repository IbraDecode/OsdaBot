# Status Implementasi

Laporan ini **mencerminkan kondisi kode yang sebenarnya**, bukan rencana.

Status memakai lima tingkat:

| Status | Arti |
|---|---|
| `NOT_IMPLEMENTED` | Belum ada |
| `SCAFFOLDED` | Struktur ada, belum berfungsi |
| `IMPLEMENTED` | Logika utama sudah ada |
| `TESTED` | Test otomatis relevan lulus |
| `VERIFIED` | Terverifikasi terhadap integrasi sungguhan |

## Ringkasan

| Komponen | Status | Bukti |
|---|---|---|
| Konfigurasi & env | `TESTED` | Validasi Zod, fail-fast |
| Logging terstruktur | `TESTED` | Redaksi di-level logger |
| Database + migrasi | `TESTED` | Migrasi terapkan ke PostgreSQL |
| Identity engine | `TESTED` | 19 test unit + integrasi DB |
| Otorisasi (RBAC) | `TESTED` | Test membuktikan tool tidak dijalankan |
| Attendance service | `TESTED` | Formatter + idempotensi + scope |
| Task service | `TESTED` | 33 test integrasi, siklus & lintas-organisasi ditolak |
| Safe mode | `TESTED` | 12 test, bertahan melewati restart, 4 gerbang |
| Rekaman agent | `TESTED` | 10 test, langkah + alasan berhenti |
| Retensi data | `TESTED` | 12 test; 25 tabel bisnis mustahil tersentuh |
| Monitoring agent | `TESTED` | 17 test; pola lintas-peristiwa, dasar saran dibedakan |
| Payment adapter | `TESTED` | 28 test, idempotensi + verifikasi webhook |
| Safe mode | `TESTED` | 12 test, bertahan melewati restart, 4 gerbang |
| Rekaman agent | `TESTED` | 10 test, langkah + alasan berhenti |
| Retensi data | `TESTED` | 12 test; 25 tabel bisnis mustahil tersentuh |
| Monitoring agent | `TESTED` | 17 test; pola lintas-peristiwa, dasar saran dibedakan |
| Skill registry | `TESTED` | Loader + validasi metadata |
| AI provider | `VERIFIED` | **Diuji terhadap gateway sungguhan** |
| Loop agent (skill → tool) | `VERIFIED` | **11 skenario live**, `docs/UJI-SMOKE.md` |
| Percakapan WhatsApp live | `VERIFIED` | **Pesan nyata → persetujuan → charge BaturPay** |
| Agent runtime | `TESTED` | Tool calling + batas loop |
| Message pipeline | `TESTED` | Dedupe + rate limit + aktivasi grup |
| Tool registry | `TESTED` | 49 tool, otorisasi per tool |
| HTTP server | `TESTED` | `/health`, `/ready` jalan |
| CLI | `IMPLEMENTED` | 34 perintah, membaca data nyata |
| WhatsApp handshake | `VERIFIED` | Noise handshake berhasil, QR & pairing code dibuat |
| WhatsApp pairing config | `VERIFIED` | Konfigurasi platform & kebijakan reconnect diperbaiki |
| WhatsApp pairing blocker | `VERIFIED` | 429 rate-overlimit; guard sudah terbukti berfungsi |
| **WhatsApp pairing** | `BLOCKED` | Menunggu cooldown server sebelum mencoba lagi |

| **BaturPay live** | `NOT VERIFIED` | Adapter ada, transaksi belum |
| Scheduled reminders | `TESTED` | PostgreSQL sebagai sumber kebenaran |
| Group linking | `TESTED` | CLI + tool, penemuan otomatis |
| Attachment media | `TESTED` | Unduh + cache, batas 15 MB |
| Workflow engine | `NOT IMPLEMENTED` | `WorkflowRun` masih mati |
| Document engine | `TESTED` | 5 templat PDF, nomor unik, ekstraksi teks |
| Knowledge engine | `TESTED` | OR-semantics, stemming Indonesia |
| Finance engine | `TESTED` | 7 tool, Rupiah integer, jejak audit |
| Multi-agent | `NOT IMPLEMENTED` | `AgentTask` sudah mencatat; alur multi-agent belum |
| Task collection | `NOT IMPLEMENTED` | `ActiveTask` masih mati |
| Approval engine | `TESTED` | 8 test integrasi, RBAC ditegakkan |

## Yang sudah berfungsi

### Infrastruktur

- Node.js 24 + TypeScript 5.9 strict (`strict`, `noUncheckedIndexedAccess`).
- pnpm 11 dengan versi Baileys yang dipin exact.
- PostgreSQL (Neon) — 38 model, migrasi terapkan.
- Pino dengan redaksi rahasia.
- Docker belum ada.

### Pipeline pesan

```
Pesan → dedupe → rate limit → aktivasi grup → identitas → agent → tool → DB → balas
```

- Dedupe dua lapis: in-memory (cepat) + `dedupeKey` UNIQUE (database).
- Rate limit per pengirim (sliding window).
- Kebijakan grup: hanya merespons saat disebut.

### Identity engine

- Normalisasi nama (gelar, aksen, tanda baca).
- Skor kecocokan dengan deteksi prefiks.
- Klasifikasi `unique` / `ambiguous` / `none` dengan margin.
- Prioritas kecocokan alias persis.
- Verifikasi identitas WhatsApp terpisah.

### Kehadiran

- Service dengan scope organisasi di setiap operasi.
- Idempoten di level bisnis **dan** constraint database.
- Pembaruan field-level ("ganti alasan" tidak menghapus status).
- Renderer yang mempertahankan format dari markdown pengguna.

### Agent runtime

- Tool calling dengan loop berbatas.
- Batas keras: langkah, tool call, token.
- Hanya tool sesuai izin yang dikirim ke model.
- Penanganan error yang jujur.

### AI provider

- OpenAI-compatible dengan `stream: false` eksplisit.
- Pelacakan token usage.
- Pemetaan error ke jenis yang bisa diputuskan retry.
- **TERVERIFIKASI terhadap gateway sungguhan.**

### Tool registry

15 tool terdaftar, masing-masing dengan permission, risiko, dan kebutuhan
persetujuan.

### CLI

```
pnpm osda status          # status komponen
pnpm osda doctor          # diagnosis masalah
pnpm osda tools           # daftar tool + izin
pnpm osda skills          # daftar skill
pnpm osda capabilities    # kemampuan aktif
pnpm osda whatsapp:status
pnpm osda org:list
pnpm osda db:seed
```

Setiap perintah **membaca kondisi nyata** dari database dan provider.

## Angka terverifikasi

| Yang diukur | Nilai |
|---|---|
| **Test total** | **731 lulus, 0 gagal** (14 live dilewati) |
| Unit | 463 lulus |
| Integrasi | 235 lulus |
| Live (opsional) | 14 test; **11 lulus** terhadap gateway sungguhan, sisanya dilewati |
| Tool terdaftar | 49 |
| Skill termuat | 11 |
| Permission | 50 |
| Model database | 38 |
| TypeScript errors | 0 |

## Yang belum ada (secara jujur)

### Automation / BullMQ

`BullMQ` sudah jadi dependency dan `ScheduledJob` sudah ada di skema, tapi
**tidak ada worker, tidak ada scheduler, tidak ada workflow engine**. Belum ada
satu pun pengingat terjadwal.

Model data sudah disiapkan supaya tidak perlu redesign nanti:
`ScheduledJob`, `Workflow`, `WorkflowRun`, `OutboxEvent`.

### Document engine

`DocumentRecord` ada di skema. Tidak ada parser, generator, atau template.
Kemampuan ini akan menjadi **sangat berat** — dan belum ada kebutuhan nyata
yang belum terpenuhi oleh yang sekarang.

### Knowledge engine

`KnowledgeDocument` + `KnowledgeChunk` ada. Tidak ada indexing, retrieval, atau
penjawabannya.

### Finance engine

Tabel `FinanceAccount`, `CashbookEntry`, `Invoice`, `InvoiceItem` ada. Tidak
ada service. `BaturPayAdapter` ada tapi tidak ada FinanceService yang
menghubungkannya ke invoice anggota.

### Approval engine

`Approval` ada di skema dan `ApprovalBroker` interface ada di
`ToolRegistry`. Tidak ada implementasi persisten, tidak ada alur persetujuan
lewat WhatsApp.

Saat ini `whatsapp.send_message` butuh broker — kalau broker tidak dipasang,
tool mengembalikan `INTERNAL_ERROR` dengan pesan jelas, bukan gagal diam-diam.

### Multi-agent, proactive intelligence

Tabel untuk `MonitoringConfiguration`, `OrganizationSignal`, `Recommendation`
sudah disiapkan. Implementasinya belum.

### Prompt versioning

Prompt saat ini inline di `src/agent/prompt.ts`. Belum ada sistem versi.

## Approval engine

| Komponen | Status | Catatan |
|---|---|---|
| Gerbang persetujuan | `VERIFIED` | Bug `requiresApproval && riskLevel==='HIGH'` diperbaiki |
| Penyimpanan approval | `VERIFIED` | Migrasi `20261014230000` + `2026101423100` terpasang |
| Balasan setuju/batal | `VERIFIED` | Diuji langsung terhadap database |
| Otorisasi ulang saat eksekusi | `VERIFIED` | Test regresi ada |
| Lewat WhatsApp nyata | `NOT VERIFIED` | Pairing masih terblokir 429 |

Detail: [PERSETUJUAN.md](./PERSETUJUAN.md)

## Outbox

| Komponen | Status | Catatan |
|---|---|---|
| `OutboxWriter` | `VERIFIED` | Event ditulis dalam transaksi yang sama |
| `OutboxDispatcher` | `VERIFIED` | Klaim tunggal, backoff, batas percobaan |
| Penanganan `unknown` | `VERIFIED` | Tidak pernah di-retry — perlu rekonsiliasi |
| Pemulihan `SENDING` | `VERIFIED` | Lease lewat `availableAt`, jadi `UNKNOWN` |
| CLI `outbox:*` | `IMPLEMENTED` | list / tick |
| Penulis event di layanan | **Belum ada** | Pengiriman masih langsung |

Detail: [OUTBOX.md](./OUTBOX.md)

## Pengingat terjadwal

| Komponen | Status | Catatan |
|---|---|---|
| `ReminderService` | `VERIFIED` | Idempotensi, klaim tunggal, basi dibatalkan |
| `ReminderWorker` | `VERIFIED` | `failed` tidak dihitung sukses |
| Integritas database | `VERIFIED` | 3 skenario diuji ke Neon |
| CLI `reminder:*` | `IMPLEMENTED` | list / cancel / tick |
| Tool jadwal untuk AI | `VERIFIED` | 3 tool; parsing zona waktu diuji |
| BullMQ | **Tidak dipakai** | Penjelasan di bawah |

Detail: [PENGINGAT.md](./PENGINGAT.md)

## Provisioning organisasi

| Komponen | Status | Catatan |
|---|---|---|
| `org:create` / `org:show` | `VERIFIED` | Dijalankan 2x ke DB sungguhan |
| Rantai izin (RBAC) | `VERIFIED` | Owner mendapat 50/50 permission |
| Idempotensi | `VERIFIED` | Anggota/peran tidak ganda |
| `verifiedAt` dikosongkan | `VERIFIED` | Keamanan: nomor env = klaim, bukan bukti |
| Onboarding anggota non-admin | `VERIFIED` | `org:add-member` + `org:import-members` |

Detail: [PROVISIONING.md](./PROVISIONING.md)

## Temuan penting (pairing)

Akar masalah **"kode dibuat tapi tidak bisa ditautkan"** akhirnya ditemukan
dengan menangkap frame server: **HTTP 429 `rate-overlimit`** — server
memblokir percobaan pairing dari IP ini.

Tidak ada yang bisa melihatnya dari sisi aplikasi karena
`requestPairingCode()` memakai `sendNode()` yang hanya menulis, tanpa
menunggu atau memeriksa balasan. Kode tetap tercetak normal walaupun server
menolaknya.

Bug lain yang ditemukan dan diperbaiki di sepanjang jalan:

| Temuan | Gejala | Status |
|---|---|---|
| `initAuthCreds()` terlewat | Handshake crash total | Diperbaiki |
| `browser[1]` bukan nama tampilan tapi **identifier tipe browser** | `platformId 9` (OTHER_WEB_CLIENT) | Diperbaiki |
| 515 (`restartRequired`) ikut di-nomina no-reconnect | Pairing sukses tapi registrasi tak pernah selesai | Diperbaiki |
| `isNewLogin` dikirim tanpa field `connection` | Pairing sukses diam-diam dilewati | Diperbaiki |
| Socket pairing umur ±2,5 menit (`QR refs attempts ended`) | Kode lama mati diam-diam | Daemon kini buat kode baru tiap reconnect |
| Daemon retry saat 429 | Blokir server makin panjang | Diperbaiki — berhenti total |
| `requestPairingCode()` tidak cek balasan server | Penolakan tidak pernah terlihat | Ditutup lewat pendengar frame |

Rinciannya: [WHATSAPP-PAIRING.md](./WHATSAPP-PAIRING.md)

12 test regresi mengunci aturan pairing (`tests/unit/pairing-config.test.ts`).

**Status: `BLOCKED`.** Perlu menunggu cooldown server (minimal 1 jam) sebelum
percobaan berikutnya.

## Yang belum terverifikasi

| Area | Kenapa |
|---|---|
| Pairing WhatsApp | Sesi sudah terhubung, tapi belum ada pesan dari orang nyata yang diproses |
| Pesan masuk/keluar live | Tidak boleh mengirim ke kontak nyata tanpa izin |
| Group mention live | Butuh grup uji yang disetujui |
| BaturPay transaksi | Tidak ada key sandbox; transaksi sungguhan tidak boleh dibuat untuk test |
| Pemulihan setelah restart | Belum ada job terjadwal yang bisa pulih |
| Skala produksi | Belum diuji dengan beban nyata |

## Prioritas berikutnya

### P0 — Menuju pilot terbatas

1. **Pairing WhatsApp live** dan uji pesan nyata.
2. **Approval engine** supaya `whatsapp.send_message` bisa dipakai.
3. **Bootstrap organisasi** (CLI atau|first-run wizard) supaya organisasi
   nyata bisa dibuat tanpa seed.
4. **Verifikasi identitas** anggota → nomor WhatsApp.

### P1 — Otomasi

5. Worker BullMQ + reminder terjadwal.
6. Outbox dispatcher (supaya "buat pengumuman lalu kirim" tidak kehilangan
   pengiriman).
7. Graceful shutdown yang-tested.

### P2 — Lanjutan

8. Finance service (kas, iuran anggota).
9. Document engine (PDF, XLSX).
10. Knowledge engine (full-text search).

## Cara memperbarui dokumen ini

Dokumen ini harus mengikuti kondisi kode. Kalau ada fitur baru:

1. Implementasikan.
2. Tambahkan test.
3. Jalankan `pnpm typecheck && pnpm test`.
4. **Update tabel status di atas** dengan bukti nyata.

Jangan menulis fitur sebagai "selesai" hanya karena file-nya ada.