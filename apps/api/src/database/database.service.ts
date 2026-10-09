/**
 * Akses database untuk seluruh modul API.
 *
 * Catatan: TIDAK ADA Prisma, TypeORM, atau Redis. Semua query memakai layanan
 * `@osda/db` (Drizzle ORM + driver `pg` ke PostgreSQL/Neon). Koneksi dibuat
 * malas (lazy) supaya aplikasi tetap bisa start dan melayani `/health/live`
 * walau database sedang tidak dapat dijangkau.
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { buatDb, cekKesehatan, type Db } from '@osda/db';

import { KONFIGURASI, type Konfigurasi } from '../config/konfigurasi.js';

/** Bentuk koneksi mentah yang bisa ditutup. */
interface KlienBisaDitutup {
  end?: () => Promise<void>;
}

@Injectable()
export class LayananDatabase implements OnModuleInit, OnModuleDestroy {
  private readonly pencatat = new Logger('Database');
  private janjiDb: Promise<Db> | null = null;
  private dbAktif: Db | null = null;

  constructor(@Inject(KONFIGURASI) private readonly konfigurasi: Konfigurasi) {}

  /** Pastikan koneksi terbentuk saat aplikasi start (tidak melempar galat). */
  async onModuleInit(): Promise<void> {
    try {
      await this.ambilDb();
      this.pencatat.log('Koneksi database siap.');
    } catch (galat) {
      this.pencatat.error(`Database belum siap: ${(galat as Error).message}`);
    }
  }

  /** Tutup koneksi saat aplikasi berhenti. */
  async onModuleDestroy(): Promise<void> {
    const db = this.dbAktif;
    this.dbAktif = null;
    this.janjiDb = null;
    if (!db) return;
    try {
      const klien = (db as unknown as { $client?: KlienBisaDitutup }).$client;
      await klien?.end?.();
    } catch {
      // abaikan galat penutupan
    }
  }

  /** Ambil instance database (dibuat ulang otomatis bila belum ada). */
  async ambilDb(): Promise<Db> {
    if (this.dbAktif) return this.dbAktif;
    this.janjiDb ??= (async () => {
      this.pencatat.log(`Menghubungkan ke database (${this.konfigurasi.NODE_ENV})…`);
      const db = await buatDb();
      this.dbAktif = db;
      return db;
    })();
    try {
      return await this.janjiDb;
    } catch (galat) {
      this.janjiDb = null;
      throw galat;
    }
  }

  /** Pemeriksaan kesehatan untuk `/health/ready`. */
  async kesehatan(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const db = await this.ambilDb();
      return await cekKesehatan(db);
    } catch (galat) {
      return { ok: false, detail: (galat as Error).message };
    }
  }
}
