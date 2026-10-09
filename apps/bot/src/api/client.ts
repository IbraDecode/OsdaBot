/**
 * Client REST OSDA API — SATU-SATUNYA pintu bot ke data bisnis.
 *
 * Aturan arsitektur (spec §32):
 *   WhatsApp → Message Adapter → Identity Resolver → Command Router
 *            → API/Application Service → Domain → Database → Response
 *
 * Bot TIDAK PERNAH menyentuh tabel database, TIDAK PERNAH menulis SQL, dan
 * tidak memiliki driver database. Seluruh operasi bisnis lewat HTTP ke
 * `API_URL` (mis. http://localhost:4000/api/v1) dengan bearer token bot.
 *
 * Tanggung jawab modul ini:
 * - menyusun URL & query, menempel token, `X-OSDA-Sumber: WHATSAPP`
 * - timeout otomatis + retry (default 2x, hanya untuk error jaringan/5xx/429)
 * - mem-parse galat berbentuk `{ error: { code, message } }`
 * - membuka envelope `{ data: ... }` bila API memakainya
 */
import {
  type Anggota,
  type CatatanHadir,
  type Kas,
  type Notifikasi,
  type Program,
  type Rapat,
  type RekapAnggota,
  type RekapSesi,
  type RingkasanKeuangan,
  type SesiAbsensi,
  type StatusHadir,
  type Tugas,
} from '@osda/contracts';

import { konfig } from '../config.js';
import { logger } from '../logger.js';

// ============================================================
// Jalur (endpoint) OSDA API
// ============================================================

/**
 * Daftar jalur API yang dibutuhkan bot. Bila `apps/api` belum menyediakan
 * salah satunya, endpoint setara yang paling dekat dipakai (lihat README) —
 * jangan pernah menggantinya dengan query database langsung.
 */
export const JALUR = {
  KESEHATAN: '/health',
  /** Resolusi JID WhatsApp → member + peran/izin. */
  RESOLVE_IDENTITAS: '/identity/whatsapp/resolve',
  /** Pendaftaran anggota baru lewat WhatsApp (register + tautkan identity). */
  DAFTAR_WHATSAPP: '/identity/whatsapp/register',
  ANGGOTA: '/members',
  detailAnggota: (id: string): string => `/members/${id}`,
  SESI_ABSENSI: '/attendance/sessions',
  CATAT_HADIR: '/attendance/records',
  CATAT_HADIR_MANUAL: '/attendance/records/manual',
  rekapSesi: (id: string): string => `/attendance/sessions/${id}/recap`,
  rekapAnggota: (id: string): string => `/attendance/recap/member/${id}`,
  RAPAT: '/meetings',
  TUGAS: '/tasks',
  PROGRAM: '/programs',
  KAS: '/finance/cash',
  RINGKASAN_KEUANGAN: '/finance/summary',
  NOTIFIKASI: '/notifications',
} as const;

// ============================================================
// Kesalahan API
// ============================================================

/** Galat yang dilempar ketika OSDA API menolak/gagal melayani permintaan. */
export class KesalahanApi extends Error {
  readonly status: number;
  readonly kode: string;
  readonly detail: unknown;

  constructor(status: number, kode: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'KesalahanApi';
    this.status = status;
    this.kode = kode;
    this.detail = detail;
  }
}

/** Apakah galat ini menandakan sumber daya tidak ditemukan? */
export function apakahTidakDitemukan(galat: unknown): boolean {
  return galat instanceof KesalahanApi && galat.status === 404;
}

/** Apakah galat ini menandakan bot tidak berwenang (token salah/kadaluarsa)? */
export function apakahTidakBerwenang(galat: unknown): boolean {
  return galat instanceof KesalahanApi && (galat.status === 401 || galat.status === 403);
}

function kodeDariStatus(status: number): string {
  if (status === 400) return 'PERMINTAAN_TIDAK_VALID';
  if (status === 401) return 'TIDAK_TERAUTENTIKASI';
  if (status === 403) return 'DILARANG';
  if (status === 404) return 'TIDAK_DITEMUKAN';
  if (status === 409) return 'KONFLIK';
  if (status === 422) return 'DATA_TIDAK_VALID';
  if (status === 429) return 'TERLALU_BANYAK_PERMINTAAN';
  if (status >= 500) return 'GALAT_SERVER';
  return 'GALAT_API';
}

