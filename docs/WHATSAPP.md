# Bot WhatsApp

Acuan kode: `apps/bot/src/` (paket `@osda/bot`).

Bot WhatsApp adalah **client ringan**. Ia tidak punya tabel sendiri, tidak punya
database, dan tidak pernah memutuskan izin. Seluruh logika bisnis berjalan di
OSDA API. Bot hanya:

1. menerima pesan via Baileys,
2. menerjemahkan JID/LID menjadi identitas anggota **lewat API**,
3. memanggil endpoint `/api/v1/*`,
4. membalas dengan template teks.

---

## 1. Arsitektur Bot

```
WhatsApp (grup/chat pribadi)
        │
        ▼
┌─────────────────────────────┐
│ whatsapp/baileys.ts         │  koneksi Baileys (@whiskeysockets/baileys 7.0.0-rc14)
│ whatsapp/account.ts         │  normalisasi pesan → PesanMasuk {chatJid, pengirimJid, lid, nomor, teks}
│ whatsapp/lidMapping.ts      │  pemetaan LID ↔ nomor
│ whatsapp/mention.ts         │  penyusunan mention
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ services/identity-resolver.ts │  JID + LID + nomor → member + peran + izin (lewat API)
│ services/gerbang-pengurus.ts  │  gerbang izin untuk perintah pengurus
│ services/profil.ts             │  cache profil
│ services/templates.ts          │  template balasan
│ services/whatsapp-notifier.ts  │  pengirim pesan keluar
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ router.ts                   │  pencocokan perintah
│ commands/*.ts               │  pelaksana perintah
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ api/client.ts               │  fetch ke OSDA API (JALUR.*)
└─────────────────────────────┘
```

Alur lengkap seperti didokumentasikan di `apps/bot/src/router.ts`:

```
WhatsApp (Baileys) → Message Adapter (whatsapp/account.ts)
  → Identity Resolver (services/identity-resolver.ts)
  → Command Router (router.ts)
  → OSDA API (api/client.ts) → Domain → Database
  → Response (services/templates.ts → WhatsApp)
```

---

## 2. Resolver Identitas

`apps/bot/src/services/identity-resolver.ts` adalah bagian paling penting untuk
keamanan. Aturannya:

- Bot mengirim `jid`, `lid`, `nomor`, dan `namaTampilan` ke
  `POST /identity/whatsapp/resolve` pada OSDA API.
- **Bila JID belum dikenal**, bot menerima HTTP 404 dan memperlakukannya sebagai
  "belum terdaftar": balasan berisi instruksi pendaftaran/penautan akun.
- **Bot tidak menebak identitas dari nama yang diketik.** Ini dinyatakan eksplisit di
  komentar berkas.
- Hasil resolusi di-cache **5 menit** (TTL 300 detik), maksimal 1000 entri, dengan
  pengusiran entri tertua.
- Respons API dibersihkan lewat `amankanHasil()`: nilai yang bentuknya tidak sesuai
  dibuang, bukan dipercaya.
- Kegagalan jaringan/token tidak pernah melempar galat ke router; bot membalas tenang.

### Izin pengurus

`adalahPengurus(identitas)` mengembalikan `true` bila identitas memiliki **salah satu**
dari daftar `IZIN_PENGURUS`, yaitu:

```
attendance.manage, attendance.write, member.write, member.archive,
meeting.create, meeting.manage, meeting.minutes.approve,
program.create, program.manage, program.approve,
task.write, task.verify,
finance.write, finance.approve, finance.export,
communication.create, communication.publish,
document.create, document.approve,
report.read, report.export, approval.decide,
settings.manage, period.manage
```

Catatan penting: `member.read`, `attendance.read`, `task.read`, `program.read`,
`event.read`, `document.read`, `finance.read`, `notification.read`, `approval.read`
**tidak** ada di daftar itu — mereka tetap anggota biasa.

### Gerbang pengurus

`services/gerbang-pengurus.ts` menyediakan dua helper:

- `pastikanAnggota(pesan)` — menjamin pengirim adalah anggota terdaftar.
- `lewatiGerbangPengurus(pesan, izin, handler)` — menjalankan handler hanya bila
  identitas memiliki izin tersebut; bila tidak, bot membalas pesan penolakan.

Dengan begitu pemeriksaan izin tetap **satu sumber**: API. Bot hanya membuka/menutup
menu berdasarkan hasil izin.

---

## 3. Perintah Anggota (tanpa garis miring)

Didefinisikan di `router.ts`:

