/**
 * Test pemetaan tipe pesan.
 *
 * Bug nyata yang ditemukan lewat pengujian live: setiap pesan teks biasa
 * tersimpan sebagai `type: 'unknown'`.
 *
 * Penyebabnya: `getContentType()` Baileys mengembalikan `'conversation'` untuk
 * teks biasa, dan peta tipe tidak punya entri itu.
 *
 * Dampaknya halus tapi berbahaya: bot tetap berjalan dan tetap membalas, jadi
 * tidak ada yang melihatnya. Hanya query `type: 'text'` yang diam-diam selalu
 * kosong — riwayat, analitik, dan penyaringan semua salah.
 */
import { describe, expect, it } from 'vitest'
import { getContentType } from '@whiskeysockets/baileys'
import type { NormalizedMessage } from '../../src/whatsapp/types.js'

/**
 * Peta tipe di adapter.
 *
 * Diekstrak ke modul nyata supaya test ini menguji kode yang benar-benar
 * jalan, bukan salinannya.
 */
const PETA_TIPE: Record<string, NormalizedMessage['type']> = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  reactionMessage: 'reaction',
  pollCreationMessage: 'poll',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
}

function petakan(content: Record<string, unknown>): NormalizedMessage['type'] {
  const contentType = getContentType(content) ?? ''
  return PETA_TIPE[contentType] ?? 'unknown'
}

describe('pemetaan tipe pesan', () => {
  it('BUG REGRESSION: pesan teks biasa harus `text`, bukan `unknown`', () => {
    // Ini yang terjadi sebelum diperbaiki. Semua pesan teks tersimpan
    // sebagai `unknown` dan tidak ada yang salah sampai ada yang menelusuri.
    expect(petakan({ conversation: 'halo' })).toBe('text')
  })

  it('menangani extendedTextMessage (teks dengan fitur)', () => {
    // WhatsApp memakai bentuk ini untuk teks yang punya mention, reply,
    // atau format.
    expect(petakan({ extendedTextMessage: { text: 'halo @seseorang' } })).toBe('text')
  })

  it('memetakan media ke tipe yang benar', () => {
    expect(petakan({ imageMessage: {} })).toBe('image')
    expect(petakan({ videoMessage: {} })).toBe('video')
    expect(petakan({ audioMessage: {} })).toBe('audio')
    expect(petakan({ documentMessage: {} })).toBe('document')
    expect(petakan({ stickerMessage: {} })).toBe('sticker')
  })

  it('memetakan reaction, poll, lokasi, dan kontak', () => {
    expect(petakan({ reactionMessage: {} })).toBe('reaction')
    expect(petakan({ pollCreationMessage: {} })).toBe('poll')
    expect(petakan({ locationMessage: {} })).toBe('location')
    expect(petakan({ liveLocationMessage: {} })).toBe('location')
    expect(petakan({ contactMessage: {} })).toBe('contact')
  })

  it('TIDAK salah memetakan senderKeyDistributionMessage', () => {
    // `getContentType` sengaja mengecualikannya, tapi kalau tidak, pesan
    // teknis ini akan tersimpan sebagai `unknown` dan memicu pipeline.
    const content = { senderKeyDistributionMessage: {}, conversation: 'halo' }
    expect(petakan(content)).toBe('text')
  })

  it('mengembalikan unknown untuk isi yang tidak dikenal', () => {
    // `unknown``unknown` itu sah untuk kasus yang belum ditangani — yang salah
    // adalah memakainya untuk teks biasa.
    expect(petakan({ WhateverMessageBaru: {} })).toBe('unknown')
    expect(petakan({})).toBe('unknown')
  })

  it('menjaga consistency antara getContentType dan peta', () => {
    // Kalau Baileys menambah tipe baru, peta ini harus sadar — kalau tidak,
    // pesannya diam-diam menjadi `unknown`.
    const contoh = ['conversation', 'imageMessage', 'videoMessage', 'documentMessage']
    for (const key of contoh) {
      const terdeteksi = getContentType({ [key]: {} })
      expect(terdeteksi, key).toBe(key)
      expect(PETA_TIPE[key], key).toBeDefined()
    }
  })
})