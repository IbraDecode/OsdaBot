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
  /** Jejak pencatatan yang dikirim ke registry. */
  const jejak: Array<{
    toolName: string
    outcome: 'success' | 'failure'
    actorUserId: string | null
    organizationId: string | null
  }> = []

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
    /**
     * Wajib ada — `ToolApprovalExecutor` memanggilnya setelah setiap tindakan.
     *
     * Kalau ini dihapus dari double, `catatEksekusiLuar is not a function`
     * menggagalkan test. Itu memang mengganggu, tapi lebih baik daripada
     * pencatatan yang hilang diam-diam di produksi.
     */
    catatEksekusiLuar: async (params: {
      toolName: string
      input: unknown
      actorUserId: string | null
      organizationId: string | null
      correlationId: string
      outcome: 'success' | 'failure'
      errorCode?: string | null
      durationMs?: number
    }) => {
      jejak.push({
        toolName: params.toolName,
        outcome: params.outcome,
        actorUserId: params.actorUserId,
        organizationId: params.organizationId,
      })
    },
    get: (name: string) => {
      if (name === (options.namaTool ?? 'whatsapp_send_message')) {
        return {
          name,
          requiredPermissions: ['whatsapp_send' as never],
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

  return { executor, dipanggil, updated, jejak }
}

describe('ToolApprovalExecutor', () => {
  it('menjalankan tindakan dari payload yang tersimpan', async () => {
    const { executor, dipanggil, updated, jejak } = buatDeps({})

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp_send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(true)
    expect(hasil.summary).toBe('Pesan terkirim.')
    expect(dipanggil).toHaveLength(1)

    // BUG REGRESSION: tindakan yang lewat approval harus tercatat. Jalur ini
    // melewati `ToolRegistry.execute`, jadi kalau executor tidak mencatat
    // sendiri, `ToolExecution` tidak akan pernah punya baris untuk tool yang
    // paling berisiko — dan monitoring buta tepat di sana.
    expect(jejak).toHaveLength(1)
    expect(jejak[0]!.outcome).toBe('success')
    expect(jejak[0]!.toolName).toBe('whatsapp_send_message')
    // Payload dari DATABASE, bukan dari argumen pemanggil.
    expect(dipanggil[0]!.payload).toEqual({ text: 'halo' })
    expect(updated[0]!.executedAt).toBeInstanceOf(Date)
  })

  it('MEMBANGUN konteks dari baris approval, bukan dari argumen', async () => {
    const { executor, dipanggil } = buatDeps({})

    await executor.executeApproved({
      toolName: 'whatsapp_send_message',
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
      toolName: 'whatsapp_send_message',
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
      toolName: 'whatsapp_send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
      approvalId: 'apv-1',
      organizationId: 'org-1',
    })

    // BUG REGRESSION: `ok` HARUS `false` di sini.
    //
    // Versi lama mengembalikan `ok: true` untuk approval yang sudah dieksekusi
    // — menyatakan tindakan berhasil padahal tidak ada yang dijalankan.
    // `AGENTS.md` melarang klaim sukses tanpa hasil tool yang mendukungnya.
    //
    // Dan efeknya bukan cuma kalimat yang salah: baris yang sebenarnya
    // menunggu eksekusi tertinggal `APPROVED` + `executedAt` kosong selamanya,
    // karena tidak ada worker yang mengambilnya.
    expect(hasil.ok).toBe(false)
    expect(hasil.summary).toContain('sudah dijalankan')
    expect(dipanggil).toHaveLength(0)
  })

  it('BUG REGRESSION: mencari approval yang BENAR, bukan yang terbaru', async () => {
    // Skenario nyata dari pemakaian: satu jalan agent membuat DUA approval
    // untuk tool yang sama (model memanggil dua kali). Yang pertama dieksekusi.
    // Lalu user menekan "iya" untuk yang kedua.
    //
    // `loadApproval` versi lama mencari `status: APPROVED` + correlationId yang
    // sama dengan `orderBy createdAt desc` — TANPA memfilter `executedAt`.
    // Jadi dia mengembalikan approval PERTAMA yang sudah dieksekusi, dan
    // yang kedua menggantung tanpa pernah dijalankan.
    const dipanggilPerApproval = new Map<string, number>()
    const prismaPalsu = {
      approval: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          const w = args.where
          if (w.id === 'apv-menunggu') {
            return {
              id: 'apv-menunggu',
              organizationId: 'org-1',
              taskId: null,
              requestedBy: 'user-1',
              chatJid: '628@s.whatsapp.net',
              payload: { text: 'yang benar' },
              correlationId: 'corr-1',
              status: 'APPROVED',
              executedAt: null,
            }
          }
          return {
            id: 'apv-sudah',
            organizationId: 'org-1',
            taskId: null,
            requestedBy: 'user-1',
            chatJid: '628@s.whatsapp.net',
            payload: { text: 'yang salah' },
            correlationId: 'corr-1',
            status: 'APPROVED',
            executedAt: new Date(),
          }
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          dipanggilPerApproval.set(args.where.id, (dipanggilPerApproval.get(args.where.id) ?? 0) + 1)
          return {}
        },
      },
    }

    const executor = new ToolApprovalExecutor({
      prisma: prismaPalsu as never,
      tools: {
        catatEksekusiLuar: async () => {},
        get: () => ({
          name: 'whatsapp_send_message',
          requiredPermissions: [],
          execute: async (payload: unknown) => ({ text: (payload as { text: string }).text }),
        }),
      } as never,
      authorization: { check: PERMINSI_BEBAS.check } as never,
    })

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp_send_message',
      payload: { text: 'yang benar' },
      correlationId: 'corr-1',
      approvalId: 'apv-menunggu',
      organizationId: 'org-1',
    })

    expect(hasil.ok).toBe(true)
    // Baris yang BENAR yang ditandai terEksekusi, bukan yang sudah selesai.
    expect(dipanggilPerApproval.has('apv-menunggu')).toBe(true)
    expect(dipanggilPerApproval.has('apv-sudah')).toBe(false)
  })

  it('BUG REGRESSION: TIDAK jatuh ke approval organisasi lain', async () => {
    // Tanpa pagar `organizationId`, pencarian buta bisa menjatuhkan payload
    // milik organisasi lain lalu menjalankannya dengan konteks yang salah.
    const prismaPalsu = {
      approval: {
        findFirst: async () => null,
        update: async () => ({}),
      },
    }
    const executor = new ToolApprovalExecutor({
      prisma: prismaPalsu as never,
      tools: { catatEksekusiLuar: async () => {}, get: () => undefined } as never,
      authorization: { check: PERMINSI_BEBAS.check } as never,
    })

    // Tanpa `organizationId`, pencarian buta DITOLAK — lebih aman daripada
    // menjalankan payload milik orang lain.
    const tanpaOrg = await executor.executeApproved({
      toolName: 'whatsapp_send_message',
      payload: { text: 'x' },
      correlationId: null,
    })
    expect(tanpaOrg.ok).toBe(false)

    // Dengan `organizationId`, pencarian tetap terjadi — tapi terkurung.
    let dipanggilDenganFilter = false
    const prismaTerfilter = {
      approval: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          dipanggilDenganFilter = args.where.organizationId === 'org-1'
          return null
        },
        update: async () => ({}),
      },
    }
    const executor2 = new ToolApprovalExecutor({
      prisma: prismaTerfilter as never,
      tools: { catatEksekusiLuar: async () => {}, get: () => undefined } as never,
      authorization: { check: PERMINSI_BEBAS.check } as never,
    })
    await executor2.executeApproved({
      toolName: 'whatsapp_send_message',
      payload: { text: 'x' },
      correlationId: null,
      organizationId: 'org-1',
    })
    expect(dipanggilDenganFilter, 'pencarian approval tidak difilter organisasi').toBe(true)
  })

  it('menolak kalau baris approval tidak ada', async () => {
    const { executor, dipanggil } = buatDeps({ baris: null })

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp_send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(false)
    expect(dipanggil).toHaveLength(0)
  })

  it('menolak kalau tool-nya sudah tidak terdaftar', async () => {
    const { executor, dipanggil } = buatDeps({ namaTool: 'tool.lain' })

    const hasil = await executor.executeApproved({
      toolName: 'whatsapp_send_message',
      payload: { text: 'halo' },
      correlationId: 'corr-1',
    })

    expect(hasil.ok).toBe(false)
    expect(hasil.summary).toContain('tidak lagi tersedia')
    expect(dipanggil).toHaveLength(0)
  })

  it('kegagalan tool menandai approval FAILED, bukan menggantung', async () => {
    const updateTercatat: Array<{ where: { id: string }; data: Record<string, unknown> }> = []
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
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updateTercatat.push(args)
          return {}
        },
      },
    }

    const executorGagal = new ToolApprovalExecutor({
      prisma: prismaGagal as never,
      tools: {
        // Wajib ada — kalau hilang, kegagalan tool tidak akan tercatat, dan
        // itu justru kondisi yang paling perlu terlihat.
        catatEksekusiLuar: async () => {},
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
      // Tanpa ini, pencarian buta ditolak dan test mengukur hal yang salah.
      organizationId: 'org-1',
      approvalId: 'apv-1',
    })

    expect(hasil.ok).toBe(false)
    expect(hasil.summary).toContain('database sedang mati')

    // BUG REGRESSION: kegagalan harus meninggalkan status TERMINAL.
    //
    // Dulu baris tetap `APPROVED` dengan `executedAt` kosong. Tidak ada yang
    // mengambilnya: `tryHandleReply` cuma cari `PENDING`, `expireStale()` juga
    // cuma `PENDING`, dan tidak ada worker pemulihan. Satu kegagalan sementara
    // membakar persetujuan itu selamanya.
    const updateTerakhir = updateTercatat.at(-1)
    expect(updateTerakhir?.data, 'kegagalan tidak menandai status terminal').toMatchObject({
      status: 'FAILED',
    })
  })

  it('BUG REGRESSION: cabang correlationId juga WAJIB memfilter executedAt', async () => {
    // Tanpa `approvalId`, executor mencari lewat `correlationId`. Cabang itu
    // harus menyaring `executedAt: null` seperti cabang fallback.
    //
    // Kalau tidak: `orderBy createdAt desc` mengembalikan approval yang SUDAH
    // dijalankan, approval yang sebenarnya menunggu tertinggal menggantung, dan
    // pengguna diberi "sudah dijalankan sebelumnya" padahal tidak ada yang
    // dijalankan.
    // Semua `where` dicatat, BUKAN hanya yang terakhir.
    //
    // Percobaan pertama menyimpan `where` terakhir saja — dan pencarian
    // fallback menimpanya, sehingga test memeriksa filter fallback yang memang
    // selalu punya `executedAt`. Test itu lulus walau cabang yang diuji sudah
    // dirusak.
    const semuaWhere: Array<Record<string, unknown>> = []
    const prismaPalsu = {
      approval: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          semuaWhere.push(args.where)
          return null
        },
        update: async () => ({}),
      },
    }

    const executor = new ToolApprovalExecutor({
      prisma: prismaPalsu as never,
      tools: { catatEksekusiLuar: async () => {}, get: () => undefined } as never,
      authorization: { check: PERMINSI_BEBAS.check } as never,
    })

    await executor.executeApproved({
      toolName: 'whatsapp_send_message',
      payload: { text: 'x' },
      correlationId: 'corr-1',
      organizationId: 'org-1',
    })

    const perCorrelationId = semuaWhere.find((w) => w.correlationId === 'corr-1')
    expect(perCorrelationId, 'cabang correlationId tidak dijalankan').toBeTruthy()
    expect(
      perCorrelationId!.executedAt,
      'pencarian per-correlationId tidak menyaring executedAt',
    ).toBeNull()
    expect(perCorrelationId!.organizationId, 'pencarian tidak dibatasi organisasi').toBe('org-1')
  })
})
