# Pairing WhatsApp — Akar Masalah "Kode Dibuat Tapi Tidak Bisa Ditautkan

Dokumen ini merekam hasil diagnosa bertahap terhadap gejala: kode pairing
berhasil dicetak, tapi tidak pernah berhasil dipakai.

**Jawaban akhirnya: server memblokir percobaan pairing dengan HTTP 429
`rate-overlimit`.** Bukan bug kode, bukan format nomor, bukan cara Anda
meng	input kode.

Semua temuan di sini diverifikasi dari sumber Baileys 7.0.0-rc14 dan dari
frame server yang ditangkap langsung.

---

## 1. Gejala

```
pnpm osda:pair --code

  Nomor bot : 6285177653481
  Kode      : A7JB8Z7L
```

Kode keluar normal. Tapi ketika dimasukkan di WhatsApp: tidak ada respons apa
pun. Tidak ada error, tidak ada notifikasi, tidak ada apa-apa.

---

## 2. Kenapa diagnosis biasa gagal

### 2.1 `requestPairingCode()` tidak pernah memeriksa jawaban server

```js
const requestPairingCode = async (phoneNumber, customPairingCode) => {
    const pairingCode = customPairingCode ?? bytesToCrockford(randomBytes(5))
    ...
    await sendNode({ tag: 'iq', ... })   // ← hanya menulis
    return pairingCode                    // ← selalu dianggap "berhasil"
}
```

`sendNode()` menulis ke WebSocket dan **tidak menunggu balasan**. Bandingkan
dengan `query()` di socket yang sama, yang memakai `waitForMessage()` lalu
`assertNodeErrorFree()`.

Jadi node `<iq type="error">` dari server **tidak pernah dicek**. Kode tetap
tercetak normal walaupun server sudah menolaknya, dan tidak ada satu baris pun
yang mengatakannya.

**Konsekuensi:** tidak ada cara melihat penolakan kecuali memasang
listener sendiri di `ws.on('frame', …)`.

### 2.2 Socket pairing punya umur terbatas

Server hanya mengirim sejumlah kecil "pairing ref". Baileys menghabiskannya
satu per satu setiap rotasi QR:

```js
const genPairQR = () => {
    if (!ws.isOpen) return
    const refNode = refNodes.shift()
    if (!refNode) {
        void end(new Boom('QR refs attempts ended', { statusCode: 408 }))
        return
    }
    ...
    qrTimer = setTimeout(genPairQR, qrMs)
    qrMs = qrTimeout || 20000   // QR pertama 60 detik, berikutnya 20
}
```

Terukur di server ini: socket bertahan **162 detik** dari koneksi sampai
`QR refs attempts ended` (60 + 5 × 20).

Artinya: kode pairing punya jendela sekitar 2,5 menit. Setelah itu socket
mati dan kode yang sudah dicetak tidak berlaku lagi.

---

## 3. Bukti penolakan

Pendengar frame yang dipasang di `pair-daemon.ts`:

```
── [SERVER] ──
  <iq from='@s.whatsapp.net' type='error' id='15932.41095-1'>
        <error code='429' text='rate-overlimit'/>
  </iq>
── [SERVER] ──
  <iq from='@s.whatsapp.net' type='error' id='15932.41095-2'>
        <error code='429' text='rate-overlimit'/>
  </iq>
```

**`429 rate-overlimit`.** Server WhatsApp sedang memblokir percobaan pairing
dari IP ini.

Karena itu kode yang dicetak tetap "berhasil" secara lokal, tapi mustahil
dipakai — permintaan pairing-nya memang ditolak di sisi server.

---

## 3b. Bug kedua yang sama: guard rate limit tidak pernah aktif

Yang pertama adalah `requestPairingCode()` yang tidak memeriksa balasan. Yang
kedua lebih halus: **daemon sudah punya guard 429, tapi regex-nya salah.**

```
Versi lama:  /code="(\d{3})"/
Format asli: <error code='429' text='rate-overlimit'/>
                          ^^^^^^ kutip TUNGGAL
```

`binaryNodeToString` mencetak atribut dengan kutip tunggal. Regex kutip ganda
tidak pernah cocok, jadi:

- `state.rateLimited` tidak pernah menjadi `true`
- Daemon terus meminta kode baru
- Setiap percobaan **memperpanjang** blokir

Terbukti di server ini. Setelah guard diperbaiki:

| | Sebelum | Sesudah |
|---|---|---|
| Proses daemon | masih hidup | berhenti |
| `attempts` | 2 (terus mencoba) | 1 |
| `phase` | `waiting_scan` | `rate_limited` |

### Perbaikan

Logika pembacaan frame dipindah ke `src/cli/pair-frames.ts` supaya bisa
diuji tanpa menjalankan socket sungguhan.

Yang mengunci:

