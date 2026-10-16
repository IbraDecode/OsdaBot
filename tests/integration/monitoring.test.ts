/**
 * Uji integrasi monitoring agent.
 *
 * Yang diuji — dan yang jadi alasan modul ini ada:
 *
 *  - pola lintas-peristiwa terlihat, sementara satu kejadian tidak cukup
 *  - deduplikasi: satu masalah = satu sinyal, bukan N
 *  - sinyal yang sudah beres ditandai selesai otomatis
 *  - aturan per organisasi mengalahkan bawaan
 *  - tidak ada yang consolidar antar-organisasi
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { MonitoringService, ATURAN_BAWAAN, type Aturan } from '../../src/monitoring/service.js'

const prisma = new PrismaClient()

const TANDA = 'monitor-uji'
const SEKARANG = new Date()

/**
 * Organisasi khusus untuk test ini.
 *
 * Bukan `TEST_ORG_ID`. Database pengembangan punya ribuan baris `ToolExecution`
 * historis — semuanya gagal, dari semua percakapan uji sebelumnya. Kalau test
 * memakai organisasi lama, setiap pemeriksaan langsung menemukan pola nyata
 * yang tidak dibuat test, dan hitungannya tidak bisa dipercaya.
 */
let ORG = ''
let orgLain = ''

/** Aturan dengan ambang rendah supaya test tidak butuh banyak data. */
const ATURAN_UJI: Aturan[] = ATURAN_BAWAAN.map((a) => ({ ...a, minimum: 2 }))

function service(): MonitoringService {
  return new MonitoringService(prisma, () => SEKARANG)
}

function menitLalu(n: number): Date {
  return new Date(SEKARANG.getTime() - n * 60 * 1000)
}

async function bersihkan(): Promise<void> {
  await prisma.recommendation.deleteMany({ where: { organizationId: { in: [ORG, orgLain] } } })
  await prisma.organizationSignal.deleteMany({ where: { organizationId: { in: [ORG, orgLain] } } })
  await prisma.monitoringConfiguration.deleteMany({ where: { organizationId: { in: [ORG, orgLain] } } })
  await prisma.toolExecution.deleteMany({ where: { correlationId: { startsWith: TANDA } } })
  await prisma.agentTask.deleteMany({ where: { title: { startsWith: TANDA } } })
}

beforeAll(async () => {
  const stamp = Date.now()
  const utama = await prisma.organization.create({
    data: { name: `Organisasi Monitoring Uji ${stamp}`, slug: `org-monitor-uji-${stamp}` },
    select: { id: true },
  })
  ORG = utama.id

  const lain = await prisma.organization.create({
    data: { name: `Organisasi Monitoring Lain ${stamp}`, slug: `org-monitor-lain-${stamp}` },
    select: { id: true },
  })
  orgLain = lain.id
})

beforeEach(async () => {
  await bersihkan()
})

afterAll(async () => {
  await bersihkan()
  await prisma.organization.deleteMany({ where: { id: { in: [ORG, orgLain] } } })
  await prisma.$disconnect()
})

async function gagalkan(
  toolName: string,
  errorCode: string,
  jumlah: number,
  organizationId = ORG,
): Promise<void> {
  await prisma.toolExecution.createMany({
    data: Array.from({ length: jumlah }, (_, i) => ({
      toolName,
      organizationId,
      actorUserId: null,
      correlationId: `${TANDA}-${toolName}-${errorCode}-${organizationId}-${i}`,
      outcome: 'failure',
      errorCode,
      createdAt: menitLalu(5),
    })),
  })
}

async function jalanDengan(
  errorCode: string | null,
  jumlah: number,
  organizationId = ORG,
  durasiMs = 1000,
): Promise<void> {
  await prisma.agentTask.createMany({
    data: Array.from({ length: jumlah }, (_, i) => ({
      kind: 'chat_personal',
      title: `${TANDA}-${errorCode ?? 'ok'}-${organizationId}-${i}`,
      status: errorCode ? ('FAILED' as const) : ('COMPLETED' as const),
      errorCode,
      organizationId,
      createdAt: menitLalu(5),
      state: { durasiMs },
    })),
  })
}

