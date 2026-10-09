/**
 * Gerbang izin untuk perintah pengurus.
 *
 * Bot TIDAK menyimpan daftar admin/moderator sendiri (bot lama menyimpannya
 * di tabel `moderators`). Di OSDA v2 peran & izin datang dari OSDA API pada
 * hasil resolusi identitas, sehingga ada satu sumber kebenaran untuk Web,
 * Mobile, dan Bot.
 *
 * Perintah garis miring yang tidak memiliki izin cukup dibalas dengan pesan
 * "khusus pengurus" — identitas pengirim tidak pernah dibocorkan.
 */
import type { Izin } from '@osda/contracts';

import { resolveIdentitasPesan, type IdentitasTerresolusi } from './identity-resolver.js';
import * as tmpl from './templates.js';
import { kirimTeks } from '../whatsapp/baileys.js';
import type { PesanMasuk } from '../whatsapp/account.js';

/** Balasan saat identitas tidak bisa memakai perintah apa pun. */
async function balasIdentitasBermasalah(
  pesan: PesanMasuk,
  identitas: IdentitasTerresolusi,
): Promise<void> {
  if (identitas.galat) {
    const teks =
      identitas.galat.kode === 'TIDAK_BERWENANG'
        ? tmpl.pesanBotTidakBerwenang()
        : tmpl.pesanKesalahanServer(identitas.galat.kode);
    await kirimTeks(pesan.chatJid, teks);
    return;
  }
  const teks = identitas.perluTautanAkun
    ? tmpl.pesanPerluTautanAkun(identitas.tautanAkun)
    : tmpl.pesanBelumTerdaftar();
  await kirimTeks(pesan.chatJid, teks);
}

/**
 * Pastikan pengirim adalah anggota terdaftar (dipakai perintah anggota).
 * Mengembalikan true bila boleh lanjut; bila false, balasan sudah dikirim.
 */
export async function wajibAnggota(
  pesan: PesanMasuk,
  identitas: IdentitasTerresolusi,
): Promise<boolean> {
  if (identitas.member) return true;
  await balasIdentitasBermasalah(pesan, identitas);
  return false;
}

/**
 * Resolusi identitas + pastikan layanan OSDA API bisa dihubungi.
 * Dipakai perintah yang boleh dijalankan orang yang BELUM terdaftar
 * (misalnya `DAFTAR`). Mengembalikan null bila balasan galat sudah dikirim.
 */
export async function pastikanLayananTersedia(
  pesan: PesanMasuk,
): Promise<IdentitasTerresolusi | null> {
  const identitas = await resolveIdentitasPesan(pesan);
  if (identitas.galat) {
    await balasIdentitasBermasalah(pesan, identitas);
    return null;
  }
  return identitas;
}

/**
 * Resolusi identitas + pastikan pengirim anggota terdaftar.
 * Mengembalikan null bila tidak bisa dilanjutkan (balasan sudah dikirim).
 */
export async function pastikanAnggota(
  pesan: PesanMasuk,
): Promise<IdentitasTerresolusi | null> {
  const identitas = await resolveIdentitasPesan(pesan);
  if (identitas.galat || !identitas.member) {
    await balasIdentitasBermasalah(pesan, identitas);
    return null;
  }
  return identitas;
}

/**
 * Jalankan perintah pengurus hanya bila izin terpenuhi.
 *
 * Urutan pemeriksaan:
 * 1. resolusi identitas WhatsApp → member (gagal API → pesan layanan bermasalah)
 * 2. kepemilikan izin yang diminta (tidak punya → perintah khusus pengurus)
 * 3. jalankan handler
 */
export async function lewatiGerbangPengurus(
  pesan: PesanMasuk,
  izin: Izin,
  jalankan: (identitas: IdentitasTerresolusi) => Promise<void>,
): Promise<void> {
  const identitas = await resolveIdentitasPesan(pesan);

  if (identitas.galat || !identitas.member) {
    await balasIdentitasBermasalah(pesan, identitas);
    return;
  }

  if (!identitas.izin.includes(izin)) {
    await kirimTeks(pesan.chatJid, tmpl.pesanPerintahKhususPengurus());
    return;
  }

  await jalankan(identitas);
}

/** Kode galat aman untuk ditampilkan ke pengguna. */
export { kodeGalat } from '../util/galat.js';
