/**
 * TasksService — tugas, penugasan, verifikasi, dan riwayat aktivitas.
 *
 * Aturan inti (spec tugas):
 *  - DONE belum berarti VERIFIED: tugas yang `butuh_verifikasi` hanya ditutup
 *    setelah diverifikasi lewat izin `task.verify` oleh orang lain.
 *  - Setiap perubahan status dicatat di `task_activity` (audit + activity feed).
 *  - Transisi status WAJIB divalidasi dengan `bolehTransisiTugas` dari kontrak.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { dalamTransaksi } from '@osda/db';
import { z } from 'zod';
import {
  SkemaUbahStatusTugas,
  SkemaVerifikasiTugas,
  bolehTransisiTugas,
  labelKelas,
  type FilterTugas,
  type PayloadBuatTugas,
  type Tugas,
} from '@osda/contracts';
import {
  divisions,
  programs,
  taskAssignees,
  taskActivity,
  members,
  tasks,
  type Db,
} from '@osda/db';

import { hariTersisa } from '@osda/domain';
import { galatIzinDitolak, galatTidakDitemukan, galatTransisi, galatValidasi } from '../../common/galat.js';
import { offsetDari } from '../../common/utilitas/paginasi.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { kodeTugas } from '../../common/utilitas/kode.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';
import { SkemaKomentarTugas } from './dto/tasks.dto.js';

@Injectable()
export class TasksService {
  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  // ============================================================
  // Daftar & detail
  // ============================================================

  async daftar(
    filter: FilterTugas,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Tugas[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      filter.organizationId,
    );

    const syarat: ReturnType<typeof and>[] = [eq(tasks.organizationId, organizationId)];
    if (filter.programId) syarat.push(eq(tasks.programId, filter.programId));
    if (filter.divisionId) syarat.push(eq(tasks.divisionId, filter.divisionId));
    if (filter.status) syarat.push(eq(tasks.status, filter.status));
    if (filter.prioritas) syarat.push(eq(tasks.prioritas, filter.prioritas));
    if (filter.butuhVerifikasi !== undefined) {
      syarat.push(eq(tasks.butuhVerifikasi, filter.butuhVerifikasi));
    }
    if (filter.overdue) {
      syarat.push(sql`${tasks.batasWaktu} is not null and ${tasks.batasWaktu} < ${this.hariIni()}`);
    }
    if (filter.assigneeMemberId) {
      const idTugas = await db
        .select({ taskId: taskAssignees.taskId })
        .from(taskAssignees)
        .where(eq(taskAssignees.memberId, filter.assigneeMemberId));
      if (idTugas.length === 0) {
        return {
          data: [],
          meta: { page: filter.page, limit: filter.limit, total: 0, totalPages: 1, hasNext: false, hasPrev: false },
        };
      }
      syarat.push(inArray(tasks.id, idTugas.map((t) => t.taskId)));
    }

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(tasks)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(tasks)
      .where(and(...syarat))
      .orderBy(desc(tasks.batasWaktu), desc(tasks.dibuatPada))
      .limit(filter.limit)
      .offset(offsetDari(filter));

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / filter.limit));
    const data = await Promise.all(baris.map((b) => this.keTugas(db, b)));

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
  ): Promise<Tugas> {
    const db = await this.dbSvc.ambilDb();
    const baris = await this.ambilTugas(db, id, permintaan, pengguna);
    return this.keTugas(db, baris);
  }

  async buat(
    masukan: PayloadBuatTugas,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Tugas> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const kode = kodeTugas(new Date().getFullYear(), await this.urutanBerikutnya(db, organizationId));

    const hasil = await dalamTransaksi(db, async (tx: Db) => {
      const [baru] = await tx
        .insert(tasks)
        .values({
          organizationId,
          periodId: null,
          programId: masukan.programId ?? null,
          meetingId: masukan.meetingId ?? null,
          divisionId: masukan.divisionId ?? null,
          divisionTujuanId: masukan.divisionTujuanId ?? null,
          parentId: masukan.parentId ?? null,
          kode,
          judul: masukan.judul,
          deskripsi: masukan.deskripsi ?? null,
          status: 'TODO',
          verifikasi: 'UNVERIFIED',
          butuhVerifikasi: masukan.butuhVerifikasi,
          prioritas: masukan.prioritas,
          batasWaktu: masukan.batasWaktu ?? null,
          lampiranDokumenIds: masukan.lampiranIds ?? [],
          dibuatOleh: pengguna.memberId,
        })
        .returning();

      if (!baru) throw galatValidasi(undefined, 'Gagal membuat tugas.');

      await tx
        .insert(taskAssignees)
        .values(
          masukan.assigneeMemberIds.map((memberId, indeks) => ({
            taskId: baru.id,
            memberId,
            utama: indeks === 0,
            ditugaskanOleh: pengguna.memberId,
          })),
        )
        .onConflictDoNothing();

      await tx.insert(taskActivity).values({
        taskId: baru.id,
        memberId: pengguna.memberId,
        tipe: 'DIBUAT',
        isi: `Tugas ${baru.kode} dibuat.`,
        statusSesudah: 'TODO',
      });

      return baru;
    });

    return this.keTugas(db, hasil);
  }

  async perbarui(
    id: string,
    masukan: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Tugas> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilTugas(db, id, permintaan, pengguna);

    const isi: Partial<typeof tasks.$inferInsert> = {};
    if (typeof masukan.judul === 'string') isi.judul = masukan.judul;
    if (masukan.deskripsi !== undefined) isi.deskripsi = masukan.deskripsi as string | null;
    if (typeof masukan.prioritas === 'string') {
      isi.prioritas = masukan.prioritas as typeof tasks.$inferInsert.prioritas;
    }
    if (masukan.batasWaktu !== undefined) isi.batasWaktu = masukan.batasWaktu as string | null;
    if (typeof masukan.divisionId === 'string') isi.divisionId = masukan.divisionId;
    if (typeof masukan.butuhVerifikasi === 'boolean') isi.butuhVerifikasi = masukan.butuhVerifikasi;

    await db.update(tasks).set(isi).where(eq(tasks.id, id));

    const [setelah] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!setelah) throw galatTidakDitemukan('Tugas tidak ditemukan.');
    return this.keTugas(db, setelah);
  }

  // ============================================================
  // Status, verifikasi, komentar
  // ============================================================

  /**
   * Ubah status tugas. Transisi divalidasi dengan `bolehTransisiTugas`;
   * pindah ke DONE pada tugas yang butuh verifikasi TIDAK otomatis VERIFIED.
   */
  async ubahStatus(
    id: string,
    masukan: z.infer<typeof SkemaUbahStatusTugas>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; status: string }> {
    const db = await this.dbSvc.ambilDb();
    const tugas = await this.ambilTugas(db, id, permintaan, pengguna);
    const tujuan = masukan.status as (typeof tasks.$inferSelect)['status'];

    if (!bolehTransisiTugas(tugas.status, tujuan)) {
      throw galatTransisi(
        `Transisi status ${tugas.status} → ${tujuan} tidak diizinkan.`,
      );
    }

    if (tugas.status === 'BLOCKED' && tujuan !== 'CANCELLED' && !masukan.alasan) {
      throw galatValidasi(
        { field: 'alasan' },
        'Alasan wajib diisi ketika membuka blokir tugas.',
      );
    }

    const hariIni = this.hariIni();
    await db
      .update(tasks)
      .set({
        status: tujuan,
        mulaiDikerjakanPada: tujuan === 'IN_PROGRESS' ? hariIni : tugas.mulaiDikerjakanPada,
        selesaiPada: tujuan === 'DONE' ? hariIni : null,
      })
      .where(eq(tasks.id, id));

    await db.insert(taskActivity).values({
      taskId: id,
      memberId: pengguna.memberId,
      tipe: 'STATUS',
      isi: masukan.catatan ?? masukan.alasan ?? `Status diubah menjadi ${tujuan}.`,
      statusSebelum: tugas.status,
      statusSesudah: tujuan,
    });

    return { id, status: tujuan };
  }

  /**
   * Verifikasi tugas oleh penguji (izun `task.verify`). Pemohon tidak boleh
   * memverifikasi tugasnya sendiri — dicek lewat daftar penugasan.
   */
  async verifikasi(
    id: string,
    masukan: z.infer<typeof SkemaVerifikasiTugas>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; verifikasi: string }> {
    const db = await this.dbSvc.ambilDb();
    const tugas = await this.ambilTugas(db, id, permintaan, pengguna);

    if (tugas.status !== 'DONE') {
      throw galatTransisi(
        `Tugas berstatus ${tugas.status} — hanya tugas DONE yang bisa diverifikasi.`,
      );
    }

    if (pengguna.memberId) {
      const [sebagaiAssignee] = await db
        .select({ id: taskAssignees.id })
        .from(taskAssignees)
        .where(
          and(eq(taskAssignees.taskId, id), eq(taskAssignees.memberId, pengguna.memberId)),
        )
        .limit(1);
      if (sebagaiAssignee) {
        throw galatIzinDitolak('Penanggung jawab tugas tidak boleh memverifikasi tugasnya sendiri.');
      }
    }

    const hariIni = this.hariIni();
    await db
      .update(tasks)
      .set({
        verifikasi: masukan.keputusan === 'VERIFIED' ? 'VERIFIED' : 'REJECTED',
        diverifikasiPada: hariIni,
        diverifikasiOleh: pengguna.memberId,
        verifikasiKomentar: masukan.komentar,
        status: masukan.keputusan === 'VERIFIED' ? 'DONE' : 'IN_PROGRESS',
      })
      .where(eq(tasks.id, id));

    await db.insert(taskActivity).values({
      taskId: id,
      memberId: pengguna.memberId,
      tipe: 'VERIFIKASI',
      isi: `${masukan.keputusan} — ${masukan.komentar}`,
      statusSebelum: tugas.verifikasi,
      statusSesudah: masukan.keputusan === 'VERIFIED' ? 'VERIFIED' : 'REJECTED',
    });

    return { id, verifikasi: masukan.keputusan === 'VERIFIED' ? 'VERIFIED' : 'REJECTED' };
  }

  async komentar(
    id: string,
    masukan: z.infer<typeof SkemaKomentarTugas>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string }> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilTugas(db, id, permintaan, pengguna);

    const [baru] = await db
      .insert(taskActivity)
      .values({
        taskId: id,
        memberId: pengguna.memberId,
        tipe: 'KOMENTAR',
        isi: masukan.isi,
      })
      .returning({ id: taskActivity.id });

    return { id: baru?.id ?? '' };
  }

  async aktivitas(
    id: string,
    limit: number,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<unknown[]> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilTugas(db, id, permintaan, pengguna);

    const baris = await db
      .select({
        id: taskActivity.id,
        tipe: taskActivity.tipe,
        isi: taskActivity.isi,
        statusSebelum: taskActivity.statusSebelum,
        statusSesudah: taskActivity.statusSesudah,
        nama: members.nama,
        dibuatPada: taskActivity.dibuatPada,
      })
      .from(taskActivity)
      .leftJoin(members, eq(members.id, taskActivity.memberId))
      .where(eq(taskActivity.taskId, id))
      .orderBy(desc(taskActivity.dibuatPada))
      .limit(limit);

    return baris.map((b) => ({
      id: b.id,
      tipe: b.tipe,
      isi: b.isi,
      statusSebelum: b.statusSebelum,
      statusSesudah: b.statusSesudah,
      olehNama: b.nama,
      dibuatPada: String(b.dibuatPada),
    }));
  }

  /** Tugas milik seorang anggota (dipakai dasbor). */
  async tugasAnggota(
    memberId: string,
    organizationId: string,
    batas: number,
  ): Promise<unknown[]> {
    const db = await this.dbSvc.ambilDb();
    const idTugas = await db
      .select({ taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.memberId, memberId));

    if (idTugas.length === 0) return [];

    const baris = await db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.organizationId, organizationId), inArray(tasks.id, idTugas.map((t) => t.taskId))),
      )
      .orderBy(desc(tasks.batasWaktu))
      .limit(batas);

    return baris.map((b) => ({
      id: b.id,
      judul: b.judul,
      status: b.status,
      prioritas: b.prioritas,
      batasWaktu: b.batasWaktu,
      overdue: b.batasWaktu ? b.batasWaktu < this.hariIni() && b.status !== 'DONE' : false,
      hariTersisa: b.batasWaktu ? hariTersisa(b.batasWaktu) : null,
    }));
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private async ambilTugas(
    db: Db,
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<typeof tasks.$inferSelect> {
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, organizationId)))
      .limit(1);
    if (!baris) throw galatTidakDitemukan('Tugas tidak ditemukan.');
    return baris;
  }

  private async urutanBerikutnya(db: Db, organizationId: string): Promise<number> {
    const [baris] = await db
      .select({ jumlah: count() })
      .from(tasks)
      .where(eq(tasks.organizationId, organizationId))
      .limit(1);
    return Number(baris?.jumlah ?? 0) + 1;
  }

  private async keTugas(db: Db, b: typeof tasks.$inferSelect): Promise<Tugas> {
    const assignee = await db
      .select({
        memberId: members.id,
        nama: members.nama,
        tingkat: members.tingkat,
        jurusan: members.jurusan,
        subKelas: members.subKelas,
        selesai: taskAssignees.selesaiPada,
      })
      .from(taskAssignees)
      .innerJoin(members, eq(members.id, taskAssignees.memberId))
      .where(eq(taskAssignees.taskId, b.id));

    const [program] = b.programId
      ? await db
          .select({ nama: programs.nama })
          .from(programs)
          .where(eq(programs.id, b.programId))
          .limit(1)
      : [];

    const [divisi] = b.divisionId
      ? await db
          .select({ nama: divisions.nama })
          .from(divisions)
          .where(eq(divisions.id, b.divisionId))
          .limit(1)
      : [];

    return {
      id: b.id,
      kode: b.kode,
      organizationId: b.organizationId,
      judul: b.judul,
      deskripsi: b.deskripsi,
      status: b.status,
      verifikasi: b.verifikasi,
      butuhVerifikasi: b.butuhVerifikasi,
      prioritas: b.prioritas,
      batasWaktu: b.batasWaktu,
      overdue: b.batasWaktu ? b.batasWaktu < this.hariIni() && b.status !== 'DONE' : false,
      programId: b.programId,
      programNama: program?.nama ?? null,
      divisionId: b.divisionId,
      divisionNama: divisi?.nama ?? null,
      assignee: assignee.map((a) => ({
        memberId: a.memberId,
        nama: a.nama,
        kelas: labelKelas({
          tingkat: a.tingkat,
          jurusan: a.jurusan,
          subKelas: a.subKelas,
        }),
        selesai: Boolean(a.selesai),
      })),
      dibuatOleh: b.dibuatOleh,
      dibuatOlehNama: null,
      parentId: b.parentId,
      lampiranIds: [...b.lampiranDokumenIds],
      progres: b.progres,
      dibuatPada: String(b.dibuatPada),
      selesaiPada: b.selesaiPada ? String(b.selesaiPada) : null,
      diverifikasiPada: b.diverifikasiPada ? String(b.diverifikasiPada) : null,
      diverifikasiOleh: b.diverifikasiOleh,
    };
  }

  private hariIni(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