/** Ubah respons galat API menjadi `KesalahanApi` yang informatif. */
function keKesalahanApi(status: number, isi: unknown): KesalahanApi {
  const obj: Record<string, unknown> =
    typeof isi === 'object' && isi !== null ? (isi as Record<string, unknown>) : {};
  const galat = (obj.error ?? obj.galat) as unknown;

  if (typeof galat === 'string' && galat.length > 0) {
    return new KesalahanApi(status, kodeDariStatus(status), galat, isi);
  }

  if (typeof galat === 'object' && galat !== null) {
    const rinci = galat as Record<string, unknown>;
    const kode =
      (typeof rinci.code === 'string' && rinci.code) ||
      (typeof rinci.kode === 'string' && rinci.kode) ||
      kodeDariStatus(status);
    const pesan =
      (typeof rinci.message === 'string' && rinci.message) ||
      (typeof rinci.pesan === 'string' && rinci.pesan) ||
      `Permintaan ke OSDA API gagal (HTTP ${status})`;
    return new KesalahanApi(status, kode, pesan, rinci.detail ?? isi);
  }

  if (typeof obj.message === 'string' && obj.message.length > 0) {
    return new KesalahanApi(status, kodeDariStatus(status), obj.message, isi);
  }
  if (typeof obj.pesan === 'string' && obj.pesan.length > 0) {
    return new KesalahanApi(status, kodeDariStatus(status), obj.pesan, isi);
  }
  return new KesalahanApi(
    status,
    kodeDariStatus(status),
    `Permintaan ke OSDA API gagal (HTTP ${status})`,
    isi,
  );
}

// ============================================================
// Inti HTTP
// ============================================================

export interface OpsiPermintaan {
  readonly metode?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined | null>>;
  readonly timeoutMs?: number;
  /** Jumlah percobaan ULANG setelah percobaan pertama (default dari konfig). */
  readonly percobaan?: number;
  readonly token?: string | null;
}

/** Gabungkan base URL `API_URL` dengan jalur + query string. */
export function susunUrl(jalur: string, query?: OpsiPermintaan['query']): string {
  const basis = /^https?:\/\//i.test(jalur)
    ? jalur
    : `${konfig.apiUrl}${jalur.startsWith('/') ? jalur : `/${jalur}`}`;
  if (!query) return basis;

  const params = new URLSearchParams();
  for (const [kunci, nilai] of Object.entries(query)) {
    if (nilai === undefined || nilai === null || nilai === '') continue;
    params.set(kunci, String(nilai));
  }
  const qs = params.toString();
  if (!qs) return basis;
  return `${basis}${basis.includes('?') ? '&' : '?'}${qs}`;
}

function cobaParseJson(mentah: string): unknown {
  if (!mentah) return null;
  try {
    return JSON.parse(mentah) as unknown;
  } catch {
    return mentah;
  }
}

/** Baca respons: parse JSON, buka envelope `{ data }`, angkat galat bila gagal. */
async function bacaRespons<T>(respons: Response): Promise<T> {
  const mentah = await respons.text();
  const isi = cobaParseJson(mentah);

  if (!respons.ok) throw keKesalahanApi(respons.status, isi);
  if (isi === null || isi === undefined) return undefined as T;

  if (typeof isi === 'object' && !Array.isArray(isi) && 'data' in (isi as object)) {
    return (isi as { data: T }).data;
  }
  return isi as T;
}

