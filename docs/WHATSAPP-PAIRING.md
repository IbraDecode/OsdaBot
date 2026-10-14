# Pairing WhatsApp — Riset & Akar Masalah

Dokumen ini menjelaskan kenapa "kode pairing berhasil dibuat tapi tidak bisa
ditautkan" — symptom yang sangat umum dan hampir selalu disalahdiagnosis.

Semua temuan di sini diverifikasi dari source Baileys 7.0.0-rc14 dan GitHub
issues, bukan dari dokumentasi (yang sebagian sudah usang).

---

## 1. Gejala

```
pnpm osda:pair --code

  Nomor bot : 6285177653481
  Kode      : K98KH14T
```

Kode **keluar normal**. Tapi ketika dimasukkan di WhatsApp:

- Kode ditolak sebagai tidak valid / tidak cocok, **atau**
- Tidak ada notifikasi di WhatsApp, **atau**
- Kode masuk tapi sambungan tidak pernah selesai.

Semua ini adalah symptom yang **sama**, dengan beberapa penyebab berbeda.

---

## 2. Akar masalah #1 — `companion_platform_id` salah

### Fakta dari source

`requestPairingCode()` mengirim dua hal terkait browser:

```ts
content: getCompanionPlatformId(browser),
// dan
content: `${browser[1]} (${browser[0]})`,   // companion_platform_display
```

Dan `getCompanionPlatformId()` memanggil:

```ts
// lib/Utils/companion-reg-client-utils.js
const BROWSER_TO_COMPANION_WEB_CLIENT = {
    Chrome: 1, Edge: 2, Firefox: 3, IE: 4, Opera: 5, Safari: 6
};

export const getCompanionWebClientType = ([os, browserName]) => {
    if (browserName === 'Desktop') { ... }
    return BROWSER_TO_COMPANION_WEB_CLIENT[browserName] || OTHER_WEB_CLIENT  // 9
};
```

**Pencocokan itu EKSAK dan TIDAK ADA normalisasi.** `browser[1]` bukan nama
tampilan — itu identifier tipe browser yang divalidasi server.

### Bukti kegagalan

Konfigurasi yang dipakai sebelumnya:

```ts
browser: Browsers.ubuntu('OSDABOT')
// → ['Ubuntu', 'OSDABOT', '22.04.4']
```

| Elemen | Nilai | Divalidasi? |
|---|---|---|
| `browser[0]` | `Ubuntu` | Tidak dipakai untuk platform id |
| `browser[1]` | `OSDABOT` | ✗ Tidak ada di peta → `OTHER_WEB_CLIENT` |
| `browser[2]` | `22.04.4` | Tidak dipakai |

Hasil: server menerima `companion_platform_id = 9` (OTHER_WEB_CLIENT) dan
membalas **`400 bad-request`**.

Konfigurasi yang benar:

```ts
browser: ['Ubuntu', 'Chrome', '22.04.4']
// → platform id = 1 (CHROME)
```

### Verifikasi langsung

```
config                    tuple                            platformId
─────────────────────────────────────────────────────────────────────────
SAYA (sebelumnya)         ["Ubuntu","OSDABOT","22.04.4"]   9  ← ditolak
Known-works (issue #1761) ["Ubuntu","Chrome","20.0.04"]    1  ← diterima
```

### Konfirmasi dari komunitas

