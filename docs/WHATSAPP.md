# Integrasi WhatsApp (Baileys)

## Versi: 7.0.0-rc14 (pin exact)

Repo memakai `@whiskeysockets/baileys` **versi 7.0.0-rc14**, bukan `^7`.

### Alasan memilih v7

v6.7.24 **tidak punya API LID sama sekali**. Diverifikasi dengan menelusuri
seluruh source v6: `getLIDForPN`, `lidMapping`, `LIDMapping`, `getPNForLID`
→ nol hasil. Di v6 satu-satunya jalan adalah membaca pasif
`key.participantPn`.

WhatsApp sekarang memakai LID (`@lid`) untuk privasi. Tanpa dukungan LID,
OSDABOT tidak bisa mengidentifikasi pengirim di grup yang menyembunyikan nomor.

### Risiko v7 dan mitigasinya

| Risiko | Mitigasi |
|---|---|
| RC bisa berubah | Versi **dipin exact**, bukan `^7` atau `~7` |
| API surface masih bergerak | Semua pemakaian API ada di `baileys-provider.ts`; perubahan tidak menyebar |
| Dokumentasi wiki sebagian salah | Implementasi diverifikasi dari source, bukan dari docs |

### Fakta API v7 yang dipakai (diverifikasi dari source)

| Fakta | Konsekuensi di kode |
|---|---|
| `printQRInTerminal` **sudah dihapus** | QR diambil dari event `connection.update` → `{ qr }` |
| `DisconnectReason` hanya 10 nilai | `shouldReconnect()` memakai whitelist, bukan daftar lengkap |
| 408 dipakai dua kali (`timedOut` & `connectionLost`) | Keduanya diperlakukan sama |
| `UNAUTHORIZED_CODES = [401, 403, 419]` | 419 **tidak ada** di enum, jadi ditulis eksplisit |
| `GroupParticipant` runtime: `{ id, phoneNumber?, lid?, username?, admin }` | `isAdmin`/`isSuperAdmin` **tidak diisi** runtime → pakai `admin === 'admin'` |
| `messages.upsert` bertipe `'notify' \| 'append'` | `append` = offline sync → tidak diproses |
| `end()` menghapus semua listener & destroy emitter | Socket yang sudah close **mati permanen** → harus buat instance baru |
| Reaksi lewat `sendMessage(jid, { react })` | Tidak ada fungsi `sendReaction` |

## LID vs PN

Dua jenis identitas pesan yang aktif bersamaan:

```
6281234567890@s.whatsapp.net   ← PN (nomor telepon)
123456789012345@lid             ← LID (ID numerik, nomor bisa disembunyikan)
```

Baileys mengisi field `*Alt` dengan JID **lawan** yang bisa ditampilkan:

| Situasi | Field yang berisi nomor asli |
|---|---|
| Chat pribadi | `key.remoteJidAlt` |
| Grup | `key.participantAlt` |

`resolveSenderJid()` memakai urutan: `*Alt` dulu → cek PN → fallback.

**Aturan:** nomor telepon **tidak boleh diasumsikan selalu tersedia.** Kalau
kontak tidak pernah menukar nomor, JID hanya bisa LID dan nomor asli tidak
diketahui sama sekali. Karena itu `WhatsAppIdentity` menyimpan PN dan LID
sebagai kolom terpisah, dan `getPhoneNumber()` mengembalikan `null` untuk LID.

## Session

### Kenapa tidak `useMultiFileAuthState` untuk produksi

Komentar resmi Baileys sendiri:

> "I wouldn't endorse this for any production level use other than perhaps a
> bot. Would recommend writing an auth state for use with a proper SQL or No-SQL DB"

Masalah nyata yang ditemukan:

