/**
 * Seluruh teks balasan OSDA Bot terpusat di sini.
 *
 * Aturan gaya (mengikuti konvensi bot lama `osda-bot`):
 * 1. Bahasa Indonesia, singkat, ramah, tanpa istilah teknis.
 * 2. Setiap balasan WAJIB diawali emoji penanda maksud:
 *      ✅ sukses / tercatat
 *      ⚠️ peringatan / perlu tindakan pengguna
 *      🔒 ditutup, ditolak, atau khusus pengurus
 *      📢 pengumuman / instruksi / bantuan
 *      📋 daftar bernomor
 *      📊 rekap, statistik, keuangan
 *      ℹ️ informasi netral (rapat belum dibuka, data kosong)
 *      ⏳ menunggu / proses
 *      ❌ format pesan tidak dikenali
 * 3. Teks tebal memakai format WhatsApp (`*tebal*`), kode memakai backtick.
 * 4. Jangan pernah meminta anggota mengetik ID, kode, atau username — identitas
 *    selalu diambil dari JID pengirim.
 */
import { formatRupiah, formatTanggal, type StatusHadir } from '@osda/contracts';
import type { Kas, RekapSesi, Anggota, Notifikasi, Program, Rapat, Tugas } from '@osda/contracts';

// ============================================================
// Konstanta gaya
// ============================================================

export const EMOJI = {
  SUKSES: '✅',
  PERINGATAN: '⚠️',
  TERKUNCI: '🔒',
  PENGUMUMAN: '📢',
  DAFTAR: '📋',
  REKAP: '📊',
  INFO: 'ℹ️',
  MENUNGGU: '⏳',
  GALAT: '❌',
} as const;

const NAMA_APLIKASI = 'OSDA';

/** Label ramah untuk status kehadiran (dipakai di semua balasan). */
export function labelStatusHadir(status: StatusHadir): string {
  switch (status) {
    case 'PRESENT':
      return 'HADIR';
    case 'LATE':
      return 'TERLAMBAT';
    case 'EXCUSED':
      return 'IZIN';
    case 'SICK':
      return 'SAKIT';
    case 'ABSENT':
      return 'TIDAK HADIR';
    default:
      return String(status);
  }
}

/** Label status untuk tampilan rekap. */
export function labelStatusRawat(status: string): string {
  const peta: Record<string, string> = {
    PRESENT: 'HADIR',
    LATE: 'TERLAMBAT',
    EXCUSED: 'IZIN',
    SICK: 'SAKIT',
    ABSENT: 'TIDAK HADIR',
    TODO: 'BELUM MULAI',
    IN_PROGRESS: 'SEDANG DIKERJAKAN',
    BLOCKED: 'TERBENDUNG',
    DONE: 'SELESAI',
    CANCELLED: 'DIBATALKAN',
    SCHEDULED: 'TERJADWAL',
    ONGOING: 'BERLANGSUNG',
    COMPLETED: 'SELESAI',
    DRAFT: 'DRAF',
    PROPOSED: 'DIAJUKAN',
    APPROVED: 'DISETUJUI',
    PLANNED: 'DIRENCANAKAN',
    RUNNING: 'BERJALAN',
  };
  return peta[status] ?? status;
}

/** Gabungkan baris-baris menjadi satu pesan WhatsApp. */
function gabung(baris: readonly string[]): string {
  return baris.join('\n');
}

/** Seperti `gabung`, tetapi membuang baris kosong (dipakai bila ada bagian opsional). */
function gabungRapi(baris: readonly string[]): string {
  return baris.filter((barisItem) => barisItem.trim().length > 0).join('\n');
}

// ============================================================
// Bantuan & kesalahan umum
// ============================================================

