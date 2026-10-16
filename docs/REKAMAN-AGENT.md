# Rekaman Jalan Agent

Status: **IMPLEMENTED** · **TESTED** (10 test integrasi)

---

## 1. Celah yang ditutup

`ToolExecution` sudah mencatat setiap pemanggilan tool: nama, aktor, hasil,
durasi. Itu menjawab **"apa yang dipanggil"**.

Tidak menjawab **"kenapa"**. Data di produksi sebelum modul ini:

```
ToolExecution : 2232 baris
  dengan taskId : 0        ← tidak terhubung ke apa pun
AgentTask     : 0 baris
AgentStep     : 0 baris
Message       : 81 baris
korelasi berbeda: 2172
```

Jadi kalau bot menjawab dengan sesuatu yang salah, tidak ada yang bisa
dijawab: apakah model salah membaca, tool yang salah dipanggil, langkah habis,
atau penyedia error? Log ada, tapi log tidak bisa dijawab dalam bentuk
pertanyaan.

`ToolExecution.taskId` selalu `null` karena `context.taskId` di `AgentRuntime`
dihardcode `null` dan tidak ada yang pernah membuat baris `AgentTask`.

---

## 2. Satu pesan = satu `AgentTask`

```
AgentTask (satu jalan agent)
  ├── kind        : chat_personal | chat_grup
  ├── status      : RUNNING → COMPLETED | FAILED
  ├── errorCode   : JAWABAN_FINAL | MAX_STEPS | LLM_ERROR | EMPTY_RESPONSE
  ├── state       : correlationId, chatJid, availableTools, usage, durasi
  └── AgentStep[]
        ├── ordinal     : urutan putaran LLM
        ├── toolName    : tool yang diminta di putaran itu
        ├── description : "memanggil X" atau "menyusun jawaban akhir"
        └── status      : completed | skipped
```

`context.taskId` diisi dari baris induk, jadi `ToolExecution` sekarang punya
sesuatu untuk ditautkan.

---

## 3. Alasan berhenti: ini yang bikin rekaman berguna

Tidak mencatat alasannya berarti rekaman ini tidak menjawab pertanyaan yang
paling sering muncul.

| Alasan | Status | Artinya |
|---|---|---|
| `JAWABAN_FINAL` | `COMPLETED` | Selesai normal |
| `MAX_STEPS` | `COMPLETED` | **Kelihatannya berhasil, tapi tidak** |
| `LLM_ERROR` | `FAILED` | Penyedia error |
| `EMPTY_RESPONSE` | `FAILED` | Model tidak mengembalikan teks maupun tool |

`MAX_STEPS` sengaja berstatus `COMPLETED` — pengguna memang menerima balasan
yang jujur ("ada sebagian yang belum selesai"), jadi tidak ada yang gagal
menunggu. Tapi kalau tidak ditandai, rekaman `MAX_STEPS` terlihat **sama
dengan** jalan yang berhasil sempurna, dan pertanyaan "kenapa bot ini selalu
bilang belum selesai?" tidak punya jawaban.

---

## 4. Yang disimpan, dan yang tidak

| Disimpan | Tidak disimpan |
|---|---|
| Aktivitas: chat atau grup | Isi pesan (sudah ada di `Message`) |
| Langkah, tool yang dipanggil, hasilnya | Isi balasan (sudah ada di `Message`) |
| Alasan berhenti | Argumen lengkap tiap tool |
| Perhitungan token | Rahasia, kredensial |

Isi pesan **tidak** diduplikasi. Ada dua alasannya, dan yang kedua biasanya
dilupakan: menyalin isi pesan berarti dua tempat harus ikut dihapus kalau ada
permintaan penghapusan data — dan biasanya hanya satu yang terlupakan.

`chatJid` tetap dipakai di `title` karena itu **pengenal percakapan**, bukan
isi pesan. Tanpa itu semua baris titled sama dan mustahil dipilah dari daftar.

---

## 5. Penulisan tidak boleh mematikan percakapan

Ini jalur terpanas sistem. Kalau pencatatan error dan ikut menggagalkan, bot
mati sepenuhnya karena masalah audit — dan orang tidak menerima balasan apa
pun.

