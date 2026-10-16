# Audit Kemampuan

Status: **IMPLEMENTED** · **TESTED** (705 test lulus, 0 gagal)

`tests/integration/capability-audit.test.ts`

---

## 1. Pola yang berulang

Selama pengerjaan proyek ini, pola yang sama muncul berulang kali:

```
dokumentasi bilang "aktif"  →  kodenya ada  →  tapi tidak ada SKILL.md
  →  tool tidak pernah dikirim ke model  →  tidak pernah terpakai
```

Gejalanya selalu sama dari sisi pengguna: **"gabisa ya"**.

Dan test yang ada — unit maupun integrasi — **semua lulus**, karena setiap
lapisan memang benar. Lapisan yang salah tidak pernah dipanggil.

Test double tidak bisa menangkap ini. Yang bisa adalah **pemeriksaan
keterjangkauan**: apa yang diklaim, apa yang ada, dan apa yang bisa dijangkau.

---

## 2. Apa yang diaudit

| Pemeriksaan | Kenapa |
|---|---|
| Izin tanpa tool | Izin di katalog tanpa tool = kemampuan tidak bisa dipakai |
| Izin tanpa peran | Izin yang tidak diberikan role mana pun = tidak bisa dimiliki siapa pun |
| Kemampuan tanpa skill | Kemampuan yang diklaim aktif tapi tidak bisa dipilih model |
| Model database mati | Tabel yang tidak dipakai kode = fitur yang dikira ada padahal tidak |
| Allowlist usang | Allowlist yang tidak akurat membuat audit berhenti berguna |

---

## 3. Yang ditemukan

### Izin: 30 dari 50 tidak punya tool

Separuh katalog izin menunjuk kemampuan yang tidak bisa dijalankan. Termasuk
seluruh sistem tugas, monitoring, otomasi, dan versi skill.

Yang **sengaja** tidak ada:

| Izin | Alasan |
|---|---|
| `attendance.delete` | Menghapus daftar berarti menghapus catatan kehadiran orang. Koreksi per entri. |
| `whatsapp.bulk_send` | Kirim massal ke daftar orang tidak bisa dibatalkan. |
| `skills.read` | Kalau skill bisa dibaca dari chat, agent bisa mengubah perilaku sendiri. |

### Izin tanpa peran: 2

`system.configure` dan `system.safe_mode` — tingkat operator, memang tidak
diberikan ke peran pengguna. Dicatat eksplisit supaya tidak hilang karena
kelalaian.

### Tabel mati: 17 model → tersisa 10

Ini bagian yang paling perlu jujur. Schema berisi model untuk fitur yang
**tidak pernah dibangun**:

- Percakapan pengumpul kebutuhan: `ActiveTask`
- Mesin alur kerja: `WorkflowRun`
- Versi skill: `SkillRecord`, `SkillVersion`
- Operasional: `Memory`, `GroupMembership`, `MessageDelivery`, `OrganizationSetting`
- Pendukung: `InvoiceItem`, `KnowledgeChunk`

Yang sudah dipasang:

| Model | Dipasang di |
|---|---|
| `TaskAssignment`, `TaskDependency` | `docs/TUGAS.md` |
| `IdempotencyKey` | commit `23f672e` |
| `AgentTask`, `AgentStep` | `docs/REKAMAN-AGENT.md` |
| `MonitoringConfiguration`, `OrganizationSignal`, `Recommendation` | `docs/MONITORING.md` |

Tercoret ≠ selesai. Yang tersisa masih daftar utang:

| Yang tersisa | Kenapa belum |
|---|---|
| `ActiveTask` | Menyusun kebutuhan lewat percakapan — tugas yang bentuknya belum jelas. Butuh model berbeda. |
| `WorkflowRun` | Mesin alur kerja otomatis. Skala besar, dan belum ada yang benar-benar butuh. |
| `SkillRecord`, `SkillVersion` | Skill dimuat dari berkas. Versi di database belum ada kebutuhan nyata. |
| `Memory` | Memori jangka panjang antar percakapan belum dirancang. |
| `MessageDelivery`, `OrganizationSetting` | Pelacakan per pesan dan pengaturan per organisasi belum ada. |