describe('mendeteksi pola lintas-peristiwa', () => {
  it('BUG REGRESSION: kegagalan tool yang berulang pada tool SAMA menjadi satu sinyal', async () => {
    // Tiga kegagalan terpisah. Satu per satu, tidak ada yang terlihat.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)

    const hasil = await service().periksa(ORG, { aturan: ATURAN_UJI })

    const sinyal = hasil.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')
    expect(sinyal).toHaveLength(1)
    expect(sinyal[0]!.tingkat).toBe('WARNING')

    const baris = await prisma.organizationSignal.findFirst({
      where: { organizationId: ORG, type: 'TOOL_FAILURE_REPEAT' },
    })
    expect((baris!.detail as { bukti: { jumlah: number } }).bukti.jumlah).toBe(3)
  })

  it('BUG REGRESSION: kegagalan DI BAWAH ambang TIDAK menjadi sinyal', async () => {
    // Ambang uji = 2. Satu kegagalan adalah kejadian biasa, bukan pola.
    // Tanpa ini, satu kesalahan kecil terlihat seperti masalah yang tumbuh.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 1)

    const hasil = await service().periksa(ORG, { aturan: ATURAN_UJI })
    expect(hasil.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')).toHaveLength(0)
  })

  it('BUG REGRESSION: kode error BERBEDA pada tool sama = dua masalah', async () => {
    // `NOT_FOUND` berarti datanya salah; `VALIDATION_FAILED` berarti model
    // salah paham kontrak tool. Satu tanda baca tidak menyiratkan dua hal ini.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    await gagalkan('finance_create', 'NOT_FOUND', 3)

    const hasil = await service().periksa(ORG, { aturan: ATURAN_UJI })
    const sinyal = hasil.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')

    expect(sinyal).toHaveLength(2)
  })

  it('tool BERBEDA dengan kode sama = dua masalah', async () => {
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    await gagalkan('attendance_update', 'VALIDATION_FAILED', 3)

    const hasil = await service().periksa(ORG, { aturan: ATURAN_UJI })
    expect(hasil.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')).toHaveLength(2)
  })

  it('MAX_STEPS berulang terdeteksi dan dipisahkan dari provider error', async () => {
    await jalanDengan('MAX_STEPS', 3)
    await jalanDengan('LLM_ERROR', 3)

    const hasil = await service().periksa(ORG, { aturan: ATURAN_UJI })

    const steps = hasil.sinyalBaru.find((s) => s.jenis === 'MAX_STEPS_REPEAT')
    const provider = hasil.sinyalBaru.find((s) => s.jenis === 'PROVIDER_ERROR')

    expect(steps).toBeTruthy()
    expect(provider).toBeTruthy()
    // Provider error lebih serius: masalah infrastruktur di luar kendali kode.
    expect(provider!.tingkat).toBe('CRITICAL')
    expect(steps!.tingkat).toBe('WARNING')
  })

  it('BUG REGRESSION: "tidak ada sinyal" bisa dibedakan dari "tidak ada yang diukur"', async () => {
    // Kalau keduanya sama, list kosong terlihat seperti Bot yang sehat padahal
    // tidak ada yang diperiksa sama sekali.
    const hasil = await service().periksa(ORG, { aturan: ATURAN_UJI })

    expect(hasil.sinyalBaru).toHaveLength(0)
    expect(hasil.diukur).toHaveProperty('toolCalls')
    expect(hasil.diukur).toHaveProperty('agentRuns')
    expect(hasil.diukur).toHaveProperty('percakapan')
  })
})

describe('deduplikasi', () => {
  it('BUG REGRESSION: pemeriksaan berulang MENAIKKAN occurrences, bukan menambah baris', async () => {
    // Tanpa ini, satu masalah yang bertahan seminggu menghasilkan tujuh
    // sinyal — dan notifikasi dibanjiri tepat saat masalahnya paling serius.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)

    const svc = service()
    await svc.periksa(ORG, { aturan: ATURAN_UJI })
    await svc.periksa(ORG, { aturan: ATURAN_UJI })
    await svc.periksa(ORG, { aturan: ATURAN_UJI })

    const baris = await prisma.organizationSignal.findMany({
      where: { organizationId: ORG, type: 'TOOL_FAILURE_REPEAT' },
    })

    expect(baris).toHaveLength(1)
    expect(baris[0]!.occurrences).toBe(3)
  })

  it('jumlah kegagalan yang BERUBAH tidak membuat sinyal baru', async () => {
    // Jumlah sengaja tidak masuk sidik jari. Kalau masuk, setiap kejadian
    // dengan hitungan berbeda menjadi sinyal terpisah — dan `fingerprint` yang
    // unik tidak mencegah apa pun.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    await service().periksa(ORG, { aturan: ATURAN_UJI })

    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    await service().periksa(ORG, { aturan: ATURAN_UJI })

    const baris = await prisma.organizationSignal.findMany({
      where: { organizationId: ORG, type: 'TOOL_FAILURE_REPEAT' },
    })
    expect(baris).toHaveLength(1)
    expect(baris[0]!.occurrences).toBe(2)
  })
})

describe('sinyal yang sudah beres', () => {
  it('BUG REGRESSION: masalah yang hilang ditandai RESOLVED, bukan dibiarkan ACTIVE', async () => {
    // Kalau tidak, setiap masalah yang selesai meninggalkan baris ACTIVE
    // selamanya, dan daftar sinyal jadi arsip, bukan daftar pekerjaan.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    await service().periksa(ORG, { aturan: ATURAN_UJI })

    const aktifSebelum = await prisma.organizationSignal.count({
      where: { organizationId: ORG, status: 'ACTIVE' },
    })
    expect(aktifSebelum).toBe(1)

    // Masalahnya beres: tidak ada kegagalan lagi di jendela.
    await prisma.toolExecution.deleteMany({ where: { correlationId: { startsWith: TANDA } } })

    const hasil = await service().periksa(ORG, { aturan: ATURAN_UJI })
    expect(hasil.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')).toHaveLength(0)
    expect(hasil.sinyalDipulihkan).toHaveLength(1)

    const setelah = await prisma.organizationSignal.findFirst({
      where: { organizationId: ORG, type: 'TOOL_FAILURE_REPEAT' },
    })
    expect(setelah!.status).toBe('RESOLVED')
    expect(setelah!.resolvedAt).toBeTruthy()
  })
})

describe('aturan per organisasi', () => {
  it('BUG REGRESSION: ambang yang dikonfigurasi MENGALAHKAN bawaan', async () => {
    // Ini yang membuat `MonitoringConfiguration` jadi tabel sungguhan.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 4)

    // Dengan bawaan (minimum 3), ini sinyal.
    const denganBawaan = await service().periksa(ORG)
    expect(denganBawaan.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')).toHaveLength(1)

    // Hanya sinyal dan konfigurasi yang dibersihkan — **data kegagalannya
    // dibiarkan**.
    //
    // Versi pertama memanggil `bersihkan()` yang juga menghapus
    // `ToolExecution`, jadi paruh kedua tidak punya satu pun kegagalan untuk
    // diamati. Nol kegagalan menghasilkan nol sinyal pada ambang apa pun, jadi
    // test-nya lulus hampa — termasuk ketika pembacaan konfigurasi sengaja
    // dimatikan.
    await prisma.organizationSignal.deleteMany({ where: { organizationId: ORG } })

    await service().konfigurasi({
      organizationId: ORG,
      name: 'ambang tinggi',
      thresholds: { TOOL_FAILURE_REPEAT: { minimum: 10 } },
    })

    const denganKonfigurasi = await service().periksa(ORG)
    expect(
      denganKonfigurasi.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT'),
    ).toHaveLength(0)

    // Dan untuk memastikan nol itu memang karena ambangnya, bukan karena
    // kebetulan tidak ada data: jumlah kegagalannya masih ada.
    expect(await prisma.toolExecution.count({ where: { correlationId: { startsWith: TANDA } } })).toBe(4)
  })

  it('BUG REGRESSION: konfigurasi TIDAK berlaku ke organisasi lain', async () => {
    // Kalau ambang bocor lintas organisasi, satu organisasi bisa mematikan
    // monitoring organisasi lain tanpa anyone menyadarinya.
    await service().konfigurasi({
      organizationId: ORG,
      name: 'ambang tinggi',
      thresholds: { TOOL_FAILURE_REPEAT: { minimum: 99 } },
    })

    await gagalkan('finance_create', 'VALIDATION_FAILED', 4, orgLain)

    const hasil = await service().periksa(orgLain)
    expect(hasil.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')).toHaveLength(1)
  })

  it('BUG REGRESSION: threshold rusak KEMBALI ke bawaan, bukan diam-diam tidak memonitor', async () => {
    // Menyimpan satu angka yang salah lebih buruk daripada tidak punya
    // konfigurasi: yang kelihatan benar tapi tidak memonitor apa pun.
    await prisma.monitoringConfiguration.create({
      data: {
        organizationId: ORG,
        name: 'rusak',
        enabled: true,
        rules: { thresholds: { TOOL_FAILURE_REPEAT: { minimum: 'banyak' } } } as never,
      },
    })

    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    const hasil = await service().periksa(ORG)

    // Bawaannya dipakai, jadi pola 3 tetap terdeteksi.
    expect(hasil.sinyalBaru.filter((s) => s.jenis === 'TOOL_FAILURE_REPEAT')).toHaveLength(1)
  })
})

describe('batas organisasi', () => {
  it('BUG REGRESSION: sinyal organisasi lain TIDAK ikut dilaporkan', async () => {
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3, orgLain)
    await gagalkan('attendance_update', 'NOT_FOUND', 3, ORG)

    const hasil = await service().periksa(ORG)
    const semua = await prisma.organizationSignal.findMany({ where: { organizationId: ORG } })

    // Hanya tool milik ORG yang boleh muncul.
    for (const s of semua) {
      const bukti = (s.detail as { bukti: { tool?: string } }).bukti
      expect(bukti.tool).toBe('attendance_update')
    }
    expect(hasil.sinyalBaru).toHaveLength(1)
  })
})

describe('rekomendasi', () => {
  it('BUG REGRESSION: rekomendasi berulang dengan isi sama tidak dikalikan', async () => {
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    const svc = service()

    await svc.periksa(ORG, { aturan: ATURAN_UJI })
    const pertama = await svc.simpanRekomendasi(ORG)
    const kedua = await svc.simpanRekomendasi(ORG)
    const ketiga = await svc.simpanRekomendasi(ORG)

    expect(pertama).toBe(1)
    expect(kedua).toBe(0)
    expect(ketiga).toBe(0)
  })

  it('dasar rekomendasi mengikuti dasar sarannya, bukan ditebak ulang', async () => {
    // `basis` membedakan hitungan dari rekaman (evidence) dengan kesimpulan
    // yang diambil dari hitungan itu (heuristic). Menebaknya ulang di sini
    // berarti kategorinya tidak dipercaya.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3) // evidence
    await jalanDengan('LLM_ERROR', 3) // evidence — masalah infrastruktur
    await jalanDengan('MAX_STEPS', 3) // heuristic — urutan penyebabnya disimpulkan

    const svc = service()
    await svc.periksa(ORG, { aturan: ATURAN_UJI })
    await svc.simpanRekomendasi(ORG)

    const semua = await prisma.recommendation.findMany({ where: { organizationId: ORG } })
    const basics = new Set(semua.map((r) => r.basis))

    expect(semua.length).toBeGreaterThanOrEqual(3)
    expect(basics).toContain('evidence')
    expect(basics).toContain('heuristic')
    for (const r of semua) expect(['evidence', 'heuristic', 'speculative']).toContain(r.basis)

    // Provider error berbasis evidence: penyebabnya (penyedia gagal) terukur,
    // bukan disimpulkan. Menyimpulkannya jadi opinion akan membuat saran
    // tentang kode lokal muncul untuk masalah yang sama sekali bukan di kode.
    const provider = semua.find((r) => r.summary.includes('Penyedia AI'))
    expect(provider?.basis).toBe('evidence')
  })

  it('BUG REGRESSION: confidence bernilai null, bukan angka tebakan', async () => {
    // Tidak ada model yang menghasilkan angka itu. `null` berarti "tidak ada"
    // dan lebih jujur daripada angka yang terlihat seperti hasil pengukuran.
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)
    const svc = service()
    await svc.periksa(ORG, { aturan: ATURAN_UJI })
    await svc.simpanRekomendasi(ORG)

    const semua = await prisma.recommendation.findMany({ where: { organizationId: ORG } })
    expect(semua.length).toBeGreaterThan(0)
    for (const r of semua) expect(r.confidence).toBeNull()
  })
})

describe('dry-run', () => {
  it('BUG REGRESSION: dry-run tidak menulis apa pun ke database', async () => {
    await gagalkan('finance_create', 'VALIDATION_FAILED', 3)

    const hasil = await service().periksa(ORG, { dryRun: true, aturan: ATURAN_UJI })

    expect(hasil.sinyalBaru.length).toBeGreaterThan(0)
    expect(hasil.sinyalBaru[0]!.id).toBe('(baru)')
    expect(await prisma.organizationSignal.count({ where: { organizationId: ORG } })).toBe(0)
  })
})

// Emoji check:{Iota}
const ORG_LAIN_PLACEHOLDER = orgLain
void ORG_LAIN_PLACEHOLDER