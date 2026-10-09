/**
 * Perintah absensi anggota: `HADIR`, `IZIN <alasan>`, `SAKIT <alasan>`, `STATUS`.
 *
 * Payload dikirim ke OSDA API sesuai `SkemaCatatHadir` pada `@osda/contracts`
 * dengan sumber `WHATSAPP`, sehingga absensi dari WhatsApp, Web, dan Mobile
 * tersimpan dalam satu tabel yang sama.
 *
 * Format balasan mengikuti spec §66:
 *   HADIR  → "Absensi rapat berhasil dicatat."
 *   STATUS → "Absensi kamu hari ini: HADIR."
 */
import type { SesiAbsensi, StatusHadir } from '@osda/contracts';

import {
  KesalahanApi,
  catatHadir,
  catatanHariIni,
  sesiPadaTanggal,
  sesiTerbukaHariIni,
} from '../api/client.js';
import { pastikanAnggota } from '../services/gerbang-pengurus.js';
import * as tmpl from '../services/templates.js';
import { tanggalHariIni } from '../util/waktu.js';
import { kodeGalat } from '../util/galat.js';
import { logger } from '../logger.js';
import { kirimTeks } from '../whatsapp/baileys.js';
import type { PesanMasuk } from '../whatsapp/account.js';

/** Tiga maksud absensi yang bisa diketik anggota. */
export type MaksudAbsen = 'HADIR' | 'IZIN' | 'SAKIT';

/** Pemetaan ketikan anggota → `StatusHadir` milik kontrak. */
export const PETA_STATUS: Readonly<Record<MaksudAbsen, StatusHadir>> = {
  HADIR: 'PRESENT',
  IZIN: 'EXCUSED',
  SAKIT: 'SICK',
};

/**
 * Baca maksud absensi dari teks pesan.
 * `HADIR` tidak butuh alasan; `IZIN`/`SAKIT` wajib beralasan (minimal 3 karakter).
 */
export function bacakanMaksudAbsen(teks: string): { status: MaksudAbsen; alasan?: string } | null {
  const cocok = teks.trim().match(/^(HADIR|IZIN|SAKIT)\b\s*(.*)$/i);
  if (!cocok) return null;

  const kataStatus = (cocok[1] ?? '').toUpperCase();
  if (kataStatus !== 'HADIR' && kataStatus !== 'IZIN' && kataStatus !== 'SAKIT') return null;

  const alasan = (cocok[2] ?? '').trim();
  if (kataStatus === 'HADIR') return { status: kataStatus, alasan: alasan || undefined };
  if (alasan.length < 3) return null;
  return { status: kataStatus, alasan };
}

/**
 * `HADIR` / `IZIN <alasan>` / `SAKIT <alasan>`.
 * Alur: identitas → sesi absensi terbuka hari ini → catat kehadiran.
 */
export async function tanganiAbsen(
  pesan: PesanMasuk,
  maksud: { status: MaksudAbsen; alasan?: string },
): Promise<void> {
  const identitas = await pastikanAnggota(pesan);
  if (!identitas?.member) return;

  const member = identitas.member;
  const tanggal = tanggalHariIni();
  const status = PETA_STATUS[maksud.status];
  const alasan = maksud.alasan ?? null;

  let sesi: SesiAbsensi | null;
  try {
    sesi = await sesiTerbukaHariIni(tanggal);
  } catch (galat) {
    logger.warn({ galat, memberId: member.id }, 'Gagal mengambil sesi absensi');
    await kirimTeks(pesan.chatJid, tmpl.pesanAbsensiGagal(kodeGalat(galat)));
    return;
  }

  if (!sesi) {
    // Bedakan "belum dibuka" dengan "sudah ditutup" supaya pesan lebih jelas.
    let sesiHariIni: SesiAbsensi | null = null;
    try {
      sesiHariIni = await sesiPadaTanggal(tanggal);
    } catch (galat) {
      logger.warn({ galat }, 'Gagal memeriksa sesi absensi hari ini');
    }
    await kirimTeks(
      pesan.chatJid,
      sesiHariIni?.status === 'CLOSED' ? tmpl.pesanAbsenSudahDitutup() : tmpl.pesanAbsenBelumDibuka(),
    );
    return;
  }

  const judulSesi = sesi.judul;

  try {
    await catatHadir({
      sessionId: sesi.id,
      memberId: member.id,
      status,
      alasan,
      catatan: null,
      idempotencyKey: `wa:${pesan.id}`,
      direkamOlehJid: pesan.pengirimJid,
    });
    logger.info(
      { memberId: member.id, sessionId: sesi.id, status: maksud.status },
      'Absensi tercatat lewat WhatsApp',
    );
    await kirimTeks(pesan.chatJid, tmpl.pesanAbsenBerhasil({ status, alasan, judulSesi }));
  } catch (galat) {
    // 409 = anggota sudah absen di sesi ini (UNIQUE session_id + member_id).
    if (galat instanceof KesalahanApi && galat.status === 409) {
      await kirimTeks(pesan.chatJid, tmpl.pesanSudahAbsen({ status, alasan, judulSesi }));
      return;
    }
    logger.warn({ galat, memberId: member.id }, 'Gagal mencatat absensi');
    await kirimTeks(pesan.chatJid, tmpl.pesanAbsensiGagal(kodeGalat(galat)));
  }
}

/**
 * `STATUS` — tampilkan status absensi anggota untuk hari ini.
 */
export async function tanganiStatus(pesan: PesanMasuk): Promise<void> {
  const identitas = await pastikanAnggota(pesan);
  if (!identitas?.member) return;

  const member = identitas.member;
  const tanggal = tanggalHariIni();

  try {
    const [catatan, sesi] = await Promise.all([
      catatanHariIni(member.id, tanggal),
      sesiPadaTanggal(tanggal),
    ]);

    if (!catatan) {
      await kirimTeks(pesan.chatJid, tmpl.pesanBelumAbsen());
      return;
    }
    await kirimTeks(
      pesan.chatJid,
      tmpl.pesanStatusHariIni({
        status: catatan.status,
        alasan: catatan.alasan,
        judulSesi: sesi?.judul ?? null,
        direkamPada: catatan.direkamPada,
      }),
    );
  } catch (galat) {
    logger.warn({ galat, memberId: member.id }, 'Gagal membaca status absensi');
    await kirimTeks(pesan.chatJid, tmpl.pesanKesalahanServer(kodeGalat(galat)));
  }
}
