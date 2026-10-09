/**
 * ProgramsService — program kerja: alur status, tim, milestone, evaluasi.
 *
 * Aturan utama:
 *  - Transisi status WAJIB memakai `bolehTransisiProgram` dari kontrak
 *    (DRAFT → PROPOSED → APPROVED → PLANNED → RUNNING → COMPLETED).
 *  - Koreksi khusus (mis. COMPLETED → RUNNING) hanya boleh lewat
 *    `TRANSISI_KOREKSI_PROGRAM` dengan tanda `koreksiPrivileged`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  bolehTransisiProgram,
  TRANSISI_KOREKSI_PROGRAM,
  type FilterProgram,
  type PayloadBuatProgram,
  type Program,
  type StatusProgram,
  type SkemaEvaluasiProgram,
  type SkemaTambahTonggakWaktu,
} from '@osda/contracts';
import {
  divisions,
  members,
  programMembers,
  programMilestones,
  programEvaluations,
  programs,
  tasks,
  type Db,
} from '@osda/db';

import { hariTersisa } from '@osda/domain';
import { galatKonflik, galatTidakDitemukan, galatTransisi, galatValidasi } from '../../common/galat.js';
import { offsetDari } from '../../common/utilitas/paginasi.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { kodeDenganAwalan } from '../../common/utilitas/kode.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';

@Injectable()
export class ProgramsService {
  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  // ============================================================
  // Daftar & detail
  // ============================================================

  async daftar(
    filter: FilterProgram,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Program[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      filter.organizationId,
    );

    const syarat: ReturnType<typeof and>[] = [eq(programs.organizationId, organizationId)];
    if (filter.status) syarat.push(eq(programs.status, filter.status));
    if (filter.divisionId) syarat.push(eq(programs.divisionId, filter.divisionId));
    if (filter.ownerMemberId) syarat.push(eq(programs.ownerMemberId, filter.ownerMemberId));
    if (filter.rentang?.dari) syarat.push(gte(programs.selesaiPada, String(filter.rentang?.dari)));
    if (filter.rentang?.sampai) syarat.push(lte(programs.mulaiPada, String(filter.rentang?.sampai)));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(programs)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(programs)
      .where(and(...syarat))
      .orderBy(desc(programs.selesaiPada))
      .limit(filter.limit)
      .offset(offsetDari(filter));

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / filter.limit));
    const data = await Promise.all(baris.map((b) => this.keProgram(db, b)));

    return {
      data,
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

  async detail(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Program> {
    const db = await this.dbSvc.ambilDb();
    const baris = await this.ambilProgram(db, id, permintaan, pengguna);
    return this.keProgram(db, baris);
  }

  async buat(
    masukan: PayloadBuatProgram,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Program> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const kode = `PRG-${new Date().getFullYear()}-${kodeDenganAwalan('').trim()}`;

    const [baru] = await db
      .insert(programs)
      .values({
        organizationId,
        divisionId: masukan.divisionId ?? null,
        kode,
        nama: masukan.nama,
        tujuan: masukan.tujuan,
        deskripsi: masukan.deskripsi ?? null,
        status: 'DRAFT',
        prioritas: masukan.prioritas,
        ownerMemberId: masukan.ownerMemberId,
        anggaranDiajukan: masukan.anggaranDiajukan ?? 0,
        mulaiPada: masukan.mulaiPada,
        selesaiPada: masukan.selesaiPada,
        indikator: masukan.indikator,
        dibuatOleh: pengguna.memberId,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat program kerja.');

    const anggota = [masukan.ownerMemberId, ...masukan.timMemberIds].filter(
      (id, i, arr) => arr.indexOf(id) === i,
    );
    await db
      .insert(programMembers)
      .values(
        anggota.map((memberId) => ({
          programId: baru.id,
          memberId,
          peran: memberId === masukan.ownerMemberId ? 'OWNER' : 'ANGGOTA',
        })),
      )
      .onConflictDoNothing();

    return this.keProgram(db, baru);
  }

  async perbarui(
    id: string,
    masukan: Partial<PayloadBuatProgram>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Program> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilProgram(db, id, permintaan, pengguna);

    const isi: Partial<typeof programs.$inferInsert> = {};
    if (typeof masukan.nama === 'string') isi.nama = masukan.nama;
    if (typeof masukan.tujuan === 'string') isi.tujuan = masukan.tujuan;
    if (masukan.deskripsi !== undefined) isi.deskripsi = masukan.deskripsi;
    if (typeof masukan.divisionId === 'string') isi.divisionId = masukan.divisionId;
    if (typeof masukan.mulaiPada === 'string') isi.mulaiPada = masukan.mulaiPada;
    if (typeof masukan.selesaiPada === 'string') isi.selesaiPada = masukan.selesaiPada;
    if (masukan.anggaranDiajukan !== undefined) isi.anggaranDiajukan = masukan.anggaranDiajukan;
    if (masukan.indikator !== undefined) isi.indikator = masukan.indikator;

    await db.update(programs).set(isi).where(eq(programs.id, id));

    const [setelah] = await db.select().from(programs).where(eq(programs.id, id)).limit(1);
    if (!setelah) throw galatTidakDitemukan('Program tidak ditemukan.');
    return this.keProgram(db, setelah);
  }

  /**
   * Ubah status program. Tanpa `koreksiPrivileged`, hanya transisi normal dari
   * `TRANSISI_PROGRAM` yang diizinkan.
   */
  async ubahStatus(
    id: string,
    masukan: { status: StatusProgram; komentar?: string; koreksiPrivileged?: boolean },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; status: StatusProgram }> {
    const db = await this.dbSvc.ambilDb();
    const program = await this.ambilProgram(db, id, permintaan, pengguna);
    const tujuan = masukan.status;

    const sah = masukan.koreksiPrivileged
      ? TRANSISI_KOREKSI_PROGRAM[program.status].includes(tujuan)
      : bolehTransisiProgram(program.status, tujuan);

    if (!sah) {
      throw galatTransisi(
        `Transisi status ${program.status} → ${tujuan} tidak diizinkan` +
          `${masukan.koreksiPrivileged ? ' (koreksi)' : ''}.`,
      );
    }

    const hariIni = new Date().toISOString().slice(0, 10);
    const isi: Partial<typeof programs.$inferInsert> = { status: tujuan };

    if (tujuan === 'APPROVED') {
      isi.disetujuiOleh = pengguna.memberId;
      isi.disetujuiPada = hariIni;
      isi.anggaranDisetujui = program.anggaranDiajukan;
    }
    if (tujuan === 'RUNNING') isi.mulaiRiwayatPada = hariIni;
    if (tujuan === 'COMPLETED') isi.selesaiRiwayatPada = hariIni;
    if (tujuan === 'CANCELLED') {
      isi.dibatalkanPada = hariIni;
      isi.alasanPembatalan = masukan.komentar ?? null;
    }

    await db.update(programs).set(isi).where(eq(programs.id, id));
    return { id, status: tujuan };
  }

  // ============================================================
  // Tim, milestone, evaluasi
  // ============================================================

  async tambahTim(
    id: string,
    masukan: { memberIds: string[]; peran: string; deskripsiPeran?: string | null },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ ditambahkan: number }> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilProgram(db, id, permintaan, pengguna);

    await db
      .insert(programMembers)
      .values(
        masukan.memberIds.map((memberId) => ({
          programId: id,
          memberId,
          peran: masukan.peran,
          deskripsiPeran: masukan.deskripsiPeran ?? null,
        })),
      )
      .onConflictDoNothing();

    return { ditambahkan: masukan.memberIds.length };
  }

  async tambahMilestone(
    id: string,
    masukan: z.infer<typeof SkemaTambahTonggakWaktu>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string }> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilProgram(db, id, permintaan, pengguna);

    const [baru] = await db
      .insert(programMilestones)
      .values({
        programId: id,
        nama: masukan.nama,
        deskripsi: masukan.deskripsi ?? null,
        tanggal: masukan.tanggal,
        selesai: masukan.selesai,
        dibuatOleh: pengguna.memberId,
      })
      .returning({ id: programMilestones.id });

    return { id: baru?.id ?? '' };
  }

  async tambahEvaluasi(
    id: string,
    masukan: z.infer<typeof SkemaEvaluasiProgram>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string }> {
    const db = await this.dbSvc.ambilDb();
    const program = await this.ambilProgram(db, id, permintaan, pengguna);

    if (program.status !== 'COMPLETED') {
      throw galatKonflik('Evaluasi hanya boleh ditulis setelah program berstatus COMPLETED.');
    }

    const [baru] = await db
      .insert(programEvaluations)
      .values({
        programId: id,
        capaian: masukan.capaian,
        kendala: masukan.kendala ?? null,
        pelajaran: masukan.pelajaran ?? null,
        rekomendasi: masukan.rekomendasi ?? null,
        skorKualitas: masukan.skorKualitas !== undefined ? String(masukan.skorKualitas) : null,
        dievaluasiOleh: pengguna.memberId,
        publik: false,
      })
      .returning({ id: programEvaluations.id });

    return { id: baru?.id ?? '' };
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private async ambilProgram(
    db: Db,
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<typeof programs.$inferSelect> {
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .select()
      .from(programs)
      .where(and(eq(programs.id, id), eq(programs.organizationId, organizationId)))
      .limit(1);
    if (!baris) throw galatTidakDitemukan('Program kerja tidak ditemukan.');
    return baris;
  }

  private async keProgram(db: Db, b: typeof programs.$inferSelect): Promise<Program> {
    const [owner] = await db
      .select({ nama: members.nama })
      .from(members)
      .where(eq(members.id, b.ownerMemberId))
      .limit(1);

    const [divisi] = b.divisionId
      ? await db.select({ nama: divisions.nama }).from(divisions).where(eq(divisions.id, b.divisionId)).limit(1)
      : [];

    const [tugasBaris] = await db
      .select({ total: count(), selesai: sql<number>`count(*) filter (where ${tasks.status} = 'DONE')` })
      .from(tasks)
      .where(eq(tasks.programId, b.id))
      .limit(1);

    const tim = await db
      .select({
        memberId: members.id,
        nama: members.nama,
        peran: programMembers.peran,
      })
      .from(programMembers)
      .innerJoin(members, eq(members.id, programMembers.memberId))
      .where(eq(programMembers.programId, b.id));

    const terlambat = b.selesaiPada < this.hariIni() && b.status !== 'COMPLETED' && b.status !== 'CANCELLED';

    return {
      id: b.id,
      kode: b.kode,
      organizationId: b.organizationId,
      periodId: b.periodId,
      nama: b.nama,
      tujuan: b.tujuan,
      deskripsi: b.deskripsi,
      status: b.status,
      prioritas: b.prioritas,
      divisionId: b.divisionId,
      divisionNama: divisi?.nama ?? null,
      ownerMemberId: b.ownerMemberId,
      ownerNama: owner?.nama ?? '',
      mulaiPada: b.mulaiPada,
      selesaiPada: b.selesaiPada,
      hariTersisa: hariTersisa(b.selesaiPada),
      overdue: terlambat,
      anggaranDiajukan: b.anggaranDiajukan,
      anggaranDisetujui: b.anggaranDisetujui,
      realisasiPengeluaran: b.realisasiPengeluaran,
      progres: b.progres,
      jumlahTugas: Number(tugasBaris?.total ?? 0),
      tugasSelesai: Number(tugasBaris?.selesai ?? 0),
      tim: tim.map((t) => ({ memberId: t.memberId, nama: t.nama, peran: t.peran, jabatan: null })),
      indikator: [...b.indikator],
      dibuatPada: String(b.dibuatPada),
      disetujuiPada: b.disetujuiPada ? String(b.disetujuiPada) : null,
    };
  }

  private hariIni(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
