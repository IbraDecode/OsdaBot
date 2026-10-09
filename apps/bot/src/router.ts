/**
 * Command Router OSDA Bot — penerus pesan WhatsApp ke perintah yang tepat.
 *
 * Alur lengkap (spec §32):
 *   WhatsApp (Baileys) → Message Adapter (whatsapp/account.ts)
 *     → Identity Resolver (services/identity-resolver.ts)
 *     → Command Router (berkas ini)
 *     → OSDA API (api/client.ts) → Domain → Database
 *     → Response (services/templates.ts → WhatsApp)
 *
 * Daftar perintah:
 *   Anggota  : DAFTAR, HADIR, IZIN, SAKIT, STATUS, AGENDA, TUGAS, KAS, BANTUAN, PROFIL
 *   Pengurus : /rekap, /reminder, /rapat, /tugas, /program, /kas, /absenin,
 *              /daftarin, /listanggota
 *
 * Perintah yang tidak dikenal → bot membalas `BANTUAN`. Pesan obrolan biasa
 * (kata pertama bukan kata kunci huruf besar dan bukan garis miring) dibiarkan
 * diam supaya bot tidak mengganggu percakapan grup.
 */
import type { Izin } from '@osda/contracts';

import { kirimTeks } from './whatsapp/baileys.js';
import type { PesanMasuk } from './whatsapp/account.js';
import { logger } from './logger.js';
import * as tmpl from './services/templates.js';
import {
  bacakanMaksudAbsen,
  tanganiAbsen,
  tanganiStatus,
} from './commands/attendance.js';
import { tanganiBantuan, tanganiAgenda, tanganiTugasSaya } from './commands/informasi.js';
import { tanganiKasAnggota, tanganiKasPengurus } from './commands/kas.js';
import { tanganiDaftar, tanganiProfil } from './commands/member.js';
import {
  tanganiAbsenIn,
  tanganiDaftarIn,
  tanganiListAnggota,
  tanganiProgram,
  tanganiRapat,
  tanganiRekap,
  tanganiReminder,
  tanganiTugasOrganisasi,
} from './commands/pengurus.js';

/** Jendela & batas anti-spam per pengirim. */
const JENDELA_RATE_MS = 60_000;
const BATAS_PESAN_JENDELA = 20;
const riwayatPesan = new Map<string, number[]>();

/** Pesan boleh diproses bila belum melewati batas 20 pesan per menit. */
function izinkanPesan(pengirimJid: string): boolean {
  const sekarang = Date.now();
  const daftar = (riwayatPesan.get(pengirimJid) ?? []).filter((waktu) => sekarang - waktu < JENDELA_RATE_MS);
  if (daftar.length >= BATAS_PESAN_JENDELA) {
    riwayatPesan.set(pengirimJid, daftar);
    return false;
  }
  daftar.push(sekarang);
  riwayatPesan.set(pengirimJid, daftar);
  return true;
}

/** Apakah pesan ini KEMUNGKINAN besar sebuah perintah? */
function tampakSepertiPerintah(teks: string): boolean {
  if (teks.startsWith('/')) return true;
  const kataPertama = teks.split(/\s+/)[0] ?? '';
  // Kata kunci anggota selalu diketik huruf besar (HADIR, STATUS, BANTUAN, ...).
  return /^[A-Z0-9]{2,}$/.test(kataPertama);
}

/** Handler satu perintah garis miring. */
interface PerintahPengurus {
  readonly izin: Izin;
  readonly jalankan: (pesan: PesanMasuk, argumen: string) => Promise<void>;
}

/** Peta perintah pengurus → izin yang dibutuhkan. */
const PERINTAH_PENGURUS: Readonly<Record<string, PerintahPengurus>> = {
  '/rekap': { izin: 'attendance.read', jalankan: (p) => tanganiRekap(p) },
  '/reminder': { izin: 'attendance.read', jalankan: (p) => tanganiReminder(p) },
  '/rapat': { izin: 'meeting.read', jalankan: (p) => tanganiRapat(p) },
  '/tugas': { izin: 'task.read', jalankan: (p) => tanganiTugasOrganisasi(p) },
  '/program': { izin: 'program.read', jalankan: (p) => tanganiProgram(p) },
  '/kas': { izin: 'finance.read', jalankan: (p) => tanganiKasPengurus(p) },
  '/absenin': {
    izin: 'attendance.manage',
    jalankan: (p, argumen) => tanganiAbsenIn(p, argumen),
  },
  '/daftarin': {
    izin: 'member.write',
    jalankan: (p, argumen) => tanganiDaftarIn(p, argumen),
  },
  '/listanggota': { izin: 'member.read', jalankan: (p) => tanganiListAnggota(p) },
};

/**
 * Titik masuk seluruh pesan WhatsApp yang sudah dinormalisasi.
 * Tidak pernah melempar galat: kegagalan selalu dijawab dengan pesan ramah.
 */
export async function onPesanMasuk(pesan: PesanMasuk): Promise<void> {
  const teks = pesan.teks.trim();
  if (!teks) return;

  if (!izinkanPesan(pesan.pengirimJid)) {
    await kirimTeks(pesan.chatJid, tmpl.pesanTerlaluBanyakPermintaan());
    return;
  }

  // ---------- Perintah anggota (tanpa garis miring) ----------
  if (/^DAFTAR\b/i.test(teks)) {
    await tanganiDaftar(pesan, teks);
    return;
  }
  if (/^(HADIR|IZIN|SAKIT)\b/i.test(teks)) {
    const maksud = bacakanMaksudAbsen(teks);
    if (!maksud) {
      await kirimTeks(pesan.chatJid, tmpl.pesanFormatTidakDikenal());
      return;
    }
    await tanganiAbsen(pesan, maksud);
    return;
  }
  if (/^STATUS$/i.test(teks)) {
    await tanganiStatus(pesan);
    return;
  }
  if (/^AGENDA$/i.test(teks)) {
    await tanganiAgenda(pesan);
    return;
  }
  if (/^TUGAS$/i.test(teks)) {
    await tanganiTugasSaya(pesan);
    return;
  }
  if (/^KAS(\s+STATUS)?$/i.test(teks)) {
    await tanganiKasAnggota(pesan);
    return;
  }
  if (/^PROFIL$/i.test(teks)) {
    await tanganiProfil(pesan);
    return;
  }
  if (/^(BANTUAN|HELP|MENU)$/i.test(teks)) {
    await tanganiBantuan(pesan);
    return;
  }

  // ---------- Perintah pengurus (garis miring) ----------
  if (teks.startsWith('/')) {
    const [kunci, ...sisaArgumen] = teks.split(/\s+/);
    const perintah = PERINTAH_PENGURUS[(kunci ?? '').toLowerCase()];
    if (perintah) {
      await perintah.jalankan(pesan, sisaArgumen.join(' '));
      return;
    }
    logger.debug({ kunci }, 'Perintah garis miring tidak dikenal');
    await kirimTeks(pesan.chatJid, tmpl.pesanBantuan());
    return;
  }

  // ---------- Bukan perintah ----------
  if (tampakSepertiPerintah(teks)) {
    logger.debug({ teks: teks.slice(0, 40) }, 'Perintah tidak dikenal');
    await kirimTeks(pesan.chatJid, tmpl.pesanBantuan());
  }
}

/** Hapus riwayat rate limit (dipakai saat shutdown/restart). */
export function resetRateLimit(): void {
  riwayatPesan.clear();
}

/** Daftar kunci perintah pengurus (dipakai dokumentasi & log). */
export function daftarPerintahPengurus(): readonly string[] {
  return Object.keys(PERINTAH_PENGURUS);
}
