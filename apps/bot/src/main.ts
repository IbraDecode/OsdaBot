/**
 * OSDA Bot v2 — titik masuk aplikasi.
 *
 * Tanggung jawab berkas ini hanya:
 * 1. membaca konfigurasi (`.env`)
 * 2. memastikan OSDA API bisa dihubungi (boleh gagal, boot tetap lanjut)
 * 3. menghidupkan koneksi WhatsApp bila `WHATSAPP_ENABLED=true`
 * 4. memasang handler pesan → Command Router
 * 5. menghidupkan notifier (opsional)
 * 6. tetap hidup & graceful walau WhatsApp nonaktif
 *
 * Bila `WHATSAPP_ENABLED=false`, bot TIDAK menghubungi server WhatsApp sama
 * sekali; ia hanya jalan sebagai proses penganggur (heartbeat) supaya bisa
 * dipakai untuk uji integrasi API dan tidak dianggap gagal oleh PM2.
 */
import { startWhatsapp, statusKoneksi, stopWhatsapp, setHandlerPesan } from './whatsapp/baileys.js';
import { onPesanMasuk, daftarPerintahPengurus } from './router.js';
import { periksaApi } from './api/client.js';
import { konfig } from './config.js';
import { loggerModul } from './logger.js';
import { hentikanNotifier, mulaiNotifier, statusNotifier } from './services/whatsapp-notifier.js';
import { statistikCacheIdentitas } from './services/identity-resolver.js';
import { jamSekarang, tanggalHariIni } from './util/waktu.js';

const log = loggerModul('main');

/** Interval heartbeat agar proses tetap hidup & statusnya tercatat di log. */
const INTERVAL_HEARTBEAT_MS = 60_000;

let timerHeartbeat: ReturnType<typeof setInterval> | null = null;
let sedangMematikan = false;

/** Log ringkas kondisi bot (dipakai heartbeat & shutdown). */
function catatStatus(): void {
  log.debug(
    {
      whatsapp: statusKoneksi(),
      notifikasi: statusNotifier(),
      cacheIdentitas: statistikCacheIdentitas(),
      waktu: `${tanggalHariIni()} ${jamSekarang()}`,
    },
    'Status bot',
  );
}

/** Matikan seluruh komponen dengan rapi (SIGINT/SIGTERM). */
async function matikanBot(sinyal: string): Promise<void> {
  if (sedangMematikan) return;
  sedangMematikan = true;

  log.info({ sinyal }, 'Mematikan bot...');
  if (timerHeartbeat) {
    clearInterval(timerHeartbeat);
    timerHeartbeat = null;
  }
  hentikanNotifier();
  await stopWhatsapp();
  log.info('Bot berhenti dengan aman');
  process.exit(0);
}

async function utama(): Promise<void> {
  log.info(
    {
      lingkungan: konfig.lingkungan,
      apiUrl: konfig.apiUrl,
      whatsappAktif: konfig.whatsappAktif,
      perintahPengurus: daftarPerintahPengurus(),
    },
    'OSDA Bot v2 dimulai',
  );

  if (!konfig.apiTokenBot) {
    log.warn('API_BOT_TOKEN belum diatur — permintaan ke OSDA API akan ditolak (401)');
  }
  await periksaApi();

  if (konfig.whatsappAktif) {
    // Handler pesan dipasang sebelum socket dibuat agar tidak ada pesan yang
    // terlewat saat koneksi pertama kali terbuka.
    setHandlerPesan((pesan) => onPesanMasuk(pesan));
    await startWhatsapp();
    if (konfig.notifikasiAktif) mulaiNotifier();
  } else {
    log.warn(
      'WHATSAPP_ENABLED=false — bot berjalan tanpa WhatsApp. Semua perintah bisnis tetap harus lewat OSDA API (%s).',
      konfig.apiUrl,
    );
  }

  // Heartbeat: menjaga proses hidup (terutama saat WhatsApp nonaktif) dan
  // mencatat kondisi berkala untuk diagnosa.
  timerHeartbeat = setInterval(() => {
    catatStatus();
  }, INTERVAL_HEARTBEAT_MS);
  catatStatus();

  process.on('SIGINT', () => void matikanBot('SIGINT'));
  process.on('SIGTERM', () => void matikanBot('SIGTERM'));

  process.on('unhandledRejection', (alasan) => {
    log.error({ alasan }, 'Promise tanpa penanganan galat');
  });
  process.on('uncaughtException', (galat) => {
    log.error({ galat }, 'Eksepsi tanpa penanganan — proses akan ditutup agar PM2 menghidupkan ulang');
    void matikanBot('uncaughtException');
  });
}

void utama();
