/**
 * Klien API OSDA untuk Mobile.
 *
 * ATURAN KETAT (OWASP MASVS — Network & Storage):
 *  1. Token disimpan di `expo-secure-store` (Keychain / Android Keystore),
 *     BUKAN di AsyncStorage dan BUKAN di state yang ditulis ke log.
 *  2. Tidak ada secret yang di-hardcode. URL API datang dari konfigurasi.
 *  3. Setiap galat diterjemahkan menjadi pesan Bahasa Indonesia yang jelas,
 *     dan `requestId` disimpan agar bisa dicocokkan dengan log server.
 */
import type { HasilMasuk, ProfilPengguna } from '@osda/contracts';

/** URL dasar API. Diisi lewat `EXPO_PUBLIC_API_URL`. */
export const URL_API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Galat API yang sudah diterjemahkan. */
export class GalatApi extends Error {
  constructor(
    readonly kode: string,
    pesan: string,
    readonly requestId?: string,
  ) {
    super(pesan);
    this.name = 'GalatApi';
  }
}

/** Penyimpanan token yang aman (Keychain / Keystore). */
export const penyimpananAman = {
  async ambil(kunci: string): Promise<string | null> {
    try {
      const { getItemAsync } = await import('expo-secure-store');
      return await getItemAsync(kunci);
    } catch {
      return null;
    }
  },
  async simpan(kunci: string, nilai: string): Promise<void> {
    try {
      const { setItemAsync } = await import('expo-secure-store');
      await setItemAsync(kunci, nilai, {
        keychainAccessible: 0,
      });
    } catch {
      // Simpanan aman tidak tersedia (mis. di web). Abaikan agar app tetap jalan.
    }
  },
  async hapus(kunci: string): Promise<void> {
    try {
      const { deleteItemAsync } = await import('expo-secure-store');
      await deleteItemAsync(kunci);
    } catch {
      // Abaikan.
    }
  },
};

const KUNCI_AKSES = 'osda.token.akses';
const KUNCI_REFRESH = 'osda.token.refresh';

async function aksesToken(): Promise<string | null> {
  return penyimpananAman.ambil(KUNCI_AKSES);
}

/**
 * Panggil API OSDA.
 *
 * Otomatis memasang bearer token. Bila server membalas 401, coba segarkan
 * token satu kali lalu ulangi permintaan (mencegah logout mendadak).
 */
export async function panggil<T>(
  jalur: string,
  opsi: {
    metode?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    badan?: unknown;
    cobaSegarkan?: boolean;
  } = {},
): Promise<T> {
  const metode = opsi.metode ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const token = await aksesToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const respons = await fetch(`${URL_API}/api/v1${jalur}`, {
    method: metode,
    headers,
    body: opsi.badan === undefined ? undefined : JSON.stringify(opsi.badan),
  });

  if (respons.status === 401 && opsi.cobaSegarkan !== false) {
    const berhasil = await segarkanToken();
    if (berhasil) return panggil<T>(jalur, { ...opsi, cobaSegarkan: false });
  }

  if (respons.status === 204) return undefined as T;

  const teks = await respons.text();
  let data: unknown = null;
  try {
    data = teks ? JSON.parse(teks) : null;
  } catch {
    // Respons bukan JSON (mis. halaman galat). Perlakukan sebagai galat umum.
  }

  if (!respons.ok) {
    const galat = (data as { error?: { code?: string; message?: string; requestId?: string } })?.error;
    throw new GalatApi(
      galat?.code ?? 'INTERNAL_ERROR',
      galat?.message ?? `Permintaan gagal (HTTP ${respons.status}).`,
      galat?.requestId,
    );
  }

  return data as T;
}

/** Segarkan token akses memakai refresh token yang tersimpan. */
export async function segarkanToken(): Promise<boolean> {
  const refresh = await penyimpananAman.ambil(KUNCI_REFRESH);
  if (!refresh) return false;

  try {
    const respons = await fetch(`${URL_API}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!respons.ok) return false;
    const hasil = (await respons.json()) as { aksesToken: string; refreshToken: string };
    await penyimpananAman.simpan(KUNCI_AKSES, hasil.aksesToken);
    await penyimpananAman.simpan(KUNCI_REFRESH, hasil.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** Masuk dan simpan token di penyimpanan aman. */
export async function masuk(email: string, password: string): Promise<ProfilPengguna> {
  const hasil = await panggil<HasilMasuk>('/auth/login', {
    metode: 'POST',
    badan: { email, password },
    cobaSegarkan: false,
  });
  await penyimpananAman.simpan(KUNCI_AKSES, hasil.aksesToken);
  await penyimpananAman.simpan(KUNCI_REFRESH, hasil.refreshToken);
  return hasil.pengguna;
}

/** Keluar dan HAPUS token dari penyimpanan aman (pencabutan sesi). */
export async function keluar(): Promise<void> {
  await panggil('/auth/logout', { metode: 'POST', badan: {} }).catch(() => undefined);
  await penyimpananAman.hapus(KUNCI_AKSES);
  await penyimpananAman.hapus(KUNCI_REFRESH);
}

/** Ambil profil pengguna yang sedang login. */
export async function profil(): Promise<ProfilPengguna> {
  return panggil<ProfilPengguna>('/users/me');
}

/** True bila ada token tersimpan (belum tentu valid — endpoint yang memastikan). */
export async function sudahMasuk(): Promise<boolean> {
  return Boolean(await aksesToken());
}