export function pesanBantuan(): string {
  return gabung([
    `${EMOJI.PENGUMUMAN} *BANTUAN ${NAMA_APLIKASI} BOT*`,
    '',
    '*Untuk Anggota*',
    '• `DAFTAR Nama Lengkap Kelas` — daftar atau ubah data diri',
    '• `HADIR` — catat hadir rapat',
    '• `IZIN <alasan>` — izin tidak hadir',
    '• `SAKIT <alasan>` — sakit, tidak hadir',
    '• `STATUS` — status absensi kamu hari ini',
    '• `AGENDA` — agenda rapat terdekat',
    '• `TUGAS` — daftar tugas kamu',
    '• `KAS` — status kas kamu',
    '• `PROFIL` — data diri & rekap kehadiran',
    '• `BANTUAN` — tampilkan pesan ini',
    '',
    '*Untuk Pengurus*',
    '• `/rekap` — rekap absensi rapat terakhir',
    '• `/reminder` — daftar anggota yang belum absen',
    '• `/rapat` — jadwal rapat',
    '• `/tugas` — daftar tugas organisasi',
    '• `/program` — program kerja yang berjalan',
    '• `/kas` — status keuangan organisasi',
    '• `/absenin <nama> <HADIR/IZIN/SAKIT> [alasan]` — absen manual',
    '• `/daftarin <nama> <kelas>` — daftarkan anggota',
    '• `/listanggota` — daftar anggota aktif',
    '',
    `${EMOJI.INFO} Pertanyaan? Hubungi pengurus ${NAMA_APLIKASI}.`,
  ]);
}

export function pesanFormatTidakDikenal(): string {
  return gabung([
    `${EMOJI.GALAT} *FORMAT TIDAK DIKENALI*`,
    '',
    'Kirim `BANTUAN` untuk melihat daftar perintah yang bisa dipakai.',
  ]);
}

export function pesanTerlaluBanyakPermintaan(): string {
  return gabung([
    `${EMOJI.MENUNGGU} *TERLALU BANYAK PERMINTAAN*`,
    '',
    'Coba lagi beberapa saat ya. Bot membatasi jumlah pesan agar tetap lancar.',
  ]);
}

export function pesanKesalahanServer(detail?: string): string {
  return gabungRapi([
    `${EMOJI.PERINGATAN} *LAYANAN SEDANG BERMASALAH*`,
    '',
    'Permintaan tidak bisa diproses sekarang. Coba lagi beberapa menit.',
    detail ? `Kode: ${detail}` : '',
  ]);
}

// ============================================================
// Identitas & pendaftaran
// ============================================================

export function pesanBelumTerdaftar(): string {
  return gabung([
    `${EMOJI.PERINGATAN} *AKUN BELUM TERDAFTAR*`,
    '',
    'Daftar dulu sekali dengan format:',
    '`DAFTAR Nama Lengkap Kelas`',
    '',
    'Contoh: `DAFTAR Ibra Ramdan X TKJ 3`',
    `${EMOJI.INFO} Identitas diambil otomatis dari nomor WhatsApp kamu, jadi jangan pakai nomor orang lain.`,
  ]);
}

export function pesanPerluTautanAkun(tautan: string | null): string {
  const baris: string[] = [
    `${EMOJI.PERINGATAN} *AKUN BELUM TERTAUT*`,
    '',
    'Nomor WhatsApp kamu belum tertaut ke data anggota OSDA.',
    'Buka aplikasi OSDA (Web/Mobile) lalu masuk dengan akun kamu,',
    'kemudian tautkan nomor ini di menu Profil > Tautkan WhatsApp.',
  ];
  if (tautan) {
    baris.push('', `Tautan langsung: ${tautan}`);
  }
  return gabung(baris);
}

export function pesanPerintahKhususPengurus(): string {
  return gabung([
    `${EMOJI.TERKUNCI} *PERINTAH KHUSUS PENGURUS*`,
    '',
    'Perintah ini hanya untuk pengurus OSDA.',
    'Anggota biasa memakai: `HADIR`, `IZIN`, `SAKIT`, `STATUS`, `KAS`, `PROFIL`.',
  ]);
}

