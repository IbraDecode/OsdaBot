/**
 * Test gerbang persetujuan pada ToolRegistry.
 *
 * Fokus: memastikan tool yang menandai `requiresApproval` benar-benar meminta
 * persetujuan, tidak lolos begitu saja.
 *
 * Ini test REGRESI. Versi gerbang sebelumnya berbunyi:
 *
 *     if (tool.requiresApproval && tool.riskLevel === 'HIGH')
 *
 * Padahal `whatsapp.send_message` menandai requiresApproval dengan riskLevel
 * MEDIUM. Persyaratannya tidak pernah terpenuhi, jadi approval tidak pernah
 * diminta untuk tool yang paling butuh persetujuan — pesan yang terkirim tidak
 * bisa ditarik kembali.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../../src/tools/registry.js'
import type { ToolDefinition, ToolExecutionContext } from '../../src/tools/types.js'
import { PERMISSIONS } from '../../src/security/permissions.js'

/** Otorisasi yang selalu mengizinkan. */
const izinBebas = {
  check: async () => ({ allowed: true as const, reason: null }),
} as never

function buatKonteks(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    actorUserId: '11111111-1111-1111-1111-111111111111',
    organizationId: '22222222-2222-2222-2222-222222222222',
    conversationId: null,
    taskId: null,
    chatJid: '628@s.whatsapp.net',
    senderJid: '628@s.whatsapp.net',
    correlationId: 'corr-test',
    timezone: 'Asia/Makassar',
    authorization: izinBebas,
    ...overrides,
  }
}

/** Catat semua broker yang dipakai registry. */
function buatBrokerRekam(): { calls: unknown[]; broker: never } {
  const calls: unknown[] = []
  const broker = {
    request: async (context: unknown) => {
      calls.push(context)
      return 'pending' as const
    },
  }
  return { calls, broker: broker as never }
}

function toolKirim(): ToolDefinition<{ text: string }, { ok: boolean }> {
  return {
    name: 'test.kirim',
    description: 'Kirim pesan (butuh persetujuan).',
    inputSchema: z.object({ text: z.string() }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'MEDIUM',
    requiresApproval: true,
    execute: async (input: { text: string }) => ({ ok: true, data: { ok: true, text: input.text } }),
  } as never
}

function toolAman(): ToolDefinition<{ text: string }, { ok: boolean }> {
  return {
    name: 'test.aman',
    description: 'Tool tanpa persetujuan.',
    inputSchema: z.object({ text: z.string() }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'LOW',
    requiresApproval: false,
    execute: async () => ({ ok: true, data: { ok: true } }),
  } as never
}

describe('gerbang persetujuan ToolRegistry', () => {
  it('BUG REGRESSION: tool MEDIUM dengan requiresApproval HARUS meminta persetujuan', async () => {
    const { calls, broker } = buatBrokerRekam()
    const registry = new ToolRegistry({ approvals: broker, logger: { child: () => ({}), info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never })
    registry.register(toolKirim() as never)

    const hasil = await registry.execute('test.kirim', { text: 'halo' }, buatKonteks())

    // Persetujuan harus diminta.
    expect(calls).toHaveLength(1)
    // Dan tool tidak boleh dieksekusi sebelum disetujui.
    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      // BUG REGRESSION: kodenya `APPROVAL_PENDING`, bukan `VALIDATION_FAILED`.
      //
      // Menunggu persetujuan bukan kegagalan input. Kalau kodenya `VALIDATION_FAILED`,
      // model membacanya sebagai "argumen salah" lalu memperbaiki argumen dan
      // memanggil lagi — hasilnya permintaan persetujuan kedua untuk hal yang
      // sama, dan seterusnya.
      expect(hasil.error.code).toBe('APPROVAL_PENDING')
      expect(hasil.error.message).toContain('persetujuan')
      // Dan pesannya harus menyuruh model BERHENTI, bukan mencoba lagi.
      expect(hasil.error.message.toLowerCase()).toContain('jangan panggil')
      expect(hasil.error.retryable).toBe(false)
    }
  })

  it('menolak, bukan melewati, kalau broker tidak terpasang', async () => {
    // Tanpa broker, tool berisiko tidak boleh diam-diam jalan.
    const registry = new ToolRegistry({
      logger: { child: () => ({}), info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    })
    registry.register(toolKirim() as never)

    const hasil = await registry.execute('test.kirim', { text: 'halo' }, buatKonteks())

    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      expect(hasil.error.code).toBe('INTERNAL_ERROR')
      expect(hasil.error.message).toContain('persetujuan')
    }
  })

  it('meneruskan chatJid dan correlationId ke broker', async () => {
    // Tanpa chatJid, permintaan tidak bisa dijawab — jadi broker harus
    // menerimanya untuk decides sendiri.
    const { calls, broker } = buatBrokerRekam()
    const registry = new ToolRegistry({ approvals: broker, logger: { child: () => ({}), info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never })
    registry.register(toolKirim() as never)

    await registry.execute('test.kirim', { text: 'halo' }, buatKonteks({ chatJid: 'grup@g.us', correlationId: 'corr-xyz' }))

    expect(calls[0]).toMatchObject({ chatJid: 'grup@g.us', correlationId: 'corr-xyz' })
  })

  it('tool tanpa requiresApproval tetap jalan tanpa broker', async () => {
    const registry = new ToolRegistry({ logger: { child: () => ({}), info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never })
    registry.register(toolAman() as never)

    const hasil = await registry.execute('test.aman', { text: 'halo' }, buatKonteks())

    expect(hasil.success).toBe(true)
  })

  it('menjalankan tool kalau persetujuan disetujui', async () => {
    // 'approved' berarti boleh jalan — jadi harus dieksekusi.
    const registry = new ToolRegistry({
      approvals: { request: async () => 'approved' as const } as never,
      logger: { child: () => ({}), info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    })
    registry.register(toolKirim() as never)

    const hasil = await registry.execute('test.kirim', { text: 'halo' }, buatKonteks())

    expect(hasil.success).toBe(true)
  })

  it('menolak execution kalau pengguna menolak persetujuan', async () => {
    const registry = new ToolRegistry({
      approvals: { request: async () => 'rejected' as const } as never,
      logger: { child: () => ({}), info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    })
    registry.register(toolKirim() as never)

    const hasil = await registry.execute('test.kirim', { text: 'halo' }, buatKonteks())

    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      expect(hasil.error.code).toBe('PERMISSION_DENIED')
    }
  })
})