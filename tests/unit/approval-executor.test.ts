/**
 * Test executor tindakan yang sudah disetujui.
 *
 * Executor adalah tempat dua hal penting ini diuji:
 *
 *  1. Izin HARUS diulang saat eksekusi, bukan diasumsikan masih berlaku.
 *     Persetujuan bisa diberikan, lalu peran dicabut sebelum eksekusi. Kalau
 *     otorisasi tidak diulang, siapa pun yang pernah punya izin bisa
 *     menjalankan tindakan selamanya lewat approval yang sudah tertunda.
 *
 *  2. Satu persetujuan hanya boleh menghasilkan SATU eksekusi. Balasan "iya"
 *     yang dobel tidak boleh mengirim pesan dua kali.
 *
 *  3. Konteks dibangun dari baris `Approval` yang tersimpan di server, bukan
 *     dari argumen percakapan. Ini yang mencegah `organizationId` ikut
 *     dipalsukan.
 */
import { describe, expect, it } from 'vitest'
import { ToolApprovalExecutor } from '../../src/approvals/executor.js'

const PERMINSI_BEBAS = { check: async () => ({ allowed: true as const, reason: null }) }
const PERMINSI_TOLAK = {
  check: async () => ({ allowed: false as const, reason: 'izin dicabut' }),
}

type Baris = Record<string, unknown>

function buatDeps(options: {
  executedAt?: Date | null
  izin?: typeof PERMINSI_BEBAS | typeof PERMINSI_TOLAK
  baris?: Baris | null
  namaTool?: string
}) {
  const dipanggil: Array<{ payload: unknown; context: Record<string, unknown> }> = []
  const updated: Baris[] = []

  const prisma = {
    approval: {
      findFirst: async () =>
        options.baris === null
          ? null
          : {
              id: 'apv-1',
              organizationId: 'org-1',
              taskId: null,
              requestedBy: 'user-1',
              chatJid: '628@s.whatsapp.net',
              payload: { text: 'halo' },
              correlationId: 'corr-1',
              status: 'APPROVED',
              executedAt: options.executedAt ?? null,
            },
      update: async ({ data }: { data: Baris }) => {
        updated.push(data)
        return {}
      },
    },
  }

  const tools = {
    get: (name: string) => {
      if (name === (options.namaTool ?? 'whatsapp.send_message')) {
        return {
          name,
          requiredPermissions: ['whatsapp.send' as never],
          execute: async (payload: unknown, context: Record<string, unknown>) => {
            dipanggil.push({ payload, context })
            return { message: 'Pesan terkirim.' }
          },
        }
      }
      return undefined
    },
  }

  const executor = new ToolApprovalExecutor({
    prisma: prisma as never,
    tools: tools as never,
    authorization: { check: options.izin?.check ?? PERMINSI_BEBAS.check } as never,
  })

  return { executor, dipanggil, updated }
}

describe('ToolApprovalExecutor', () => {
  it('menjalankan tindakan dari payload yang tersimpan', async () => {
    const { executor, dipanggil, updated } = buatDeps({})

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp.send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(true)
    expect(hasil.summary).toBe('Pesan terkirim.')
    expect(dipanggil).toHaveLength(1)
    // Payload dari DATABASE, bukan dari argumen pemanggil.
    expect(dipanggil[0]!.payload).toEqual({ text: 'halo' })
    expect(updated[0]!.executedAt).toBeInstanceOf(Date)
  })

  it('MEMBANGUN konteks dari baris approval, bukan dari argumen', async () => {
    const { executor, dipanggil } = buatDeps({})

    await executor.executeApproved({
      toolName: 'whatsapp.send_message',
      // Penyerang mencoba mengarang konteks lewat argumen ini.
      payload: { text: 'x', organizationId: 'org-penyerang' } as never,
      correlationId: 'corr-1',
    })

    const context = dipanggil[0]!.context
    // Nilai diambil dari baris Approval, bukan dari input.
    expect(context.actorUserId).toBe('user-1')
    expect(context.organizationId).toBe('org-1')
    expect(context.chatJid).toBe('628@s.whatsapp.net')
  })

  it('TIDAK menjalankan kalau izin sudah dicabut setelah persetujuan', async () => {
    // Ini inti dari pengujian: persetujuan bukan bukti izin masih ada.
    const { executor, dipanggil, updated } = buatDeps({ izin: PERMINSI_TOLAK })

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp.send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(false)
    expect(hasil.summary).toContain('Izin')
    expect(dipanggil).toHaveLength(0)
    expect(updated).toHaveLength(0)
  })

  it('TIDAK menjalankan dua kali untuk approval yang sama', async () => {
    const { executor, dipanggil } = buatDeps({ executedAt: new Date() })

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp.send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(true)
    expect(hasil.summary).toContain('sudah dijalankan')
    expect(dipanggil).toHaveLength(0)
  })

  it('menolak kalau baris approval tidak ada', async () => {
    const { executor, dipanggil } = buatDeps({ baris: null })

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp.send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(false)
    expect(dipanggil).toHaveLength(0)
  })

  it('menolak kalau tool-nya sudah tidak terdaftar', async () => {
    const { executor, dipanggil } = buatDeps({ namaTool: 'tool.lain' })

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp.send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(false)
    expect(hasil.summary).toContain('tidak lagi tersedia')
    expect(dipanggil).toHaveLength(0)
  })

  it('menyelubungi kegagalan tool tanpa melempar error keluar', async () => {
    const { executor } = buatDeps({})
    const prismaGagal = {
      approval: {
        findFirst: async () => ({
          id: 'apv-1',
          organizationId: 'org-1',
          taskId: null,
          requestedBy: 'user-1',
          chatJid: '628@s.whatsapp.net',
          payload: {},
          correlationId: null,
          status: 'APPROVED',
          executedAt: null,
        }),
        update: async () => ({}),
      },
    }

    const executorGagal = new ToolApprovalExecutor({
      prisma: prismaGagal as never,
      tools: {
        get: () => ({
          name: 'x',
          requiredPermissions: [],
          execute: async () => {
            throw new Error('database sedang mati')
          },
        }),
      } as never,
      authorization: { check: PERMINSI_BEBAS.check } as never,
    })
    void executor

    const hasil = await executorGagal.executeApproved({
      toolName: 'x',
      payload: {},
      correlationId: null,
    })

    expect(hasil.ok).toBe(false)
    expect(hasil.summary).toContain('database sedang mati')
  })
})