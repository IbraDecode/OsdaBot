# Audit Kemampuan

Status: **IMPLEMENTED** · **TESTED** (590 test lulus, 0 gagal)

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

### Tabel mati: 17 model

Ini bagian yang paling perlu jujur. Schema berisi model untuk fitur yang
**tidak pernah dibangun**:

- Sistem tugas: `ActiveTask`, `TaskAssignment`, `TaskDependency`
- Mesin alur kerja: `WorkflowRun`
- Rekaman agent: `AgentTask`, `AgentStep`
- Monitoring: `MonitoringConfiguration`, `OrganizationSignal`, `Recommendation`
- Versi skill: `SkillRecord`, `SkillVersion`
- Operasional: `IdempotencyKey`, `MessageDelivery`, `OrganizationSetting`

Semuanya kini tercatat beserta alasannya. Tapi **"tercatat" bukan
"terpasang"** — ini daftar utang, bukan daftar fitur.

### `IdempotencyKey` menjelaskan celah yang saya laporkan sendiri

Saya menulis di `docs/DOKUMEN.md`:

> Nomor bisa bentrok bila dua dokumen dibuat bersamaan.

Tabel `IdempotencyKey` sudah ada sejak awal — dirancang untuk pengaman itu —
tapi tidak pernah dipakai. Utang yang bisa saya lihat, belum saya bayarkan.

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

| Utang | Dampak |
|---|---|
| Sistem tugas belum ada | Tidak ada penugasan, tenggat, atau dependensi tugas. |
| `IdempotencyKey` belum dipakai | Nomor dokumen bisa bentrok saat bersamaan. |
| `WorkflowRun` belum dipakai | Tidak ada alur kerja otomatis. |
| Monitoring belum ada | Tidak ada deteksi untuk percakapan yang memburuk. |
| `system.safe_mode` tidak ada mekanismenya | Tidak ada tombol darurat saat ada gangguan. |
| Tautan grup hanya CLI | Admin harus ke terminal; bot yang belum tertaut diam. |

Semua tercatat di sini dan di `IZIN_TANPA_TOOL` / `TABEL_MATI` pada test —
jadi tidak bisa dilupakan diam-diam.