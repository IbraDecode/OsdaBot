/**
 * Klien HTTP tunggal untuk Dasbor OSDA (Web).
 *
 * ATURAN WAJIB (lihat AGENTS.md repo):
 *  1. Dasbor TIDAK PERNAH menyentuh database. Semua data lewat REST API OSDA.
 *  2. Setiap permintaan terautentikasi membawa header `Authorization: Bearer`.
 *  3. Access token yang kedaluwarsa (401) otomatis diperbarui lewat
 *     `POST /api/v1/auth/refresh` HANYA SATU KALI, lalu permintaan diulang.
 *  4. Galat dari API selalu berbentuk `{ error: { code, message, requestId } }`
 *     — di sini diterjemahkan menjadi pesan Bahasa Indonesia yang jelas.
 *  5. Otorisasi TIDAK ditegakkan di frontend. Pemeriksaan izin di UI hanya
 *     untuk menyembunyikan aksi (UX); backend tetap memutuskan.
 *
 * Token disimpan di `localStorage` dan dicerminkan ke cookie `osda.*` supaya
 * lapisan middleware/SSR dapat mendeteksi adanya sesi. Catatan produksi:
 * idealnya cookie bersifat `HttpOnly` dan diterbitkan server API.
 */
import type { BentukError, HasilMasuk, KodeError } from '@osda/contracts';

// ============================================================
// Konstanta penyimpanan token
// ============================================================

/** Kunci localStorage untuk access token (JWT pendek). */
export const KUNCI_AKSES = 'osda.akses';
/** Kunci localStorage untuk refresh token (rotasi setiap dipakai). */
export const KUNCI_SEGARKAN = 'osda.segarkan';
/** Nama cookie penanda sesi — hanya untuk middleware/SSR. */
export const NAMA_COOKIE_AKSES = 'osda.akses';
/** Nama cookie penanda "pengguna masih login". */
export const NAMA_COOKIE_SESI = 'osda.sesi';

// ============================================================
// Galat API → pesan UX Bahasa Indonesia
// ============================================================

/** Kode galat tambahan yang berasal dari klien, bukan dari API. */
export type KodeGalatKlien = 'GALAT_JARINGAN' | 'GALAT_TAK_DIKENAL';

/**
 * Terjemahan kode galat menjadi kalimat yang dipahami pengguna.
 * Kunci dibuat lengkap (`Record`) supaya kode baru dari kontrak langsung
 * terdeteksi oleh TypeScript saat build.
 */
const PESAN_PENGGUNA: Readonly<Record<KodeError, string>> = {
  VALIDATION_FAILED: 'Sebagian data yang dikirim belum benar. Periksa kembali isian Anda.',
  INVALID_STATE_TRANSITION: 'Perubahan status tidak diizinkan dari kondisi data saat ini.',
  DUPLICATE_RECORD: 'Data serupa sudah ada, sehingga penyimpanan dibatalkan.',
  UNAUTHENTICATED: 'Sesi Anda belum masuk atau sudah berakhir. Silakan masuk kembali.',
  INVALID_CREDENTIALS: 'Email atau kata sandi salah.',
  TOKEN_EXPIRED: 'Sesi Anda sudah berakhir. Silakan masuk kembali.',
  FORBIDDEN: 'Anda tidak memiliki akses ke bagian ini.',
  PERMISSION_DENIED: 'Anda tidak memiliki izin untuk melakukan tindakan ini.',
  OBJECT_ACCESS_DENIED: 'Anda hanya boleh mengakses data milik Anda sendiri.',
  SCOPE_DENIED: 'Cakupan akses Anda belum mencakup data ini.',
  NOT_FOUND: 'Data yang diminta tidak ditemukan.',
  CONFLICT: 'Data sudah berubah sejak terakhir dibuka. Muat ulang lalu coba lagi.',
  ATTENDANCE_ALREADY_RECORDED: 'Kehadiran untuk sesi ini sudah tercatat.',
  SESSION_CLOSED: 'Sesi absensi sudah ditutup.',
  SESSION_NOT_OPEN: 'Sesi absensi belum dibuka.',
  APPROVAL_ALREADY_RESOLVED: 'Permintaan persetujuan ini sudah diputuskan.',
  DOCUMENT_VERSION_IMMUTABLE: 'Versi dokumen yang sudah disetujui tidak dapat diubah.',
  LEDGER_IMMUTABLE: 'Catatan buku besar sudah final dan tidak dapat diubah.',
  PAYMENT_REQUIRED: 'Pembayaran diperlukan sebelum melanjutkan.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  INTERNAL_ERROR: 'Server OSDA mengalami gangguan. Coba lagi beberapa saat lagi.',
  INTEGRATION_UNAVAILABLE: 'Layanan pendukung sedang tidak tersedia.',
  STORAGE_UNAVAILABLE: 'Penyimpanan berkas sedang tidak tersedia.',
  PAYLOAD_TOO_LARGE: 'Berkas terlalu besar untuk diunggah.',
  UNSUPPORTED_FILE_TYPE: 'Jenis berkas ini tidak didukung.',
  UNPROCESSABLE: 'Permintaan tidak dapat diproses. Periksa kembali data Anda.',
};

