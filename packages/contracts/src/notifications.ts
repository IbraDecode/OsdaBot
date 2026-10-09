/**
 * Kontrak notifikasi & dasbor.
 * Re-export dari communications agar penyebutan modul tetap ringkas.
 */
export type {
  Notifikasi,
  RingkasanNotifikasi,
  StatistikKomunikasi,
  Pengumuman,
  Kampanye,
  PengirimanPengumuman,
} from './communications.js';

export {
  SkemaFilterNotifikasi,
  SkemaBuatPengumuman,
  SkemaPerbaruiPengumuman,
  SkemaPutuskanPengumuman,
  SkemaTerbitkan,
  SkemaBuatKampanye,
  SkemaFilterPengumuman,
} from './communications.js';
