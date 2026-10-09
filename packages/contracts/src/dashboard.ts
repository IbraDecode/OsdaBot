/**
 * Kontrak dasbor per peran.
 *
 * Setiap peran mendapat bentuk dasbor yang berbeda. Jangan pernah mengirim
 * satu bentuk yang sama untuk semua orang — lihat ROLE_MATRIX pada spesifikasi.
 */
import type { Cakupan } from './permissions.js';

/** Kartu ringkasan generik. */
export interface Kartu {
  readonly label: string;
  readonly nilai: number | string;
  readonly satuan?: string;
  readonly delta?: number | null;
  readonly arah?: 'naik' | 'turun' | 'tetap';
  readonly tautan?: string | null;
  readonly peringatan?: boolean;
}

/** Baris tren untuk grafik dasbor. */
export interface TitikTren {
  readonly tanggal: string;
  readonly nilai: number;
  readonly label?: string;
}

/** Dasbor Ketua — gambaran keseluruhan organisasi. */
export interface DasborKetua {
  readonly peran: string;
  readonly ruangKerja: 'EXECUTIVE';
  readonly hariIni: {
    readonly tanggal: string;
    readonly sesiAbsensiTerbuka: number;
    readonly hadirHariIni: number;
    readonly belumAbsen: number;
    readonly rapatHariIni: readonly { id: string; judul: string; waktuMulai: string; lokasi: string | null }[];
    readonly tugasSaya: number;
  };
  readonly program: {
    readonly totalAktif: number;
    readonly berjalan: number;
    readonly selesai: number;
    readonly terlambat: number;
    readonly progresRataRata: number;
  };
  readonly tugas: {
    readonly total: number;
    readonly terlambat: number;
    readonly belumDiverifikasi: number;
    readonly perDivisi: readonly { divisionId: string; divisionNama: string; terlambat: number; total: number }[];
  };
  readonly keuangan: {
    readonly saldo: number;
    readonly pemasukanBulanIni: number;
    readonly pengeluaranBulanIni: number;
    readonly utilizationAnggaranPersen: number;
  };
  readonly persetujuan: {
    readonly menungguSaya: number;
    readonly terbaru: readonly { id: string; jenis: string; ringkasan: string; nominal: number | null; dibuatPada: string }[];
  };
  readonly absensi: readonly TitikTren[];
  readonly aktivitas: readonly {
    readonly id: string;
    readonly jenis: string;
    readonly pesan: string;
    readonly oleh: string | null;
    readonly pada: string;
  }[];
  readonly pengumuman: readonly { id: string; judul: string; terbitPada: string | null }[];
}

/** Dasbor Wakil Ketua — fokus pada apa yang belum selesai. */
export interface DasborWakil {
  readonly peran: string;
  readonly ruangKerja: 'OPERATIONS';
  readonly tugas: {
    readonly terlambat: number;
    readonly terblokir: number;
    readonly menungguVerifikasi: number;
    readonly tanpaPIC: number;
    readonly daftar: readonly {
      readonly id: string;
      readonly judul: string;
      readonly assignee: readonly string[];
      readonly batasWaktu: string | null;
      readonly hariTersisa: number | null;
      readonly prioritas: string;
    }[];
  };
  readonly divisi: readonly {
    readonly divisionId: string;
    readonly nama: string;
    readonly koordinator: string | null;
    readonly anggotaAktif: number;
    readonly tugasTerlambat: number;
    readonly programBerjalan: number;
    readonly persenKehadiran: number;
    readonly aktivitasTerakhir: string | null;
  }[];
  readonly absensi: {
    readonly trenKehadiran: readonly TitikTren[];
    readonly sesiTanpaRekap: readonly { id: string; judul: string; tanggal: string }[];
  };
  readonly followUp: readonly {
    readonly tipe: 'TUGAS' | 'IZIN' | 'PERSETUJUAN' | 'LAPORAN';
    readonly label: string;
    readonly jumlah: number;
    readonly tautan: string;
  }[];
  readonly tenggat: readonly {
    readonly id: string;
    readonly jenis: string;
    readonly label: string;
    readonly tanggal: string;
    readonly hariTersisa: number;
  }[];
}

/** Dasbor Sekretaris — administrasi. */
export interface DasborSekretaris {
  readonly peran: string;
  readonly ruangKerja: 'ADMINISTRATION';
  readonly absensiHariIni: {
    readonly sesi: readonly { id: string; judul: string; waktuMulai: string | null; sudahHadir: number; totalWajib: number }[];
    readonly totalHadir: number;
    readonly totalWajib: number;
  };
  readonly rapatMendatang: readonly {
    readonly id: string;
    readonly judul: string;
    readonly tanggal: string;
    readonly waktuMulai: string;
    readonly notulenId: string | null;
    readonly perluNotulen: boolean;
  }[];
  readonly notulen: {
    readonly belumSelesai: number;
    readonly menungguPersetujuan: number;
    readonly daftar: readonly { id: string; rapatJudul: string; tanggal: string; status: string }[];
  };
  readonly surat: {
    readonly masuk: number;
    readonly keluar: number;
    readonly perluTindakLanjut: number;
  };
  readonly dokumen: {
    readonly menungguPersetujuan: number;
    readonly draft: number;
    readonly totalArsip: number;
  };
  readonly anggota: {
    readonly total: number;
    readonly aktif: number;
    readonly berubahBulanIni: number;
    readonly belumPunyaAkun: number;
  };
  readonly kalender: readonly {
    readonly id: string;
    readonly tipe: 'MEETING' | 'EVENT' | 'DEADLINE' | 'ATTENDANCE' | 'PUBLICATION' | 'PERIOD';
    readonly judul: string;
    readonly tanggal: string;
    readonly tautan: string | null;
  }[];
}

