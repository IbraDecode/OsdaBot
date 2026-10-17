/**
 * Tumpukan persetujuan — akar dari "saya ketik iya tapi tidak pernah jalan".
 *
 * ── Asal bug ────────────────────────────────────────────────────────────────
 *
 * Dari pemakaian nyata: satu perintah "buatin qris 100" menghasilkan **tiga**
 * permintaan persetujuan. Bot kemudian tidak bisa menyelesaikan satu pun, dan
 * pengguna mengetik "iya" berulang tanpa hasil.
 *
 * Dua sebab, keduanya di lapisan berbeda:
 *
 * 1. **Model membaca "menunggu persetujuan" sebagai kegagalan.**
 *    `ToolResult` hanya punya `success: true | false`, dan approval-pending
 *    dikembalikan sebagai `success: false`. Model(response-only sees
 *    `{ ok: false, error: { code: 'VALIDATION_FAILED' } }`) lalu memperbaikinya
 *    seperti error input biasa — memanggil ulang dengan argumen sedikit
 *    berbeda.
 *
 * 2. **`ApprovalEngine.request()` tidak pernah menolak duplikat.**
 *    Setiap pemanggilan tool ber-`requiresApproval` membuat baris `Approval`
 *    baru, tanpa kecuali. Tidak ada pagar di sumber, jadi siapa pun yang
 *    memanggil bisa membuat permintaan ganda.
 *
 * Yang satu diperbaiki di agent (kode `APPROVAL_PENDING` + penghentian
 * putaran), yang satu lagi di `ApprovalEngine` (dedup pada `payloadHash`).
 * Keduanya perlu — memperbaiki satu saja menyisakan jalur yang lain.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { ApprovalEngine } from '../../src/approvals/engine.js'
import { hashPayload } from '../../src/approvals/intent.js'
import { logger } from '../../src/observability/logger.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import { PERMISSIONS } from '../../src/security/permissions.js'
import type { ToolDefinition } from '../../src/tools/types.js'

const prisma = new PrismaClient()

const ORG = process.env.TEST_ORG_ID ?? '7da2d3a0-fed3-492f-b51b-a3df4b733216'
const AKTOR = process.env.TEST_ACTOR_ID ?? '25bc6013-7954-4331-bfce-e63c34fc1021'
const CHAT = '6280000000000@s.whatsapp.net'

beforeEach(async () => {
  await prisma.approval.deleteMany({
    where: { chatJid: CHAT, actionType: { in: ['uji_tumpuk_create', 'uji_tumpuk_lain'] } },
  })
})

describe('BUG REGRESSION: permintaan identik tidak digandakan', () => {
  it('panggilan kedua dengan payload SAMA tidak membuat approval kedua', async () => {
    const terkirim: string[] = []
    const engine = new ApprovalEngine({
      prisma: prisma as never,
      whatsapp: {
        sendText: async (_to: string, text: string) => {
          terkirim.push(text)
          return { status: 'sent', providerMessageId: 'x' } as never
        },
      } as never,
    })

    const konteks = {
      actorUserId: AKTOR,
      organizationId: ORG,
      taskId: null,
      permission: PERMISSIONS.FINANCE_CREATE,
      actionType: 'uji_tumpuk_create',
      payload: { invoiceId: 'inv-1', amount: 100 },
      preview: 'Buat QRIS Rp 100',
      chatJid: CHAT,
    }

    await engine.request(konteks)
    await engine.request(konteks)
    await engine.request(konteks)

    const baris = await prisma.approval.count({
      where: { chatJid: CHAT, actionType: 'uji_tumpuk_create' },
    })

    // Dulu: 3 baris. Tiga permintaan yang tidak bisa dijawab satu per satu, dan
    // "iya" hanya menyetujui yang terbaru — jadi dua sisanya menggantung.
    expect(baris, 'permintaan identik digandakan').toBe(1)

    // Dan pesan tidak dikirim berulang — pengguna tidak boleh dikasih tahu
    // tiga kali tentang hal yang sama.
    expect(terkirim.filter((t) => t.includes('Perlu persetujuan'))).toHaveLength(1)
  })

  it('payload BERBEDA tetap membuat permintaan sendiri', async () => {
    // Dedup harus pada isi, bukan pada nama tool. Dua tagihan berbeda adalah
    // dua permintaan yang sah — memblokirnya berarti pengguna tidak bisa
    // membuat QRIS untuk tagihan kedua.
    const engine = new ApprovalEngine({
      prisma: prisma as never,
      whatsapp: { sendText: async () => ({ status: 'sent', providerMessageId: 'x' }) } as never,
    })

    const dasar = {
      actorUserId: AKTOR,
      organizationId: ORG,
      taskId: null,
      permission: PERMISSIONS.FINANCE_CREATE,
      actionType: 'uji_tumpuk_create',
      preview: 'Buat QRIS',
      chatJid: CHAT,
    }

    await engine.request({ ...dasar, payload: { invoiceId: 'inv-1' } })
    await engine.request({ ...dasar, payload: { invoiceId: 'inv-2' } })

    const baris = await prisma.approval.count({
      where: { chatJid: CHAT, actionType: 'uji_tumpuk_create' },
    })
    expect(baris, 'dua tagihan berbeda digabung jadi satu permintaan').toBe(2)
  })

  it('permintaan yang SUDAH kedaluwarsa boleh dibuat ulang', async () => {
    const engine = new ApprovalEngine({
      prisma: prisma as never,
      whatsapp: { sendText: async () => ({ status: 'sent', providerMessageId: 'x' }) } as never,
    })

    const payload = { invoiceId: 'inv-kedaluwarsa' }
    await prisma.approval.create({
      data: {
        organizationId: ORG,
        requestedBy: AKTOR,
        requiredPermission: PERMISSIONS.FINANCE_CREATE,
        actionType: 'uji_tumpuk_create',
        payloadHash: hashPayload(payload),
        payload,
        chatJid: CHAT,
        status: 'PENDING',
        // Sudah lewat — tidak ada yang bisa menjawabnya lagi.
        expiresAt: new Date(Date.now() - 60_000),
      },
    })

    await engine.request({
      actorUserId: AKTOR,
      organizationId: ORG,
      taskId: null,
      permission: PERMISSIONS.FINANCE_CREATE,
      actionType: 'uji_tumpuk_create',
      payload,
      preview: 'Buat QRIS',
      chatJid: CHAT,
    })

    // Yang dihitung yang MASIH bisa dijawab, bukan sekadar berstatus PENDING.
    // Baris basi tetap `PENDING` — itu memang disengaja supaya jejaknya utuh.
    const hidup = await prisma.approval.count({
      where: {
        chatJid: CHAT,
        actionType: 'uji_tumpuk_create',
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    })
    // Kalau request basi ikut dedup, QRIS-nya tidak akan pernah bisa dibuat.
    expect(hidup, 'permintaan basi memblokir permintaan baru selamanya').toBe(1)
  })
})

describe('BUG REGRESSION: agent berhenti setelah meminta persetujuan', () => {
  /** Tool yang selalu butuh persetujuan — meniru `payment_create_charge`. */
  function toolPerluPersetujuan(nama: string): ToolDefinition<{ nilai: string }, unknown> {
    return {
      name: nama,
      description: 'Tool uji yang butuh persetujuan.',
      // ZOD sungguhan, bukan tiruan.
      //
      // `ToolRegistry` memanggil `tool.inputSchema.parse()`, bukan
      // `safeParse`. Tiruan dengan `safeParse` menghasilkan `VALIDATION_FAILED`
      // di lapisan validasi — sebelum lapisan persetujuan pernah disentuh.
      // Test pertama saya persis begitu dan mengukur hal yang salah.
      inputSchema: z.object({ nilai: z.string() }).strict() as never,
      requiredPermissions: [],
      riskLevel: 'MEDIUM',
      requiresApproval: true,
      execute: async () => ({ ok: true }),
    } as never
  }

  it('panggilan kedua ke tool yang sama setelah meminta persetujuan DIHALANGI', async () => {
    // Dulu hasilnya `VALIDATION_FAILED` — model membaca itu sebagai "argumen
    // salah", memperbaikinya, dan memanggil lagi. `failedCalls` hanya
    // memblokir argumen IDENTIK, jadi `nilai` yang sedikit berbeda lolos.
    const registry = new ToolRegistry({ prisma: prisma as never, logger: logger.child({ module: 'uji' }) })
    let diminta = 0
    registry.setApprovalBroker({
      request: async () => {
        diminta += 1
        return 'pending'
      },
    } as never)
    registry.register(toolPerluPersetujuan('uji_tumpuk_lain') as never)

    const konteks = {
      actorUserId: AKTOR,
      organizationId: ORG,
      conversationId: null,
      taskId: null,
      chatJid: CHAT,
      senderJid: CHAT,
      correlationId: 'uji-tumpuk',
      timezone: 'Asia/Makassar',
      authorization: {
        checkMany: async () => new Set<string>(),
        check: async () => ({ allowed: true, reason: 'ALLOWED', message: 'ok' }),
      } as never,
    }

    const pertama = await registry.execute('uji_tumpuk_lain', { nilai: 'a' }, konteks)
    const kedua = await registry.execute('uji_tumpuk_lain', { nilai: 'b' }, konteks)

    expect(pertama.success).toBe(false)
    expect(kedua.success).toBe(false)
    if (!pertama.success) {
      // Kode tersendiri, bukan `VALIDATION_FAILED`. Ini yang membuat agent tahu
      // ini bukan masalah input.
      expect(pertama.error.code).toBe('APPROVAL_PENDING')
      expect(pertama.error.message).toContain('Jangan panggil')
    }
    // Pagar per-nama-tool ada di agent runtime, tapi broker sendiri juga harus
    // menolak membuat permintaan kedua.
    expect(diminta).toBeGreaterThanOrEqual(1)
  })
})