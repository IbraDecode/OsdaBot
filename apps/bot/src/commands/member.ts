/**
 * Perintah anggota: `DAFTAR ...` dan `PROFIL`.
 *
 * - `DAFTAR` memakai `normalisasiProfil` dari `@osda/contracts` supaya aturan
 *   Title Case, angkatan (10/11/12 → X/XI/XII), kode jurusan, dan sub-kelas
 *   identik dengan Web dan Mobile. Tidak ada aturan normalisasi yang diduplikasi
 *   di dalam bot.
 * - `PROFIL` menampilkan data anggota + rekap kehadiran dari OSDA API.
 */
import { profilDariMasukan } from '../services/profil.js';

import { daftarAnggotaWhatsapp, detailAnggota, rekapAnggota } from '../api/client.js';
import { logger } from '../logger.js';
import { pastikanAnggota, pastikanLayananTersedia } from '../services/gerbang-pengurus.js';
import { hapusCacheIdentitas } from '../services/identity-resolver.js';
import * as tmpl from '../services/templates.js';
import { kodeGalat } from '../util/galat.js';
import { kirimTeks } from '../whatsapp/baileys.js';
import { jidKeTampilan, nomorKeTampilan, type PesanMasuk } from '../whatsapp/account.js';

/**
 * `DAFTAR Nama Lengkap Kelas`
 * Contoh: `DAFTAR Ibra Ramdan X TKJ 3`
 */
export async function tanganiDaftar(pesan: PesanMasuk, teks: string): Promise<void> {
  // Pendaftaran ditujukan untuk yang BELUM terdaftar, jadi cukup pastikan
  // OSDA API bisa dihubungi (identitas member belum harus ada).
  const layanan = await pastikanLayananTersedia(pesan);
  if (!layanan) return;

  const masukan = teks.replace(/^DAFTAR\b/i, '').trim();
  if (!masukan) {
    await kirimTeks(pesan.chatJid, tmpl.pesanDaftarGagal());
    return;
  }

  const profil = profilDariMasukan(masukan);
  if (!profil) {
    await kirimTeks(pesan.chatJid, tmpl.pesanDaftarGagal());
    return;
  }

  try {
    const hasil = await daftarAnggotaWhatsapp({
      jid: pesan.pengirimJid,
      nama: profil.nama,
      tingkat: profil.tingkat,
      jurusan: profil.jurusan,
      subKelas: profil.subKelas,
      lid: pesan.lid,
      namaTampilan: pesan.namaTampilan,
      telepon: pesan.nomor,
      pendaftarJid: null,
    });

    // Data anggota berubah → cache identitas nomor ini harus disegarkan.
    hapusCacheIdentitas(pesan.pengirimJid);

    const kelas = hasil.member.labelKelas || profil.labelKelas;
    const nomorTampilan =
      nomorKeTampilan(hasil.member.telepon) || jidKeTampilan(pesan.pengirimJid);

    if (hasil.dibuat) {
      logger.info({ jid: pesan.pengirimJid, nama: profil.nama }, 'Anggota baru daftar lewat WhatsApp');
      await kirimTeks(pesan.chatJid, tmpl.pesanDaftarBerhasil({ nama: profil.nama, labelKelas: kelas, nomorTampilan }));
      return;
    }

    logger.info({ jid: pesan.pengirimJid }, 'Data anggota diperbarui lewat WhatsApp');
    await kirimTeks(pesan.chatJid, tmpl.pesanDaftarDiperbarui({ nama: profil.nama, labelKelas: kelas }));
  } catch (galat) {
    logger.warn({ galat }, 'Pendaftaran anggota gagal');
    await kirimTeks(pesan.chatJid, tmpl.pesanDaftarGagal(kodeGalat(galat)));
  }
}

/** `PROFIL` — data diri + ringkasan kehadiran. */
export async function tanganiProfil(pesan: PesanMasuk): Promise<void> {
  const identitas = await pastikanAnggota(pesan);
  if (!identitas?.member) return;

  const member = identitas.member;
  const [anggota, rekap] = await Promise.allSettled([
    detailAnggota(member.id),
    rekapAnggota(member.id),
  ]);

  const dataAnggota = anggota.status === 'fulfilled' ? anggota.value : null;
  const dataRekap = rekap.status === 'fulfilled' ? rekap.value : null;

  const jabatan =
    dataAnggota?.jabatan?.map((j) => j.nama).filter((nama) => nama.length > 0) ??
    (member.jabatan ?? []);

  await kirimTeks(
    pesan.chatJid,
    tmpl.pesanProfil({
      nama: dataAnggota?.nama ?? member.nama,
      labelKelas: dataAnggota?.labelKelas ?? member.labelKelas,
      nomorTampilan: jidKeTampilan(pesan.pengirimJid),
      statusAnggota: dataAnggota?.status ?? member.status,
      jabatan,
      persenKehadiran: dataRekap?.persenKehadiran ?? null,
      hadir: dataRekap?.hadir ?? null,
      totalSesi: dataRekap?.totalSesi ?? null,
    }),
  );
}
