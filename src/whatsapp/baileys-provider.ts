/**
 * Adapter Baileys — satu-satunya tempat yang boleh tahu detail library WhatsApp.
 *
 * ── Fakta hasil riset kode Baileys v7.0.0-rc14 yang dipakai di sini ───────
 * (diverifikasi langsung dari source, bukan dari dokumentasi yang sering
 *  salah)
 *
 * 1. `printQRInTerminal` SUDAH DIHAPUS. QR arrive lewat event
 *    `connection.update` → `{ qr }` (string biasa, bukan data-URL).
 *
 * 2. `DisconnectReason` hanya punya 10 nilai:
 *    401 loggedOut · 403 forbidden · 408 timedOut/connectionLost ·
 *    411 multideviceMismatch · 428 connectionClosed · 440 connectionReplaced ·
 *    500 badSession · 503 unavailableService · 515 restartRequired.
 *    Dan `UNAUTHORIZED_CODES = [401, 403, 419]` (419 TIDAK ada di enum).
 *
 * 3. 408 dipakai DUA kali (`connectionLost` dan `timedOut`) — tidak bisa
 *    dibedakan. Kode di luar enum (mis. 405, 463) juga mungkin muncul dari
 *    `CB:failure`.
 *
 * 4. `messages.upsert` bertipe `'notify' | 'append'`. `append` berarti pesan
 *    datang saat perangkat offline (offline sync) → jangan auto-reply.
 *
 * 5. `GroupParticipant` runtime shape: `{ id, phoneNumber?, lid?, username?,
 *    admin }`. Field `isAdmin`/`isSuperAdmin` TIDAK diisi runtime — pakai
 *    `admin === 'admin'`.
 *
 * 6. LID: `key.participantAlt` (grup) / `key.remoteJidAlt` (DM) berisi JID
 *    lawannya yang paling bisa ditampilkan. Mapping LID↔PN ada di
 *    `sock.signalRepository.lidMapping` (v7 saja).
 *
 * 7. Reaksi dikirim lewat `sendMessage(jid, { react: { text, key } })`.
 *    Tidak ada fungsi `sendReaction`.
 *
 * 8. `end()` akan remove semua listener dan destroy event emitter — socket
 *    yang sudah close MATI PERMANEN, harus dibuat instance baru.
 */
