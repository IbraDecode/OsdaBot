# Uji Smoke Skill (Gateway Sungguhan)

Status: **VERIFIED** — 11/11 skenario lulus terhadap AI gateway sungguhan

---

## 1. Celah yang ditutup

Invarian `tool-reachability` menangkap tool yang **tidak punya** skill. Itu
separuh masalah. Separuh lagi tidak tertangkap apa pun:

```
tool ada    ✓  (terdaftar)
skill ada   ✓  (menyebut tool itu)
tapi model TIDAK PERNAH memilihnya  ✗  (tidak ada yang tahu)
```

Kegagalan itu muncul paling lambat: saat pengguna mengetik "tugas saya apa
aja" dan bot menjawab *"aku tidak punya tool yang aktif untuk fitur itu di
percakapan ini"*. Semua test hijau.

Test ini menjalankan **percakapan nyata** lewat `AgentRuntime` sungguhan, tool
sungguhan, dan database sungguhan — lalu memeriksa apakah tool yang diharapkan
benar-benar dipanggil, dengan membaca `ToolExecution` (bukan return value).

---

## 2. Hasil

```
skill                 langkah  tool dipanggil
manage-task                 2  task_list
manage-attendance           2  attendance_list_events
manage-organization         2  organization_list_members
manage-finance              2  finance_list_accounts
collect-payment             2  finance_list_invoices
create-document             2  document_list
manage-reminder             2  reminder_list
kelompok tugas              2  task_list
answer-from-knowledge       2  knowledge_search
manage-group                2  group_list_joined
sapaan biasa                1  (tidak ada)
```

11 skenario, 2 menit 3 detik total, 5–15 detik per panggilan. **Gateway ternyata
jauh lebih cepat dari yang dicatat sebelumnya** (1–3 menit) — kemungkinan karena
penyaringan tool sudah bekerja.

Skenario "halo" memeriksa arah sebaliknya: agent **tidak** memanggil tool untuk
obrolan biasa. Sama pentingnya dengan memanggil yang tepat.

---

## 3. Dua bug di test-nya sendiri, keduanya menutupi kegagalan

### Aktor yang salah jenis

Saya mengoper **member id** ke `permissionsFor`, padahal `MessageHandler` juga
memakai `resolved.identity.userId` — yaitu **User** id. Member id membuat
`allowedPermissions` kosong, semua skill terfilter, dan 5 dari 7 skenario gagal
dengan jawaban persis yang seharusnya dikhawatirkan:

> *"aku tidak punya tool yang aktif untuk fitur itu di percakapan ini"*

Saya sempat mengira itu bug produksi. Bukan: data menunjukkan user memang punya
`userId`. Test-nya yang salah.

### Izin dihitung sebelum aktor terisi

Setelah diperbaiki, test **tetap lulus** — tapi `skillTerpilih` kosong di semua
skenario. Penyebabnya urutan baris: `izin` dihitung satu baris **sebelum**
`AKTOR_ID` diisi.

Artinya test berjalan tanpa panduan skill apa pun. Dan tetap lulus, karena saya
tidak mengoper `relevantToolNames` — jadi agent mendapat **49 tool**, bukan yang
produksi kirim.

**Test yang lulus tanpa fearless what it measures** lebih buruk daripada test
yang gagal: ia memberi rasa aman yang tidak berdasar.

Keduanya diperbaiki. Sekarang test mengirim `relevantToolNames` persis seperti
`MessageHandler`, dan tetap lulus.

---

## 4. Satu skenario yang saya tulis salah, dan model yang benar

`manage-finance` awalnya saya tulis `bolehTanpaTool: true` — karena saya belum
tahu nama tool-nya. Model tetap memanggil `finance_list_accounts`, dan itu
**benar**: menanyakan saldo kas memang harus memanggil tool.

Test-nya yang salah. Jawaban modelnya justru contoh kejujuran yang selama ini
saya bangun:

> *"Belum ada rekening kas yang tercatat, jadi saldo kas saat ini belum bisa
> diketahui — bukan berarti Rp 0."*

Itu persis pemisahan yang berulang kali saya jadikan aturan: tidak tahu ≠ nol.

---

## 5. Temuan yang belum diperbaiki

`SkillRegistry.select()` **tidak memfilter apa pun**. Ia menyaring skill yang
konteksnya tidak cocok dan yang izinnya tidak dimiliki, lalu **mengurutkan**
sesuai jumlah trigger yang cocok — tapi tidak pernah memotong.

Hasilnya: untuk **setiap** pesan, 11 dari 11 skill masuk ke `extraSystemContext`,
dan ~40 tool dikirim ke model.

Ini **bertentangan dengan desain yang terdokumentasi**:

- `MessageHandler`: *"Skill yang relevan saja yang dimuat — bukan semuanya"*
- Catatan performa: 18 tool → timeout 60 detik

### Tapi pengukurannya tidak mendukung perubahan

11 skenario lulus dalam 5–15 detik per panggilan, dengan tool yang benar
terpilih setiap kali. Tidak ada tanda bahwa prompt-nya terlalu besar.

Artinya: komentar di kode menjanjikan sesuatu yang tidak diimplementasikan, tapi
**perilakunya saat ini tidak merugikan**. Mengubahnya berdasarkan janji
komentar — bukan berdasarkan apa yang terukur — adalah memperburuk yang
sekarang bekerja untuk memenuhi deskripsi yang lebih rapi.

Yang benar untuk ini bukan perubahan kode, tapi **koreksi komentar** supaya
tidak menjanjikan penyaringan yang belum ada. Itu dikerjakan di commit
berikutnya.

Kalau nanti kelambatan itu ketahuan — gateway lain, model lebih besar, skill
bertambah — barulah pemotongan terbukti berguna: ambil 3 teratas **dengan batas
bawah**, jangan sampai nol skill. Nol skill persis kondisi "tidak punya tool"
yang membuat pengguna mengira bot rusak.

---

## 6. Yang SENGAJA tidak diuji

Hanya skenario tanpa efek samping ke luar. Yang **menulis ke WhatsApp**
(`compose-message`, `document_send`), membuat dokumen, dan melakukan pembayaran
tidak ikut.

Test ini berjalan terhadap database dan nomor sungguhan. "Kebetulan gagal dengan
efek samping" bukan cara yang benar untuk memverifikasi pemilihan tool.

---

## 7. Menjalankan

```bash
RUN_LIVE_TESTS=true pnpm exec vitest run tests/live/skill-smoke.live.test.ts
```

Laporan lengkap ditulis ke `/tmp/opencode/live-smoke/laporan.json` berisi tool
yang dipanggil, jumlah langkah, durasi, alasan berhenti, dan cuplikan balasan —
supaya kegagalan bisa dibaca tanpa mengulang panggilan.

Tanpa `RUN_LIVE_TESTS=true`, seluruh describe di-skip.