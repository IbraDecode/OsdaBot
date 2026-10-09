/**
 * MeetingsService — rapat, agenda, peserta, dan notulen berversi.
 *
 * Aturan utama:
 *  - Notulen yang sudah APPROVED TIDAK bisa ditimpa. Revisi membuat versi baru;
 *    versi lama tetap utuh sebagai bukti historis.
 *  - Rapat baru otomatis membuat sesi absensi (bila diminta), sehingga absensi
 *    rapat mengikuti mekanisme yang sama dengan acara lain.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import {
  attendanceSessions,
  meetingAgenda,
  meetingMinutes,
  meetingParticipants,
  meetings,
  members,
  type Db,
} from '@osda/db';
import {
  type FilterRapat,
  type PayloadBuatNotulen,
  type PayloadBuatRapat,
  type PayloadPutuskanNotulen,
  type PayloadTambahAgenda,
  type PayloadTambahPeserta,
  type Rapat,
  type Notulen,
} from '@osda/contracts';

import { galatKonflik, galatTidakDitemukan, galatValidasi } from '../../common/galat.js';
import { offsetDari } from '../../common/utilitas/paginasi.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';

@Injectable()
export class MeetingsService {
  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  // ============================================================
  // Rapat
  // ============================================================

  async daftar(
    filter: FilterRapat,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Rapat[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      filter.organizationId,
    );

    const syarat: ReturnType<typeof and>[] = [eq(meetings.organizationId, organizationId)];
    if (filter.status) syarat.push(eq(meetings.status, filter.status));
    if (filter.jenis) syarat.push(eq(meetings.jenis, filter.jenis));
    if (filter.divisionId) syarat.push(eq(meetings.divisionId, filter.divisionId));
    if (filter.rentang?.dari) syarat.push(gte(meetings.tanggal, String(filter.rentang?.dari)));
    if (filter.rentang?.sampai) syarat.push(lte(meetings.tanggal, String(filter.rentang?.sampai)));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(meetings)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(meetings)
      .where(and(...syarat))
      .orderBy(desc(meetings.tanggal), desc(meetings.waktuMulai))
      .limit(filter.limit)
      .offset(offsetDari(filter));

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / filter.limit));
    const data = await Promise.all(baris.map((b) => this.keRapat(db, b)));

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
  ): Promise<Rapat> {
    const db = await this.dbSvc.ambilDb();
    const baris = await this.ambilRapat(db, id, permintaan, pengguna);
    return this.keRapat(db, baris);
  }

  async buat(
    masukan: PayloadBuatRapat,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Rapat> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const [baru] = await db
      .insert(meetings)
      .values({
        organizationId,
        periodId: masukan.periodId ?? null,
        divisionId: masukan.divisionId ?? null,
        programId: masukan.programId ?? null,
        judul: masukan.judul,
        deskripsi: masukan.deskripsi ?? null,
        tanggal: masukan.tanggal,
        waktuMulai: masukan.waktuMulai,
        waktuSelesai: masukan.waktuSelesai,
        lokasi: masukan.lokasi ?? null,
        jenis: masukan.jenis,
        pembicara: masukan.pembicara,
        divisionIds: masukan.divisionIds,
        status: 'SCHEDULED',
        revisi: 1,
        dibuatOleh: pengguna.memberId,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat rapat.');

    // Rapat biasanya butuh absensi: buat sesi absensi secara otomatis.
    if (masukan.buatSesiAbsensi) {
      const [sesi] = await db
        .insert(attendanceSessions)
        .values({
          organizationId,
          periodId: masukan.periodId ?? null,
          meetingId: baru.id,
          jenis: 'MEETING',
          judul: `Absensi rapat: ${masukan.judul}`,
          tanggal: masukan.tanggal,
          waktuMulai: masukan.waktuMulai,
          waktuSelesai: masukan.waktuSelesai,
          lokasi: masukan.lokasi ?? null,
          status: 'DRAFT',
          dibuatOleh: pengguna.memberId,
        })
        .returning();

      if (sesi) {
        await db
          .update(meetings)
          .set({ sessionId: sesi.id })
          .where(eq(meetings.id, baru.id));
      }
    }

    const [setelah] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, baru.id))
      .limit(1);
    if (!setelah) throw galatTidakDitemukan('Rapat tidak ditemukan setelah dibuat.');

    return this.keRapat(db, setelah);
  }

  // ============================================================
  // Agenda & peserta
  // ============================================================

  async tambahAgenda(
    id: string,
    masukan: PayloadTambahAgenda,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; judul: string }> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilRapat(db, id, permintaan, pengguna);

    const [baru] = await db
      .insert(meetingAgenda)
      .values({
        meetingId: id,
        judul: masukan.judul,
        deskripsi: masukan.deskripsi ?? null,
        pembicara: masukan.pembicara ?? null,
        durasiMenit: masukan.durasiMenit ?? null,
        urutan: masukan.urutan,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal menambah agenda.');
    return { id: baru.id, judul: baru.judul };
  }

  async tambahPeserta(
    id: string,
    masukan: PayloadTambahPeserta,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ ditambahkan: number }> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilRapat(db, id, permintaan, pengguna);

    await db
      .insert(meetingParticipants)
      .values(
        masukan.memberIds.map((memberId) => ({
          meetingId: id,
          memberId,
          wajib: masukan.wajib,
        })),
      )
      .onConflictDoNothing();

    return { ditambahkan: masukan.memberIds.length };
  }

  // ============================================================
  // Notulen berversi
  // ============================================================

  async buatNotulen(
    id: string,
    masukan: PayloadBuatNotulen,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Notulen> {
    const db = await this.dbSvc.ambilDb();
    const rapat = await this.ambilRapat(db, id, permintaan, pengguna);

    const [versiTerakhir] = await db
      .select({ versi: meetingMinutes.versi })
      .from(meetingMinutes)
      .where(eq(meetingMinutes.meetingId, id))
      .orderBy(desc(meetingMinutes.versi))
      .limit(1);

    const [baru] = await db
      .insert(meetingMinutes)
      .values({
        meetingId: id,
        organizationId: rapat.organizationId,
        nomor: masukan.nomor ?? null,
        versi: (versiTerakhir?.versi ?? 0) + 1,
        ringkasan: masukan.ringkasan,
        pembahasan: masukan.pembahasan ?? null,
        status: 'DRAFT',
        penulisId: pengguna.memberId,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal menyimpan notulen.');
    return this.keNotulen(db, baru);
  }

  /**
   * Setujui notulen. Notulen yang sudah APPROVED tidak bisa diputus ulang —
   * perubahan harus lewat versi baru (DOCUMENT_VERSION_IMMUTABLE / konflik).
   */
  async putuskanNotulen(
    id: string,
    notulenId: string,
    masukan: PayloadPutuskanNotulen,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Notulen> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilRapat(db, id, permintaan, pengguna);

    const [notulen] = await db
      .select()
      .from(meetingMinutes)
      .where(and(eq(meetingMinutes.id, notulenId), eq(meetingMinutes.meetingId, id)))
      .limit(1);
    if (!notulen) throw galatTidakDitemukan('Notulen tidak ditemukan.');

    if (notulen.status === 'APPROVED') {
      throw galatKonflik(
        'Notulen ini sudah disetujui dan tidak dapat diubah. Buat revisi baru.',
      );
    }

    const hariIni = new Date().toISOString().slice(0, 10);
    const [setelah] = await db
      .update(meetingMinutes)
      .set({
        status: masukan.keputusan === 'APPROVED' ? 'APPROVED' : 'DRAFT',
        disetujuiOleh: masukan.keputusan === 'APPROVED' ? pengguna.memberId : null,
        disetujuiPada: masukan.keputusan === 'APPROVED' ? hariIni : null,
        dikunciPada: masukan.keputusan === 'APPROVED' ? hariIni : null,
        komentarPersetujuan: masukan.komentar ?? null,
      })
      .where(eq(meetingMinutes.id, notulenId))
      .returning();

    if (!setelah) throw galatValidasi(undefined, 'Gagal memperbarui status notulen.');
    return this.keNotulen(db, setelah);
  }

  async riwayatNotulen(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ versi: number; status: string; ringkasan: string; dibuatPada: string }[]> {
    const db = await this.dbSvc.ambilDb();
    await this.ambilRapat(db, id, permintaan, pengguna);

    const baris = await db
      .select()
      .from(meetingMinutes)
      .where(eq(meetingMinutes.meetingId, id))
      .orderBy(desc(meetingMinutes.versi));

    return baris.map((b) => ({
      versi: b.versi,
      status: b.status,
      ringkasan: b.ringkasan,
      dibuatPada: String(b.dibuatPada),
    }));
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private async ambilRapat(
    db: Db,
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<typeof meetings.$inferSelect> {
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [baris] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.organizationId, organizationId)))
      .limit(1);
    if (!baris) throw galatTidakDitemukan('Rapat tidak ditemukan.');
    return baris;
  }

  private async keRapat(db: Db, b: typeof meetings.$inferSelect): Promise<Rapat> {
    const [peserta] = await db
      .select({ jumlah: count() })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, b.id))
      .limit(1);

    const [hadir] = await db
      .select({ jumlah: count() })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, b.id), eq(meetingParticipants.hadir, true)))
      .limit(1);

    const [notulen] = await db
      .select({ id: meetingMinutes.id })
      .from(meetingMinutes)
      .where(eq(meetingMinutes.meetingId, b.id))
      .orderBy(desc(meetingMinutes.versi))
      .limit(1);

    return {
      id: b.id,
      organizationId: b.organizationId,
      periodId: b.periodId,
      judul: b.judul,
      deskripsi: b.deskripsi,
      tanggal: String(b.tanggal),
      waktuMulai: b.waktuMulai,
      waktuSelesai: b.waktuSelesai,
      lokasi: b.lokasi,
      jenis: b.jenis,
      status: b.status,
      pembicara: [...b.pembicara],
      divisionId: b.divisionId,
      programId: b.programId,
      sessionId: b.sessionId,
      totalPeserta: Number(peserta?.jumlah ?? 0),
      sudahHadir: Number(hadir?.jumlah ?? 0),
      notulenId: notulen?.id ?? null,
      dibuatOleh: b.dibuatOleh,
      dibuatPada: String(b.dibuatPada),
    };
  }

  private async keNotulen(db: Db, b: typeof meetingMinutes.$inferSelect): Promise<Notulen> {
    const [penulis] = b.penulisId
      ? await db
          .select({ nama: members.nama })
          .from(members)
          .where(eq(members.id, b.penulisId))
          .limit(1)
      : [];

    return {
      id: b.id,
      rapatId: b.meetingId,
      versi: b.versi,
      nomor: b.nomor,
      ringkasan: b.ringkasan,
      pembahasan: b.pembahasan,
      keputusan: [...b.keputusan],
      itemTindakan: [],
      penulisId: b.penulisId,
      penulisNama: penulis?.nama ?? null,
      status: b.status,
      disetujuiOleh: b.disetujuiOleh,
      disetujuiPada: b.disetujuiPada ? String(b.disetujuiPada) : null,
      dibuatPada: String(b.dibuatPada),
    };
  }
}
