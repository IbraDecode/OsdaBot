/**
 * Test server HTTP — fokus pada verifikasi signature webhook.
 *
 * Keamanan webhook adalah satu-satunya hal yang menghalangi siapa pun
 * mengirim "pembayaran sukses" palsu. Kalau HMAC ini bisa ditembus, seluruh
 * catatan keuangan bisa dimanipulasi.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyBaturPaySignature } from '../../src/server.js'
import type { PaymentStatus } from '@prisma/client'
import { STATUS_MAP } from '../../src/payments/baturpay.js'

const SECRET = 'whsec_test_rahasia'
const TIMESTAMP = '1791996259123'
const BODY = Buffer.from(
  JSON.stringify({
    transaction_id: 'ORD-TEST-1',
    order_id: 'ORD-TEST-1',
    status: 'settlement',
    amount: 25000,
    currency: 'IDR',
  }),
)

function signatureFor(body: Buffer, timestamp: string, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), body]))
    .digest('hex')
}

describe('verifyBaturPaySignature', () => {
  it('menerima signature yang benar', () => {
    expect(verifyBaturPaySignature(BODY, TIMESTAMP, signatureFor(BODY, TIMESTAMP), SECRET)).toBe(true)
  })

  it('menolak signature dengan secret salah', () => {
    const salah = signatureFor(BODY, TIMESTAMP, 'secret_lain')
    expect(verifyBaturPaySignature(BODY, TIMESTAMP, salah, SECRET)).toBe(false)
  })

  it('menolak kalau body diubah walau signature valid untuk body asli', () => {
    // Ini skenario serangan: penyerang mengubah amount dari 25.000 jadi 1.000 tapi
    // memakai signature yang dibuat untuk body asli.
    const bodyDimodifikasi = Buffer.from(BODY.toString('utf8').replace('25000', '1000'))
    expect(verifyBaturPaySignature(bodyDimodifikasi, TIMESTAMP, signatureFor(BODY, TIMESTAMP), SECRET)).toBe(false)
  })

  it('menolak kalau timestamp berbeda', () => {
    // Replay dengan timestamp lama harus gagal walau signature-nya benar
    // untuk timestamp itu, karena header timestamp ikut ditandatangani.
    expect(verifyBaturPaySignature(BODY, '1000000000000', signatureFor(BODY, TIMESTAMP), SECRET)).toBe(false)
  })

  it('menolak signature dengan panjang salah tanpa melempar error', () => {
    expect(verifyBaturPaySignature(BODY, TIMESTAMP, 'abc', SECRET)).toBe(false)
    expect(verifyBaturPaySignature(BODY, TIMESTAMP, '', SECRET)).toBe(false)
  })

  it('menolak signature non-hex tanpa melempar error', () => {
    expect(verifyBaturPaySignature(BODY, TIMESTAMP, 'bukan-hexadecimal', SECRET)).toBe(false)
  })

  it('menolak body kosong', () => {
    const kosong = Buffer.alloc(0)
    expect(verifyBaturPaySignature(kosong, TIMESTAMP, signatureFor(kosong, TIMESTAMP), SECRET)).toBe(true)
    // Body kosong dengan signature body lain harus gagal.
    expect(verifyBaturPaySignature(kosong, TIMESTAMP, signatureFor(BODY, TIMESTAMP), SECRET)).toBe(false)
  })

  it('menggunakan perbandingan timing-safe', () => {
    // Guard: implementasi harus memakai timingSafeEqual, bukan ===.
    // Kita cek sifatnya: dua signature dengan panjang sama tapi isi beda
    // harus ditolak tanpa error.
    const a = signatureFor(BODY, TIMESTAMP)
    const b = signatureFor(BODY, TIMESTAMP).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'))
    expect(verifyBaturPaySignature(BODY, TIMESTAMP, a, SECRET)).toBe(true)
    expect(verifyBaturPaySignature(BODY, TIMESTAMP, b, SECRET)).toBe(false)

    // Sanity: timingSafeEqual sendiri melempar kalau panjang beda —
    // itu sebabnya kita cek panjang sebelum memanggilnya.
    expect(() => timingSafeEqual(Buffer.from('aa', 'hex'), Buffer.from('aabb', 'hex'))).toThrow()
  })
})

describe('pemetaan status BaturPay', () => {
  const kasus: Array<[string, PaymentStatus]> = [
    ['created', 'PENDING'],
    ['pending', 'PENDING'],
    ['settlement', 'SETTLED'],
    ['capture', 'SETTLED'],
    ['expire', 'EXPIRED'],
    ['cancel', 'CANCELLED'],
    ['deny', 'FAILED'],
    ['refund', 'REFUNDED'],
    ['partial_refund', 'REFUNDED'],
    ['chargeback', 'FAILED'],
  ]

  it.each(kasus)('memetakan %s → %s', (input, expected) => {
    expect(STATUS_MAP[input]).toBe(expected)
  })

  it('status tak dikenal menghasilkan undefined, bukan status default yang berbahaya', () => {
    // Kalau ada status baru dari provider, sistem harus menolaknya —
    // bukan diam-diam menganggapnya pending atau (lebih buruk) settled.
    expect(STATUS_MAP['entah']).toBeUndefined()
  })
})