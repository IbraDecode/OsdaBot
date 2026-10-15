/**
 * Handler outbox untuk pengiriman pesan WhatsApp.
 *
 * ── Bagian yang paling menentukan ───────────────────────────────────────────
 *
 * Pemetaan `DeliveryStatus` dari provider ke hasil dispatch:
 *
 * | Status provider | Hasil dispatch | Efek |
 * |---|---|---|
 * | `delivered` | `delivered` | selesai |
 * | `provider_accepted` | `accepted` | selesai dari sisi outbox; status akhir ada di `MessageDelivery` |
 * | `pending` | `unknown` | **tidak di-retry** |
 * | `sending` | `unknown` | **tidak di-retry** |
 * | `failed` | `failed` | aman di-retry |
 * | `unknown` | `unknown` | **tidak di-retry** |
 *
 * `failed` berarti provider menyatakan gagal — aman mengirim ulang.
 * `unknown` berarti timeout lalu proses mati; pesan **mungkin sudah
 * terkirim**. Mengirim ulang berarti penerima bisa mendapatkan pesan yang
 * sama dua kali, dan untuk pengumuman organisasi itu tidak bisa diterima.
 */
import type { PrismaClient } from '@prisma/client'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import type { SafeModeGate } from '../system/safe-mode.js'
import { logger } from '../observability/logger.js'
import type { DispatchResult, OutboxHandler } from './dispatcher.js'
import { TOPICS } from './dispatcher.js'

const log = logger.child({ module: 'outbox:whatsapp' })

export interface WhatsAppOutboxDeps {
  prisma: PrismaClient
  whatsapp: WhatsAppProvider
  /**
   * Tombol darurat.
   *
   * Wajib, bukan opsional. Outbox adalah **antrean** — pesan yang antre saat
   * bot masih normal akan tetap dikirim setelah mode aman dinyalakan kalau
   * tidak dicek di sini. Menyalakan mode aman lalu sepuluh orang masih
   * menerima pesan yang antre adalah kegagalan yang lebih buruk daripada
   * tidak punya mode aman sama sekali, karena operator mengira sudah aman.
   */
  safeMode: SafeModeGate
}

/**
 * Terjemahkan status provider menjadi keputusan dispatch.
 *
 * Dipisah supaya bisa diuji tanpa provider sungguhan — dan supaya
 * pemetaannya terlihat di satu tempat.
 */
export function mapDeliveryStatus(status: string, detail?: string): DispatchResult {
  switch (status) {
    case 'delivered':
      return { outcome: 'delivered', detail }

    case 'provider_accepted':
      // Provider sudah menerima. Status akhir (sampai atau tidak) dicatat
      // terpisah di MessageDelivery — di sini hanya berarti "tidak perlu
      // dikirim ulang".
      return { outcome: 'accepted', detail }

    case 'failed':
      return { outcome: 'failed', error: detail ?? 'Provider menyatakan pengiriman gagal' }

    // Sengaja TIDAK di-retry.
    default:
      return {
        outcome: 'unknown',
        detail: `Status provider "${status}" — mungkin sudah terkirim, perlu dicek manual`,
      }
  }
}

/** Handler topik `whatsapp.message.send`. */
export class WhatsAppOutboxHandler implements OutboxHandler {
  readonly topic = TOPICS.WHATSAPP_MESSAGE

  constructor(private readonly deps: WhatsAppOutboxDeps) {}

  async handle(event: {
    id: string
    organizationId: string | null
    payload: unknown
  }): Promise<DispatchResult> {
    const payload = (event.payload ?? {}) as {
      chatJid?: string
      text?: string
      toMemberIds?: string[]
    }

    if (!payload.chatJid || !payload.text) {
      // Event tanpa tujuan atau isi tidak akan pernah berhasil. Retry
      // hanya mengaburkan masalahnya.
      return { outcome: 'failed', error: 'Event tidak punya chatJid atau text' }
    }

    // Gerbang mode aman, diperiksa sebelum memanggil provider.
    //
    // Outbox sengaja memisahkan pengirim dan penerima pesan. Efektifnya,
    // yang sama. Efektifnya, pesan bisa antre berjam-jam lalu dikirim pada
    // saat operator justru menyalakan mode aman.
    if (await this.deps.safeMode.aktif()) {
      await this.deps.safeMode.catatDiblokir({
        apa: 'outbox',
        // Cuma tujuan dan panjang. Isi pesan TIDAK ikut — `AuditLog` dibaca
        // banyak orang dan pesan bisa berisi data pribadi anggota.
        detail: `pesan antrean tidak dikirim ke ${payload.chatJid} (${String(payload.text).length} karakter)`,
        chatJid: payload.chatJid,
        organizationId: event.organizationId,
      })
      return { outcome: 'failed', error: 'SAFE_MODE_ON' }
    }

    let result: Awaited<ReturnType<WhatsAppProvider['sendText']>>
    try {
      result = await this.deps.whatsapp.sendText(payload.chatJid, payload.text, {
        // Idempotency key DARI event id — kalau dispatcher dijalankan ulang
        // setelah crash, provider akan melihat permintaan yang sama.
        idempotencyKey: `outbox:${event.id}`,
      })
    } catch (error) {
      // Exception berarti kita TIDAK tahu apakah pesan terkirim. Retry di
      // sini berisiko mengirim pesan yang sama dua kali.
      return {
        outcome: 'unknown',
        detail: `Provider melempar error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const mapped = mapDeliveryStatus(result.status, result.errorCode)

    if (mapped.outcome === 'unknown') {
      log.warn(
        { eventId: event.id, status: result.status },
        'status pengiriman tidak diketahui — event masuk daftar rekonsiliasi',
      )
    }

    return mapped
  }
}