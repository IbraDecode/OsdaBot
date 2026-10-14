# Agent Runtime

## Pipeline

```
Terima pesan
  → Normalisasi (whatsapp/jid.ts)
  → Dedupe & rate limit & aktivasi grup (pipeline/message-pipeline.ts)
  → Resolusi identitas & organisasi (identity/resolver.ts)
  → Muat riwayat percakapan
  → Pilih skill relevan (skills/registry.ts)
  → Susun system prompt
  → Panggil model (agent/llm/)
  → Validasi tool call
  → Otorisasi (ToolRegistry)
  → Jalankan tool
  → Verifikasi hasil
  → Balas ke WhatsApp
```

Pemisahan penalaran dan eksekusi itu disengaja: model berpikir, backend bekerja.

## Batas keras

Tanpa batas ini, satu pesan bisa jadi loop tak berujung dan menghabiskan token.

| Batas | Default | Env |
|---|---|---|
| Putaran agent | 8 | `AGENT_MAX_STEPS` |
| Total tool call | 12 | `AGENT_MAX_TOOL_CALLS` |
| Pesan dalam konteks | 20 | `AGENT_MAX_CONTEXT_MESSAGES` |
| Output token | 2048 | `AI_MAX_OUTPUT_TOKENS` |

### Perilaku saat batas tercapai

- Tool call melebihi batas → `RATE_LIMITED` dikirim balik ke model supaya ia
  tahu harus berhenti.
- Langkah habis tanpa jawaban final → respons jujur:
  *"Ini sudah cukup panjang untuk satu pesan. Ada sebagian yang belum selesai —
  bilang 'lanjut yang tadi' untuk dilanjutkan."*

Batas tidak_resources_names[@tool_call_id] diproses sebagai kegagalan — yang
penting eksekusi berhenti.

## Tool calling

### Yang dikirim ke model

Hanya tool yang **terdaftar DAN seluruh permission-nya dimiliki aktor**:

```typescript
const schemas = await tools.schemasFor(context)
```

Ini menghemat token dan mencegah model "mengingat" kemampuan yang tidak boleh
ia pakai. Actor tanpa izin apa pun menerima `tools: undefined`.

### Tool call yang rusak

Argument dari model adalah **input tak dipercaya**:

```typescript
{
  id: 'call_1',
  name: 'attendance.update',
  arguments: {},                    // sudah di-parse JSON
  parseError: 'Argumen tool bukan JSON yang valid.'
}
```

Kalau `parseError` terisi, tool **tidak dijalankan** — registry langsung
menolak dengan pesan jelas.

### Hasil tool dikirim balik

```typescript
// sukses
{ ok: true, data: { ... } }

// gagal — HANYA kode + pesan aman, tanpa stack trace
{ ok: false, error: { code: 'NOT_FOUND', message: 'Entri tidak ada di daftar ini.' } }
```

Stack trace tidak pernah sampai ke model, supaya tidak bocor ke pengguna lewat
respons.

## System prompt

`buildSystemPrompt()` menyusun dari bagian:

| Bagian | Isi |
|---|---|
| Identitas | Nama bot, tugas |
| Konteks | Tanggal, zona waktu, grup/pribadi, organisasi, nama pengguna |
| Peran | Bukan customer service; extension cara berpikir pemilik |
| Safety | 7 aturan yang tidak bisa dilanggar |
| Tool usage | Kapan pakai tool, kapan tidak |
| Context | Cara memahami percakapan |
| Formatting | Aturan WhatsApp |
| Personality | Gaya bahasa |
| Kemampuan | Daftar tool yang tersedia untuk aktor ini |

### Prinsip gaya yang dipakai

Dari `IBRA_AI.md` yang diekstrak jadi perilaku:

- Pahami konteks dulu, baru bertindak.
- Bahasa Indonesia natural. English hanya kalau lebih natural.
- Panjang jawaban mengikuti kebutuhan, bukan template.
- Jangan buka dengan basa-basi, jangan tutup dengan tawaran.
- Kalau ide pengguna kurang bagus, bilang terus terang.
- Koreksi = informasi baru soal target.

Yang **tidak** dipakai: peniruan typo, pemaksaan slang, pemaksaan emoji,
pemaksaan huruf kecil. Style tidak boleh mengalahkan kebenaran.

### Aturan safety yang paling penting

```
1. Tidak mengklaim sesuatu sudah dilakukan tanpa hasil tool yang mendukung.
2. Tidak mengubah data yang tidak diminta — field lain tetap.
3. Tidak menebak nama orang. Kalau ambigu, tanya.
4. Tidak membuat data yang tidak ada (anggota fiktif, tanggal kegiatan).
5. Klaim "sudah bayar" bukan bukti pembayaran.
6. Penolakan karena izin bukan error — sampaikan natural.
7. Admin grup WhatsApp ≠ admin organisasi.
```

## AI Provider

### Kenapa `stream: false` eksplisit

Diverifikasi langsung ke gateway yang dipakai:

```
POST /v1/chat/completions
→ tanpa "stream": false  → SSE (data: {...}) walau tidak diminta
→ dengan "stream": false → JSON biasa, tool_calls utuh
```

Kalau `stream` tidak dikirim eksplisit, respons jadi tidak bisa di-parse dan
tool call hilang. `openai-compatible.ts` mengirimkannya selalu.

### Model alias vs model asli

`AI_MODEL=ibrax` adalah **alias**. Server me-resolve ke model aslinya dan
mengembalikannya di `response.model`. Yang dicatat untuk audit adalah nilai
yang dikembalikan server, bukan alias yang diketik.

### Penanganan error

| Jenis | Retryable | Respons ke pengguna |
|---|---|---|
| `rate_limited` | ya | "Lagi ada banyak permintaan ke AI sekarang." |
| `timeout` | ya | "AI-nya kelamaan menjawab." |
| `auth` | tidak | "Konfigurasi AI provider bermasalah." |
| `network` | ya | "Tidak bisa menghubungi AI provider sekarang." |
| `server_error` | ya | "AI provider sedang bermasalah." |

Detail teknis (HTTP status, pesan mentah) hanya masuk log, tidak ke pengguna.

### Retry

`maxRetries: 0` di SDK — retry dikelola agent supaya **bisa dihitung dan
dibatasi**, bukan terjadi diam-diam di dalam library.

## Handling kegagalan

### Respons kosong

Kalau model mengembalikan teks kosong tanpa tool call:

> "Aku belum bisa memproses itu. Coba ulangi dengan kalimat yang lebih jelas."

Lebih jujur daripada mengirim pesan kosong ke WhatsApp.

### Langkah habis

> "Ini sudah cukup panjang untuk satu pesan. Ada sebagian yang belum selesai —
> bilang 'lanjut yang tadi' untuk dilanjutkan."

### Tool gagal

Model menerima kode + pesan aman, lalu menyusun respons natural. Kalau tool
gagal karena permission, pengguna melihat penjelasan yang wajar — bukan error
sistem mentah.

## Yang sudah diverifikasi

`tests/live/ai-provider.live.test.ts` diuji terhadap provider NYATA:

| Uji | Hasil |
|---|---|
| Provider bisa dihubungi | ✅ |
| Menjawab bahasa Indonesia | ✅ |
| **Memilih tool yang benar** untuk "ubah Danya jadi izin karena ada meeting" | ✅ `attendance.update`, `status=EXCUSED`, `reason` berisi "meeting" |

Dua tool sengaja dibuat mirip supaya model tidak bisa asal memilih yang
pertama.

Jalankan:

```bash
RUN_LIVE_TESTS=true pnpm exec vitest run tests/live
```