export function pesanBotTidakBerwenang(): string {
  return gabung([
    `${EMOJI.TERKUNCI} *BOT BELUM TERAUTENTIKASI*`,
    '',
    'Token bot ke OSDA API belum diatur atau sudah tidak berlaku.',
    'Perbarui `API_BOT_TOKEN` pada berkas .env lalu jalankan ulang bot.',
  ]);
}

export function pesanDaftarBerhasil(data: {
  nama: string;
  labelKelas: string;
  nomorTampilan: string;
}): string {
  return gabung([
    `${EMOJI.SUKSES} *PENDAFTARAN BERHASIL*`,
    '',
    `• Nama : ${data.nama}`,
    `• Kelas : ${data.labelKelas}`,
    `• Nomor : ${data.nomorTampilan}`,
    '',
    'Untuk mengubah data, kirim ulang `DAFTAR` dengan data baru.',
  ]);
}

export function pesanDaftarDiperbarui(data: { nama: string; labelKelas: string }): string {
  return gabung([
    `${EMOJI.PERINGATAN} *AKUN SUDAH TERDAFTAR*`,
    '',
    'Data kamu sudah diperbarui:',
    `• Nama : ${data.nama}`,
    `• Kelas : ${data.labelKelas}`,
  ]);
}

export function pesanDaftarGagal(detail?: string): string {
  return gabungRapi([
    `${EMOJI.PERINGATAN} *PENDAFTARAN GAGAL*`,
    '',
    'Data belum bisa disimpan. Periksa kembali format:',
    '`DAFTAR Nama Lengkap Kelas`',
    'Contoh: `DAFTAR Ibra Ramdan X TKJ 3`',
    detail ? `Kode: ${detail}` : '',
  ]);
}

export function pesanDaftarAnggotaBerhasil(data: {
  nama: string;
  labelKelas: string;
  nomorTampilan: string;
}): string {
  return gabung([
    `${EMOJI.SUKSES} *ANGGOTA BERHASIL DIDAFTARKAN*`,
    '',
    `• Nama : ${data.nama}`,
    `• Kelas : ${data.labelKelas}`,
    `• Nomor : ${data.nomorTampilan}`,
  ]);
}

// ============================================================
// Absensi
// ============================================================

export function pesanAbsenBerhasil(data: {
  status: StatusHadir;
  alasan?: string | null;
  judulSesi: string;
}): string {
  return gabungRapi([
    `${EMOJI.SUKSES} *ABSENSI RAPAT BERHASIL DICATAT*`,
    '',
    'Absensi rapat berhasil dicatat.',
    `• Status : ${labelStatusHadir(data.status)}`,
    `• Agenda : ${data.judulSesi}`,
    data.alasan ? `• Alasan : ${data.alasan}` : '',
  ]);
}

export function pesanAbsenBelumDibuka(): string {
  return gabung([
    `${EMOJI.INFO} *ABSENSI BELUM DIBUKA*`,
    '',
    'Pengurus akan membuka absensi saat rapat dimulai. Coba kirim `HADIR` lagi setelah dibuka.',
  ]);
}

export function pesanAbsenSudahDitutup(): string {
  return gabung([
    `${EMOJI.TERKUNCI} *ABSENSI SUDAH DITUTUP*`,
    '',
    'Sesi absensi rapat ini sudah ditutup. Hubungi pengurus bila perlu diperbaiki.',
  ]);
}

export function pesanAbsensiGagal(detail?: string): string {
  return gabungRapi([
    `${EMOJI.PERINGATAN} *ABSENSI GAGAL DICATAT*`,
    '',
    'Kehadiran belum bisa disimpan. Coba beberapa saat lagi.',
    detail ? `Kode: ${detail}` : '',
  ]);
}

