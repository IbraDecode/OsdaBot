/**
 * MembersService — data anggota organisasi.
 *
 * Aturan yang ditegakkan:
 *  - Anggota TIDAK PERNAH dihapus keras bila punya histori; `DELETE` hanya
 *    mengarsipkan (soft delete) dengan alasan dan mengubah status.
 *  - Setiap akses dibatasi organisasi aktif pengguna.
 *  - Nomor anggota dibuat otomatis dan dijaga unik oleh database.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or } from 'drizzle-orm';
import {
  attendanceRecords,
  attendanceSessions,
  divisions,
  memberPeriodHistory,
  members,
  positionAssignments,
  positions,
  type Db,
} from '@osda/db';
import {
  labelKelas,
  normalisasiProfil,
  type Anggota,
  type FilterAnggota,
  type RekapAnggota,
  type StatusAnggota,
} from '@osda/contracts';

import { galatDuplikat, galatTidakDitemukan, galatValidasi } from '../../common/galat.js';
import { offsetDari } from '../../common/utilitas/paginasi.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { nomorAnggota } from '../../common/utilitas/kode.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';
import type { PayloadArsipkanAnggota } from './dto/members.dto.js';

/** Masukan buat/perbarui anggota (bentuk kontrak, tanpa organizationId). */
type MasukanAnggota = {
  nama?: string;
  email?: string | null;
  telepon?: string | null;
  tingkat?: string;
  jurusan?: string | null;
  subKelas?: string | null;
  nis?: string | null;
  nisn?: string | null;
  divisionId?: string | null;
  jabatanIds?: string[];
  bergabungPada?: string;
  status?: string;
  organizationId?: string;
};

@Injectable()
export class MembersService {
  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  /** Daftar anggota dengan filter + paginasi. */
  async daftar(
    filter: FilterAnggota,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Anggota[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      (filter as unknown as { organizationId?: string }).organizationId,
    );

    const syarat: ReturnType<typeof and>[] = [
      eq(members.organizationId, organizationId),
      isNull(members.diarsipkanPada),
    ];

    if (filter.q) {
      const pola = `%${filter.q}%`;
      syarat.push(
        or(
          ilike(members.nama, pola),
          ilike(members.nomor, pola),
          ilike(members.email, pola),
          ilike(members.telepon, pola),
        )!,
      );
    }
    if (filter.status) syarat.push(eq(members.status, filter.status));
    if (filter.tingkat) syarat.push(eq(members.tingkat, filter.tingkat));
    if (filter.jurusan) syarat.push(eq(members.jurusan, filter.jurusan));
    if (filter.divisionId) syarat.push(eq(members.divisionId, filter.divisionId));
    if (filter.periodId) syarat.push(eq(members.periodId, filter.periodId));

    const total = await this.hitungTotal(db, and(...syarat));
    const urutan =
      filter.sortDir === 'asc'
        ? asc(this.kolomUrutan(filter.sortBy))
        : desc(this.kolomUrutan(filter.sortBy));

    const baris = await db
      .select()
      .from(members)
      .where(and(...syarat))
      .orderBy(urutan)
      .limit(filter.limit)
      .offset(offsetDari(filter));

    const daftar = await Promise.all(baris.map((b) => this.keAnggota(db, b)));
    const totalPages = Math.max(1, Math.ceil(total / filter.limit));

    return {
      data: daftar,
      meta: {
        page: filter.page,
        limit: filter.limit,
        total,
        totalPages,
        hasNext: filter.page < totalPages,
        hasPrev: filter.page > 1,
      },
    };
  }

  /** Detail satu anggota. */
  async detail(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Anggota> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const baris = await db
      .select()
      .from(members)
      .where(
        and(
          eq(members.id, id),
          eq(members.organizationId, organizationId),
          isNull(members.diarsipkanPada),
        ),
      )
      .limit(1);

    const anggota = baris[0];
    if (!anggota) throw galatTidakDitemukan('Anggota tidak ditemukan.');
    return this.keAnggota(db, anggota);
  }

