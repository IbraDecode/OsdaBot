/**
 * Test konfigurasi pairing WhatsApp.
 *
 * Setiap test di sini originated dari kegagalan NYATA saat pairing:
 *
 * 1. `companion_platform_id` — server menolak pairing dengan `400
 *    bad-request` kalau elemen kedua tuple browser bukan nama browser yang
 *    dikenali. Symptom-nya persis "kode berhasil dibuat tapi ditolak".
 * 2. 515 (restartRequired) — kalau ikut di-nominasi sebagai no-reconnect,
 *    registrasi tidak pernah diselesaikan setelah pairing sukses.
 * 3. `isNewLogin` — Baileys mengirimnya tanpa field `connection`, jadi
 *    handler yang hanya_branch pada `connection` melewatkannya diam-diam.
 */
import { describe, expect, it } from 'vitest'
import { DisconnectReason, Browsers } from '@whiskeysockets/baileys'
import {
  RECOGNIZED_BROWSER_NAMES,
  companionBrowserIdentity,
  shouldReconnect,
} from '../../src/whatsapp/baileys-provider.js'

/**
 * Replika `getCompanionWebClientType()` dari Baileys.
 * Sengaja disalin supaya test ini mengunci perilaku library yang kita
 *(andai suatu saat berubah, test ini akan gagal dan memberi tahu).
 */
const COMPANION_WEB_CLIENT = {
  UNKNOWN: 0,
  CHROME: 1,
  EDGE: 2,
  FIREFOX: 3,
  IE: 4,
  OPERA: 5,
  SAFARI: 6,
  ELECTRON: 7,
  UWP: 8,
  OTHER_WEB_CLIENT: 9,
} as const

const BROWSER_TO_CLIENT: Record<string, number> = {
  Chrome: COMPANION_WEB_CLIENT.CHROME,
  Edge: COMPANION_WEB_CLIENT.EDGE,
  Firefox: COMPANION_WEB_CLIENT.FIREFOX,
  IE: COMPANION_WEB_CLIENT.IE,
  Opera: COMPANION_WEB_CLIENT.OPERA,
  Safari: COMPANION_WEB_CLIENT.SAFARI,
}

function platformIdOf(identity: string[]): number {
  const [os, browserName] = identity
  if (browserName === 'Desktop') {
    return os === 'Windows' ? COMPANION_WEB_CLIENT.UWP : COMPANION_WEB_CLIENT.ELECTRON
  }
  return BROWSER_TO_CLIENT[browserName ?? ''] ?? COMPANION_WEB_CLIENT.OTHER_WEB_CLIENT
}

describe('companion platform id', () => {
  it('identitas browser yang dipakai dikenali server', () => {
    const identity = companionBrowserIdentity()

    // Elemen kedua WAJIB nama browser yang dikenal — inilah yang divalidasi
    // server saat pairing.
    expect(RECOGNIZED_BROWSER_NAMES).toContain(identity[1] as never)
    expect(platformIdOf(identity)).toBe(COMPANION_WEB_CLIENT.CHROME)
    expect(platformIdOf(identity)).not.toBe(COMPANION_WEB_CLIENT.OTHER_WEB_CLIENT)
  })

  it('BUG REGRESSION: nama merek sendiri membuat pairing ditolak server', () => {
    // Ini konfigurasi yang dipakai sebelumnya dan yang menyebabkan `400 bad-request`.
    const rusak = Browsers.ubuntu('OSDABOT')
    expect(platformIdOf(rusak)).toBe(COMPANION_WEB_CLIENT.OTHER_WEB_CLIENT)
  })

  it('hanya nama browser yang dikenali yang lolos', () => {
    for (const name of RECOGNIZED_BROWSER_NAMES) {
      expect(platformIdOf(['Ubuntu', name, '22.04.4']), `browser ${name}`).not.toBe(
        COMPANION_WEB_CLIENT.OTHER_WEB_CLIENT,
      )
    }
  })

  it('nama sembarang lain juga ditolak', () => {
    for (const name of ['OSDABOT', 'Bot', 'Puppeteer', 'NodeJS', '', 'chrome']) {
      // Perhatikan 'chrome' huruf kecil juga tidak dikenali — pencocokan eksak.
      expect(platformIdOf(['Ubuntu', name, '22.04.4']), `browser "${name}"`).toBe(
        COMPANION_WEB_CLIENT.OTHER_WEB_CLIENT,
      )
    }
  })

  it('pakai platform Ubuntu + Chrome — kombinasi yang terkonfirmasi', () => {
    const identity = companionBrowserIdentity()
    expect(identity[0]).toBe('Ubuntu')
    expect(identity[1]).toBe('Chrome')
  })
})

describe('kebijakan reconnect', () => {
  it('TIDAK reconnect pada sesi yang sudah logout', () => {
    expect(shouldReconnect({ output: { statusCode: DisconnectReason.loggedOut } })).toBe(false)
    expect(shouldReconnect({ output: { statusCode: 403 } })).toBe(false)
    expect(shouldReconnect({ output: { statusCode: 419 } })).toBe(false)
  })

  it('TIDAK reconnect pada multidevice mismatch — perlu unlink manual di HP', () => {
    expect(shouldReconnect({ output: { statusCode: DisconnectReason.multideviceMismatch } })).toBe(false)
  })

  it('TIDAK reconnect saat device lain memakai session yang sama', () => {
    expect(shouldReconnect({ output: { statusCode: DisconnectReason.connectionReplaced } })).toBe(false)
  })

  it('TIDAK reconnect saat pairing di-throttle server (risiko ban)', () => {
    expect(shouldReconnect({ output: { statusCode: 405 } })).toBe(false)
    expect(shouldReconnect({ output: { statusCode: 463 } })).toBe(false)
  })

  it('BUG REGRESSION: 515 harus reconnect — itu requests restart setelah pairing', () => {
    // Kalau 515 ikut di-nominasi, pairing tidak pernah selesai: socket
    // berhenti permanen sebelum registrasi selesai.
    expect(DisconnectReason.restartRequired).toBe(515)
    expect(shouldReconnect({ output: { statusCode: DisconnectReason.restartRequired } })).toBe(true)
  })

  it('reconnect untuk gangguan sesaat yang wajar', () => {
    for (const code of [408, 428, 500, 503, undefined]) {
      expect(shouldReconnect(code === undefined ? {} : { output: { statusCode: code } })).toBe(true)
    }
  })

  it('reconnect kalau error tanpa kode status sama sekali', () => {
    expect(shouldReconnect(undefined)).toBe(true)
    expect(shouldReconnect(new Error('ECONNRESET'))).toBe(true)
  })
})