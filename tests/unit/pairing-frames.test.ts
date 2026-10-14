/**
 * Test pembacaan frame server saat pairing.
 *
 * Ini modul yang menangkap bukti penolakan. Kalau dia gagal membaca format
 * yang sebenarnya, penolakan kembali tidak terlihat — dan daemon akan terus
 * mencoba sampai blokir server makin panjang.
 *
 * Test ini mengimpor dari `src/cli/pair-frames.ts` yang SAMA dengan yang
 * dipakai daemon. Menyalin logikanya ke dalam test akan menguji salinan,
 * bukan kode yang benar-benar jalan — persis kelalaian yang membiarkan bug
 * ini lolos sebelumnya.
 */
import { binaryNodeToString } from '@whiskeysockets/baileys'
import { describe, expect, it } from 'vitest'
import {
  describeErrorCode,
  isPairingRelevant,
  isRateLimited,
  parseErrorCode,
} from '../../src/cli/pair-frames.js'

describe('parseErrorCode', () => {
  it('BUG REGRESSION: membaca kutip TUNGGAL', () => {
    // Format sebenarnya dari Baileys. Regex yang hanya mencari kutip ganda
    // mengembalikan null — guard rate limit tidak pernah aktif, dan daemon
    // memperpanjang blokir yang seharusnya membuatnya berhenti.
    const frame = `<iq from='@s.whatsapp.net' type='error' id='30730.36243-1'>
  <error code='429' text='rate-overlimit'/>
</iq>`

    expect(parseErrorCode(frame)).toBe('429')
  })

  it('membaca kode lain dengan kutip tunggal', () => {
    for (const kode of ['400', '404', '405', '429']) {
      expect(parseErrorCode(`<error code='${kode}' text='apa saja'/>`), kode).toBe(kode)
    }
  })

  it('tetap menerima kutip ganda', () => {
    expect(parseErrorCode(`<error code="500" text="server error"/>`)).toBe('500')
  })

  it('mengembalikan null untuk frame tanpa error', () => {
    const frame = `<link_code_companion_reg stage='companion_hello'>
  <link_code_pairing_ref></link_code_pairing_ref>
</link_code_companion_reg>`
    expect(parseErrorCode(frame)).toBeNull()
  })

  it('mengembalikan null untuk teks kosong', () => {
    expect(parseErrorCode('')).toBeNull()
  })

  it('membaca dari output binaryNodeToString yang sungguhan', () => {
    // Memakai API Baileys asli supaya formatnya tidak bisa meleset dari
    // asumsi dokumentasi.
    const frame = {
      tag: 'iq',
      attrs: { from: '@s.whatsapp.net', type: 'error', id: 'X' },
      content: [{ tag: 'error', attrs: { code: '429', text: 'rate-overlimit' } }],
    }

    const teks = binaryNodeToString(frame as never)

    // Dokumentasi format — kalau Baileys berubah ke kutip ganda, test ini
    // memberi tahu sebelum guard diam-diam mati lagi.
    expect(teks).toContain("code='429'")

    expect(parseErrorCode(teks)).toBe('429')
    expect(isRateLimited(teks)).toBe(true)
  })
})

describe('describeErrorCode', () => {
  it('memberi penjelasan yang bisa ditindaklanjuti', () => {
    expect(describeErrorCode('429')).toContain('rate-overlimit')
    expect(describeErrorCode('400')).toContain('companion_platform_id')
    expect(describeErrorCode('404')).toContain('tidak dikenal')
    expect(describeErrorCode('405')).toContain('dibatasi')
  })

  it('memberi pesan generik untuk kode tak dikenal', () => {
    expect(describeErrorCode('599')).toBe('server menolak (599)')
  })
})

describe('isRateLimited', () => {
  it('hanya true untuk 429', () => {
    expect(isRateLimited(`<error code='429' text='rate-overlimit'/>`)).toBe(true)
    expect(isRateLimited(`<error code='405' text='throttled'/>`)).toBe(false)
    expect(isRateLimited(`<error code='400' text='bad-request'/>`)).toBe(false)
  })

  it('BUG REGRESSION: tidak salah baca acknowledgement sebagai blokir', () => {
    // Server membalas `companion_hello` dengan pairing ref — itu BERHASIL.
    // Kalau salah dikira rate limit, daemon berhenti padahal tidak ada
    // yang salah.
    const ack = `<link_code_companion_reg stage='companion_hello'>
  <link_code_pairing_ref>
  </link_code_pairing_ref>
</link_code_companion_reg>`
    expect(isRateLimited(ack)).toBe(false)
  })
})

describe('isPairingRelevant', () => {
  it('menangkap frame yang perlu ditampilkan', () => {
    expect(isPairingRelevant(`<error code='429' text='rate-overlimit'/>`)).toBe(true)
    expect(isPairingRelevant(`<link_code_companion_reg stage='companion_hello'/>`)).toBe(true)
    expect(isPairingRelevant(`<iq id='X'><pair-success/></iq>`)).toBe(true)
  })

  it('membuang frame percakapan biasa', () => {
    // Kalau tidak, log akan penuh dan frame penting tenggelam.
    expect(isPairingRelevant(`<message id='ABC'><text>halo</text></message>`)).toBe(false)
    expect(isPairingRelevant(`<receipt id='ABC' type='read'/>`)).toBe(false)
  })
})