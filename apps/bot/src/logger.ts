/**
 * Logger terpusat OSDA Bot (pino).
 *
 * - Pengembangan: keluaran dipercantik oleh `pino-pretty`.
 * - Produksi: JSON satu baris per log supaya mudah dikumpulkan PM2/ELK.
 * - Logger ini juga dipakai sebagai `ILogger` Baileys melalui adaptor di
 *   `src/whatsapp/baileys.ts` (Baileys hanya butuh antarmuka kecil).
 */
import pino from 'pino';

import { konfig } from './config.js';

export const logger = pino({
  level: konfig.tingkatLog,
  base: { layanan: 'osda-bot' },
  formatters: {
    level: (label) => ({ tingkat: label }),
  },
  serializers: {
    // Error diubah menjadi objek ringkas yang tetap terbaca setelah log
    // dikumpulkan PM2/ELK (message & kode tidak ikut tersalin sebagai teks kosong).
    galat: (nilai: unknown) => {
      if (nilai instanceof Error) {
        const rinci = nilai as Error & { status?: number; kode?: string };
        return {
          nama: nilai.name,
          pesan: nilai.message,
          status: rinci.status,
          kode: rinci.kode,
        };
      }
      return nilai;
    },
  },
  transport: konfig.produksi
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname,layanan',
          messageFormat: '{msg}',
        },
      },
});

/** Logger dengan konteks tambahan (nama modul/pemanggil). */
export function loggerModul(modul: string): pino.Logger {
  return logger.child({ modul });
}
