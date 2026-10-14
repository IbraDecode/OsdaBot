/**
 * Session Baileys.
 *
 * ── Kenapa tidak `useMultiFileAuthState` untuk produksi ─────────────────────
 * Sumber resmi Baileys sendiri menulis (Utils/use-multi-file-auth-state.ts):
 *   "I wouldn't endorse this for any production level use other than perhaps a bot.
 *    Would recommend writing an auth state for use with a proper SQL or No-SQL DB"
 *
 * Masalah nyata yang ditemukan di isu GitHub:
 *  - `useMultiFileAuthState` me-return `null` saat file korup (bukan error) —
 *    sesi bisa hilang SENYAP. Lihat issue #794 ("creds.json broke and the
 *    session is lost").
 *  - Satu file per key → ribuan inode.
 *  - Reconnect loop yang mengabaikan 401 justru MEMPERBURUK keadaan.
 *
 * Karena itu OSDABOT memakai store berbasis filesystem sendiri yang:
 *  1. MELEMAH-kan file jadi `0600`,
 *  2. MELEMPAR error kalau file korup (fail loud, bukan diam),
 *  3. Menulis secara atomik (tulis sementara → rename) supaya tidak ada file
 *     setengah tertulis saat server mati mendadak,
 *  4. Mendukung SEMUA key `SignalDataTypeMap` termasuk yang baru di v7:
 *     `lid-mapping`, `device-list`, `tctoken`, `identity-key`.
 *
 * Serialisasi wajib memakai `BufferJSON` dari Baileys — `JSON.stringify` biasa
 * akan mengubah `Uint8Array` jadi `{0:..,1:..}` dan merusak sesi enkripsi.
 */
import { mkdir, readFile, rename, rm, writeFile, chmod, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from '@whiskeysockets/baileys'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'whatsapp-session' })

/** Sanitasi nama file agar aman dipakai di semua OS. */
function fixFileName(name: string): string {
  return name.replace(/\//g, '__').replace(/:/g, '-')
}

export class FileSignalKeyStore implements SignalKeyStore {
  constructor(private readonly folder: string) {}

  async get<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    const result: { [id: string]: SignalDataTypeMap[T] } = {}

    for (const id of ids) {
      const file = join(this.folder, `${type}${fixFileName(id)}.json`)

      try {
        const raw = await readFile(file, 'utf8')
        result[id] = JSON.parse(raw, BufferJSON.reviver) as SignalDataTypeMap[T]
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') continue // belum ada = normal
        // File ada tapi korup → lempar. Diam-diamdg-schema ini akan
        // menghasilkan sesi yang rusak tanpa jejak.
        throw new Error(`Auth state korup pada ${type}/${id}: ${String(error)}`, { cause: error })
      }
    }

    return result
  }

  async set(data: SignalDataSet): Promise<void> {
    for (const category of Object.keys(data)) {
      const type = category as keyof SignalDataTypeMap
      const entries = (data as Record<string, Record<string, unknown>>)[category] ?? {}

      for (const id of Object.keys(entries)) {
        const value = entries[id]
        if (value === null || value === undefined) continue

        const target = join(this.folder, `${type}${fixFileName(id)}.json`)
        const temporary = `${target}.${process.pid}.tmp`

        await writeFile(temporary, JSON.stringify(value, BufferJSON.replacer), { mode: 0o600 })
        // Tulis atomik: rename() menjamin file lama tetap utuh kalau proses mati di tengah.
        await rename(temporary, target)
        await chmod(target, 0o600).catch(() => undefined)
      }
    }
  }

  async clear(): Promise<void> {
    try {
      await rm(this.folder, { recursive: true, force: true })
      await mkdir(this.folder, { recursive: true, mode: 0o700 })
      log.warn('auth state dihapus_total')
    } catch (error) {
      log.error({ err: error }, 'gagal membersihkan auth state')
    }
  }
}

/** Simpan `creds` (bagian sensitif utama) sebagai satu file. */
class CredsStore {
  constructor(private readonly file: string) {}

  async load(): Promise<AuthenticationCreds | null> {
    try {
      const raw = await readFile(this.file, 'utf8')
      return JSON.parse(raw, BufferJSON.reviver) as AuthenticationCreds
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return null
      throw new Error(`creds.json korup dan tidak bisa dipulihkan otomatis: ${String(error)}`, {
        cause: error,
      })
    }
  }

  async save(creds: AuthenticationCreds): Promise<void> {
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(creds, BufferJSON.replacer), { mode: 0o600 })
    await rename(temporary, this.file)
    await chmod(this.file, 0o600).catch(() => undefined)
  }
}

export interface SessionState {
  state: AuthenticationState
  saveCreds: () => Promise<void>
  folder: string
  /**true kalau ada sesi tersimpan (belum perlu pairing lagi). */
  hasSession: boolean
}

/** Buat (atau pulihkan) session auth dari folder. */
export async function loadSession(folder: string): Promise<SessionState> {
  await mkdir(folder, { recursive: true, mode: 0o700 })
  await chmod(folder, 0o700).catch(() => undefined)

  const credsStore = new CredsStore(join(folder, 'creds.json'))
  const keysStore = new FileSignalKeyStore(folder)

  const creds = await credsStore.load()

  const state: AuthenticationState = {
    // WAJIB: kalau belum ada session, Baileys butuh creds yang sudah
    // di-init (noiseKey, signedIdentityKey, signedPreKey, advSecretKey…).
    // Memberi objek kosong membuat `creds.noiseKey` undefined dan handshake
    // gagal dengan "Cannot read properties of undefined (reading 'public')"
    // — persis yang terjadi kalau initAuthCreds() dilewati.
    creds: creds ?? initAuthCreds(),
    keys: keysStore,
  }

  let saveQueue: Promise<void> = Promise.resolve()
  const saveCreds = async (): Promise<void> => {
    // Serialisasi penulisan: dua `creds.update` yang tumpang tindih bisa
    // menimpa file dengan versi lama.
    saveQueue = saveQueue.then(() => credsStore.save(state.creds)).catch((error) => {
      log.error({ err: error }, 'gagal menyimpan creds')
    })
    await saveQueue
  }

  return { state, saveCreds, folder, hasSession: creds?.registered === true }
}

/** Hapus seluruh session (dipakai saat logout/pairing ulang). */
export async function destroySession(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true })
  log.info({ folder }, 'session dihapus')
}

/** Daftar file session — untuk diagnostik CLI. */
export async function listSessionFiles(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}