/** Balasan untuk perintah `STATUS` (spec §66). */
export function pesanStatusHariIni(data: {
  status: StatusHadir;
  alasan: string | null;
  judulSesi: string | null;
  direkamPada?: string | null;
}): string {
  const baris: string[] = [
    `${EMOJI.REKAP} *STATUS ABSENSI HARI INI*`,
    '',
    `Absensi kamu hari ini: ${labelStatusHadir(data.status)}.`,
  ];
  if (data.judulSesi) baris.push(`Agenda : ${data.judulSesi}`);
  if (data.alasan) baris.push(`Alasan : ${data.alasan}`);
  if (data.direkamPada) baris.push(`Dicatat : ${formatTanggal(data.direkamPada)}`);
  return gabung(baris);
}

export function pesanBelumAbsen(): string {
  return gabung([
    `${EMOJI.REKAP} *STATUS ABSENSI HARI INI*`,
    '',
    'Absensi kamu hari ini: BELUM ABSEN.',
    '',
    'Kirim `HADIR` untuk mencatat kehadiran, atau `IZIN <alasan>` bila tidak bisa hadir.',
  ]);
}

/** Anggota sudah tercatat hadir pada sesi yang sama. */
export function pesanSudahAbsen(data: {
  status: StatusHadir;
  alasan: string | null;
  judulSesi: string | null;
}): string {
  return gabungRapi([
    `${EMOJI.INFO} *KAMU SUDAH ABSEN*`,
    '',
    `Absensi kamu hari ini: ${labelStatusHadir(data.status)}.`,
    `Agenda : ${data.judulSesi ?? '-'}`,
    data.alasan ? `Alasan : ${data.alasan}` : '',
    '',
    'Kirim perintah lain untuk mengubah status, misalnya `IZIN <alasan>`.',
  ]);
}

// ============================================================
// Profil
// ============================================================

export function pesanProfil(data: {
  nama: string;
  labelKelas: string;
  nomorTampilan: string;
  statusAnggota: string;
  jabatan: readonly string[];
  persenKehadiran?: number | null;
  hadir?: number | null;
  totalSesi?: number | null;
}): string {
  const jabatan = data.jabatan.length > 0 ? data.jabatan.join(', ') : 'Anggota';
  const baris: string[] = [
    `${EMOJI.DAFTAR} *PROFIL ANGGOTA*`,
    '',
    `• Nama : ${data.nama}`,
    `• Kelas : ${data.labelKelas}`,
    `• Jabatan : ${jabatan}`,
    `• Status : ${data.statusAnggota}`,
    `• Nomor : ${data.nomorTampilan}`,
  ];
  if (data.persenKehadiran !== null && data.persenKehadiran !== undefined) {
    baris.push('', `${EMOJI.REKAP} Kehadiran : ${data.persenKehadiran}%`);
    if (data.hadir !== null && data.hadir !== undefined && data.totalSesi !== null && data.totalSesi !== undefined) {
      baris.push(`Total sesi : ${data.hadir} hadir dari ${data.totalSesi} sesi`);
    }
  }
  return gabung(baris);
}

// ============================================================
// Rekap, agenda, tugas, program, kas
// ============================================================

