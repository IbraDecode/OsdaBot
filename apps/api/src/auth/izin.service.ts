/**
 * Resolusi izin efektif seorang pengguna.
 *
 * Sumber kebenaran akhir = database (`member_roles` → `roles` →
 * `role_permissions` → `permissions`), bukan daftar hardcode di kode. Paket
 * izin bawaan dari `@osda/contracts` (`MATRICS_PERAN`) hanya dipakai sebagai
 * nilai awal bila database belum berisi peran untuk anggota tersebut.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { satukanIzinBawaan } from '@osda/auth';
import { MATRICS_PERAN, type Cakupan } from '@osda/contracts';
import {
  memberRoles,
  members,
  permissions,
  rolePermissions,
  roles,
  users,
  type Db,
} from '@osda/db';

import { LayananDatabase } from '../database/database.service.js';

/** Ringkasan izin efektif satu pengguna. */
export interface IzinEfektif {
  readonly userId: string;
  readonly nama: string;
  readonly status: string;
  readonly memberId: string | null;
  readonly organizationIds: readonly string[];
  readonly peran: readonly { kode: string; nama: string; cakupan: Cakupan[] }[];
  readonly izin: readonly string[];
  readonly scopes: readonly Cakupan[];
}

@Injectable()
export class LayananIzin {
  private readonly pencatat = new Logger('Izin');
  /** Kedalaman maksimal pewarisan peran (mencegah siklus tak berujung). */
  private static readonly MAKS_WARISAN = 4;

  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  /** Muat izin efektif; mengembalikan paket bawaan bila database kosong. */
  async muatIzinEfektif(userId: string): Promise<IzinEfektif> {
    const db = await this.dbSvc.ambilDb();

    const [pengguna] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!pengguna) {
      throw new Error(`Pengguna ${userId} tidak ditemukan.`);
    }

    const daftarAnggota = await db
      .select()
      .from(members)
      .where(eq(members.userId, userId))
      .orderBy(asc(members.bergabungPada));

    const organizationIds = [...new Set(daftarAnggota.map((m) => m.organizationId))];
    const anggotaAktif =
      daftarAnggota.find((m) => m.status === 'ACTIVE') ?? daftarAnggota[0] ?? null;
    const memberId = anggotaAktif?.id ?? null;

    const idPeran = memberId
      ? await this.ambilIdPeranAktif(db, memberId)
      : [];

    const barisPeran = idPeran.length
      ? await db.select().from(roles).where(inArray(roles.id, idPeran))
      : [];

    const idPeranLengkap = await this.lengkapiWarisan(db, barisPeran.map((r) => r.id));
    const semuaPeran =
      idPeranLengkap.length === barisPeran.length
        ? barisPeran
        : await db.select().from(roles).where(inArray(roles.id, idPeranLengkap));

    const { izin, scopes } = await this.ambilIzinPeran(db, semuaPeran.map((r) => r.id));

    const punyaPeran = semuaPeran.length > 0 && izin.length > 0;
    if (!punyaPeran) {
      // Database belum berisi peran untuk anggota ini — pakai paket bawaan.
      const bawaan = satukanIzinBawaan(['MEMBER']);
      return {
        userId,
        nama: pengguna.nama,
        status: pengguna.status,
        memberId,
        organizationIds,
        peran: [
          {
            kode: 'MEMBER',
            nama: MATRICS_PERAN.MEMBER.nama,
            cakupan: [...MATRICS_PERAN.MEMBER.cakupan],
          },
        ],
        izin: [...bawaan.izin],
        scopes: [...bawaan.cakupan],
      };
    }

    const petaCakupan = new Map(semuaPeran.map((r) => [r.id, r.cakupanDefault]));
    return {
      userId,
      nama: pengguna.nama,
      status: pengguna.status,
      memberId,
      organizationIds,
      peran: semuaPeran.map((r) => ({
        kode: r.kode,
        nama: r.nama,
        cakupan: [petaCakupan.get(r.id) ?? 'OWN'] as Cakupan[],
      })),
      izin: [...izin],
      scopes: [...scopes],
    };
  }

  /** Peran yang sedang berlaku untuk seorang anggota (belum dicabut, belum selesai). */
  private async ambilIdPeranAktif(
    db: Db,
    memberId: string,
  ): Promise<string[]> {
    const hariIni = new Date().toISOString().slice(0, 10);
    const baris = await db
      .select({ roleId: memberRoles.roleId, selesaiPada: memberRoles.selesaiPada })
      .from(memberRoles)
      .where(
        and(
          eq(memberRoles.memberId, memberId),
          isNull(memberRoles.dicabutPada),
          or(isNull(memberRoles.selesaiPada), sql`${memberRoles.selesaiPada} >= ${hariIni}`),
        ),
      );
    return [...new Set(baris.map((b) => b.roleId))];
  }

  /** Tambahkan peran induk hasil pewarisan (`warisi_dari_kode`) secara bertingkat. */
  private async lengkapiWarisan(
    db: Db,
    idAwal: readonly string[],
  ): Promise<string[]> {
    const terkumpul = new Set<string>(idAwal);
    const terlihat = new Set<string>(idAwal);

    for (let tingkat = 0; tingkat < LayananIzin.MAKS_WARISAN; tingkat += 1) {
      const kandidat = [...terlihat].filter((id) => !terkumpul.has(id));
      if (kandidat.length === 0) break;

      const barisInduk = await db
        .select({ id: roles.id, warisiDariKode: roles.warisiDariKode })
        .from(roles)
        .where(inArray(roles.id, kandidat));

      terlihat.clear();
      for (const baris of barisInduk) {
        if (!baris.warisiDariKode) continue;
        const [induk] = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.kode, baris.warisiDariKode))
          .limit(1);
        if (induk) {
          terlihat.add(induk.id);
          if (!terkumpul.has(induk.id)) terkumpul.add(induk.id);
        }
      }
    }

    return [...terkumpul];
  }

  /** Gabungkan izin + cakupan dari beberapa peran. */
  private async ambilIzinPeran(
    db: Db,
    idPeran: readonly string[],
  ): Promise<{ izin: string[]; scopes: Cakupan[] }> {
    const izin = new Set<string>();
    const scopes = new Set<Cakupan>();
    if (idPeran.length === 0) return { izin: [], scopes: [] };

    const baris = await db
      .select({
        kode: permissions.kode,
        cakupan: rolePermissions.cakupan,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(rolePermissions.roleId, [...idPeran]));

    for (const b of baris) {
      izin.add(b.kode);
      scopes.add(b.cakupan);
    }

    return { izin: [...izin], scopes: [...scopes] };
  }
}
