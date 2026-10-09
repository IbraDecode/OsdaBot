/**
 * NotificationsService — daftar, tandai dibaca, dan hitung notifikasi belum dibaca.
 *
 * PENTING: notifikasi selalu difilter berdasarkan `userId` pengguna. Tidak ada
 * cara bagi satu pengguna melihat notifikasi pengguna lain (object-level
 * authorization, spec §45).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql as sqlExpr } from 'drizzle-orm';

import {
  notifications,
  type Db,
} from '@osda/db';
import type { Notifikasi, RingkasanNotifikasi } from '@osda/contracts';

import { bungkusDaftar } from '@osda/contracts';

import { LayananDatabase } from '../../database/database.service.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { SkemaKueriNotifikasi } from './dto/notifications.dto.js';

/** jumlah maksimum notifikasi untuk satu pengguna (mencegah ledakan penyimpanan). */
const MAKS_NOTIFIKASI = 500;

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
  ) {}

  /** Daftar notifikasi milik pengguna yang sedang login. */
  async daftar(
    kueri: { page?: number; limit?: number; belumDibaca?: boolean; jenis?: string },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaKueriNotifikasi.parseAsync(kueri);

    // Otorisasi tingkat objek: hanya melihat notifikasi milik sendiri.
    const syarat = [eq(notifications.userId, pengguna.sub)];
    if (skema.belumDibaca) syarat.push(isNull(notifications.dibacaPada));
    if (skema.jenis) syarat.push(eq(notifications.jenis, skema.jenis as never));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(notifications)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(notifications)
      .where(and(...syarat))
      .orderBy(desc(notifications.dibuatPada))
      .limit(skema.limit)
      .offset((skema.page - 1) * skema.limit);

    return bungkusDaftar(
      baris.map((n) => this.keNotifikasi(n)),
      Number(totalBaris?.jumlah ?? 0),
      { page: skema.page, limit: skema.limit },
    );
  }

  /** Ringkasan: jumlah belum dibaca + per jenis + 10 terbaru. */
  async ringkasan(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<RingkasanNotifikasi> {
    const db = await this.dbSvc.ambilDb();
    const syarat = eq(notifications.userId, pengguna.sub);

    const [belumDibaca] = await db
      .select({ jumlah: count() })
      .from(notifications)
      .where(and(syarat, isNull(notifications.dibacaPada)))
      .limit(1);

    const perJenis = await db
      .select({ jenis: notifications.jenis, jumlah: count() })
      .from(notifications)
      .where(and(syarat, isNull(notifications.dibacaPada)))
      .groupBy(notifications.jenis);

    const terbaru = await db
      .select()
      .from(notifications)
      .where(syarat)
      .orderBy(desc(notifications.dibuatPada))
      .limit(10);

    return {
      belumDibaca: Number(belumDibaca?.jumlah ?? 0),
      perJenis: perJenis.map((r) => ({ jenis: r.jenis, belumDibaca: Number(r.jumlah) })),
      terbaru: terbaru.map((n) => this.keNotifikasi(n)),
    };
  }

  /** Tandai satu notifikasi sebagai dibaca (idempoten). */
  async tandaiDibaca(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Notifikasi> {
    const db = await this.dbSvc.ambilDb();
    const [baris] = await db
      .update(notifications)
      .set({ dibacaPada: sqlExpr`now()` as never })
      .where(and(eq(notifications.id, id), eq(notifications.userId, pengguna.sub)))
      .returning();
    if (!baris) {
      throw new Error('Notifikasi tidak ditemukan atau bukan milik Anda.');
    }
    return this.keNotifikasi(baris);
  }

  /** Tandai semua notifikasi milik pengguna sebagai dibaca. */
  async tandaiSemuaDibaca(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ jumlah: number }> {
    const db = await this.dbSvc.ambilDb();
    const hasil = await db
      .update(notifications)
      .set({ dibacaPada: sqlExpr`now()` as never })
      .where(and(eq(notifications.userId, pengguna.sub), isNull(notifications.dibacaPada)))
      .returning({ id: notifications.id });
    return { jumlah: hasil.length };
  }

  /**
   * Buat notifikasi in-app baru. Dipakai modul lain (tugas, absensi, ...).
   * Menerima batasan jumlah maksimum agar satu pengguna tidak menumpuk notifikasi.
   */
  async buatNotifikasi(db: Db, masukan: {
    userId: string;
    jenis: string;
    judul: string;
    isi: string;
    prioritas?: string;
    entitasJenis?: string | null;
    entitasId?: string | null;
    aksi?: { label: string; url: string; utama?: boolean; }[];
    dedupKey?: string | null;
  }): Promise<string | null> {
    // Idempotensi: dedupKey yang sama tidak boleh membuat notifikasi ganda.
    if (masukan.dedupKey) {
      const [ada] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, masukan.userId),
            eq(notifications.dedupKey, masukan.dedupKey),
          ),
        )
        .limit(1);
      if (ada) return ada.id;
    }

    const [baris] = await db
      .insert(notifications)
      .values({
        userId: masukan.userId,
        jenis: masukan.jenis as never,
        judul: masukan.judul,
        isi: masukan.isi,
        prioritas: (masukan.prioritas ?? 'NORMAL') as never,
        entitasJenis: masukan.entitasJenis ?? null,
        entitasId: masukan.entitasId ?? null,
        actions: masukan.aksi ?? [],
        dedupKey: masukan.dedupKey ?? null,
      })
      .returning({ id: notifications.id });

    // Bersihkan notifikasi lama bila melewati batas.
    const jumlah = await db
      .select({ jumlah: count() })
      .from(notifications)
      .where(eq(notifications.userId, masukan.userId));
    if (Number(jumlah[0]?.jumlah ?? 0) > MAKS_NOTIFIKASI) {
      await db.execute(
        sqlExpr`delete from notifications where id in (
          select id from notifications
           where user_id = ${masukan.userId}
           order by dibuat_pada desc
           offset ${MAKS_NOTIFIKASI}
        )`,
      );
    }

    return baris?.id ?? null;
  }

  /** Ubah baris notifikasi menjadi bentuk kontrak. */
  private keNotifikasi(n: typeof notifications.$inferSelect): Notifikasi {
    return {
      id: n.id,
      jenis: n.jenis,
      judul: n.judul,
      isi: n.isi,
      prioritas: n.prioritas,
      sudahDibaca: Boolean(n.dibacaPada),
      dibacaPada: n.dibacaPada ? n.dibacaPada.toISOString() : null,
      entitas: n.entitasJenis && n.entitasId ? { jenis: n.entitasJenis, id: n.entitasId } : null,
      actions: (n.actions ?? []) as { label: string; url: string; utama: boolean }[],
      dibuatPada: n.dibuatPada.toISOString(),
    };
  }
}
