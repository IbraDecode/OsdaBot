/**
 * Test nama tool.
 *
 * Bug nyata yang ditemukan lewat pengujian live: AI gateway menolak seluruh
 * 18 tool dengan `400 bad_request`:
 *
 *     tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'
 *
 * Semua nama tool memakai titik sebagai pemisah namespace
 * (`attendance.create`), dan titik tidak termasuk pola yang diizinkan.
 *
 * Gejalanya sangat menyesatkan karena gateway memakai router: sebagian backend
 * menerima titik, sebagian menolaknya. Jadi tool calling terlihat "kadang
 * jalan, kadang bad_request" — pola yang mudah disalahdiagnosis sebagai
 *Provisiontidak stabil.
 */
import { describe, expect, it } from 'vitest'
import { bootstrap } from '../../src/bootstrap.js'

/**
 * Pola dari gateway, terverifikasi lewat respons error:
 *   tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'
 */
const POLA_NAMA_TOOL = /^[a-zA-Z0-9_-]{1,128}$/

describe('nama tool harus diterima gateway', () => {
  it('BUG REGRESSION: tidak ada nama tool yang memakai titik', async () => {
    const app = await bootstrap({ startWorkers: false })

    const bermasalah = app.tools.names().filter((nama) => !POLA_NAMA_TOOL.test(nama))

    // Galat ini menolak SELURUH permintaan, bukan hanya satu tool. Jadi satu
    // nama saja yang salah sudah cukup untuk membuat tool calling mati total.
    expect(
      bermasalah,
      `Nama tool ini ditolak gateway: ${bermasalah.join(', ')}. Pola yang diterima: ${POLA_NAMA_TOOL}`,
    ).toEqual([])
  })

  it('semua nama tool cocok dengan pola gateway', async () => {
    const app = await bootstrap({ startWorkers: false })

    for (const nama of app.tools.names()) {
      expect(nama, nama).toMatch(POLA_NAMA_TOOL)
      expect(nama.length, nama).toBeLessThanOrEqual(128)
    }
  })

  it('nama tool tidak mengandung karakter khusus lain', async () => {
    // Spasi dan karakter lain selain `-`/`_` juga ditolak.
    const app = await bootstrap({ startWorkers: false })

    for (const nama of app.tools.names()) {
      expect(nama, nama).not.toMatch(/[\s.]/)
    }
  })

  it('PERMISSION tetap boleh memakai titik', async () => {
    // Permission adalah identitas internal yang tidak pernah dikirim ke
    // model. Mengubahnya jadi underscore akan merusak data yang sudah ada.
    //
    // Test ini ada karena overhaul nama tool sempat kelewat dan mengubah
    // permission juga — polypropylene bug yang baru ketahuan karena test ini.
    const { ALL_PERMISSIONS } = await import('../../src/security/permissions.js')

    const berpolaLama = ALL_PERMISSIONS.filter((p) => p.includes('.'))
    expect(berpolaLama.length, 'permission masih memakai titik').toBeGreaterThan(0)

    // Tidak ada permission yang berubah jadi underscore.
    const berubah = ALL_PERMISSIONS.filter((p) => p.includes('_') && !p.includes('.'))
    expect(berubah, `permission ini seharusnya bertitik: ${berubah.join(', ')}`).toEqual([])
  })
})