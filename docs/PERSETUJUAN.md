# Persetujuan (Approval Engine)

Mekanisme ini menentukan apakah tindakan berisiko boleh jalan. Semua tool yang
bertanda `requiresApproval` **wajib** lewat sini sebelum dieksekusi.

---

## 1. Alur

```
Agent memanggil tool
        │
        ▼
  Registry: izin dicek        ← RBAC lebih dulu
        │
        ▼
  Registry: requiresApproval?  ← gerbang INI
        │  tidak
        └───────────────► eksekusi langsung
        │  ya
        ▼
  ApprovalEngine.request()
    • simpan Approval (payload, hash, chatJid, pemohon)
    • kirim pratinjau ke WhatsApp
        │
        ▼
  tool TIDAK dieksekusi — balasan "menunggu persetujuan"
        │
        │  ...pengguna membalas...
        ▼
  tryHandleReply() dipanggil sebelum agent berjalan
        │
        ├─ bukan pemohon        → tolak
        ├─ chat berbeda         → tolak
        ├─ payload berubah      → batalkan
        ├─ sudah expires        → tolak
        ├─ sudah pernah dijalankan → tolak
        │
        ▼
  Executor.executeApproved()
    • otorisasi DIULANG
    • jalankan tool dengan payload dari database
        │
        ▼
  executedAt diisi — pagar idempotensi
```

---

## 2. Gerbang di registry

```ts
if (tool.requiresApproval) {
  const broker = this.deps.approvals
  if (!broker) {
    // TOLAK, jangan lewati.
    return fail('INTERNAL_ERROR', 'Mekanisme persetujuan belum siap.')
  }
  const verdict = await broker.request({ ... })
}
```

### Bug yang pernah ada di sini

Versi lama berbunyi:

```ts
if (tool.requiresApproval && tool.riskLevel === 'HIGH')
```

Padahal `whatsapp.send_message` menandai `requiresApproval: true` dengan
`riskLevel: 'MEDIUM'`. Persyaratannya **tidak pernah terpenuhi**, jadi
persetujuan tidak pernah diminta untuk tool yang paling butuh persetujuan —
pesan yang terkirim tidak bisa ditarik kembali.

Test regresinya ada di `tests/unit/approval-gate.test.ts`. Sudah diverifikasi:
mengembalikan gerbang ke versi lama membuat **4 test gagal**.

---

## 3. Garis keamanan

| Aturan | Kenapa | Diuji oleh |
|---|---|---|
| Hanya **pemohon** yang bisa menyetujui | Di grup siapa pun bisa mengetik. Tanpa ini, anggota biasa menyetujui tindakan operator | `approvals.test.ts` |
| Hanya dari **chat asal** | Permintaan dikirim ke chat tertentu; balasan dari chat lain diabaikan | `approvals.test.ts` |
| Persetujuan **terikat payload** | Kalau isi berubah, persetujuan BATAL. Tanpa ini "kirim ringkasan" bisa dipakai mengirim semua data | `approvals.test.ts` |
| **Satu persetujuan = satu eksekusi** | `updateMany` bersyarat `PENDING` + pagar `executedAt` | `approvals.test.ts`, `approval-executor.test.ts` |
| **Otorisasi diulang saat eksekusi** | Peran bisa dicabut setelah persetujuan diberikan. Persetujuan lama bukan bukti izin masih ada | `approval-executor.test.ts` |
| Konteks dari **baris database** | `organizationId` dan `actorUserId` diambil dari `Approval`, bukan dari argumen percakapan | `approval-executor.test.ts` |
| Broker kosong = **tolak** | Bukan lewati | `approval-gate.test.ts` |

---

## 4. Parser niat

`src/approvals/intent.ts` memutuskan apakah sebuah pesan adalah balasan
persetujuan.

**Default-nya `none`.** Salah membaca "iya" dari percakapan biasa sebagai
persetujuan berarti menjalankan tindakan tanpa persetujuan — kegagalan
keamanan, bukan bug UX.

Aturan ketatnya:

1. Pesan lebih dari 40 karakter **selalu** `none` — itu percakapan biasa.
2. Harus **persis cocok** dengan daftar, bukan `includes`.
3. Emoji dan tanda baca dibuang, huruf kecil.

Contoh yang **tidak** dihitung sebagai persetujuan:

| Teks | Hasil |
|---|---|
| `iya` | `approve` |
| `iya coba dong` | `none` |
| `iyausername` | `none` |
| `oktober` | `none` |
| `stopped` | `none` |
| `tidak boleh kirim ke grup` | `none` |
| `iya ` × 30 | `none` |

`none` berarti pesan diteruskan ke agent yang punya konteks penuh. Parser
tidak menebak.

---

## 5. Hash payload

```ts
hashPayload({ to: '628@s.whatsapp.net', text: 'halo' })
hashPayload({ text: 'halo', to: '628@s.whatsapp.net' })   // sama
```

Kunci diurutkan rekursif sebelum di-hash. Tanpa itu, `JSON.stringify`
menghasilkan urutan berbeda hanya karena urutan kunci — dan validasi
`payloadHash` akan menolak persetujuan yang sah.

Perbedaan tipe tetap menghasilkan hash berbeda: `{ n: 1 }` ≠ `{ n: '1' }`.

---

## 6. Yang disimpan

| Kolom | Isi |
|---|---|
| `payload` | JSON payload asli — supaya bisa dieksekusi |
| `payloadHash` | SHA-256 kanonik — mendeteksi perubahan isi |
| `payloadPreview` | Pratinjau untuk dibaca pengguna |
| `chatJid` | Chat asal — balasan hanya sah dari sini |
| `correlationId` | Mengaitkan ke satu putaran percakapan |
| `requestedBy` | Pemohon — hanya dia yang boleh menyetujui |
| `executedAt` | Pagar idempotensi |

`payload` dan `executedAt` ditambahkan lewat migrasi `20261014230000` dan
`20261014231000`. Tanpa `payload`, persetujuan jadi tidak berguna: tidak ada
yang bisa dieksekusi.

---

## 7. Masa berlaku

Default **15 menit** (`APPROVAL_TTL_MS`). Setelah itu `expireStale()` menandai
`EXPIRED` setiap menit. Expired tetap terbaca untuk audit, tapi tidak lagi bisa
disetujui.

---

## 8. Verifikasi end-to-end

`tests/integration/approval-flow.test.ts` (8 test) menguji jalur yang
sebenarnya dilewati pengguna, bukan hanya mesinnya:

- Tool yang butuh persetujuan **tidak jalan** sebelum disetujui — pesan
  asli tidak pernah terkirim ke penerima.
- `"iya"` dari pemohon → approve → pesan terkirim → status `APPROVED`.
- `"iya"` dari **orang lain** → reject, pesan tidak terkirim.
- `"iya"` dari **chat lain** → reject.
- `"iya"` **diulang** → hanya dieksekusi sekali.
- `"batal"` → `REJECTED`, tidak eksekusi.
- Kalimat panjang berisi kata persetujuan → diteruskan ke agent.
- Penolakan tercatat di `AuditLog` dengan `APPROVAL_PENDING`.

### Satu kegagalan yang perlu dicatat

Versi pertama test ini memakai UUID aktor fiktif, dan **lima dari delapan test
gagal**. Bukan karena logikanya salah, tapi karena RBAC menolak di lapisan izin
**sebelum** lapisan persetujuan — jadi tidak ada yang pernah sampai ke alur
yang mau diuji.

Uji jalur yang benar butuh aktor yang benar-benar punya izin. Pelajaran: saat
menguji lapisan keamanan, lapisan yang lebih luar bisa menutupi lapisan yang
sedang diuji.

---

## 9. Batasan saat ini

- **Belum bisa diuji end-to-end di WhatsApp nyata** — pairing WhatsApp masih
  terblokir `429 rate-overlimit`. Alur sudah terverifikasi langsung terhadap
  database sungguhan (permintaan → simpan → jawab → approve, dan penolakan
  dari orang yang salah), tapi belum melalui WhatsApp.
- **Tidak ada daftar approval yang bisa dilihat pengguna.** Kalau ada 3
  permintaan menunggu, "iya" akan menjawab yang terbaru. Perintah pembatalan
  semua sudah ada (`batal semua`).
- **Belum ada persetujuan bertingkat** (misal dua orang harus setuju).
- Executor baru berguna untuk tool yang tidak butuh konteks percakapan.
  Tool yang butuh `conversationId` akan mendapat `null` — perlu diperiksa
  sebelum dipakai untuk tool seperti itu.