import { setTimeout as delay } from 'node:timers/promises'
import makeWASocket, {
  Browsers,
  DEFAULT_CACHE_TTLS,
  DisconnectReason,
  UNAUTHORIZED_CODES,
  downloadMediaMessage,
  getContentType,
  getKeyAuthor,
  isLidUser,
  isPnUser,
  jidDecode,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  type CacheStore,
  type GroupMetadata,
  type WASocket,
  type WAMessage,
  type WAMessageContent,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { env } from '../config/env.js'
import { logger } from '../observability/logger.js'
import { formatMention, normalizeJid, parseJid } from './jid.js'
import { destroySession, loadSession } from './session-store.js'
import type {
  ConnectionState,
  ConnectionStatus,
  DeliveryStatus,
  NormalizedMessage,
  NormalizedGroupMetadata,
  SendResult,
  SendTextOptions,
  WhatsAppProvider,
  WhatsAppProviderEvents,
} from './types.js'

const log = logger.child({ module: 'baileys' })

/**
 * Logger untuk Baileys sendiri.
 *
 * WAJIB level 'warn'. Pada level 'info', Baileys mencetak `helloMsg`
 * (ephemeral key) dan `node` (payload registrasi berisi `devicePairingData`) —
 * itu materi kriptografis SENSITIF yang tidak boleh masuk log.
 *
 * Pakai `logger.child()` dari Pino supaya interface-nya lengkap (`child()`,
 * `level`) sesuai yang Baileys butuhkan, dengan level dan redaksi tambahan.
 */
const baileysLog = logger.child({ module: 'baileys' }, {
  level: 'warn',
  redact: {
    paths: [
      'node',
      'node.devicePairingData',
      'node.noiseKey',
      'helloMsg',
      'helloMsg.clientHello',
      'helloMsg.clientHello.ephemeral',
      'creds',
      'keys',
      'ephemeral',
      'devicePairingData',
      'noiseKey',
      'signedIdentityKey',
      'signedPreKey',
      'advSecretKey',
      'identityKey',
      'payload',
    ],
    censor: '[REDACTED]',
  },
})


/**
 * Identitas browser yang dikirim ke server WhatsApp.
 *
 * ── Kenapa tidak boleh bebas ────────────────────────────────────────────────
 * Elemen KEDUA dari tuple browser bukan nama tampilan — itu IDENTIFIER TIPE
 * BROWSER yang dipakai `getCompanionWebClientType()` di Baileys:
 *
 *     BROWSER_TO_COMPANION_WEB_CLIENT = { Chrome: 1, Edge: 2, Firefox: 3,
 *                                         IE: 4, Opera: 5, Safari: 6 }
 *     return BROWSER_TO_COMPANION_WEB_CLIENT[browserName] ?? OTHER_WEB_CLIENT(9)
 *
 * Pencocokan itu EKSAK. Nama di luar daftar itu jatuh ke `9`
 * (OTHER_WEB_CLIENT), dan server WhatsApp membalas pairing dengan
 * `400 bad-request` — kodenya tetap tercetak, tapi mustahil dipakai.
 *
 * Ini persis symptom "pairing code berhasil dibuat tapi ditolak" yang
 * dilaporkan di issue Baileys #1266 dan #1761.
 *
 * Platform `Ubuntu` dipakai karena kombinasi `["Ubuntu", "Chrome", ...]`
 * satu-satunya yang dikonfirmasi berhasil oleh beberapa pelapor
 * independen, termasuk di dalam Docker.
 */
export function companionBrowserIdentity(): [string, string, string] {
  return ['Ubuntu', 'Chrome', '22.04.4']
}

/** Nama browser yang dikenali server. Sisanya ditolak saat pairing. */
export const RECOGNIZED_BROWSER_NAMES = ['Chrome', 'Edge', 'Firefox', 'IE', 'Opera', 'Safari'] as const

/**
 * Cache msgRetryCounter HARUS hidup di luar socket.
 * Source: Example/example.ts — "keep this out of the socket itself, so as to
 * prevent a message decryption/encryption loop across socket restarts".
 * Keeping it outside is what breaks that loop.
 */
const msgRetryCounterCache = createSimpleCache(DEFAULT_CACHE_TTLS.MSG_RETRY)

/** Cache kecil sederhana yang memenuhi interface `CacheStore` Baileys. */
function createSimpleCache(ttlMs: number): CacheStore {
  const store = new Map<string, { value: unknown; expiresAt: number }>()

  return {
    get<T>(key: string): T | undefined {
      const hit = store.get(key)
      if (!hit) return undefined
      if (hit.expiresAt <= Date.now()) {
        store.delete(key)
        return undefined
      }
      return hit.value as T
    },
    set<T>(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    },
    del(key: string): void {
      store.delete(key)
    },
    flushAll(): void {
      store.clear()
    },
  } as CacheStore
}

/** Cache metadata grup supaya tidak query WA tiap kali kirim pesan. */
const groupMetadataCache = createSimpleCache(60 * 60 * 1000)

/** Kode status yang TIDAK boleh di-reconnect. */
const NO_RECONNECT = new Set<number>([
  ...UNAUTHORIZED_CODES, // 401 loggedOut, 403 forbidden, 419 unauthorized
  DisconnectReason.multideviceMismatch, // 411 — perlu unlink manual di HP
  DisconnectReason.connectionReplaced, // 440 — device lain memakai session ini
  405, // "Connection Failure" saat pairing — throttling sisi server
  463, // "Reachout Timelock" — risiko BAN
])

/**
 * 515 (restartRequired) SENGAJA TIDAK ADA di NO_RECONNECT.
 *
 * Ini sebab paling sering pairing code "berhasil dibuat tapi tidak pernah
 * tertaut": setelah `pair-success`, server meminta koneksi di-restart dan
 * mengirim 515. Kalau 515 ikut di-nominasi, socket berhenti permanen dan
 * registrasi tidak pernah diselesaikan.
 *
 * 515 artinya "restart", bukan "logout". Reconnect justru yang diminta.
 */

/**
 * Keputusan reconnect.
 *
 * PENTING: kode yang TIDAK kita kenal tetap dicoba reconnect, karena
 * kegagalan sesaat (jaringan, server WA) normal terjadi. Yang kita NOMINASI
 * hanya kode yang berarti "percobaan ulang justru memperburuk keadaan".
 */
export function shouldReconnect(error: unknown): boolean {
  const statusCode = (error as Boom | undefined)?.output?.statusCode
  if (statusCode === undefined) return true
  return !NO_RECONNECT.has(statusCode)
}

/** Backoff eksponensial dengan jitter penuh supaya tidak thundering herd. */
function backoffMs(attempt: number): number {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 60_000)
  return Math.round(base * (0.5 + Math.random() / 2))
}

type ListenerMap = {
  [K in keyof WhatsAppProviderEvents]: Set<(...args: Parameters<WhatsAppProviderEvents[K]>) => void>
}

export interface BaileysProviderOptions {
  sessionFolder?: string
  /** Nama yang tampil di WhatsApp → Linked Devices. */
  browserName?: string
  /**
   * Nomor akun yang akan DITAUTKAN ke Baileys (nomor BOT).
   *
   * PENTING: ini BUKAN nomor pemilik/admin. `sock.requestPairingCode(nomor)`
   * menautkan nomor yang diberikan sebagai perangkat companion — kalau diisi
   * nomor pemilik, akun pemilik-lah yang jadi bot.
   */
  linkPhone?: string
}

export class BaileysProvider implements WhatsAppProvider {
  readonly name = 'baileys'

