import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEMPLATE,
  detectFormatHints,
  extractTitle,
  renderAttendanceList,
  renderEmptyAttendanceList,
  renderStatusSummary,
  toRenderEntries,
  type RenderEntry,
} from '../../src/attendance/renderer.js'

/**
 * SKENARIO INI MENJADI KONTRAK PRODUK.
 *
 * Daftarnya persis seperti yang dipakai user di sekolah, dan instruksinya
 * "ubah Ibra jadi izin karena ada meeting". Kalau renderer ini rusak, daftar
 * yang tampil jadi berbeda dari aslinya — itu bug nyata, bukan detail.
 */
const DAFTAR_AWAL: RenderEntry[] = [
  { memberId: 'm1', displayName: 'Ni Ketut Rianti', className: 'X MPK 1', status: 'PRESENT', reason: null },
  { memberId: 'm2', displayName: 'Danya Sefti Cahyani', className: 'X AKL 3', status: 'PRESENT', reason: null },
  { memberId: 'm3', displayName: 'Ibra Ramdan', className: 'X BDG 1', status: 'PRESENT', reason: null },
]

describe('renderAttendanceList', () => {
  it('mempertahankan judul dari pengguna', () => {
    const output = renderAttendanceList(DAFTAR_AWAL, {
      title: '*LIST YANG HADIR LKBB, KAMIS, 15 OKTOBER 2026*',
    })
    expect(output).toContain('*LIST YANG HADIR LKBB, KAMIS, 15 OKTOBER 2026*')
  })

  it('menampilkan anggota hadir dengan penomoran dan kelas', () => {
    const output = renderAttendanceList(DAFTAR_AWAL, { title: '*DAFTAR*' })
    expect(output).toContain('1. Ni Ketut Rianti (X MPK 1)')
    expect(output).toContain('2. Danya Sefti Cahyani (X AKL 3)')
    expect(output).toContain('3. Ibra Ramdan (X BDG 1)')
  })

  it('SKENARIO UTAMA: "ubah Ibra jadi izin karena ada meeting"', () => {
    const setelahUbah: RenderEntry[] = [
      DAFTAR_AWAL[0]!,
      DAFTAR_AWAL[1]!,
      { ...DAFTAR_AWAL[2]!, status: 'EXCUSED', reason: 'meeting' },
    ]

    const output = renderAttendanceList(setelahUbah, { title: '*LIST YANG HADIR LKBB, KAMIS, 15 OKTOBER 2026*' })

    // Penomoran harus diperbarui: Ibra pindah ke seksi izin.
    expect(output).toContain('1. Ni Ketut Rianti (X MPK 1)')
    expect(output).toContain('2. Danya Sefti Cahyani (X AKL 3)')
    expect(output).not.toContain('3. Ibra Ramdan (X BDG 1)')

    // Seksi izin dengan alasan.
    expect(output).toContain('*IZIN*')
    expect(output).toContain('Ibra Ramdan (X BDG 1) — meeting')

    // Nama anggota lain tidak berubah.
    expect(output).toContain('Danya Sefti Cahyani (X AKL 3)')
  })

  it('pemisahan seksi status mengikuti cetakan yang disimpan', () => {
    const output = renderAttendanceList(
      [
        { memberId: '1', displayName: 'A', className: 'X', status: 'SICK', reason: 'demam' },
        { memberId: '2', displayName: 'B', className: 'X', status: 'ABSENT', reason: null },
        { memberId: '3', displayName: 'C', className: 'X', status: 'UNCONFIRMED', reason: null },
      ],
      { title: '*DAFTAR*' },
    )

    expect(output).toContain('*SAKIT*')
    expect(output).toContain('*ALPA*')
    expect(output).toContain('*BELUM KONFIRMASI*')
  })

  it('menghormati marker tebal underscore dari pengguna', () => {
    const output = renderAttendanceList(DAFTAR_AWAL, {
      title: '_DAFTAR HADIR_',
      template: { boldMarker: '_' },
    })
    expect(output).toContain('_HADIR_')
  })

  it('menghasilkan penanda kosong untuk daftar tanpa anggota', () => {
    const output = renderAttendanceList([], { title: '*DAFTAR*' })
    expect(output).toContain('*DAFTAR*')
    expect(output).toContain('-')
  })

  it('menghormati catatan footer', () => {
    const output = renderAttendanceList(DAFTAR_AWAL, {
      title: '*DAFTAR*',
      template: { ...DEFAULT_TEMPLATE, footerTemplate: '*Total: ${total} orang*' },
    })
    expect(output).toContain('*Total: 3 orang*')
  })
})

describe('renderEmptyAttendanceList', () => {
  it('membuat daftar kosong dengan heading yang benar', () => {
    const output = renderEmptyAttendanceList('*LIST YANG HADIR LKBB*')
    expect(output).toContain('*LIST YANG HADIR LKBB*')
    expect(output).toContain('*HADIR*')
    expect(output).toContain('-')
  })
})

describe('renderStatusSummary', () => {
  it('menampilkan ringkasan per status', () => {
    const output = renderStatusSummary([
      { memberId: '1', displayName: 'Ibra Ramdan', className: 'X BDG 1', status: 'EXCUSED', reason: 'meeting' },
    ])
    expect(output).toContain('*IZIN*')
    expect(output).toContain('Ibra Ramdan — X BDG 1 — meeting')
  })
})

describe('detectFormatHints', () => {
  it('mendeteksi marker bold dari markdown pengguna', () => {
    const hints = detectFormatHints('_DAFTAR HADIR_\n\n1. Budi')
    expect(hints.boldMarker).toBe('_')
  })

  it('mendeteksi penanda kosong', () => {
    const hints = detectFormatHints('*DAFTAR*\n\n*IZIN*\n-')
    expect(hints.emptyMarker).toBe('-')
  })

  it('mendeteksi gaya penomoran', () => {
    const hints = detectFormatHints('*DAFTAR*\n\n1. Budi\n2. Sari')
    expect(hints.lineTemplate).toContain('${nomor}')
  })
})

describe('extractTitle', () => {
  it('mengambil judul yang sudah di-bold', () => {
    expect(extractTitle('*LIST YANG HADIR*\n\n1. Budi')).toBe('*LIST YANG HADIR*')
  })

  it('mengambil baris pendek pertama sebagai judul', () => {
    expect(extractTitle('Daftar Hadir LKBB\n\n1. Budi')).toBe('Daftar Hadir LKBB')
  })

  it('menggunakan fallback kalau tidak ada judul', () => {
    expect(extractTitle('1. Budi\n2. Sari', '*CADANGAN*')).toBe('*CADANGAN*')
  })
})

describe('toRenderEntries', () => {
  it('memetakan entri Prisma ke bentuk render', () => {
    const entries = toRenderEntries([
      {
        memberId: 'm1',
        displayName: 'Budi',
        className: 'X',
        status: 'PRESENT',
        reason: null,
      },
    ])
    expect(entries[0]).toEqual({
      memberId: 'm1',
      displayName: 'Budi',
      className: 'X',
      status: 'PRESENT',
      reason: null,
    })
  })
})