/**
 * EventsService — acara (event), peserta, dan kalender terpadu.
 *
 * Acara yang `butuh_absensi` otomatis membuat sesi absensi, sehingga absensi
 * acara memakai mekanisme yang sama dengan rapat.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { labelKelas, type StatusAcara,} from '@osda/contracts';
import type { Acara, FilterAcara, PayloadBuatAcara } from '@osda/contracts';
import { SkemaTambahPesertaAcara } from '@osda/contracts';
import {
  attendanceSessions,
  divisions,
  eventAttendance,
  eventParticipants,
  eventSchedules,
  events,
  meetings,
  members,
  programs,
  type Db,
} from '@osda/db';

import { galatTidakDitemukan, galatValidasi } from '../../common/galat.js';
import { offsetDari } from '../../common/utilitas/paginasi.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { kodeDenganAwalan } from '../../common/utilitas/kode.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';

/** Rentang tanggal yang dipakai kalender. */
export interface RentangTanggal {
  readonly dari?: string;
  readonly sampai?: string;
}

@Injectable()
export class EventsService {
  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  async daftar(
    filter: FilterAcara,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Acara[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      filter.organizationId,
    );

    const hariIni = new Date().toISOString().slice(0, 10);
    const syarat: ReturnType<typeof and>[] = [eq(events.organizationId, organizationId)];
    if (filter.programId) syarat.push(eq(events.programId, filter.programId));
    if (filter.status) syarat.push(eq(events.status, filter.status));
    if (filter.divisionId) syarat.push(eq(events.divisionId, filter.divisionId));
    if (filter.akanDatang) syarat.push(gte(events.tanggal, hariIni));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(events)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(events)
      .where(and(...syarat))
      .orderBy(desc(events.tanggal))
      .limit(filter.limit)
      .offset(offsetDari(filter));

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / filter.limit));
    const data = await Promise.all(baris.map((b) => this.keAcara(db, b)));

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
  ): Promise<Acara> {
    const db = await this.dbSvc.ambilDb();
    const baris = await this.ambilAcara(db, id, permintaan, pengguna);
    return this.keAcara(db, baris);
  }

  async buat(
    masukan: PayloadBuatAcara,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Acara> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const kode = `EVT-${kodeDenganAwalan('').trim()}`;

    const [baru] = await db
      .insert(events)
      .values({
        organizationId,
        programId: masukan.programId ?? null,
        divisionId: masukan.divisionId ?? null,
        kode,
        judul: masukan.judul,
        deskripsi: masukan.deskripsi ?? null,
        tanggal: masukan.tanggal,
        waktuMulai: masukan.waktuMulai ?? null,
        waktuSelesai: masukan.waktuSelesai ?? null,
        lokasi: masukan.lokasi ?? null,
        status: 'DRAFT',
        penanggungJawabMemberId: masukan.penanggungJawabMemberId,
        kapasitas: masukan.kapasitas ?? null,
        butuhAbsensi: masukan.butuhAbsensi,
        butuhPendaftaran: masukan.butuhPendaftaran,
        biayaDiajukan: masukan.biayaDiajukan ?? 0,
        dibuatOleh: pengguna.memberId,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat acara.');

    if (masukan.butuhAbsensi) {
      const [sesi] = await db
        .insert(attendanceSessions)
        .values({
          organizationId,
          meetingId: null,
          eventId: baru.id,
          jenis: 'EVENT',
          judul: `Absensi acara: ${masukan.judul}`,
          tanggal: masukan.tanggal,
          waktuMulai: masukan.waktuMulai ?? null,
          waktuSelesai: masukan.waktuSelesai ?? null,
          lokasi: masukan.lokasi ?? null,
          status: 'DRAFT',
          dibuatOleh: pengguna.memberId,
        })
        .returning();

      if (sesi) {
        await db.update(events).set({ sessionId: sesi.id }).where(eq(events.id, baru.id));
      }
    }

    const [setelah] = await db.select().from(events).where(eq(events.id, baru.id)).limit(1);
    if (!setelah) throw galatTidakDitemukan('Acara tidak ditemukan setelah dibuat.');
    return this.keAcara(db, setelah);
  }

  async perbarui(
    id: string,
    masukan: Partial<PayloadBuatAcara> & { status?: StatusAcara },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Acara> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilAcara(db, id, permintaan, pengguna);

    const isi: Partial<typeof events.$inferInsert> = {};
    if (typeof masukan.judul === 'string') isi.judul = masukan.judul;
    if (masukan.deskripsi !== undefined) isi.deskripsi = masukan.deskripsi;
    if (masukan.tanggal !== undefined) isi.tanggal = masukan.tanggal;
    if (masukan.waktuMulai !== undefined) isi.waktuMulai = masukan.waktuMulai;
    if (masukan.waktuSelesai !== undefined) isi.waktuSelesai = masukan.waktuSelesai;
    if (masukan.lokasi !== undefined) isi.lokasi = masukan.lokasi;
    if (masukan.status !== undefined) isi.status = masukan.status;
    if (masukan.kapasitas !== undefined) isi.kapasitas = masukan.kapasitas;
    if (masukan.penanggungJawabMemberId !== undefined) {
      isi.penanggungJawabMemberId = masukan.penanggungJawabMemberId;
    }

    await db.update(events).set(isi).where(eq(events.id, id));

    const [setelah] = await db.select().from(events).where(eq(events.id, id)).limit(1);
    if (!setelah) throw galatTidakDitemukan('Acara tidak ditemukan.');
    return this.keAcara(db, setelah);
  }

  async tambahPeserta(
    id: string,
    masukan: z.infer<typeof SkemaTambahPesertaAcara>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ ditambahkan: number }> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilAcara(db, id, permintaan, pengguna);

    await db
      .insert(eventParticipants)
      .values(
        masukan.memberIds.map((memberId) => ({
          eventId: id,
          memberId,
          peran: masukan.peran,
        })),
      )
      .onConflictDoNothing();

    return { ditambahkan: masukan.memberIds.length };
  }

  /**
   * Kalender terpadu: rapat, acara, tenggat tugas, sesi absensi, dan periode
   * kepengurusan dalam satu daftar berurutan menurut tanggal.
   */
  async kalender(
    organizationId: string,
    rentang: RentangTanggal,
  ): Promise<
    {
      id: string;
      tipe: 'MEETING' | 'EVENT' | 'DEADLINE' | 'ATTENDANCE' | 'PERIOD';
      judul: string;
      tanggal: string;
      tautan: string | null;
    }[]
  > {
    const db = await this.dbSvc.ambilDb();
    const syarat = [eq(meetings.organizationId, organizationId)];
    if (rentang.dari) syarat.push(gte(meetings.tanggal, rentang.dari));
    if (rentang.sampai) syarat.push(lte(meetings.tanggal, rentang.sampai));

    const daftar: {
      id: string;
      tipe: 'MEETING' | 'EVENT' | 'DEADLINE' | 'ATTENDANCE' | 'PERIOD';
      judul: string;
      tanggal: string;
      tautan: string | null;
    }[] = [];

    const rapat = await db.select().from(meetings).where(and(...syarat));
    for (const r of rapat) {
      daftar.push({
        id: r.id,
        tipe: 'MEETING',
        judul: r.judul,
        tanggal: String(r.tanggal),
        tautan: `/rapat/${r.id}`,
      });
    }

    const syaratAcara = [eq(events.organizationId, organizationId)];
    if (rentang.dari) syaratAcara.push(gte(events.tanggal, rentang.dari));
    if (rentang.sampai) syaratAcara.push(lte(events.tanggal, rentang.sampai));

    const acara = await db.select().from(events).where(and(...syaratAcara));
    for (const a of acara) {
      daftar.push({
        id: a.id,
        tipe: 'EVENT',
        judul: a.judul,
        tanggal: String(a.tanggal),
        tautan: `/acara/${a.id}`,
      });
    }

    const syaratSesi = [eq(attendanceSessions.organizationId, organizationId)];
    if (rentang.dari) syaratSesi.push(gte(attendanceSessions.tanggal, rentang.dari));
    if (rentang.sampai) syaratSesi.push(lte(attendanceSessions.tanggal, rentang.sampai));

    const sesi = await db.select().from(attendanceSessions).where(and(...syaratSesi));
    for (const s of sesi) {
      daftar.push({
        id: s.id,
        tipe: 'ATTENDANCE',
        judul: s.judul,
        tanggal: String(s.tanggal),
        tautan: `/absensi/sesi/${s.id}`,
      });
    }

    daftar.sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0));
    return daftar;
  }

  async daftarJadwal(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<unknown[]> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilAcara(db, id, permintaan, pengguna);

    const baris = await db
      .select()
      .from(eventSchedules)
      .where(eq(eventSchedules.eventId, id))
      .orderBy(eventSchedules.urutan);

    return baris.map((b) => ({
      id: b.id,
      judul: b.judul,
      deskripsi: b.deskripsi,
      mulaiPukul: b.mulaiPukul,
      selesaiPukul: b.selesaiPukul,
      lokasi: b.lokasi,
      urutan: b.urutan,
    }));
  }

  async daftarPeserta(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<unknown[]> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilAcara(db, id, permintaan, pengguna);

    const baris = await db
      .select({
        memberId: members.id,
        nama: members.nama,
        tingkat: members.tingkat,
        jurusan: members.jurusan,
        subKelas: members.subKelas,
        peran: eventParticipants.peran,
        terdaftarPada: eventParticipants.terdaftarPada,
        hadir: eventParticipants.hadir,
      })
      .from(eventParticipants)
      .innerJoin(members, eq(members.id, eventParticipants.memberId))
      .where(eq(eventParticipants.eventId, id));

    return baris.map((b) => ({
      memberId: b.memberId,
      nama: b.nama,
      kelas: labelKelas({
        tingkat: b.tingkat,
        jurusan: b.jurusan,
        subKelas: b.subKelas,
      }),
      peran: b.peran,
      terdaftarPada: String(b.terdaftarPada),
      hadir: b.hadir,
    }));
  }

  /** Catat kehadiran acara (IN/OUT). */
  async catatKehadiran(
    id: string,
    memberId: string,
    tipe: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string }> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilAcara(db, id, permintaan, pengguna);

    const [baru] = await db
      .insert(eventAttendance)
      .values({
        eventId: id,
        memberId,
        tipe,
        dicatatOleh: pengguna.memberId,
      })
      .onConflictDoNothing()
      .returning({ id: eventAttendance.id });

    if (!baru) throw galatTidakDitemukan('Kehadiran acara sudah tercatat.');
    return { id: baru.id };
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private async ambilAcara(
    db: Db,
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<typeof events.$inferSelect> {
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, id), eq(events.organizationId, organizationId)))
      .limit(1);
    if (!baris) throw galatTidakDitemukan('Acara tidak ditemukan.');
    return baris;
  }

  private async keAcara(db: Db, b: typeof events.$inferSelect): Promise<Acara> {
    const [pj] = await db
      .select({ nama: members.nama })
      .from(members)
      .where(eq(members.id, b.penanggungJawabMemberId))
      .limit(1);

    const [program] = b.programId
      ? await db.select({ nama: programs.nama }).from(programs).where(eq(programs.id, b.programId)).limit(1)
      : [];

    const [peserta] = await db
      .select({ jumlah: count() })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, b.id))
      .limit(1);

    const [divisi] = b.divisionId
      ? await db.select({ nama: divisions.nama }).from(divisions).where(eq(divisions.id, b.divisionId)).limit(1)
      : [];

    return {
      id: b.id,
      organizationId: b.organizationId,
      programId: b.programId,
      programNama: program?.nama ?? null,
      judul: b.judul,
      deskripsi: b.deskripsi,
      tanggal: String(b.tanggal),
      waktuMulai: b.waktuMulai,
      waktuSelesai: b.waktuSelesai,
      lokasi: b.lokasi,
      status: b.status,
      penanggungJawabMemberId: b.penanggungJawabMemberId,
      penanggungJawabNama: pj?.nama ?? null,
      kapasitas: b.kapasitas,
      jumlahPendaftaran: Number(peserta?.jumlah ?? 0),
      divisionId: b.divisionId,
      sessionId: b.sessionId,
      dibuatPada: String(b.dibuatPada),
    };
  }
}