Jadi **"tercatat" bukan "terpasang"**, dan bahkan yang sudah dipasang belum
berarti bebas dari utang:

| Yang sudah dipasang | Utangnya yang tersisa |
|---|---|
| `AgentTask` | Retensi sudah ada; yang belum ada adalah retensi **rekomendasi** dan ekspor |
| Mode aman | Tidak ada kedaluwarsa — diselesaikan lewat `/ready`, bukan TTL |
| Monitoring | Jendela tetap, jadi organisasi aktif harian tidak bisa dibedakan dari yang sebulan sekali |
| `Task` | Retensi tidak ada, tapi ini data organisasi — bukan rekaman operasional |

### `IdempotencyKey` menjelaskan celah yang saya laporkan sendiri

Saya menulis di `docs/DOKUMEN.md`:

> Nomor bisa bentrok bila dua dokumen dibuat bersamaan.

Tabel `IdempotencyKey` sudah ada sejak awal — dirancang untuk pengaman itu —
tapi tidak pernah dipakai.

**Sudah dibayar** (commit `23f672e`): kunci idempotensi sekarang dipakai untuk
pembayaran, dan nomor dokumen dikunci dengan constraint `UNIQUE`. Constraint itu
membongkar bug laten: penomoran menyaring per jenis dokumen, sementara
keunikannya per organisasi — surat izin dan surat tugas sama-sama
menghasilkan `SURAT/2026/001`.

**Sistem tugas juga dibayar** (`docs/TUGAS.md`): `TaskAssignment` dan
`TaskDependency` sekarang dipakai. Yang tersisa `ActiveTask` — itu bukan
"sistem tugas", itu menyusun kebutuhan, dan butuh model berbeda.

---

## 4. Tiga bug di audit-nya sendiri

Audit yang salah lebih buruk daripada tidak ada audit, karena ia hijau
padahal masalahnya ada.

1. **Bandingkan konstanta dengan nilai.** `izinDipakaiTool()` mengembalikan
   `ATTENDANCE_READ`, sementara `ALL_PERMISSIONS` berisi `attendance.read`.
   Semua entri allowlist terbaca "usang".

2. **Heuristik nama accessor salah.** `model OrganizationMember` → aksesor
   Prisma-nya `prisma.organizationMember`, bukan kebab-case. Versi pertama
   menganggap **setiap** model mati.

3. **Hanya menangkap `prisma.`, lupa `tx.`.** Banyak akses terjadi di dalam
   `$transaction(async (tx) => ...)` — tabel yang paling aktif justru terlihat
   paling mati.

Semuanya ketahuan karena test-nya membandingkan dengan kenyataan, bukan
karena saya membaca kodenya teliti.

---

## 5. Regresi diverifikasi

| Yang dimatikan | Hasil |
|---|---|
| Hapus satu entri `IZIN_TANPA_TOOL` | test gagal |
| Hapus satu entri `TABEL_MATI` | test gagal |

Kalau audit ini tidak bisa gagal, ia tidak berguna.

---

## 6. Utang yang tersisa

Yang **tidak** bisa diselesaikan dengan menulis dokumentasi:

| Utang | Dampak | Status |
|---|---|---|
| `ActiveTask` belum dipakai | Menyusun kebutuhan lewat percakapan belum ada. | Utang |
| `WorkflowRun` belum dipakai | Tidak ada alur kerja otomatis. | Utang |
| `AgentTask` tanpa retensi | Rekaman menumpuk tanpa pernah dibersihkan. | **Dibayar** |
| Mode aman tanpa kedaluwarsa | Bot diam lama tak terdeteksi. | **Dibayar** (melalui `/ready`) |
| Monitoring belum ada | Tidak ada deteksi untuk percakapan yang memburuk. | **Dibayar** |
| Jendela monitoring tetap | organisasi aktif harian dibandingkan dgn yang sebulan sekali. | Utang |
| `system.safe_mode` tidak ada mekanismenya | Tidak ada tombol darurat saat ada gangguan. | **Dibayar** |
| `IdempotencyKey` belum dipakai | Nomor dokumen bisa bentrok saat bersamaan. | **Dibayar** |
| Tautan grup hanya CLI | Admin harus ke terminal; bot yang belum tertaut diam. | **Dibayar** |

