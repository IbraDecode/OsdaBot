# Arsitektur OSDABOT

## Prinsip utama

> **OSDABOT adalah AI Agent dengan penalaran fleksibel, eksekusi terstruktur,
> data terverifikasi, otorisasi eksplisit, dan kemampuan berkembang terkendali.**

Lima kata itu bukan hiasan. Setiap satu punya konsekuensi teknis yang nyata di
kode:

| Prinsip | Wujud di kode |
|---|---|
| Penalaran fleksibel | AI memahami bahasa alami, memilih tool sendiri |
| Eksekusi terstruktur | Semua tindakan lewat `ToolRegistry`, bukan eksekusi bebas |
| Data terverifikasi | Tool mengembalikan data nyata; agent tidak mengarang |
| Otorisasi eksplisit | `AuthorizationService` + permission granular, dicek backend |
| Berkembang terkendali | Skill bisa ditambah, tapi tidak bisa memberi izin sendiri |

## Bentuk sistem

```
                    WHATSAPP
                        │
          ┌─────────────┴─────────────┐
          │                           │
     CHAT PRIVAT                 CHAT GRUP
          │                           │
          └─────────────┬─────────────┘
                        │
                        ▼
               WHATSAPP GATEWAY                    src/whatsapp/
            (Baileys + normalisasi)                baileys-provider.ts
                        │
                        ▼
                MESSAGE PIPELINE                   src/pipeline/
        (dedupe · rate limit · aktivasi grup)     message-pipeline.ts
                        │
                        ▼
               IDENTITY ENGINE                     src/identity/
           (siapa pengirim, organisasi mana)       resolver.ts
                        │
                        ▼
               AGENT RUNTIME                       src/agent/
   ┌───────────────────────────────────────┐      runtime.ts
   │  System prompt (gaya + aturan aman)   │
   │  Konteks percakapan                  │
   │  Skill yang relevan                  │
   │  Tool yang SESUAI IZIN aktor          │
   └───────────────────────────────────────┘
                        │
                        ▼
                TOOL REGISTRY                     src/tools/
     validasi → otorisasi → approval → eksekusi   registry.ts
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
   ORGANIZATION      ATTENDANCE     WHATSAPP
   SERVICE           SERVICE        PROVIDER
         │              │              │
         └──────────────┼──────────────┘
                        │
                        ▼
                   POSTGRESQL
```

## Modular monolith, bukan microservices

**Keputusan:** satu proses backend, satu database, modul terpisah secara kode.

**Alasan:**
- Tidak ada latency jaringan antar modul.
- Transaksi lintas modul (mis. buat anggota + tambah ke daftar hadir) bisa satu
  transaksi database.
- Deployment, log, dan debug jauh lebih sederhana.
- Skala organisasi sekolah/LKBB tidak memerlukan microservices.

**Batas antar modul** dijaga lewat arah import. Modul bawah tidak boleh tahu
modul atas:

```
whatsapp  ← tidak tahu agent
security  ← tidak tahu agent
identity  ← tidak tahu agent, whatsapp (hanya jid.ts)
attendance← tidak tahu agent, tools
tools     ← tahu security, services
agent     ← tahu tools, skills, llm
pipeline  ← tahu agent, identity, skills
bootstrap ← tahu semuanya (composition root)
```

Kalau sebuah modul butuh masuk ke area modul lain, itu sinyal arsitektur yang
perlu diperiksa ulang — bukan sekadar tambah `import`.

## Batas yang dijaga ketat

### 1. AI tidak pernah menjadi sumber kebenaran

Model AI menghasilkan **permintaan**, bukan keputusan. Semua permintaan
melewati `ToolRegistry` yang memeriksa:

```
tool terdaftar? → input valid? → aktor terautentikasi? → permission cukup?
→ scope organisasi valid? → perlu persetujuan? → baru eksekusi
```

Kalau salah satu gagal, operasi **tidak dijalankan**. Ini diuji di
`tests/unit/security.test.ts` — termasuk kasus "AI meminta tool berbahaya,
backend menolak, fungsi tool tidak pernah dipanggil".

### 2. Data dan presentasi terpisah

`AttendanceEntry` adalah data. `renderAttendanceList()` adalah tampilan.
Mengubah format TIDAK boleh mengubah data; mengubah data WAJIB lewat service
dengan otorisasi.

### 3. Identitas eksternal ≠ identitas internal

- Identitas internal = UUID di PostgreSQL.
- Identitas WhatsApp = PN JID (`628123@s.whatsapp.net`) atau LID
  (`123456@lid`) — keduanya **identitas eksternal** yang bisa berubah.
- organisasi tidak pernah dikaitkan ke nomor telepon.

Lihat [IDENTITAS.md](./IDENTITAS.md).

### 4. Pengiriman tidak pernah diklaim "selesai" tanpa bukti

Status pengiriman WhatsApp punya tingkatan:

| Status | Arti |
|---|---|
| `provider_accepted` | WhatsApp MENERIMA permintaan kirim |
| `delivered` | Dikonfirmasi sampai |
| `unknown` | **Tidak diketahui** — timeout lalu proses mati |

`unknown` wajib direkonsiliasi sebelum retry, supaya tidak terkirim dua kali.
OSDABOT tidak pernah bilang "sudah dibaca" — itu informasi yang tidak dimiliki.

## Kontrak inti

### NormalizedMessage

Bentuk tunggal yang dilihat pipeline setelah pesan dari WhatsApp dinormalisasi.
Library WhatsApp tidak boleh bocor ke modul lain.

### AgentRequest / AgentResponse

```typescript
interface AgentRequest {
  correlationId: string
  actorUserId: string | null       // dari IdentityEngine
  organizationId: string | null   // dari resolusi organisasi
  conversationId: string | null
  chatJid: string
  senderJid: string
  isGroup: boolean
  timezone: string
  organizationName: string | null
  memberName: string | null
  text: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  capabilities: Array<{ name: string; description: string }>
}
```

`actorUserId` dan `organizationId` **tidak pernah** berasal dari argumen model
AI. Keduanya berasal dari backend yang sudah memverifikasi.

## Ringkasan modul

| Modul | Tanggung jawab | Status |
|---|---|---|
| `config/` | Validasi env, fail-fast saat boot | Selesai |
| `observability/` | Log terstruktur + redaksi rahasia | Selesai |
| `database/` | Klien Prisma, seed data fiktif | Selesai |
| `whatsapp/` | Adapter Baileys, JID/LID, session store | Selesai (belum diuji live) |
| `identity/` | Resolusi identitas & nama, deteksi ambiguitas | Selesai |
| `security/` | Katalog permission, RBAC, otorisasi | Selesai |
| `attendance/` | Service kehadiran + renderer format | Selesai |
| `tools/` | Registry + tool organisasi/kehadiran/WhatsApp | Selesai (15 tool) |
| `skills/` | Loader & validasi SKILL.md | Selesai (3 skill) |
| `agent/` | LLM adapter, prompt, runtime | Selesai (teruji live) |
| `pipeline/` | Dedupe, rate limit, aktivasi, handler | Selesai |
| `payments/` | Adapter BaturPay + verifikasi webhook | Selesai (belum live) |
| `automation/` | BullMQ worker, reminder terjadwal | **Belum ada** |
| `documents/` | Pembuatan & parsing dokumen | **Belum ada** |
| `knowledge/` | Pencarian pengetahuan organisasi | **Belum ada** |
| `finance/` | Buku kas, invoice | **Belum ada** |

Lihat [STATUS-IMPLEMENTASI.md](./STATUS-IMPLEMENTASI.md) untuk rinciannya.