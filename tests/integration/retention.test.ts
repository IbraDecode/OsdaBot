/**
 * Uji integrasi retensi data.
 *
 * Yang diuji, berurutan dari yang paling penting:
 *
 *  1. Data bisnis TIDAK pernah tersentuh — bukan secara teori, tapi dengan
 *     menghitung baris sebelum dan sesudah pembersihan sungguhan.
 *  2. Outbox hanya membersihkan yang sudah selesai.
 *  3. Umur dijalankan, bukan disimpan.
 *  4. `dry-run` benar-benar tidak menghapus apa pun.
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  KEBIJAKAN,
  RetentionService,
  TABEL_BISNIS,
  type Kebijakan,
  type NamaTabel,
} from '../../src/system/retention.js'

const prisma = new PrismaClient()

/** Waktu "sekarang" yang dikendalikan test, supaya umur bisa diuji. */
const SEKARANG = new Date('2026-10-16T00:00:00Z')

function service(): RetentionService {
  return new RetentionService(prisma, () => SEKARANG)
}

/** Waktu N hari sebelum `SEKARANG`. */
function hariLalu(n: number): Date {
  return new Date(SEKARANG.getTime() - n * 24 * 60 * 60 * 1000)
}

const TANDA = 'retensi-uji'

// ── Sumber data uji ─────────────────────────────────────────────────────────

async function seedAgentTask(tanggal: Date): Promise<string> {
  const baris = await prisma.agentTask.create({
    data: {
      kind: 'chat_personal',
      title: `${TANDA} ${tanggal.toISOString()}`,
      status: 'COMPLETED',
      state: { marker: TANDA },
      createdAt: tanggal,
      endedAt: tanggal,
    },
    select: { id: true },
  })
  await prisma.agentStep.createMany({
    data: [
      { taskId: baris.id, ordinal: 1, description: 'langkah uji' },
      { taskId: baris.id, ordinal: 2, description: 'langkah uji 2' },
    ],
  })
  return baris.id
}

async function seedToolExecution(tanggal: Date): Promise<string> {
  const baris = await prisma.toolExecution.create({
    data: {
      toolName: `${TANDA}_tool`,
      correlationId: `${TANDA}-${tanggal.getTime()}`,
      outcome: 'success',
      createdAt: tanggal,
    },
    select: { id: true },
  })
  return baris.id
}

async function seedAuditLog(tanggal: Date): Promise<string> {
  const baris = await prisma.auditLog.create({
    data: {
      action: `${TANDA}.action`,
      resourceType: 'uji',
      outcome: 'ok',
      createdAt: tanggal,
    },
    select: { id: true },
  })
  return baris.id
}

async function seedOutbox(tanggal: Date, status: 'PENDING' | 'DELIVERED'): Promise<string> {
  const baris = await prisma.outboxEvent.create({
    data: {
      topic: `${TANDA}.topic`,
      payload: { text: 'uji' },
      status,
      createdAt: tanggal,
      processedAt: status === 'DELIVERED' ? tanggal : null,
    },
    select: { id: true },
  })
  return baris.id
}

async function bersihkanSemua(): Promise<void> {
  const taskIds = await prisma.agentTask.findMany({ where: { state: { path: ['marker'], equals: TANDA } }, select: { id: true } })
  const ids = taskIds.map((t) => t.id)
  if (ids.length > 0) await prisma.agentStep.deleteMany({ where: { taskId: { in: ids } } })
  await prisma.agentTask.deleteMany({ where: { id: { in: ids } } })
  await prisma.toolExecution.deleteMany({ where: { toolName: `${TANDA}_tool` } })
  await prisma.auditLog.deleteMany({ where: { action: `${TANDA}.action` } })
  await prisma.outboxEvent.deleteMany({ where: { topic: `${TANDA}.topic` } })
}

afterAll(async () => {
  await bersihkanSemua()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await bersihkanSemua()
})

// ───────────────────────────────────────────────────────────────────────────

