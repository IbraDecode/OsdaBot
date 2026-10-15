/**
 * Uji integrasi tautan grup ke database sungguhan.
 *
 * Test unit memakai test double Prisma yang menyederhanakan WHERE. Prisma
 * test double TIDAK bisa memodelkan semantik NULL SQL — dan justru di situ
 * bug paling berbahaya bersembunyi.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { GroupLinkService } from '../../src/groups/service.js'

const prisma = new PrismaClient()
const service = new GroupLinkService(prisma)

/**
 * JID uji BUATAN, bukan JID grup sungguhan.
 *
 * Versi pertama test ini memakai JID grup nyata milik organisasi yang sedang
 * diuji — dan menghapusnya di `afterAll`. Akibatnya konfigurasi produksi ikut
 * terhapus: grup yang sudah ditautkan tiba-tiba kembali "belum tertaut".
 *
 * Test yang menghapus data milik orang lain bukan test yang bisa dipercaya,
 * bahkan kalau datanya "cuma" konfigurasi dev.
 */
const JID_A = '199999999999999001@g.us'
const JID_B = '199999999999999002@g.us'

let organisasiId: string

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `Uji Grup ${Date.now()}`, slug: `uji-grup-${Date.now()}` },
    select: { id: true },
  })
  organisasiId = org.id

  await prisma.group.deleteMany({ where: { jid: { in: [JID_A, JID_B] } } })
  await prisma.seenGroup.deleteMany({ where: { jid: { in: [JID_A, JID_B] } } })
}, 60_000)

afterAll(async () => {
  await prisma.group.deleteMany({ where: { jid: { in: [JID_A, JID_B] } } })
  await prisma.seenGroup.deleteMany({ where: { jid: { in: [JID_A, JID_B] } } })
  await prisma.organization.deleteMany({ where: { id: organisasiId } })
  await prisma.$disconnect()
})

describe('menautkan grup ke database sungguhan', () => {
  it('BUG REGRESSION: MENYIMPAN subjek pada grup yang subjeknya masih NULL', async () => {
    // Bug nyata yang ditemukan lewat pengujian live.
    //
    // `updateMany({ where: { NOT: { subject: x } } })` TIDAK cocok untuk baris
    // dengan `subject IS NULL`. Di SQL, `NULL <> 'x'` menghasilkan NULL, bukan
    // TRUE — jadi baris subjek kosong lolos tanpa tersimpan.
    //
    // Dampaknya: grup yang tertaut tampil "(tanpa subjek)" padahal namanya
    // jelas ada, dan operator tidak bisa mengidentifikasi grupnya.
    await service.link({ organizationId: organisasiId, jid: JID_A })

    const sebelum = await prisma.group.findUnique({ where: { jid: JID_A }, select: { subject: true } })
    expect(sebelum!.subject).toBeNull()

    const hasil = await service.sinkronSubjek([{ jid: JID_A, subject: 'ABSENSI & PERIZINAN' }])
    expect(hasil.diperbarui).toBe(1)

    const sesudah = await prisma.group.findUnique({ where: { jid: JID_A }, select: { subject: true } })
    expect(sesudah!.subject).toBe('ABSENSI & PERIZINAN')
  })

  it('BUG REGRESSION: idempoten — subjek sama tidak dihitung sebagai perubahan', async () => {
    await service.sinkronSubjek([{ jid: JID_A, subject: 'ABSENSI & PERIZINAN' }])
    const kedua = await service.sinkronSubjek([{ jid: JID_A, subject: 'ABSENSI & PERIZINAN' }])

    expect(kedua.diperbarui).toBe(0)
  })

  it('memperbarui subjek yang benar-benar berubah', async () => {
    const hasil = await service.sinkronSubjek([{ jid: JID_A, subject: 'ABSENSI & IZIN' }])

    expect(hasil.diperbarui).toBe(1)
    const row = await prisma.group.findUnique({ where: { jid: JID_A }, select: { subject: true } })
    expect(row!.subject).toBe('ABSENSI & IZIN')
  })

  it('BUG REGRESSION: sinkronisasi TIDAK menyentuh grup milik organisasi lain', async () => {
    // Menyentuh baris di luar jangauan operasi adalah bug, bukan "detail".
    const lain = await prisma.organization.create({
      data: { name: `Uji Grup Lain ${Date.now()}`, slug: `uji-grup-lain-${Date.now()}` },
      select: { id: true },
    })
    await service.link({ organizationId: lain.id, jid: JID_B })

    await service.sinkronSubjek([{ jid: JID_B, subject: 'SUBJEK BARU' }])

    const row = await prisma.group.findUnique({
      where: { jid: JID_B },
      select: { subject: true, organizationId: true, activation: true },
    })
    expect(row!.organizationId).toBe(lain.id)
    // Aktivasi TIDAK boleh berubah karena sinkronisasi subjek.
    expect(row!.activation).toBe('MENTION_OR_REPLY')

    await prisma.group.deleteMany({ where: { jid: JID_B } })
    await prisma.organization.deleteMany({ where: { id: lain.id } })
  })

  it('BUG REGRESSION: mencatat grup yang belum tertaut, lalu menghapusnya saat tertaut', async () => {
    await service.link({ organizationId: organisasiId, jid: JID_B })

    const dicatat = await service.catatGrupBelumTertaut(JID_B, { subject: 'Grup Belum Tertaut' })
    // Sudah tertaut → tidak boleh masuk daftar "menunggu".
    expect(dicatat).toBe(false)

    const row = await prisma.seenGroup.findUnique({ where: { jid: JID_B }, select: { jid: true } })
    expect(row).toBeNull()
  })

  it('BUG REGRESSION: satu grup hanya boleh dimiliki satu organisasi', async () => {
    const lain = await prisma.organization.create({
      data: { name: `Uji Grup Doubel ${Date.now()}`, slug: `uji-grup-dobel-${Date.now()}` },
      select: { id: true },
    })

    await expect(service.link({ organizationId: lain.id, jid: JID_A })).rejects.toMatchObject({
      code: 'ALREADY_LINKED',
    })

    // Tautan asli TIDAK berubah.
    const row = await prisma.group.findUnique({ where: { jid: JID_A }, select: { organizationId: true } })
    expect(row!.organizationId).toBe(organisasiId)

    await prisma.organization.deleteMany({ where: { id: lain.id } })
  })

  it('BUG REGRESSION: melepas tautan tidak meninggalkan sisa di daftar menunggu', async () => {
    await service.unlink(JID_A)

    const grup = await prisma.group.findUnique({ where: { jid: JID_A }, select: { jid: true } })
    expect(grup).toBeNull()

    // Setelah dilepas, grup boleh dicatat lagi sebagai "menunggu".
    expect(await service.catatGrupBelumTertaut(JID_A, { subject: 'Setelah Dilepas' })).toBe(true)
    await prisma.seenGroup.deleteMany({ where: { jid: JID_A } })
  })
})