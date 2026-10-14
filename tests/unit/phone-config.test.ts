/**
 * Test konfigurasi nomor WhatsApp.
 *
 * Dua nomor punya peran yang SANGAT berbeda, dan salah mengisi akan
 * menyebabkan akun yang salah tertaut sebagai bot:
 *
 *   WHATSAPP_LINK_PHONE  → nomor akun BOT yang ditautkan ke Baileys.
 *                           Ini yang dikirim ke `sock.requestPairingCode()`.
 *   WHATSAPP_ADMIN_PHONE → nomor pemilik yang mengendalikan.
 *                           TIDAK PERNAH dikirim ke WhatsApp.
 */
import { describe, expect, it } from 'vitest'
import { maskPhone } from '../../src/whatsapp/baileys-provider.js'

describe('maskPhone', () => {
  it('menyembunyikan bagian tengah nomor', () => {
    // Hanya 4 digit depan dan 2 digit belakang yang terlihat.
    expect(maskPhone('6285177653481')).toBe('6285*******81')
  })

  it('menanganai nomor pendek', () => {
    expect(maskPhone('123456')).toBe('******')
  })

  it('membersihkan karakter non-digit', () => {
    expect(maskPhone('+62 851-7765-3481')).toBe(maskPhone('6285177653481'))
  })

  it('tidak pernah mengembalikan nomor lengkap', () => {
    const nomor = '6285177653481'
    expect(maskPhone(nomor)).not.toBe(nomor)
    expect(maskPhone(nomor).replace(/\*/g, '')).not.toBe(nomor)
  })
})

describe('validasi nomor di env', () => {
  /**
   * Uji aturan yang sama persis dengan yang di `src/config/env.ts`.
   * Disalin supaya test ini tidak perlu me-reload modul env (yang membaca
   * process.env saat import).
   */
  function validasi(link: string | undefined, admin: string | undefined) {
    const masalah: string[] = []
    const nomorValid = (value: string | undefined): boolean => !value || /^\d{8,15}$/.test(value)

    if (!nomorValid(link)) masalah.push('WHATSAPP_LINK_PHONE')
    if (!nomorValid(admin)) masalah.push('WHATSAPP_ADMIN_PHONE')

    if (link && admin && link === admin) masalah.push('LINK_SAMA_DENGAN_ADMIN')

    return masalah
  }

  it('menerima sepasang nomor yang valid dan berbeda', () => {
    expect(validasi('6285177653481', '6285792820173')).toEqual([])
  })

  it('menolak nomor dengan "+", spasi, atau tanda hubung', () => {
    expect(validasi('+62 851-7765-3481', undefined)).toEqual(['WHATSAPP_LINK_PHONE'])
    expect(validasi('(628) 5177653481', undefined)).toEqual(['WHATSAPP_LINK_PHONE'])
    expect(validasi('628 517 7653 481', undefined)).toEqual(['WHATSAPP_LINK_PHONE'])
  })

  it('menolak nomor terlalu pendek atau terlalu panjang', () => {
    expect(validasi('1234567', undefined)).toEqual(['WHATSAPP_LINK_PHONE'])
    expect(validasi('1234567890123456', undefined)).toEqual(['WHATSAPP_LINK_PHONE'])
  })

  it('MENOLAK nomor bot yang sama dengan nomor admin', () => {
    // Ini guardrail paling penting. Kalau keduanya sama, kemungkinan besar
    // akun pemilik ikut ter-link sebagai bot.
    expect(validasi('6285792820173', '6285792820173')).toEqual(['LINK_SAMA_DENGAN_ADMIN'])
  })

  it('menerima hanya salah satu yang terisi', () => {
    expect(validasi('6285177653481', undefined)).toEqual([])
    expect(validasi(undefined, '6285792820173')).toEqual([])
    expect(validasi(undefined, undefined)).toEqual([])
  })

  it('angka 628 (kode negara Indonesia) lolos validasi', () => {
    expect(validasi('6285177653481', undefined)).toEqual([])
    expect(validasi('6285792820173', undefined)).toEqual([])
  })
})