/** Galat yang dilempar klien API dan dapat ditampilkan langsung ke pengguna. */
export class GalatApi extends Error {
  readonly kode: KodeError | KodeGalatKlien;
  /** Pesan asli dari server (untuk log/debug). */
  readonly pesanServer: string;
  /** Kode permintaan dari API — dibutuhkan saat melapor ke pengembang. */
  readonly kodePermintaan: string | null;
  readonly statusHttp: number | null;

  constructor(input: {
    readonly kode: KodeError | KodeGalatKlien;
    readonly pesanPengguna: string;
    readonly pesanServer: string;
    readonly kodePermintaan?: string | null;
    readonly statusHttp?: number | null;
  }) {
    super(input.pesanPengguna);
    this.name = 'GalatApi';
    this.kode = input.kode;
    this.pesanServer = input.pesanServer;
    this.kodePermintaan = input.kodePermintaan ?? null;
    this.statusHttp = input.statusHttp ?? null;
  }
}

/** Apakah nilai yang dilempar berasal dari {@link GalatApi}. */
export function adalahGalatApi(nilai: unknown): nilai is GalatApi {
  return nilai instanceof GalatApi;
}

/**
 * Ubah apa pun yang dilempar menjadi satu kalimat Bahasa Indonesia yang aman
 * ditampilkan di UI (dipakai blok `catch` pada seluruh halaman).
 */
export function pesanDariGalat(nilai: unknown): string {
  if (adalahGalatApi(nilai)) return nilai.message;
  if (nilai instanceof Error && nilai.message) return nilai.message;
  return 'Terjadi kesalahan yang tidak terduga. Silakan coba lagi.';
}

// ============================================================
// Penyimpanan token (localStorage + cookie)
// ============================================================

function dapatkanStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Mode privat Safari dapat menolak akses localStorage.
    return null;
  }
}

