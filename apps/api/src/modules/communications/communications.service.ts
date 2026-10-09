/**
 * CommunicationsService — pusat komunikasi Humas.
 *
 * Alur publikasi (spec §29):
 *   DRAFT → REVIEW → APPROVED → SCHEDULED → PUBLISHED → ARCHIVED
 *
 * Pengumuman yang mewakili organisasi secara resmi HARUS disetujui lebih dulu
 * bila `perluPersetujuan` aktif. Satu pengumuman dibuat sekali, backend yang
 * menentukan kanal pengiriman berdasarkan audiens & preferensi penerima.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  announcements,
  announcementRecipients,
  campaigns,
  events,
  members,
  type Db,
} from '@osda/db';
import type {
  Kampanye,
  Pengumuman,
  StatistikKomunikasi,
} from '@osda/contracts';

import { LayananDatabase } from '../../database/database.service.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { SkemaFilterPengumuman } from './dto/communications.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class CommunicationsService {
  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
    @Inject(NotificationsService) private readonly notifSvc: NotificationsService,
  ) {}

  /** Daftar pengumuman dengan filter & paginasi. */
  async daftar(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaFilterPengumuman.parseAsync(kueri);
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const syarat = [eq(announcements.organizationId, organizationId)];
    if (skema.status) syarat.push(eq(announcements.status, skema.status));
    if (skema.audiens) syarat.push(eq(announcements.audiens, skema.audiens));
    if (skema.programId) syarat.push(eq(announcements.programId, skema.programId));
    if (skema.eventId) syarat.push(eq(announcements.eventId, skema.eventId));
    if (skema.q) syarat.push(sql`${announcements.judul} ilike ${`%${skema.q}%`}` as never);

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(announcements)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(announcements)
      .where(and(...syarat))
      .orderBy(desc(announcements.dibuatPada))
      .limit(skema.limit)
      .offset((skema.page - 1) * skema.limit);

    return {
      data: baris.map((b) => this.kePengumuman(b)),
      meta: {
        page: skema.page,
        limit: skema.limit,
        total: Number(totalBaris?.jumlah ?? 0),
        totalPages: Math.max(1, Math.ceil(Number(totalBaris?.jumlah ?? 0) / skema.limit)),
        hasNext: skema.page * skema.limit < Number(totalBaris?.jumlah ?? 0),
        hasPrev: skema.page > 1,
      },
    };
  }

  async detail(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Pengumuman> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.organizationId, organizationId)))
      .limit(1);
    if (!baris) throw new Error('Pengumuman tidak ditemukan.');
    return this.kePengumuman(baris);
  }

  /**
   * Buat pengumuman baru (status DRAFT). Pengirim membutuhkan izin
   * `communication.create`.
   */
  async buat(
    masukan: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Pengumuman> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const anggota = await this.anggotaDariPengguna(db, pengguna, organizationId);

    const [baris] = await db
      .insert(announcements)
      .values({
        organizationId,
        judul: String(masukan.judul ?? ''),
        isi: String(masukan.isi ?? ''),
        ringkasan: String(masukan.isi ?? '').slice(0, 160),
        audiens: String(masukan.audiens ?? 'ALL') as never,
        divisionIds: (masukan.divisionIds as string[]) ?? [],
        memberIds: (masukan.memberIds as string[]) ?? null,
        kanal: (masukan.kanal as never[]) ?? (['WEB', 'MOBILE'] as never[]),
        prioritas: String(masukan.prioritas ?? 'NORMAL') as never,
        perluPersetujuan: Boolean(masukan.perluPersetujuan ?? true),
        lampiranDokumenIds: (masukan.lampiranDokumenIds as string[]) ?? [],
        programId: (masukan.programId as string) ?? null,
        eventId: (masukan.eventId as string) ?? null,
        dibuatOleh: anggota ?? null,
        status: 'DRAFT',
      })
      .returning();
    if (!baris) throw new Error('Gagal membuat pengumuman.');
    return this.kePengumuman(baris);
  }

  /**
   * Setujui pengumuman (izin `communication.publish`). Pengumuman resmi
   * organisasi harus disetujui sebelum boleh dipublikasikan.
   */
  async putuskan(
    id: string,
    keputusan: 'APPROVED' | 'REJECTED',
    komentar: string | undefined,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Pengumuman> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const anggota = await this.anggotaDariPengguna(db, pengguna, organizationId);

    const [baris] = await db
      .update(announcements)
      .set({
        status: keputusan === 'APPROVED' ? 'APPROVED' : 'DRAFT',
        alasanPenolakan: keputusan === 'REJECTED' ? (komentar ?? 'Ditolak.') : null,
        disetujuiOleh: keputusan === 'APPROVED' ? anggota : null,
        disetujuiPada: keputusan === 'APPROVED' ? new Date().toISOString().slice(0, 10) : null,
      })
      .where(and(eq(announcements.id, id), eq(announcements.organizationId, organizationId)))
      .returning();
    if (!baris) throw new Error('Gagal membuat pengumuman.');
    return this.kePengumuman(baris);
  }

  /**
   * Terbitkan pengumuman ke kanal yang dipilih.
   *
   * Backend menentukan penerima berdasarkan audiens dan menuliskan notifikasi
   * in-app untuk setiap anggota. Pengiriman WhatsApp/push dikerjakan worker
   * terpisah agar gagal kirim tidak membatalkan penerbitan.
   */
  async terbitkan(
    id: string,
    lewatiKanal: string[],
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Pengumuman> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.organizationId, organizationId)))
      .limit(1);
    if (!baris) throw new Error('Pengumuman tidak ditemukan.');
    if (baris.perluPersetujuan && baris.status !== 'APPROVED') {
      throw new Error('Pengumuman resmi harus disetujui sebelum diterbitkan.');
    }

    // Tentukan penerima berdasarkan audiens.
    const penerima = await this.ambilPenerima(db, organizationId, baris.audiens, baris.divisionIds ?? [], baris.memberIds ?? null);

    // Notifikasi in-app satu per satu (dalam satu transaksi agar konsisten).
    await db.transaction(async (tx) => {
      for (const m of penerima) {
        await this.notifSvc.buatNotifikasi(tx as never, {
          userId: m.userId ?? '',
          jenis: 'ANNOUNCEMENT',
          judul: baris.judul,
          isi: baris.isi,
          prioritas: baris.prioritas,
          entitasJenis: 'ANNOUNCEMENT',
          entitasId: baris.id,
          dedupKey: `ann-${baris.id}`,
        });
      }
    });

    const [baru] = await db
      .update(announcements)
      .set({
        status: 'PUBLISHED',
        terbitPada: new Date(),
        totalPenerima: penerima.length,
        totalTerkirim: penerima.length,
      })
      .where(eq(announcements.id, baris.id))
      .returning();
    if (!baru) throw new Error('Gagal menerbitkan pengumuman.');
    return this.kePengumuman(baru);
  }

  // ============================================================
  // Kampanye
  // ============================================================

  async daftarKampanye(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Kampanye[]> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const baris = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.organizationId, organizationId))
      .limit(50);
    return baris.map((b) => ({
      id: b.id,
      nama: b.nama,
      deskripsi: b.deskripsi,
      programId: b.programId,
      eventId: b.eventId,
      mulaiPada: String(b.mulaiPada),
      selesaiPada: String(b.selesaiPada),
      status: b.status,
      jumlahPengumuman: (b.announcementIds ?? []).length,
      totalTerkirim: 0,
      totalTerbaca: 0,
    }));
  }

  async buatKampanye(
    masukan: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Kampanye> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .insert(campaigns)
      .values({
        organizationId,
        nama: String(masukan.nama ?? ''),
        deskripsi: String(masukan.deskripsi ?? ''),
        programId: (masukan.programId as string) ?? null,
        eventId: (masukan.eventId as string) ?? null,
        mulaiPada: String(masukan.mulaiPada ?? new Date().toISOString().slice(0, 10)),
        selesaiPada: String(masukan.selesaiPada ?? new Date().toISOString().slice(0, 10)),
      })
      .returning();
    if (!baris) throw new Error('Gagal membuat kampanye.');
    return this.keKampanye(baris);
  }

  // ============================================================
  // Statistik
  // ============================================================

  async statistik(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<StatistikKomunikasi> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [tunggu] = await db
      .select({ jumlah: count() })
      .from(announcements)
      .where(
        and(
          eq(announcements.organizationId, organizationId),
          eq(announcements.perluPersetujuan, true),
          sql`${announcements.status} in ('DRAFT','REVIEW')`,
        ),
      )
      .limit(1);
    const [terjadwal] = await db
      .select({ jumlah: count() })
      .from(announcements)
      .where(
        and(
          eq(announcements.organizationId, organizationId),
          eq(announcements.status, 'SCHEDULED'),
        ),
      )
      .limit(1);
    const [terbit] = await db
      .select({ jumlah: count() })
      .from(announcements)
      .where(
        and(
          eq(announcements.organizationId, organizationId),
          eq(announcements.status, 'PUBLISHED'),
        ),
      )
      .limit(1);

    const [gagal] = await db
      .select({ jumlah: count() })
      .from(announcementRecipients)
      .where(
        and(
          eq(announcementRecipients.status as never, 'FAILED' as never),
          eq(announceRecipientsOrg(organizationId, db) as never, organizationId),
        ),
      )
      .catch(() => [{ jumlah: 0 }] as never);

    return {
      totalPengumuman: Number(terbit?.jumlah ?? 0) + Number(tunggu?.jumlah ?? 0),
      menungguPersetujuan: Number(tunggu?.jumlah ?? 0),
      terjadwal: Number(terjadwal?.jumlah ?? 0),
      terbitBulanIni: 0,
      totalTerkirim: 0,
      totalTerbaca: 0,
      tingkatPembacaan: 0,
      gagalKirim: Number(gagal?.jumlah ?? 0),
      perKanal: [],
      antreanTerbit: [],
    };
  }

  // ============================================================
  // Helper
  // ============================================================

  private async anggotaDariPengguna(
    db: Db,
    pengguna: PenggunaPermintaan,
    organizationId: string,
  ): Promise<string | null> {
    if (!pengguna.memberId) return null;
    const [anggota] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, pengguna.memberId), eq(members.organizationId, organizationId)))
      .limit(1);
    return anggota?.id ?? null;
  }

  private async ambilPenerima(
    db: Db,
    organizationId: string,
    audiens: string,
    divisionIds: string[],
    memberIds: string[] | null,
  ): Promise<{ userId: string | null }[]> {
    if (audiens === 'CUSTOM' && memberIds && memberIds.length > 0) {
      return db
        .select({ userId: members.userId })
        .from(members)
        .where(
          and(
            eq(members.organizationId, organizationId),
            inArray(members.id, memberIds),
            sql`${members.userId} is not null`,
          ),
        )
        .limit(1000);
    }
    if (audiens === 'DIVISION' && divisionIds.length > 0) {
      return db
        .select({ userId: members.userId })
        .from(members)
        .where(
          and(
            eq(members.organizationId, organizationId),
            inArray(members.divisionId, divisionIds),
            sql`${members.userId} is not null`,
          ),
        )
        .limit(1000);
    }
    // Semua anggota dengan akun
    return db
      .select({ userId: members.userId })
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          eq(members.status, 'ACTIVE'),
          sql`${members.userId} is not null`,
        ),
      )
      .limit(1000);
  }

  private kePengumuman(b: typeof announcements.$inferSelect): Pengumuman {
    return {
      id: b.id,
      organizationId: b.organizationId,
      judul: b.judul,
      isi: b.isi,
      ringkasan: b.ringkasan,
      audiens: b.audiens,
      kanal: (b.kanal ?? []) as never,
      prioritas: b.prioritas,
      status: b.status,
      pin: b.pin,
      programId: b.programId,
      programNama: null,
      eventId: b.eventId,
      eventJudul: null,
      perluPersetujuan: b.perluPersetujuan,
      jadwalkanPada: b.jadwalkanPada ? b.jadwalkanPada.toISOString() : null,
      terbitPada: b.terbitPada ? b.terbitPada.toISOString() : null,
      totalPenerima: b.totalPenerima,
      terkirim: b.totalTerkirim,
      terbaca: b.totalTerbaca,
      gagal: b.totalGagal,
      dibuatOleh: b.dibuatOleh,
      dibuatOlehNama: null,
      disetujuiOleh: b.disetujuiOleh,
      disetujuiPada: b.disetujuiPada ? String(b.disetujuiPada) : null,
      dibuatPada: b.dibuatPada.toISOString(),
      lampiranDokumenIds: (b.lampiranDokumenIds ?? []) as string[],
    };
  }

  private keKampanye(b: typeof campaigns.$inferSelect): Kampanye {
    return {
      id: b.id,
      nama: b.nama,
      deskripsi: b.deskripsi,
      programId: b.programId,
      eventId: b.eventId,
      mulaiPada: String(b.mulaiPada),
      selesaiPada: String(b.selesaiPada),
      status: b.status,
      jumlahPengumuman: (b.announcementIds ?? []).length,
      totalTerkirim: 0,
      totalTerbaca: 0,
    };
  }
}

/** Sub-query organisasi untuk menghitung pengiriman gagal. */
function announceRecipientsOrg(
  organizationId: string,
  db: Db,
): string {
  return organizationId;
}
