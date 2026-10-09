/**
 * Normalisasi JID & identifikasi pengirim.
 *
 * Aturan identitas (mengikuti AGENTS.md bot lama):
 * - Identitas pengirim = JID pengirim, BUKAN nama yang diketik.
 * - Pesan di grup memakai `participant`, pesan pribadi memakai `remoteJid`.
 * - Identitas stabil selalu dikembalikan sebagai PN (`@s.whatsapp.net`).
 *   LID (`@lid`) hanya catatan tambahan dan TIDAK PERNAH dijadikan kunci
 *   permanen.
 * - Pemetaan PN → member (dan pengecekan peran/izin) TIDAK dilakukan di sini;
 *   bot hanya client ringan, jadi resolusi dilakukan lewat OSDA API
 *   (`src/services/identity-resolver.ts`).
 */
import {
  getContentType,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidNormalizedUser as ju,
  type WAMessage,
  type proto,
} from '@whiskeysockets/baileys';

import { logger } from '../logger.js';
import { cariPn, daftarPasangan, daftarLidPn } from './lidMapping.js';
import { ekstrakMention } from './mention.js';

/** Pesan WhatsApp yang sudah dinormalisasi dan siap diproses router. */
export interface PesanMasuk {
  /** ID pesan (dipakai untuk idempotensi & logging). */
  readonly id: string;
  /** JID chat tujuan balasan (grup atau pribadi). */
  readonly chatJid: string;
  /** JID pengirim yang sudah dinormalisasi (PN bila tersedia). */
  readonly pengirimJid: string;
  /** LID pengirim bila ada (bersifat sementara). */
  readonly lid: string | null;
  /** Nomor telepon 62xxx bila bisa ditentukan. */
  readonly nomor: string | null;
  readonly namaTampilan: string | null;
  readonly grup: boolean;
  /** Isi pesan teks (termasuk caption gambar/video/dokumen). */
  readonly teks: string;
  /** JID yang di-mention di dalam pesan. */
  readonly mentions: readonly string[];
  /** Waktu pesan (epoch milidetik). */
  readonly waktu: number;
  /** Pesan asli Baileys, disimpan bila perlu data tambahan. */
  readonly asli: WAMessage;
}

/** Pesan sementara / sekali lihat membungkus pesan asli. */
const PEMBUNGKUS: ReadonlySet<string> = new Set([
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
]);

/** Ambil bagian user dari JID (sebelum tanda `@`). */
function userJid(jid: string): string {
  return ju(jid).split('@')[0] ?? '';
}

/** Validasi nomor telepon hasil ekstraksi agar bukan JID aneh. */
function normalisasiTelepon(user: string): string | null {
  return /^\d{8,15}$/.test(user) ? user : null;
}

/** Ekstraksi teks pesan: percakapan, extended text, dan caption media. */
export function ekstrakTeksPesan(pesan: WAMessage): string {
  let isi: proto.IMessage | undefined = pesan.message ?? undefined;

  // Buka lapisan pembungkus (ephemeral / view-once / edited).
  for (let lapis = 0; lapis < 3; lapis += 1) {
    const jenis = isi ? getContentType(isi) : undefined;
    if (!jenis || !PEMBUNGKUS.has(jenis)) break;
    const pembungkus = (isi as unknown as Record<string, { message?: proto.IMessage } | undefined>)[
      jenis
    ];
    const dalam: proto.IMessage | undefined = pembungkus?.message ?? undefined;
    if (!dalam) break;
    isi = dalam;
  }

  if (!isi) return '';
  const jenisIsi = getContentType(isi);
  if (!jenisIsi) return '';
  switch (jenisIsi) {
    case 'conversation':
      return isi.conversation ?? '';
    case 'extendedTextMessage':
      return isi.extendedTextMessage?.text ?? '';
    case 'imageMessage':
      return isi.imageMessage?.caption ?? '';
    case 'videoMessage':
      return isi.videoMessage?.caption ?? '';
    case 'documentMessage':
      return isi.documentMessage?.caption ?? '';
    case 'buttonsResponseMessage':
      return isi.buttonsResponseMessage?.selectedButtonId ?? '';
    case 'templateButtonReplyMessage':
      return isi.templateButtonReplyMessage?.selectedId ?? '';
    default:
      return '';
  }
}