| Perintah | handler | Keterangan |
|---|---|---|
| `DAFTAR …` | `commands/member.ts::tanganiDaftar` | Pendaftaran anggota baru + penautan JID. |
| `HADIR` | `commands/attendance.ts::tanganiAbsen` | Mencatat `PRESENT` pada sesi yang sedang terbuka hari itu. |
| `IZIN <alasan>` | `commands/attendance.ts::tanganiAbsen` | Mencatat `EXCUSED`. Alasan minimal 3 karakter. |
| `SAKIT <alasan>` | `commands/attendance.ts::tanganiAbsen` | Mencatat `SICK`. Alasan minimal 3 karakter. |
| `STATUS` | `commands/attendance.ts::tanganiStatus` | Status absensi anggota hari ini. |
| `AGENDA` | `commands/informasi.ts::tanganiAgenda` | Agenda rapat terdekat. |
| `TUGAS` | `commands/informasi.ts::tanganiTugasSaya` | Daftar tugas milik anggota. |
| `KAS` atau `KAS STATUS` | `commands/kas.ts::tanganiKasAnggota` | Saldo organisasi + tunggakan pribadi. |
| `PROFIL` | `commands/member.ts::tanganiProfil` | Profil anggota. |
| `BANTUAN`, `HELP`, `MENU` | `commands/informasi.ts::tanganiBantuan` | Daftar bantuan. |

### Format HADIR / IZIN / SAKIT

```
HADIR
IZIN mengantar orang tua berobat
SAKIT demam sejak kemarin
```

`bacakanMaksudAbsen()` membaca pola `^(HADIR|IZIN|SAKIT)\b\s*(.*)$` **tanpa peduli
besar-kecil huruf** (regex memakai flag `i`), tetapi `tampakSepertiPerintah()` hanya
menganggap `^[A-Z0-9]{2,}$` sebagai kata kunci. Karena itu, tulisan yang disarankan tetap
huruf besar.

Pemetaan status:

| Ketikan | `StatusHadir` |
|---|---|
| `HADIR` | `PRESENT` |
| `IZIN` | `EXCUSED` |
| `SAKIT` | `SICK` |

Balasan sesuai komentar di berkas: `HADIR` → "Absensi rapat berhasil dicatat.",
`STATUS` → "Absensi kamu hari ini: HADIR."

### Alur absensi lewat bot

```
Anggota mengetik "HADIR"
   → router cocokkan /^(HADIR|IZIN|SAKIT)\b/i
   → bacakanMaksudAbsen() memastikan alasan cukup
   → pastikanAnggota(pesan)  →  identity-resolver → API
   → sesiTerbukaHariIni(tanggal)   → GET /attendance/sessions (filter tanggal & status OPEN)
   → catatHadir({ sessionId, memberId, status, alasan, sumber: WHATSAPP })
   → balasan via templates.ts
```

Catatan `api/client.ts`: payload absensi dari bot memuat `direkamOlehJid` dan dicatat
sebagai sumber `WHATSAPP` agar jejak audit jelas.

---

## 4. Perintah Pengurus (dengan garis miring)

Daftar resmi ada di `router.ts` sebagai `PERINTAH_PENGURUS`, lengkap dengan izin yang
diminta:

| Perintah | Izin yang diwajibkan | Handler | Keterangan |
|---|---|---|---|
| `/rekap` | `attendance.read` | `commands/pengurus.ts::tanganiRekap` | Rekap kehadiran. |
| `/reminder` | `attendance.read` | `commands/pengurus.ts::tanganiReminder` | Kirim pengingat kepada yang belum absen. |
| `/rapat` | `meeting.read` | `commands/pengurus.ts::tanganiRapat` | Info rapat. |
| `/tugas` | `task.read` | `commands/pengurus.ts::tanganiTugasOrganisasi` | Daftar tugas organisasi. |
| `/program` | `program.read` | `commands/pengurus.ts::tanganiProgram` | Info program kerja. |
| `/kas` | `finance.read` | `commands/kas.ts::tanganiKasPengurus` | Rekap keuangan (bendahara/sekretaris). |
| `/absenin` | `attendance.manage` | `commands/pengurus.ts::tanganiAbsenIn` | Mencatat kehadiran anggota lain. |
| `/daftarin` | `member.write` | `commands/pengurus.ts::tanganiDaftarIn` | Mendaftarkan anggota baru. |
| `/listanggota` | `member.read` | `commands/pengurus.ts::tanganiListAnggota` | Daftar anggota. |

Perintah garis miring yang tidak dikenal akan dijawab dengan **`BANTUAN`**.

Perhatikan beda `/kas` (izin `finance.read`) dan `KAS` anggota: `/kas` menampilkan
ringkasan keuangan organisasi (`ringkasanKeuangan()`), sedangkan `KAS` menampilkan
saldo + tunggakan pribadi (`detailKas()`).

---

## 5. Anti-Spam & Perilaku Diam

| Mekanisme | Nilai | Keterangan |
|---|---|---|
| Jendela rate limit | 60.000 ms | `JENDELA_RATE_MS`. |
| Batas pesan | 20 per menit | `BATAS_PESAN_JENDELA`. Bila terlampaui, bot membalas `pesanTerlaluBanyakPermintaan()`. |
| Deteksi perintah | `^[A-Z0-9]{2,}$` | `tampakSepertiPerintah()`. |
| Pesan obrolan biasa | diabaikan | Bila kata pertama bukan kata kunci dan tidak diawali `/`, bot **diam** — tidak mengganggu grup. |
| Reset rate limit | `resetRateLimit()` | Mengosongkan riwayat saat restart. |

