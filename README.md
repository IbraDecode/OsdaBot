# OSDABOT

**Platform AI Agent WhatsApp-native untuk membantu organisasi.**

OSDABOT berjalan di WhatsApp, memahami bahasa Indonesia sehari-hari, mengelola
data organisasi, dan menjalankan tindakan nyata — dengan izin yang jelas,
data yang terverifikasi, dan jejak audit.

```bash
pnpm install && cp .env.example .env
pnpm db:migrate && pnpm db:seed && pnpm dev
```

## Status Singkat

| | |
|---|---|
| Test | **724 lulus, 0 gagal** (14 live dilewati) |
| Tool | 15 |
| Skill | 3 |
| Permission | 50 |
| Model database | 38 |
| TypeScript errors | 0 |

Dokumentasi lengkap: [docs/README-INDEX.md](./docs/README-INDEX.md)

## Prinsip

> OSDABOT adalah AI Agent dengan penalaran fleksibel, eksekusi terstruktur,
> data terverifikasi, otorisasi eksplisit, dan kemampuan berkembang terkendali.

| Prinsip | Wujud di kode |
|---|---|
| Penalaran fleksibel | AI memahami bahasa alami, memilih tool sendiri |
| Eksekusi terstruktur | Semua tindakan lewat Tool Registry |
| Data terverifikasi | Tool mengembalikan bukti, agent tidak mengarang |
| Otorisasi eksplisit | 50 permission granular, dicek backend |
| Berkembang terkendali | Skill bisa ditambah, tak bisa memberi izin sendiri |

Yang **tidak** jadiֵ tujuan: menambah banyak command. Kemampuan baru dibangun
dari kombinasi **Skill + Tool + Permission + Test**.

## Struktur

```
src/
├── config/         Validasi environment (fail-fast)
├── observability/  Log terstruktur + redaksi rahasia
├── database/       Klien Prisma + seed data fiktif
├── whatsapp/       Adapter Baileys, JID/LID, session store
├── identity/       Identity Engine, normalisasi nama
├── security/       Permission, RBAC, AuthorizationService
├── attendance/     Attendance service + renderer format
├── tools/          Tool Registry + definisi tool
├── skills/         Loader & validasi SKILL.md
├── agent/          LLM adapter, system prompt, runtime
├── pipeline/       Dedupe, rate limit, aktivasi grup, handler
├── payments/       Adapter BaturPay + verifikasi webhook
└── cli/            Perintah operasional

skills/             Kemampuan berbasis Markdown
docs/               Dokumentasi berbahasa Indonesia
tests/
├── unit/           Fungsi murni (456 test)
├── integration/    Modul nyata + PostgreSQL (35 test)
└── live/           Provider sungguhan (10 test)
```

## Contoh interaksi

```
osda buatin daftar hadir lkbb besok
        ↓ attendance.create + attendance.add_member
*LIST YANG HADIR LKBB*

1. Danya Sefti Cahyani (X AKL 3)

*IZIN*
-

osda tambahin Danya Putri
        ↓ organization.search_members → attendance.add_member

osda ubah Danya Sefti jadi izin karena ada meeting
        ↓ organization.search_members → attendance.update
*LIST YANG HADIR LKBB*

*IZIN*
Danya Sefti Cahyani (X AKL 3) — meeting

osda alasannya ganti jadi ada urusan mendadak
        ↓ attendance.update (HANYA field reason)
*LIST YANG HADIR LKBB*

*IZIN*
Danya Sefti Cahyani (X AKL 3) — ada urusan mendadak
```

Yang dijaga: nama & kelas anggota lain tidak berubah, penomoran diperbarui,
format WhatsApp tetap, dan setiap perubahan tersimpan di database.

Kalau ada dua anggota dengan nama panggilan sama, OSDABOT **bertanya** — tidak
menebak:

```
osda ubah Dany jadi izin
        ↓ organization.search_members → ambiguous

Aku nemu dua anggota yang cocok:
1. Danya Putri Rahma — X MPK 1
2. Dava Pratama — X RPL 1

Yang mana ya?
```

## Yang sudah berfungsi

- **Pipeline** — dedupe dua lapis, rate limit, kebijakan grup
- **Identity Engine** — normalisasi nama, deteksi ambiguitas, verifikasi
- **Attendance** — service ber-scope, idempoten, pelestarian format
- **Agent Runtime** — tool calling dengan batas keras
- **Tool Registry** — 49 tool dengan permission & risiko
- **Skills** — 11 skill dari loader Markdown dengan validasi
- **AI Provider** — terverifikasi terhadap gateway sungguhan
- **CLI** — 34 perintah operasional yang membaca data nyata
- **BaturPay adapter** — signature HMAC, idempotensi, anti webhook dobel
- **Documents** — 5 templat PDF, nomor dokumen unik per organisasi
- **Knowledge** — pencarian OR dengan stemming Bahasa Indonesia
- **Finance** — kas, kasbon, tagihan; Rupiah integer, tanpa float
- **Approvals** — persetujuan lintas chat dengan jejak audit
- **Tugas** — penugasan, tenggat, dependensi; siklus ditolak
- **Mode aman** — tombol darurat; bertahan melewati restart
- **Rekaman agent** — langkah, tool, alasan berhenti; bisa ditanyakan
- **Retensi data** — daftar putih; data bisnis mustahil tersentuh
- **Monitoring** — pola lintas-peristiwa; saran dibedakan dari fakta
- **Uji smoke live** — 11 skenario lewat gateway sungguhan, bukan tiruan
- **Grup WhatsApp** — tautan per grup, penemuan otomatis saat boot
- **Lampiran** — unduh media, batas 15 MB

