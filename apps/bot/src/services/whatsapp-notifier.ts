/**
 * WhatsApp Notifier — menyampaikan notifikasi dari OSDA ke WhatsApp.
 *
 * Modul ini OPSIONAL (`NOTIFIKASI_AKTIF=false` mematikannya) dan hanya listener
 * satu arah: OSDA API → WhatsApp. Bot tidak pernah mengubah status notifikasi
 * di sisi server.
 *
 * Catatan implementasi:
 * - Bila OSDA API belum menyediakan WebSocket/SSE untuk notifikasi, bot memakai
 *   polling ke `GET /notifications` (default tiap 60 detik).
 * - Notifikasi yang sudah dikirim dicatat id-nya di memori supaya tidak terkirim
 *   dua kali selama proses berjalan.
 * - Penerima ditentukan dari data `penerima` pada balasan API. Bila API belum
 *   mengirim data tersebut, notifikasi diteruskan ke `NOTIFIKASI_KIRIM_KE`
 *   (nomor/JID grup yang dikonfigurasi admin).
 */
import { daftarNotifikasi, nomorKeJidPn } from '../api/client.js';
import { konfig } from '../config.js';
import { logger } from '../logger.js';
import * as tmpl from './templates.js';
import { sedangTerhubung, kirimTeks } from '../whatsapp/baileys.js';

/** Notifikasi seperti yang dikembalikan API, plus data penerima bila ada. */
interface NotifikasiBot {
  readonly id: string;
  readonly judul: string;
  readonly isi: string;
  readonly prioritas: string;
  readonly penerima?: {
    readonly memberId?: string;
    readonly telepon?: string | null;
    readonly jid?: string | null;
  } | null;
}

const BATAS_ID_TERKIRIM = 500;
const idTerkirim = new Set<string>();

let timerNotifikasi: ReturnType<typeof setInterval> | null = null;

/** JID penerima sebuah notifikasi (null bila tidak diketahui). */
function jidPenerima(notif: NotifikasiBot): string | null {
  const penerima = notif.penerima;
  if (!penerima) return null;
  if (penerima.jid) return penerima.jid;
  if (penerima.telepon) return nomorKeJidPn(penerima.telepon);
  return null;
}

/** Ambil notifikasi baru dan teruskan ke WhatsApp. */
async function periksaNotifikasi(): Promise<void> {
  if (!konfig.whatsappAktif) return;
  if (!sedangTerhubung()) return;

  let daftar: readonly NotifikasiBot[];
  try {
    daftar = (await daftarNotifikasi(20)) as readonly NotifikasiBot[];
  } catch (galat) {
    logger.debug({ galat }, 'Polling notifikasi dilewati (API belum siap)');
    return;
  }

  if (!Array.isArray(daftar) || daftar.length === 0) return;

  // Urutkan dari yang paling lama supaya kronologi pesan tetap benar.
  const urut = [...daftar].reverse();
  for (const notif of urut) {
    if (!notif?.id || idTerkirim.has(notif.id)) continue;
    idTerkirim.add(notif.id);
    if (idTerkirim.size > BATAS_ID_TERKIRIM) {
      const kunciPertama = idTerkirim.values().next();
      if (!kunciPertama.done) idTerkirim.delete(kunciPertama.value);
    }

    const tujuan = jidPenerima(notif) ?? (konfig.notifikasiKirimKe || null);
    if (!tujuan) {
      logger.debug({ id: notif.id }, 'Notifikasi dilewati: penerima WhatsApp tidak diketahui');
      continue;
    }

    await kirimTeks(tujuan, tmpl.pesanNotifikasi(notif));
    logger.debug({ id: notif.id, tujuan }, 'Notifikasi diteruskan ke WhatsApp');
  }
}

/** Mulai listener notifikasi (polling). */
export function mulaiNotifier(): void {
  if (!konfig.notifikasiAktif) {
    logger.warn('Notifier WhatsApp nonaktif (NOTIFIKASI_AKTIF=false)');
    return;
  }
  if (timerNotifikasi) return;

  logger.info('Notifier WhatsApp aktif — polling tiap %s ms', konfig.notifikasiIntervalMs);
  timerNotifikasi = setInterval(() => {
    void periksaNotifikasi();
  }, konfig.notifikasiIntervalMs);
  void periksaNotifikasi();
}

/** Hentikan listener notifikasi (dipakai saat shutdown). */
export function hentikanNotifier(): void {
  if (timerNotifikasi) {
    clearInterval(timerNotifikasi);
    timerNotifikasi = null;
    logger.info('Notifier WhatsApp dihentikan');
  }
}

/** Status notifier untuk log/health check. */
export function statusNotifier(): { aktif: boolean; intervalMs: number; sudahKirim: number } {
  return {
    aktif: timerNotifikasi !== null,
    intervalMs: konfig.notifikasiIntervalMs,
    sudahKirim: idTerkirim.size,
  };
}