export function pesanRekapSesi(rekap: {
  judul: string;
  tanggal: string;
  status: string;
  totalWajib: number;
  statistik: RekapSesi['statistik'];
  hadir: readonly { nama: string; kelas: string; alasan: string | null }[];
  izin: readonly { nama: string; kelas: string; alasan: string | null }[];
  sakit: readonly { nama: string; kelas: string; alasan: string | null }[];
  belumAbsen: readonly { nama: string; kelas: string; alasan: string | null }[];
}): string {
  const baris: string[] = [
    `${EMOJI.REKAP} *REKAP ABSENSI*`,
    '',
    `Agenda : ${rekap.judul}`,
    `Tanggal : ${formatTanggal(rekap.tanggal)}`,
    `Status sesi : ${labelStatusRawat(rekap.status)}`,
    '',
    `• Wajib hadir : ${rekap.totalWajib}`,
    `• Hadir : ${rekap.statistik.hadir} (${rekap.statistik.persenHadir}%)`,
    `• Izin : ${rekap.statistik.izin}`,
    `• Sakit : ${rekap.statistik.sakit}`,
    `• Tidak hadir : ${rekap.statistik.tidakHadir}`,
    `• Belum absen : ${rekap.statistik.belumAbsen}`,
  ];

  const daftar = (judul: string, anggota: readonly { nama: string; kelas: string; alasan: string | null }[], denganAlasan: boolean): string[] => {
    if (anggota.length === 0) return [];
    const isi = anggota.map((a, i) => {
      const kelas = a.kelas ? ` (${a.kelas})` : '';
      const alasan = denganAlasan && a.alasan ? ` — alasan : ${a.alasan}` : '';
      return `${i + 1}. ${a.nama}${kelas}${alasan}`;
    });
    return ['', `${EMOJI.DAFTAR} ${judul} (${anggota.length})`, ...isi];
  };

  baris.push(...daftar('YANG HADIR', rekap.hadir, false));
  baris.push(...daftar('IZIN', rekap.izin, true));
  baris.push(...daftar('SAKIT', rekap.sakit, true));
  baris.push(...daftar('BELUM ABSEN', rekap.belumAbsen, false));
  return gabung(baris);
}

export function pesanBelumAdaRekap(): string {
  return gabung([
    `${EMOJI.INFO} *REKAP BELUM TERSEDIA*`,
    '',
    'Belum ada sesi absensi yang bisa direkap hari ini.',
    'Kirim `/rapat` untuk melihat jadwal rapat terdekat.',
  ]);
}

export function pesanAgendaKosong(): string {
  return gabung([
    `${EMOJI.INFO} *AGENDA KOSONG*`,
    '',
    'Belum ada rapat yang terjadwal. Pantau terus info dari pengurus.',
  ]);
}

export function pesanAgendaRapat(rapat: readonly {
  judul: string;
  tanggal: string;
  waktuMulai: string;
  lokasi: string | null;
  jenis: string;
  status: string;
}[]): string {
  const baris: string[] = [`${EMOJI.DAFTAR} *AGENDA RAPAT TERDEKAT*`, ''];
  rapat.slice(0, 8).forEach((r, i) => {
    const lokasi = r.lokasi ? ` • ${r.lokasi}` : '';
    baris.push(
      `${i + 1}. *${r.judul}*`,
      `   ${formatTanggal(r.tanggal)} • ${r.waktuMulai}${lokasi}`,
      `   Status: ${labelStatusRawat(r.status)}`,
      '',
    );
  });
  return gabung(baris).trimEnd();
}

export function pesanTugasKosong(): string {
  return gabung([
    `${EMOJI.INFO} *TIDAK ADA TUGAS*`,
    '',
    'Tidak ada tugas aktif yang perlu dikerjakan. Kerja bagus!',
  ]);
}

export function pesanDaftarTugas(
  judul: string,
  tugas: readonly {
    judul: string;
    status: string;
    prioritas: string;
    batasWaktu: string | null;
    programNama: string | null;
  }[],
): string {
  const baris: string[] = [`${EMOJI.DAFTAR} *${judul}*`, ''];
  tugas.slice(0, 10).forEach((t, i) => {
    const tenggat = t.batasWaktu ? ` • tenggat ${formatTanggal(t.batasWaktu)}` : '';
    const program = t.programNama ? ` • ${t.programNama}` : '';
    baris.push(
      `${i + 1}. *${t.judul}*`,
      `   ${labelStatusRawat(t.status)} • prioritas ${t.prioritas}${program}${tenggat}`,
    );
  });
  return gabung(baris);
}

export function pesanProgramKosong(): string {
  return gabung([
    `${EMOJI.INFO} *PROGRAM KERJA KOSONG*`,
    '',
    'Belum ada program kerja yang berjalan.',
  ]);
}