---

## 6. Gateway API yang Digunakan Bot

Konstanta `JALUR` di `apps/bot/src/api/client.ts`:

| Konstanta | Jalur |
|---|---|
| `RESOLVE_IDENTITAS` | `POST /identity/whatsapp/resolve` |
| `DAFTAR_WHATSAPP` | `POST /identity/whatsapp/register` |
| `ANGGOTA` | `GET /members` |
| `SESI_ABSENSI` | `GET /attendance/sessions` |
| `CATAT_HADIR` | `POST /attendance/records` |
| `CATAT_HADIR_MANUAL` | `POST /attendance/records/manual` |
| `rekapSesi(id)` | `GET /attendance/sessions/:id/recap` |
| `rekapAnggota(id)` | `GET /attendance/recap/member/:id` |
| `RAPAT` | `GET /meetings` |
| `TUGAS` | `GET /tasks` |
| `PROGRAM` | `GET /programs` |
| `KAS` | `GET /finance/cash` |
| `RINGKASAN_KEUANGAN` | `GET /finance/summary` |
| `NOTIFIKASI` | `GET /notifications` |
| `KESEHATAN` | `GET /health` |

> Perhatikan perbedaan jalur yang dipakai bot dan jalur resmi di `API.md` untuk
> beberapa sumber daya. Sebelum mengandalkan salah satunya, periksa controller yang
> sesuai; bila keduanya berbeda, API-nya yang menjadi acuan (lihat catatan AI agent).

---

## 7. Konfigurasi

Dari `.env.example`:

| Variabel | Keterangan |
|---|---|
| `WHATSAPP_ENABLED` | `false` bawaan. Bot tidak menyambung sebelum diaktifkan. |
| `WHATSAPP_PHONE_NUMBER` | Nomor bot, format `62xxx` (tanpa `+`). |
| `WHATSAPP_SESSION_DIR` | Direktori kredensial Baileys (bawaan `./whatsapp-session`). |
| `PUBLIC_WEB_URL` | Basis tautan dalam yang dikirim ke anggota. |
| `PUBLIC_API_URL` | Alamat API yang dipakai bot. |

Pairing pertama menampilkan kode QR di terminal (paket `qrcode-terminal`).
Direktori sesi **wajib** tidak dikomit ke repositori.

---

## 8. Penanganan Galat

- `util/galat.ts::kodeGalat()` menormalkan galat menjadi kode yang bisa ditampilkan.
- `KesalamanApi` (ejaan asli: `KesalahanApi`) membawa `status` dari respons API, sehingga
  bot bisa membedakan "tidak berwenang" (401/403) dari "API mati" (503/jaringan).
- `api/client.ts` menyediakan pemeriksaan kesiapan API (`JALUR.KESEHATAN`) sebelum bot
  dianggap siap; bila gagal, bot memberi tahu log bahwa perintah akan gagal sampai API hidup.
- Router **tidak pernah** melempar galat: kegagalan selalu dijawab dengan pesan ramah.

---

## 9. Menambah Perintah Baru

1. Tambahkan pola pencocokan di `router.ts`.
   - Perintah anggota: huruf besar, tanpa garis miring — cocokkan dengan regex `^KATA\b/i`.
   - Perintah pengurus: diawali `/` — tambahkan entri pada `PERINTAH_PENGURUS`
     **beserta izinnya**. Jangan pernah menambahkan perintah pengurus tanpa izin.
2. Tambahkan handler di `commands/*.ts`.
3. Tambahkan template balasan di `services/templates.ts`.
4. Bila perlu data baru, tambahkan fungsi di `api/client.ts` — **jangan** mengakses
   database dari bot.

---

## Catatan untuk AI agent

1. Jangan pernah menambahkan akses database, env `DATABASE_URL`, atau skema Drizzle ke
   `apps/bot`. Bot adalah klien REST murni.
2. Jangan menebak identitas dari nama tampilan WhatsApp. Bila `resolve` mengembalikan
   404, kirim instruksi `DAFTAR`/penautan akun — jangan mencocokkan berdasarkan nama.
3. Setiap perintah pengurus baru **wajib** memakai `lewatiGerbangPengurus(pesan, izin, …)`
   dan didaftarkan di `PERINTAH_PENGURUS` dengan izin eksplisit.
4. Cache identitas berumur 5 menit. Bila Anda mengubah izin seseorang, bot bisa masih
   memakai izin lama sampai cache kedaluwarsa — gunakan `hapusCacheIdentitas(jid)` bila
   perlu efek segera.
5. Jalur di `JALUR` adalah kontrak internal bot↔API. Bila Anda mengubah rute API, perbarui
   konstan ini sekaligus, dan tambahkan pengujian pada `apps/bot/src/api/client.test.ts`.
