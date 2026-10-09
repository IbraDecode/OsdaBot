/**
 * Perintah pengurus (garis miring) OSDA Bot v2.
 *
 * Semua perintah di sini TIDAK mengakses database. Data dibaca/ditulis lewat
 * OSDA API, dan hak akses diperiksa dari izin yang dikembalikan endpoint
 * resolusi identitas (`/identity/whatsapp/resolve`).
 *
 * Daftar perintah (spec §32):
 *   /rekap       — rekap absensi rapat terakhir
 *   /reminder    — daftar anggota yang belum absen (dengan mention)
 *   /rapat       — jadwal rapat terdekat
 *   /tugas       — daftar tugas organisasi
 *   /program     — program kerja yang berjalan
 *   /absenin     — absen manual seorang anggota
 *   /daftarin    — daftarkan anggota baru lewat WhatsApp
 *   /listanggota — daftar anggota aktif
 */
import { profilDariMasukan } from '../services/profil.js';

import {
  KesalahanApi,
  catatHadirManual,
  cariAnggota,
  daftarAnggotaAktif,
  daftarAnggotaWhatsapp,
  daftarProgram,
  daftarRapat,
  daftarSesi,
  daftarTugas,
  nomorKeJidPn,
  rekapSesi,
  sesiPadaTanggal,
  sesiTerbukaHariIni,
} from '../api/client.js';
import { logger } from '../logger.js';
import { lewatiGerbangPengurus } from '../services/gerbang-pengurus.js';
import * as tmpl from '../services/templates.js';
import { kodeGalat } from '../util/galat.js';
import { tanggalHariIni } from '../util/waktu.js';
import { kirimMention, kirimTeks } from '../whatsapp/baileys.js';
import { jidKeTampilan, type PesanMasuk } from '../whatsapp/account.js';
import { bangunTeksMention } from '../whatsapp/mention.js';
import { PETA_STATUS, type MaksudAbsen } from './attendance.js';

/** Cari kata kunci status (HADIR/IZIN/SAKIT) di dalam argumen perintah. */
function cariStatusAbsen(
  bagian: readonly string[],
): { indeks: number; status: MaksudAbsen } | null {
  for (let i = 0; i < bagian.length; i += 1) {
    const kata = bagian[i];
    if (!kata) continue;
    const hurufBesar = kata.toUpperCase();
    if (hurufBesar === 'HADIR' || hurufBesar === 'IZIN' || hurufBesar === 'SAKIT') {
      return { indeks: i, status: hurufBesar };
    }
  }
  return null;
}

/** `/rapat` — agenda rapat terdekat. */
export async function tanganiRapat(pesan: PesanMasuk): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'meeting.read', async () => {
    try {
      const rapat = await daftarRapat(tanggalHariIni());
      await kirimTeks(
        pesan.chatJid,
        rapat.length > 0 ? tmpl.pesanRapatRingkas(rapat) : tmpl.pesanAgendaKosong(),
      );
    } catch (galat) {
      logger.warn({ galat }, 'Gagal membaca daftar rapat');
      await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
    }
  });
}

/** `/tugas` — daftar tugas organisasi. */
export async function tanganiTugasOrganisasi(pesan: PesanMasuk): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'task.read', async () => {
    try {
      const tugas = await daftarTugas({ limit: 10 });
      await kirimTeks(
        pesan.chatJid,
        tugas.length > 0
          ? tmpl.pesanDaftarTugas('TUGAS ORGANISASI', tugas)
          : tmpl.pesanTugasKosong(),
      );
    } catch (galat) {
      logger.warn({ galat }, 'Gagal membaca daftar tugas');
      await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
    }
  });
}

/** `/program` — program kerja yang berjalan. */
export async function tanganiProgram(pesan: PesanMasuk): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'program.read', async () => {
    try {
      const program = await daftarProgram('RUNNING', 10);
      await kirimTeks(
        pesan.chatJid,
        program.length > 0 ? tmpl.pesanProgramSaya(program) : tmpl.pesanProgramKosong(),
      );
    } catch (galat) {
      logger.warn({ galat }, 'Gagal membaca daftar program');
      await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
    }
  });
}

/** `/listanggota` — daftar anggota aktif. */
export async function tanganiListAnggota(pesan: PesanMasuk): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'member.read', async () => {
    try {
      const anggota = await daftarAnggotaAktif(50);
      await kirimTeks(
        pesan.chatJid,
        anggota.length > 0
          ? tmpl.pesanDaftarAnggota(
              anggota.map((a) => ({
                nama: a.nama,
                labelKelas: a.labelKelas,
                divisionNama: a.divisionNama,
              })),
            )
          : tmpl.pesanDaftarAnggotaKosong(),
      );
    } catch (galat) {
      logger.warn({ galat }, 'Gagal membaca daftar anggota');
      await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
    }
  });
}