| Issue | Temuan |
|---|---|
| [#1266](https://github.com/WhiskeySockets/Baileys/issues/1266) | "When I define `browser` in `makeWASocket`, the code doesn't connect. Baileys does generate a CODE, but the standard WhatsApp notification does not arrive." |
| [#1761](https://github.com/WhiskeySockets/Baileys/issues/1761) | Log pelapor menunjukkan `"code":"400","text":"bad-request"`. Diselesaikan dengan `browser: ["Ubuntu", "Chrome", "20.0.04"]` — dikonfirmasi 2 pelapor independen. |

Log pelapor #1761:

```json
{"frame":{"tag":"iq","attrs":{"from":"@s.whatsapp.net","type":"error"},
  "content":[{"tag":"error","attrs":{"code":"400","text":"bad-request"}}]}}
```

### Perbaikan di OSDABOT

```ts
export function companionBrowserIdentity(): [string, string, string] {
  return ['Ubuntu', 'Chrome', '22.04.4']
}

export const RECOGNIZED_BROWSER_NAMES = ['Chrome', 'Edge', 'Firefox', 'IE', 'Opera', 'Safari'] as const
```

`Ubuntu` + `Chrome` dipilih karena kombinasi itu satu-satunya yang terkonfirmasi
berhasil oleh beberapa pelapor independen, termasuk di dalam Docker.

### Nama bot di tempat lain

Nama "Osda" tetap dipakai untuk `WHATSAPP_BOT_NAME` (pemicu di grup). Yang
tidak boleh dipakai adalah `browser[1]` — itu slot tipe browser.

---

## 3. Akar masalah #2 — 515 (restartRequired) di-nomina

### Fakta dari source

Setelah pairing berhasil, Baileys menerima `CB:iq,,pair-success`:

```js
ws.on('CB:iq,,pair-success', async (stanza) => {
    // ...
    const { reply, creds: updatedCreds } = configureSuccessfulPairing(stanza, creds);
    ev.emit('creds.update', updatedCreds);
    ev.emit('connection.update', { isNewLogin: true, qr: undefined });
    await sendNode(reply);
});
```

Komentar di source: *"if device pairs successfully, the server asks to restart
the connection"*.

Artinya: setelah pairing sukses, server menutup socket dengan **515
(restartRequired)** dan **meminta** supaya klien tersambung ulang untuk
menyelesaikan registrasi.

### Bug sebelumnya

```ts
const NO_RECONNECT = new Set<number>([
  ...UNAUTHORIZED_CODES,                              // 401, 403, 419
  DisconnectReason.multideviceMismatch,              // 411
  DisconnectReason.connectionReplaced,               // 440
  DisconnectReason.restartRequired,                   // 515  ← SALAH
  405, 463,
])
```

515 di-nomina sebagai "jangan reconnect" → socket berhenti permanen → registrasi
tidak pernah diselesaikan → **pairing menggantung**.

### Perbaikan

515 **dihapus** dari daftar. 515 berarti "restart", bukan "logout". Reconnect justru yang diminta server.

Perbedaan penting:

| Kode | Arti | Reconnect? |
|---|---|---|
| 401 `loggedOut` | Pengguna logout dari HP | ✗ |
| 403 `forbidden` | Akun diblokir | ✗ |
| 419 | Unauthorized | ✗ |
| 411 `multideviceMismatch` | Perlu unlink di HP | ✗ |
| 440 `connectionReplaced` | Device lain pakai session ini | ✗ |
| **515 `restartRequired`** | **Server minta restart** | **✓** |
| 405 | Throttling pairing | ✗ (risiko ban) |
| 463 | Reachout timelock | ✗ (risiko ban) |

---

## 4. Akar masalah #3 — `isNewLogin` dilewati

### Fakta dari source

```js
ev.emit('connection.update', { isNewLogin: true, qr: undefined });
```

Perhatikan: **tidak ada field `connection`**. Handler lama hanya bercabang pada
`connection`:

```ts
// SEBELUMNYA — isNewLogin tidak pernah masuk cabang mana pun
if (qr) { ... }
if (connection === 'connecting') { ... }
if (connection === 'open') { ... }
if (connection === 'close') { ... }
// isNewLogin? fell through — diam-diam
```

Akibatnya Pairing sukses **tidak pernah dilaporkan** ke status, dan tidak ada
berlog bahwa registrasi sedang diselesaikan.

### Perbaikan

```ts
if (isNewLogin) {
  this.reconnectAttempts = 0
  this.setStatus('reconnecting', this.status.phoneNumber,
    'pairing berhasil, menyelesaikan registrasi')
  log.info('pairing berhasil — menunggu koneksi ulang untuk menyelesaikan registrasi')
  return
}
```

---

## 5. Akar masalah #4 — `initAuthCreds()` terlewat

Gejala:

```
TypeError: Cannot read properties of undefined (reading 'public')
  at processHandshake (lib/Utils/noise-handler.ts:225)
```

Penyebab: `loadSession()` mengembalikan `{}` kalau `creds.json` belum ada:

```ts
// SEBELUMNYA — SALAH
creds: creds ?? ({} as AuthenticationCreds)
```

Baileys butuh `noiseKey`, `signedIdentityKey`, `signedPreKey`,
`advSecretKey`. `useMultiFileAuthState` melakukan ini diam-diam
(`?? initAuthCreds()`) — store kustom kita melewatkannya.

```ts
// SESUDAH
creds: creds ?? initAuthCreds(),
```

Ironis: store ini justru ditulis karena `useMultiFileAuthState` tidak
dipercaya (menelan error saat file korup), lalu tepercaya-kan lagi tanpa init.

---

## 6. Gejala yang mirip tapi beda penyebab

| Gejala | Penyebab | Solusi |
|---|---|---|
| Kode ditolak saat dimasukkan | `browser[1]` salah | `['Ubuntu', 'Chrome', ...]` |
| Kode masuk tapi tidak selesai | 515 tidak di-reconnect | Hapus 515 dari NO_RECONNECT |
| Tidak ada apa-apa terjadi | `isNewLogin` dilewati | Handle `isNewLogin` |
| Gagal sebelum QR tampil | `initAuthCreds()` terlewat | Pakai `initAuthCreds()` |
| "Connection Closed" | Socket belum siap | Tunggu QR + retry |
| Kode valid tapi tidak ada notifikasi | Perlu cek manual di HP | Buka Perangkat Tertaut → Tautkan Perangkat secara manual |

---

## 7. Catatan penting soal pairing code

- **Satu perangkat per nomor.** Pairing code hanya bisa dipakai sekali.
- **Harus manual di HP.** Server tidak mengirim push notification untuk pairing
  code (berbeda dengan flow resmi). Pengguna harus membuka WhatsApp →
  Perangkat Tertaut → Tautkan Perangkat → "Tautkan dengan nomor telepon".
- **Masa berlaku** tidak diatur di sisi Baileys. Invalidasi datang dari server
  dan tidak terdokumentasi. Jangan mengklaim "kedaluwarsa 60 detik".

---

## 8. Pencegahan regresi

`tests/unit/pairing-config.test.ts` (12 test) mengunci ketiga aturan:

- `platformIdOf(companionBrowserIdentity()) === CHROME` (bukan OTHER_WEB_CLIENT)
- `Browsers.ubuntu('OSDABOT')` menghasilkan OTHER_WEB_CLIENT (regresi terdeteksi)
- Semua `RECOGNIZED_BROWSER_NAMES` lolos; nama sembarang tidak
- `shouldReconnect(515) === true`
- Kode logout/forbidden/419/411/440/405/463 tetap `false`

Kalau suatu saat Baileys mengubah pemetaan browser atau daftar
`DisconnectReason`, test ini gagal — bukan diam-diam merusak pairing lagi.