Semua tercatat di sini dan di `IZIN_TANPA_TOOL` / `TABEL_MATI` pada test —
jadi tidak bisa dilupakan diam-diam.

---

## 7. Audit kedua: koneksi data tool → model

`tests/integration/koneksi-data.test.ts`

### Pola yang berulang, untuk kedua kalinya

Audit pertama menemukan tool yang tidak pernah terkirim ke model. Audit ini
menemukan kelas yang lebih halus, dan lebih berbahaya karena tidak terasa:

```
data ADA di database  →  tapi TIDAK masuk keluaran tool
  →  bot menjawab benar secara harfiah, salah secara faktual
  →  tidak ada error, tidak ada log, semua test hijau
```

Yang membuatnya bertahan adalah botnya **jujur**. Ia melaporkan tepat apa yang
tool berikan. Tidak ada yang gagal — yang tidak lengkap adalah tool-nya.

Temuan ini datang dari pemakaian nyata, bukan dari review kode. Pengguna membuat
QRIS Rp 100, lalu bertanya *"mana linknya"* dan *"kasi gambar qrisnya"*. Bot
menjawab jujur bahwa tautannya tidak tersedia. Itu benar: memang tidak ada yang
mengembalikannya.

### Yang ditemukan

| # | Tool | Yang hilang | Akibat ke pengguna |
|---|---|---|---|
| 1 | `finance_list_invoices` | Saringan `overdue` ditawarkan tapi `Invoice.status` tidak pernah bernilai `'overdue'` | "Tagihan yang lewat tenggat mana?" dijawab **0 tagihan** padahal ada yang menunggak. |
| 2 | `organization_list_members` | Nomor WhatsApp tidak pernah dikembalikan | "Kirim tagihan ke Budi" tidak bisa dijawab tanpa menebak nomor. |
| 3 | `payment_list` | Nama anggota tidak ikut dikembalikan | Tool yang deskripsinya "siapa yang belum bayar" hanya menjawab "3 pembayaran menunggu" — tidak bisa dipakai untuk menagih siapa pun. |
| 4 | `attendance_get` | `entryId: null` ditulis secara harfiah | `attendance_update` yang memperlakukannya sebagai paling presisi tidak pernah bisa dipakai; anggota dengan lebih dari satu entri tidak bisa diperbaiki tepat. |

Nomor 1 dan 4 punya satu akar yang sama: **nilai yang seharusnya dihitung saat
baca ditulis sebagai kolom yang tidak pernah diisi.** `Task.overdue` sudah
diselesaikan duluan dengan cara yang benar — dihitung saat baca. `Invoice` dan
`AttendanceEntry` tidak.

Nomor 2 punya akar lain: `IdentityEngine.verifiedIdentityForMember()` ada di
`resolver.ts` dan **tidak pernah dipanggil siapa pun**. Kode benar, tapi tak
terjangkau — pola yang sama seperti di audit pertama.

### Test yang lulus hampa, untuk ketiga kalinya

Dua test pertama **lulus dengan fixture kosong**:

- Tidak ada anggota di organisasi uji yang punya tautan terverifikasi, jadi
  `whatsappVerified` selalu `false` dan asserts soal nomor benar tanpa pernah
  mengujinya.
- Tidak ada pembayaran yang tertaut ke anggota, jadi `memberName` tidak pernah
  punya nilai yang bisa diperiksa.

Kali ini fixture dibuat di `beforeAll`: satu anggota ditautkan ke identitas
verifikasi, satu tagihan dibuat untuk anggota itu. Test tidak boleh bergantung
pada data yang kebetulan ada.

Verifikasi regresi: keempat perbaikan dimatikan satu per satu, keempatnya
ditangkap.

### Invarian baru

Aturan yang ditambahkan ke `docs/AUDIT.md`:

> Tool yang mengembalikan daftar **wajib** mengembalikan identitasthing yang
> membuat daftar itu berguna — nama, nomor, atau id yang bisa dipakai pada
> langkah berikutnya. Tool yang mengembalikan **saringan** wajib mengujinya
> terhadap data nyata, bukan hanya meneruskan enum-nya ke database.