Rinciannya: [docs/STATUS-IMPLEMENTASI.md](./docs/STATUS-IMPLEMENTASI.md)

## Yang belum ada

Disebutkan terbuka supaya tidak ada kejutan:

- **Workflow engine** — `WorkflowRun` masih kosong; alur kerja otomatis belum ada
- **Multi-agent** — `AgentTask` masih kosong; satu pesan diproses sekali jalan
- **Penyusunan kebutuhan lewat chat** — `ActiveTask` masih kosong
- **Monitoring** — tidak ada deteksi percakapan yang memburuk
- **Rotasi kredensial `.env`** — belum dilakukan; **wajib sebelum repo publik**

Rinciannya: [docs/AUDIT.md](./docs/AUDIT.md)

## Yang belum terverifikasi

- **Pairing WhatsApp live** — sesi terhubung, tapi belum ada pesan dari orang
  nyata yang diproses
- **Pengiriman pesan live** — semua test memakai provider tiruan
- **BaturPay live** — logika terverifikasi dari dokumentasi resmi, transaksi
  belum

Tidak ada pengujian otomatis yang mengirim pesan WhatsApp sungguhan.

**Yang sudah terverifikasi:**

- Loop agent penuh — skill → pemilihan tool → eksekusi → balasan — terhadap AI
  gateway sungguhan, 11 skenario. [docs/UJI-SMOKE.md](./docs/UJI-SMOKE.md)
- **Percakapan WhatsApp sungguhan end-to-end**: pesan nyata → agent →
  `payment_create_charge` → persetujuan → charge BaturPay dengan QRIS
  tercatat di PostgreSQL.

## Teknologi

| Komponen | Versi |
|---|---|
| Runtime | Node.js 24 |
| Bahasa | TypeScript 5.9 (strict) |
| Package manager | pnpm 11 |
| WhatsApp | `@whiskeysockets/baileys` 7.0.0-rc14 (dipin exact) |
| Database | PostgreSQL + Prisma 6 |
| Validasi | Zod 3 |
| AI | OpenAI-compatible (endpoint bisa dikonfigurasi) |
| HTTP | Fastify 5 |
| Log | Pino 9 |
| Test | Vitest 3 |

### Kenapa Baileys 7 dan bukan 6?

v6.7.24 **tidak punya API LID sama sekali**. WhatsApp sekarang memakai
LID (`@lid`) untuk privasi. Tanpa dukungan LID, OSDABOT tidak bisa
mengidentifikasi pengirim di grup yang menyembunyikan nomor.

Rinciannya: [docs/WHATSAPP.md](./docs/WHATSAPP.md)

## Keamanan

- **Default-deny.** Permission yang tidak ada = tidak boleh.
- **Scope organisasi.** Semua query diskop; `organizationId` tidak pernah dari
  argumen AI.
- **Klaim identitas bukan bukti.** Hanya link terverifikasi yang dipakai untuk
  mention.
- **Admin grup ≠ admin organisasi.**
- **Prompt injection** — dokumen & pesan adalah data, bukan instruksi.
- **Audit trail** — tindakan penting tercatat.
- **Redaksi log** — di level logger, bukan di pemanggil.

Detail: [docs/KEAMANAN.md](./docs/KEAMANAN.md)

## Kontribusi

```bash
pnpm typecheck     # harus 0 error
pnpm test          # harus semua lulus
```

Aturan yang tidak bisa dilanggar:

1. Jangan menulis kode yang melewati permission.
2. Jangan menambahkan tool tanpa permission & test.
3. Jangan mengubah schema tanpa migrasi.
4. Jangan menaruh rahasia di source.
5. Jangan mengklaim fitur selesai tanpa bukti.
6. Jangan pakai float untuk uang.
7. Jangan menaruh data pribadi nyata di seed.

Rinciannya: [AGENTS.md](./AGENTS.md)

## Pairing WhatsApp

```bash
pnpm osda:pair --code   # pairing code (disarankan di server)
pnpm osda:pair          # QR (pindai dari HP)
pnpm start              # jalankan bot
```

Dua nomor punya peran berbeda dan **wajib berbeda**:

| Variabel | Arti |
|---|---|
| `WHATSAPP_LINK_PHONE` | Nomor akun **BOT** yang ditautkan ke Baileys |
| `WHATSAPP_ADMIN_PHONE` | Nomor **pemilik** — tidak pernah dikirim ke WhatsApp |

Riset lengkap kenapa "kode ditolak": [docs/WHATSAPP-PAIRING.md](./docs/WHATSAPP-PAIRING.md)
Detail operasional: [docs/WHATSAPP-OPS.md](./docs/WHATSAPP-OPS.md)

## Perintah

```bash
pnpm dev              # pengembangan
pnpm build            # build produksi
pnpm start            # jalankan produksi
pnpm test             # test otomatis
pnpm typecheck        # cek tipe

pnpm osda status      # status komponen
pnpm osda doctor      # diagnosis
pnpm osda tools       # daftar tool
pnpm osda skills      # daftar skill
pnpm osda:pair        # pairing WhatsApp
```

## Lisensi

Private. Dibuat untuk kebutuhan organisasi.