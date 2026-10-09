/**
 * Inisiasi socket Baileys untuk OSDA Bot.
 *
 * Tanggung jawab modul ini HANYA lapisan transport WhatsApp:
 * - membuat socket & menyimpan kredensial (`creds.update` → saveCreds)
 * - menampilkan QR atau meminta kode pairing
 * - self-heal saat sesi ditolak (401/logout) + reconnect otomatis
 * - menyerahkan pesan masuk (grup maupun pribadi) ke handler router
 *
 * TIDAK ADA logika bisnis di sini. Semua keputusan (siapa pengguna, boleh
 * menjalankan perintah apa, isi balasan) ditangani router + OSDA API.
 */
import { isBoom } from '@hapi/boom';
import {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  type AnyMessageContent,
  type GroupMetadata,
  type WAMessage,
  type WASocket,
  type WAVersion,
} from '@whiskeysockets/baileys';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import QRCode from 'qrcode-terminal';

import { konfig } from '../config.js';
import { logger } from '../logger.js';
import { resetPetaLid } from './lidMapping.js';
import { perbaruiPetaLid } from './account.js';
import { wadahPesanMasuk, type PesanMasuk } from './account.js';

/** Handler pesan yang dipasang dari `main.ts` (arahnya ke router). */
export type HandlerPesan = (pesan: PesanMasuk) => void | Promise<void>;

