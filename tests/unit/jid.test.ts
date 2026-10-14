import { describe, expect, it } from 'vitest'
import {
  formatMention,
  getPhoneNumber,
  isGroupJid,
  isSameJid,
  isUserJid,
  normalizeJid,
  parseJid,
  stripBroadcastSuffix,
  stripLidPrefix,
  toInternationalPhone,
} from '../../src/whatsapp/jid.js'

describe('parseJid', () => {
  it('mengenali JID nomor telepon', () => {
    const parsed = parseJid('6281234567890@s.whatsapp.net')
    expect(parsed).toEqual({
      user: '6281234567890',
      server: 's.whatsapp.net',
      kind: 'pn',
      phoneNumber: '6281234567890',
    })
  })

  it('mengenali JID LID — dan TIDAK menyimpulkan nomor telepon', () => {
    const parsed = parseJid('123456789012345@lid')
    expect(parsed?.kind).toBe('lid')
    // Ini yang penting: LID bukan nomor telepon.
    expect(parsed?.phoneNumber).toBeNull()
  })

  it('mengenali JID grup', () => {
    expect(parseJid('6281234567890@c.us')?.kind).toBe('pn')
    expect(parseJid('12036304290123456789@g.us')?.kind).toBe('group')
  })

  it('membuang device suffix', () => {
    expect(parseJid('6281234567890:12@s.whatsapp.net')?.user).toBe('6281234567890')
  })

  it('menangani c.us sebagai alias PN', () => {
    expect(parseJid('6281234567890@c.us')?.kind).toBe('pn')
  })

  it('mengembalikan null untuk input tidak valid', () => {
    expect(parseJid(null)).toBeNull()
    expect(parseJid(undefined)).toBeNull()
    expect(parseJid('')).toBeNull()
    expect(parseJid('  ')).toBeNull()
    expect(parseJid('@s.whatsapp.net')).toBeNull()
  })
})

describe('normalizeJid', () => {
  it('menormalisasi ke bentuk kanonik', () => {
    expect(normalizeJid('6281234567890@S.WhatsApp.Net')).toBe('6281234567890@s.whatsapp.net')
    expect(normalizeJid('6281234567890:5@s.whatsapp.net')).toBe('6281234567890@s.whatsapp.net')
  })
})

describe('isGroupJid / isUserJid', () => {
  it('membedakan jenis JID', () => {
    expect(isGroupJid('12036304290123456789@g.us')).toBe(true)
    expect(isGroupJid('6281234567890@s.whatsapp.net')).toBe(false)

    expect(isUserJid('6281234567890@s.whatsapp.net')).toBe(true)
    expect(isUserJid('123456789012345@lid')).toBe(true)
    expect(isUserJid('12036304290123456789@g.us')).toBe(false)
  })
})

describe('getPhoneNumber', () => {
  it('mengembalikan nomor untuk PN JID', () => {
    expect(getPhoneNumber('6281234567890@s.whatsapp.net')).toBe('6281234567890')
  })

  it('mengembalikan null untuk LID JID — nomor tidak bisa diasumsikan', () => {
    expect(getPhoneNumber('123456789012345@lid')).toBeNull()
  })
})

describe('toInternationalPhone', () => {
  it('menormalisasi ke format digits saja', () => {
    expect(toInternationalPhone('+62 812-3456-7890')).toBe('6281234567890')
    expect(toInternationalPhone('6281234567890')).toBe('6281234567890')
  })

  it('menolak nomor yang tidak masuk akal', () => {
    expect(toInternationalPhone('123')).toBeNull()
    expect(toInternationalPhone('12345678901234567890')).toBeNull()
  })
})

describe('formatMention', () => {
  it('membuat teks mention dari PN JID', () => {
    expect(formatMention('6281234567890@s.whatsapp.net')).toBe('@6281234567890')
  })

  it('membuat teks mention dari LID JID', () => {
    expect(formatMention('123456789012345@lid')).toBe('@123456789012345')
  })

  it('tidak melempar error untuk JID rusak', () => {
    expect(formatMention('rusak')).toBe('@rusak')
  })
})

describe('isSameJid', () => {
  it('menyatakan sama hanya untuk JID identik', () => {
    expect(isSameJid('628@s.whatsapp.net', '628@s.whatsapp.net')).toBe(true)
    expect(isSameJid('628@s.whatsapp.net', '629@s.whatsapp.net')).toBe(false)
  })

  it('TIDAK menganggap PN dan LID sama tanpa mapping resmi', () => {
    // Ini batas penting: LID bukan nomor, jadi tidak boleh disamakan diam-diam.
    expect(isSameJid('6281234567890@s.whatsapp.net', '123456789012345@lid')).toBe(false)
  })

  it('membandingkan c.us dan s.whatsapp.net sebagai user yang sama', () => {
    expect(isSameJid('628@s.whatsapp.net', '628@c.us')).toBe(false)
  })
})

describe('stripBroadcastSuffix', () => {
  it('membuang sufiks broadcast', () => {
    expect(stripBroadcastSuffix('628123@s.whatsapp.net,123')).toBe('628123@s.whatsapp.net')
    expect(stripBroadcastSuffix('628123@s.whatsapp.net')).toBe('628123@s.whatsapp.net')
  })
})

describe('stripLidPrefix', () => {
  it('membuang prefix lid:', () => {
    expect(stripLidPrefix('lid:123456')).toBe('123456')
    expect(stripLidPrefix('123456')).toBe('123456')
  })
})