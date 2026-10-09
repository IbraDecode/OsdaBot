/**
 * Identity Resolver — memetakan identitas WhatsApp ke anggota OSDA.
 *
 * Alur (spec §32):
 *   WhatsApp JID → (POST /identity/whatsapp/resolve) → member + peran + izin
 *
 * Bot tidak memiliki tabel `members` sendiri. Bot hanya:
 * 1. mengambil JID/LID/nomor dari pesan (modul `whatsapp/account.ts`),
 * 2. meminta OSDA API menerjemahkannya menjadi member + izin,
 * 3. menyimpan hasilnya sebentar di cache supaya tidak memanggil API
 *    berulang kali untuk pesan yang beruntun dari nomor yang sama.
 *
 * Bila JID belum punya pasangan member, bot TIDAK menebak identitas dari nama
 * yang diketik. Bot mengirim instruksi pendaftaran / penautan akun.
 */
import type { Izin } from '@osda/contracts';

import {
  KesalahanApi,
  apakahTidakBerwenang,
  resolusiIdentitas,
  type HasilResolveIdentitas,
  type RingkasanMember,
} from '../api/client.js';
import { logger } from '../logger.js';
import type { PesanMasuk } from '../whatsapp/account.js';

/** Izin yang menandakan seseorang pengurus (bukan anggota biasa). */
export const IZIN_PENGURUS: readonly Izin[] = [
  'attendance.manage',
  'attendance.write',
  'member.write',
  'member.archive',
  'meeting.create',
  'meeting.manage',
  'meeting.minutes.approve',
  'program.create',
  'program.manage',
  'program.approve',
  'task.write',
  'task.verify',
  'finance.write',
  'finance.approve',
  'finance.export',
  'communication.create',
  'communication.publish',
  'document.create',
  'document.approve',
  'report.read',
  'report.export',
  'approval.decide',
  'settings.manage',
  'period.manage',
];

export interface GalatIdentitas {
  readonly kode: string;
  readonly pesan: string;
}

export interface IdentitasTerresolusi {
  readonly jid: string;
  readonly member: RingkasanMember | null;
  readonly pengguna: { readonly id: string; readonly nama: string } | null;
  readonly peran: readonly string[];
  readonly izin: readonly string[];
  /** true bila JID dikenal sistem tapi belum tertaut ke member mana pun. */
  readonly perluTautanAkun: boolean;
  readonly tautanAkun: string | null;
  /** Terisi bila resolusi gagal (API mati / token salah). */
  readonly galat: GalatIdentitas | null;
  readonly dariCache: boolean;
}

const TTL_CACHE_MS = 5 * 60 * 1000;
const BATAS_CACHE = 1000;

interface EntriCache {
  nilai: HasilResolveIdentitas;
  waktu: number;
}

const cacheIdentitas = new Map<string, EntriCache>();

function bacaCache(jid: string): HasilResolveIdentitas | null {
  const entri = cacheIdentitas.get(jid);
  if (!entri) return null;
  if (Date.now() - entri.waktu > TTL_CACHE_MS) {
    cacheIdentitas.delete(jid);
    return null;
  }
  return entri.nilai;
}

function tulisCache(jid: string, nilai: HasilResolveIdentitas): void {
  if (cacheIdentitas.size >= BATAS_CACHE) {
    const kunciPertama = cacheIdentitas.keys().next();
    if (!kunciPertama.done) cacheIdentitas.delete(kunciPertama.value);
  }
  cacheIdentitas.set(jid, { nilai, waktu: Date.now() });
}

/**
 * Rapikan respons API yang bentuknya tidak dijamin (JSON dari jaringan).
 * Nilai yang tidak sesuai bentuk dibuang, bukan dipercaya begitu saja.
 */
function amankanHasil(nilai: HasilResolveIdentitas): HasilResolveIdentitas {
  const obj = (nilai ?? {}) as Partial<HasilResolveIdentitas>;
  return {
    member: obj.member ?? null,
    pengguna: obj.pengguna ?? null,
    peran: Array.isArray(obj.peran) ? obj.peran.filter((p) => typeof p === 'string') : [],
    izin: Array.isArray(obj.izin) ? obj.izin.filter((i) => typeof i === 'string') : [],
    perluTautanAkun: obj.perluTautanAkun === true,
    tautanAkun: typeof obj.tautanAkun === 'string' ? obj.tautanAkun : null,
  };
}

