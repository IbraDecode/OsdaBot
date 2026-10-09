/**
 * Mesin prioritas notifikasi OSDA.
 *
 * Aturan (spec §31): JANGAN mengirim WhatsApp untuk semua hal. Hanya notifikasi
 * berprioritas HIGH dan CRITICAL yang boleh lewat WhatsApp. Sisanya cukup
 * in-app (dan push bila pengguna mengaktifkannya).
 */
import type { JenisNotifikasi, MetodeNotifikasi, PrioritasNotifikasi } from '@osda/contracts';

/** Prioritas default tiap jenis notifikasi. */
export const PRIORITAS_DEFAULT: Readonly<Record<JenisNotifikasi, PrioritasNotifikasi>> = {
  ATTENDANCE: 'HIGH',
  TASK: 'NORMAL',
  MEETING: 'NORMAL',
  PROGRAM: 'NORMAL',
  FINANCE: 'HIGH',
  APPROVAL: 'HIGH',
  ANNOUNCEMENT: 'NORMAL',
  SYSTEM: 'NORMAL',
};

/** Prioritas yang boleh dikirim ke WhatsApp (menghemat kuota & perhatian). */
export const PRIORITAS_WHATSAPP: readonly PrioritasNotifikasi[] = ['HIGH', 'CRITICAL'];

/** Prioritas yang selalu dikirim ke seluruh kanal. */
export const PRIORITAS_KRITIS: readonly PrioritasNotifikasi[] = ['CRITICAL'];

/**
 * Pilih kanal pengiriman untuk satu notifikasi.
 *
 * @param jenis    Jenis notifikasi.
 * @param prioritas Prioritas yang diinginkan (fallback ke default jenis).
 * @param izinkanWhatsapp Apakah organisasi mengaktifkan kanal WhatsApp.
 * @returns Kanal yang benar-benar dipakai.
 */
export function pilihKanal(
  jenis: JenisNotifikasi,
  prioritas: PrioritasNotifikasi | undefined,
  izinkanWhatsapp = false,
): MetodeNotifikasi[] {
  const prio = prioritas ?? PRIORITAS_DEFAULT[jenis];
  const kanal: MetodeNotifikasi[] = ['IN_APP'];

  if (prio === 'LOW') {
    // Hanya in-app. Tidak ganggu pengguna.
    return kanal;
  }

  if (izinkanWhatsapp && PRIORITAS_WHATSAPP.includes(prio)) {
    kanal.push('WHATSAPP');
  }

  if (prio !== 'NORMAL') {
    kanal.push('PUSH');
  } else {
    kanal.push('PUSH');
  }

  return kanal;
}

/**
 * Menentukan jadwal pengiriman pengingat.
 *
 * @param tenggat  Waktu tenggat (mis. batas absensi / batas tugas).
 * @param pengingatBerapaMenitSebelumnya Daftar pengingat dalam menit.
 * @returns Daftar waktu pengiriman dalam bentuk ISO string.
 */
export function jadwalPengingat(
  tenggat: Date,
  pengingatBerapaMenitSebelumnya: readonly number[] = [1440, 60, 10],
): Date[] {
  return pengingatBerapaMenitSebelumnya
    .map((menit) => new Date(tenggat.getTime() - menit * 60_000))
    .filter((waktu) => waktu.getTime() > Date.now())
    .sort((a, b) => a.getTime() - b.getTime());
}

/** Satukan beberapa notifikasi menjadi satu (mis. 3 tugas jatuh tempo). */
export function gabungkanNotifikasi(
  judulDefaults: string,
  daftar: readonly string[],
): { judul: string; isi: string } {
  if (daftar.length === 0) return { judul: judulDefaults, isi: '' };
  const pertama = daftar[0] ?? '';
  if (daftar.length === 1) return { judul: judulDefaults, isi: pertama };
  const sisa = daftar.length - 1;
  return {
    judul: `${judulDefaults} (${daftar.length})`,
    isi: `${pertama} dan ${sisa} lainnya`,
  };
}

/** Nama jenis notifikasi dalam Bahasa Indonesia (untuk log & UI). */
export const LABEL_JENIS: Readonly<Record<JenisNotifikasi, string>> = {
  ATTENDANCE: 'Absensi',
  TASK: 'Tugas',
  MEETING: 'Rapat',
  PROGRAM: 'Program',
  FINANCE: 'Keuangan',
  APPROVAL: 'Persetujuan',
  ANNOUNCEMENT: 'Pengumuman',
  SYSTEM: 'Sistem',
};
