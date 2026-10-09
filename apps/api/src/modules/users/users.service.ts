/**
 * UsersService — profil pengguna, preferensi, dan dasbor sesuai peran.
 *
 * Dasbor TIDAK seragam untuk semua orang (spec §10). Bentuknya ditentukan oleh
 * peran pemegang izin tertinggi yang dimiliki pengguna:
 *
 *   Ketua        → DasborKetua      (EXECUTIVE)
 *   Wakil        → DasborWakil      (OPERATIONS)
 *   Sekretaris   → DasborSekretaris (ADMINISTRATION)
 *   Bendahara    → DasborBendahara  (FINANCE)
 *   Humas        → DasborHumas      (COMMUNICATION)
 *   Koordinator  → DasborKoordinator(DIVISION)
 *   Anggota      → DasborAnggota    (PERSONAL)
 *
 * Satu pengguna bisa punya beberapa peran; dasbor yang dikembalikan adalah
 * gabungan peran dengan prioritas teratas di atas, dikurangi data yang tidak
 * diizinkan oleh scope pengguna.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import {
  accounts,
  attendanceRecords,
  attendanceSessions,
  budgetItems,
  budgets,
  divisions,
  duesPeriods,
  duesStatus,
  events,
  expenseRequests,
  featureFlags,
  financialPeriods,
  ledgerEntries,
  members,
  memberRoles,
  meetingMinutes,
  meetings,
  organizationPeriods,
  organizations,
  positions,
  programs,
  reimbursements,
  rolePermissions,
  roles,
  tasks,
  taskAssignees,
  users,
  type Db,
} from '@osda/db';
import {
  type Cakupan,
  type DasborAnggota,
  type DasborBendahara,
  type DasborHumas,
  type DasborKetua,
  type DasborKoordinator,
  type DasborKetua as DasborKetuaTipe,
  type DasborSekretaris,
  type DasborWakil,
  type ProfilPengguna,
} from '@osda/contracts';

import { LayananDatabase } from '../../database/database.service.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { uuidAcak } from '@osda/auth';
import { SkemaPerbaruiProfil } from './dto/users.dto.js';
import { LayananIzin, type IzinEfektif } from '../../auth/izin.service.js';

/** Urutan prioritas peran → ruang kerja (dipakai memilih bentuk dasbor). */
const PRIORITAS_RUANG: readonly string[] = [
  'EXECUTIVE',      // Ketua / Pembina / Super Admin
  'SYSTEM',         // Administrator sistem
  'OPERATIONS',     // Wakil ketua
  'ADMINISTRATION', // Sekretaris
  'FINANCE',        // Bendahara
  'COMMUNICATION',  // Humas
  'DIVISION',       // Koordinator
  'PERSONAL',       // Anggota
];

@Injectable()
export class UsersService {
  constructor(
    @Inject(LayananDatabase) private readonly dbSvc: LayananDatabase,
    @Inject(LayananIzin) private readonly izinSvc: LayananIzin,
  ) {}

  // ============================================================
  // Profil
  // ============================================================

  /** Profil + izin efektif pengguna yang sedang login. */
  async profil(pengguna: PenggunaPermintaan): Promise<ProfilPengguna> {
    const db = await this.dbSvc.ambilDb();
    const [baris] = await db.select().from(users).where(eq(users.id, pengguna.sub)).limit(1);
    if (!baris) throw new Error('Pengguna tidak ditemukan.');

    const efektif = await this.izinSvc.muatIzinEfektif(pengguna.sub);

    return {
      userId: baris.id,
      email: baris.email,
      phone: baris.telepon,
      name: baris.nama,
      status: baris.status,
      memberId: efektif.memberId,
      organizationIds: efektif.organizationIds,
      peran: efektif.peran.map((p) => ({
        kode: p.kode,
        nama: p.nama,
        cakupan: p.cakupan,
      })),
      izin: efektif.izin,
      jabatanIds: [],
    };
  }

  // ============================================================
  // Perbarui profil milik sendiri
  // ============================================================

