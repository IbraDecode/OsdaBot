/**
 * Konfigurasi Next.js untuk Dasbor OSDA.
 *
 * Catatan penting:
 *  - `@osda/contracts` dikirim sebagai sumber TypeScript (bukan hasil build),
 *    karena itu paketnya perlu ditranspilasi oleh Next/SWC.
 *  - Dasbor TIDAK pernah bicara ke database. Semua data berasal dari
 *    REST API OSDA yang alamatnya diambil dari `NEXT_PUBLIC_API_URL`.
 */
import type { NextConfig } from 'next';

const konfigurasi: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Paket workspace yang berisi TypeScript mentah wajib ditranspilasi.
  transpilePackages: ['@osda/contracts'],
};

export default konfigurasi;