export function pesanDaftarProgram(
  program: readonly { nama: string; status: string; progres: number; ownerNama: string; selesaiPada: string }[],
): string {
  const baris: string[] = [`${EMOJI.DAFTAR} *PROGRAM KERJA BERJALAN*`, ''];
  program.slice(0, 10).forEach((p, i) => {
    baris.push(
      `${i + 1}. *${p.nama}* — ${labelStatusRawat(p.status)} (${p.progres}%)`,
      `   Penanggung jawab: ${p.ownerNama} • target ${formatTanggal(p.selesaiPada)}`,
    );
  });
  return gabung(baris);
}

/** Status kas untuk anggota (`KAS`). */
export function pesanKasAnggota(data: {
  nama: string;
  saldoAkhir: number;
  pemasukan: number;
  pengeluaran: number;
  periode: { dari: string; sampai: string };
  belumLunas?: readonly { nama: string; nominal: number }[];
  tagihanSaya?: number | null;
}): string {
  const baris: string[] = [
    `${EMOJI.REKAP} *KAS ${NAMA_APLIKASI}*`,
    '',
    `Periode : ${formatTanggal(data.periode.dari)} – ${formatTanggal(data.periode.sampai)}`,
    `Saldo kas : ${formatRupiah(data.saldoAkhir)}`,
    `Pemasukan : ${formatRupiah(data.pemasukan)}`,
    `Pengeluaran : ${formatRupiah(data.pengeluaran)}`,
  ];
  if (data.tagihanSaya !== null && data.tagihanSaya !== undefined && data.tagihanSaya > 0) {
    baris.push('', `${EMOJI.PERINGATAN} Tunggakan kas kamu: ${formatRupiah(data.tagihanSaya)}`);
    baris.push('Bayar langsung ke bendahara ya.');
  } else if (data.tagihanSaya !== null && data.tagihanSaya !== undefined) {
    baris.push('', `${EMOJI.SUKSES} Kas kamu sudah lunas. Terima kasih!`);
  }
  return gabung(baris);
}

/** Status keuangan untuk pengurus (`/kas`). */
export function pesanKasPengurus(data: {
  saldoSaatIni: number;
  pemasukanBulanIni: number;
  pengeluaranBulanIni: number;
  saldoBulanLalu: number;
  pendingExpense: number;
  pendingReimbursement: number;
}): string {
  return gabung([
    `${EMOJI.REKAP} *KEUANGAN ${NAMA_APLIKASI}*`,
    '',
    `Saldo saat ini : ${formatRupiah(data.saldoSaatIni)}`,
    `Saldo bulan lalu : ${formatRupiah(data.saldoBulanLalu)}`,
    `Pemasukan bulan ini : ${formatRupiah(data.pemasukanBulanIni)}`,
    `Pengeluaran bulan ini : ${formatRupiah(data.pengeluaranBulanIni)}`,
    '',
    `Menunggu persetujuan pengeluaran : ${data.pendingExpense}`,
    `Menunggu reimbursement : ${data.pendingReimbursement}`,
  ]);
}

export function pesanKasGagal(detail?: string): string {
  return gabungRapi([
    `${EMOJI.PERINGATAN} *DATA KAS BELUM BISA DITAMPILKAN*`,
    '',
    'Coba lagi beberapa saat.',
    detail ? `Kode: ${detail}` : '',
  ]);
}

// ============================================================
// Anggota & notifikasi
// ============================================================

export function pesanDaftarAnggota(
  anggota: readonly { nama: string; labelKelas: string; divisionNama: string | null }[],
): string {
  const baris: string[] = [`${EMOJI.DAFTAR} *DAFTAR ANGGOTA AKTIF* (${anggota.length})`, ''];
  anggota.slice(0, 60).forEach((a, i) => {
    const divisi = a.divisionNama ? ` • ${a.divisionNama}` : '';
    baris.push(`${i + 1}. ${a.nama} (${a.labelKelas})${divisi}`);
  });
  return gabung(baris);
}