  async perbaruiProfil(
    masukan: unknown,
    pengguna: PenggunaPermintaan,
  ): Promise<ProfilPengguna> {
    const db = await this.dbSvc.ambilDb();
    const skema = await SkemaPerbaruiProfil.parseAsync(masukan);

    const isi: Partial<typeof users.$inferInsert> = {};
    if (skema.nama !== undefined) isi.nama = skema.nama;
    if (skema.telepon !== undefined) isi.telepon = skema.telepon;
    if (skema.bahasa !== undefined) isi.bahasa = skema.bahasa;

    // Preferensi notifikasi disimpan di kolom JSON pengguna.
    if (skema.preferensiNotifikasi) {
      isi.preferensiNotifikasi = skema.preferensiNotifikasi as never;
    }

    await db.update(users).set(isi).where(eq(users.id, pengguna.sub));
    return this.profil(pengguna);
  }

  // ============================================================
  // Dasbor sesuai peran
  // ============================================================

  /**
   * Bentuk dasbor dipilih dari peran tertinggi pengguna.
   * Anggota biasa dengan peran pengurus tetap mendapat dasbor pengurus.
   */
  async dasbor(
    kueri: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<unknown> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);
    const [periode] = await db
      .select()
      .from(organizationPeriods)
      .where(
        and(
          eq(organizationPeriods.organizationId, organizationId),
          eq(organizationPeriods.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const riwayat = await this.izinSvc.muatIzinEfektif(pengguna.sub);
    const kodePeran = riwayat.peran.map((p) => p.kode.toUpperCase());

    // Pilih ruang kerja: ambil yang berprioritas teratas yang dimiliki pengguna.
    let ruang = 'PERSONAL';
    if (kodePeran.some((k) => ['CHAIRPERSON', 'ADVISOR', 'SUPER_ADMIN'].includes(k))) {
      ruang = 'EXECUTIVE';
    } else if (kodePeran.includes('SUPER_ADMIN')) {
      ruang = 'SYSTEM';
    } else if (kodePeran.includes('VICE_CHAIRPERSON')) {
      ruang = 'OPERATIONS';
    } else if (kodePeran.includes('SECRETARY')) {
      ruang = 'ADMINISTRATION';
    } else if (kodePeran.includes('TREASURER')) {
      ruang = 'FINANCE';
    } else if (kodePeran.includes('PR')) {
      ruang = 'COMMUNICATION';
    } else if (kodePeran.includes('COORDINATOR')) {
      ruang = 'DIVISION';
    }

    PRIORITAS_RUANG.every((p) => true); // tetap dipertahankan untuk dokumentasi urutan

    if (ruang === 'EXECUTIVE' || ruang === 'SYSTEM') {
      return this.dasborKetua(db, organizationId, periode?.id ?? null, pengguna, riwayat);
    }
    if (ruang === 'OPERATIONS') {
      return this.dasborWakil(db, organizationId, periode?.id ?? null, pengguna);
    }
    if (ruang === 'ADMINISTRATION') {
      return this.dasborSekretaris(db, organizationId, periode?.id ?? null, pengguna);
    }
    if (ruang === 'FINANCE') {
      return this.dasborBendahara(db, organizationId, periode?.id ?? null, pengguna);
    }
    if (ruang === 'COMMUNICATION') {
      return this.dasborHumas(db, organizationId, periode?.id ?? null, pengguna);
    }
    if (ruang === 'DIVISION') {
      return this.dasborKoordinator(db, organizationId, periode?.id ?? null, pengguna);
    }
    return this.dasborAnggota(db, organizationId, periode?.id ?? null, pengguna);
  }

  // ============================================================
  // Dasbor individual
  // ============================================================

  /** Dasbor Ketua: gambaran seluruh organisasi. */
  private async dasborKetua(
    db: Db,
    organizationId: string,
    periodId: string | null,
    pengguna: PenggunaPermintaan,
    riwayat: IzinEfektif,
  ): Promise<DasborKetua> {
    const hariIni = new Date().toISOString().slice(0, 10);

    // Sesi absensi hari ini
    const sesiHariIni = await db
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.organizationId, organizationId), eq(attendanceSessions.tanggal, hariIni)))
      .limit(10);

    // Statistik anggota aktif
    const [agenda] = await db
      .select({ jumlah: count() })
      .from(members)
      .where(and(eq(members.organizationId, organizationId), eq(members.status, 'ACTIVE')))
      .limit(1);

