/**
 * Parser masukan profil untuk perintah `DAFTAR` / `/daftarin`.
 *
 * Kenapa tidak langsung `normalisasiProfil(seluruh teks)`?
 * `normalisasiProfil` dari `@osda/contracts` menerima urutan v0.4:
 * "10 rpl 2 Muhammad Ibra Decode" (tingkat–jurusan–sub kelas–nama).
 * UX OSDA v2 malah "DAFTAR Nama Lengkap Kelas" (nama dulu, kelas di akhir),
 * karena anggota tidak boleh perlu mengingat urutan khusus.
 *
 * Jadi bot memecah masukan menjadi dua bagian:
 *   - nama  : sebelum penanda kelas
 *   - kelas : mulai dari penanda kelas (angka angkatan, romawi, kata "kelas",
 *             atau singkatan jurusan)
 * Bagian kelas lalu dirapikan (`normalisasiKelas`) dan diserahkan ke
 * `normalisasiProfil` — sumber kebenaran bersama dengan Web & Mobile — supaya
 * tingkat, kode jurusan, dan sub-kelas hasilnya identik.
 *
 * `normalisasiKelas` hanya menerjemahkan variasi penulisan yang manusia pakai:
 * romawi → angka angkatan (XI → 11), kata pembuka ("kelas X") dibuang, dan nama
 * jurusan panjang dipendekkan (teknik komputer dan jaringan → TKJ). Semua aturan
 * semantik (default tingkat X, sub-kelas 1) tetap milik kontrak.
 */
import { SINGKATAN_JURUSAN, keTitleCase, labelKelas, normalisasiProfil } from '@osda/contracts';

/** Penanda awal bagian kelas pada masukan. */
const PENANDA_KELAS: readonly RegExp[] = [
  /\b(?:10|11|12)\b/,
  /\b(?:XII|XI|X)\b/,
  /\bKELAS\b/,
  new RegExp(`\\b(?:${Object.values(SINGKATAN_JURUSAN).join('|')})\\b`),
];

/** Romawi → angka angkatan agar terbaca `normalisasiProfil`. */
const ROMAWI_KE_ANGKA: Readonly<Record<string, string>> = {
  X: '10',
  XI: '11',
  XII: '12',
};

/** Kata pembuka yang sering diketik anggota ("kelas X TKJ 3"). */
const KATA_PEMBUKA = /^(?:KELAS|ANGKATAN|TINGKAT|JURUSAN|SMK|SMA)\s+/;

/** Nama jurusan panjang → singkatan (dipakai hanya untuk menerjemahkan masukan). */
const JURUSAN_PANJANG: readonly (readonly [RegExp, string])[] = [
  [/REKAYASA\s+PERANGKAT\s+LUNAK/, 'RPL'],
  [/TEKNIK\s+KOMPUTER(?:\s+DAN)?\s+JARINGAN/, 'TKJ'],
  [/MANAJEMEN\s+PERKANTORAN/, 'MPK'],
  [/USAHA\s+LAYANAN\s+WISATA/, 'ULW'],
  [/BISNIS\s+DIGITAL/, 'BDG'],
  [/BISNIS\s+RETAIL/, 'BRT'],
  [/AKUNTANSI(?:\s+KEUANGAN(?:\s+DAN\s+LEMBAGA)?)?/, 'AKL'],
];

export interface ProfilDariMasukan {
  readonly nama: string;
  readonly tingkat: string;
  readonly jurusan: string | null;
  readonly subKelas: string | null;
  readonly labelKelas: string;
}

/** Pecah masukan menjadi `{ nama, kelas }` berdasarkan penanda kelas. */
export function pecahNamaKelas(masukan: string): { nama: string; kelas: string } | null {
  const teks = masukan.replace(/\s+/g, ' ').trim();
  if (!teks) return null;

  const hurufBesar = teks.toUpperCase();
  let indeksKelas = Number.POSITIVE_INFINITY;
  for (const penanda of PENANDA_KELAS) {
    const cocok = penanda.exec(hurufBesar);
    if (cocok && cocok.index < indeksKelas) indeksKelas = cocok.index;
  }

  // Tanpa penanda kelas, masukan tidak bisa diartikan (kelas wajib).
  if (!Number.isFinite(indeksKelas)) return null;

  const nama = teks.slice(0, indeksKelas).trim();
  const kelas = teks.slice(indeksKelas).trim();
  if (!nama || !kelas) return null;
  return { nama, kelas };
}

/**
 * Terjemahkan variasi penulisan kelas menjadi bentuk yang dimengerti kontrak:
 * "XI AKL 1" → "11 AKL 1", "kelas x TKJ 3" → "10 TKJ 3",
 * "X teknik komputer dan jaringan 2" → "10 TKJ 2".
 */
export function normalisasiKelas(kelas: string): string {
  let hasil = kelas.toUpperCase().replace(/\s+/g, ' ').trim();
  hasil = hasil.replace(KATA_PEMBUKA, '');

  const romawi = /^(XII|XI|X)\b/.exec(hasil);
  if (romawi?.[1]) {
    const angka = ROMAWI_KE_ANGKA[romawi[1]] ?? romawi[1];
    hasil = `${angka} ${hasil.slice(romawi[1].length).trim()}`.trim();
  }

  for (const [pola, kode] of JURUSAN_PANJANG) hasil = hasil.replace(pola, kode);
  return hasil;
}

/**
 * Ubah masukan "Nama Lengkap Kelas" menjadi profil terstruktur.
 * Mengembalikan null bila nama atau kelas tidak terbaca.
 */
export function profilDariMasukan(masukan: string): ProfilDariMasukan | null {
  const pecah = pecahNamaKelas(masukan);
  if (!pecah) return null;

  const nama = keTitleCase(pecah.nama);
  if (nama.length < 2) return null;

  const profil = normalisasiProfil(normalisasiKelas(pecah.kelas));
  return {
    nama,
    tingkat: profil.tingkat,
    jurusan: profil.jurusan,
    subKelas: profil.subKelas,
    labelKelas: labelKelas(profil),
  };
}