Semua penulisan dibungkus `try/catch`. Kalau `mulai()` gagal, `taskId` jadi
`null` dan percakapan berjalan tanpa rekaman.

Verifikasi: test dengan `Proxy` yang membuat `agentTask.create` selalu melempar
— hasilnya, jawaban tetap sampai ke pengguna dan tool tetap jalan.

### Kenapa langkah ditulis sekaligus di akhir

Satu penulisan database per putaran LLM berarti satu penulisan per **puluhan
detik** — putaran LLM butuh jauh lebih lama lewat gateway dari waktu orang
menulis satu pesan.

Langkah dikumpulkan di memori lalu ditulis sekali dengan `createMany`.

Konsekuensinya ditulis jujur: kalau proses mati di tengah jalan, langkahnya
hilang. Yang tetap ada adalah `ToolExecution` per pemanggilan tool, jadi tidak
ada jejak yang benar-benar hilang — hanya konteks "kenapa".

---

## 6. Satu bug yang tertangkap test

`selesai()` memakai `update: { state: { ...ringkasan } }` — dan itu **menghapus**
`correlationId` serta `chatJid` yang sudah ditulis di `mulai()`.

Akibatnya rekaman kehilangan informasi yang membuatnya bisa dicari. Terdaftar,
tapi tidak bisa ditanyakan.

Tertangkap bukan karena ada assertion khusus, tapi karena test-nya memakai
`state.path: ['correlationId']` untuk menemukan barisnya — dan baris itu
langsung tidak ketemu.

Itu jenis bug yang paling mahal kalau lolos: kodenya tidak salah, hanya tidak
berguna, dan tidak ada yang gagal selain orang yang mencarinya kemudian.

Perbaikannya: baca `state` lama lalu gabung. Prisma tidak punya operator
"gabung JSON" yang aman lintas versi, jadi isinya dibaca dulu lalu ditulis
ulang — satu pembacaan, pada saat yang bukan jalur terpanas.

---

## 7. Pemakaian

```bash
pnpm osda run:list
pnpm osda run:list --limit=50
pnpm osda run:show --id=<8 karakter pertama>
```

`run:list` menampilkan ringkasan per jalan plus hitungan alasan berhenti:

```
run 5485cff6 [COMPLETED] berhenti=JAWABAN_FINAL · 1 langkah · 120 token · 0 detik
run 1b414214 [FAILED] berhenti=EMPTY_RESPONSE · 1 langkah · 120 token · 0 detik

JAWABAN_FINAL: 8 · MAX_STEPS: 2 · EMPTY_RESPONSE: 1
```

Hitungan alasan berhenti itu yang paling sering dicari — "agent error" dan
"langkah habis" punya penanganan yang sama sekali berbeda.

Identifier boleh disingkat seperti git. Prisma tidak bisa menyaring UUID
dengan `startsWith`; kandidat diambil lewat `id::text LIKE` lalu yang pertama
dipakai. Batasnya jelas dan cukup karena yang ditinjau manusia.

---

## 8. Yang belum ada

| Batas | Akibatnya |
|---|---|
| Rekaman tidak menyimpan ulang isi pesan | Baca ulang harus lewat `Message` |
| Tidak ada pencarian semantik | Hanya bisa disaring lewat SQL |
| Tidak ada retensi | Rekaman menumpuk tanpa pernah dibersihkan |
| Tidak ada ekspor | Untuk analisis di luar, harus lewat SQL |
| `WorkflowRun` masih mati | Alur kerja otomatis belum ada; `AgentTask` hanya mencatat satu percakapan |

Yang paling penting adalah **retensi**. Tiap percakapan menambah baris
`AgentTask` + beberapa `AgentStep`, dan tidak ada yang pernah menghapus yang
lama. Untuk pilot terbatas ini aman; untuk berjalan berbulan-bulan, database
akan tumbuh tanpa batas dan tidak ada yang memperingatkan.

`ActiveTask` punya `expiresAt` dan `IdempotencyKey` punya batas umur.
`AgentTask` belum punya keduanya — dan itu yang paling layak jadi PR berikutnya.