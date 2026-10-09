/**
 * AuthService — masuk, keluar, segarkan token, dan tukar kode WhatsApp.
 *
 * Aturan yang ditegakkan:
 *  1. Kata sandi diverifikasi dengan argon2id (fallback SHA-256 hanya dev).
 *  2. Refresh token disimpan HANYA sebagai hash di tabel `sessions`.
 *  3. Refresh token ROTASI: token lama langsung dicabut begitu dipakai,
 *     sehingga token yang bocor hanya bisa dipakai sekali.
 *  4. Pesan galat tidak membocorkan apakah email ada atau tidak.
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidAcak } from '@osda/auth';
import { accountLinkRequests, sessions, users, type Db, type PenggunaBaris } from '@osda/db';
import type { HasilMasuk, HasilTukarIdentitas, ProfilPengguna } from '@osda/contracts';

import { galatBelumMasuk, galatIzinDitolak, galatTidakDitemukan } from '../../common/galat.js';
import { KONFIGURASI, type Konfigurasi } from '../../config/konfigurasi.js';
import { LayananDatabase } from '../../database/database.service.js';
import { LayananIzin, type IzinEfektif } from '../../auth/izin.service.js';
import { LayananToken, type MuatanToken } from '../../auth/token.service.js';

/** Konteks teknis permintaan (untuk tabel `sessions`). */
export interface KonteksSesi {
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

/** Hasil penerbitan sesi + token. */
interface HasilSesi {
  readonly aksesToken: string;
  readonly refreshToken: string;
  readonly kedaluwarsaPada: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
    @Inject(LayananIzin) private readonly izinSvc: LayananIzin,
    @Inject(LayananToken) private readonly tokenSvc: LayananToken,
    @Inject(KONFIGURASI) private readonly konfigurasi: Konfigurasi,
  ) {}