function tulisCookie(nama: string, nilai: string, maksUsiaDetik: number): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${nama}=${encodeURIComponent(nilai)}; Path=/; Max-Age=${maksUsiaDetik}; SameSite=Lax`;
}

function hapusCookie(nama: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${nama}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function bacaCookie(nama: string): string | null {
  if (typeof document === 'undefined') return null;
  const pasangan = document.cookie.split('; ').find((baris) => baris.startsWith(`${nama}=`));
  return pasangan ? decodeURIComponent(pasangan.slice(nama.length + 1)) : null;
}

/** Access token yang sedang dipakai (null bila pengguna belum masuk). */
export function ambilTokenAkses(): string | null {
  const storage = dapatkanStorage();
  const dariStorage = storage?.getItem(KUNCI_AKSES) ?? null;
  return dariStorage ?? bacaCookie(NAMA_COOKIE_AKSES);
}

/** Refresh token untuk memperbarui access token. */
export function ambilTokenSegarkan(): string | null {
  return dapatkanStorage()?.getItem(KUNCI_SEGARKAN) ?? null;
}

/** Apakah pengguna tampaknya sudah punya sesi (untuk redirect halaman masuk). */
export function adaSesi(): boolean {
  return ambilTokenAkses() !== null;
}

/** Simpan hasil masuk / hasil segarkan token ke penyimpanan klien. */
export function simpanSesi(sesi: HasilMasuk): void {
  const storage = dapatkanStorage();
  storage?.setItem(KUNCI_AKSES, sesi.aksesToken);
  storage?.setItem(KUNCI_SEGARKAN, sesi.refreshToken);

  // Cookie hanya penanda sesi; umurnya mengikuti `kedaluwarsaPada`.
  const sisaDetik = Math.max(
    60,
    Math.floor((new Date(sesi.kedaluwarsaPada).getTime() - Date.now()) / 1000),
  );
  tulisCookie(NAMA_COOKIE_AKSES, sesi.aksesToken, sisaDetik);
  tulisCookie(NAMA_COOKIE_SESI, '1', sisaDetik);
}

/** Hapus seluruh jejak sesi dari perangkat ini. */
export function bersihkanSesi(): void {
  const storage = dapatkanStorage();
  storage?.removeItem(KUNCI_AKSES);
  storage?.removeItem(KUNCI_SEGARKAN);
  hapusCookie(NAMA_COOKIE_AKSES);
  hapusCookie(NAMA_COOKIE_SESI);
}

// ============================================================
// Pembangunan permintaan
// ============================================================

/** Metode HTTP yang dipakai dasbor. */
export type MetodeHttp = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Nilai parameter kueri yang didukung pembangun URL. */
export type NilaiKueri = string | number | boolean | undefined | null;

export interface OpsiPermintaan {
  readonly metode?: MetodeHttp;
  /** Badan permintaan; objek biasa dikirim sebagai JSON. */
  readonly badan?: unknown;
  readonly kueri?: Readonly<Record<string, NilaiKueri>>;
  readonly sinyal?: AbortSignal;
  /** Lewati pemasangan header Authorization (dipakai endpoint publik). */
  readonly tanpaAuth?: boolean;
  /** Penanda internal: mencegah pengulangan tak terbatas saat refresh. */
  readonly sudahDiulang?: boolean;
}

/** Alamat dasar API OSDA. */
export const ALAMAT_API_DASAR: string =
  (typeof process === 'undefined' ? undefined : process.env.NEXT_PUBLIC_API_URL) ??
  'http://localhost:4000';

/** Gabungkan alamat dasar dengan jalur relatif (tanpa garis miring ganda). */
export function bangunUrl(jalur: string): string {
  return `${ALAMAT_API_DASAR.replace(/\/+$/, '')}${jalur.startsWith('/') ? jalur : `/${jalur}`}`;
}

/** Bangun URL lengkap termasuk parameter kueri (nilai kosong dibuang). */
export function bangunUrlDenganKueri(jalur: string, kueri?: OpsiPermintaan['kueri']): string {
  const url = bangunUrl(jalur);
  if (!kueri) return url;
  const parameter = new URLSearchParams();
  for (const [kunci, nilai] of Object.entries(kueri)) {
    if (nilai === undefined || nilai === null || nilai === '') continue;
    parameter.set(kunci, String(nilai));
  }
  const teks = parameter.toString();
  return teks ? `${url}?${teks}` : url;
}

/** Type guard untuk bentuk galat standar OSDA. */
function sudahBentukError(nilai: unknown): nilai is BentukError {
  if (typeof nilai !== 'object' || nilai === null) return false;
  const kandidat = (nilai as { error?: unknown }).error;
  if (typeof kandidat !== 'object' || kandidat === null) return false;
  const { code, message, requestId } = kandidat as {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
  };
  return typeof code === 'string' && typeof message === 'string' && typeof requestId === 'string';
}

/** Ubah badan galat dari API menjadi {@link GalatApi} yang siap ditampilkan. */
function galatDariBadan(badan: unknown, statusHttp: number): GalatApi {
  if (sudahBentukError(badan)) {
    const pesan = PESAN_PENGGUNA[badan.error.code] ?? badan.error.message;
    return new GalatApi({
      kode: badan.error.code,
      pesanPengguna: pesan,
      pesanServer: badan.error.message,
      kodePermintaan: badan.error.requestId,
      statusHttp,
    });
  }
  return new GalatApi({
    kode: 'GALAT_TAK_DIKENAL',
    pesanPengguna: `Permintaan gagal (HTTP ${statusHttp}). Silakan coba lagi.`,
    pesanServer: typeof badan === 'string' ? badan.slice(0, 500) : JSON.stringify(badan).slice(0, 500),
    statusHttp,
  });
}

// ============================================================
// Refresh token (single-flight)
// ============================================================

let prosesSegarkan: Promise<boolean> | null = null;

/**
 * Perbarui access token memakai refresh token.
 * Permintaan bersamaan hanya memicu SATU panggilan refresh.
 * Mengembalikan `false` bila sesi sudah tidak dapat dipakai.
 */
async function segarkanToken(): Promise<boolean> {
  const tokenSegarkan = ambilTokenSegarkan();
  if (!tokenSegarkan) return false;
  if (prosesSegarkan) return prosesSegarkan;

  prosesSegarkan = (async (): Promise<boolean> => {
    try {
      const balasan = await fetch(bangunUrl('/api/v1/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: tokenSegarkan }),
      });
      if (!balasan.ok) {
        bersihkanSesi();
        return false;
      }
      const hasil = (await balasan.json()) as HasilMasuk;
      simpanSesi(hasil);
      return true;
    } catch {
      // Jaringan sedang bermasalah — jangan hapus sesi, coba lagi nanti.
      return false;
    } finally {
      prosesSegarkan = null;
    }
  })();

  return prosesSegarkan;
}

// ============================================================
// Inti permintaan
// ============================================================

async function bacaBalasan<T>(balasan: Response): Promise<T> {
  if (balasan.status === 204) return undefined as T;
  const teks = await balasan.text();
  if (!teks) return undefined as T;
  return JSON.parse(teks) as T;
}

async function kirimBalasanKeUnduhan(balasan: Response, namaBerkasCadangan: string): Promise<void> {
  const blob = await balasan.blob();
  const namaDariHeader = balasan.headers
    .get('content-disposition')
    ?.match(/filename="?([^"]+)"?/i)?.[1];
  const namaBerkas = namaDariHeader ?? namaBerkasCadangan;
  const tautan = document.createElement('a');
  tautan.href = URL.createObjectURL(blob);
  tautan.download = namaBerkas;
  document.body.appendChild(tautan);
  tautan.click();
  tautan.remove();
  URL.revokeObjectURL(tautan.href);
}

/**
 * Jalankan satu permintaan ke API OSDA.
 *
 * @throws {GalatApi} selalu dilempar sebagai GalatApi dengan pesan siap pakai.
 */
export async function minta<T>(jalur: string, opsi: OpsiPermintaan = {}): Promise<T> {
  const url = bangunUrlDenganKueri(jalur, opsi.kueri);

  const kepala: Record<string, string> = { Accept: 'application/json' };
  let badan: BodyInit | undefined;

  if (opsi.badan !== undefined && opsi.badan !== null) {
    if (opsi.badan instanceof FormData) {
      // Biarkan browser menetapkan Content-Type beserta boundary.
      badan = opsi.badan;
    } else {
      kepala['Content-Type'] = 'application/json';
      badan = JSON.stringify(opsi.badan);
    }
  }

  const token = ambilTokenAkses();
  if (token && !opsi.tanpaAuth) kepala.Authorization = `Bearer ${token}`;

  let balasan: Response;
  try {
    balasan = await fetch(url, {
      method: opsi.metode ?? 'GET',
      headers: kepala,
      body: badan,
      signal: opsi.sinyal,
    });
  } catch {
    throw new GalatApi({
      kode: 'GALAT_JARINGAN',
      pesanPengguna:
        'Tidak dapat menghubungi server OSDA. Periksa koneksi Anda, lalu coba lagi.',
      pesanServer: `Gagal fetch ke ${url}`,
    });
  }

  // 401 → coba segarkan token sekali, lalu ulang permintaan semula.
  if (balasan.status === 401 && !opsi.tanpaAuth && opsi.sudahDiulang !== true) {
    const berhasil = await segarkanToken();
    if (berhasil) {
      return minta<T>(jalur, { ...opsi, sudahDiulang: true });
    }
    bersihkanSesi();
    let isi: unknown = null;
    try {
      isi = await balasan.json();
    } catch {
      isi = null;
    }
    const galat = galatDariBadan(isi, 401);
    if (typeof window !== 'undefined') window.location.assign('/login');
    throw galat;
  }

  if (!balasan.ok) {
    let isi: unknown = null;
    try {
      isi = await balasan.json();
    } catch {
      isi = null;
    }
    throw galatDariBadan(isi, balasan.status);
  }

  return bacaBalasan<T>(balasan);
}

// ============================================================
// Pintasan (helpers) yang dipakai halaman-halaman
// ============================================================

export const api = {
  /** GET dengan parameter kueri opsional. */
  ambil<T>(jalur: string, kueri?: Readonly<Record<string, NilaiKueri>>): Promise<T> {
    return minta<T>(jalur, { metode: 'GET', kueri });
  },

  /** POST dengan badan opsional. */
  kirim<T>(jalur: string, badan?: unknown): Promise<T> {
    return minta<T>(jalur, { metode: 'POST', badan });
  },

  /** PATCH dengan badan opsional. */
  ubah<T>(jalur: string, badan?: unknown): Promise<T> {
    return minta<T>(jalur, { metode: 'PATCH', badan });
  },

  /** DELETE. */
  hapus<T>(jalur: string): Promise<T> {
    return minta<T>(jalur, { metode: 'DELETE' });
  },

  /** Unduh berkas (CSV) dari API langsung ke perangkat pengguna. */
  async unduh(
    jalur: string,
    opsiUnduh: {
      readonly namaBerkas: string;
      readonly metode?: MetodeHttp;
      readonly badan?: unknown;
    },
  ): Promise<void> {
    const token = ambilTokenAkses();
    const kepala: Record<string, string> = { Accept: 'text/csv' };
    let badanTeks: string | undefined;
    if (token) kepala.Authorization = `Bearer ${token}`;
    if (opsiUnduh.badan !== undefined && opsiUnduh.badan !== null) {
      kepala['Content-Type'] = 'application/json';
      badanTeks = JSON.stringify(opsiUnduh.badan);
    }

    let balasan: Response;
    try {
      balasan = await fetch(bangunUrl(jalur), {
        method: opsiUnduh.metode ?? 'GET',
        headers: kepala,
        body: badanTeks,
      });
    } catch {
      throw new GalatApi({
        kode: 'GALAT_JARINGAN',
        pesanPengguna: 'Unduhan gagal karena koneksi bermasalah. Coba lagi.',
        pesanServer: `Gagal fetch ke ${jalur}`,
      });
    }

    if (!balasan.ok) {
      let isi: unknown = null;
      try {
        isi = await balasan.json();
      } catch {
        isi = null;
      }
      throw galatDariBadan(isi, balasan.status);
    }
    await kirimBalasanKeUnduhan(balasan, opsiUnduh.namaBerkas);
  },

  /** Masuk dengan email + kata sandi, lalu simpan token di perangkat. */
  async masuk(email: string, kataSandi: string): Promise<HasilMasuk> {
    const hasil = await minta<HasilMasuk>('/api/v1/auth/login', {
      metode: 'POST',
      tanpaAuth: true,
      badan: { email, password: kataSandi },
    });
    simpanSesi(hasil);
    return hasil;
  },

  /** Keluar dari sesi ini ( kegagalan jaringan diabaikan ). */
  async keluar(): Promise<void> {
    const tokenSegarkan = ambilTokenSegarkan();
    try {
      if (tokenSegarkan) {
        await minta<{ berhasil: boolean }>('/api/v1/auth/logout', {
          metode: 'POST',
          badan: { refreshToken: tokenSegarkan, semuaSesi: false },
        });
      }
    } catch {
      // Dicabut di sisi server atau tidak — sesi lokal tetap dibersihkan.
    } finally {
      bersihkanSesi();
    }
  },
};
