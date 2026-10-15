/**
 * Test mesin persetujuan.
 *
 * Fokusnya bukan "kode jalan", tapi "kode MENOLAK hal yang seharusnya ditolak".
 * Kegagalan di sini berarti tindakan bisa dijalankan tanpa persetujuan yang
 * sah — itu kegagalan keamanan, bukan bug biasa.
 */
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  hashPayload,
  normalizeReply,
  parseApprovalIntent,
} from '../../src/approvals/intent.js'
import { ApprovalEngine } from '../../src/approvals/engine.js'

// ── Parser niat ─────────────────────────────────────────────────────────────

describe('parseApprovalIntent', () => {
  it('mengenali persetujuan yang jelas', () => {
    for (const text of ['iya', 'Iya', 'YA', 'iya!', ' ok ', 'setuju', 'kirim', 'boleh']) {
      expect(parseApprovalIntent(text), text).toBe('approve')
    }
  })

  it('mengenali pembatalan yang jelas', () => {
    for (const text of ['batal', 'Batal!', 'jangan', 'tidak', 'nanti dulu', 'stop']) {
      expect(parseApprovalIntent(text), text).toBe('reject')
    }
  })

  it('mengenali pembatalan semua', () => {
    expect(parseApprovalIntent('batal semua')).toBe('reject_all')
  })

  it('menyerahkan kalimat ambigu ke agent, bukan menebaknya', () => {
    // Hasil yang benar di sini adalah 'none' — pesan diteruskan ke agent
    // yang punya konteks penuh.
    //
    // Parser tidak boleh memutuskan. "tidak boleh kirim ke grup" secara
    // semantik berarti batal, tapi konteksnya bisa berbeda; salah membaca
    // berarti membatalkan tindakan yang memang harus berjalan, atau sebaliknya.
    const ambigu = [
      'iya coba dong',
      'boleh tidak',
      'kirim ya besok',
      'tidak boleh kirim ke grup',
      'oke jadi besok rapat ya',
      'siap, tapi nanti saja',
      'jangan ke semua, hanya ke ketua',
    ]
    for (const text of ambigu) {
      expect(parseApprovalIntent(text), text).toBe('none')
    }
  })

  it('TIDAK memakai substring matching', () => {
    // Kalau pakai `includes`, teks-teks ini akan salah dianggap persetujuan.
    expect(parseApprovalIntent('iyausername')).toBe('none')
    expect(parseApprovalIntent('sayaboleh')).toBe('none')
    expect(parseApprovalIntent('oktober')).toBe('none')
    expect(parseApprovalIntent('stopped')).toBe('none')
  })

  it('menolak pesan panjang walau isinya persetujuan', () => {
    expect(parseApprovalIntent('iya '.repeat(30))).toBe('none')
    expect(parseApprovalIntent('iya ' + 'a'.repeat(60))).toBe('none')
  })

  it('menangani input null, kosong, dan tanpa teks', () => {
    expect(parseApprovalIntent(null)).toBe('none')
    expect(parseApprovalIntent(undefined)).toBe('none')
    expect(parseApprovalIntent('')).toBe('none')
    expect(parseApprovalIntent('   ')).toBe('none')
  })

  it('membuang emoji dan tanda baca', () => {
    expect(parseApprovalIntent('✅')).toBe('none')
    expect(parseApprovalIntent('👍')).toBe('none')
    expect(parseApprovalIntent('🙏')).toBe('none')
    expect(parseApprovalIntent('✅ iya ✅')).toBe('approve')
  })

  it('bukan "none" berarti dokumen harus mengulang kalimat lengkap', () => {
    // Pengaman: kalau reviewer menambah kata baru, test ini memaksa
    // dia stumbled pada jawaban default yang dipakai pengguna.
    expect(parseApprovalIntent('mungkin nanti')).toBe('none')
  })
})

describe('normalizeReply', () => {
  it('menurunkan huruf dan merapikan spasi', () => {
    expect(normalizeReply('  IYA   dong  ')).toBe('iya dong')
  })

  it('membuang tanda baca', () => {
    expect(normalizeReply('iya!!!...')).toBe('iya')
  })
})

// ── Hash payload ────────────────────────────────────────────────────────────

describe('hashPayload', () => {
  it('stabil terhadap urutan kunci', () => {
    // Tanpa pengurutan kunci, hash berubah hanya karena urutan — dan
    // validasi payloadHash akan menolak persetujuan yang sah.
    const a = { to: '628@s.whatsapp.net', text: 'halo' }
    const b = { text: 'halo', to: '628@s.whatsapp.net' }
    expect(hashPayload(a)).toBe(hashPayload(b))
  })

  it('berbeda untuk isi berbeda', () => {
    expect(hashPayload({ text: 'halo' })).not.toBe(hashPayload({ text: 'halo2' }))
  })

  it('berbeda untuk tipe berbeda', () => {
    expect(hashPayload({ n: 1 })).not.toBe(hashPayload({ n: '1' }))
  })

  it('stabil pada nested object', () => {
    const a = { x: { p: 1, q: 2 }, y: [1, 2] }
    const b = { y: [1, 2], x: { q: 2, p: 1 } }
    expect(hashPayload(a)).toBe(hashPayload(b))
  })

  it('menangani null dan array', () => {
    expect(hashPayload(null)).toBeTypeOf('string')
    expect(hashPayload([1, 2, 3])).toBe(hashPayload([1, 2, 3]))
    expect(hashPayload([1, 2, 3])).not.toBe(hashPayload([3, 2, 1]))
  })

  it('canonicalJson mengurutkan kunci secara rekursif', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}')
  })
})