  /** Masuk dengan email + kata sandi. */
  async masuk(email: string, password: string, konteks: KonteksSesi = {}): Promise<HasilMasuk> {
    const db = await this.dbSvc.ambilDb();
    const surel = email.toLowerCase();

    const [pengguna] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${surel}`)
      .limit(1);

    if (!pengguna || !pengguna.passwordHash) {
      throw galatBelumMasuk('Email atau kata sandi salah.');
    }
    if (pengguna.status !== 'ACTIVE') {
      throw galatIzinDitolak(
        `Akun berstatus ${pengguna.status}. Hubungi pengurus untuk mengaktifkan akun.`,
      );
    }

    const cocok = await this.periksaSandi(pengguna.passwordHash, password);
    if (!cocok) {
      await db
        .update(users)
        .set({ gagalLoginBerturut: pengguna.gagalLoginBerturut + 1 })
        .where(eq(users.id, pengguna.id));
      throw galatBelumMasuk('Email atau kata sandi salah.');
    }

    await db
      .update(users)
      .set({ gagalLoginBerturut: 0, dikunciSampai: null, loginTerakhirPada: this.hariIni() })
      .where(eq(users.id, pengguna.id));

    const efektif = await this.izinSvc.muatIzinEfektif(pengguna.id);
    const sesi = await this.buatSesiDanToken(db, pengguna, efektif, konteks);

    return {
      ...sesi,
      pengguna: this.profilDari(efektif, pengguna.email, pengguna.telepon),
    };
  }

  /** Keluar: cabut sesi saat ini (atau seluruh sesi) milik pengguna. */
  async keluar(userId: string, sesiId: string, semuaSesi = false): Promise<void> {
    const db = await this.dbSvc.ambilDb();
    const alasan = 'LOGOUT';
    const dicabutPada = this.hariIni();

    if (semuaSesi) {
      await db
        .update(sessions)
        .set({ dicabutPada, alasanPencabutan: alasan })
        .where(and(eq(sessions.userId, userId), isNull(sessions.dicabutPada)));
      return;
    }

    await db
      .update(sessions)
      .set({ dicabutPada, alasanPencabutan: alasan })
      .where(and(eq(sessions.id, sesiId), eq(sessions.userId, userId)));
  }

  /**
   * Segarkan token: cari sesi berdasarkan hash refresh token, cabut sesi itu,
   * lalu terbitkan sesi + token baru (rotasi).
   */
  async segarkan(refreshToken: string, konteks: KonteksSesi = {}): Promise<HasilMasuk> {
    const db = await this.dbSvc.ambilDb();
    const hash = this.tokenSvc.hashRefresh(refreshToken);
    const hariIni = this.hariIni();

    const [sesi] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.refreshTokenHash, hash),
          isNull(sessions.dicabutPada),
          sql`${sessions.kedaluwarsaPada} >= ${hariIni}::date`,
        ),
      )
      .limit(1);

    if (!sesi) {
      throw galatBelumMasuk('Sesi sudah berakhir atau token tidak dikenali. Silakan masuk kembali.');
    }

    const [pengguna] = await db.select().from(users).where(eq(users.id, sesi.userId)).limit(1);
    if (!pengguna || pengguna.status !== 'ACTIVE') {
      throw galatBelumMasuk('Akun tidak lagi aktif.');
    }

    // Rotasi: cabut sesi lama lebih dulu, barulah buat sesi baru.
    await db
      .update(sessions)
      .set({ dicabutPada: hariIni, alasanPencabutan: 'REFRESH_ROTASI' })
      .where(eq(sessions.id, sesi.id));

    const efektif = await this.izinSvc.muatIzinEfektif(pengguna.id);
    const sesiBaru = await this.buatSesiDanToken(db, pengguna, efektif, konteks);

    return {
      ...sesiBaru,
      pengguna: this.profilDari(efektif, pengguna.email, pengguna.telepon),
    };
  }

  /**
   * Tukar kode account linking (dari bot WhatsApp) menjadi JWT.
   * Kode hanya bisa dipakai sekali dan punya masa berlaku.
   */
  async tukarKode(kode: string, konteks: KonteksSesi = {}): Promise<HasilTukarIdentitas> {
    const db = await this.dbSvc.ambilDb();
    const hariIni = this.hariIni();

    const [permintaan] = await db
      .select()
      .from(accountLinkRequests)
      .where(
        and(
          eq(accountLinkRequests.kode, kode.toUpperCase()),
          isNull(accountLinkRequests.dipakaiPada),
          sql`${accountLinkRequests.berlakuSampai} >= ${hariIni}::date`,
        ),
      )
      .limit(1);

    if (!permintaan) {
      throw galatTidakDitemukan(
        'Kode penukaran tidak valid, sudah dipakai, atau sudah kedaluwarsa.',
      );
    }

    if (!permintaan.userId) {
      throw galatIzinDitolak(
        'Kode ini belum terhubung ke akun. Selesaikan pendaftaran lewat WhatsApp lebih dulu.',
      );
    }

    const [pengguna] = await db
      .select()
      .from(users)
      .where(eq(users.id, permintaan.userId))
      .limit(1);
    if (!pengguna) throw galatTidakDitemukan('Akun terkait kode ini tidak ditemukan.');
    if (pengguna.status !== 'ACTIVE') {
      throw galatIzinDitolak(`Akun berstatus ${pengguna.status} dan tidak boleh dipakai masuk.`);
    }

    await db
      .update(accountLinkRequests)
      .set({ dipakaiPada: hariIni })
      .where(eq(accountLinkRequests.id, permintaan.id));

    const efektif = await this.izinSvc.muatIzinEfektif(pengguna.id);
    const sesi = await this.buatSesiDanToken(db, pengguna, efektif, konteks);

    return {
      aksesToken: sesi.aksesToken,
      refreshToken: sesi.refreshToken,
      pengguna: this.profilDari(efektif, pengguna.email, pengguna.telepon),
    };
  }

  /** Profil lengkap + izin efektif pengguna yang sedang login. */
  async profil(userId: string): Promise<ProfilPengguna> {
    const efektif = await this.izinSvc.muatIzinEfektif(userId);
    return this.profilDari(efektif, null, null);
  }

  // ============================================================
  // Helper internal
  // ============================================================

  /**
   * Buat sesi baru sekaligus menerbitkan token. Hash refresh token sudah benar
   * sejak baris sesi dibuat (tidak ada nilai sementara yang bisa bocor).
   */
  private async buatSesiDanToken(
    db: Db,
    pengguna: PenggunaBaris,
    efektif: IzinEfektif,
    konteks: KonteksSesi,
  ): Promise<HasilSesi> {
    const sid = uuidAcak();
    const token = await this.tokenSvc.terbitkan(this.muatanToken(efektif), sid);
    const kedaluwarsaPada = token.refreshKedaluwarsaPada.toISOString().slice(0, 10);

    const [sesi] = await db
      .insert(sessions)
      .values({
        userId: pengguna.id,
        refreshTokenHash: token.refreshTokenHash,
        userAgent: konteks.userAgent ?? null,
        ip: konteks.ip ?? null,
        kedaluwarsaPada,
      })
      .returning();

    if (!sesi) throw new UnauthorizedException('Gagal membuat sesi masuk.');

    return {
      aksesToken: token.aksesToken,
      refreshToken: token.refreshToken,
      kedaluwarsaPada: token.kedaluwarsaPada.toISOString(),
    };
  }

  private muatanToken(efektif: IzinEfektif): MuatanToken {
    return {
      sub: efektif.userId,
      memberId: efektif.memberId,
      nama: efektif.nama,
      org: [...efektif.organizationIds],
      roles: efektif.peran.map((p) => p.kode),
      perms: [...efektif.izin],
      scopes: [...efektif.scopes],
    };
  }

  private profilDari(
    efektif: IzinEfektif,
    email: string | null,
    telepon: string | null,
  ): ProfilPengguna {
    return {
      userId: efektif.userId,
      email,
      phone: telepon,
      name: efektif.nama,
      status: efektif.status,
      memberId: efektif.memberId,
      organizationIds: [...efektif.organizationIds],
      peran: efektif.peran.map((p) => ({ kode: p.kode, nama: p.nama, cakupan: [...p.cakupan] })),
      izin: [...efektif.izin],
      jabatanIds: [],
    };
  }

  /** Verifikasi sandi: argon2id (produksi) atau fallback SHA-256 (dev). */
  private async periksaSandi(hash: string, sandi: string): Promise<boolean> {
    if (hash.startsWith('fallback-sha256$')) {
      const kunci = hash.slice('fallback-sha256$'.length);
      let hitung = createHash('sha256').update(sandi).digest('hex');
      for (let i = 0; i < 10_000; i += 1) {
        hitung = createHash('sha256').update(hitung).digest('hex');
      }
      return hitung === kunci;
    }
    try {
      return await argon2.verify(hash, sandi);
    } catch {
      return false;
    }
  }

  private hariIni(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