/** Sudahkah akun ini pengurus (punya izin operasional organisasi)? */
export function adalahPengurus(identitas: IdentitasTerresolusi): boolean {
  return identitas.izin.some((izin) => IZIN_PENGURUS.includes(izin as Izin));
}

/** Cek satu izin spesifik (mis. `attendance.manage`). */
export function punyaIzin(identitas: IdentitasTerresolusi, izin: Izin): boolean {
  return identitas.izin.includes(izin);
}

/**
 * Resolusi sebuah pesan menjadi identitas OSDA.
 * Tidak pernah melempar galat: kegagalan dikembalikan sebagai `galat` supaya
 * router bisa membalas dengan tenang daripada membiarkan proses menggantung.
 */
export async function resolveIdentitasPesan(
  pesan: PesanMasuk,
): Promise<IdentitasTerresolusi> {
  return resolveIdentitasJid(pesan.pengirimJid, pesan.lid, pesan.nomor, pesan.namaTampilan);
}

/** Resolusi JID (plus LID & nomor bila diketahui) ke identitas OSDA. */
export async function resolveIdentitasJid(
  jid: string,
  lid: string | null = null,
  nomor: string | null = null,
  namaTampilan: string | null = null,
): Promise<IdentitasTerresolusi> {
  const dariCache = bacaCache(jid);
  if (dariCache) {
    return {
      jid,
      member: dariCache.member,
      pengguna: dariCache.pengguna,
      peran: dariCache.peran,
      izin: dariCache.izin,
      perluTautanAkun: dariCache.perluTautanAkun,
      tautanAkun: dariCache.tautanAkun,
      galat: null,
      dariCache: true,
    };
  }

  try {
    const hasil = amankanHasil(
      await resolusiIdentitas({
        jid,
        // LID dikirim sebagai JID utuh; API menormalisasinya sendiri.
        lid: lid ?? null,
        nomor,
        namaTampilan,
      }),
    );
    tulisCache(jid, hasil);
    return { jid, ...hasil, galat: null, dariCache: false };
  } catch (galat) {
    if (galat instanceof KesalahanApi && galat.status === 404) {
      // JID belum dikenal sama sekali → perlakukan sebagai belum terdaftar.
      const hasil: HasilResolveIdentitas = {
        member: null,
        pengguna: null,
        peran: [],
        izin: [],
        perluTautanAkun: true,
        tautanAkun: null,
      };
      tulisCache(jid, hasil);
      return { jid, ...hasil, galat: null, dariCache: false };
    }

    const tidakBerwenang = apakahTidakBerwenang(galat);
    logger.warn(
      { galat, jid },
      tidakBerwenang
        ? 'Token bot ditolak OSDA API saat resolusi identitas'
        : 'Resolusi identitas gagal',
    );
    return {
      jid,
      member: null,
      pengguna: null,
      peran: [],
      izin: [],
      perluTautanAkun: false,
      tautanAkun: null,
      galat: {
        kode: tidakBerwenang ? 'TIDAK_BERWENANG' : 'GALAT_API',
        pesan: galat instanceof Error ? galat.message : 'Gagal menghubungi OSDA API',
      },
      dariCache: false,
    };
  }
}

/** Hapus satu entri cache (dipakai setelah `DAFTAR` berhasil). */
export function hapusCacheIdentitas(jid: string): void {
  cacheIdentitas.delete(jid);
}

/** Kosongkan seluruh cache identitas (dipakai saat restart koneksi). */
export function kosongkanCacheIdentitas(): void {
  cacheIdentitas.clear();
}

/** Statistik cache untuk log diagnostik. */
export function statistikCacheIdentitas(): { ukuran: number; ttlDetik: number } {
  return { ukuran: cacheIdentitas.size, ttlDetik: Math.round(TTL_CACHE_MS / 1000) };
}
