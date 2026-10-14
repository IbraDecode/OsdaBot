# Tool Registry

Tool adalah **satu-satunya jalan** menjalankan tindakan nyata. Model AI hanya
meminta; backend yang memutuskan dan menjalankan.

## Kontrak

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string                     // "attendance.update"
  description: string              // menjelaskan KAPAN dipakai, bukan apa
  inputSchema: ZodType<TInput>
  requiredPermissions: Permission[]
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  requiresApproval: boolean
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>
}
```

### ToolExecutionContext

Semua field berasal dari backend yang sudah diverifikasi:

```typescript
interface ToolExecutionContext {
  actorUserId: string | null       // dari IdentityEngine
  organizationId: string | null    // dari resolusi organisasi
  conversationId: string | null
  taskId: string | null
  chatJid: string
  senderJid: string
  correlationId: string
  timezone: string
  authorization: AuthorizationService
}
```

**`actorUserId` TIDAK PERNAH berasal dari argumen model AI.** Kalau model
mengarang UUID aktor lain, nilai itu diabaikan karena tool memakai nilai dari
context.

## Pipeline pemeriksaan

Setiap `execute()` melewati urutan ini. Salah satu gagal → operasi **tidak
dijalankan**:

```
1. registered?           → tool tidak dikenal = TOLAK
2. input valid?          → Zod. Argumen AI = input tak dipercaya
3. authenticated?        → actorUserId & organizationId ada?
4. authorized?           → semua requiredPermissions dimiliki?
5. scope valid?          → resource benar-benar milik organisasi?
6. approval required?    → riskLevel HIGH → minta persetujuan
7. execute()
```

### Bukti bahwa ini benar-benar menolak

`tests/unit/security.test.ts` memverifikasi:

```typescript
it('MENOLAK tool kalau aktor tidak punya izin — walau AI memintanya', async () => {
  const executeSpy = vi.fn()
  registry.register({ ...dangerousTool, execute: executeSpy })

  const result = await registry.execute('test.delete_all', { target: 'semua' }, context)

  expect(result.success).toBe(false)
  // Ini yang paling penting:
  expect(executeSpy).not.toHaveBeenCalled()
})
```

### Batas jumlah pemanggilan

`maxCallsPerRun` (default 12) mencegah loop tak berujung. Melebihi batas →
`RATE_LIMITED`, fungsi tidak dipanggil.

## Tool yang tersedia (15)

### Kehadiran

| Tool | Izin | Risiko | Persetujuan |
|---|---|---|---|
| `attendance.list_events` | `attendance.read` | rendah | tidak |
| `attendance.get` | `attendance.read` | rendah | tidak |
| `attendance.create` | `attendance.create` | sedang | tidak |
| `attendance.add_member` | `attendance.update` | sedang | tidak |
| `attendance.update` | `attendance.update` | sedang | tidak |
| `attendance.get_unconfirmed` | `attendance.read` | rendah | tidak |

### Organisasi

| Tool | Izin | Risiko | Persetujuan |
|---|---|---|---|
| `organization.list_members` | `members.read` | rendah | tidak |
| `organization.search_members` | `members.read` | rendah | tidak |
| `organization.create_member` | `members.create` | sedang | tidak |
| `organization.get_roles` | `roles.read` | rendah | tidak |
| `organization.get_events` | `events.read` | rendah | tidak |

### WhatsApp

| Tool | Izin | Risiko | Persetujuan |
|---|---|---|---|
| `whatsapp.send_message` | `whatsapp.send` | sedang | **ya** |
| `whatsapp.react_message` | `whatsapp.send` | rendah | tidak |
| `whatsapp.get_group_members` | `whatsapp.send` | rendah | tidak |
| `whatsapp.get_group_metadata` | `whatsapp.send` | rendah | tidak |

`whatsapp.send_message` selalu butuh persetujuan: pesan yang terkirim tidak
bisa ditarik, dan penerima bisa salah orang.

## Membuat tool baru

Checklist wajib:

1. **Nama** pakai titik, kata kerja di depan: `attendance.update`, bukan
   `updateAttendance`.
2. **Description** menjelaskan KAPAN dipakai. Model memilih berdasarkan
   deskripsi, bukan nama.
3. **`organizationId` TIDAK pernah jadi parameter input.** Ambil dari
   `context.organizationId`.
4. **`actorId` TIDAK pernah jadi parameter input.**
5. **Semua input wajib divalidasi Zod** dengan deskripsi per field.
6. **`requiredPermissions` paling spesifik** yang bisa.
7. **Kembalikan data terstruktur**, bukan string `"Success!"`. Agent butuh
   bukti untuk tidak mengarang.
8. **Tambah test** untuk kasus penolakan.

Contoh bentuk yang benar:

```typescript
export const toolHapusAnggota: ToolDefinition<{ memberId: string }, { removed: boolean }> = {
  name: 'organization.delete_member',
  description:
    'Hapus anggota dari organisasi. Gunakan HANYA bila pengguna secara eksplisit ' +
    'meminta penghapusan permanen. Jangan gunakan untuk keluar dari keanggotaan.',
  inputSchema: z.object({
    memberId: z.string().uuid().describe('ID anggota dari organization.search_members'),
  }),
  requiredPermissions: [PERMISSIONS.MEMBERS_DELETE],
  riskLevel: 'HIGH',
  requiresApproval: true,
  async execute(input, context) {
    const organizationId = context.organizationId
    if (!organizationId) {
      throw new ToolError('PERMISSION_DENIED', 'Organisasi belum ditentukan.')
    }

    // Scope: pastikan anggota memang milik organisasi ini.
    const member = await prisma.organizationMember.findFirst({
      where: { id: input.memberId, organizationId },
      select: { id: true },
    })
    if (!member) {
      throw new ToolError('NOT_FOUND', 'Anggota tidak ditemukan di organisasi ini.')
    }

    await prisma.organizationMember.delete({ where: { id: member.id } })
    return { removed: true }
  },
}
```

## Description yang baik vs buruk

| Buruk | Baik |
|---|---|
| "Mengubah kehadiran" | "Ubah entri yang sudah ada. Hanya field yang diisi yang berubah. Untuk menambah anggota baru pakai attendance.add_member." |
| "Kirim pesan" | "Kirim pesan teks WhatsApp. Untuk grup, tanyakan dulu — pesan tidak bisa ditarik." |
| "Cari anggota" | "Cari anggota berdasarkan nama. WAJIB dipakai sebelum mengubah data yang menyebut nama orang. Kalau hasilnya >1, wajib minta klarifikasi." |

## Hasil tool & galactic

Tool mengembalikan `ToolResult<T>`:

```typescript
type ToolResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: ToolErrorCode; message: string; retryable: boolean } }
```

`code` dipakai untuk percabangan, `message` aman ditampilkan ke pengguna,
`retryable` menentukan apakah agent boleh mencoba lagi.

Kode yang ada: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `PERMISSION_DENIED`,
`NOT_FOUND`, `RESOURCE_SCOPE_MISMATCH`, `AMBIGUOUS_REFERENCE`, `CONFLICT`,
`RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `UNKNOWN_OUTCOME`, `INTERNAL_ERROR`.

**`UNKNOWN_OUTCOME`** dipakai saat hasil eksternal tidak diketahui (mis. timeout
saat kirim pesan). Agent **tidak boleh** mengirim ulang tanpa rekonsiliasi.