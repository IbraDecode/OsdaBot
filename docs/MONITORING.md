# Monitoring Agent

Status: **IMPLEMENTED** · **TESTED** (17 test integrasi)

---

## 1. Yang sudah ada, dan yang belum

`AgentTask`, `AgentStep`, dan `ToolExecution` sudah merekam apa yang terjadi.
Tapi semuanya itu **per kejadian**. Tidak ada yang melintasinya, jadi pola ini
tidak terlihat dari satu pesan pun:

```
08:00  "absen" → finance_create gagal, argumen tidak lengkap
08:02  "absen" → finance_create gagal, argumen tidak lengkap
08:03  "absen" → finance_create gagal, argumen tidak lengkap
```

Tiga baris, semua "kegagalan biasa". Yang penting: **orang yang sama mengulang
permintaan yang sama**. Itu bug prompt atau kemampuan yang belum ada — bukan
kebetulan. Tapi tidak ada yang memperingatkan.

---

## 2. Prinsip yang dijaga

### Yang dilaporkan harus bisa dihitung

Tidak ada "rasa" atau tebakan. Kalau sebuah sinyal tidak bisa dijawab dengan
angka, ia bukan sinyal — ia opini.

### Deduplikasi lewat `fingerprint`

Kolomnya sudah `@unique` di schema dengan alasan yang tepat: satu masalah, satu
sinyal, angka `occurrences` yang bertambah.

Kalau setiap kejadian jadi sinyal sendiri, notifikasi dibanjiri tepat saat
masalahnya paling serius.

**Jumlah sengaja tidak ikut jadi bagian sidik jari.** Kalau ikut, setiap
kejadian dengan hitungan berbeda menjadi sinyal terpisah dan `fingerprint`
tunggal tidak mencegah apa pun.

### Yang sudah beres ditandai selesai

Kalau tidak, setiap masalah yang selesai meninggalkan baris `ACTIVE` selamanya,
dan daftar sinyal jadi arsip, bukan daftar pekerjaan.

---

## 3. Sinyal

| Jenis | Pemicu | Tingkat |
|---|---|---|
| `TOOL_FAILURE_REPEAT` | tool + kode error yang sama gagal ≥3× dalam 60 menit | WARNING |
| `MAX_STEPS_REPEAT` | ≥3 jalan agent berhenti `MAX_STEPS` | WARNING |
| `PROVIDER_ERROR` | ≥3 jalan agent berhenti `LLM_ERROR` dalam 30 menit | **CRITICAL** |
| `EMPTY_RESPONSE_REPEAT` | ≥3 jalan agent `EMPTY_RESPONSE` | WARNING |
| `SLOW_RESPONSE` | ≥3 jalan agent lewat 60 detik | INFO |

### Dua pemisahan yang disengaja

**Tool sama + kode error berbeda = dua masalah.** `NOT_FOUND` berarti datanya
salah; `VALIDATION_FAILED` berarti model salah paham kontrak tool. Satu
tanda baca tidak menyiratkan dua hal itu, dan menyatukannya membuat satu
saran untuk dua masalah berbeda.

**`PROVIDER_ERROR` = CRITICAL, `MAX_STEPS` = WARNING.** Yang pertama masalah
infrastruktur di luar kendali kode — tidak ada yang perlu diubah di prompt
selama itu berjalan. Yang kedua bisa jadi skill, bisa jadi tool, bisa jadi
konteks; urutannya belum pasti.

---

## 4. Rekomendasi: `basis` bukan hiasan

`Recommendation.basis` membedakan:

| `basis` | Arti | Contoh |
|---|---|---|
| `evidence` | Dihitung dari rekaman | "provider gagal 5×" → cek `osda doctor` |
| `heuristic` | Disimpulkan dari hitungan | "agent kehabisan langkah" → urutan kemungkinan skill/tool/konteks |
| `speculative` | Dugaan | — belum dipakai |

