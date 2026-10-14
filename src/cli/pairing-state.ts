/**
 * Status pairing bersama antara daemon pairing dan perintah pembaca.
 *
 * Kenapa perlu file: pairingcodehanya hidup selama prosesnya hidup. Kalau
 * proses berhenti, kode mati. Daemon menulis kode terbaru ke sini supaya
 * operator bisa membacanya kapan saja dari terminal lain — tanpa perlu
 * menyalin dari log yang tergulir.
 *
 * File ini TIDAK pernah diparse sebagai sumber kebenaran otentikasi. Isinya
 * hanya datum publik (kode pairing) dan tidak boleh masuk log produksi.
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const PAIRING_STATE_FILE = '.pairing-state.json'

export type PairingPhase =
  | 'starting'
  | 'waiting_code'
  | 'waiting_scan'
  | 'linked'
  | 'rate_limited'
  | 'failed'

export interface PairingState {
  /** Kode pairing terbaru yang berlaku. */
  code: string | null
  /** Nomor akun bot (ter-lengkap; ini bukan rahasia). */
  phone: string | null
  phase: PairingPhase
  /** Kapan proses pairing mulai. ISO-8601. */
  startedAt: string
  /** Kapan file ini terakhir ditulis. ISO-8601. */
  updatedAt: string
  /** Berapa kali kode dibuat (setiap reconnect = kode baru). */
  attempts: number
  /** Pesan error terakhir, kalau ada. */
  lastError: string | null
  /**
   * Apakah server memblokir percobaan pairing (429 rate-overlimit).
   *
   * Penting: saat ini bernilai `true`, retries HANYA memperpanjang blokir.
   * Daemon harus berhenti, bukan mencoba lagi.
   */
  rateLimited: boolean
  /** PID proses daemon, supaya operator tahu prosesnya hidup. */
  pid: number
}

export function pairingStatePath(cwd: string = process.cwd()): string {
  return resolve(cwd, PAIRING_STATE_FILE)
}

/**
 * Tulis status secara atomik: tulis berkas sementara lalu `rename`.
 *
 * `rename` dalam satu filesystem bersifat atomik, jadi kalau proses dibunuh
 * di tengah penulisan, file lama tetap utuh — tidak pernah ada keadaan
 * setengah tertulis yang nanti terbaca sebagai "pairing berhasil".
 */
export function writePairingState(state: PairingState, cwd: string = process.cwd()): void {
  const target = pairingStatePath(cwd)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
  renameSync(tmp, target)
}

export function readPairingState(cwd: string = process.cwd()): PairingState | null {
  try {
    return JSON.parse(readFileSync(pairingStatePath(cwd), 'utf-8')) as PairingState
  } catch {
    return null
  }
}

export function clearPairingState(cwd: string = process.cwd()): void {
  try {
    unlinkSync(pairingStatePath(cwd))
  } catch {
    // Sudah tidak ada — bukan error.
  }
}

/** Apakah proses dengan PID tersebut masih hidup? */
export function prosesHidup(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = proses ada tapi milik user lain.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}