// ── Keamanan engine ────────────────────────────────────────────────────────

/** Test double Prisma yang cukup untuk menguji aturan engine. */
function buatPrismaPalsu(options: {
  approval?: Partial<Record<string, unknown>> | null
  updateManyCount?: number
}) {
  const state = {
    created: [] as Array<Record<string, unknown>>,
    updated: [] as Array<Record<string, unknown>>,
    approval: options.approval ?? null,
  }

  const prisma = {
    approval: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data)
        return { id: 'apv-00000000-0000-0000-0000-000000000001' }
      },
      findFirst: async () => state.approval,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        state.updated.push(data)
        return { count: options.updateManyCount ?? 1 }
      },
      update: async () => ({}),
    },
  }

  return { prisma, state }
}

function buatWhatsAppPalsu() {
  const terkirim: Array<{ to: string; text: string }> = []
  return {
    terkirim,
    whatsapp: {
      sendText: async (to: string, text: string) => {
        terkirim.push({ to, text })
        return { status: 'sent' as const, messageId: 'x' }
      },
    } as never,
  }
}

describe('ApprovalEngine.request', () => {
  it('menyimpan payload, hash, dan chat tujuan', async () => {
    const { prisma, state } = buatPrismaPalsu({})
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    const payload = { to: '628@s.whatsapp.net', text: 'halo' }
    const hasil = await engine.request({
      actorUserId: 'user-1',
      organizationId: 'org-1',
      taskId: null,
      permission: 'whatsapp_send' as never,
      actionType: 'whatsapp_send_message',
      payload,
      preview: 'Kirim: halo',
      chatJid: '628@s.whatsapp.net',
      correlationId: 'corr-1',
    })

    expect(hasil).toBe('pending')

    const tersimpan = state.created[0]!
    expect(tersimpan.payloadHash).toBe(hashPayload(payload))
    expect(tersimpan.payload).toEqual(payload)
    expect(tersimpan.chatJid).toBe('628@s.whatsapp.net')
    expect(tersimpan.correlationId).toBe('corr-1')
    expect(tersimpan.status).toBe('PENDING')

    // Permintaan harus sampai ke chat yang benar.
    expect(terkirim).toHaveLength(1)
    expect(terkirim[0]!.to).toBe('628@s.whatsapp.net')
    expect(terkirim[0]!.text).toContain('Kirim: halo')
    expect(terkirim[0]!.text).toContain('iya')
  })

  it('TIDAK mengirim apa pun kalau chat tujuan kosong', async () => {
    const { prisma } = buatPrismaPalsu({})
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    await engine.request({
      actorUserId: 'user-1',
      organizationId: 'org-1',
      taskId: null,
      permission: 'whatsapp_send' as never,
      actionType: 'whatsapp_send_message',
      payload: {},
      preview: 'x',
    })

    // Permintaan dicatat tapi tidak bisa dijawab — lebih baik begitu
    // daripada diam-diam menjalankan tindakan.
    expect(terkirim).toHaveLength(0)
  })
})

