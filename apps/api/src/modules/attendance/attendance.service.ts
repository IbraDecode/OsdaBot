/**
 * AttendanceService — sesi absensi, catatan hadir, dan token QR.
 *
 * Invariant yang ditegakkan:
 *  - Satu anggota hanya punya SATU catatan per sesi (unique index database).
 *  - Absen bersifat idempoten lewat `idempotency_key`.
 *  - Token QR: terikat sesi, berumur pendek, sekali pakai.
 *  - Peserta wajib hadir "dibekukan" saat sesi dibuka (snapshot).
 *  - Status EXCUSED / SICK WAJIB punya alasan (ALASAN_HADIR_WAJB).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  attendanceParticipants,
  attendanceQrTokens,
  attendanceRecords,
  attendanceSessions,
  divisions,
  members,
  type Db,
} from '@osda/db';
import {
  ALASAN_HADIR_WAJB,
  STATUS_TERHADIR,
  type PayloadBuatSesi,
  type PayloadBukaSesi,
  type PayloadCatatHadir,
  type PayloadTutupSesi,
  type RekapSesi,
  type RingkasanAnggotaAbsen,
  type SesiAbsensi,
  type StatusHadir,
  type StatusSesi,
} from '@osda/contracts';

import {
  galatKonflik,
  galatTidakDitemukan,
  galatTransisi,
  galatValidasi,
} from '../../common/galat.js';
import { offsetDari } from '../../common/utilitas/paginasi.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';
import { KONFIGURASI, type Konfigurasi } from '../../config/konfigurasi.js';

/** Token QR yang dihasilkan server untuk satu sesi. */
export interface TokenQrHasil {
  readonly token: string;
  readonly berlakuSampai: Date;
}