Provider error diklasifikasi `evidence`: penyebabnya terukur, bukan
disimpulkan. Menyimpulkannya jadi `heuristic` akan membuat saran tentang kode
lokal muncul untuk masalah yang sama sekali bukan di kode.

### `confidence` selalu `null`

Kolomnya ada di schema dan tidak diisi. Tidak ada model yang menghasilkan angka
itu, jadi mengisinya berarti mengarang. `null` berarti "tidak ada" — dan lebih
jujur daripada angka yang terlihat seperti hasil pengukuran.

---

## 5. Aturan per organisasi

`MonitoringConfiguration` bukan hiasan: ambang per organisasi **mengalahkan**
bawaan. Operator bisa menaikkan ambang untuk organisasi yang memang ramai,
tanpa mengubah perilaku organisasi lain.

Konfigurasi yang rusak **kembali ke bawaan** dan dicatat. Menyimpan satu angka
yang salah lebih buruk daripada tidak punya konfigurasi: yang kelihatan benar
tapi diam-diam tidak memonitor apa pun.

---

## 6. "Tidak ada sinyal" ≠ "tidak ada yang diukur"

Hasil selalu melaporkan telemetri — jumlah tool call, jalan agent, percakapan
yang diamati. Kalau keduanya sama, daftar kosong terlihat seperti bot yang
sehat padahal tidak ada yang diperiksa sama sekali.

---

## 7. Pemakaian

```bash
pnpm osda monitor:run                      # dry-run kalau ada --dry-run
pnpm osda monitor:run --org=<slug>         # per organisasi tertentu
pnpm osda monitor:configure --org=<slug> --jenis=TOOL_FAILURE_REPEAT --min=10
pnpm osda monitor:list                     # sinyal aktif
```

Tanpa `--org`, perintah memakai satu-satunya organisasi yang ada. Kalau lebih
dari satu, ia **menolak** — memilih diam-diam berarti melaporkan sinyal
organisasi yang salah, dan operator akan melihat masalah yang tidak ada.

`monitor:run` menampilkan ringkasan, saran, dan dasarnya — bukan cuma jenis
sinyalnya. Tanpa itu operator melihat "ada 9 sinyal" tapi tidak tahu apa yang
gagal, dan jawabannya ada di SQL.

### Contoh dari data nyata

```
Diukur : 507 tool call, 0 jalan agent, 0 percakapan

[WARNING] TOOL_FAILURE_REPEAT
   media_read_document gagal 10× dengan NOT_FOUND dalam 60 menit
   → Buka rekaman jalan yang memakai media_read_document (pnpm osda run:list).
     Kalau argumennya memang tidak lengkap dari sisi pengguna, deskripsi
     tool-nya perlu diperjelas; kalau lengkap, bug-nya di tool.
   tercatat 1× (baru) · dasar: evidence
```

Pemeriksaan kedua menaikkan `occurrences` ke 2 tanpa menambah baris — persis
yang harus dilakukan. Dan semua 9 sinyal milik satu organisasi; organisasi lain
0, meski keduanya punya data historis.

---

## 8. Yang tidak ada

| Batas | Kenapa |
|---|---|
| `notifyPolicy` tidak diimplementasikan | Mengirim "bot kamu sedang gagal" ke WhatsApp tanpa diminta hanya menambah kebisingan, dan itu butuh persetujuan orang |
| Sinyal hanya lewat CLI | Tidak ada dashboard; sesuai keputusan arsitektur |
| Tidak ada riwayat sinyal | Hanya `ACTIVE` yang ditampilkan; yang `RESOLVED` bisa dibaca lewat SQL |
| Jendela tetap (60/30/120 menit) | Tidak menyesuaikan pola lalu lintas — organisasi yang aktif setiap hari |
| Tidak ada prediksi | Hanya apa yang sudah terjadi |

Yang paling layak jadi pekerjaan berikutnya adalah **jendela yang menyesuaikan
pola**: organisasi yang aktif setiap hari tidak bisa dibandingkan dengan yang
aktif sebulan sekali dengan ambang 60 menit yang sama.