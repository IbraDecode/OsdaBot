/**
 * Utilitas autentikasi OSDA.
 *
 * Berisi fungsi murni yang tidak bergantung pada NestJS maupun database,
 * sehingga dapat dipakai bersama oleh API, Bot, dan tooling migrasi.
 */

/** Kode acak untuk kode account linking & token sekali pakai. */
export function kodeAcak(panjang = 8): string {
  const abjad = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hasil = '';
  for (let i = 0; i < panjang; i += 1) {
    hasil += abjad[Math.floor(Math.random() * abjad.length)];
  }
  return hasil;
}

/** UUID acak (hex tanpa tanda hubung) untuk JTI & kunci idempotensi. */
export function uuidAcak(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Tanggal kedaluwarsa relatif terhadap sekarang. */
export function kedaluwarsaDari(milidetik: number, dari: Date = new Date()): Date {
  return new Date(dari.getTime() + milidetik);
}
