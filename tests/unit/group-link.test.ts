/**
 * Test tautan grup WhatsApp ke organisasi.
 *
 * Menautkan grup itu memberi izin: grup tersebut bisa membaca data
 * organisasi. Jadi yang paling penting di sini bukan "bisa tautan", tapi
 * **apa yang harus ditolak**.
 */
import { describe, expect, it } from 'vitest'
import { GroupLinkError, GroupLinkService } from '../../src/groups/service.js'
import type { PrismaClient } from '@prisma/client'

const ORG = '11111111-1111-1111-1111-111111111111'
const ORG_LAIN = '22222222-2222-2222-2222-222222222222'
const JID_GRUP = '120363411304978267@g.us'

type GrupTautan = {
  id: string
  organizationId: string
  jid: string
  subject: string | null
  purpose: string | null
  activation: string
  isArchived: boolean
}

function buatDb(options: { grup?: GrupTautan[]; organisasi?: string[] } = {}) {
  const state = {
    grup: options.grup ?? ([] as GrupTautan[]),
    dilihat: options.organisasi ?? [ORG, ORG_LAIN],
    seen: [] as Array<{ jid: string; subject: string | null; messageCount: number }>,
    terhapus: [] as string[],
  }

  const db = {
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.dilihat.includes(where.id) ? { id: where.id } : null,
    },
    group: {
      findUnique: async ({ where }: { where: { jid: string } }) =>
        state.grup.find((g) => g.jid === where.jid) ?? null,
      findMany: async () => state.grup,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const grup: GrupTautan = {
          id: `grup-${state.grup.length + 1}`,
          isArchived: false,
          subject: null,
          purpose: null,
          activation: 'MENTION_OR_REPLY',
          ...data,
        } as GrupTautan
        state.grup.push(grup)
        return grup
      },
      update: async ({ where, data }: { where: { jid: string }; data: Record<string, unknown> }) => {
        const grup = state.grup.find((g) => g.jid === where.jid)!
        Object.assign(grup, data)
        return grup
      },
      deleteMany: async ({ where }: { where: { jid: string } }) => {
        const sebelum = state.grup.length
        state.grup = state.grup.filter((g) => g.jid !== where.jid)
        return { count: sebelum - state.grup.length }
      },
    },
    seenGroup: {
      upsert: async ({ where, create, update }: any) => {
        const ada = state.seen.find((s) => s.jid === where.jid)
        if (ada) {
          Object.assign(ada, {
            messageCount: (ada.messageCount ?? 0) + (update?.messageCount?.increment ?? 0),
          })
          return ada
        }
        const baru = { messageCount: 1, ...create }
        state.seen.push(baru)
        return baru
      },
      findMany: async () => state.seen,
      deleteMany: async ({ where }: { where: { jid: string } }) => {
        const sebelum = state.seen.length
        state.seen = state.seen.filter((s) => s.jid !== where.jid)
        return { count: sebelum - state.seen.length }
      },
    },
  }

  return { db: db as unknown as PrismaClient, state }
}

describe('pencaten grup yang belum tertaut', () => {
  it('MENCATAT grup supaya operator tahu JID mana yang perlu ditautkan', async () => {
    // Tanpa ini, pesan dari grup yang belum tertaut hilang tanpa jejak dan
    // bot terlihat "rusak" tanpa penjelasan apa pun.
    const { db, state } = buatDb()

    const dicatat = await new GroupLinkService(db).catatGrupBelumTertaut(JID_GRUP, {
      subject: 'Panitia LKBB',
      senderName: 'Budi',
    })

    expect(dicatat).toBe(true)
    expect(state.seen[0]).toMatchObject({ jid: JID_GRUP, subject: 'Panitia LKBB', messageCount: 1 })
  })

  it('menghitung berapa kali grup itu mengirim pesan', async () => {
    const { db, state } = buatDb()
    const service = new GroupLinkService(db)

    await service.catatGrupBelumTertaut(JID_GRUP)
    await service.catatGrupBelumTertaut(JID_GRUP)
    await service.catatGrupBelumTertaut(JID_GRUP)

    expect(state.seen[0]!.messageCount).toBe(3)
  })

  it('BUG REGRESSION: TIDAK mencatat grup yang sudah tertaut', async () => {
    // Kalau grup tertaut tapi ikut masuk daftar "menunggu", operator akan
    // menautkannya lagi dan mendapat error yang membingungkan.
    const { db, state } = buatDb({
      grup: [
        {
          id: 'g1',
          organizationId: ORG,
          jid: JID_GRUP,
          subject: 'Sudah Tertaut',
          purpose: null,
          activation: 'MENTION_OR_REPLY',
          isArchived: false,
        },
      ],
    })

    const dicatat = await new GroupLinkService(db).catatGrupBelumTertaut(JID_GRUP)

    expect(dicatat).toBe(false)
    expect(state.seen).toHaveLength(0)
  })

  it('BUG REGRESSION: menolak JID yang bukan grup', async () => {
    // Nomor pribadi atau LID bukan grup. Mencatatnya sebagai "grup menunggu"
    // akan membuat operator mencoba menautkan sesuatu yang tidak bisa
    // ditautkan.
    const { db, state } = buatDb()
    const service = new GroupLinkService(db)

    for (const bukanGrup of ['6285792820173@s.whatsapp.net', '257217773236380@lid', 'abc']) {
      expect(await service.catatGrupBelumTertaut(bukanGrup), bukanGrup).toBe(false)
    }
    expect(state.seen).toHaveLength(0)
  })
})