/**
 * Sesi yang mau direkap: sesi terbuka hari ini → sesi tertutup hari ini →
 * sesi terakhir yang pernah dibuat.
 */
async function sesiUntukRekap(): Promise<string | null> {
  const tanggal = tanggalHariIni();

  const sesiTerbuka = await sesiTerbukaHariIni(tanggal).catch(() => null);
  if (sesiTerbuka) return sesiTerbuka.id;

  const sesiHariIni = await sesiPadaTanggal(tanggal).catch(() => null);
  if (sesiHariIni) return sesiHariIni.id;

  const daftar = await daftarSesi(5).catch(() => []);
  const urut = [...daftar].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  return urut[0]?.id ?? null;
}

/** `/rekap` — rekap kehadiran satu sesi absensi. */
export async function tanganiRekap(pesan: PesanMasuk): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'attendance.read', async () => {
    try {
      const sessionId = await sesiUntukRekap();
      if (!sessionId) {
        await kirimTeks(pesan.chatJid, tmpl.pesanBelumAdaRekap());
        return;
      }

      const rekap = await rekapSesi(sessionId);
      await kirimTeks(
        pesan.chatJid,
        tmpl.pesanRekapSesi({
          judul: rekap.judul,
          tanggal: rekap.tanggal,
          status: rekap.status,
          totalWajib: rekap.totalWajib,
          statistik: rekap.statistik,
          hadir: rekap.hadir,
          izin: rekap.izin,
          sakit: rekap.sakit,
          belumAbsen: rekap.belumAbsen,
        }),
      );
    } catch (galat) {
      logger.warn({ galat }, 'Gagal menyusun rekap absensi');
      await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
    }
  });
}

/**
 * `/reminder` — daftar anggota yang belum absen, dengan mention WhatsApp.
 *
 * Mention hanya mungkin untuk anggota yang nomornya sudah tercatat di OSDA
 * (kolom `telepon`). Sisanya tetap tampil sebagai teks nama biasa.
 */
export async function tanganiReminder(pesan: PesanMasuk): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'attendance.read', async () => {
    const tanggal = tanggalHariIni();
    try {
      const sesi = await sesiTerbukaHariIni(tanggal);
      if (!sesi) {
        await kirimTeks(pesan.chatJid, tmpl.pesanAbsenBelumDibuka());
        return;
      }

      const [rekap, anggota] = await Promise.all([rekapSesi(sesi.id), daftarAnggotaAktif(100)]);

      if (rekap.belumAbsen.length === 0) {
        await kirimTeks(
          pesan.chatJid,
          `${tmpl.EMOJI.SUKSES} *SEMUA ANGGOTA SUDAH ABSEN*\n\nSeluruh anggota wajib hadir sudah mencatat kehadiran. Kerja bagus!`,
        );
        return;
      }

      // Nomor telepon dipakai untuk mention; tanpa nomor → tampil sebagai teks.
      const petaTelepon = new Map(anggota.map((a) => [a.id, a.telepon]));
      const daftar = rekap.belumAbsen.map((r) => {
        const telepon = petaTelepon.get(r.memberId);
        return {
          nama: r.nama,
          kelas: r.kelas,
          jid: telepon ? nomorKeJidPn(telepon) : null,
        };
      });

      const { teks, mentions } = bangunTeksMention(
        daftar,
        `${tmpl.EMOJI.DAFTAR} *BELUM ABSEN* (${daftar.length})`,
      );
      const isi = [
        teks,
        '',
        'Kirim `HADIR` bila sudah siap, atau `IZIN <alasan>` / `SAKIT <alasan>` bila tidak bisa hadir.',
      ].join('\n');
      await kirimMention(pesan.chatJid, isi, mentions);
      logger.info({ sessionId: sesi.id, jumlah: daftar.length }, 'Reminder absensi dikirim');
    } catch (galat) {
      logger.warn({ galat }, 'Gagal mengirim reminder absensi');
      await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
    }
  });
}

/**
 * `/absenin <nama anggota> <HADIR/IZIN/SAKIT> [alasan]`
 * Absen manual oleh pengurus (mis. anggota tidak membawa HP).
 */
