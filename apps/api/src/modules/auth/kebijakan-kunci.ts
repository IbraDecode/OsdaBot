/**
 * KEBIJAKAN PENGUNCIAN AKUN.
 *
 * Kolom `gagal_login_berurut` dan `dikunci_sampai` sudah ada di skema, tetapi
 * tanpa kebijakan ini keduanya hanya ditulis dan tidak pernah dibaca — sehingga
 * tcpdump/tetangga API bisa menebak kata sandi tanpa batas percobaan.
 *
 * Cara kerjanya: setiap kegagalan menambah satu hitungan. Setelah mencapai
 * `BATAS_GAGAL`, akun dikunci selama `KUNCI_MENIT` menit. Setiap kegagalan
 * berikutnya di dalam masa kunci memperpanjang kunci secara berlipat, sehingga
 * serangan otomatis langsung terhenti.
 *
 * Konstan ini sengaja di sini (bukan di kontrak) karena murni kebijakan
 * keamanan API, bukan aturan domain yang perlu dibagi ke semua client.
 */

/** Jumlah kegagalan berturut-turut sebelum akun dikunci. */
export const BATAS_GAGAL = 5;

/** Durasi penguncian dasar, dalam menit. */
export const KUNCI_MENIT = 15;

/** Batas perpanjangan kunci, dalam menit. */
export const KUNCI_MAKS_MENIT = 24 * 60;

/** Jumlah kegagalan yang dicatat ke database dalam satu permintaan. */
export const CATAT_GAGAL = 5;

/**
 * Berapa lama akun harus dikunci lagi setelah `gagal` kegagalan.
 *
 * Lama penguncian berlipat setiap kali dibatasi, dibatasi maximum
 * {@link KUNCI_MAKS_MENIT} supaya Eventually terkunci selamanya.
 *
 * @param gagal - Jumlah kegagalan berurutan SETELAH yang satu ini.
 * @returns Durasi dalam menit.
 */
export function menitKunci(gagal: number): number {
  const tingkat = Math.floor(Math.max(0, gagal) / BATAS_GAGAL);
  if (tingkat < 1) return 0;
  return Math.min(KUNCI_MAKS_MENIT, KUNCI_MENIT * 2 ** (tingkat - 1));
}

/**
 * Apakah akun sedang dalam masa penguncian.
 *
 * @param dikunciSampai - Nilai kolom `users.dikunci_sampai` (bisa null).
 * @param sekarang - Waktu acuan.
 * @returns true bila masih terkunci.
 */
export function sedangDikunci(
  dikunciSampai: Date | string | null | undefined,
  sekarang = new Date(),
): boolean {
  const waktu = keWaktu(dikunciSampai);
  return waktu !== null && waktu.getTime() > sekarang.getTime();
}

/**
 * Berapa detik lagi akun terbuka — untuk pesan galat yang membantu.
 *
 * @returns Detik tersisa; 0 bila tidak terkunci.
 */
export function detikTersisa(
  dikunciSampai: Date | string | null | undefined,
  sekarang = new Date(),
): number {
  const waktu = keWaktu(dikunciSampai);
  if (waktu === null) return 0;
  return Math.max(0, Math.ceil((waktu.getTime() - sekarang.getTime()) / 1000));
}

/** Ubah nilai kolom (Date atau string) menjadi Date, atau null bila kosong. */
function keWaktu(nilai: Date | string | null | undefined): Date | null {
  if (!nilai) return null;
  const waktu = nilai instanceof Date ? nilai : new Date(nilai);
  return Number.isNaN(waktu.getTime()) ? null : waktu;
}