describe('ApprovalEngine.tryHandleReply', () => {
  const dasar = {
    chatJid: '628@s.whatsapp.net',
    actorUserId: 'user-1',
  }

  it('menolak orang yang BUKAN pemohon', async () => {
    // Di grup, siapa pun bisa mengetik "iya". Kalau ini lolos, anggota biasa
    // bisa menyetujui tindakan operator.
    const { prisma, state } = buatPrismaPalsu({
      approval: {
        id: 'apv-1',
        actionType: 'whatsapp_send_message',
        payloadPreview: 'Kirim: halo',
        payloadHash: hashPayload({}),
        payload: {},
        correlationId: null,
      },
    })
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    // Query-nya sudah difilter `requestedBy: actorUserId` di engine, jadi
    // kalau orangnya berbeda, tidak ada approval yang ditemukan.
    prisma.approval.findFirst = async () => null

    const hasil = await engine.tryHandleReply({ ...dasar, text: 'iya' })

    expect(hasil).toBe('reject')
    expect(state.updated).toHaveLength(0)
    expect(terkirim[0]!.text).toContain('Tidak ada tindakan')
  })

  it('menolak bila identitas pengirim tidak diketahui', async () => {
    const { prisma, state } = buatPrismaPalsu({ approval: null })
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    const hasil = await engine.tryHandleReply({ chatJid: 'x@s.whatsapp.net', actorUserId: null, text: 'iya' })

    expect(hasil).toBe('reject')
    expect(state.updated).toHaveLength(0)
    expect(terkirim[0]!.text).toContain('hanya bisa diberikan')
  })

  it('membatalkan saat user menjawab batal', async () => {
    const { prisma, state } = buatPrismaPalsu({
      approval: {
        id: 'apv-1',
        actionType: 'whatsapp_send_message',
        payloadPreview: 'Kirim: halo',
        payloadHash: hashPayload({}),
        payload: {},
        correlationId: null,
      },
    })
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    const hasil = await engine.tryHandleReply({ ...dasar, text: 'batal' })

    expect(hasil).toBe('reject')
    expect(state.updated[0]!.status).toBe('REJECTED')
    expect(terkirim[0]!.text).toContain('Dibatalkan')
  })

  it('MEMBATALKAN persetujuan kalau payload berubah', async () => {
    // Persetujuan "kirim ringkasan ini" tidak boleh bisa dipakai untuk
    // mengirim data yang jauh lebih banyak.
    const { prisma, state } = buatPrismaPalsu({
      approval: {
        id: 'apv-1',
        actionType: 'whatsapp_send_message',
        payloadPreview: 'Kirim: halo',
        payloadHash: hashPayload({ text: 'ringkasan singkat' }),
        payload: { text: 'SEMUA DATA ANGGOTA' },
        correlationId: null,
      },
    })
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    let dieksekusi = false
    const engine2 = new ApprovalEngine({
      prisma: prisma as never,
      whatsapp,
      executor: { executeApproved: async () => { dieksekusi = true; return { ok: true, summary: 'x' } } },
    })
    void engine

    const hasil = await engine2.tryHandleReply({ ...dasar, text: 'iya' })

    expect(hasil).toBe('reject')
    expect(dieksekusi).toBe(false)
    expect(state.updated[0]!.status).toBe('CANCELLED')
    expect(terkirim[0]!.text).toContain('sudah berubah')
  })

  it('menjalankan tindakan setelah disetujui', async () => {
    const payload = { text: 'ringkasan' }
    const { prisma, state } = buatPrismaPalsu({
      approval: {
        id: 'apv-1',
        actionType: 'whatsapp_send_message',
        payloadPreview: 'Kirim: ringkasan',
        payloadHash: hashPayload(payload),
        payload,
        correlationId: 'corr-1',
      },
    })
    const { whatsapp, terkirim } = buatWhatsAppPalsu()

    let dipanggil = 0
    const engine = new ApprovalEngine({
      prisma: prisma as never,
      whatsapp,
      executor: {
        executeApproved: async (input) => {
          dipanggil += 1
          expect(input.toolName).toBe('whatsapp_send_message')
          expect(input.payload).toEqual(payload)
          expect(input.correlationId).toBe('corr-1')
          return { ok: true, summary: 'Pesan terkirim.' }
        },
      },
    })

    const hasil = await engine.tryHandleReply({ ...dasar, text: 'iya' })

    expect(hasil).toBe('approve')
    expect(dipanggil).toBe(1)
    expect(state.updated[0]!.status).toBe('APPROVED')
    expect(terkirim.some((m) => m.text === 'Pesan terkirim.')).toBe(true)
  })

  it('TIDAK menjalankan dua kali walau "iya" tiba dua kali', async () => {
    // `updateMany` bersyarat PENDING: kalau sudah ada yang menang, count = 0
    // dan tidak ada eksekusi kedua.
    const payload = { text: 'x' }
    const { prisma } = buatPrismaPalsu({
      approval: {
        id: 'apv-1',
        actionType: 'whatsapp_send_message',
        payloadPreview: 'p',
        payloadHash: hashPayload(payload),
        payload,
        correlationId: null,
      },
      updateManyCount: 0, // sudah ada yang/win duluan
    })
    const { whatsapp } = buatWhatsAppPalsu()

    let dipanggil = 0
    const engine = new ApprovalEngine({
      prisma: prisma as never,
      whatsapp,
      executor: { executeApproved: async () => { dipanggil += 1; return { ok: true, summary: 'x' } } },
    })

    await engine.tryHandleReply({ ...dasar, text: 'iya' })
    expect(dipanggil).toBe(0)
  })

  it('melewati pesan yang bukan balasan', async () => {
    const { prisma } = buatPrismaPalsu({ approval: null })
    const { whatsapp, terkirim } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    const hasil = await engine.tryHandleReply({ ...dasar, text: 'berapaattendance hari ini?' })

    // Harus diteruskan ke agent, bukan dicatat sebagai penolakan.
    expect(hasil).toBe('none')
    expect(terkirim).toHaveLength(0)
  })
})

describe('ApprovalEngine.expireStale', () => {
  it('menandai yang lewat masa berlaku sebagai EXPIRED', async () => {
    const { prisma, state } = buatPrismaPalsu({ updateManyCount: 3 })
    const { whatsapp } = buatWhatsAppPalsu()
    const engine = new ApprovalEngine({ prisma: prisma as never, whatsapp })

    const jumlah = await engine.expireStale()

    expect(jumlah).toBe(3)
    expect(state.updated[0]!.status).toBe('EXPIRED')
  })
})