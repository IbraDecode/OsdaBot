/**
 * Mode aman — tombol darurat operasional.
 *
 * ── Kenapa ini harus ada ────────────────────────────────────────────────────
 *
 * Bot ini mengirim pesan ke orang sungguhan. Kalau sampai salah — prompt kacau,
 * tool yang salah sasaran, loop yang tidak berhenti — satu-satunya cara
 * adalah `kill`. Dan `kill` punya dua masalah:
 *
 * 1. **Mematikan proses bukan berarti memperbaiki.** Kalau penyebabnya ada di
 *    prompt atau konfigurasi, proses yang dinyalakan ulang akan mengulang
 *    kesalahan yang sama.
 * 2. **Mematikan proses menghapus bukti.** Setelah restart, tidak ada yang bisa
 *    melihat apa yang sebenarnya dikirim.
 *
 * Mode aman menjawab keduanya: bot berhenti bertindak, tapi pesan masuk
 * **tetap dicatat**. Operator bisa melihat apa yang terjadi tanpa menambah
 * masalah.
 *
 * ── Yang TIDAK dilakukan mode aman ──────────────────────────────────────────
 *
 * Ini penting, karena mode aman yang hanya sebagian lebih berbahaya dari
 * tidak ada sama sekali — orang mengira sudah aman padahal tidak.
 *
 * | Tetap jalan | Berhenti |
 * |---|---|
 * | Pencatatan pesan masuk | Panggilan ke penyedia AI |
 * | Resolusi identitas | Panggilan tool apa pun |
 * | Endpoint HTTP tetap hidup | Pengiriman pesan ke orang |
 * | | Pengerjaan approval yang sudah disetujui |
 *
 * Jadi: tidak ada satu pun **efek samping ke dunia luar**. Persis itulah
 * yang dibutuhkan saat insiden.
 *
 * ── Kenapa di database ─────────────────────────────────────────────────────
 *
 * Karena bot restart. Penyimpanan di memory akan hilang tepat di saat paling
 * dibutuhkan — setelah insiden, ketika yang dilakukan adalah menyalakan ulang
 * untuk melihat apakah masalahnya sudah beres.
 *
 * ── Caching dan langsungnya efek ───────────────────────────────────────────
 *
 * Pengecekan membaca database pada setiap pesan dan setiap tool call. Itu
 * menambah latensi di jalur terpanas sistem, jadi hasilnya di-cache
 * **singkat** (`TTL_CACHE_MS`).
 *
 * Yang dijaga: menyalakan mode aman **langsung** memperbarui cache secara
 * sinkron sebelum menulis ke database. Bot yang sedang menangani pesan saat
 * mode aman dinyalakan harus berhenti pada tool call berikutnya — bukan
 * beberapa detik kemudian. Kalau tidak, tombol daruratnya melambat.
 */
import type { PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'safe-mode' })

/** Kunci baris `SystemFlag`. */
export const FLAG_SAFE_MODE = 'system.safe_mode'

/**
 * Umur cache: 2 detik.
 *
 * Cukup pendek sehingga perubahan dari proses lain cepat terlihat, cukup
 * panjang sehingga tidak membebani database di jalur terpanas. Penyalaan dari
 * proses ini sendiri tidak lewat cache — lihat `set()`.
 */
const TTL_CACHE_MS = 2_000

export type SafeModeStatus = 'off' | 'on'

export interface SafeModeSnapshot {
  status: SafeModeStatus
  enabled: boolean
  since: Date | null
  reason: string | null
  changedBy: string | null
  changedAt: Date | null
}

/**
 * Bagian dari SafeModeService yang dibutuhkan pemanggil.
 *
 * Ditulis sebagai interface kecil supaya modul lain tidak ikut bergantung pada
 * layanan utuh — dan supaya test bisa memasang tiruan sederhana.
 */
export interface SafeModeGate {
  aktif(): Promise<boolean>
  catatDiblokir(params: {
    apa: 'tool' | 'balasan' | 'outbox' | 'approval' | 'pesan-masuk'
    detail: string
    chatJid?: string | null
    actorUserId?: string | null
    organizationId?: string | null
  }): Promise<void>
}

export class SafeModeService {
  private cache: { nilai: boolean; dibacaPada: number } | null = null

  constructor(private readonly prisma: PrismaClient) {}

  /** Aktif atau tidak, menurut cache bila masih segar. */
  async aktif(): Promise<boolean> {
    const sekarang = Date.now()
    if (this.cache && sekarang - this.cache.dibacaPada < TTL_CACHE_MS) {
      return this.cache.nilai
    }
    return this.baca()
  }

