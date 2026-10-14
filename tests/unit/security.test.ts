import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AuthorizationService } from '../../src/security/authorization.js'
import { ToolRegistry, zodToJsonSchema } from '../../src/tools/registry.js'
import { fail, type ToolDefinition, type ToolExecutionContext } from '../../src/tools/types.js'
import { PERMISSIONS } from '../../src/security/permissions.js'

/**
 * Test keamanan yang MEMBUKTIKAN backend menolak tindakan.
 *
 * Ini adalah test yang paling penting di proyek: model AI bisa meminta
 * apa saja; backend harus tetap menolak.
 */

/** Logger minimal untuk test — cukup method yang dipakai AuthorizationService. */
function stubLogger() {
  return {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    child: () => stubLogger(),
  }
}

/** Stub Prisma hanya untuk jalur permission lookup. */
function makePrismaStub(permissions: string[]) {
  return {
    rolePermission: {
      findMany: vi.fn(async () => permissions.map((permissionId) => ({ permissionId }))),
    },
    toolExecution: { create: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
  }
}

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const stub = makePrismaStub([])
  const authorization = new AuthorizationService({
    prisma: stub as never,
    logger: stubLogger() as never,
    cacheTtlMs: 0,
  })

  return {
    actorUserId: 'actor-1',
    organizationId: 'org-1',
    conversationId: null,
    taskId: null,
    chatJid: '628123@s.whatsapp.net',
    senderJid: '628123@s.whatsapp.net',
    correlationId: 'test-correlation',
    timezone: 'Asia/Makassar',
    authorization,
    ...overrides,
  }
}