  private sock: WASocket | null = null
  private listeners: ListenerMap = {
    message: new Set(),
    connection: new Set(),
    pairingCode: new Set(),
    qr: new Set(),
    groupDiscovered: new Set(),
  }
  private errorListeners = new Set<(error: Error, context?: string) => void>()

  private status: ConnectionStatus = {
    state: 'disconnected',
    phoneNumber: null,
    reason: 'belum dijalankan',
    since: new Date(),
  }

  private reconnectAttempts = 0
  private connecting = false
  private shuttingDown = false
  private readonly sessionFolder: string
  private readonly browserName: string
  private readonly linkPhone: string | null

  constructor(options: BaileysProviderOptions = {}) {
    this.sessionFolder = options.sessionFolder ?? env.WHATSAPP_SESSION_DIR
    this.browserName = options.browserName ?? 'OSDABOT'
    this.linkPhone = options.linkPhone ?? env.WHATSAPP_LINK_PHONE ?? null
  }

  // ===========================================================================
  // Koneksi
  // ===========================================================================

  async connect(): Promise<void> {
    if (this.connecting) {
      log.warn('connect() dipanggil saat sedang berjalan')
      return
    }
    this.connecting = true
    this.shuttingDown = false

    const { state, saveCreds, hasSession } = await loadSession(this.sessionFolder)
    log.info({ hasSession, folder: this.sessionFolder }, 'memuat session WhatsApp')

    // Socket SELALU dibungkus makeCacheableSignalKeyStore: tanpa cache, setiap
    // encrypt/decrypt melakukan banyak operasi I/O file.
    // Socket juga yang menambahkan kapabilitas `.transaction()` sendiri —
    // kita cukup providing SignalKeyStore biasa.
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, log),
      },
      logger: baileysLog,
      browser: companionBrowserIdentity(),
      // Bot boleh online 24/7 tanpa membuat HP utama kehilangan notifikasi.
      markOnlineOnConnect: env.WHATSAPP_MARK_ONLINE_ON_CONNECT,
      // Bot tidak butuh riwayat chat lama — menghemat waktu start & RAM.
      syncFullHistory: false,
      // 250ms terlalu agresif untuk bot yang ramai; 1500ms lebih aman.
      retryRequestDelayMs: 1_500,
      maxMsgRetryCount: 3,
      // WAJIB: tanpa ini, retry pesan & agregasi vote poll diam-diam gagal.
      getMessage: async () => undefined,
      // WAJIB: tanpa cache, groupMetadata() dipanggil tiap kirim → 428.
      cachedGroupMetadata: async (jid) => groupMetadataCache.get<GroupMetadata>(jid),
      msgRetryCounterCache,
      // Satu instance socket total; biarkan default v7.
      enableAutoSessionRecreation: true,
      enableRecentMessageCache: true,
      generateHighQualityLinkPreview: false,
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3_000 },
    })

    this.sock = sock

    sock.ev.on('creds.update', () => {
      void saveCreds()
    })

    sock.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(update)
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      for (const message of messages) {
        try {
          void this.handleIncoming(message, type)
        } catch (error) {
          this.emitError(error as Error, 'messages.upsert')
        }
      }
    })

    // Cache grup di-refresh saat ada perubahan.
    sock.ev.on('groups.update', (updates) => {
      for (const group of updates) {
        if (!group.id) continue
        const subject = typeof group.subject === 'string' ? group.subject : null
        // Grup yang baru didaftarkan ikut dilaporkan, supaya operator
        // tidak perlu menunggu ada pesan untuk bisa menautkannya.
        if (subject) this.emitDiscoveredGroup(group.id, subject)
      }
      void (async () => {
        for (const group of updates) {
          if (!group.id) continue
          const cached = await groupMetadataCache.get<GroupMetadata>(group.id)
          groupMetadataCache.set<GroupMetadata>(group.id, { ...(cached ?? {}), ...group } as GroupMetadata)
        }
      })()
    })
    sock.ev.on('group-participants.update', ({ id }) => {
      groupMetadataCache.del(id)
    })

    // LID: jangan andalkan event ini — emitter-nya hanya terpasang di
    // messages-recv-recent pada sebagian jalur, bisa tidak selalu terpanggil.
    // Kita ambil mapping langsung dari `signalRepository.lidMapping`.

    this.setStatus(sock.authState.creds.registered ? 'reconnecting' : 'connecting', null, 'socket dibuat')
  }

  private async handleConnectionUpdate(update: {
    connection?: 'open' | 'connecting' | 'close'
    lastDisconnect?: { error?: Boom | Error }
    qr?: string
    isNewLogin?: boolean
    receivedPendingNotifications?: boolean
  }): Promise<void> {
    const { connection, lastDisconnect, qr, isNewLogin } = update

    if (qr) {
      this.emit('qr', qr)
      return
    }

    /**
     * `isNewLogin` = server mengonfirmasi pairing BERHASIL.
     *
     * Baileys mengirimnya TANPA field `connection`, jadi handler lama
     * melewatkannya sepenuhnya — dan pairing pun menggantung tanpa selesai.
     *
     * Setelah pairing berhasil, server meminta koneksi di-restart (515).
     * Kita biarkan `handleConnectionUpdate` yang menutup socket, lalu
     * `shouldReconnect(515)` yang mengembalikan true dan memulai ulang.
     */
    if (isNewLogin) {
      this.reconnectAttempts = 0
      this.setStatus('reconnecting', this.status.phoneNumber, 'pairing berhasil, menyelesaikan registrasi')
      log.info('pairing berhasil — menunggu koneksi ulang untuk menyelesaikan registrasi')
      return
    }

    if (connection === 'connecting') {
      this.setStatus('connecting', this.status.phoneNumber, 'menghubungkan')
      return
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0
      const me = this.sock?.authState.creds.me
      const phoneNumber = me?.id ? jidDecode(me.id)?.user ?? null : null
      this.setStatus('connected', phoneNumber, 'terhubung')
      log.info({ phoneNumber }, 'WhatsApp terhubung')
      return
    }

    if (connection === 'close') {
      const error = lastDisconnect?.error
      const statusCode = (error as Boom | undefined)?.output?.statusCode

      if (this.shuttingDown) {
        this.setStatus('disconnected', this.status.phoneNumber, 'dimatikan oleh aplikasi')
        this.connecting = false
        return
      }

      log.warn({ statusCode, err: error }, 'koneksi WhatsApp terputus')

      if (!shouldReconnect(error)) {
        this.reconnectAttempts = 0
        this.setStatus('auth_required', this.status.phoneNumber, `butuh authenticate ulang (${statusCode ?? 'tidak diketahui'})`)
        this.connecting = false
        return
      }

      this.reconnectAttempts += 1
      if (this.reconnectAttempts > 20) {
        log.error('terlalu banyak percobaan reconnect, berhenti')
        this.setStatus('failed', this.status.phoneNumber, 'terlalu banyak percobaan reconnect')
        this.connecting = false
        return
      }

      const waitMs = backoffMs(this.reconnectAttempts)
      this.setStatus('reconnecting', this.status.phoneNumber, `putus (${statusCode ?? '?'}), mencoba lagi dalam ${Math.round(waitMs / 1000)} detik`)

      // Socket yang sudah `end()` MATI PERMANEN (listener di-remove, emitter
      // di-destroy). Wajib buat instance baru.
      await delay(waitMs)
      this.connecting = false
      await this.connect().catch((error) => {
        this.emitError(error as Error, 'reconnect')
      })
    }
  }

  async disconnect(): Promise<void> {
    this.shuttingDown = true
    const sock = this.sock
    if (!sock) return
    try {
      sock.ev.removeAllListeners('connection.update')
      await sock.end(undefined)
    } catch (error) {
      log.warn({ err: error }, 'error saat menutup socket')
    }
    this.sock = null
    this.setStatus('disconnected', this.status.phoneNumber, 'dimatikan')
  }

  getStatus(): ConnectionStatus {
    return { ...this.status }
  }

  /**
   * Pairing code — hanya kalau BELUM pernah terdaftarkan.
   *
   * `phoneNumber` di sini adalah nomor akun yang akan menjadi BOT, bukan
   * nomor pemilik yang mengendalikan.
   */
  async requestPairingCode(phoneNumber?: string): Promise<string> {
    const sock = this.sock
    if (!sock) throw new Error('Socket belum terhubung. Jalankan connect() lebih dulu.')

    if (sock.authState.creds.registered) {
      throw new Error('Nomor ini sudah tertaut. Logout dulu kalau ingin menautkan ulang.')
    }

    const number = phoneNumber ?? this.linkPhone
    if (!number) {
      throw new Error(
        'Nomor akun bot belum diisi. Set WHATSAPP_LINK_PHONE ke nomor bot ' +
          '(digits + kode negara, mis. 6281234567890).',
      )
    }

    // Hanya digits + country code. '+', '-', '()' dan spasi membuat jidEncode
    // menghasilkan JID tidak valid.
    const clean = number.replace(/[^0-9]/g, '')
    if (clean.length < 8 || clean.length > 15) {
      throw new Error('Nomor tidak valid. Gunakan format digits + kode negara, mis. 6281234567890.')
    }

    if (env.WHATSAPP_ADMIN_PHONE && env.WHATSAPP_ADMIN_PHONE === clean) {
      throw new Error(
        'Nomor tersebut sama dengan WHATSAPP_ADMIN_PHONE. Nomor admin tidak boleh ' +
          'dipakai untuk menautkan bot — bot harus nomor akun terpisah.',
      )
    }

    const code = await sock.requestPairingCode(clean)
    this.emit('pairingCode', code)
    log.info({ account: maskPhone(clean) }, 'kode pairing dibuat')
    return code
  }

  /** Hapus session dan logout dari WhatsApp. */
  async logout(): Promise<void> {
    const sock = this.sock
    this.shuttingDown = true
    try {
      if (sock) {
        sock.ev.removeAllListeners('connection.update')
        await sock.logout()
      }
    } catch (error) {
      log.warn({ err: error }, 'error saat logout')
    }
    this.sock = null
    await destroySession(this.sessionFolder)
    this.setStatus('disconnected', null, 'session dihapus')
  }

  // ===========================================================================
  // Pengiriman
  // ===========================================================================

  async sendText(chatJid: string, text: string, options: SendTextOptions = {}): Promise<SendResult> {
    const sock = this.requireSocket()
    const target = normalizeJid(options.targetJid ?? chatJid)
    if (!target) return { providerMessageId: null, status: 'failed', errorCode: 'INVALID_JID' }

    const mentions = options.mentions ?? []
    const body = mentions.length > 0 ? `${text}\n\n${mentions.map(formatMention).join(' ')}` : text

    try {
      const quoted =
        options.quotedMessageId !== undefined && options.quotedMessageId !== null
          ? { key: { remoteJid: target, id: options.quotedMessageId, fromMe: true } }
          : undefined

      const result = await sock.sendMessage(target, { text: body, mentions }, quoted ? { quoted } : undefined)
      if (!result?.key) {
        return { providerMessageId: null, status: 'unknown', errorCode: 'NO_RESULT' }
      }

      // PENTING: status `provider_accepted` berarti WhatsApp MENERIMA
      // permintaan kirim. Itu belum berarti "sudah dibaca".
      return { providerMessageId: result.key.id ?? null, status: 'provider_accepted' }
    } catch (error) {
      return this.mapSendError(error)
    }
  }

  async sendDocument(
    chatJid: string,
    document: { url?: string; buffer?: Buffer; filename: string; mimetype: string },
    options: SendTextOptions = {},
  ): Promise<SendResult> {
    const sock = this.requireSocket()
    const target = normalizeJid(options.targetJid ?? chatJid)
    if (!target) return { providerMessageId: null, status: 'failed', errorCode: 'INVALID_JID' }

    try {
      if (!document.buffer && !document.url) {
        return { providerMessageId: null, status: 'failed', errorCode: 'INVALID_DOCUMENT' }
      }
      if (document.buffer) {
        const result = await sock.sendMessage(target, {
          document: document.buffer,
          mimetype: document.mimetype,
          fileName: document.filename,
        })
        if (!result?.key) return { providerMessageId: null, status: 'unknown', errorCode: 'NO_RESULT' }
        return { providerMessageId: result.key.id ?? null, status: 'provider_accepted' }
      }

      const caption = options.mentions?.length ? options.mentions.map(formatMention).join(' ') : undefined
      const result = await sock.sendMessage(target, {
        document: { url: document.url as string },
        mimetype: document.mimetype,
        fileName: document.filename,
        ...(caption ? { caption } : {}),
        ...(options.mentions?.length ? { mentions: options.mentions } : {}),
      })
      if (!result?.key) return { providerMessageId: null, status: 'unknown', errorCode: 'NO_RESULT' }

      return { providerMessageId: result.key.id ?? null, status: 'provider_accepted' }
    } catch (error) {
      return this.mapSendError(error)
    }
  }

  async sendImage(
    chatJid: string,
    image: { url?: string; buffer?: Buffer; caption?: string },
    options: SendTextOptions = {},
  ): Promise<SendResult> {
    const sock = this.requireSocket()
    const target = normalizeJid(options.targetJid ?? chatJid)
    if (!target) return { providerMessageId: null, status: 'failed', errorCode: 'INVALID_JID' }

    try {
      if (image.buffer) {
        const result = await sock.sendMessage(target, { image: image.buffer, ...(image.caption ? { caption: image.caption } : {}) })
        if (!result?.key) return { providerMessageId: null, status: 'unknown', errorCode: 'NO_RESULT' }
        return { providerMessageId: result.key.id ?? null, status: 'provider_accepted' }
      }
      if (!image.url) return { providerMessageId: null, status: 'failed', errorCode: 'INVALID_IMAGE' }

      const result = await sock.sendMessage(target, {
        image: { url: image.url },
        ...(image.caption ? { caption: image.caption } : {}),
        ...(options.mentions?.length ? { mentions: options.mentions } : {}),
      })
      if (!result?.key) return { providerMessageId: null, status: 'unknown', errorCode: 'NO_RESULT' }
      return { providerMessageId: result.key.id ?? null, status: 'provider_accepted' }
    } catch (error) {
      return this.mapSendError(error)
    }
  }

  async reactToMessage(chatJid: string, messageId: string, emoji: string): Promise<SendResult> {
    const sock = this.requireSocket()
    const target = normalizeJid(chatJid)
    if (!target) return { providerMessageId: null, status: 'failed', errorCode: 'INVALID_JID' }

    try {
      // Reaksi dikirim lewat sendMessage. String kosong MENGHAPUS reaksi.
      const result = await sock.sendMessage(target, {
        react: { text: emoji, key: { remoteJid: target, id: messageId } },
      })
      if (!result?.key) return { providerMessageId: null, status: 'unknown', errorCode: 'NO_RESULT' }
      return { providerMessageId: result.key.id ?? null, status: 'provider_accepted' }
    } catch (error) {
      return this.mapSendError(error)
    }
  }

  // ===========================================================================
  // Grup
  // ===========================================================================

  /**
   * Daftar grup yang diikuti akun ini, diringkas jadi JID + subjek.
   *
   * Diturunkan dari `getAllGroups()` supaya tidak ada dua jalur baca grup
   * yang bisa menghasilkan jawaban berbeda.
   */
  async listJoinedGroups(): Promise<Array<{ jid: string; subject: string | null }>> {
    const semua = await this.getAllGroups()
    return semua
      .filter((group) => group.jid.endsWith('@g.us'))
      .map((group) => ({ jid: group.jid, subject: group.subject }))
  }

  /** Teruskan grup yang ditemukan ke listener. */
  private emitDiscoveredGroup(jid: string, subject: string | null): void {
    for (const listener of this.listeners.groupDiscovered) {
      try {
        listener({ jid, subject })
      } catch (error) {
        this.emitError(error instanceof Error ? error : new Error(String(error)), 'memberi tahu grup ditemukan')
      }
    }
  }

  async getGroupMetadata(groupJid: string): Promise<NormalizedGroupMetadata | null> {
    const sock = this.sock
    const jid = normalizeJid(groupJid)
    if (!sock || !jid) return null

    // CacheStore v7 boleh mengembalikan Promise, jadi selalu `await`.
    const cached = await groupMetadataCache.get<GroupMetadata>(jid)
    const metadata: GroupMetadata | null = cached ?? (await this.safeGroupMetadata(jid))
    if (!metadata) return null

    groupMetadataCache.set<GroupMetadata>(jid, metadata)

    return {
      jid: metadata.id ?? jid,
      subject: metadata.subject ?? null,
      description: metadata.desc ?? null,
      ownerJid: metadata.owner ?? null,
      participantCount: metadata.size ?? metadata.participants?.length ?? null,
      participants: (metadata.participants ?? []).map((participant) => ({
        jid: participant.id,
        // Field `isAdmin` TIDAK diisi runtime di v7 — flag-nya lewat `admin`.
        isAdmin: (participant.admin ?? null) === 'admin' || participant.admin === 'superadmin',
        isSuperAdmin: (participant.admin ?? null) === 'superadmin',
      })),
    }
  }

  private async safeGroupMetadata(jid: string): Promise<GroupMetadata | null> {
    try {
      return await this.requireSocket().groupMetadata(jid)
    } catch (error) {
      log.warn({ err: error, jid }, 'gagal mengambil metadata grup')
      return null
    }
  }

  async getGroupParticipants(groupJid: string): Promise<string[]> {
    const metadata = await this.getGroupMetadata(groupJid)
    return metadata?.participants.map((p) => p.jid) ?? []
  }

  async getAllGroups(): Promise<NormalizedGroupMetadata[]> {
    const sock = this.sock
    if (!sock) return []
    try {
      // `groupFetchAllParticipating` mengembalikan objek yang di-key JID grup,
      // bukan array. Urutannya tidak dijamin.
      const raw = (await sock.groupFetchAllParticipating()) as unknown as Record<string, GroupMetadata>
      const hasil: NormalizedGroupMetadata[] = []
      for (const metadata of Object.values(raw ?? {})) {
        if (!metadata?.id) continue
        groupMetadataCache.set<GroupMetadata>(metadata.id, metadata)
        hasil.push({
          jid: metadata.id,
          subject: metadata.subject ?? null,
          description: metadata.desc ?? null,
          ownerJid: metadata.owner ?? null,
          participantCount: metadata.size ?? metadata.participants?.length ?? null,
          participants: (metadata.participants ?? []).map((participant) => ({
            jid: participant.id,
            isAdmin: participant.admin === 'admin' || participant.admin === 'superadmin',
            isSuperAdmin: participant.admin === 'superadmin',
          })),
        })
      }
      return hasil
    } catch (error) {
      log.warn({ err: error }, 'gagal mengambil daftar grup')
      return []
    }
  }

  // ===========================================================================
  // Penerimaan pesan
  // ===========================================================================

  private async handleIncoming(message: WAMessage, upsertType: 'notify' | 'append'): Promise<void> {
    // Pesan 'append' = sinkronisasi offline. Bot tidak perlu (dan tidak boleh)
    // membalas semuanya yang masuk dari batch offline.
    if (upsertType !== 'notify') return

    // Jangan proses pesan kita sendiri — mencegah loop tak berujung.
    if (message.key.fromMe) return

    const normalized = await this.normalizeMessage(message)
    if (!normalized) return

    // Hanya pesan teks (dan caption media) yang diproses untuk sekarang.
    if (!normalized.text) return

    this.emit('message', normalized)
  }

  private async normalizeMessage(message: WAMessage): Promise<NormalizedMessage | null> {
    const raw = message as WAMessage & {
      message?: WAMessageContent
      messageTimestamp?: number | { toNumber(): number } | null
      pushName?: string
    }

    const chatJid = raw.key.remoteJid
    if (!chatJid) return null

    // Buka lapis ephemeral / viewOnce supaya isinya bisa dibaca.
    const content = normalizeMessageContent(raw.message)
    if (!content) return null

    const contentType = getContentType(content)
    if (!contentType) return null

    const body = (content as unknown as Record<string, Record<string, unknown> | undefined>)[contentType]
    const contextInfo = (body?.contextInfo ?? {}) as {
      stanzaId?: string
      participant?: string
      mentionedJid?: Array<string | { server?: string; user?: string }>
      quotedMessage?: WAMessageContent
    }

    const text = extractText(content, contentType, body)
    const media = extractMediaMeta(contentType, body)

    // Prioritaskan JID PN (bisa dibaca manusia) lewat `*Alt` yang diisi server,
    // baru LID sebagai fallback. Lihat decode-wa-message.ts di Baileys.
    const senderJid = resolveSenderJid(message, chatJid)

    const groupJid = parseJid(chatJid)?.kind === 'group' ? chatJid : null

    const timestampMs =
      typeof raw.messageTimestamp === 'number'
        ? raw.messageTimestamp * 1000
        : typeof raw.messageTimestamp?.toNumber === 'function'
          ? raw.messageTimestamp.toNumber() * 1000
          : Date.now()

    return {
      id: raw.key.id ?? `${Date.now()}`,
      accountId: 'primary',
      chatJid: normalizeJid(chatJid) ?? chatJid,
      senderJid,
      groupJid: groupJid ? normalizeJid(groupJid) : null,
      senderPushName: raw.pushName ?? null,
      type: media.type,
      text,
      fileName: media.fileName,
      mimetype: media.mimetype,
      quotedMessageId: contextInfo.stanzaId ?? null,
      mentionedJids: extractMentionedJids(contextInfo.mentionedJid ?? []),
      mentionText: [],
      timestamp: new Date(timestampMs),
      isFromMe: raw.key.fromMe === true,
      deliveryStatus: null,
      raw: { addressingMode: message.key.addressingMode ?? null },
    }
  }

  // ===========================================================================
  // Utilitas internal
  // ===========================================================================

  private requireSocket(): WASocket {
    const sock = this.sock
    if (!sock) throw new Error('Socket WhatsApp belum siap')
    return sock
  }

  private setStatus(state: ConnectionState, phoneNumber: string | null, reason: string | null): void {
    this.status = { state, phoneNumber: phoneNumber ?? this.status.phoneNumber, reason, since: new Date() }
    this.emit('connection', this.getStatus())
  }

  private emit<K extends keyof WhatsAppProviderEvents>(
    event: K,
    ...args: Parameters<WhatsAppProviderEvents[K]>
  ): void {
    for (const listener of this.listeners[event]) {
      try {
        ;(listener as (...a: unknown[]) => void)(...args)
      } catch (error) {
        this.emitError(error as Error, String(event))
      }
    }
  }

  private emitError(error: Error, context?: string): void {
    log.error({ err: error, context }, 'kesalahan pada provider WhatsApp')
    for (const listener of this.errorListeners) {
      try {
        listener(error, context)
      } catch {
        // Listener error tidak boleh menggagalkan listener lain.
      }
    }
  }

  /** Ubah error pengiriman jadi status yang jujur. */
  private mapSendError(error: unknown): SendResult {
    const statusCode = (error as Boom | undefined)?.output?.statusCode
    const message = error instanceof Error ? error.message : String(error)

    // Timeout / koneksi putus = hasil TIDAK DIKETAHUI. Menirkirim langsung
    // berisiko pesan terkirim dua kali.
    if (statusCode === 408 || message.includes('timed out') || message.includes('ECONNRESET')) {
      return {
        providerMessageId: null,
        status: 'unknown',
        errorCode: 'DELIVERY_UNCERTAIN',
        errorMessage: 'Status pengiriman tidak diketahui.',
      }
    }

    if (statusCode === 401 || statusCode === 403) {
      return { providerMessageId: null, status: 'failed', errorCode: 'UNAUTHORIZED', errorMessage: 'Sesi tidak sah.' }
    }

    if (statusCode === 429 || statusCode === 463) {
      return {
        providerMessageId: null,
        status: 'failed',
        errorCode: 'RATE_LIMITED',
        errorMessage: 'Terlalu banyak permintaan.(message: ' + message + ')',
      }
    }

    return { providerMessageId: null, status: 'failed', errorCode: 'SEND_FAILED', errorMessage: message }
  }

  on<K extends keyof WhatsAppProviderEvents>(event: K, listener: WhatsAppProviderEvents[K]): () => void {
    this.listeners[event].add(listener as never)
    return () => this.listeners[event].delete(listener as never)
  }

  onError(listener: (error: Error, context?: string) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  /**
   * Download media dari pesan masuk (untuk memproses dokumen yang dikirim anggota).
   * Sengaja tidak dipanggil otomatis supaya tidak memboroskan RAM.
   */
  async downloadMedia(message: WAMessage): Promise<Buffer | null> {
    try {
      return await downloadMediaMessage(message, 'buffer', {}, {
        logger: log,
        // Media yang sudah dihapus dari server WA bisa di-reupload.
        reuploadRequest: (m) => this.requireSocket().updateMediaMessage(m),
      })
    } catch (error) {
      log.warn({ err: error }, 'gagal mengunduh media')
      return null
    }
  }

  /**
   * Coba memperbarui pemetaan PN <-> LID dari daftar nomor.
   * Berguna saat membuat mention massal. Mengembalikan daftar yang berhasil dipetakan.
   */
  async resolveLids(pns: string[]): Promise<Array<{ pn: string; lid: string }>> {
    const sock = this.sock
    if (!sock || pns.length === 0) return []
    try {
      const mapping = await sock.signalRepository.lidMapping.getLIDsForPNs(pns)
      return mapping ?? []
    } catch (error) {
      log.warn({ err: error }, 'gagal mengambil pemetaan LID')
      return []
    }
  }
}