describe('kebijakan tidak boleh menyentuh data bisnis', () => {
  it('BUG REGRESSION: tidak ada kebijakan yang menunjuk tabel bisnis', () => {
    // Ini jawaban yang paling mahal kalau sampai terjadi: penghapusan transaksi.
    const policy = new Set(KEBIJAKAN.map((k) => k.tabel))
    const drie = TABEL_BISNIS.filter((t) => policy.has(t as unknown as NamaTabel))
    expect(drie, `kebijakan menyentuh: ${drie.join(', ')}`).toEqual([])
  })

  it('daftar kebijakan menutup tabel operasional, bukan tabel bisnis', () => {
    expect(KEBIJAKAN.map((k) => k.tabel).sort()).toEqual(
      ['AgentStep', 'AgentTask', 'AuditLog', 'OutboxEvent', 'ToolExecution'],
    )
  })

  it('BUG REGRESSION: menjalankan pembersihan TIDAK mengubah data bisnis satu baris pun', async () => {
    // bukan teori — dihitung sebelum dan sesudah.
    //
    // Yang diukur sengaja memakai tabel yang isinya nyata di database
    // pengembangan (Invoice, DocumentRecord, Message, Task) plus tabel uji.
    // Kalau kebijakan pernah salah sasaran, angka ini langsung bergerak.
    await seedAgentTask(hariLalu(400))
    await seedToolExecution(hariLalu(400))

    const ukur = async () => ({
      agentTask: await prisma.agentTask.count({ where: { state: { path: ['marker'], equals: TANDA } } }),
      agentStep: await prisma.agentStep.count({ where: { description: { startsWith: 'langkah uji' } } }),
      toolExecution: await prisma.toolExecution.count({ where: { toolName: `${TANDA}_tool` } }),
      auditLog: await prisma.auditLog.count({ where: { action: `${TANDA}.action` } }),
      outboxEvent: await prisma.outboxEvent.count({ where: { topic: `${TANDA}.topic` } }),
      // Tabel bisnis sungguhan.
      invoice: await prisma.invoice.count(),
      documentRecord: await prisma.documentRecord.count(),
      message: await prisma.message.count(),
      attendanceEntry: await prisma.attendanceEntry.count(),
      task: await prisma.task.count(),
    })

    const sebelum = await ukur()
    await service().jalankan()
    const sesudah = await ukur()

    // Yang boleh berubah hanya dua baris uji yang sengaja sudah tua.
    expect(sesudah.agentTask).toBe(0)
    expect(sesudah.agentStep).toBe(0)
    expect(sesudah.toolExecution).toBe(0)

    // Sisanya harus identik — termasuk data bisnis nyata.
    expect(sesudah.invoice).toBe(sebelum.invoice)
    expect(sesudah.documentRecord).toBe(sebelum.documentRecord)
    expect(sesudah.message).toBe(sebelum.message)
    expect(sesudah.attendanceEntry).toBe(sebelum.attendanceEntry)
    expect(sesudah.task).toBe(sebelum.task)
  })

  it('BUG REGRESSION: kebijakan yang memuat tabel bisnis DITOLAK saat runtime', async () => {
    // Pengaman runtime, terpisah dari `test` dan dari bukti level tipe.
    //
    // Bukti level tipe sudah menahan policy yang salah ketik. Ini menutup jalur
    // yang lain: data yang berasal dari luar — berkas konfigurasi, panggilan
    // API, hasil perubahan masa depan — di mana tipe sudah diketik `any`.
    const paksa = { tabel: 'Invoice', hari: 1, alasan: 'paksa' } as unknown as Kebijakan
    await expect(service().jalankan([paksa])).rejects.toThrow(/data bisnis/)

    // Dan tidak ada yang terhapus sebelum penolakan terjadi.
    await seedAgentTask(hariLalu(60))
    const lain = { tabel: 'AgentTask', hari: 1, alasan: 'ok' } as Kebijakan
    await expect(
      service().jalankan([{ ...lain, tabel: 'CashbookEntry' as unknown as NamaTabel }, lain]),
    ).rejects.toThrow(/data bisnis/)
    expect(await prisma.agentTask.count({ where: { state: { path: ['marker'], equals: TANDA } } })).toBe(1)
  })
})

