/**
 * AuditService — membaca log audit sensitif.
 *
 * Tabel `audit_logs` bersifat append-only (dijaga trigger database), sehingga
 * modul ini hanya bisa membaca. Tidak ada endpoint untuk mengubah atau
 * menghapus log audit. Nilai rahasia (password, token) tidak pernah tercatat
 * karena sanitasi dilakukan di modul ini dan di `audit.interceptor.ts`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, like, lte, or } from 'drizzle-orm';

import { auditLogs, type Db } from '@osda/db';

import { LayananDatabase } from '../../database/database.service.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { galatIzinDitolak } from '../../common/galat.js';
import { SkemaFilterAudit } from './dto/audit.dto.js';

/** Kolom yang tidak boleh ikut tercatat sebagai perubahan (spec §39). */
const KOLOM_RAHASIA = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'refresh_token_hash',
  'token_hash',
  'secret',
  'apikey',
  'qr_secret',
  'configterenkripsi',
];

@Injectable()
export class AuditService {
  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
  ) {}

  /** Daftar log audit. */
  async daftar(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ) {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaFilterAudit.parseAsync(kueri);
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const syarat = [eq(auditLogs.organizationId, organizationId)];
    if (skema.aksi) syarat.push(eq(auditLogs.aksi, skema.aksi));
    if (skema.entitasTabel) syarat.push(eq(auditLogs.entitasTabel, skema.entitasTabel));
    if (skema.actorId) syarat.push(eq(auditLogs.actorId, skema.actorId));
    if (skema.dari) syarat.push(gte(auditLogs.createdAt, new Date(skema.dari)));
    if (skema.sampai) syarat.push(lte(auditLogs.createdAt, new Date(`${skema.sampai}T23:59:59`)));
    if (skema.q) {
      const pola = `%${skema.q}%`;
      syarat.push(or(like(auditLogs.aksi, pola), like(auditLogs.entitasTabel, pola)) as never);
    }

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(auditLogs)
      .where(and(...syarat))
      .limit(1);

    const total = Number(totalBaris?.jumlah ?? 0);
    const baris = await db
      .select()
      .from(auditLogs)
      .where(and(...syarat))
      .orderBy(desc(auditLogs.createdAt))
      .limit(skema.limit)
      .offset((skema.page - 1) * skema.limit);

    return {
      data: baris.map((b) => this.bentuk(b)),
      meta: {
        page: skema.page,
        limit: skema.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / skema.limit)),
        hasNext: skema.page * skema.limit < total,
        hasPrev: skema.page > 1,
      },
    };
  }

  /**
   * Catat satu aksi sensitif. SELALU dipakai bersama perubahan bisnis dalam
   * satu transaksi supaya log tidak pernah tertinggal.
   *
   * PENTING: `sebelum` dan `sesudah` disanitasi — kunci rahasia dibuang.
   */
  async catat(
    db: Db,
    masukan: {
      organizationId: string | null;
      aksi: string;
      entitasTabel: string;
      entitasId: string | null;
      actorId?: string | null;
      actorMemberId?: string | null;
      sumber: 'API' | 'WEB' | 'MOBILE' | 'WHATSAPP' | 'SYSTEM' | 'MIGRATION';
      ip?: string | null;
      userAgent?: string | null;
      requestId?: string | null;
      sebelum?: Record<string, unknown> | null;
      sesudah?: Record<string, unknown> | null;
      berhasil?: boolean;
      pesanGalat?: string | null;
    },
  ): Promise<void> {
    const sebelum = sanitasi(masukan.sebelum ?? null);
    const sesudah = sanitasi(masukan.sesudah ?? null);
    const fieldDiubah =
      sebelum && sesudah
        ? Object.keys(sesudah).filter((k) => sebelum[k] !== sesudah[k]).join(',') || undefined
        : undefined;

    await db.insert(auditLogs).values({
      organizationId: masukan.organizationId,
      aksi: masukan.aksi,
      entitasTabel: masukan.entitasTabel,
      entitasId: masukan.entitasId,
      actorId: masukan.actorId ?? null,
      actorMemberId: masukan.actorMemberId ?? null,
      sumber: masukan.sumber,
      ip: masukan.ip ?? null,
      userAgent: masukan.userAgent ?? null,
      requestId: masukan.requestId ?? null,
      sebelum,
      sesudah,
      fieldDiubah: fieldDiubah && fieldDiubah.length > 0 ? fieldDiubah : null,
      berhasil: masukan.berhasil ?? true,
      pesanGalat: masukan.pesanGalat ?? null,
    });
  }

  /** Ambil satu baris audit (halaman detail). */
  async detail(id: string, pengguna: PenggunaPermintaan) {
    if (!pengguna.scopes?.includes('SYSTEM')) {
      throw galatIzinDitolak('Anda tidak berwenang membaca log audit.');
    }
    const db = await this.dbSvc.ambilDb();
    const [baris] = await db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
    if (!baris) throw new Error('Log audit tidak ditemukan.');
    return this.bentuk(baris);
  }

  /** Statistik ringkas: jumlah aksi per jenis untuk satu organisasi. */
  async ringkasan(permintaan: PermintaanBerkonteks, pengguna: PenggunaPermintaan) {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const perAksi = await db
      .select({ aksi: auditLogs.aksi, jumlah: count() })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, organizationId))
      .groupBy(auditLogs.aksi)
      .orderBy(desc(count()));

    const [gagal] = await db
      .select({ jumlah: count() })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.berhasil, false)))
      .limit(1);

    return {
      perAksi: perAksi.map((r) => ({ aksi: r.aksi, jumlah: Number(r.jumlah) })),
      aksiGagal: Number(gagal?.jumlah ?? 0),
    };
  }

  private bentuk(b: typeof auditLogs.$inferSelect) {
    return {
      id: b.id,
      aksi: b.aksi,
      entitasTabel: b.entitasTabel,
      entitasId: b.entitasId,
      actorId: b.actorId,
      actorMemberId: b.actorMemberId,
      sumber: b.sumber,
      ip: b.ip,
      userAgent: b.userAgent,
      requestId: b.requestId,
      sebelum: b.sebelum,
      sesudah: b.sesudah,
      fieldDiubah: b.fieldDiubah,
      berhasil: b.berhasil,
      pesanGalat: b.pesanGalat,
      createdAt: b.createdAt.toISOString(),
    };
  }
}

/**
 * Buang kunci rahasia dari payload sebelum ditulis ke audit.
 * Sesuai spec §39: "Secret tidak boleh dicatat".
 */
function sanitasi(obj: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!obj) return null;
  const bersih: Record<string, unknown> = {};
  for (const [kunci, nilai] of Object.entries(obj)) {
    const kecil = kunci.toLowerCase();
    bersih[kunci] = KOLOM_RAHASIA.some((k) => kecil.includes(k)) ? '[DIHAPUS]' : nilai;
  }
  return bersih;
}

export { KOLOM_RAHASIA, sanitasi as sanitasiPayloadAudit };