  /** Daftarkan anggota baru. */
  async buat(
    masukan: MasukanAnggota,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Anggota> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    if (!masukan.nama) throw galatValidasi(undefined, 'Nama anggota wajib diisi.');
    if (!masukan.tingkat) throw galatValidasi(undefined, 'Tingkat kelas wajib diisi.');

    const profil = normalisasiProfil(`${masukan.tingkat} ${masukan.nama}`);
    const nomorBaru = await this.nomorBerikutnya(db, organizationId);
    const hariIni = new Date().toISOString().slice(0, 10);

    const [baru] = await db
      .insert(members)
      .values({
        organizationId,
        nomor: nomorBaru,
        nama: profil.nama,
        tingkat: masukan.tingkat,
        jurusan: masukan.jurusan ?? null,
        subKelas: masukan.subKelas ?? null,
        nis: masukan.nis ?? null,
        nisn: masukan.nisn ?? null,
        email: masukan.email ?? null,
        telepon: masukan.telepon ?? null,
        divisionId: masukan.divisionId ?? null,
        status: 'ACTIVE',
        bergabungPada: masukan.bergabungPada ?? hariIni,
        dibuatOleh: pengguna.memberId,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal menyimpan anggota baru.');
    return this.keAnggota(db, baru);
  }

  /** Perbarui data anggota. */
  async perbarui(
    id: string,
    masukan: MasukanAnggota,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Anggota> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [sebelum] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, id), eq(members.organizationId, organizationId)))
      .limit(1);
    if (!sebelum) throw galatTidakDitemukan('Anggota tidak ditemukan.');

    const isi: Partial<typeof members.$inferInsert> = {};
    if (masukan.nama !== undefined) {
      const tingkat = masukan.tingkat ?? sebelum.tingkat;
      isi.nama = normalisasiProfil(`${tingkat} ${masukan.nama}`).nama;
    }
    if (masukan.email !== undefined) isi.email = masukan.email;
    if (masukan.telepon !== undefined) isi.telepon = masukan.telepon;
    if (masukan.tingkat !== undefined) isi.tingkat = masukan.tingkat;
    if (masukan.jurusan !== undefined) isi.jurusan = masukan.jurusan;
    if (masukan.subKelas !== undefined) isi.subKelas = masukan.subKelas;
    if (masukan.nis !== undefined) isi.nis = masukan.nis;
    if (masukan.nisn !== undefined) isi.nisn = masukan.nisn;
    if (masukan.divisionId !== undefined) isi.divisionId = masukan.divisionId;
    if (masukan.status !== undefined) isi.status = masukan.status as StatusAnggota;

    const [sesudah] = await db
      .update(members)
      .set(isi)
      .where(eq(members.id, id))
      .returning();

