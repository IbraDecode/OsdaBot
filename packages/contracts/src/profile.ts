/**
 * Profil anggota — dipakai lintas client (Web, Mobile, Bot, PDF).
 *
 * Semua normalisasi nama/kelas/angkatan yang dulanya berada di logika bot
 * WhatsApp v0.4 dipusatkan di sini agar tidak ada duplikasi business logic
 * antar client.
 */

/** Tingkat kelas SMK/SMA. */
export const TINGKAT_KELAS = ['X', 'XI', 'XII'] as const;
export type TingkatKelas = (typeof TINGKAT_KELAS)[number];

/** Singkatan jurusan yang dipakai dalam pesan WhatsApp yang ringkas. */
export const SINGKATAN_JURUSAN: Readonly<Record<string, string>> = {
  TEKNIK_KOMPUTER_JARINGAN: 'TKJ',
  REKAYASA_PERANGKAT_LUNAK: 'RPL',
  AKUNTANSI: 'AKL',
  MULTIMEDIA: 'MPK',
  PEMELIHARAAN_JARANGAN: 'ULW',
  BANGUNAN_GEDUNG: 'BDG',
  BENGKEL: 'BRT',
  PERTUKARAN: 'PTK',
  OFFICE: 'OFC',
  PEMASARAN: 'PMR',
};

/** Peta tingkat kelas dari berbagai input pengguna (angka, romawi, kata). */
const PETA_ANGKATAN: Readonly<Record<string, TingkatKelas>> = {
  '10': 'X',
  X: 'X',
  '11': 'XI',
  XI: 'XI',
  '12': 'XII',
  XII: 'XII',
};

/** Kata yang menandai awal/jenis kelas, dibuang dari nama. */
const KATA_KELAS = /\b(10|11|12|kelas|angkatan|tingkat|jurusan|smk|sma)\b/gi;

export interface ProfilKarang {
  readonly nama: string;
  readonly tingkat: TingkatKelas;
  readonly jurusan: string | null;
  readonly subKelas: string | null;
}

/**
 * Ubah teks bebas menjadi Title Case yang rapi.
 * "favian  rapha" → "Favian Rapha". Kata sambung tidak dikapitalkan.
 */
export function keTitleCase(teks: string): string {
  const kataSambung = new Set(['bin', 'binti', 'dan', 'dari', 'ke', 'di', 'van', 'de']);
  return teks
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((kata, indeks) => {
      const k = kata.toLowerCase();
      if (indeks > 0 && kataSambung.has(k)) return k;
      return k.charAt(0).toUpperCase() + k.slice(1);
    })
    .join(' ');
}

/** Pecah masukan "DAFTAR" menjadi bagian: [tingkat, jurusan, subKelas, ...nama]. */
function pecahMasukan(masukan: string): {
  tingkat: TingkatKelas;
  jurusan: string | null;
  subKelas: string | null;
  sisa: string;
} {
  let sisa = masukan.replace(/\s+/g, ' ').trim();
  let tingkat: TingkatKelas = 'X';
  let jurusan: string | null = null;
  let subKelas: string | null = null;

  // 1. Tingkat kelas: 10/11/12 atau X/XI/XII (di awal masukan)
  const cocokAngkatan = sisa.match(/^(\d{1,2}|x{1,3})\b/i);
  const kunciAngkatan = cocokAngkatan?.[1];
  const hasilAngkatan = kunciAngkatan ? PETA_ANGKATAN[kunciAngkatan.toUpperCase()] : undefined;
  if (cocokAngkatan && hasilAngkatan) {
    tingkat = hasilAngkatan;
    sisa = sisa.slice(cocokAngkatan[0].length).trim();
  }

  // 2. Jurusan: 2-6 huruf pada posisi berikutnya, boleh diikuti nomor sub-kelas
  const cocokJurusan = sisa.match(/^([A-Za-z]{2,6})\b/);
  const kandidatJurusan = cocokJurusan?.[1]?.toUpperCase();
  if (cocokJurusan && kandidatJurusan) {
    const ditemukan = Object.entries(SINGKATAN_JURUSAN).find(([, v]) => v === kandidatJurusan);
    if (ditemukan) {
      jurusan = ditemukan[1];
      sisa = sisa.slice(cocokJurusan[0].length).trim();
    } else if (kandidatJurusan.length >= 2 && kandidatJurusan.length <= 4) {
      jurusan = kandidatJurusan;
      sisa = sisa.slice(cocokJurusan[0].length).trim();
    }
  }

  // 3. Sub-kelas: satu angka. Tanpa nomor → default "1" (atur v0.4)
  const cocokSub = sisa.match(/^(\d)\b/);
  subKelas = cocokSub?.[1] ?? '1';
  if (cocokSub) sisa = sisa.slice(cocokSub[0].length).trim();

  return { tingkat, jurusan, subKelas, sisa };
}

/**
 * Normalisasi input "DAFTAR" versi v0.4 menjadi profil terstruktur.
 * Seluruh aturan ini dipindahkan dari `src/services/registration.ts` bot lama
 * agar Web/Mobile/Bot menghasilkan data yang identik.
 *
 * Contoh masukan: "10 rpl 2Muhammad Ibra Decode"
 * Keluaran: { nama: 'Muhammad Ibra Decode', tingkat: 'X', jurusan: 'RPL', subKelas: '2' }
 */
export function normalisasiProfil(masukan: string): ProfilKarang {
  const teks = masukan.replace(/\s+/g, ' ').trim();
  const { tingkat, jurusan, subKelas, sisa } = pecahMasukan(teks);

  // Nama: buang sisa penanda kelas/k 편안, sisakan yang tampak seperti nama orang.
  const nama = keTitleCase(sisa.replace(KATA_KELAS, ' ').replace(/\s+/g, ' ').trim());

  return {
    nama: nama || keTitleCase(teks),
    tingkat,
    jurusan,
    subKelas,
  };
}

/** Susun label kelas ringkas: "X RPL 2". */
export function labelKelas(p: {
  tingkat: string;
  jurusan?: string | null;
  subKelas?: string | null;
}): string {
  return [p.tingkat, p.jurusan, p.subKelas].filter(Boolean).join(' ').trim();
}