  /** Selalu baca dari database — dipakai saat boot dan diagnosis. */
  async snapshot(): Promise<SafeModeSnapshot> {
    const baris = await this.prisma.systemFlag.findUnique({ where: { key: FLAG_SAFE_MODE } })
    if (!baris) {
      return { status: 'off', enabled: false, since: null, reason: null, changedBy: null, changedAt: null }
    }

    const nilai = baris.value as { enabled?: boolean; since?: string; reason?: string; changedBy?: string }
    return {
      status: nilai.enabled ? 'on' : 'off',
      enabled: nilai.enabled === true,
      since: nilai.since ? new Date(nilai.since) : baris.updatedAt,
      reason: nilai.reason ?? null,
      changedBy: nilai.changedBy ?? baris.updatedBy ?? null,
      changedAt: baris.updatedAt,
    }
  }

  /**
   * Nyalakan atau matikan mode aman.
   *
   * Cache diperbarui **sebelum** menulis ke database. Bot yang sedang memproses
   * pesan pada saat ini harus berhenti pada tool call berikutnya; kalau cache
   * baru berubah setelah commit, ada jendela di mana tombol darurat tidak
   * berefek — dan jendela itulah yang jadi insiden.
   */
  async set(params: {
    enabled: boolean
    reason?: string | null
    changedBy?: string | null
  }): Promise<SafeModeSnapshot> {
    const enabled = params.enabled
    this.cache = { nilai: enabled, dibacaPada: Date.now() }

    try {
      await this.prisma.systemFlag.upsert({
        where: { key: FLAG_SAFE_MODE },
        create: {
          key: FLAG_SAFE_MODE,
          value: {
            enabled,
            since: new Date().toISOString(),
            reason: params.reason ?? null,
            changedBy: params.changedBy ?? null,
          },
          updatedBy: params.changedBy ?? null,
        },
        update: {
          value: {
            enabled,
            since: new Date().toISOString(),
            reason: params.reason ?? null,
            changedBy: params.changedBy ?? null,
          },
          updatedBy: params.changedBy ?? null,
        },
      })
    } catch (error) {
      // Cache sudah bilang "aman" tapi database gagal. Itu **lebih aman**
      // daripada sebaliknya, jadi biarkan — tapi jangan diamkan, karena
      // operator akan mengira flagnya tersimpan padahal akan hilang saat
      // restart.
      log.error({ err: error }, 'gagal menyimpan mode aman — tetap aktif di memori sampai restart')
      throw error
    }

    const snapshot = await this.snapshot()
    if (enabled) {
      log.error({ reason: params.reason, changedBy: params.changedBy }, 'MODE AMAN DINYALAKAN — bot berhenti bertindak')
    } else {
      log.warn({ changedBy: params.changedBy }, 'mode aman dimatikan — bot bertindak lagi')
    }
    return snapshot
  }

  /**
   * Catat percobaan yang diblokir.
   *
   * Ini yang membuat mode aman bisa dibuktikan bekerja, bukan sekadar
   * diklaim. Tanpa catatan, "bot diam" dan "bot mati" tidak bisa dibedakan —
   * dan itu persis kebingungan yang muncul saat insiden.
   */
  async catatDiblokir(params: {
    apa: 'tool' | 'balasan' | 'outbox' | 'approval' | 'pesan-masuk'
    detail: string
    chatJid?: string | null
    actorUserId?: string | null
    organizationId?: string | null
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'system.safe_mode.blocked',
          resourceType: params.apa,
          outcome: 'blocked',
          reasonCode: 'SAFE_MODE_ON',
          organizationId: params.organizationId ?? null,
          actorUserId: params.actorUserId ?? null,
          // Hanya metadata minimal: JID percakapan, bukan isi pesan.
          metadata: {
            detail: params.detail,
            chatJid: params.chatJid ?? null,
          },
        },
      })
    } catch (error) {
      log.warn({ err: error }, 'gagal mencatat kejadian mode aman')
    }
  }

  private async baca(): Promise<boolean> {
    try {
      const baris = await this.prisma.systemFlag.findUnique({
        where: { key: FLAG_SAFE_MODE },
        select: { value: true },
      })
      const nilai = (baris?.value as { enabled?: boolean } | undefined)?.enabled === true
      this.cache = { nilai, dibacaPada: Date.now() }
      return nilai
    } catch (error) {
      log.error({ err: error }, 'gagal membaca mode aman')
      // Gagal membaca BUKAN berarti aman. Menyalakan semua orang tanpa
      // sengaja ketika database tidak bisa dibaca akan mematikan sistem —
      // dan "matikan semua" juga punya biaya.
      //
      // Yang benar: biarkan cache terakhir, kalau ada. Kalau belum pernah
      // terbaca, anggap tidak aman dan louderkan masalahnya.
      return this.cache?.nilai ?? false
    }
  }
}