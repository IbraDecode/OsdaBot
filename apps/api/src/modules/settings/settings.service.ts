/**
 * SettingsService — organisasi, periode kepengurusan, jabatan, divisi,
 * pengaturan sistem, dan feature flag.
 *
 * Prinsip pergantian periode (spec §85–§86):
 *  - Saat periode baru dibuat, data lama tidak pernah dihapus.
 *  - Periode lama diarsipkan (`ARCHIVED`), periode baru menjadi `ACTIVE`.
 *  - Keanggotaan, absensi, keuangan, dan dokumen periode lama tetap utuh.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import {
  divisions,
  featureFlags,
  members,
  organizationPeriods,
  organizations,
  positions,
  settings,
  type Db,
} from '@osda/db';
import {
  type Organisasi,
  type Periode,
  SkemaBuatDivisi,
  SkemaBuatJabatan,
  SkemaBuatOrganisasi,
  SkemaBuatPeriode,
} from '@osda/contracts';

import { LayananDatabase } from '../../database/database.service.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
    @Inject(AuditService) private readonly auditSvc: AuditService,
  ) {}

  // ============================================================
  // Organisasi
  // ============================================================

  async daftarOrganisasi(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Organisasi[]> {
    const db = await this.dbSvc.ambilDb();
    const baris = await db
      .select()
      .from(organizations)
      .where(eq(organizations.aktif, true))
      .limit(50);
    return baris.map((o) => ({
      id: o.id,
      nama: o.nama,
      singkat: o.singkat,
      jenis: o.jenis,
      namaSekolah: o.namaSekolah,
      zonaWaktu: o.zonaWaktu,
      aktif: o.aktif,
    }));
  }

  async buatOrganisasi(masukan: unknown, pengguna: PenggunaPermintaan): Promise<Organisasi> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaBuatOrganisasi.parseAsync(masukan);
    const [baris] = await db
      .insert(organizations)
      .values({
        nama: skema.nama,
        singkat: skema.singkat,
        jenis: skema.jenis,
        namaSekolah: skema.namaSekolah,
        npsn: skema.npsn ?? null,
        alamat: skema.alamat ?? null,
        kodePos: skema.kodePos ?? null,
        telepon: skema.telepon ?? null,
        email: skema.email ?? null,
        zonaWaktu: skema.zonaWaktu,
      })
      .returning();
    if (!baris) throw new Error('Gagal membuat organisasi.');
    return this.keOrganisasi(baris);
  }

  // ============================================================
  // Divisi & jabatan
  // ============================================================

  async daftarDivisi(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; nama: string; kode: string; deskripsi: string | null; aktif: boolean }[]> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const baris = await db
      .select()
      .from(divisions)
      .where(and(eq(divisions.organizationId, organizationId), eq(divisions.aktif, true)))
      .limit(100);
    return baris.map((d) => ({
      id: d.id,
      nama: d.nama,
      kode: d.kode,
      deskripsi: d.deskripsi,
      aktif: d.aktif,
    }));
  }

  async buatDivisi(masukan: unknown, permintaan: PermintaanBerkonteks, pengguna: PenggunaPermintaan) {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaBuatDivisi.parseAsync(masukan);
    const [baris] = await db
      .insert(divisions)
      .values({
        organizationId: skema.organizationId,
        periodId: skema.periodId,
        nama: skema.nama,
        kode: skema.kode,
        deskripsi: skema.deskripsi ?? null,
        idDivisiInduk: skema.idDivisiInduk ?? null,
        koordinatorMemberId: skema.koordinatorMemberId ?? null,
      })
      .returning();
    return baris;
  }

  async daftarJabatan(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    return db
      .select()
      .from(positions)
      .where(and(eq(positions.organizationId, organizationId), eq(positions.aktif, true)))
      .limit(200);
  }

  async buatJabatan(masukan: unknown, permintaan: PermintaanBerkonteks, pengguna: PenggunaPermintaan) {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaBuatJabatan.parseAsync(masukan);
    const [baris] = await db
      .insert(positions)
      .values({
        organizationId: skema.organizationId,
        nama: skema.nama,
        kode: skema.kode,
        tingkat: skema.tingkat,
        urutan: skema.urutan,
        deskripsi: skema.deskripsi ?? null,
      })
      .returning();
    return baris;
  }

  // ============================================================
  // Periode kepengurusan & pergantian
  // ============================================================

  async daftarPeriode(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Periode[]> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const baris = await db
      .select()
      .from(organizationPeriods)
      .where(eq(organizationPeriods.organizationId, organizationId))
      .orderBy(organizationPeriods.mulaiPada);
    return baris.map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      nama: p.nama,
      mulaiPada: String(p.mulaiPada),
      selesaiPada: String(p.selesaiPada),
      status: p.status,
    }));
  }

  /**
   * Buat periode kepengurusan baru. Periode lama yang masih ACTIVE otomatis
   * diarsipkan agar hanya ada satu periode aktif per organisasi
   * (dijaga unique index `uq_periode_aktif`).
   */
  async buatPeriode(
    masukan: unknown,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Periode> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaBuatPeriode.parseAsync(masukan);

    const baru = await db.transaction(async (tx) => {
      // 1) Arsipkan periode ACTIVE yang lama (spec §86: jangan hapus histori)
      await tx
        .update(organizationPeriods)
        .set({ status: 'ARCHIVED', diarsipkanPada: new Date().toISOString().slice(0, 10) })
        .where(
          and(
            eq(organizationPeriods.organizationId, skema.organizationId),
            eq(organizationPeriods.status, 'ACTIVE'),
          ),
        );

      // 2) Buat periode baru
      const [periode] = await tx
        .insert(organizationPeriods)
        .values({
          organizationId: skema.organizationId,
          nama: skema.nama,
          mulaiPada: skema.mulaiPada,
          selesaiPada: skema.selesaiPada,
          status: 'ACTIVE',
        })
        .returning();

      if (!periode) throw new Error('Gagal membuat periode kepengurusan.');

      // 3) Catat audit agar keputusan penting terekam
      await this.auditSvc.catat(tx as never, {
        organizationId: skema.organizationId,
        aksi: 'PERIOD_ARCHIVED',
        entitasTabel: 'organization_periods',
        entitasId: periode.id,
        actorId: pengguna.sub,
        actorMemberId: pengguna.memberId,
        sumber: 'API',
        requestId: permintaan.requestId,
        ip: permintaan.ip ?? null,
        userAgent: this.userAgentDari(permintaan),
        sebelum: null,
        sesudah: { nama: periode.nama, mulaiPada: periode.mulaiPada, selesaiPada: periode.selesaiPada },
      });

      return periode;
    });

    if (!baru) throw new Error('Gagal membuat periode kepengurusan.');
    return this.kePeriode(baru);
  }

  // ============================================================
  // Pengaturan & feature flag
  // ============================================================

  async daftarPengaturan(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    return db
      .select()
      .from(settings)
      .where(eq(settings.organizationId, organizationId))
      .limit(200);
  }

  async simpanPengaturan(
    masukan: { kunci: string; nilai: string },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .insert(settings)
      .values({ organizationId, kunci: masukan.kunci, nilai: masukan.nilai, diubahOleh: pengguna.sub })
      .onConflictDoUpdate({
        target: [settings.organizationId, settings.kunci],
        set: { nilai: masukan.nilai, diubahOleh: pengguna.sub },
      })
      .returning();
    return baris;
  }

  async daftarFeatureFlag(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    return db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.organizationId, organizationId))
      .limit(50);
  }

  async perbaruiFeatureFlag(
    id: string,
    status: 'ON' | 'OFF',
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .update(featureFlags)
      .set({ status, diubahOleh: pengguna.sub })
      .where(and(eq(featureFlags.id, id), eq(featureFlags.organizationId, organizationId)))
      .returning();
    return baris;
  }

  // ============================================================
  // Helper
  // ============================================================

  private userAgentDari(p: PermintaanBerkonteks): string | null {
    const ua = p.headers?.['user-agent'];
    if (typeof ua === 'string') return ua.slice(0, 400);
    return null;
  }

  private keOrganisasi(b: typeof organizations.$inferSelect): Organisasi {
    return {
      id: b.id,
      nama: b.nama,
      singkat: b.singkat,
      jenis: b.jenis,
      namaSekolah: b.namaSekolah,
      zonaWaktu: b.zonaWaktu,
      aktif: b.aktif,
    };
  }

  private kePeriode(b: typeof organizationPeriods.$inferSelect): Periode {
    return {
      id: b.id,
      organizationId: b.organizationId,
      nama: b.nama,
      mulaiPada: String(b.mulaiPada),
      selesaiPada: String(b.selesaiPada),
      status: b.status,
    };
  }
}

/** Fungsi untuk memastikan `organizationId` bernilai null menentukan is_null. */
function fiy(nilai: unknown): unknown {
  return nilai;
}
