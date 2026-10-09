/**
 * Konfigurasi terpusat OSDA Bot.
 *
 * Aturan:
 * 1. Seluruh nilai dibaca dari environment (berkas `.env`), TIDAK PERNAH
 *    ditulis langsung di kode — terutama token dan nomor bot.
 * 2. Berkas `.env` dicari berurutan: direktori kerja → direktori paket bot →
 *    akar monorepo. Nilai yang sudah ada di environment (mis. dari PM2 atau
 *    shell) selalu menang atas isi berkas.
 * 3. Parser `.env` sengaja ditulis sendiri (tanpa dependensi) agar bot tetap
 *    ringan; cukup untuk format `KUNCI=nilai`, komentar `#`, dan kutip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIREKTORI_PAKET = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Berkas `.env` yang mungkin dipakai, urut dari yang paling spesifik. */
function kandidatEnv(): string[] {
  return [
    resolve(process.cwd(), '.env'),
    resolve(DIREKTORI_PAKET, '.env'),
    resolve(DIREKTORI_PAKET, '..', '..', '.env'),
  ];
}

/** Buang komentar dan spasi di tepi sebuah baris `.env`. */
function bersihkanBaris(baris: string): string {
  const tanpaKomentar = baris.replace(/\s+#.*$/, '').trim();
  return tanpaKomentar.startsWith('export ')
    ? tanpaKomentar.slice('export '.length)
    : tanpaKomentar;
}

/**
 * Parser `.env` minimalis: `KUNCI=nilai`, kutip tunggal/ganda dibuang.
 * Tidak menimpa variabel yang sudah ada di environment.
 */
function muatEnv(): void {
  for (const berkas of kandidatEnv()) {
    if (!existsSync(berkas)) continue;
    let isi = '';
    try {
      isi = readFileSync(berkas, 'utf8');
    } catch {
      continue; // berkas tidak bisa dibaca, lanjut ke kandidat berikutnya
    }
    for (const barisMentah of isi.split(/\r?\n/)) {
      const baris = bersihkanBaris(barisMentah);
      if (!baris || baris.startsWith('#')) continue;
      const posisiSama = baris.indexOf('=');
      if (posisiSama <= 0) continue;
      const kunci = baris.slice(0, posisiSama).trim();
      let nilai = baris.slice(posisiSama + 1).trim();
      if (
        (nilai.startsWith('"') && nilai.endsWith('"')) ||
        (nilai.startsWith("'") && nilai.endsWith("'"))
      ) {
        nilai = nilai.slice(1, -1);
      }
      if (process.env[kunci] === undefined) process.env[kunci] = nilai;
    }
    return; // cukup satu berkas: yang paling spesifik
  }
}

function bacaBool(kunci: string, bawaan: boolean): boolean {
  const nilai = process.env[kunci];
  if (nilai === undefined || nilai === '') return bawaan;
  return ['1', 'true', 'ya', 'yes', 'on', 'aktif'].includes(nilai.toLowerCase());
}

function bacaAngka(kunci: string, bawaan: number): number {
  const nilai = Number(process.env[kunci]);
  return Number.isFinite(nilai) && nilai > 0 ? nilai : bawaan;
}

function bacaTeks(kunci: string, bawaan = ''): string {
  const nilai = process.env[kunci];
  return nilai === undefined ? bawaan : nilai.trim();
}

/**
 * Normalisasi nomor telepon ke format internasional tanpa tanda plus:
 * "0812-3456-7890" → "628123456789".
 */
export function normalisasiNomor(nomor: string): string {
  const angka = nomor.replace(/[^\d]/g, '');
  if (angka.startsWith('62')) return angka;
  if (angka.startsWith('0')) return `62${angka.slice(1)}`;
  if (angka.startsWith('8')) return `62${angka}`;
  return angka;
}

export interface KonfigurasiBot {
  readonly lingkungan: string;
  readonly produksi: boolean;

  readonly whatsappAktif: boolean;
  readonly whatsappNomor: string;
  readonly whatsappSesiDir: string;
  readonly whatsappQrTimeoutDetik: number;

  readonly apiUrl: string;
  readonly apiTokenBot: string;
  readonly apiTimeoutMs: number;
  readonly apiPercobaanUlang: number;

  readonly notifikasiAktif: boolean;
  readonly notifikasiIntervalMs: number;
  /** JID/nomor tujuan bila notifikasi tidak punya penerima spesifik. */
  readonly notifikasiKirimKe: string;

  readonly tingkatLog: string;
  readonly zonaWaktu: string;
}

export function bacaKonfigurasi(): KonfigurasiBot {
  muatEnv();

  const apiUrl = bacaTeks('API_URL', 'http://localhost:4000/api/v1').replace(/\/+$/, '');

  return {
    lingkungan: bacaTeks('NODE_ENV', 'development'),
    produksi: bacaTeks('NODE_ENV', 'development') === 'production',

    whatsappAktif: bacaBool('WHATSAPP_ENABLED', false),
    whatsappNomor: normalisasiNomor(bacaTeks('WHATSAPP_PHONE_NUMBER')),
    whatsappSesiDir: bacaTeks('WHATSAPP_SESSION_DIR', './whatsapp-session'),
    whatsappQrTimeoutDetik: bacaAngka('WHATSAPP_QR_TIMEOUT', 60),

    apiUrl,
    apiTokenBot: bacaTeks('API_BOT_TOKEN'),
    apiTimeoutMs: bacaAngka('API_TIMEOUT_MS', 10000),
    apiPercobaanUlang: bacaAngka('API_RETRY', 2),

    notifikasiAktif: bacaBool('NOTIFIKASI_AKTIF', true),
    notifikasiIntervalMs: bacaAngka('NOTIFIKASI_INTERVAL_MS', 60000),
    notifikasiKirimKe: bacaTeks('NOTIFIKASI_KIRIM_KE'),

    tingkatLog: bacaTeks('LOG_LEVEL', 'info').toLowerCase(),
    zonaWaktu: bacaTeks('TZ', 'Asia/Makassar'),
  };
}

/** Konfigurasi global yang dipakai seluruh modul bot. */
export const konfig = bacaKonfigurasi();