/** Antarmuka logger minimal yang diminta Baileys. */
interface LoggerBaileys {
  level: string;
  child(obj: Record<string, unknown>): LoggerBaileys;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Adaptor pino → `ILogger` Baileys (tanpa `any`). */
const loggerBaileys: LoggerBaileys = {
  level: konfig.tingkatLog,
  child: (obj) => ({
    level: konfig.tingkatLog,
    child: () => loggerBaileys,
    trace: (o, m) => logger.trace(obj, m ?? String(o)),
    debug: (o, m) => logger.debug(obj, m ?? String(o)),
    info: (o, m) => logger.info(obj, m ?? String(o)),
    warn: (o, m) => logger.warn(obj, m ?? String(o)),
    error: (o, m) => logger.error(obj, m ?? String(o)),
  }),
  // Objek argumen Baileys (`o`) tidak dipakai; hanya pesan yang dicatat.
  trace: (_o, m) => logger.trace(m ?? ''),
  debug: (_o, m) => logger.debug(m ?? ''),
  info: (_o, m) => logger.info(m ?? ''),
  warn: (_o, m) => logger.warn(m ?? ''),
  error: (_o, m) => logger.error(m ?? ''),
};

const KODE_RESTART: readonly number[] = [
  DisconnectReason.restartRequired,
  DisconnectReason.connectionClosed,
  DisconnectReason.connectionReplaced,
  DisconnectReason.timedOut,
  DisconnectReason.connectionLost,
  DisconnectReason.badSession,
];

const COOLDOWN_KODE_MS = 45_000;
const JEDA_RESTART_MS = 3_000;
const MAKS_JEDA_RESTART_MS = 30_000;
const MAKS_SELF_HEAL = 3;

let sock: WASocket | null = null;
let handlerPesan: HandlerPesan | null = null;
let sedangStart = false;
let berhentiDiminta = false;
let urutanRestart = 0;
let jumlahSelfHeal = 0;
let kodeSudahDiminta = false;
let kodeTerakhirDiminta = 0;
let kodeKenaRateLimit = false;
let timerKodePairing: ReturnType<typeof setInterval> | null = null;
const timerTunda = new Set<ReturnType<typeof setTimeout>>();

function sediakanTimer(kembali: () => void, ms: number): void {
  const timer = setTimeout(() => {
    timerTunda.delete(timer);
    kembali();
  }, ms);
  timerTunda.add(timer);
}

function jeda(ms: number): Promise<void> {
  return new Promise<void>((selesai) => sediakanTimer(selesai, ms));
}

function hentikanTimerKode(): void {
  if (timerKodePairing) {
    clearInterval(timerKodePairing);
    timerKodePairing = null;
  }
}

export function setHandlerPesan(fn: HandlerPesan): void {
  handlerPesan = fn;
}

export function sedangTerhubung(): boolean {
  return sock !== null;
}

export function getSocket(): WASocket {
  if (!sock) throw new Error('Socket Baileys belum terhubung');
  return sock;
}

/** Folder sesi absolut (dipakai juga untuk membersihkan kredensial rusak). */
function folderSesi(): string {
  return resolve(process.cwd(), konfig.whatsappSesiDir);
}

/** Hapus kredensial sesi yang sudah tidak bisa dipakai WhatsApp. */
function bersihkanFolderSesi(): void {
  const dir = folderSesi();
  // Pengaman: jangan pernah menyentuh direktori akar.
  if (dir === '/' || dir.length < 4) {
    logger.error('Folder sesi tidak valid, dilewati: %s', dir);
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    logger.warn('Kredensial sesi lama dihapus: %s', dir);
  } catch (err) {
    logger.error({ err }, 'Gagal membersihkan folder sesi');
  }
}

/** Tampilkan QR di terminal (dipakai bila nomor pairing tidak diisi). */
function tampilkanQr(qr: string): void {
  // qrcode-terminal adalah paket CommonJS → dipakai lewat default import.
  QRCode.generate(qr, { small: true }, (kode) => {
    logger.info(
      '\n📢 Scan QR ini dengan WhatsApp > Perangkat Tertaut > Tautkan Perangkat:\n\n%s\n',
      kode,
    );
  });
}

/**
 * Minta kode pairing 8 digit.
 * Hanya diminta sekali per koneksi dan punya cooldown supaya server WA tidak
 * membalas 429 (rate-overlimit).
 */
async function mintaKodePairing(paksa = false): Promise<void> {
  const socket = sock;
  if (!socket || !konfig.whatsappNomor || kodeKenaRateLimit) return;

  const sekarang = Date.now();
  if (!paksa && sekarang - kodeTerakhirDiminta < COOLDOWN_KODE_MS) return;
  kodeTerakhirDiminta = sekarang;

  try {
    const kode = await socket.requestPairingCode(konfig.whatsappNomor);
    logger.info(
      '\n🔐 KODE PAIRING: %s\nMasukkan di WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon (nomor %s)\n',
      kode,
      konfig.whatsappNomor,
    );
  } catch (err) {
    const status = isBoom(err) ? err.output.statusCode : undefined;
    const kenaLimit = status === 429 || (err as Error | undefined)?.message === 'rate-overlimit';
    if (kenaLimit) {
      kodeKenaRateLimit = true;
      logger.warn(
        { err },
        'Kode pairing kena rate limit (429). Berhenti meminta kode sampai bot direstart.',
      );
    } else {
      logger.error({ err }, 'Gagal meminta kode pairing');
    }
  }
}

/** Sesi ditolak server (401) — bersihkan kredensial lalu registrasi ulang. */
async function selfHealLogout(): Promise<void> {
  jumlahSelfHeal += 1;
  logger.warn({ percobaan: jumlahSelfHeal }, 'Sesi WhatsApp ditolak server (401/logout)');

  if (jumlahSelfHeal > MAKS_SELF_HEAL) {
    logger.error(
      'Batas self-heal 401 (%s kali) tercapai. Hentikan bot, hapus folder %s, lalu jalankan ulang untuk pairing baru.',
      MAKS_SELF_HEAL,
      folderSesi(),
    );
    return;
  }

  bersihkanFolderSesi();
  resetPetaLid();
  await jeda(5_000);
  if (!berhentiDiminta) await startWhatsapp();
}

/** Mulai (atau mulai ulang) koneksi WhatsApp. */
export async function startWhatsapp(): Promise<void> {
  if (!konfig.whatsappAktif) {
    logger.warn(
      'WHATSAPP_ENABLED=false — bot berjalan tanpa koneksi WhatsApp. Perintah tetap bisa diuji lewat API.',
    );
    return;
  }
  if (sedangStart) return;

  sedangStart = true;
  berhentiDiminta = false;
  kodeSudahDiminta = false;
  kodeTerakhirDiminta = 0;
  kodeKenaRateLimit = false;

  try {
    mkdirSync(folderSesi(), { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(folderSesi());

    let versi: WAVersion | undefined;
    try {
      const hasil = await fetchLatestWaWebVersion();
      if (hasil.version) {
        versi = hasil.version;
        logger.info(
          `Versi WA Web ${versi.join('.')}${hasil.isLatest ? '' : ' (bukan terbaru)'}`,
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Gagal mengambil versi WA Web; memakai versi bawaan Baileys');
    }

    // OS & browser harus nama canonical (Linux/Chrome): WhatsApp menolak
    // pairing bila browser[0] bukan nama OS yang dikenal.
    sock = makeWASocket({
      version: versi,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, loggerBaileys) },
      logger: loggerBaileys,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      browser: ['Linux', 'Chrome', '1.0.0'],
      getMessage: async () => undefined,
      cachedGroupMetadata: async (jid) => (await metadataGrup(jid)) ?? undefined,
    });

    // Simpan kredensial setiap ada perubahan (wajib, jangan pernah dilewat).
    sock.ev.on('creds.update', saveCreds);

    // Mapping LID → PN dari sinkronisasi kontak/chat WhatsApp.
    sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
      if (lid && pn) perbaruiPetaLid(lid, pn);
    });

    // Pesan masuk (grup & pribadi) → router. Handler dipasang ulang setiap
    // socket baru karena event emitter Baileys ikut mati saat reconnect.
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const pesan of messages) {
        const wadah = wadahPesanMasuk(pesan);
        if (!wadah) continue;
        Promise.resolve(handlerPesan?.(wadah)).catch((err: unknown) =>
          logger.error({ err, id: wadah.id }, 'Handler pesan gagal'),
        );
      }
    });

    sock.ev.on('connection.update', async (perubahan) => {
      const { connection, lastDisconnect, qr } = perubahan;
      // Baileys membungkus galat koneksi sebagai Boom; ambil status HTTP-nya.
      const kodeStatus = isBoom(lastDisconnect?.error)
        ? lastDisconnect?.error.output.statusCode
        : undefined;

      if (qr) {
        if (konfig.whatsappNomor && !state.creds.registered && !kodeSudahDiminta) {
          kodeSudahDiminta = true;
          await mintaKodePairing(true);
        } else {
          tampilkanQr(qr);
        }
      }

      if (connection === 'open') {
        urutanRestart = 0;
        jumlahSelfHeal = 0;
        logger.info('WhatsApp terhubung sebagai %s', sock?.user?.id ?? '?');
        hentikanTimerKode();
        // Selama belum ter-link, segarkan kode pairing berkala (cooldown).
        timerKodePairing = setInterval(() => {
          if (berhentiDiminta || state.creds.registered) {
            hentikanTimerKode();
            return;
          }
          void mintaKodePairing();
        }, COOLDOWN_KODE_MS);
      }

      if (connection === 'close') {
        logger.warn({ kode: kodeStatus }, 'Koneksi WhatsApp tertutup');
        hentikanTimerKode();
        sock = null;

        if (kodeStatus === DisconnectReason.loggedOut) {
          await selfHealLogout();
          return;
        }

        if (kodeStatus === DisconnectReason.forbidden || kodeStatus === 503) {
          // Akses ditolak server: jeda panjang supaya tidak membebani server.
          logger.warn('WhatsApp menolak koneksi (kode %s); coba lagi nanti', kodeStatus);
          await jeda(MAKS_JEDA_RESTART_MS);
          if (!berhentiDiminta) await startWhatsapp();
          return;
        }

        urutanRestart += 1;
        const jedaLewat = Math.min(JEDA_RESTART_MS * urutanRestart, MAKS_JEDA_RESTART_MS);
        if (kodeStatus !== undefined && !KODE_RESTART.includes(kodeStatus)) {
          logger.warn(
            { kode: kodeStatus },
            'Kode penutupan tidak dikenal; tetap dicoba lagi (backoff %s ms)',
            jedaLewat,
          );
        }
        await jeda(jedaLewat);
        if (!berhentiDiminta) await startWhatsapp();
      }
    });

    logger.info(
      'Socket Baileys dibuat (sesi: %s, pairing nomor: %s)',
      folderSesi(),
      konfig.whatsappNomor || '—',
    );
  } catch (err) {
    logger.error({ err }, 'Gagal memulai koneksi WhatsApp');
    await jeda(JEDA_RESTART_MS);
    if (!berhentiDiminta) await startWhatsapp();
  } finally {
    sedangStart = false;
  }
}

