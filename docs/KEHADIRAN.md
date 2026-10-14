# Kehadiran (Attendance)

Ini fitur organisasi pertama yang selesai dan paling sering dipakai. Modular
monolith dibangun di sekelilingnya karena di situlah kebutuhan nyata pertama.

## Prinsip inti

**Data dan presentasi terpisah.**

| Lapis | Tanggung jawab |
|---|---|
| `AttendanceEntry` (database) | Data kehadiran — diubah hanya lewat `AttendanceService` |
| `renderAttendanceList()` | Tampilan WhatsApp — tidak pernah menyentuh database |

Kalau pengguna minta "formatnya jangan diubah", itu perubahan **tampilan** —
database tidak boleh ikut berubah. Kalau pengguna minta "ubah Danya jadi izin",
itu perubahan **data** — WAJIB lewat service dengan otorisasi.

## Skenario acuan

Ini skenario yang jadi kontrak produk, diuji di
`tests/unit/attendance-renderer.test.ts`:

**Masukan** (dari pengguna):

```
*LIST YANG HADIR LKBB, KAMIS, 15 OKTOBER 2026*

1. Ni Ketut Rianti (X MPK 1)
2. Danya Sefti Cahyani (X AKL 3)
3. Ibra Ramdan (X BDG 1)

*IZIN*
-
```

**Perintah**: "ubah Ibra jadi izin karena ada meeting"

**Harapan keluaran**:

```
*LIST YANG HADIR LKBB, KAMIS, 15 OKTOBER 2026*

1. Ni Ketut Rianti (X MPK 1)
2. Danya Sefti Cahyani (X AKL 3)

*IZIN*
Ibra Ramdan (X BDG 1) — meeting
```

Yang harus benar:

- Judul **tidak berubah**.
- Nama & kelas anggota lain **tidak berubah**.
- Penomoran diperbarui (Ibra pindah ke seksi izin).
- Alasan tercatat.
- Tidak ada duplikat.
- Format WhatsApp tetap (`*tebal*`, bukan `**tebal**`).

## Renderer

`renderAttendanceList()` memakai `AttendanceTemplate` yang disimpan di
`formatHints`:

```typescript
interface AttendanceTemplate {
  title: string                    // dari markdown pengguna
  sectionLabels: Record<Status, string>
  sectionOrder: AttendanceStatus[] // urutan seksi
  boldMarker: '*' | '_' | ''       // gaya dari markdown pengguna
  lineTemplate: '${nomor}. ${nama}${kelas}'
  reasonTemplate: '${nama}${kelas} — ${alasan}'
  emptyMarker: '-'
  footerTemplate: string | null
}
```

`detectFormatHints()` membaca markdown asli untuk menebak gaya:

```typescript
'_DAFTAR HADIR_\n\n1. Budi'
// → { boldMarker: '_', lineTemplate: '${nomor}. ${nama}${kelas}${alasan}' }
```

### Perbedaan penomoran antar seksi

Seksi **HADIR** bernomor. Seksi **IZIN / SAKIT / ALPA / BELUM KONFIRMASI**
biasanya tidak, mengikuti kebiasaan daftar sekolah di Indonesia. Ini bukan
kebodgolan — kalau format aslinya berbeda, `formatHints` akan overridden.

## Aturan pembaruan

### Ubah hanya field yang diminta

```typescript
await attendance.updateEntry({
  organizationId, attendanceEventId,
  memberId,
  status: AttendanceStatus.EXCUSED,
  reason: 'ada meeting',
})
```

Kalau hanya `reason` yang diberikan, `status` **tidak** di-reset. Aturan ini
menghasilkan perilaku yang benar untuk seluruh rangkaian perintah ini:

| Perintah | Yang berubah | Yang tetap |
|---|---|---|
| "ubah status jadi izin" | `status` | alasan lama |
| "ganti alasannya meeting" | `reason` | `status` tetap izin |
| "yang lain tetap" | tidak ada | semua |

Ini yang membuat "ubah Danya jadi izin" → "alasannya ganti" bekerja sebagai
satu rangkaian pekerjaan, bukan dua operasi terpisah.

### Idempoten

Menambahkan anggota yang sudah ada **tidak** menghasilkan entri kedua:

```typescript
const kedua = await attendance.addMember({ ... })
// kedua.alreadyPresent === true
```

Database juga punya `@unique([attendanceEventId, memberId])` sebagai pagar
kedua. Nomor urut dalam daftar **bukan identitas** — identitas selalu UUID
`memberId`.

### Scope organisasi

Semua operasi diskop ke `organizationId`:

```typescript
// Caller memberikan attendanceEventId milik organisasi lain
await attendance.getEvent(orgB, attendanceEventId)
// → AttendanceError('ATTENDANCE_NOT_FOUND')
```

## Tool yang tersedia

| Tool | Izin | Risiko |
|---|---|---|
| `attendance.list_events` | `attendance.read` | rendah |
| `attendance.get` | `attendance.read` | rendah |
| `attendance.create` | `attendance.create` | sedang |
| `attendance.add_member` | `attendance.update` | sedang |
| `attendance.update` | `attendance.update` | sedang |
| `attendance.get_unconfirmed` | `attendance.read` | rendah |
| `organization.search_members` | `members.read` | rendah |

`attendance.update` **menolak** entri yang tidak ada, dan menolak nama ambigu
dengan kode `AMBIGUOUS_REFERENCE` — bukan menebak.

## Format WhatsApp

WhatsApp tidak pakai Markdown GitHub:

|ginxcoID | Markdown GitHub | WhatsApp |
|---|---|---|
| Te-bold | `**tebal**` | `*tebal*` |
| Miring | `_miring_` | `_miring_` |
| Blockquote | `> kutip` | `> kutip` |
| Daftar | `- item` | `• item` atau `1. item` |

## Batasan saat ini

- Status tidak bisa dikustom per organisasi (hanya enum standar).
- Tidak ada impor dari Excel/CSV.
- Tidak ada riwayat perubahan absensi per entri (audit log ada, tapi per-field
  belum).
- Tanggal kegiatan disimpan sebagai `DateTime` UTC; konversi zona waktu
  dilakukan saat render dan saat menghitung "besok".