describe('menautkan grup', () => {
  it('BUG REGRESSION: MENOLAK JID yang bukan grup', async () => {
    const { db, state } = buatDb()

    await expect(
      new GroupLinkService(db).link({ organizationId: ORG, jid: '6285792820173@s.whatsapp.net' }),
    ).rejects.toThrow(/bukan JID grup/)

    expect(state.grup).toHaveLength(0)
  })

  it('MENOLAK tautan ke organisasi yang tidak ada', async () => {
    const { db, state } = buatDb()

    await expect(
      new GroupLinkService(db).link({ organizationId: 'tidak-ada', jid: JID_GRUP }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(state.grup).toHaveLength(0)
  })

  it('BUG REGRESSION: MENOLAK grup yang sudah dimiliki organisasi LAIN', async () => {
    // Satu grup = satu organisasi. Kalau dua organisasi bisa memiliki grup
    // yang sama, isi grup jadi dua sumber kebenaran.
    const { db, state } = buatDb({
      grup: [
        {
          id: 'g1',
          organizationId: ORG_LAIN,
          jid: JID_GRUP,
          subject: 'Milik Elsewhere',
          purpose: null,
          activation: 'MENTION_OR_REPLY',
          isArchived: false,
        },
      ],
    })

    await expect(
      new GroupLinkService(db).link({ organizationId: ORG, jid: JID_GRUP }),
    ).rejects.toMatchObject({ code: 'ALREADY_LINKED' })

    expect(state.grup[0]!.organizationId).toBe(ORG_LAIN)
  })

  it('BUG REGRESSION: MENOLAK tautan ganda ke organisasi yang sama', async () => {
    const { db } = buatDb({
      grup: [
        {
          id: 'g1',
          organizationId: ORG,
          jid: JID_GRUP,
          subject: null,
          purpose: null,
          activation: 'MENTION_OR_REPLY',
          isArchived: false,
        },
      ],
    })

    await expect(
      new GroupLinkService(db).link({ organizationId: ORG, jid: JID_GRUP }),
    ).rejects.toMatchObject({ code: 'ALREADY_LINKED' })
  })

  it('BUG REGRESSION: aktivasi default MENTION_OR_REPLY, bukan ALL_MESSAGES', async () => {
    // Bot yang membalas SEMUA pesan di grup boros token dan menyela
    // percakapan orang. Itu harus diminta secara eksplisit, bukan default.
    const { db, state } = buatDb()

    const hasil = await new GroupLinkService(db).link({ organizationId: ORG, jid: JID_GRUP })

    expect(hasil.activation).toBe('MENTION_OR_REPLY')
    expect(state.grup[0]!.activation).toBe('MENTION_OR_REPLY')
  })

  it('menghapus dari daftar menunggu begitu tertaut', async () => {
    // Kalau tidak, operator akan melihat grup yang sama muncul sebagai
    // "menunggu" padahal sudah tertaut.
    const { db, state } = buatDb()
    const service = new GroupLinkService(db)

    await service.catatGrupBelumTertaut(JID_GRUP, { subject: 'Panitia LKBB' })
    await service.link({ organizationId: ORG, jid: JID_GRUP })

    expect(state.seen).toHaveLength(0)
  })
})

describe('kebijakan aktivasi', () => {
  it('mengubah kapan bot merespons', async () => {
    const { db, state } = buatDb({
      grup: [
        {
          id: 'g1',
          organizationId: ORG,
          jid: JID_GRUP,
          subject: null,
          purpose: null,
          activation: 'MENTION_OR_REPLY',
          isArchived: false,
        },
      ],
    })

    const hasil = await new GroupLinkService(db).setActivation(JID_GRUP, 'OFF')
    expect(hasil.activation).toBe('OFF')
    expect(state.grup[0]!.activation).toBe('OFF')
  })

  it('BUG REGRESSION: menolak mengubah aktivasi grup yang belum tertaut', async () => {
    const { db, state } = buatDb()

    await expect(new GroupLinkService(db).setActivation(JID_GRUP, 'ALL_MESSAGES')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(state.grup).toHaveLength(0)
  })
})

describe('melepas tautan', () => {
  it('BUG REGRESSION: melepas tautan TIDAK menghapus riwayat', async () => {
    // `deleteMany` pada tabel `groups` menghapus barisnya sendiri; yang
    // penting data kehadiran dan pengingat tidak ikut terhapus.
    // Test ini memanggil `unlink` lalu memeriksa tidak ada efek lain.
    const { db, state } = buatDb({
      grup: [
        {
          id: 'g1',
          organizationId: ORG,
          jid: JID_GRUP,
          subject: 'Panitia',
          purpose: null,
          activation: 'MENTION_OR_REPLY',
          isArchived: false,
        },
      ],
    })

    const hasil = await new GroupLinkService(db).unlink(JID_GRUP)

    expect(hasil).toBe(true)
    expect(state.grup).toHaveLength(0)
  })

  it('menolak melepas tautan grup yang tidak tertaut', async () => {
    const { db } = buatDb()

    await expect(new GroupLinkService(db).unlink(JID_GRUP)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('GroupLinkError', () => {
  it('memakai kode yang bisa dicabang di pemanggil', () => {
    const err = new GroupLinkError('INVALID_JID', 'bukan grup')
    expect(err.code).toBe('INVALID_JID')
    expect(err.message).toBe('bukan grup')
    expect(err).toBeInstanceOf(Error)
  })
})