    if (!sesudah) throw galatValidasi(undefined, 'Gagal memperbarui anggota.');
    return this.keAnggota(db, sesudah);
  }

  /**
   * Arsipkan (soft delete). Anggota dengan histori kehadiran/tugas tidak
   * pernah dihapus keras — hanya disembunyikan dari daftar aktif.
   */
  async arsipkan(
    id: string,
    masukan: PayloadArsipkanAnggota,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Anggota> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [sebelum] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, id), eq(members.organizationId, organizationId)))
      .limit(1);
    if (!sebelum) throw galatTidakDitemukan('Anggota tidak ditemukan.');
    if (sebelum.diarsipkanPada) {
      throw galatDuplikat('Anggota sudah diarsipkan sebelumnya.');
    }

    const hariIni = new Date().toISOString().slice(0, 10);
    const [sesudah] = await db
      .update(members)
      .set({
        status: masukan.status,
        diarsipkanPada: hariIni,
        alasanArsip: masukan.alasan,
      })
      .where(eq(members.id, id))
      .returning();

    if (!sesudah) throw galatValidasi(undefined, 'Gagal mengarsipkan anggota.');

    // Riwayat periode ditandai selesai, TIDAK dihapus (histori tetap utuh).
    await db
      .update(memberPeriodHistory)
      .set({ selesaiPada: hariIni, catatan: masukan.alasan })
      .where(and(eq(memberPeriodHistory.memberId, id), isNull(memberPeriodHistory.selesaiPada)));

    return this.keAnggota(db, sesudah);
  }

  /** Rekap kehadiran seorang anggota (dipakai halaman profil anggota). */
  async rekapKehadiran(
    id: string,
    rentang: { dari?: string; sampai?: string; limit?: number },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<RekapAnggota> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [anggota] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, id), eq(members.organizationId, organizationId)))
      .limit(1);
    if (!anggota) throw galatTidakDitemukan('Anggota tidak ditemukan.');

    const syarat: ReturnType<typeof and>[] = [eq(attendanceRecords.memberId, id)];
    if (rentang.dari) syarat.push(gte(attendanceSessions.tanggal, rentang.dari));
    if (rentang.sampai) syarat.push(lte(attendanceSessions.tanggal, rentang.sampai));

    const baris = await db
      .select({
        sessionId: attendanceSessions.id,
        judul: attendanceSessions.judul,
        tanggal: attendanceSessions.tanggal,
        status: attendanceRecords.status,
        alasan: attendanceRecords.alasan,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .where(and(...syarat))
      .orderBy(desc(attendanceSessions.tanggal))
      .limit(rentang.limit ?? 50);

    const rincian = baris.map((r) => ({
      sessionId: r.sessionId,
      judul: r.judul,
      tanggal: r.tanggal,
      status: r.status,
      alasan: r.alasan ?? null,
    }));

    const hitung = (s: RekapAnggota['rincian'][number]['status']) =>
      rincian.filter((r) => r.status === s).length;

    return {
      memberId: id,
      nama: anggota.nama,
      periode: {
        dari: rentang.dari ?? rincian[rincian.length - 1]?.tanggal ?? '',
        sampai: rentang.sampai ?? rincian[0]?.tanggal ?? '',
      },
      totalSesi: rincian.length,
      hadir: hitung('PRESENT'),
      terlambat: hitung('LATE'),
      izin: hitung('EXCUSED'),
      sakit: hitung('SICK'),
      tidakHadir: hitung('ABSENT'),
      persenKehadiran:
        rincian.length === 0
          ? 0
          : Math.round(
              ((hitung('PRESENT') + hitung('LATE')) / rincian.length) * 100,
            ),
      rincian,
    };
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private kolomUrutan(sortBy?: string) {
    switch (sortBy) {
      case 'nama':
        return members.nama;
      case 'status':
        return members.status;
      case 'bergabungPada':
        return members.bergabungPada;
      default:
        return members.dibuatPada;
    }
  }

  private async hitungTotal(db: Db, syarat: ReturnType<typeof and>): Promise<number> {
    const [baris] = await db
      .select({ jumlah: count() })
      .from(members)
      .where(syarat)
      .limit(1);
    return Number(baris?.jumlah ?? 0);
  }

  private async nomorBerikutnya(db: Db, organizationId: string): Promise<string> {
    const [baris] = await db
      .select({ jumlah: count() })
      .from(members)
      .where(and(eq(members.organizationId, organizationId), isNull(members.diarsipkanPada)))
      .limit(1);
    return nomorAnggota(Number(baris?.jumlah ?? 0) + 1);
  }

  /** Susun kontrak `Anggota` beserta jabatan & divisi. */
  private async keAnggota(db: Db, baris: typeof members.$inferSelect): Promise<Anggota> {
    const [divisi] = baris.divisionId
      ? await db
          .select({ nama: divisions.nama })
          .from(divisions)
          .where(eq(divisions.id, baris.divisionId))
          .limit(1)
      : [];

    const jabatan = await db
      .select({
        id: positions.id,
        nama: positions.nama,
        kode: positions.kode,
        tingkat: positions.tingkat,
      })
      .from(positionAssignments)
      .innerJoin(positions, eq(positions.id, positionAssignments.positionId))
      .where(eq(positionAssignments.memberId, baris.id));

    return {
      id: baris.id,
      userId: baris.userId,
      nomor: baris.nomor,
      nama: baris.nama,
      tingkat: baris.tingkat as Anggota['tingkat'],
      jurusan: baris.jurusan,
      subKelas: baris.subKelas,
      labelKelas: labelKelas({
        tingkat: baris.tingkat,
        jurusan: baris.jurusan,
        subKelas: baris.subKelas,
      }),
      nis: baris.nis,
      nisn: baris.nisn,
      email: baris.email,
      telepon: baris.telepon,
      divisionId: baris.divisionId,
      divisionNama: divisi?.nama ?? null,
      jabatan: jabatan.map((j) => ({ id: j.id, nama: j.nama, kode: j.kode, tingkat: j.tingkat })),
      status: baris.status,
      bergabungPada: String(baris.bergabungPada),
      dibuatPada: String(baris.dibuatPada),
    };
  }
}