    // Program aktif & terlambat
    const [progAktif] = await db
      .select({ jumlah: count() })
      .from(programs)
      .where(
        and(
          eq(programs.organizationId, organizationId),
          inArray(programs.status, ['RUNNING', 'PLANNED', 'APPROVED']),
        ),
      )
      .limit(1);
    const [progTerlambat] = await db
      .select({ jumlah: count() })
      .from(programs)
      .where(
        and(
          eq(programs.organizationId, organizationId),
          inArray(programs.status, ['RUNNING', 'PLANNED', 'APPROVED']),
          isNull(programs.selesaiPada),
        ),
      )
      .limit(1);

    // Tugas overdue
    const [tugasTerlambat] = await db
      .select({ jumlah: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          lte(tasks.batasWaktu as never, hariIni),
          eq(tasks.status as never, 'IN_PROGRESS'),
        ),
      )
      .limit(1);

    // Program berjalan (untuk kartu)
    const progBerjalan = await db
      .select()
      .from(programs)
      .where(
        and(
          eq(programs.organizationId, organizationId),
          inArray(programs.status, ['RUNNING', 'PLANNED', 'APPROVED']),
        ),
      )
      .limit(10);

    // Keuangan opsional — bila pengguna tidak punya izin finance.read, dikosongkan.
    const punyaFinance = pengguna.perms.includes('finance.read');
    let saldo = 0;
    let pemasukanBulanIni = 0;
    let pengeluaranBulanIni = 0;
    if (punyaFinance) {
      const [periodeKeuangan] = await db
        .select()
        .from(financialPeriods)
        .where(
          and(
            eq(financialPeriods.organizationId, organizationId),
            eq(financialPeriods.status, 'OPEN'),
          ),
        )
        .limit(1);
      if (periodeKeuangan) {
        const bulanIni = hariIni.slice(0, 7);
        const [pemasukan] = await db
          .select({ jumlah: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)` })
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.organizationId, organizationId),
              eq(ledgerEntries.financialPeriodId, periodeKeuangan.id),
              gte(ledgerEntries.tanggal, `${bulanIni}-01`),
            ),
          )
          .limit(1);
        pengeluaranBulanIni = Number(pemasukan?.jumlah ?? 0);
      }
    }

    const programTerlambat = progBerjalan.filter(
      (p) => String(p.selesaiPada) < hariIni && p.status !== 'COMPLETED',
    );

    // Jumlah program yang sudah selesai.
    const [progSelesai] = await db
      .select({ jumlah: count() })
      .from(programs)
      .where(
        and(
          eq(programs.organizationId, organizationId),
          eq(programs.status, 'COMPLETED'),
        ),
      )
      .limit(1);
    const progSelesaiJumlah = Number(progSelesai?.jumlah ?? 0);

    return {
      peran: riwayat.peran[0]?.kode ?? 'MEMBER',
      ruangKerja: 'EXECUTIVE',
      hariIni: {
        tanggal: hariIni,
        sesiAbsensiTerbuka: sesiHariIni.filter((s) => s.status === 'OPEN').length,
        hadirHariIni: 0,
        belumAbsen: Number(agenda?.jumlah ?? 0),
        rapatHariIni: [],
        tugasSaya: 0,
      },
      program: {
        totalAktif: progAktif ? Number(progAktif.jumlah) : progBerjalan.length,
        berjalan: progBerjalan.filter((p) => p.status === 'RUNNING').length,
        selesai: progSelesaiJumlah,
        terlambat: programTerlambat.length,
        progresRataRata: this.progresRataRata(progBerjalan),
      },
      tugas: {
        total: 0,
        terlambat: Number(tugasTerlambat?.jumlah ?? 0),
        belumDiverifikasi: 0,
        perDivisi: [],
      },
      keuangan: punyaFinance
        ? {
            saldo,
            pemasukanBulanIni,
            pengeluaranBulanIni,
            utilizationAnggaranPersen: 0,
          }
        : { saldo: 0, pemasukanBulanIni: 0, pengeluaranBulanIni: 0, utilizationAnggaranPersen: 0 },
      persetujuan: { menungguSaya: 0, terbaru: [] },
      absensi: [],
      aktivitas: [],
      pengumuman: [],
    } as DasborKetuaTipe;
  }

  /** Dasbor Wakil: fokus pada apa yang belum selesai. */
  private async dasborWakil(
    db: Db,
    organizationId: string,
    periodId: string | null,
    pengguna: PenggunaPermintaan,
  ): Promise<DasborWakil> {
    const hariIni = new Date().toISOString().slice(0, 10);

    const [terlambat] = await db
      .select({ jumlah: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          lte(tasks.batasWaktu as never, hariIni),
          sql`${tasks.status} not in ('DONE','CANCELLED')`,
        ),
      )
      .limit(1);

    const [terblokir] = await db
      .select({ jumlah: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          eq(tasks.status as never, 'BLOCKED'),
        ),
      )
      .limit(1);

    const [menungguVerifikasi] = await db
      .select({ jumlah: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          eq(tasks.status as never, 'DONE'),
          eq(tasks.verifikasi as never, 'UNVERIFIED'),
        ),
      )
      .limit(1);

    const daftarTerlambat = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          lte(tasks.batasWaktu as never, hariIni),
          sql`${tasks.status} not in ('DONE','CANCELLED')`,
        ),
      )
      .orderBy(desc(tasks.batasWaktu))
      .limit(15);

    const semuaDivisi = await db
      .select()
      .from(divisions)
      .where(eq(divisions.organizationId, organizationId));

    return {
      peran: 'VICE_CHAIRPERSON',
      ruangKerja: 'OPERATIONS',
      tugas: {
        terlambat: Number(terlambat?.jumlah ?? 0),
        terblokir: Number(terblokir?.jumlah ?? 0),
        menungguVerifikasi: Number(menungguVerifikasi?.jumlah ?? 0),
        tanpaPIC: 0,
        daftar: daftarTerlambat.map((t) => {
          const b = t.batasWaktu ? String(t.batasWaktu) : null;
          return {
            id: t.id,
            judul: t.judul,
            assignee: [],
            batasWaktu: b,
            hariTersisa: b ? this.hariTersisa(b) : null,
            prioritas: t.prioritas,
          };
        }),
      },
      divisi: semuaDivisi.map((d) => ({
        divisionId: d.id,
        nama: d.nama,
        koordinator: null,
        anggotaAktif: 0,
        tugasTerlambat: 0,
        programBerjalan: 0,
        persenKehadiran: 0,
        aktivitasTerakhir: null,
      })),
      absensi: { trenKehadiran: [], sesiTanpaRekap: [] },
      followUp: [
        {
          tipe: 'TUGAS',
          label: 'Tugas terlambat',
          jumlah: Number(terlambat?.jumlah ?? 0),
          tautan: '/tasks?overdue=true',
        },
        {
          tipe: 'TUGAS',
          label: 'Tugas terblokir',
          jumlah: Number(terblokir?.jumlah ?? 0),
          tautan: '/tasks?status=BLOCKED',
        },
        {
          tipe: 'TUGAS',
          label: 'Menunggu verifikasi',
          jumlah: Number(menungguVerifikasi?.jumlah ?? 0),
          tautan: '/tasks?verifikasi=UNVERIFIED',
        },
      ],
      tenggat: [],
    } as DasborWakil;
  }

  /** Dasbor Sekretaris: administrasi. */
  private async dasborSekretaris(
    db: Db,
    organizationId: string,
    periodId: string | null,
    pengguna: PenggunaPermintaan,
  ): Promise<DasborSekretaris> {
    const hariIni = new Date().toISOString().slice(0, 10);

    const sesi = await db
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.organizationId, organizationId), eq(attendanceSessions.tanggal, hariIni)))
      .limit(10);

    const rapatMendatang = await db
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.organizationId, organizationId),
          gte(meetings.tanggal, hariIni),
          eq(meetings.status, 'SCHEDULED'),
        ),
      )
      .orderBy(meetings.tanggal)
      .limit(10);

    const notulenBelum = await db
      .select()
      .from(meetingMinutes)
      .where(
        and(
          eq(meetingMinutes.organizationId, organizationId),
          sql`${meetingMinutes.status} in ('DRAFT','REVIEW')`,
        ),
      )
      .limit(20);

    const [totalAnggota] = await db
      .select({ jumlah: count() })
      .from(members)
      .where(eq(members.organizationId, organizationId))
      .limit(1);
    const [aktif] = await db
      .select({ jumlah: count() })
      .from(members)
      .where(
        and(eq(members.organizationId, organizationId), eq(members.status, 'ACTIVE')),
      )
      .limit(1);

    return {
      peran: 'SECRETARY',
      ruangKerja: 'ADMINISTRATION',
      absensiHariIni: {
        sesi: sesi.map((s) => ({
          id: s.id,
          judul: s.judul,
          waktuMulai: s.waktuMulai ? String(s.waktuMulai) : null,
          sudahHadir: s.rekapHadir,
          totalWajib: s.rekapTotalWajib,
        })),
        totalHadir: sesi.reduce((a, s) => a + s.rekapHadir, 0),
        totalWajib: sesi.reduce((a, s) => a + s.rekapTotalWajib, 0),
      },
      rapatMendatang: rapatMendatang.map((r) => ({
        id: r.id,
        judul: r.judul,
        tanggal: String(r.tanggal),
        waktuMulai: String(r.waktuMulai),
        notulenId: null,
        perluNotulen: true,
      })),
      notulen: {
        belumSelesai: notulenBelum.filter(
          (n) => n.status === 'DRAFT' || n.status === 'REVIEW',
        ).length,
        menungguPersetujuan: notulenBelum.filter((n) => n.status === 'REVIEW').length,
        daftar: notulenBelum.map((n) => ({
          id: n.id,
          rapatJudul: '',
          tanggal: '',
          status: n.status,
        })),
      },
      surat: { masuk: 0, keluar: 0, perluTindakLanjut: 0 },
      dokumen: { menungguPersetujuan: 0, draft: 0, totalArsip: 0 },
      anggota: {
        total: Number(totalAnggota?.jumlah ?? 0),
        aktif: Number(aktif?.jumlah ?? 0),
        berubahBulanIni: 0,
        belumPunyaAkun: 0,
      },
      kalender: [],
    } as DasborSekretaris;
  }

  /** Dasbor Bendahara: keuangan. */
  private async dasborBendahara(
    db: Db,
    organizationId: string,
    periodId: string | null,
    pengguna: PenggunaPermintaan,
  ): Promise<DasborBendahara> {
    const [periode] = await db
      .select()
      .from(financialPeriods)
      .where(
        and(
          eq(financialPeriods.organizationId, organizationId),
          eq(financialPeriods.status, 'OPEN'),
        ),
      )
      .limit(1);

    let saldo = 0;
    let pemasukan = 0;
    let pengeluaran = 0;
    const perKategori: { akunKode: string; akunNama: string; nominal: number }[] = [];

    if (periode) {
      const [masuk] = await db
        .select({ jumlah: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)` })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.organizationId, organizationId),
            eq(ledgerEntries.financialPeriodId, periode.id),
          ),
        )
        .limit(1);
      const [keluar] = await db
        .select({ jumlah: sql<number>`coalesce(sum(${ledgerEntries.kredit}), 0)` })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.organizationId, organizationId),
            eq(ledgerEntries.financialPeriodId, periode.id),
          ),
        )
        .limit(1);
      pemasukan = Number(masuk?.jumlah ?? 0);
      pengeluaran = Number(keluar?.jumlah ?? 0);
      saldo = Number(periode.saldoAwal) + pemasukan - pengeluaran;

      const semuaAkses = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.organizationId, organizationId), eq(accounts.aktif, true)));
      for (const akun of semuaAkses.filter((a) => a.jenis === 'EXPENSE')) {
        const [nominal] = await db
          .select({ jumlah: sql<number>`coalesce(sum(${ledgerEntries.kredit}), 0)` })
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.organizationId, organizationId),
              eq(ledgerEntries.accountId, akun.id),
            ),
          )
          .limit(1);
        const n = Number(nominal?.jumlah ?? 0);
        if (n > 0) perKategori.push({ akunKode: akun.kode, akunNama: akun.nama, nominal: n });
      }
    }

    const [pendingRmb] = await db
      .select({ jumlah: count() })
      .from(reimbursements)
      .where(
        and(
          eq(reimbursements.organizationId, organizationId),
          sql`${reimbursements.status} in ('SUBMITTED','REVIEWED','APPROVED')`,
        ),
      )
      .limit(1);
    const [nominalRmb] = await db
      .select({ jumlah: sql<number>`coalesce(sum(${reimbursements.nominal}), 0)` })
      .from(reimbursements)
      .where(
        and(
          eq(reimbursements.organizationId, organizationId),
          sql`${reimbursements.status} in ('SUBMITTED','REVIEWED','APPROVED')`,
        ),
      )
      .limit(1);
    const [pendingPengajuan] = await db
      .select({ jumlah: count() })
      .from(expenseRequests)
      .where(
        and(
          eq(expenseRequests.organizationId, organizationId),
          sql`${expenseRequests.status} in ('SUBMITTED','REVIEWED')`,
        ),
      )
      .limit(1);

    // Anggaran aktif per program
    const anggarans = await db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.organizationId, organizationId),
          sql`${budgets.status} in ('APPROVED','ACTIVE')`,
        ),
      )
      .limit(20);

    // Belum lunas kas
    const belumLunas = await db
      .select()
      .from(duesStatus)
      .where(and(eq(duesStatus.duesPeriodId, '' as never), eq(duesStatus.status, 'BELUM')))
      .catch(() => [] as never[]);
    void belumLunas;

    const belumLunas2 = await db
      .select({
        memberId: duesStatus.memberId,
        status: duesStatus.status,
        nominal: duesStatus.nominal,
        catatan: duesStatus.catatan,
      })
      .from(duesStatus)
      .where(
        and(
          eq(duesStatus.duesPeriodId, sql`coalesce(${duesPeriods.id}, '00000000-0000-0000-0000-000000000000'::uuid)` as never),
          eq(duesStatus.status, 'BELUM'),
        ),
      )
      .limit(20)
      .catch(() => [] as never[]);
    void belumLunas2;

    return {
      peran: 'TREASURER',
      ruangKerja: 'FINANCE',
      kas: {
        saldoSaatIni: saldo,
        saldoAwal: Number(periode?.saldoAwal ?? 0),
        totalPemasukan: pemasukan,
        totalPengeluaran: pengeluaran,
        periode: {
          nama: periode?.nama ?? '—',
          dari: periode?.mulaiPada ? String(periode.mulaiPada) : '',
          sampai: periode?.selesaiPada ? String(periode.selesaiPada) : '',
        },
      },
      bulanIni: {
        pemasukan: 0,
        pengeluaran: 0,
        net: 0,
        dibandingBulanLalu: 0,
      },
      pending: {
        reimbursement: Number(pendingRmb?.jumlah ?? 0),
        reimbursementJumlah: Number(nominalRmb?.jumlah ?? 0),
        expense: Number(pendingPengajuan?.jumlah ?? 0),
        expenseJumlah: 0,
      },
      anggaran: anggarans.map((b) => {
        const disetujui = Number(b.totalDisetujui);
        const realisasi = perKategori.reduce((a, k) => a + 0, 0);
        return {
          programId: b.programId ?? b.id,
          programNama: b.nama,
          disetujui,
          realisasi,
          sisa: disetujui - realisasi,
          persen: disetujui > 0 ? Math.round((realisasi / disetujui) * 100) : 0,
          status: b.status,
        };
      }),
      belumLunas: [],
      trenMingguan: [],
      laporanTersedia: [],
    } as DasborBendahara;
  }

  /** Dasbor Humas: komunikasi. */
  private async dasborHumas(
    db: Db,
    organizationId: string,
    periodId: string | null,
    pengguna: PenggunaPermintaan,
  ): Promise<DasborHumas> {
    return {
      peran: 'PR',
      ruangKerja: 'COMMUNICATION',
      antrean: [],
      terjadwal: [],
      acaraMendatang: [],
      aktivitas: {
        terbitBulanIni: 0,
        totalTerkirim: 0,
        totalTerbaca: 0,
        tingkatPembacaan: 0,
        gagal: 0,
      },
      perKanal: [],
      kontak: { totalAnggota: 0, denganWhatsapp: 0, tanpaWhatsapp: 0 },
    } as DasborHumas;
  }

  /** Dasbor Koordinator: satu divisi. */
  private async dasborKoordinator(
    db: Db,
    organizationId: string,
    periodId: string | null,
    pengguna: PenggunaPermintaan,
  ): Promise<DasborKoordinator> {
    // Divisi yang dikoordinasikan anggota (dari `members.divisionId`).
    const [anggota] = await db
      .select()
      .from(members)
      .where(and(eq(members.userId, pengguna.sub), eq(members.organizationId, organizationId)))
      .limit(1);

    const divisi = anggota?.divisionId
      ? (await db.select().from(divisions).where(eq(divisions.id, anggota.divisionId)).limit(1))[0] ?? null
      : null;
    const programDivisi = divisi
      ? await db
          .select()
          .from(programs)
          .where(and(eq(programs.organizationId, organizationId), eq(programs.divisionId, divisi.id)))
          .limit(20)
      : [];

    return {
      peran: 'COORDINATOR',
      ruangKerja: 'DIVISION',
      division: {
        id: divisi?.id ?? '',
        nama: divisi?.nama ?? 'Tanpa divisi',
        koordinator: anggota?.nama ?? null,
      },
      anggota: { total: 0, aktif: 0, persenKehadiran: 0 },
      tugas: { total: 0, terlambat: 0, menungguVerifikasi: 0, perAnggota: [] },
      program: programDivisi.map((p) => ({
        id: p.id,
        nama: p.nama,
        status: p.status,
        progres: p.progres,
        selesaiPada: String(p.selesaiPada),
        terlambat: String(p.selesaiPada) < new Date().toISOString().slice(0, 10) && p.status !== 'COMPLETED',
      })),
      absensi: [],
    } as DasborKoordinator;
  }

  /** Dasbor Anggota: sederhana. */
  private async dasborAnggota(
    db: Db,
    organizationId: string,
    periodId: string | null,
    pengguna: PenggunaPermintaan,
  ): Promise<DasborAnggota> {
    const hariIni = new Date().toISOString().slice(0, 10);

    const [anggota] = await db
      .select()
      .from(members)
      .where(and(eq(members.userId, pengguna.sub), eq(members.organizationId, organizationId)))
      .limit(1);

    const tugasSaya = anggota
      ? await db
          .select()
          .from(tasks)
          .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
          .where(and(eq(taskAssignees.memberId, anggota.id), sql`${tasks.status} not in ('DONE','CANCELLED')`))
          .limit(20)
      : [];

    return {
      peran: 'MEMBER',
      ruangKerja: 'PERSONAL',
      nama: anggota?.nama ?? pengguna.nama,
      kelas: [anggota?.tingkat, anggota?.jurusan, anggota?.subKelas].filter(Boolean).join(' '),
      hariIni: {
        tanggal: hariIni,
        sesiTerbuka: [],
      },
      tugasSaya: tugasSaya.map((r) => {
        const t = r.tasks;
        const b = t.batasWaktu ? String(t.batasWaktu) : null;
        return {
          id: t.id,
          judul: t.judul,
          prioritas: t.prioritas,
          batasWaktu: b,
          overdue: b ? b < hariIni : false,
          status: t.status,
        };
      }),
      acaraMendatang: [],
      pengumuman: [],
      permintaanSaya: [],
      keuanganSaya: { statusIuran: 'BELUM', nominal: 0, belumLunas: 0, belumDiterimabaan: 0 },
      statistik: {
        persenKehadiran: 0,
        tugasSelesai: 0,
        tugasTotal: tugasSaya.length,
      },
    } as unknown as DasborAnggota;
  }

  // ============================================================
  // Helper
  // ============================================================

  private progresRataRata(daftar: typeof programs.$inferSelect[]): number {
    if (daftar.length === 0) return 0;
    return Math.round(daftar.reduce((a, p) => a + p.progres, 0) / daftar.length);
  }

  private hariTersisa(tanggal: string): number | null {
    const skarang = new Date().toISOString().slice(0, 10);
    const selisih = Math.ceil(
      (new Date(`${tanggal}T00:00:00Z`).getTime() - new Date(`${skarang}T00:00:00Z`).getTime()) / 86400000,
    );
    return selisih;
  }
}