export function pesanDaftarAnggotaKosong(): string {
  return gabung([
    `${EMOJI.INFO} *DAFTAR ANGGOTA KOSONG*`,
    '',
    'Belum ada anggota aktif yang tercatat.',
  ]);
}

/** Pesan notifikasi yang diteruskan dari OSDA ke WhatsApp. */
export function pesanNotifikasi(notif: { judul: string; isi: string; prioritas: string }): string {
  const emoji = notif.prioritas === 'CRITICAL' || notif.prioritas === 'HIGH' ? EMOJI.PENGUMUMAN : EMOJI.INFO;
  return gabung([
    `${emoji} *${notif.judul}*`,
    '',
    notif.isi,
  ]);
}

/** Notifikasi yang tidak bisa dikirim (mis. nomor penerima tidak diketahui). */
export function pesanAbseninBerhasil(data: {
  nama: string;
  status: StatusHadir;
  alasan?: string | null;
}): string {
  return gabungRapi([
    `${EMOJI.SUKSES} *ABSENSI MANUAL TERCATAT*`,
    '',
    `• Nama : ${data.nama}`,
    `• Status : ${labelStatusHadir(data.status)}`,
    data.alasan ? `• Alasan : ${data.alasan}` : '',
  ]);
}

export function pesanAbseninGagal(): string {
  return gabung([
    `${EMOJI.PERINGATAN} *ABSEN MANUAL GAGAL*`,
    '',
    'Format: `/absenin <nama anggota> <HADIR/IZIN/SAKIT> [alasan]`',
    'Contoh: `/absenin Ibra Ramdan HADIR`',
    '',
    'Pastikan nama anggota sesuai data OSDA dan sesi absensi sedang dibuka.',
  ]);
}

export function pesanAnggotaTidakDitemukan(nama: string): string {
  return gabung([
    `${EMOJI.PERINGATAN} *ANGGOTA TIDAK DITEMUKAN*`,
    '',
    `Tidak ada anggota aktif bernama mirip *${nama}*.`,
    'Periksa ejaan, atau pakai `/listanggota` untuk melihat daftar nama.',
  ]);
}

export function pesanDaftarinGagal(): string {
  return gabung([
    `${EMOJI.PERINGATAN} *PENDAFTARAN ANGGOTA GAGAL*`,
    '',
    'Format: `/daftarin <nama> <kelas> [nomor whatsapp]`',
    'Contoh: `/daftarin Ibra Ramdan X TKJ 3 6281234567890`',
  ]);
}

/** Ringkasan tugas satu anggota (dipakai `TUGAS`). */
export function pesanTugasSaya(tugas: readonly Tugas[]): string {
  return pesanDaftarTugas('TUGAS KAMU', tugas.map((t) => ({
    judul: t.judul,
    status: t.status,
    prioritas: t.prioritas,
    batasWaktu: t.batasWaktu,
    programNama: t.programNama,
  })));
}

/** Ringkasan program kerja (dipakai `/program`). */
export function pesanProgramSaya(program: readonly Program[]): string {
  return pesanDaftarProgram(program.map((p) => ({
    nama: p.nama,
    status: p.status,
    progres: p.progres,
    ownerNama: p.ownerNama,
    selesaiPada: p.selesaiPada,
  })));
}

/** Ringkasan rapat (dipakai `AGENDA` dan `/rapat`). */
export function pesanRapatRingkas(rapat: readonly Rapat[]): string {
  return pesanAgendaRapat(
    rapat.map((r) => ({
      judul: r.judul,
      tanggal: r.tanggal,
      waktuMulai: r.waktuMulai,
      lokasi: r.lokasi,
      jenis: r.jenis,
      status: r.status,
    })),
  );
}

/** Tipe kas dari API (dipakai perintah `KAS` dan `/kas`). */
export type KasRingkas = Kas;

/** Tipe anggota dari API (dipakai `/listanggota`). */
export type AnggotaRingkas = Anggota;

/** Tipe notifikasi dari API (dipakai notifier). */
export type NotifikasiRingkas = Notifikasi;