| Masalah | Dampak |
|---|---|
| `readData` me-return `null` saat file korup (bukan error) | Sesi hilang **senyap** (isu #794) |
| Satu file per key | Ribuan inode |
| Tidak ada atomic write | File setengah tertulis kalau server mati mendadak |

### `FileSignalKeyStore` (milik OSDABOT)

| Properti | Implementasi |
|---|---|
| Izin file | `0600` untuk file, `0700` untuk folder |
| Atomic write | tulis `.tmp` → `rename()` |
| Corrupt file | **Lempar error**, bukan `null` |
| Serialisasi | `BufferJSON` dari Baileys (`Uint8Array` rusak kalau `JSON.stringify` biasa) |
| Key baru v7 | `lid-mapping`, `device-list`, `tctoken`, `identity-key` didukung |

### Konfigurasi socket yang WAJIB

```typescript
{
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, log),  // tanpa cache = ribuan I/O
  },
  markOnlineOnConnect: false,   // bot 24/7 shouldn't steal phone's push
  syncFullHistory: false,       // bot tidak butuh riwayat lama
  getMessage: async () => undefined,   // WAJIB: retry & poll vote butuh ini
  cachedGroupMetadata: async (jid) => groupCache.get(jid),  // WAJIB: tanpa ini → 428
  msgRetryCounterCache,         // WAJIB: HARUS di luar socket
  maxMsgRetryCount: 3,          // 5 bawa risiko ban
  retryRequestDelayMs: 1500,    // 250ms terlalu agresif untuk bot ramai
}
```

**`msgRetryCounterCache` harus di luar socket.** Kalau di dalam, setiap restart
socket membuat loop decrypt/enkripsi ulang (sesuai catatan di example resmi).

## Kebijakan reconnect

Kode yang **tidak boleh** di-reconnect:

| Kode | Arti |
|---|---|
| 401, 403, 419 | Sesi tidak sah / akun diblokir |
| 411 | Multidevice mismatch — perlu unlink di HP |
| 440 | Session dipakai device lain |
| 515 | Restart required |
| 405 | Throttling server saat pairing |
| 463 | Reachout timelock — **risiko ban** |

Kode yang **tidak dikenal** tetap dicoba reconnect — gangguan sesaat normal.
Yang dinominasi hanya kode yang berarti "percobaan ulang memperburuk keadaan".

Backoff eksponensial dengan jitter penuh, maksimum 20 percobaan, lalu berhenti
dan menunggu intervensi manual.

## Rate limit & risiko ban

WhatsApp menerapkan limit ketat untuk pesan proaktif. Yang dilakukan OSDABOT:

- `markOnlineOnConnect: false`
- `maxMsgRetryCount: 3` (bukan 5)
- Tidak pernah mengirim pesan massal tanpa persetujuan
- Rate limit per pengirim di `MessagePipeline`
- Status `unknown` direkonsiliasi, bukan langsung retry

## Kegagalan yang sudah ditangani

| Gejala | Needle | Mitigasi |
|---|---|---|
| 428 saat kirim ke grup | `groupMetadata()` tiap kirim | `cachedGroupMetadata` |
| 401 loop, session rusak | Reconnect tanpa filter 401 | `shouldReconnect()` whitelist |
| Pesan tidak sampai setelah decrypt gagal | `getMessage` undefined | Implementasi `getMessage` |
| Socket tidak merespons | Event loop terblokir `decryptWithSessions` | Batas 3 retry, monitor log |
| Pengiriman ganda | Retry tanpa status | `MessageDelivery` + status `unknown` |

## Yang belum terverifikasi

- **Belum ada pairing live.** Kredensial WhatsApp tidak tersedia di lingkungan
  build.
- **Belum ada pengiriman pesan live.** Semua test memakai provider tiruan.
- Batas ukuran media tidak di-hardcode (WhatsApp mengirimkannya via query).
- Masa berlaku pairing code tidak diverifikasi dari source — tidak ada timer di
  sisi Baileys.

Semua test otomatis memakai `FakeWhatsAppProvider`. Tidak ada pesan WhatsApp
sungguhan yang terkirim saat test berjalan.

## Menjalankan

```bash
# Pairing lewat QR — jalankan aplikasi, pindai dari WhatsApp
pnpm start

# Pairing dengan kode (nomor harus milik Anda sendiri / sudah diizinkan)
WHATSAPP_OWNER_PHONE=6281234567890 pnpm start
```

Pemeriksaan:

```bash
pnpm osda whatsapp:status
pnpm osda whatsapp:files     # lihat isi folder session
```