- `parseErrorCode()` membaca kutip tunggal **dan** ganda.
- Test memverifikasi format terhadap `binaryNodeToString` Baileys **sungguhan**,
  bukan tebakan dokumentasi.
- `isRateLimited()` hanya true untuk `429` — acknowledgement
  `companion_hello` tidak boleh salah dikira penolakan.

Diverifikasi: mengembalikan regex ke versi lama membuat **4 test gagal**.

### Pelajaran

Test yang menyalin logika ke dalam file test menguji **salinan**, bukan kode
yang jalan. Versi pertama test ini justru menyalin `parseErrorCode` ke dalam
test — dan tidak akan pernah menangkap bug ini. Modulnya harus diekstrak.

---

## 4. Riwayat diagnosis yang salah (dicatat supaya tidak diulang)

| Dugaan | Kenyataan |
|---|---|
| Format nomor salah | Nomor lolos validasi, dan `companion_hello` diterima server |
| `browser[1]` = `OSDABOT` ditolak dengan `400 bad-request` | **Ragu.** Dulu `platformId` memang `9`, tapi setelah diubah ke `Chrome` (`1`) server tetap memblokir — dengan `429`, bukan `400`. Perbaikan ini mungkin memang perlu, tapi **bukan penyebab gejala ini** |
| 515 (`restartRequired`) tidak di-reconnect | Perbaikan masuk akal secara protokol, tapi tidak menjelaskan gejala di sini |
| Kode `initAuthCreds()` terlewat | **Benar.** Handshake memang crash total tanpa itu. Bug nyata, tapi sudah diperbaiki lebih dulu |
| Kode mati karena proses dibunuh `timeout` | **Benar sebagai contributing factor**, tapi bukan akar masalah |

Pelajaran: tanpa menangkap frame server, semua ini hanya tebakan yang
terlihat meyakinkan.

---

## 5. Perbaikan yang diterapkan

### 5.1 Daemon pairing persisten

Kode hanya hidup selama socket-nya hidup. Kalau proses berhenti, socket
tertutup, dan kode mati tanpa penjelasan.

Daemon (`src/cli/pair-daemon.ts`) karena itu:

1. Tetap hidup sampai pairing benar-benar berhasil.
2. Meminta kode BARU setiap reconnect — kode lama mati bersama socket lama.
3. Menulis kode terbaru ke `.pairing-state.json` (tulis atomik via `rename`).
4. Menangkap dan mencetak frame server yang relevan, termasuk `<error>`.
5. **Berhenti total saat kena 429** — retry hanya memperpanjang blokir.

### 5.2 Perintah pendukung

```bash
nohup pnpm osda:pair:daemon > pairing.log 2>&1 &   # daemon
pnpm osda:pair:code     # baca kode terbaru + status
pnpm osda:pair:debug    # tangkap frame server
```

Kode keluar `3` bila kena rate limit; `pnpm osda:pair:code` menjelaskannya.

---

## 6. Cara yang benar memakai pairing

```
1.  nohup pnpm osda:pair:daemon > pairing.log 2>&1 &
2.  pnpm osda:pair:code            # catat kode 8 karakter
3.  WhatsApp nomor bot
      Perangkat Tertaut -> Tautkan Perangkat
      -> "Tautkan dengan nomor telepon" -> masukkan kode
4.  pnpm start                     # setelah tertaut
```

Aturan yang tidak boleh dilanggar:

- **Satu proses pairing saja.** Dua proses berebut dan saling membatalkan.
- **Jangan jalankan pairing code dan QR bersamaan.**
- **Jangan ulangi terlalu cepat.** Itu penyebab langsung dari 429.
- Kode berupa **8 karakter huruf + angka** (`A7JB8Z7L`). Bukan 18 digit, bukan
  nomor HP, dan tidak ada hubungannya dengan QR.

---

## 7. Kalau masih kena 429

1. **Cek `pnpm osda:pair:code` lebih dulu.** Kalau sudah keluar dari
   `rate_limited`, jangan jalankan apa pun — pemeriksaannya sudah menyentuh
   server.
2. Berhenti total. Jangan jalankan apa pun yang menyentuh pairing.
3. Tunggu minimal 1 jam; beberapa jam lebih aman.
4. Pastikan tidak ada proses pairing lain yang masih hidup:

   ```bash
   ps -eo pid,args | grep src/cli/pair
   ```

5. Setelah cooldown, jalankan **satu** daemon dan langsung masukkan kodenya.

Kalau setelah cooldown masih `429`, penyebabnya bukan frekuensi — periksa
apakah ada proses lain di server atau jaringan yang ikut memakai pairing.

---

## 8. Prasyarat yang tidak bisa diverifikasi dari server

Nomor bot `6285177653481` harus punya WhatsApp terpasang dan aktif. Kalau belum
pernah pakai WhatsApp, pairing tidak akan pernah berhasil dan tidak ada kode
server yang bisa membenarkannya.