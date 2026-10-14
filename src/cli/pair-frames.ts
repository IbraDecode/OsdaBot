/**
 * Pembacaan frame server saat pairing.
 *
 * Dipisah supaya bisa diuji tanpa menjalankan socket sungguhan.
 *
 * ── Bug yang sudah terjadi di sini ──────────────────────────────────────────
 *
 * Versi pertama memakai regex `/code="(\d{3})"/`. Tapi
 * `binaryNodeToString` dari Baileys mencetak atribut dengan **kutip tunggal**:
 *
 *     <error code='429' text='rate-overlimit'/>
 *
 * Regex itu tidak pernah cocok. Akibatnya: penolakan server tidak terbaca,
 * guard rate-limit tidak pernah aktif, dan daemon terus meminta kode pairing
 * berulang — memperpanjang blokir yang seharusnya membuatnya berhenti.
 *
 * Modul ini dibuat supaya format yang diterima bisa diuji terhadap output
 * API Baileys yang sungguhan, bukan tebakan.
 */

/** Ambil kode error dari teks frame, atau null. */
export function parseErrorCode(text: string): string | null {
  // Kutip tunggal — format asli Baileys.
  const tunggal = /code='(\d{3})'/.exec(text)
  if (tunggal) return tunggal[1]!

  // Kutip ganda tetap diterima untuk sumber lain.
  const ganda = /code="(\d{3})"/.exec(text)
  return ganda?.[1] ?? null
}

/** Penjelasan yang bisa ditindaklanjuti untuk tiap kode. */
export function describeErrorCode(code: string): string {
  const peta: Record<string, string> = {
    '400': 'bad-request — companion_platform_id salah, pairing DITOLAK',
    '404': 'not-found — nomor bot tidak dikenal server',
    '405': 'throttling — percobaan pairing dibatasi server',
    '429': 'rate-overlimit — percobaan pairing diblokir server',
  }
  return peta[code] ?? `server menolak (${code})`
}

/**
 * Apakah frame ini adalah blokir rate limit?
 *
 * Hanya `429`. `400` (bad-request) adalah masalah konfigurasi yang perlu
 * diperbaiki, bukan penanda untuk berhenti mencoba — meski keduanya sama
 *-sama tidak boleh di-retry berulang.
 */
export function isRateLimited(text: string): boolean {
  return parseErrorCode(text) === '429'
}

/**
 * Apakah frame ini layak ditampilkan ke operator?
 *
 * Ramping supaya log tidak penuh frame percakapan biasa.
 */
export function isPairingRelevant(text: string): boolean {
  return /pair-success|link_code|companion|bad-request|rate.?limit|error|conflict|40[045]|429/i.test(text)
}