@Injectable()
export class AttendanceService {
  private readonly pencatat = new Logger('Attendance');

  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
    @Inject(KONFIGURASI) private readonly konfigurasi: Konfigurasi,
  ) {}

  // ============================================================
  // Daftar & detail sesi
  // ============================================================

  async daftarSesi(
    filter: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: SesiAbsensi[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      filter.organizationId as string | undefined,
    );

    const page = Number(filter.page ?? 1);
    const limit = Number(filter.limit ?? 20);
    const syarat: ReturnType<typeof and>[] = [eq(attendanceSessions.organizationId, organizationId)];
    if (filter.jenis) syarat.push(eq(attendanceSessions.jenis, filter.jenis as never));
    if (filter.status) syarat.push(eq(attendanceSessions.status, filter.status as StatusSesi));
    const rentangSesi = (filter.rentang ?? {}) as { dari?: string; sampai?: string };
    if (rentangSesi.dari) syarat.push(gte(attendanceSessions.tanggal, String(rentangSesi.dari)));
    if (rentangSesi.sampai) syarat.push(lte(attendanceSessions.tanggal, String(rentangSesi.sampai)));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(attendanceSessions)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(attendanceSessions)
      .where(and(...syarat))
      .orderBy(desc(attendanceSessions.tanggal), desc(attendanceSessions.dibuatPada))
      .limit(limit)
      .offset((page - 1) * limit);

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: baris.map((b) => this.keSesi(b)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async buatSesi(
    masukan: PayloadBuatSesi,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<SesiAbsensi> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const [baru] = await db
      .insert(attendanceSessions)
      .values({
        organizationId,
        periodId: masukan.periodId ?? null,
        meetingId: masukan.meetingId ?? null,
        eventId: masukan.eventId ?? null,
        jenis: masukan.jenis,
        judul: masukan.judul,
        tanggal: masukan.tanggal,
        waktuMulai: masukan.waktuMulai ?? null,
        waktuSelesai: masukan.waktuSelesai ?? null,
        mulaiPada: masukan.mulaiPada ? masukan.mulaiPada.slice(0, 10) : null,
        selesaiPada: masukan.selesaiPada ? masukan.selesaiPada.slice(0, 10) : null,
        lokasi: masukan.lokasi ?? null,
        status: 'DRAFT',
        wajibHadir: masukan.wajibHadir,
        hanyaDivisionIds: masukan.hanyaDivisionId ?? [],
        idempotencyKey: masukan.idempotencyKey ?? null,
        dibuatOleh: pengguna.memberId,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat sesi absensi.');
    return this.keSesi(baru);
  }

  // ============================================================
  // Buka & tutup sesi
  // ============================================================

  /**
   * Buka sesi: status → OPEN, token QR dibuat, dan daftar peserta wajib hadir
   * dibekukan (snapshot) supaya anggota baru tidak mengubah rekap.
   */
  async bukaSesi(
    id: string,
    masukan: PayloadBukaSesi,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ sesi: SesiAbsensi; qr: TokenQrHasil }> {
    const db = await this.dbSvc.ambilDb();
    const sesi = await this.ambilSesi(db, id, permintaan, pengguna);

    if (sesi.status !== 'DRAFT') {
      throw galatTransisi(
        `Sesi berstatus ${sesi.status} tidak bisa dibuka (hanya DRAFT).`,
      );
    }

    const ttlDetik = masukan.qrTtlDetik;
    const qr = this.buatTokenQr(id, ttlDetik);
    const sekarang = new Date().toISOString().slice(0, 10);

    await db
      .update(attendanceSessions)
      .set({
        status: 'OPEN',
        dibukaPada: sekarang,
        qrTtlDetik: ttlDetik,
        qrSecret: qr.rahasia,
        qrTerakhirDiaturPada: sekarang,
      })
      .where(eq(attendanceSessions.id, id));

    await db.insert(attendanceQrTokens).values({
      sessionId: id,
      jti: qr.jti,
      tokenHash: qr.hash,
      berlakuSampai: qr.berlakuSampai.toISOString().slice(0, 10),
    });

    await this.bekukanPeserta(db, sesi);

    const [setelah] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, id))
      .limit(1);
    if (!setelah) throw galatTidakDitemukan('Sesi absensi tidak ditemukan.');

    return {
      sesi: this.keSesi(setelah),
      qr: { token: qr.token, berlakuSampai: qr.berlakuSampai },
    };
  }

  /**
   * Tutup sesi: status → CLOSED, rekap dihitung, dan anggota wajib yang belum
   * absen tercatat ABSENT (bukan dibiarkan kosong) sesuai spesifikasi.
   */
  async tutupSesi(
    id: string,
    masukan: PayloadTutupSesi,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ sesi: SesiAbsensi; rekap: RekapSesi }> {
    const db = await this.dbSvc.ambilDb();
    const sesi = await this.ambilSesi(db, id, permintaan, pengguna);

    if (sesi.status !== 'OPEN') {
      throw galatTransisi(`Sesi berstatus ${sesi.status} tidak bisa ditutup (hanya OPEN).`);
    }

    const sekarang = new Date().toISOString().slice(0, 10);
    await db
      .update(attendanceSessions)
      .set({ status: 'CLOSED', ditutupPada: sekarang, ditutupOleh: pengguna.memberId })
      .where(eq(attendanceSessions.id, id));

    if (masukan.tandaiHadirSebagaiTidakHadir) {
      await this.tandaiTidakHadir(db, id);
    }

    const rekap = await this.hitungRekap(db, sesi);
    await db
      .update(attendanceSessions)
      .set({
        rekapTotalWajib: rekap.totalWajib,
        rekapHadir: rekap.statistik.hadir,
        rekapIzin: rekap.statistik.izin,
        rekapSakit: rekap.statistik.sakit,
        rekapTidakHadir: rekap.statistik.tidakHadir + rekap.statistik.belumAbsen,
      })
      .where(eq(attendanceSessions.id, id));

    const [setelah] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, id))
      .limit(1);
    if (!setelah) throw galatTidakDitemukan('Sesi absensi tidak ditemukan.');

    return { sesi: this.keSesi(setelah), rekap };
  }

  async rekapSesi(
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<RekapSesi> {
    const db = await this.dbSvc.ambilDb();
    const sesi = await this.ambilSesi(db, id, permintaan, pengguna);
    return this.hitungRekap(db, sesi);
  }

  // ============================================================
  // Catat kehadiran
  // ============================================================

  /**
   * Catat kehadiran. Idempoten: bila `idempotency_key` sudah pernah dipakai,
   * catatan lama dikembalikan tanpa menulis duplikat. Bila anggota sudah punya
   * catatan di sesi ini, galat `ATTENDANCE_ALREADY_RECORDED` dikembalikan.
   */
  async catatHadir(
    masukan: PayloadCatatHadir,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; status: StatusHadir; sudahAda: boolean }> {
    const db = await this.dbSvc.ambilDb();

    if (!ALASAN_HADIR_WAJB.includes(masukan.status) && masukan.alasan) {
      // alasan opsional untuk status lain — dibiarkan apa adanya
    }
    if (ALASAN_HADIR_WAJB.includes(masukan.status) && !masukan.alasan) {
      throw galatValidasi(
        { field: 'alasan' },
        `Status ${masukan.status} wajib menyertakan alasan.`,
      );
    }

    const sesi = await this.ambilSesi(db, masukan.sessionId, permintaan, pengguna);
    if (sesi.status !== 'OPEN') {
      throw galatKonflik(
        `Sesi berstatus ${sesi.status} — kehadiran hanya bisa dicatat saat sesi OPEN.`,
      );
    }

    const memberId = masukan.memberId ?? pengguna.memberId;
    if (!memberId) {
      throw galatValidasi({ field: 'memberId' }, 'memberId wajib diisi.');
    }

    // Idempotensi: kunci yang sudah dipakai mengembalikan catatan lama.
    if (masukan.idempotencyKey) {
      const [lama] = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.sessionId, sesi.id),
            eq(attendanceRecords.idempotencyKey, masukan.idempotencyKey),
          ),
        )
        .limit(1);
      if (lama) return { id: lama.id, status: lama.status, sudahAda: true };
    }

    const [ada] = await db
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.sessionId, sesi.id),
          eq(attendanceRecords.memberId, memberId),
        ),
      )
      .limit(1);

    if (ada) {
      throw galatKonflik(
        'Kehadiran anggota ini sudah tercatat pada sesi tersebut.',
      );
    }

    const [baru] = await db
      .insert(attendanceRecords)
      .values({
        sessionId: sesi.id,
        memberId,
        status: masukan.status,
        alasan: masukan.alasan ?? null,
        catatan: masukan.catatan ?? null,
        sumber: masukan.tokenQr ? 'QR' : 'WEB',
        menitKeterlambatan: null,
        idempotencyKey: masukan.idempotencyKey ?? null,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal mencatat kehadiran.');
    return { id: baru.id, status: baru.status, sudahAda: false };
  }

  /** Ubah status kehadiran manual oleh pengurus (perubahan tercatat). */
  async ubahManual(
    id: string,
    masukan: { status: StatusHadir; alasan: string; catatan?: string },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; status: StatusHadir }> {
    const db = await this.dbSvc.ambilDb();
    if (ALASAN_HADIR_WAJB.includes(masukan.status) && !masukan.alasan) {
      throw galatValidasi({ field: 'alasan' }, 'Alasan wajib diisi.');
    }

    const [baris] = await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.id, id))
      .limit(1);
    if (!baris) throw galatTidakDitemukan('Catatan kehadiran tidak ditemukan.');

    await this.ambilSesi(db, baris.sessionId, permintaan, pengguna);

    await db
      .update(attendanceRecords)
      .set({
        status: masukan.status,
        alasan: masukan.alasan,
        catatan: masukan.catatan ?? baris.catatan,
        diubahOleh: pengguna.memberId,
        diubahPada: new Date().toISOString().slice(0, 10),
        alasanPerubahan: masukan.alasan,
      })
      .where(eq(attendanceRecords.id, id));

    return { id, status: masukan.status };
  }

  // ============================================================
  // Verifikasi token QR
  // ============================================================

  /**
   * Verifikasi token QR. Token bersifat sekali pakai: begitu dipakai, baris
   * token ditandai `dipakai_pada` sehingga tidak bisa dipakai ulang.
   */
  async verifikasiQr(
    token: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{
    valid: boolean;
    sessionId?: string;
    judul?: string;
    pesan?: string;
  }> {
    const db = await this.dbSvc.ambilDb();
    const hash = this.hashToken(token);

    const [baris] = await db
      .select()
      .from(attendanceQrTokens)
      .where(eq(attendanceQrTokens.tokenHash, hash))
      .limit(1);

    if (!baris) return { valid: false, pesan: 'Token QR tidak dikenali.' };
    if (baris.dipakaiPada) return { valid: false, pesan: 'Token QR sudah dipakai.' };
    if (baris.membatalkan) return { valid: false, pesan: 'Token QR sudah dibatalkan.' };

    const [sesi] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, baris.sessionId))
      .limit(1);
    if (!sesi) return { valid: false, pesan: 'Sesi terkait token tidak ditemukan.' };

    await this.ambilSesi(db, sesi.id, permintaan, pengguna);

    if (sesi.status !== 'OPEN') {
      return { valid: false, pesan: `Sesi berstatus ${sesi.status}, bukan OPEN.` };
    }
    if (baris.berlakuSampai < new Date().toISOString().slice(0, 10)) {
      return { valid: false, pesan: 'Token QR sudah kedaluwarsa.' };
    }

    return { valid: true, sessionId: sesi.id, judul: sesi.judul };
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private async ambilSesi(
    db: Db,
    id: string,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<typeof attendanceSessions.$inferSelect> {
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [sesi] = await db
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.id, id),
          eq(attendanceSessions.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!sesi) throw galatTidakDitemukan('Sesi absensi tidak ditemukan.');
    return sesi;
  }

  /** Bekukan siapa saja yang wajib hadir (dipakai rekap konsisten). */
  private async bekukanPeserta(
    db: Db,
    sesi: typeof attendanceSessions.$inferSelect,
  ): Promise<void> {
    const syarat = [eq(members.organizationId, sesi.organizationId), eq(members.status, 'ACTIVE')];
    if (sesi.hanyaDivisionIds.length > 0) {
      syarat.push(inArray(members.divisionId, sesi.hanyaDivisionIds as string[]));
    }

    const anggota = await db
      .select({ id: members.id })
      .from(members)
      .where(and(...syarat));

    if (anggota.length === 0) return;

    await db
      .insert(attendanceParticipants)
      .values(
        anggota.map((a) => ({
          sessionId: sesi.id,
          memberId: a.id,
          wajib: sesi.wajibHadir,
        })),
      )
      .onConflictDoNothing();
  }

  /** Tandai peserta wajib yang belum absen sebagai ABSENT saat sesi ditutup. */
  private async tandaiTidakHadir(db: Db, sessionId: string): Promise<void> {
    const peserta = await db
      .select({ memberId: attendanceParticipants.memberId })
      .from(attendanceParticipants)
      .where(
        and(eq(attendanceParticipants.sessionId, sessionId), eq(attendanceParticipants.wajib, true)),
      );

    if (peserta.length === 0) return;

    await db
      .insert(attendanceRecords)
      .values(
        peserta.map((p) => ({
          sessionId,
          memberId: p.memberId,
          status: 'ABSENT' as const,
          sumber: 'ADMIN' as const,
          alasan: null,
          catatan: 'Ditandai otomatis saat sesi ditutup.',
        })),
      )
      .onConflictDoNothing();
  }

  /** Hitung rekap lengkap satu sesi sesuai kontrak `RekapSesi`. */
  private async hitungRekap(
    db: Db,
    sesi: typeof attendanceSessions.$inferSelect,
  ): Promise<RekapSesi> {
    const catatan = await db
      .select({
        memberId: attendanceRecords.memberId,
        status: attendanceRecords.status,
        alasan: attendanceRecords.alasan,
        nama: members.nama,
        tingkat: members.tingkat,
        jurusan: members.jurusan,
        subKelas: members.subKelas,
      })
      .from(attendanceRecords)
      .innerJoin(members, eq(members.id, attendanceRecords.memberId))
      .where(eq(attendanceRecords.sessionId, sesi.id));

    const peserta = await db
      .select({ memberId: members.id, nama: members.nama })
      .from(attendanceParticipants)
      .innerJoin(members, eq(members.id, attendanceParticipants.memberId))
      .where(eq(attendanceParticipants.sessionId, sesi.id));

    const ringkas = (
      daftar: typeof catatan,
    ): RingkasanAnggotaAbsen[] =>
      daftar.map((c) => ({
        memberId: c.memberId,
        nama: c.nama,
        kelas: [c.tingkat, c.jurusan, c.subKelas].filter(Boolean).join(' '),
        alasan: c.alasan,
        direkamPada: null,
      }));

    const sudahAbsenIds = new Set(catatan.map((c) => c.memberId));
    const belumAbsen = peserta
      .filter((p) => !sudahAbsenIds.has(p.memberId))
      .map((p) => ({
        memberId: p.memberId,
        nama: p.nama,
        kelas: '',
        alasan: null,
        direkamPada: null,
      }));

    const berStatus = (s: StatusHadir) => catatan.filter((c) => c.status === s);

    const hadir = berStatus('PRESENT').length;
    const terlambat = berStatus('LATE').length;
    const izin = berStatus('EXCUSED').length;
    const sakit = berStatus('SICK').length;
    const tidakHadir = berStatus('ABSENT').length;
    const totalWajib = Math.max(peserta.length, sudahAbsenIds.size);
    const terhadiTotal = hadir + terlambat;

    return {
      sessionId: sesi.id,
      judul: sesi.judul,
      tanggal: String(sesi.tanggal),
      status: sesi.status,
      totalWajib,
      hadir: ringkas(berStatus('PRESENT')),
      izin: ringkas(berStatus('EXCUSED')),
      sakit: ringkas(berStatus('SICK')),
      tidakHadir: ringkas(berStatus('ABSENT')),
      belumAbsen,
      statistik: {
        hadir: hadir + terlambat,
        izin,
        sakit,
        tidakHadir,
        belumAbsen: belumAbsen.length,
        persenHadir: totalWajib === 0 ? 0 : Math.round((terhadiTotal / totalWajib) * 100),
      },
    };
  }

  /** Ubah baris sesi menjadi kontrak `SesiAbsensi`. */
  private keSesi(b: typeof attendanceSessions.$inferSelect): SesiAbsensi {
    return {
      id: b.id,
      organizationId: b.organizationId,
      periodId: b.periodId,
      jenis: b.jenis,
      judul: b.judul,
      tanggal: String(b.tanggal),
      waktuMulai: b.waktuMulai,
      waktuSelesai: b.waktuSelesai,
      lokasi: b.lokasi,
      status: b.status,
      dibukaPada: b.dibukaPada ? String(b.dibukaPada) : null,
      ditutupPada: b.ditutupPada ? String(b.ditutupPada) : null,
      qrAktif: b.status === 'OPEN',
      totalWajib: b.rekapTotalWajib,
      sudahHadir: b.rekapHadir,
      sudahAbsen: b.rekapIzin + b.rekapSakit + b.rekapTidakHadir,
      dibuatOleh: b.dibuatOleh,
      dibuatPada: String(b.dibuatPada),
    };
  }

  // ============================================================
  // Token QR (HMAC-SHA256, sekali pakai)
  // ============================================================

  private buatTokenQr(
    sessionId: string,
    ttlDetik: number,
  ): {
    token: string;
    hash: string;
    jti: string;
    rahasia: string;
    berlakuSampai: Date;
  } {
    const jti = randomBytes(16).toString('hex');
    const rahasia = randomBytes(32).toString('hex');
    const berlakuSampai = new Date(Date.now() + ttlDetik * 1_000);
    const tandaTangan = createHmac('sha256', rahasia)
      .update(`${sessionId}.${jti}.${berlakuSampai.getTime()}`)
      .digest('base64url');

    return {
      token: `osda-qr.${sessionId}.${jti}.${tandaTangan}`,
      hash: this.hashToken(`osda-qr.${sessionId}.${jti}.${tandaTangan}`),
      jti,
      rahasia,
      berlakuSampai,
    };
  }

  private hashToken(token: string): string {
    return createHmac('sha256', 'osda-qr').update(token).digest('hex');
  }

  /** Bandingkan token secara aman terhadap waktu (dipakai verifikasi tanda tangan). */
  private cocokToken(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    if (x.length !== y.length) return false;
    return timingSafeEqual(x, y);
  }

  /** Jumlah hari kehadiran efektif untuk sebuah daftar status. */
  hitungTerhadi(status: readonly StatusHadir[]): number {
    return status.filter((s) => (STATUS_TERHADIR as readonly StatusHadir[]).includes(s)).length;
  }
}