export async function tanganiAbsenIn(pesan: PesanMasuk, argumen: string): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'attendance.manage', async () => {
    const bagian = argumen.trim().split(/\s+/).filter((b) => b.length > 0);
    const dicari = cariStatusAbsen(bagian);

    if (bagian.length < 2 || !dicari || dicari.indeks === 0) {
      await kirimTeks(pesan.chatJid, tmpl.pesanAbseninGagal());
      return;
    }

    const nama = bagian.slice(0, dicari.indeks).join(' ');
    const alasan = bagian.slice(dicari.indeks + 1).join(' ').trim();
    if (dicari.status !== 'HADIR' && alasan.length < 3) {
      await kirimTeks(pesan.chatJid, tmpl.pesanAbseninGagal());
      return;
    }

    try {
      const tanggal = tanggalHariIni();
      const sesi = await sesiTerbukaHariIni(tanggal);
      if (!sesi) {
        await kirimTeks(pesan.chatJid, tmpl.pesanAbsenBelumDibuka());
        return;
      }

      const kandidat = await cariAnggota(nama, 5);
      const anggota = kandidat[0];
      if (!anggota) {
        await kirimTeks(pesan.chatJid, tmpl.pesanAnggotaTidakDitemukan(nama));
        return;
      }

      const alasanAkhir = dicari.status === 'HADIR' ? alasan || 'Dicatat manual oleh pengurus' : alasan;

      await catatHadirManual({
        sessionId: sesi.id,
        memberId: anggota.id,
        status: PETA_STATUS[dicari.status],
        alasan: alasanAkhir,
        catatan: `Absen manual lewat WhatsApp oleh ${pesan.namaTampilan ?? pesan.pengirimJid}`,
        direkamOlehJid: pesan.pengirimJid,
      });

      logger.info({ memberId: anggota.id, sessionId: sesi.id }, 'Absen manual oleh pengurus');
      await kirimTeks(
        pesan.chatJid,
        tmpl.pesanAbseninBerhasil({
          nama: anggota.nama,
          status: PETA_STATUS[dicari.status],
          alasan: alasanAkhir,
        }),
      );
    } catch (galat) {
      if (galat instanceof KesalahanApi && galat.status === 409) {
        await kirimTeks(
          pesan.chatJid,
          tmpl.pesanSudahAbsen({
            status: PETA_STATUS[dicari.status],
            alasan: alasan || null,
            judulSesi: null,
          }),
        );
        return;
      }
      logger.warn({ galat }, 'Absen manual gagal');
      await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
    }
  });
}

/**
 * `/daftarin <nama> <kelas> [nomor whatsapp]`
 * Mendaftarkan anggota baru; nomor tujuan bisa dari argumen atau mention.
 */
export async function tanganiDaftarIn(pesan: PesanMasuk, argumen: string): Promise<void> {
  await lewatiGerbangPengurus(pesan, 'member.write', async () => {
    const bagian = argumen.trim().split(/\s+/).filter((b) => b.length > 0);
    const terakhir = bagian[bagian.length - 1] ?? '';
    const adaNomor = /^(\+?62|08)\d{6,15}$/.test(terakhir);

    const jidMention = pesan.mentions[0] ?? null;
    const jidTujuan = adaNomor ? nomorKeJidPn(terakhir) : jidMention;
    const teksProfil = (adaNomor ? bagian.slice(0, -1) : bagian).join(' ');

    if (!jidTujuan || teksProfil.length < 3) {
      await kirimTeks(pesan.chatJid, tmpl.pesanDaftarinGagal());
      return;
    }

    const profil = profilDariMasukan(teksProfil);
    if (!profil) {
      await kirimTeks(pesan.chatJid, tmpl.pesanDaftarinGagal());
      return;
    }

    try {
      const hasil = await daftarAnggotaWhatsapp({
        jid: jidTujuan,
        nama: profil.nama,
        tingkat: profil.tingkat,
        jurusan: profil.jurusan,
        subKelas: profil.subKelas,
        telepon: jidTujuan.replace('@s.whatsapp.net', ''),
        pendaftarJid: pesan.pengirimJid,
      });

      logger.info({ jidTujuan, nama: profil.nama }, 'Anggota didaftarkan pengurus lewat WhatsApp');
      await kirimTeks(
        pesan.chatJid,
        tmpl.pesanDaftarAnggotaBerhasil({
          nama: profil.nama,
          labelKelas: hasil.member.labelKelas,
          nomorTampilan: jidKeTampilan(jidTujuan),
        }),
      );
    } catch (galat) {
      logger.warn({ galat, jidTujuan }, 'Pendaftaran anggota oleh pengurus gagal');
      await kirimTeks(pesan.chatJid, tmpl.pesanDaftarinGagal());
    }
  });
}