/** Dasbor Bendahara — keuangan. */
export interface DasborBendahara {
  readonly peran: string;
  readonly ruangKerja: 'FINANCE';
  readonly kas: {
    readonly saldoSaatIni: number;
    readonly saldoAwal: number;
    readonly totalPemasukan: number;
    readonly totalPengeluaran: number;
    readonly periode: { readonly nama: string; readonly dari: string; readonly sampai: string };
  };
  readonly bulanIni: {
    readonly pemasukan: number;
    readonly pengeluaran: number;
    readonly net: number;
    readonly dibandingBulanLalu: number;
  };
  readonly pending: {
    readonly reimbursement: number;
    readonly reimbursementJumlah: number;
    readonly expense: number;
    readonly expenseJumlah: number;
  };
  readonly anggaran: readonly {
    readonly programId: string;
    readonly programNama: string;
    readonly disetujui: number;
    readonly realisasi: number;
    readonly sisa: number;
    readonly persen: number;
    readonly status: string;
  }[];
  readonly belumLunas: readonly {
    readonly memberId: string;
    readonly nama: string;
    readonly kelas: string;
    readonly nominal: number;
    readonly periode: string | null;
  }[];
  readonly trenMingguan: readonly TitikTren[];
  readonly laporanTersedia: readonly { format: 'PDF' | 'CSV' | 'XLSX'; jenis: string; tautan: string }[];
}

/** Dasbor Humas — komunikasi. */
export interface DasborHumas {
  readonly peran: string;
  readonly ruangKerja: 'COMMUNICATION';
  readonly antrean: readonly {
    readonly id: string;
    readonly judul: string;
    readonly status: string;
    readonly perluPersetujuan: boolean;
    readonly dibuatPada: string;
    readonly pengusul: string | null;
  }[];
  readonly terjadwal: readonly {
    readonly id: string;
    readonly judul: string;
    readonly jadwalkanPada: string;
    readonly kanal: readonly string[];
    readonly totalPenerima: number;
  }[];
  readonly acaraMendatang: readonly {
    readonly id: string;
    readonly judul: string;
    readonly tanggal: string;
    readonly sudahDikomunikasikan: boolean;
  }[];
  readonly aktivitas: {
    readonly terbitBulanIni: number;
    readonly totalTerkirim: number;
    readonly totalTerbaca: number;
    readonly tingkatPembacaan: number;
    readonly gagal: number;
  };
  readonly perKanal: readonly {
    readonly kanal: string;
    readonly terkirim: number;
    readonly terbaca: number;
    readonly gagal: number;
  }[];
  readonly kontak: {
    readonly totalAnggota: number;
    readonly denganWhatsapp: number;
    readonly tanpaWhatsapp: number;
  };
}

/** Dasbor Koordinator — satu divisi. */
export interface DasborKoordinator {
  readonly peran: string;
  readonly ruangKerja: 'DIVISION';
  readonly division: { readonly id: string; readonly nama: string; readonly koordinator: string | null };
  readonly anggota: { readonly total: number; readonly aktif: number; readonly persenKehadiran: number };
  readonly tugas: {
    readonly total: number;
    readonly terlambat: number;
    readonly menungguVerifikasi: number;
    readonly perAnggota: readonly { memberId: string; nama: string; kelas: string; total: number; selesai: number; terlambat: number }[];
  };
  readonly program: readonly {
    readonly id: string;
    readonly nama: string;
    readonly status: string;
    readonly progres: number;
    readonly selesaiPada: string;
    readonly terlambat: boolean;
  }[];
  readonly absensi: readonly TitikTren[];
}

/** Dasbor Anggota — tampilan sederhana. */
export interface DasborAnggota {
  readonly peran: string;
  readonly ruangKerja: 'PERSONAL';
  readonly nama: string;
  readonly kelas: string;
  readonly hariIni: {
    readonly tanggal: string;
    readonly sesiTerbuka: readonly {
      readonly id: string;
      readonly judul: string;
      readonly jenis: string;
      readonly waktuMulai: string | null;
      readonly lokasi: string | null;
      readonly qrAktif: boolean;
      readonly statusSaya: string | null;
    }[];
  };
  readonly tugasSaya: readonly {
    readonly id: string;
    readonly judul: string;
    readonly prioritas: string;
    readonly batasWaktu: string | null;
    readonly overdue: boolean;
    readonly status: string;
  }[];
  readonly acaraMendatang: readonly { readonly id: string; judul: string; tanggal: string; lokasi: string | null }[];
  readonly pengumuman: readonly { readonly id: string; judul: string; terbitPada: string | null; pin: boolean }[];
  readonly permintaanSaya: readonly {
    readonly id: string;
    readonly tipe: string;
    readonly ringkasan: string;
    readonly status: string;
    readonly dibuatPada: string;
  }[];
  readonly keuanganSaya: {
    readonly statusIuran: string;
    readonly nominal: number;
    readonly belumLunas: number;
    readonly belumDiterima: number;
  };
  readonly statistik: {
    readonly persenKehadiran: number;
    readonly tugasSelesai: number;
    readonly tugasTotal: number;
  };
}

/** Balapan tipe dasbor — menentukan bentuk mana yang dikirim ke client. */
export type BentukDasbor =
  | DasborKetua
  | DasborWakil
  | DasborSekretaris
  | DasborBendahara
  | DasborHumas
  | DasborKoordinator
  | DasborAnggota;

/** Konteks dasbor yang dikirim bersama. */
export interface KonteksDasbor {
  readonly organizationId: string;
  readonly periodId: string | null;
  readonly periodNama: string | null;
  readonly cakupan: readonly Cakupan[];
  readonly batasWaktu: string;
}
