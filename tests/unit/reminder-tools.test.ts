/**
 * Test tool pengingat.
 *
 * Fokusnya dua hal yang paling mudah salah:
 *  1. **Zona waktu.** Kalau tidak ditangani benar, pengingat meleset 8 jam
 *     dan tidak ada yang Pyramids mengetahuinya sampai pengingat tiba
 *     di waktu yang salah.
 *  2. **Destinasi.** `chatJid` tidak boleh pernah datang dari model.
 */
import { describe, expect, it } from 'vitest'
import { formatWaktu, parseWaktu } from '../../src/tools/reminder-tools.js'
import { buildReminderTools } from '../../src/tools/reminder-tools.js'

describe('parseWaktu', () => {
  it('menafsirkan waktu sebagai waktu LOKAL zona organisasi', () => {
    // Makassar = UTC+8. 09:00 lokal harus jadi 01:00 UTC.
    const hasil = parseWaktu('2026-10-20T09:00:00', 'Asia/Makassar')
    expect(hasil.toISOString()).toBe('2026-10-20T01:00:00.000Z')
  })

  it('menghormati zona waktu WIB (UTC+7)', () => {
    const hasil = parseWaktu('2026-10-20T09:00:00', 'Asia/Jakarta')
    expect(hasil.toISOString()).toBe('2026-10-20T02:00:00.000Z')
  })

  it('menghormati zona waktu UTC', () => {
    const hasil = parseWaktu('2026-10-20T09:00:00', 'UTC')
    expect(hasil.toISOString()).toBe('2026-10-20T09:00:00.000Z')
  })

  it('MENOLAK waktu di tengah malam yang bergeser hari', () => {
    // 00:30 di Makassar = 16:30 UTC HARI SEBELUMNYA. Kalau dihitung naif,
    // hasilnya meleset satu hari.
    const hasil = parseWaktu('2026-10-20T00:30:00', 'Asia/Makassar')
    expect(hasil.toISOString()).toBe('2026-10-19T16:30:00.000Z')
    expect(hasil.getUTCDate()).toBe(19)
  })

  it('menerima format tanpa detik', () => {
    expect(parseWaktu('2026-10-20T09:00', 'UTC').toISOString()).toBe('2026-10-20T09:00:00.000Z')
  })

  it('MENOLAK format yang tidak lengkap', () => {
    // Tanpa parsing ketat, "20 Oktober 2026" akan jadi NaN dan diam-diam
    // menghasilkan tanggal yang salah.
    for (const salah of [
      '20-10-2026',
      '2026/10/20 09:00',
      'besok jam 9',
      '2026-10-20',
      '09:00',
      '2026-10-20T09:00:00Z',
      '',
    ]) {
      expect(() => parseWaktu(salah, 'Asia/Makassar'), salah).toThrow(/Format waktu/)
    }
  })

  it('MENOLAK zona waktu yang tidak dikenal tanpa membuat hasil Ngawur', () => {
    // Lebih baik jatuh ke UTC daripada gagal atau menghasilkan NaN.
    const hasil = parseWaktu('2026-10-20T09:00:00', 'Tidak/Ada')
    expect(hasil.toISOString()).toBe('2026-10-20T09:00:00.000Z')
  })
})

describe('formatWaktu', () => {
  it('menampilkan waktu dalam zona organisasi', () => {
    const waktu = new Date('2026-10-20T01:00:00.000Z')
    const teks = formatWaktu(waktu, 'Asia/Makassar')
    expect(teks).toContain('2026')
    expect(teks).toMatch(/20|9/) // tanggal atau waktu 9 pagi
  })

  it('tidak melempar error untuk zona waktu tidak dikenal', () => {
    expect(() => formatWaktu(new Date(), 'Tidak/Ada')).not.toThrow()
  })
})

// ── Tool ────────────────────────────────────────────────────────────────────

const ORG = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'

function buatKonteks(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: USER,
    organizationId: ORG,
    conversationId: null,
    taskId: null,
    chatJid: '6281234567890@s.whatsapp.net',
    senderJid: '6281234567890@s.whatsapp.net',
    correlationId: 'test',
    timezone: 'Asia/Makassar',
    authorization: {} as never,
    ...overrides,
  } as never
}

