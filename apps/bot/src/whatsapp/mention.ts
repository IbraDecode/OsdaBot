/**
 * Ekstraksi mention dari pesan WhatsApp (`messages.upsert`).
 *
 * WhatsApp menyimpan mention sebagai daftar JID di `contextInfo.mentionedJid`.
 * Karakter tak terlihat (U+2068/U+2069, zero-width space) sering membungkus
 * nama kontak di dalam teks, sehingga teks mentah perlu dibersihkan sebelum
 * dipakai.
 */
import {
  getContentType,
  jidNormalizedUser as ju,
  type WAMessage,
} from '@whiskeysockets/baileys';

/** Daftar JID yang di-mention di dalam pesan (boleh LID atau PN). */
export function ekstrakMention(pesan: WAMessage): string[] {
  const isi = pesan.message;
  if (!isi) return [];

  const jenis = getContentType(isi);
  const konteks =
    (jenis === 'extendedTextMessage'
      ? isi.extendedTextMessage?.contextInfo
      : jenis === 'imageMessage'
        ? isi.imageMessage?.contextInfo
        : jenis === 'videoMessage'
          ? isi.videoMessage?.contextInfo
          : jenis === 'documentMessage'
            ? isi.documentMessage?.contextInfo
            : jenis === 'buttonsResponseMessage'
              ? isi.buttonsResponseMessage?.contextInfo
              : undefined) ?? undefined;

  const disebut = konteks?.mentionedJid;
  if (!Array.isArray(disebut)) return [];

  return disebut
    .filter((jid): jid is string => typeof jid === 'string' && jid.length > 0)
    .map((jid) => ju(jid))
    .filter((jid) => jid.length > 0);
}

/**
 * Bersihkan teks mention mentah (mis. "@⁨Ibra Ramdan⁩") menjadi nama polos.
 * Mengembalikan null bila hasilnya kosong.
 */
export function bersihkanTeksMention(mentah: string): string | null {
  const bersih = mentah
    .replace(/[\u200B-\u200F\u2060-\u206F\u202A-\u202E\uFEFF]/g, '')
    .replace(/^@+/, '')
    .replace(/@/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return bersih.length > 0 ? bersih : null;
}

/**
 * Nomor telepon → teks enak dibaca manusia:
 * "6281234567890" → "081234567890". Nilai kosong → string kosong.
 */
export function nomorKeTampilan(nomor: string | null | undefined): string {
  if (!nomor) return '';
  const bersih = nomor.trim();
  if (bersih.startsWith('62')) return `0${bersih.slice(2)}`;
  return bersih;
}

/**
 * Ubah JID menjadi teks yang enak dibaca manusia:
 * - PN (`62xxx@s.whatsapp.net`) → nomor lokal `08xxx`
 * - LID → `LID:xxxx` (ingatkan bahwa nomor sebenarnya perlu diresolusi)
 */
export function jidKeTampilan(jid: string): string {
  const j = ju(jid);
  const user = j.split('@')[0] ?? '';
  if (j.endsWith('@lid')) return `LID:${user}`;
  if (user.startsWith('62')) return `0${user.slice(2)}`;
  return user;
}

/** Anggota yang bisa masuk ke dalam daftar mention. */
export interface AnggotaMention {
  readonly nama: string;
  readonly kelas?: string | null;
  /** JID PN bila tersedia; tanpa ini kita tidak bisa mention (fallback teks). */
  readonly jid?: string | null;
}

/**
 * Bangun daftar bernomor dengan mention WhatsApp.
 *
 * Aturan: hanya anggota yang punya JID yang bisa di-mention. Sisanya tetap
 * tampil sebagai teks biasa supaya tidak ada nama yang hilang dari daftar.
 */
export function bangunTeksMention(
  anggota: readonly AnggotaMention[],
  header: string,
): { teks: string; mentions: string[] } {
  const mentions: string[] = [];
  const baris = anggota.map((a, indeks) => {
    const jid = a.jid ? ju(a.jid) : '';
    const tampil = jid ? `@${(jid.split('@')[0] ?? '').replace(/^62/, '')}` : a.nama;
    if (jid) mentions.push(jid);
    const kelas = a.kelas ? ` (${a.kelas})` : '';
    return `${indeks + 1}. ${tampil}${kelas}`;
  });

  return {
    teks: [header, '', ...baris].join('\n'),
    mentions,
  };
}