// =============================================================================
// Helper murni (dapat diuji tanpa socket)
// =============================================================================

/** Ambil JID paling bisa ditampilkan dari key pesan. */
export function resolveSenderJid(message: WAMessage, chatJid: string): string {
  const key = message.key
  const author = getKeyAuthor(key, 'me')

  // 1. Field *Alt berisi JID lawannya yang dikirim server apa adanya.
  if (key.participantAlt && isPnUser(key.participantAlt)) return key.participantAlt
  if (key.remoteJidAlt && isPnUser(key.remoteJidAlt)) return key.remoteJidAlt

  // 2. Sudah berupa nomor.
  if (isPnUser(author)) return author

  // 3. Pure LID atau bentuk lain → pakai apa adanya. Callers yang butuh
  //    nomor asli harus memanggil resolveLids() sebagai fallback.
  return author || (normalizeJid(chatJid) ?? chatJid)
}

/** Ekstrak teks dari berbagai jenis konten pesan. */
function extractText(
  content: WAMessageContent,
  contentType: string,
  body: Record<string, unknown> | undefined,
): string | null {
  if (contentType === 'conversation') {
    return (content.conversation as string | undefined) ?? null
  }
  if (contentType === 'extendedTextMessage') {
    return (content.extendedTextMessage?.text as string | undefined) ?? null
  }
  if (body && typeof body.caption === 'string') return body.caption
  return null
}

