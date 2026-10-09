/**
 * Perintah informasi umum untuk anggota: `AGENDA`, `TUGAS`, dan `BANTUAN`.
 *
 * Dipisahkan dari perintah pengurus supaya jelas bahwa informasi ini boleh
 * dilihat seluruh anggota tanpa izin tambahan.
 */
import { daftarRapat, daftarTugas } from '../api/client.js';
import { logger } from '../logger.js';
import { pastikanAnggota } from '../services/gerbang-pengurus.js';
import * as tmpl from '../services/templates.js';
import { kodeGalat } from '../util/galat.js';
import { tanggalHariIni } from '../util/waktu.js';
import { kirimTeks } from '../whatsapp/baileys.js';
import type { PesanMasuk } from '../whatsapp/account.js';

/** `AGENDA` — daftar rapat terdekat yang bisa dilihat semua anggota. */
export async function tanganiAgenda(pesan: PesanMasuk): Promise<void> {
  try {
    const rapat = await daftarRapat(tanggalHariIni());
    await kirimTeks(
      pesan.chatJid,
      rapat.length > 0 ? tmpl.pesanRapatRingkas(rapat) : tmpl.pesanAgendaKosong(),
    );
  } catch (galat) {
    logger.warn({ galat }, 'Gagal membaca agenda rapat');
    await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
  }
}

/** `TUGAS` — daftar tugas yang ditugaskan kepada anggota ini. */
export async function tanganiTugasSaya(pesan: PesanMasuk): Promise<void> {
  const identitas = await pastikanAnggota(pesan);
  if (!identitas?.member) return;

  try {
    const tugas = await daftarTugas({ memberId: identitas.member.id, limit: 10 });
    await kirimTeks(
      pesan.chatJid,
      tugas.length > 0 ? tmpl.pesanTugasSaya(tugas) : tmpl.pesanTugasKosong(),
    );
  } catch (galat) {
    logger.warn({ galat, memberId: identitas.member.id }, 'Gagal membaca tugas anggota');
    await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
  }
}

/** `BANTUAN` — daftar seluruh perintah yang tersedia. */
export async function tanganiBantuan(pesan: PesanMasuk): Promise<void> {
  await kirimTeks(pesan.chatJid, tmpl.pesanBantuan());
}