async function sekaliPermintaan<T>(jalur: string, opsi: OpsiPermintaan): Promise<T> {
  const token = opsi.token === undefined ? konfig.apiTokenBot : opsi.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opsi.timeoutMs ?? konfig.apiTimeoutMs);

  try {
    const respons = await fetch(susunUrl(jalur, opsi.query), {
      method: opsi.metode ?? 'GET',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'osda-bot/2.0.0',
        // Semua permintaan tercatat sebagai sumber WHATSAPP di audit log.
        'x-osda-sumber': 'WHATSAPP',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opsi.body === undefined ? undefined : JSON.stringify(opsi.body),
      signal: controller.signal,
    });
    return await bacaRespons<T>(respons);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Panggil OSDA API dengan retry.
 * Percobaan ulang hanya untuk masalah sementara (jaringan putus, timeout,
 * 5xx, 429). Galat 4xx lain langsung dilempar karena tidak akan berubah
 * bila diulang.
 */
export async function panggilApi<T>(jalur: string, opsi: OpsiPermintaan = {}): Promise<T> {
  const maksPercobaan = Math.max(1, (opsi.percobaan ?? konfig.apiPercobaanUlang) + 1);
  let galatTerakhir: unknown;

  for (let percobaan = 1; percobaan <= maksPercobaan; percobaan += 1) {
    try {
      return await sekaliPermintaan<T>(jalur, opsi);
    } catch (galat) {
      galatTerakhir = galat;
      const status = galat instanceof KesalahanApi ? galat.status : 0;
      const nama = (galat as { name?: string } | undefined)?.name ?? '';
      const sementara = status === 0 || status >= 500 || status === 408 || status === 429;

      if (!sementara || percobaan === maksPercobaan) throw galat;

      const jedaMs = 200 * 2 ** (percobaan - 1);
      logger.warn(
        { jalur, percobaan, jedaMs, status, nama: nama || undefined },
        'Permintaan API diulang',
      );
      await new Promise<void>((selesai) => setTimeout(selesai, jedaMs));
    }
  }

  throw galatTerakhir;
}

/** Cek koneksi ke OSDA API (dipakai saat boot, tidak fatal bila gagal). */
export async function periksaApi(): Promise<boolean> {
  try {
    await panggilApi<unknown>(JALUR.KESEHATAN, { percobaan: 0, timeoutMs: 3000 });
    logger.info('OSDA API (%s) siap dihubungi', konfig.apiUrl);
    return true;
  } catch (galat) {
    const pesan = galat instanceof Error ? galat.message : String(galat);
    logger.warn({ galat: pesan }, 'OSDA API belum bisa dihubungi; perintah akan gagal sampai API hidup');
    return false;
  }
}

// ============================================================
// Tipe data hasil API
// ============================================================

/** Ringkasan member yang dikembalikan endpoint identitas. */
export interface RingkasanMember {
  readonly id: string;
  readonly nama: string;
  readonly labelKelas: string;
  readonly tingkat: string | null;
  readonly jurusan: string | null;
  readonly subKelas: string | null;
  readonly status: string;
  readonly telepon: string | null;
  readonly jabatan: readonly string[];
}

/** Hasil resolusi identitas WhatsApp → akun OSDA. */
export interface HasilResolveIdentitas {
  readonly member: RingkasanMember | null;
  readonly pengguna: { readonly id: string; readonly nama: string } | null;
  /** Kode peran bawaan, mis. `SECRETARY`, `TREASURER`, `MEMBER`. */
  readonly peran: readonly string[];
  /** Daftar izin (permission) milik akun, mis. `attendance.manage`. */
  readonly izin: readonly string[];
  /** true bila JID dikenal tapi belum tertaut ke akun/member mana pun. */
  readonly perluTautanAkun: boolean;
  /** Tautan untuk menautkan akun (deep link Web/Mobile), bila ada. */
  readonly tautanAkun: string | null;
}

export interface PermintaanResolveIdentitas {
  readonly jid: string;
  readonly lid?: string | null;
  readonly nomor?: string | null;
  readonly namaTampilan?: string | null;
}

export interface HasilDaftarWhatsapp {
  readonly member: RingkasanMember;
  readonly dibuat: boolean;
}

/** Payload catat kehadiran dari bot (sesuai `SkemaCatatHadir` + sumber). */
export interface PayloadCatatHadirBot {
  readonly sessionId: string;
  readonly memberId: string;
  readonly status: StatusHadir;
  readonly alasan?: string | null;
  readonly catatan?: string | null;
  readonly idempotencyKey?: string;
  /** Dicatat otomatis sebagai WHATSAPP agar audit log jelas. */
  readonly direkamOlehJid?: string | null;
}

// ============================================================
// Identitas
// ============================================================

/**
 * Resolusi identitas: JID WhatsApp → member + peran + izin.
 * Bila endpoint `/identity/whatsapp/resolve` belum tersedia, API sebaiknya
 * menyediakan padanan setara (`/identity/resolve?kanal=WHATSAPP`) — yang
 * penting bot tetap belajar identitas dari API, bukan dari database.
 */
export function resolusiIdentitas(
  permintaan: PermintaanResolveIdentitas,
): Promise<HasilResolveIdentitas> {
  return panggilApi<HasilResolveIdentitas>(JALUR.RESOLVE_IDENTITAS, {
    metode: 'POST',
    body: {
      jid: permintaan.jid,
      lid: permintaan.lid ?? undefined,
      nomor: permintaan.nomor ?? undefined,
      namaTampilan: permintaan.namaTampilan ?? undefined,
      kanal: 'WHATSAPP',
    },
  });
}

/** Pendaftaran anggota baru lewat WhatsApp (membuat member + tautkan JID). */
export function daftarAnggotaWhatsapp(payload: {
  jid: string;
  nama: string;
  tingkat: string;
  jurusan?: string | null;
  subKelas?: string | null;
  lid?: string | null;
  namaTampilan?: string | null;
  telepon?: string | null;
  pendaftarJid?: string | null;
}): Promise<HasilDaftarWhatsapp> {
  return panggilApi<HasilDaftarWhatsapp>(JALUR.DAFTAR_WHATSAPP, {
    metode: 'POST',
    body: {
      jid: payload.jid,
      nama: payload.nama,
      tingkat: payload.tingkat,
      jurusan: payload.jurusan ?? null,
      subKelas: payload.subKelas ?? null,
      lid: payload.lid ?? null,
      namaTampilan: payload.namaTampilan ?? null,
      telepon: payload.telepon ?? null,
      pendaftarJid: payload.pendaftarJid ?? null,
      kanal: 'WHATSAPP',
    },
  });
}

// ============================================================
// Anggota
// ============================================================

export function detailAnggota(memberId: string): Promise<Anggota> {
  return panggilApi<Anggota>(JALUR.detailAnggota(memberId));
}

export function cariAnggota(kunci: string, limit = 5): Promise<readonly Anggota[]> {
  return panggilApi<readonly Anggota[]>(JALUR.ANGGOTA, { query: { q: kunci, limit } });
}

export function daftarAnggotaAktif(limit = 50): Promise<readonly Anggota[]> {
  return panggilApi<readonly Anggota[]>(JALUR.ANGGOTA, {
    query: { status: 'ACTIVE', limit },
  });
}

// ============================================================
// Absensi
// ============================================================

/** Sesi absensi yang sedang TERBUKA pada tanggal tertentu. */
export async function sesiTerbukaHariIni(tanggal: string): Promise<SesiAbsensi | null> {
  const daftar = await panggilApi<readonly SesiAbsensi[]>(JALUR.SESI_ABSENSI, {
    query: { tanggal, status: 'OPEN', limit: 10 },
  });
  return pilihSesi(daftar, tanggal, 'OPEN');
}

/** Sesi apa pun (terbuka/tertutup) pada tanggal tertentu. */
export async function sesiPadaTanggal(tanggal: string): Promise<SesiAbsensi | null> {
  const daftar = await panggilApi<readonly SesiAbsensi[]>(JALUR.SESI_ABSENSI, {
    query: { tanggal, limit: 10 },
  });
  return (
    pilihSesi(daftar, tanggal, 'OPEN') ??
    pilihSesi(daftar, tanggal, 'CLOSED') ??
    pilihSesi(daftar, tanggal, 'DRAFT') ??
    null
  );
}

function pilihSesi(
  daftar: readonly SesiAbsensi[],
  tanggal: string,
  status: string,
): SesiAbsensi | null {
  const cocok = daftar.filter((s) => s.tanggal === tanggal && s.status === status);
  if (cocok.length === 0) return null;
  // Ambil yang paling baru dibuka.
  cocok.sort((a, b) => (b.dibukaPada ?? '').localeCompare(a.dibukaPada ?? ''));
  return cocok[0] ?? null;
}

/** Catat kehadiran anggota (HADIR/IZIN/SAKIT) melalui WhatsApp. */
export function catatHadir(payload: PayloadCatatHadirBot): Promise<CatatanHadir> {
  return panggilApi<CatatanHadir>(JALUR.CATAT_HADIR, {
    metode: 'POST',
    body: {
      sessionId: payload.sessionId,
      memberId: payload.memberId,
      status: payload.status,
      alasan: payload.alasan ?? undefined,
      catatan: payload.catatan ?? undefined,
      sumber: 'WHATSAPP',
      idempotencyKey: payload.idempotencyKey,
      direkamOlehJid: payload.direkamOlehJid ?? undefined,
    },
  });
}

/** Catat kehadiran manual oleh pengurus (`/absenin`). */
export function catatHadirManual(payload: PayloadCatatHadirBot): Promise<CatatanHadir> {
  return panggilApi<CatatanHadir>(JALUR.CATAT_HADIR_MANUAL, {
    metode: 'POST',
    body: {
      sessionId: payload.sessionId,
      memberId: payload.memberId,
      status: payload.status,
      alasan: payload.alasan ?? undefined,
      catatan: payload.catatan ?? undefined,
      sumber: 'WHATSAPP',
      idempotencyKey: payload.idempotencyKey,
      direkamOlehJid: payload.direkamOlehJid ?? undefined,
    },
  });
}

/** Catatan kehadiran seorang anggota pada satu tanggal (paling baru). */
export async function catatanHariIni(
  memberId: string,
  tanggal: string,
): Promise<CatatanHadir | null> {
  const daftar = await panggilApi<readonly CatatanHadir[]>(JALUR.CATAT_HADIR, {
    query: { memberId, dari: tanggal, sampai: tanggal, limit: 5 },
  });
  const cocok = daftar.filter((c) => c.memberId === memberId);
  cocok.sort((a, b) => (b.direkamPada ?? '').localeCompare(a.direkamPada ?? ''));
  return cocok[0] ?? null;
}

export function rekapSesi(sessionId: string): Promise<RekapSesi> {
  return panggilApi<RekapSesi>(JALUR.rekapSesi(sessionId));
}

export function rekapAnggota(memberId: string): Promise<RekapAnggota> {
  return panggilApi<RekapAnggota>(JALUR.rekapAnggota(memberId));
}

/** Daftar sesi absensi terbaru (dipakai `/rekap` bila hari ini tidak ada sesi). */
export function daftarSesi(limit = 5): Promise<readonly SesiAbsensi[]> {
  return panggilApi<readonly SesiAbsensi[]>(JALUR.SESI_ABSENSI, { query: { limit } });
}

// ============================================================
// Rapat, tugas, program
// ============================================================

export function daftarRapat(dari: string, limit = 10): Promise<readonly Rapat[]> {
  return panggilApi<readonly Rapat[]>(JALUR.RAPAT, { query: { dari, limit } });
}

export function daftarTugas(filter: {
  memberId?: string;
  status?: string;
  limit?: number;
}): Promise<readonly Tugas[]> {
  return panggilApi<readonly Tugas[]>(JALUR.TUGAS, {
    query: { assigneeMemberId: filter.memberId, status: filter.status, limit: filter.limit ?? 10 },
  });
}

export function daftarProgram(status: string | undefined, limit = 10): Promise<readonly Program[]> {
  return panggilApi<readonly Program[]>(JALUR.PROGRAM, { query: { status, limit } });
}

// ============================================================
// Keuangan (kas)
// ============================================================

export function detailKas(): Promise<Kas> {
  return panggilApi<Kas>(JALUR.KAS);
}

export function ringkasanKeuangan(): Promise<RingkasanKeuangan> {
  return panggilApi<RingkasanKeuangan>(JALUR.RINGKASAN_KEUANGAN);
}

// ============================================================
// Notifikasi
// ============================================================

export function daftarNotifikasi(limit = 20): Promise<readonly Notifikasi[]> {
  return panggilApi<readonly Notifikasi[]>(JALUR.NOTIFIKASI, { query: { limit } });
}

// ============================================================
// Utilitas
// ============================================================

/** Nomor 62xxx → JID PN WhatsApp. */
export function nomorKeJidPn(nomor: string): string {
  const angka = nomor.replace(/[^\d]/g, '');
  return `${angka}@s.whatsapp.net`;
}