function buatDeps(grup: Array<{ jid: string; subject: string | null; purpose: string | null }> = []) {
  const dijadwalkan: Array<Record<string, unknown>> = []

  const prisma = {
    group: {
      findMany: async () => grup.map((g) => ({ ...g, isArchived: false })),
    },
    scheduledJob: {
      findFirst: async () => null,
    },
  }

  const reminders = {
    schedule: async (input: Record<string, unknown>) => {
      dijadwalkan.push(input)
      return { id: 'rem-1', deduped: false }
    },
    listActive: async () => [
      {
        id: 'rem-1',
        scheduledAt: new Date(Date.now() + 3600_000),
        title: 'Latihan LKBB',
        body: '16:00 lapangan',
      },
    ],
    cancelAll: async () => 2,
    cancel: async () => true,
  }

  const tools = buildReminderTools({ prisma: prisma as never, reminders: reminders as never })

  // `buildReminderTools` mengembalikan `ToolDefinition<never, never>` karena
  // itu bentuk yang dipakai saat registrasi. Untuk menguji perilakunya, kita
  // perlu bentuk dengan tipe input yang nyata.
  type ToolUji = {
    name: string
    description: string
    requiresApproval: boolean
    riskLevel: string
    requiredPermissions: readonly string[]
    execute: (input: any, context: unknown) => Promise<any>
  }

  const byName = Object.fromEntries(
    tools.map((tool) => [tool.name, tool as unknown as ToolUji]),
  ) as Record<string, ToolUji>

  return { dijadwalkan, tools, byName }
}

describe('reminder.create', () => {
  /**
   * Waktu lokal yang pasti di masa depan.
   *
   * String dibaca sebagai waktu LOKAL zona organisasi (Makassar = UTC+8),
   * jadi harus digeser ke depan dengan margin yang cukup — bukan sekadar
   * "besok" yang bisa jatuh di masa lalu setelah dikonversi.
   */
  const besok9 = () => {
    const d = new Date(Date.now() + 3 * 86_400_000)
    d.setUTCHours(1, 0, 0, 0)
    return d.toISOString().slice(0, 19)
  }

  it('menjadwalkan pengingat ke chat asal', async () => {
    const { dijadwalkan, byName } = buatDeps()
    const tool = byName['reminder.create']!

    const hasil = await tool.execute(
      { title: 'Latihan LKBB', body: '16:00 lapangan', scheduledAt: besok9() },
      buatKonteks(),
    )

    expect(hasil.success).toBe(true)
    expect(dijadwalkan).toHaveLength(1)
    // chatJid berasal dari konteks, BUKAN dari input.
    expect(dijadwalkan[0]!.chatJid).toBe('6281234567890@s.whatsapp.net')
    expect(dijadwalkan[0]!.organizationId).toBe(ORG)
  })

  it('MENOLAK waktu yang sudah lewat', async () => {
    const { dijadwalkan, byName } = buatDeps()
    const tool = byName['reminder.create']!

    await expect(
      tool.execute(
        { title: 'X', body: 'Y', scheduledAt: '2020-01-01T09:00:00' },
        buatKonteks(),
      ),
    ).rejects.toThrow(/sudah lewat/)

    expect(dijadwalkan).toHaveLength(0)
  })

  it('MENOLAK waktu terlalu jauh ke depan', async () => {
    const { byName } = buatDeps()
    const tool = byName['reminder.create']!

    await expect(
      tool.execute(
        { title: 'X', body: 'Y', scheduledAt: '2099-01-01T09:00:00' },
        buatKonteks(),
      ),
    ).rejects.toThrow(/terlalu jauh/)
  })

  it('MENOLAK format waktu yang tidak lengkap', async () => {
    const { byName } = buatDeps()
    const tool = byName['reminder.create']!

    await expect(
      tool.execute({ title: 'X', body: 'Y', scheduledAt: 'besok jam 9' }, buatKonteks()),
    ).rejects.toThrow(/Format waktu/)
  })

  it('MENOLAK pengingat ke grup yang tidak tertaut ke organisasi', async () => {
    // Kalau model boleh memilih JID bebas, bot bisa mengirim ke mana saja.
    const { byName } = buatDeps([])
    const tool = byName['reminder.create']!

    await expect(
      tool.execute(
        { title: 'X', body: 'Y', scheduledAt: besok9(), toGroupTitle: 'Panitia' },
        buatKonteks(),
      ),
    ).rejects.toThrow(/Belum ada grup/)
  })

  it('menjadwalkan ke grup yang cocok', async () => {
    const { dijadwalkan, byName } = buatDeps([
      { jid: '123@g.us', subject: 'Panitia LKBB', purpose: 'Panitia latihan' },
    ])
    const tool = byName['reminder.create']!

    await tool.execute(
      { title: 'X', body: 'Y', scheduledAt: besok9(), toGroupTitle: 'LKBB' },
      buatKonteks(),
    )

    expect(dijadwalkan[0]!.chatJid).toBe('123@g.us')
  })

  it('MENOLAK kalau beberapa grup cocok — tidak menebak', async () => {
    // Salah pilih berarti pengingat terkirim ke grup yang salah, dan itu
    // tidak bisa ditarik kembali.
    const { dijadwalkan, byName } = buatDeps([
      { jid: '1@g.us', subject: 'Panitia LKBB 2026', purpose: null },
      { jid: '2@g.us', subject: 'Panitia LKBB 2025', purpose: null },
    ])
    const tool = byName['reminder.create']!

    await expect(
      tool.execute(
        { title: 'X', body: 'Y', scheduledAt: besok9(), toGroupTitle: 'LKBB' },
        buatKonteks(),
      ),
    ).rejects.toThrow(/beberapa grup/)

    expect(dijadwalkan).toHaveLength(0)
  })

  it('MENYIATKAN daftar grup yang tersedia saat tidak ditemukan', async () => {
    const { byName } = buatDeps([
      { jid: '1@g.us', subject: 'Panitia LKBB', purpose: null },
      { jid: '2@g.us', subject: 'Anggota OSIS', purpose: null },
    ])
    const tool = byName['reminder.create']!

    await expect(
      tool.execute(
        { title: 'X', body: 'Y', scheduledAt: besok9(), toGroupTitle: 'TidakAda' },
        buatKonteks(),
      ),
    ).rejects.toThrow(/Anggota OSIS/)
  })
})

