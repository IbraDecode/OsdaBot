/**
 * Test penyaringan tool per skill.
 *
 * Menyaring tool bukan penghematan token. Diperiksa ke gateway sungguhan:
 *
 *     0 tool  ->   4 detik
 *     3 tool  ->  34 detik
 *    18 tool  -> >60 detik (timeout)
 *
 * Tanpa penyaringan, pesan paling sederhana pun tidak bisa dijawab.
 */
import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../src/tools/registry.js'
import type { ToolExecutionContext } from '../../src/tools/types.js'
import { PERMISSIONS } from '../../src/security/permissions.js'

const ctx = {
  actorUserId: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  conversationId: null,
  taskId: null,
  chatJid: '628@s.whatsapp.net',
  senderJid: '628@s.whatsapp.net',
  correlationId: 'test',
  timezone: 'Asia/Makassar',
  authorization: {
    check: async () => ({ allowed: true, reason: null }),
    checkMany: async (_actor: string, _org: string, permissions: string[]) => new Set(permissions),
  } as never,
} as ToolExecutionContext

const loggerPalsu = {
  child: () => loggerPalsu,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as never

function buatTool(nama: string, permission: string = PERMISSIONS.MEMBERS_READ) {
  return {
    name: nama,
    description: `Tool ${nama}.`,
    inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
    requiredPermissions: [permission],
    riskLevel: 'LOW',
    requiresApproval: false,
    execute: async () => ({ ok: true }),
  } as never
}

/** Registry dengan tiga tool yang meniru pembagian skill. */
function buatRegistry() {
  const registry = new ToolRegistry({ logger: loggerPalsu })
  registry.register(buatTool('attendance.create', PERMISSIONS.ATTENDANCE_CREATE))
  registry.register(buatTool('attendance.list_events', PERMISSIONS.ATTENDANCE_READ))
  registry.register(buatTool('organization.list_members', PERMISSIONS.MEMBERS_READ))
  return registry
}

describe('ToolRegistry.schemasFor', () => {
  it('mengirim SEMUA tool saat tidak ada filter', () => {
    // Pemanggil yang memang meminta semuanya tetap dapat semuanya.
    const registry = buatRegistry()
    return expect(registry.schemasFor(ctx)).resolves.toHaveLength(3)
  })

  it('BUG REGRESSION: `only: []` berarti default, BUKAN semua tool', () => {
    // Versi sebelumnya memberi perlakuan array kosong sebagai "filter tidak
    // berlaku" — sehingga pesan yang tidak cocok dengan skill mana pun
    // justru mengirim 18 tool lalu timeout. Arahnya terbalik.
    return expect(
      buatRegistry().schemasFor(ctx, { only: [], defaultToolNames: ['attendance.list_events'] }),
    ).resolves.toHaveLength(1)
  })

  it('mengirim tool yang diminta + default', async () => {
    const schemas = await buatRegistry().schemasFor(ctx, {
      only: ['attendance.create'],
      defaultToolNames: ['organization.list_members'],
    })

    const nama = schemas.map((s) => s.function.name).sort()
    expect(nama).toEqual(['attendance.create', 'organization.list_members'])
  })

  it('tool di luar daftar tidak ikut terkirim', async () => {
    const schemas = await buatRegistry().schemasFor(ctx, {
      only: ['attendance.create'],
      defaultToolNames: [],
    })

    expect(schemas.map((s) => s.function.name)).toEqual(['attendance.create'])
  })

  it('filter berlaku pada tool yang di luar daftar', async () => {
    const registry = new ToolRegistry({ logger: loggerPalsu })
    registry.register(buatTool('a', PERMISSIONS.MEMBERS_READ))
    registry.register(buatTool('b', PERMISSIONS.MEMBERS_READ))

    const schemas = await registry.schemasFor(ctx, { only: ['a'] })
    expect(schemas.map((s) => s.function.name)).toEqual(['a'])
  })

  it('TETAP memfilter permission walau filter tool diberikan', async () => {
    // Penyaringan skill bukan jalur pintas melewati RBAC. Kalau tool tidak
    // diizinkan, tidak boleh terkirim hanya karena ada filter.
    const ctxTegas = {
      ...ctx,
      authorization: {
        check: async () => ({ allowed: false, reason: 'DITOLAK' }),
        // Hanya mengizinkan satu izin tertentu.
        checkMany: async (_a: string, _o: string, permissions: string[]) =>
          new Set(permissions.filter((p) => p === PERMISSIONS.MEMBERS_READ)),
      } as never,
    }

    const registry = new ToolRegistry({ logger: loggerPalsu })
    registry.register(buatTool('boleh', PERMISSIONS.MEMBERS_READ))
    registry.register(buatTool('dilarang', PERMISSIONS.ATTENDANCE_CREATE))

    const schemas = await registry.schemasFor(ctxTegas, {
      only: ['boleh', 'dilarang'],
      defaultToolNames: [],
    })

    expect(schemas.map((s) => s.function.name)).toEqual(['boleh'])
  })
})