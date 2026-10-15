/**
 * Test pemetaan error tool.
 *
 * Bug nyata yang ditemukan lewat pengujian live: setiap `ToolError` yang
 * dilempar tool tercatat sebagai `INTERNAL_ERROR`.
 *
 * Akibatnya agent menerima "Terjadi kendala di sistem" untuk semua kegagalan —
 * termasuk "Belum ada daftar kehadiran di organisasi ini". Model lalu tidak
 * bisa membedakan "coba lagi" dari "sudah tidak ada datanya", dan sering
 * memanggil tool yang salah berulang.
 */
import { describe, expect, it } from 'vitest'
import { ToolRegistry, mapToolErrorForTest } from '../../src/tools/registry.js'
import { ToolError, type ToolExecutionContext } from '../../src/tools/types.js'
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
    checkMany: async (_a: string, _o: string, p: string[]) => new Set(p),
  } as never,
} as ToolExecutionContext

const loggerPalsu = {
  child: () => loggerPalsu,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as never

describe('ToolError dipetakan ke kodenya sendiri', () => {
  it('BUG REGRESSION: NOT_FOUND tidak jadi INTERNAL_ERROR', () => {
    // Ini yang terjadi: `attendance.get` tanpa daftar aktif melempar
    // NOT_FOUND, tapi tercatat INTERNAL_ERROR dan pesannya hilang.
    const mapped = mapToolErrorForTest(new ToolError('NOT_FOUND', 'Belum ada daftar kehadiran di organisasi ini.'))

    expect(mapped.code).toBe('NOT_FOUND')
    // `mapped` adalah union; `code` ada di kedua cabang.
    expect('error' in mapped && mapped.error.message).toContain('Belum ada daftar kehadiran')
  })

  it('menjaga SEMUA kode ToolError', () => {
    const kode = [
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'PERMISSION_DENIED',
      'NOT_FOUND',
      'RESOURCE_SCOPE_MISMATCH',
      'AMBIGUOUS_REFERENCE',
      'CONFLICT',
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'INTERNAL_ERROR',
    ] as const

    for (const code of kode) {
      expect(mapToolErrorForTest(new ToolError(code, `pesan ${code}`)).code, code).toBe(code)
    }
  })

  it('menjaga retryable dari ToolError', () => {
    // Info retryable penting: agent tidak boleh mencoba ulang kesalahan yang
    // tidak akan berubah, misalnya "tidak ditemukan".
    const tidakAda = mapToolErrorForTest(new ToolError('NOT_FOUND', 'x'))
    const bisaDiulang = mapToolErrorForTest(new ToolError('INTERNAL_ERROR', 'x', true))

    expect('error' in tidakAda && tidakAda.error.retryable).toBe(false)
    expect('error' in bisaDiulang && bisaDiulang.error.retryable).toBe(true)
  })

  it('menjaga details untuk log', () => {
    const mapped = mapToolErrorForTest(new ToolError('VALIDATION_FAILED', 'x', false, { field: 'judul' }))
    expect('error' in mapped && mapped.error.details).toEqual({ field: 'judul' })
  })

  it('error biasa tetap dipetakan ke INTERNAL_ERROR', () => {
    expect(mapToolErrorForTest(new Error('blow up')).code).toBe('INTERNAL_ERROR')
  })

  it('kode domain kustom tetap dipetakan', () => {
    // Daftar error lama harus tetap berlaku.
    const err = new Error('Anggota tidak ketemu') as Error & { code: string }
    err.code = 'MEMBER_NOT_FOUND'
    expect(mapToolErrorForTest(err).code).toBe('MEMBER_NOT_FOUND')
  })

  it('P2002 tetap jadi CONFLICT', () => {
    const err = new Error('unique') as Error & { code: string; name: string }
    err.code = 'P2002'
    err.name = 'PrismaClientKnownRequestError'
    expect(mapToolErrorForTest(err).code).toBe('CONFLICT')
  })
})

describe('error tool terlihat di hasil execute', () => {
  it('ToolError dari tool diteruskan apa adanya ke agent', async () => {
    // Uji end-to-end di registry: bukan hanya fungsi pemetaan.
    const registry = new ToolRegistry({ logger: loggerPalsu })

    registry.register({
      name: 'uji.gagal',
      description: 'Tool yang selalu gagal dengan NOT_FOUND.',
      inputSchema: { parse: (v: unknown) => v } as never,
      requiredPermissions: [PERMISSIONS.MEMBERS_READ],
      riskLevel: 'LOW',
      requiresApproval: false,
      execute: async () => {
        throw new ToolError('NOT_FOUND', 'Belum ada daftar kehadiran di organisasi ini.')
      },
    } as never)

    const hasil = await registry.execute('uji.gagal', {}, ctx)

    expect(hasil.success).toBe(false)
    if (!hasil.success) {
      expect(hasil.error.code).toBe('NOT_FOUND')
      expect(hasil.error.message).toContain('Belum ada daftar kehadiran')
      // Pesan asli harus sampai ke agent supaya bisa ditindaklanjuti.
      expect(hasil.error.message).not.toContain('Terjadi kendala di sistem')
    }
  })
})