describe('AuthorizationService', () => {
  it('izin diberikan kalau permission dimiliki', async () => {
    const stub = makePrismaStub([PERMISSIONS.ATTENDANCE_READ])
    const authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const decision = await authorization.check({
      actorId: 'actor-1',
      organizationId: 'org-1',
      permission: PERMISSIONS.ATTENDANCE_READ,
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('ALLOWED')
  })

  it('izin DITOLAK kalau permission tidak dimiliki', async () => {
    const stub = makePrismaStub([PERMISSIONS.ATTENDANCE_READ])
    const authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const decision = await authorization.check({
      actorId: 'actor-1',
      organizationId: 'org-1',
      permission: PERMISSIONS.FINANCE_APPROVE,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('PERMISSION_DENIED')
  })

  it('DENY-ALL kalau aktor atau organisasi kosong', async () => {
    const authorization = new AuthorizationService({
      prisma: makePrismaStub([PERMISSIONS.ATTENDANCE_READ]) as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const tanpaAktor = await authorization.check({
      actorId: '',
      organizationId: 'org-1',
      permission: PERMISSIONS.ATTENDANCE_READ,
    })
    expect(tanpaAktor.allowed).toBe(false)
    expect(tanpaAktor.reason).toBe('UNAUTHENTICATED')

    const tanpaOrg = await authorization.check({
      actorId: 'actor-1',
      organizationId: '',
      permission: PERMISSIONS.ATTENDANCE_READ,
    })
    expect(tanpaOrg.allowed).toBe(false)
    expect(tanpaOrg.reason).toBe('UNAUTHENTICATED')
  })

  it('gagal CLOSED kalau database error — jangan buka akses diam-diam', async () => {
    const authorization = new AuthorizationService({
      prisma: {
        rolePermission: {
          findMany: vi.fn(async () => {
            throw new Error('database down')
          }),
        },
      } as never,
      // logger.child() harus mengembalikan objek yang punya .error
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const decision = await authorization.check({
      actorId: 'actor-1',
      organizationId: 'org-1',
      permission: PERMISSIONS.ATTENDANCE_READ,
    })
    expect(decision.allowed).toBe(false)
  })

  it('scope organisasi dipisah: izin di org-A tidak berlaku di org-B', async () => {
    const findMany = vi.fn(async () => [{ permissionId: PERMISSIONS.ATTENDANCE_READ }])
    const authorization = new AuthorizationService({
      prisma: { rolePermission: { findMany } } as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    await authorization.check({ actorId: 'a', organizationId: 'org-A', permission: PERMISSIONS.ATTENDANCE_READ })
    const diOrgLain = await authorization.check({
      actorId: 'a',
      organizationId: 'org-B',
      permission: PERMISSIONS.ATTENDANCE_READ,
    })

    // Query kedua harus menyertakan org-B, jadi hasilnya benar-benar di-scope.
    expect(diOrgLain.allowed).toBe(true)
    const calls = findMany.mock.calls as unknown as Array<[{ role: { organizationId: string } }]>
    const whereA = JSON.stringify(calls[0]?.[0] ?? '')
    const whereB = JSON.stringify(calls[1]?.[0] ?? '')
    expect(whereA).toContain('org-A')
    expect(whereB).toContain('org-B')
  })
})

describe('ToolRegistry — gerbang keamanan', () => {
  const dangerousTool: ToolDefinition<{ target: string }, { ok: boolean }> = {
    name: 'test.delete_all',
    description: 'Hapus semua data (untuk pengujian).',
    inputSchema: z.object({ target: z.string() }) as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_DELETE],
    riskLevel: 'HIGH',
    requiresApproval: true,
    execute: async () => ({ ok: true }),
  }

  it('menolak tool yang tidak terdaftar', async () => {
    const registry = new ToolRegistry({ prisma: makePrismaStub([]) as never })
    const result = await registry.execute('tidak.ada', {}, makeContext())
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('MENOLAK input yang tidak valid sebelum menyentuh logika tool', async () => {
    const stub = makePrismaStub([PERMISSIONS.MEMBERS_DELETE])
    const registry = new ToolRegistry({ prisma: stub as never })
    const executeSpy = vi.fn()
    registry.register({
      ...dangerousTool,
      execute: executeSpy as never,
    } as never)

    const context = makeContext()
    context.authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const result = await registry.execute('test.delete_all', { target: 123 }, context)
    expect(result.success).toBe(false)
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('MENOLAK tool kalau aktor tidak punya izin — walau AI memintanya', async () => {
    const stub = makePrismaStub([PERMISSIONS.ATTENDANCE_READ]) // BUKAN members.delete
    const registry = new ToolRegistry({ prisma: stub as never })
    const executeSpy = vi.fn()
    registry.register({ ...dangerousTool, execute: executeSpy as never } as never)

    const context = makeContext()
    context.authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const result = await registry.execute('test.delete_all', { target: 'semua' }, context)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PERMISSION_DENIED')
    }
    // Ini yang paling penting: fungsi tool TIDAK PERNAH dipanggil.
    expect(executeSpy).not.toHaveBeenCalled()
    expect(stub.auditLog.create).toHaveBeenCalled()
  })

  it('menolak kalau aktor tidak terautentikasi', async () => {
    const stub = makePrismaStub([PERMISSIONS.MEMBERS_DELETE])
    const registry = new ToolRegistry({ prisma: stub as never })
    const executeSpy = vi.fn()
    registry.register({ ...dangerousTool, execute: executeSpy as never } as never)

    const context = makeContext({ actorUserId: null })
    context.authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const result = await registry.execute('test.delete_all', { target: 'semua' }, context)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('membatasi jumlah tool call per putaran (anti loop)', async () => {
    const stub = makePrismaStub([PERMISSIONS.ATTENDANCE_READ])
    const registry = new ToolRegistry({ prisma: stub as never, maxCallsPerRun: 2 })
    registry.register({
      name: 'test.ping',
      description: 'Ping',
      inputSchema: z.object({}) as never,
      requiredPermissions: [PERMISSIONS.ATTENDANCE_READ],
      riskLevel: 'LOW',
      requiresApproval: false,
      execute: async () => ({ pong: true }),
    } as never)

    const context = makeContext()
    context.authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const ok = await registry.execute('test.ping', {}, context, 0)
    expect(ok.success).toBe(true)

    const limited = await registry.execute('test.ping', {}, context, 2)
    expect(limited.success).toBe(false)
    if (!limited.success) expect(limited.error.code).toBe('RATE_LIMITED')
  })

  it('WAKTU-waktu tinggi tidak boleh meloloskan tool berisiko tanpa persetujuan', async () => {
    const stub = makePrismaStub([PERMISSIONS.MEMBERS_DELETE])
    const executeSpy = vi.fn()
    const registry = new ToolRegistry({ prisma: stub as never })
    registry.register({ ...dangerousTool, execute: executeSpy as never } as never)
    registry.setApprovalBroker({ request: async () => 'rejected' })

    const context = makeContext()
    context.authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const result = await registry.execute('test.delete_all', { target: 'semua' }, context)
    expect(result.success).toBe(false)
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('schemasFor hanya menyertakan tool yang boleh dipakai aktor', async () => {
    const stub = makePrismaStub([PERMISSIONS.ATTENDANCE_READ])
    const registry = new ToolRegistry({ prisma: stub as never })
    registry.register({
      name: 'test.boleh',
      description: 'Boleh',
      inputSchema: z.object({ x: z.string() }) as never,
      requiredPermissions: [PERMISSIONS.ATTENDANCE_READ],
      riskLevel: 'LOW',
      requiresApproval: false,
      execute: async () => ({}),
    } as never)
    registry.register({ ...dangerousTool } as never)

    const context = makeContext()
    context.authorization = new AuthorizationService({
      prisma: stub as never,
      logger: stubLogger() as never,
      cacheTtlMs: 0,
    })

    const schemas = await registry.schemasFor(context)
    const names = schemas.map((s) => s.function.name)
    expect(names).toContain('test.boleh')
    expect(names).not.toContain('test.delete_all')
  })

  it('menolak pendaftaran tool dengan nama duplikat', () => {
    const registry = new ToolRegistry({ prisma: makePrismaStub([]) as never })
    registry.register(dangerousTool as never)
    expect(() => registry.register(dangerousTool as never)).toThrow(/sudah terdaftar/)
  })
})

describe('zodToJsonSchema', () => {
  it('mengubah string dengan batas jadi JSON Schema', () => {
    const schema = zodToJsonSchema(z.object({ name: z.string().min(1).max(10) }))
    expect(schema).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 10 } },
      required: ['name'],
    })
  })

  it('menandai field opsional sebagai tidak wajib', () => {
    const schema = zodToJsonSchema(z.object({ a: z.string(), b: z.string().optional() }))
    expect(schema.required).toEqual(['a'])
  })

  it('menangani array dan enum', () => {
    const schema = zodToJsonSchema(
      z.object({ status: z.enum(['A', 'B']), tags: z.array(z.string()) }),
    ) as { properties: Record<string, { enum?: string[]; type?: string; items?: unknown }> }
    expect(schema.properties.status?.enum).toEqual(['A', 'B'])
    expect(schema.properties.tags?.type).toBe('array')
  })

  it('menetapkan additionalProperties false supaya AI tidak mengarang field', () => {
    const schema = zodToJsonSchema(z.object({ a: z.string() }))
    expect(schema.additionalProperties).toBe(false)
  })
})

describe('fail()', () => {
  it('membentuk ToolResult gagal yang konsisten', () => {
    const result = fail('NOT_FOUND', 'Data tidak ada.')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.message).toBe('Data tidak ada.')
      expect(result.error.retryable).toBe(false)
    }
  })
})