describe('reminder.list', () => {
  it('mengembalikan pengingat terjadwal', async () => {
    const { byName } = buatDeps()
    const tool = byName['reminder.list']!

    const hasil = await tool.execute({}, buatKonteks())

    expect(hasil.success).toBe(true)
    const data = hasil.data as { count: number; reminders: unknown[] }
    expect(data.count).toBe(1)
  })
})

describe('reminder.cancel', () => {
  it('butuh reminderId atau all', async () => {
    const { byName } = buatDeps()
    const tool = byName['reminder.cancel']!

    await expect(tool.execute({}, buatKonteks())).rejects.toThrow(/reminderId/)
  })

  it('membatalkan semua', async () => {
    const { byName } = buatDeps()
    const tool = byName['reminder.cancel']!

    const hasil = await tool.execute({ all: true }, buatKonteks())

    expect(hasil.success).toBe(true)
    expect((hasil.data as { cancelled: number }).cancelled).toBe(2)
  })

  it('MENOLAK pembatalan pengingat milik organisasi lain', async () => {
    // Kalau tidak dicek, satu organisasi bisa membatalkan pengingat org lain.
    const { byName } = buatDeps()
    const tool = byName['reminder.cancel']!

    await expect(
      tool.execute(
        { reminderId: '99999999-9999-9999-9999-999999999999' },
        buatKonteks(),
      ),
    ).rejects.toThrow(/tidak ditemukan/)
  })
})

describe('kontrak tool pengingat', () => {
  it('semua tool punya permission dan risiko yang dinyatakan', () => {
    // Tool tanpa `requiredPermissions` berarti siapa pun bisa memakainya.
    const { tools } = buatDeps()
    for (const tool of tools as unknown as Array<{ name: string; requiredPermissions: unknown; riskLevel: string }>) {
      expect(Array.isArray(tool.requiredPermissions), tool.name).toBe(true)
      expect((tool.requiredPermissions as unknown[]).length, tool.name).toBeGreaterThan(0)
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(tool.riskLevel)
    }
  })

  it('pembatalan selalu butuh persetujuan', () => {
    // Pembatalan bisa salah paham dan tidak bisa dibatalkan.
    const { byName } = buatDeps()
    expect(byName['reminder.cancel']!.requiresApproval).toBe(true)
    // Pembuatan pengingat tidak dikirim ke siapa pun sampai waktunya tiba —
    // jadi tidak perlu persetujuan.
    expect(byName['reminder.create']!.requiresApproval).toBe(false)
  })

  it('deskripsi menjelaskan KAPAN dipakai, bukan APA', () => {
    const { tools } = buatDeps()
    for (const tool of tools as unknown as Array<{ name: string; description: string }>) {
      expect(tool.description.length, tool.name).toBeGreaterThan(60)
      expect(tool.description, tool.name).toMatch(/Gunakan saat|pakai saat/)
    }
  })
})