/** Konversi JID PN → nomor 62xxx; LID → null (belum bisa jadi nomor). */
export function jidKeNomor(jid: string): string | null {
  const j = ju(jid);
  if (!isPnUser(j)) return null;
  return normalisasiTelepon(userJid(j));
}

/** Jumlah pengirim pesan → PN + pasangan LID-nya. */
function tentukanPengirim(pesan: WAMessage): {
  pengirimJid: string;
  lid: string | null;
  nomor: string | null;
  grup: boolean;
  chatJid: string;
} | null {
  const key = pesan.key;
  const remoteJid = key.remoteJid ?? '';
  if (!remoteJid) return null;

  const grup = isJidGroup(remoteJid) === true;
  const chatJid = ju(remoteJid);

  // Pesan sistem (status broadcast, newsletter) tidak punya pengirim nyata.
  if (isJidStatusBroadcast(remoteJid) || isJidNewsletter(remoteJid) === true) return null;

  const utama = grup ? key.participant : remoteJid;
  const alt = grup ? key.participantAlt : key.remoteJidAlt;
  if (!utama) {
    logger.warn({ key }, 'Tidak dapat menentukan JID pengirim (pesan dari sistem?)');
    return null;
  }

  const jUtama = ju(utama);
  const jAlt = alt ? ju(alt) : '';
  // Simpan pasangan LID↔PN untuk resolusi berikutnya.
  daftarPasangan(jUtama, jAlt);

  const pn = isPnUser(jUtama)
    ? jUtama
    : jAlt && isPnUser(jAlt)
      ? jAlt
      : cariPn(jUtama);
  const lid = isLidUser(jUtama) ? jUtama : jAlt && isLidUser(jAlt) ? jAlt : null;

  return {
    pengirimJid: pn ?? lid ?? jUtama,
    // LID disimpan sebagai JID utuh (`123@lid`) agar konsisten dengan pengirimJid.
    lid: lid ?? null,
    nomor: pn ? jidKeNomor(pn) : null,
    grup,
    chatJid,
  };
}

/**
 * Wadahkan pesan Baileys menjadi `PesanMasuk`.
 * Mengembalikan null untuk pesan yang tidak perlu diproses:
 * pesan sendiri bot, status broadcast, newsletter, atau pesan tanpa teks.
 */
export function wadahPesanMasuk(pesan: WAMessage): PesanMasuk | null {
  if (pesan.key.fromMe === true) return null;

  const pengirim = tentukanPengirim(pesan);
  if (!pengirim) return null;

  const teks = ekstrakTeksPesan(pesan).trim();
  if (!teks) return null;

  return {
    id: pesan.key.id ?? `${pengirim.chatJid}:${pesan.messageTimestamp ?? 0}`,
    chatJid: pengirim.chatJid,
    pengirimJid: pengirim.pengirimJid,
    lid: pengirim.lid,
    nomor: pengirim.nomor,
    namaTampilan: pesan.pushName ?? null,
    grup: pengirim.grup,
    teks,
    mentions: ekstrakMention(pesan),
    waktu: Number(pesan.messageTimestamp ?? 0) * 1000,
    asli: pesan,
  };
}

/** Daftarkan pemetaan LID→PN yang datang dari event `lid-mapping.update`. */
export function perbaruiPetaLid(lid: string, pn: string): void {
  daftarLidPn(lid, pn);
}

/** Format JID untuk log/tampilan manusia (08xxx atau LID:xxxx). */
export { jidKeTampilan, nomorKeTampilan } from './mention.js';
