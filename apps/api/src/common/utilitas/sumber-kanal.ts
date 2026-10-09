/**
 * Penentuan sumber (kanal) sebuah permintaan.
 *
 *_absensi_ dan audit WAJIB tahu apakah aksi berasal dari Web, Mobile, atau
 * WhatsApp — bukan selalu "Web". Tanpa ini, absensi yang dikirim lewat
 * WhatsApp akan tercatat seolah berasal dari Web dan laporan menjadi tidak
 * dapat dipercaya (spesifikasi §13, §93.5).
 *
 * Cara menentukan, berurutan:
 *  1. Header `x-osda-sumber` — dipakai client resmi (Web, Mobile, Bot).
 *  2. USER_AGENT — untuk client yang tidak memasang header.
 *  3. Bawaan `WEB`.
 *
 * CATATAN KEAMANAN: nilai header TIDAK dipakai untuk keputusan otorisasi —
 * hanya sebagai label pada laporan dan rekap. Nilai di luar daftar yang
 * diizinkan jatuh ke bawaan, bukan diterima apa adanya.
 */
import type { SumberAbsensi } from '@osda/contracts';

/** Header yang dipakai client resmi untuk menyebut kanalnya. */
export const HEADER_SUMBER = 'x-osda-sumber';

/** Daftar kanal yang sah. Nilai lain diabaikan. */
const SUMBER_SAH: readonly SumberAbsensi[] = ['WEB', 'MOBILE', 'WHATSAPP', 'ADMIN', 'QR'];

/** Sumber default bila tidak ada petunjuk sama sekali. */
const SUMBER_BAWAAN: SumberAbsensi = 'WEB';

/** Bentuk minimum permintaan HTTP. */
interface PermintaanDenganHeader {
  headers?: Record<string, string | string[] | undefined>;
  user?: { perms?: readonly string[] };
  pengguna?: { perms?: readonly string[] };
}

/** Baca satu header dengan mengabaikan perbedaan huruf besar-kecil. */
function bacaHeader(permintaan: PermintaanDenganHeader, nama: string): string | undefined {
  const headers = permintaan.headers ?? {};
  const nilai = headers[nama] ?? headers[nama.toUpperCase()];
  if (Array.isArray(nilai)) return nilai[0];
  return typeof nilai === 'string' && nilai.length > 0 ? nilai : undefined;
}

/** Tebak kanal dari USER_AGENT bila header tidak ada. */
function tebakDariUserAgent(permintaan: PermintaanDenganHeader): SumberAbsensi | null {
  const ua = bacaHeader(permintaan, 'user-agent')?.toLowerCase();
  if (!ua) return null;
  if (ua.includes('osda-bot') || ua.includes('whatsapp')) return 'WHATSAPP';
  if (ua.includes('expo') || ua.includes('okhttp') || ua.includes('react-native')) return 'MOBILE';
  return null;
}

/**
 * Tentukan sumber permintaan yang sah.
 *
 * @returns Satu dari WEB | MOBILE | WHATSAPP | ADMIN | QR.
 */
export function tentukanSumber(permintaan: PermintaanDenganHeader | undefined): SumberAbsensi {
  if (!permintaan) return SUMBER_BAWAAN;

  const dariHeader = bacaHeader(permintaan, HEADER_SUMBER)?.toUpperCase() as SumberAbsensi | undefined;
  if (dariHeader && SUMBER_SAH.includes(dariHeader)) return dariHeader;

  const dariUa = tebakDariUserAgent(permintaan);
  if (dariUa) return dariUa;

  return SUMBER_BAWAAN;
}

/**
 * Untuk modul yang hanya punya empat nilai (`SumberAudit` dari kontrak).
 * Pemetaan: WHATSAPP → WHATSAPP, sisanya → API.
 */
export function tentukanSumberAudit(
  permintaan: PermintaanDenganHeader | undefined,
): 'API' | 'WHATSAPP' {
  return tentukanSumber(permintaan) === 'WHATSAPP' ? 'WHATSAPP' : 'API';
}