/** Ambil metadata media berdasarkan tipe konten. */
function extractMediaMeta(
  contentType: string,
  body: Record<string, unknown> | undefined,
): { type: NormalizedMessage['type']; fileName: string | null; mimetype: string | null } {
  const map: Record<string, NormalizedMessage['type']> = {
    // `getContentType` Baileys mengembalikan 'conversation' untuk pesan teks
    // biasa. Tanpa entri ini, SETIAP pesan teks menjadi `unknown` — dan
    // setiap query `type: 'text'` selalu kosong.
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

  const type = map[contentType] ?? 'unknown'
  if (!body) return { type, fileName: null, mimetype: null }

  const fileName = typeof body.fileName === 'string' ? body.fileName : typeof body.fileCap === 'string' ? body.fileCap : null
  const mimetype = typeof body.mimetype === 'string' ? body.mimetype : null

  return { type, fileName, mimetype }
}

/** Normalisasi `mentionedJid` (bisa string atau objek pada versi berbeda). */
function extractMentionedJids(
  raw: Array<string | { server?: string; user?: string }>,
): string[] {
  const hasil: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const jid = normalizeJid(item)
      if (jid) hasil.push(jid)
    } else if (item && typeof item.user === 'string') {
      const server = item.server && item.server !== '' ? item.server : 's.whatsapp.net'
      const jid = normalizeJid(`${item.user}@${server}`)
      if (jid) hasil.push(jid)
    }
  }
  return [...new Set(hasil)]
}

/** Ekspor tipe status pengiriman agar konsisten dengan kontrak provider. */
export type { DeliveryStatus }

/** Helper: apakah JID ini LID (untuk log & keputusan mention). */
export function isLidJid(jid: string): boolean {
  return isLidUser(jid) === true
}

/**
 * Samarkan nomor untuk log.
 *
 * Nomor WhatsApp adalah data pribadi. Log adalah tempat yang paling mudah
 * bocor (dikirim ke aggregator, disimpan lama, dibaca orang lain).
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  if (digits.length <= 6) return '*'.repeat(digits.length)
  return `${digits.slice(0, 4)}${'*'.repeat(digits.length - 6)}${digits.slice(-2)}`
}