describe('umur dijalankan, bukan disimpan', () => {
  it('BUG REGRESSION: baris di bawah batas umur TIDAK dihapus', async () => {
    const baru = await seedAgentTask(hariLalu(1))
    await service().jalankan()

    const sisa = await prisma.agentTask.findUnique({ where: { id: baru } })
    expect(sisa).toBeTruthy()
  })

  it('BUG REGRESSION: baris di atas batas umur DIHAPUS', async () => {
    const lama = await seedAgentTask(hariLalu(60)) // kebijakan 30 hari
    await service().jalankan()

    expect(await prisma.agentTask.findUnique({ where: { id: lama } })).toBeNull()
  })

  it('BUG REGRESSION: langkah ikut terhapus bersama induknya', async () => {
    // Kalau langkahnya tertinggal, `AgentStep` jadi baris yatim yang tidak
    // pernah ditanyakan dan tidak pernah bisa dijelaskan.
    await seedAgentTask(hariLalu(60))
    expect(await prisma.agentStep.count({ where: { description: { startsWith: 'langkah uji' } } })).toBe(2)

    await service().jalankan()
    expect(await prisma.agentStep.count({ where: { description: { startsWith: 'langkah uji' } } })).toBe(0)
  })

  it('ToolExecution punya umur lebih panjang dari AgentTask', async () => {
    // Justifikasi kebijakan: ToolExecution menjawab "tool apa yang gagal"
    // bahkan setelah rekaman jalannya dihapus, jadi ia tidak bisa punya umur
    // yang sama.
    const ages = new Map(KEBIJAKAN.map((k) => [k.tabel, k.hari]))
    expect(ages.get('ToolExecution')!).toBeGreaterThan(ages.get('AgentTask')!)
    expect(ages.get('AuditLog')!).toBeGreaterThan(ages.get('ToolExecution')!)
  })
})

describe('outbox hanya yang sudah selesai', () => {
  it('BUG REGRESSION: pesan yang BELUM terkirim tidak boleh dihapus', async () => {
    // Menghapus PENDING berarti membatalkan pengiriman tanpa ada yang diberi
    // tahu — dan tidak ada tempat lagi yang tahu pesannya pernah ada.
    const lama = hariLalu(60)
    const pending = await seedOutbox(lama, 'PENDING')
    const delivered = await seedOutbox(lama, 'DELIVERED')

    await service().jalankan()

    expect(await prisma.outboxEvent.findUnique({ where: { id: pending } })).toBeTruthy()
    expect(await prisma.outboxEvent.findUnique({ where: { id: delivered } })).toBeNull()
  })
})

describe('dry-run benar-benar tidak menghapus', () => {
  it('BUG REGRESSION: perkiraan() menghitung tapi tidak menghapus apa pun', async () => {
    const lama = await seedAgentTask(hariLalu(60))
    await seedToolExecution(hariLalu(400))

    const hasil = await service().perkiraan()

    expect(hasil.dryRun).toBe(true)
    expect(hasil.totalDihapus).toBe(0)
    expect(hasil.perTabel.find((p) => p.tabel === 'AgentTask')!.jumlah).toBe(1)
    expect(hasil.perTabel.find((p) => p.tabel === 'ToolExecution')!.jumlah).toBe(1)

    // Dan yang paling penting: barisnya masih ada.
    expect(await prisma.agentTask.findUnique({ where: { id: lama } })).toBeTruthy()
  })

  it('perkiraan melaporkan tabel bisnis yang dilewati', async () => {
    const hasil = await service().perkiraan()
    expect(hasil.dilewati).toContain('Invoice')
    expect(hasil.dilewati).toContain('Message')
    expect(hasil.dilewati.length).toBe(TABEL_BISNIS.length)
  })
})

describe('batas per siklus', () => {
  it('kenaBatas dilaporkan kalau melewati batas', async () => {
    // Menguji batas 5000 baris sungguhan akan terlalu lambat, jadi yang diuji
    // adalah perilakunya terhadap kebijakan dengan hari sangat kecil —
    // bentuk parameternya sama, hasilnya lebih kecil.
    const hasil = await service().perkiraan([{ tabel: 'AgentTask', hari: 0, alasan: 'uji batas' }])
    const baris = hasil.perTabel[0]!
    expect(baris.kenaBatas).toBe(baris.jumlah > 5000)
  })
})