/** Tutup koneksi dengan aman (dipakai saat SIGINT/SIGTERM). */
export async function stopWhatsapp(): Promise<void> {
  berhentiDiminta = true;
  hentikanTimerKode();
  for (const timer of timerTunda) clearTimeout(timer);
  timerTunda.clear();

  if (sock) {
    logger.info('Menutup koneksi WhatsApp...');
    try {
      await sock.end(undefined);
    } catch {
      // abaikan error penutupan
    }
    sock = null;
    logger.info('Koneksi WhatsApp ditutup');
  }
}

/** Kirim pesan teks ke sebuah JID. */
export async function kirimTeks(jid: string, teks: string): Promise<void> {
  await kirimPesan(jid, { text: teks });
}

/** Kirim pesan dengan konten Baileys apa pun. */
export async function kirimPesan(jid: string, isi: AnyMessageContent): Promise<void> {
  if (!sock) {
    logger.warn({ jid }, 'WhatsApp belum terhubung; pesan tidak terkirim');
    return;
  }
  try {
    await sock.sendMessage(jid, isi);
  } catch (err) {
    logger.error({ err, jid }, 'Gagal mengirim pesan WhatsApp');
  }
}

/** Kirim pesan dengan mention (daftar JID). */
export async function kirimMention(
  jid: string,
  teks: string,
  mentions: readonly string[],
): Promise<void> {
  await kirimPesan(jid, { text: teks, mentions: [...mentions] });
}

// ---- Metadata grup (cache singkat untuk menghindari rate limit) --------
const cacheGrup = new Map<string, { meta: GroupMetadata; at: number }>();
const TTL_CACHE_GRUP_MS = 5 * 60 * 1000;

export async function metadataGrup(jid: string): Promise<GroupMetadata | null> {
  const kunci = jid.split('@')[0] ?? jid;
  const cache = cacheGrup.get(kunci);
  if (cache && Date.now() - cache.at < TTL_CACHE_GRUP_MS) return cache.meta;

  const socket = sock;
  if (!socket) return null;
  try {
    const meta = await socket.groupMetadata(jid);
    if (!meta) return null;
    cacheGrup.set(kunci, { meta, at: Date.now() });
    return meta;
  } catch {
    return null;
  }
}

/** Status ringkas untuk log heartbeat. */
export function statusKoneksi(): { terhubung: boolean; folderSesi: string; sesiAda: boolean } {
  return {
    terhubung: sock !== null,
    folderSesi: folderSesi(),
    sesiAda: existsSync(folderSesi()),
  };
}

export type { WAMessage };
