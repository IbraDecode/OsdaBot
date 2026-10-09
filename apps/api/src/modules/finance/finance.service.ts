/**
 * FinanceService (bagian 1) — chart of accounts, periode keuangan, anggaran.
 *
 * Aturan utama modul keuangan (spec §22–§26, §44):
 *  1. Saldo TIDAK PERNAH disimpan sebagai satu angka — saldo dihitung dari
 *     `ledger_entries` yang immutable.
 *  2. Setiap perubahan uang berada di dalam satu batas transaksi database.
 *  3. Pemohon TIDAK BOLEH menjadi pemberi persetujuan atas pengajuannya sendiri.
 *  4. Webhook pembayaran WAJIB idempoten (unique index payments.referensi_provider).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { dalamTransaksi } from '@osda/db';
import {
  type Akun,
  type Anggaran,
  type JenisAkun,
  type PayloadBuatAkun,
  type PayloadBuatAnggaran,
  type PayloadBuatPengajuan,
  type PayloadBuatPaymentIntent,
  type PayloadBuatPeriodeKeuangan,
  type PayloadBuatReimbursement,
  type PeriodeKeuangan,
  type Transaksi,
} from '@osda/contracts';
import {
  accounts,
  budgetItems,
  budgets,
  expenseRequests,
  financialPeriods,
  ledgerEntries,
  members,
  programs,
  reimbursements,
  transactions,
  type Db,
} from '@osda/db';

import { galatDuplikat, galatIzinDitolak, galatTidakDitemukan, galatTransisi, galatValidasi } from '../../common/galat.js';
import { offsetDari } from '../../common/utilitas/paginasi.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { catatAudit } from '../../common/utilitas/konteks.js';
import { kodeDenganAwalan, kodeTransaksi } from '../../common/utilitas/kode.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';
import { SkemaFilterAnggaran, SkemaFilterTransaksi } from '../../common/utilitas/skema-finance.js';
import { z } from 'zod';

/** Ringkasan buku kas. */
export interface RingkasanKas {
  readonly saldoAwal: number;
  readonly totalPemasukan: number;
  readonly totalPengeluaran: number;
  readonly saldoAkhir: number;
  readonly perKategori: { akunKode: string; akunNama: string; nominal: number }[];
}

@Injectable()
export class FinanceService {
  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  // ============================================================
  // Chart of accounts
  // ============================================================

  async daftarAkun(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Akun[] }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const baris = await db
      .select()
      .from(accounts)
      .where(eq(accounts.organizationId, organizationId))
      .orderBy(accounts.kode);

    return {
      data: baris.map((b) => ({
        id: b.id,
        kode: b.kode,
        nama: b.nama,
        jenis: b.jenis,
        indukId: b.indukId,
        saldo: 0,
        aktif: b.aktif,
      })),
    };
  }

  async buatAkun(
    masukan: PayloadBuatAkun,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Akun> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [baru] = await db
      .insert(accounts)
      .values({
        organizationId,
        kode: masukan.kode,
        nama: masukan.nama,
        jenis: masukan.jenis,
        indukId: masukan.indukId ?? null,
        deskripsi: masukan.deskripsi ?? null,
        aktif: masukan.aktif,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat akun.');
    return {
      id: baru.id,
      kode: baru.kode,
      nama: baru.nama,
      jenis: baru.jenis,
      indukId: baru.indukId,
      saldo: 0,
      aktif: baru.aktif,
    };
  }

  // ============================================================
  // Periode keuangan
  // ============================================================

  async daftarPeriodeKeuangan(
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: PeriodeKeuangan[] }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const baris = await db
      .select()
      .from(financialPeriods)
      .where(eq(financialPeriods.organizationId, organizationId))
      .orderBy(desc(financialPeriods.mulaiPada));

    return { data: baris.map((b) => this.kePeriodeKeuangan(b)) };
  }

  async buatPeriodeKeuangan(
    masukan: PayloadBuatPeriodeKeuangan,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<PeriodeKeuangan> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const [baru] = await db
      .insert(financialPeriods)
      .values({
        organizationId,
        periodId: masukan.periodId ?? null,
        nama: masukan.nama,
        mulaiPada: masukan.mulaiPada,
        selesaiPada: masukan.selesaiPada,
        saldoAwal: masukan.saldoAwal,
        status: 'OPEN',
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat periode keuangan.');
    return this.kePeriodeKeuangan(baru);
  }

  // ============================================================
  // Anggaran
  // ============================================================

  async daftarAnggaran(
    filter: z.infer<typeof SkemaFilterAnggaran>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Anggaran[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      filter.organizationId,
    );

    const syarat: ReturnType<typeof and>[] = [eq(budgets.organizationId, organizationId)];
    if (filter.programId) syarat.push(eq(budgets.programId, filter.programId));
    if (filter.status) syarat.push(eq(budgets.status, filter.status));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(budgets)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(budgets)
      .where(and(...syarat))
      .orderBy(desc(budgets.dibuatPada))
      .limit(filter.limit)
      .offset(offsetDari(filter));

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / filter.limit));
    const data = await Promise.all(baris.map((b) => this.keAnggaran(db, b)));

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

  async buatAnggaran(
    masukan: PayloadBuatAnggaran,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Anggaran> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const hasil = await dalamTransaksi(db, async (tx: Db) => {
      const kode = `ANG-${new Date().getFullYear()}-${kodeDenganAwalan('').trim()}`;
      const [baru] = await tx
        .insert(budgets)
        .values({
          organizationId,
          periodId: masukan.periodId ?? null,
          programId: masukan.programId ?? null,
          eventId: masukan.eventId ?? null,
          financialPeriodId: masukan.periodeKeuanganId,
          kode,
          nama: masukan.nama,
          totalDiajukan: masukan.totalDiajukan,
          catatan: masukan.catatan ?? null,
          status: 'DRAFT',
          dibuatOleh: pengguna.memberId,
        })
        .returning();

      if (!baru) throw galatValidasi(undefined, 'Gagal membuat anggaran.');

      if (masukan.butir.length > 0) {
        await tx.insert(budgetItems).values(
          masukan.butir.map((butir) => ({
            budgetId: baru.id,
            accountId: butir.akunId,
            keterangan: butir.keterangan,
            nominal: butir.nominal,
          })),
        );
      }

      return baru;
    });

    return this.keAnggaran(db, hasil);
  }

  // ============================================================
  // Transaksi & ledger
  // ============================================================

  async daftarTransaksi(
    filter: z.infer<typeof SkemaFilterTransaksi>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: Transaksi[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      filter.organizationId,
    );

    const syarat: ReturnType<typeof and>[] = [eq(transactions.organizationId, organizationId)];
    if (filter.akunId) syarat.push(eq(transactions.accountId, filter.akunId));
    if (filter.programId) syarat.push(eq(transactions.programId, filter.programId));
    if (filter.jenis) syarat.push(eq(transactions.jenis, filter.jenis));
    if (filter.arah) syarat.push(eq(transactions.arah, filter.arah));
    if (filter.status) syarat.push(eq(transactions.status, filter.status));
    if (filter.rentang?.dari) syarat.push(gte(transactions.tanggal, filter.rentang.dari));
    if (filter.rentang?.sampai) syarat.push(lte(transactions.tanggal, filter.rentang.sampai));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(transactions)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select()
      .from(transactions)
      .where(and(...syarat))
      .orderBy(desc(transactions.tanggal), desc(transactions.dibuatPada))
      .limit(filter.limit)
      .offset(offsetDari(filter));

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / filter.limit));
    const data = await Promise.all(baris.map((b) => this.keTransaksi(db, b)));

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

  // ============================================================
  // Helper internal
  // ============================================================

  private kePeriodeKeuangan(b: typeof financialPeriods.$inferSelect): PeriodeKeuangan {
    return {
      id: b.id,
      organizationId: b.organizationId,
      nama: b.nama,
      mulaiPada: b.mulaiPada,
      selesaiPada: b.selesaiPada,
      saldoAwal: b.saldoAwal,
      status: b.status,
      ditutupPada: b.ditutupPada ? String(b.ditutupPada) : null,
      ditutupOleh: b.ditutupOleh,
    };
  }

  private async keAnggaran(db: Db, b: typeof budgets.$inferSelect): Promise<Anggaran> {
    const [program] = b.programId
      ? await db.select({ nama: programs.nama }).from(programs).where(eq(programs.id, b.programId)).limit(1)
      : [];

    const butir = await db
      .select({
        id: budgetItems.id,
        akunKode: accounts.kode,
        akunNama: accounts.nama,
        keterangan: budgetItems.keterangan,
        nominal: budgetItems.nominal,
        realisasi: budgetItems.realisasi,
      })
      .from(budgetItems)
      .innerJoin(accounts, eq(accounts.id, budgetItems.accountId))
      .where(eq(budgetItems.budgetId, b.id));

    const realisasi = butir.reduce((total, i) => total + i.realisasi, 0);
    const sisa = b.totalDisetujui - realisasi;

    return {
      id: b.id,
      kode: b.kode,
      organizationId: b.organizationId,
      nama: b.nama,
      programId: b.programId,
      programNama: program?.nama ?? null,
      totalDiajukan: b.totalDiajukan,
      totalDisetujui: b.totalDisetujui,
      realisasi,
      sisa,
      persenTerpakai: b.totalDisetujui === 0 ? 0 : Math.round((realisasi / b.totalDisetujui) * 100),
      status: b.status,
      periodeKeuanganId: b.financialPeriodId,
      butir: butir.map((i) => ({ ...i })),
      disetujuiOleh: b.disetujuiOleh,
      disetujuiPada: b.disetujuiPada ? String(b.disetujuiPada) : null,
      dibuatPada: String(b.dibuatPada),
    };
  }

  private async keTransaksi(db: Db, b: typeof transactions.$inferSelect): Promise<Transaksi> {
    const [akun] = await db
      .select({ kode: accounts.kode, nama: accounts.nama })
      .from(accounts)
      .where(eq(accounts.id, b.accountId))
      .limit(1);

    const [program] = b.programId
      ? await db.select({ nama: programs.nama }).from(programs).where(eq(programs.id, b.programId)).limit(1)
      : [];

    return {
      id: b.id,
      kode: b.kode,
      organizationId: b.organizationId,
      jenis: b.jenis,
      arah: b.arah,
      akunId: b.accountId,
      akunKode: akun?.kode ?? '',
      akunNama: akun?.nama ?? '',
      nominal: b.nominal,
      keterangan: b.keterangan,
      tanggal: b.tanggal,
      status: b.status,
      programId: b.programId,
      programNama: program?.nama ?? null,
      eventId: b.eventId,
      pengajuanId: b.expenseRequestId,
      pemohonId: b.dicatatOleh,
      pemohonNama: null,
      disetujuiOleh: b.disetujuiOleh,
      disetujuiPada: b.disetujuiPada ? String(b.disetujuiPada) : null,
      dipostingPada: b.dipostingPada ? String(b.dipostingPada) : null,
      dibuatPada: String(b.dibuatPada),
    };
  }

  // ============================================================
  // Transaksi kas — catat, setujui, posting ke ledger
  // ============================================================

  /**
   * Catat transaksi kas. Status awal DRAFT; baru masuk `ledger_entries` setelah
   * disetujui (`finance.approve`) dan diposting.
   */
  async buatTransaksi(
    masukan: {
      organizationId: string;
      akunId: string;
      accountTujuanId?: string | null;
      jenis: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'REIMBURSEMENT' | 'ADJUSTMENT';
      arah: 'IN' | 'OUT';
      nominal: number;
      keterangan: string;
      tanggal: string;
      programId?: string | null;
      eventId?: string | null;
      idempotencyKey?: string;
    },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Transaksi> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    if (masukan.idempotencyKey) {
      const [ada] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.organizationId, organizationId),
            eq(transactions.idempotencyKey, masukan.idempotencyKey),
          ),
        )
        .limit(1);
      if (ada) {
        const [baris] = await db.select().from(transactions).where(eq(transactions.id, ada.id)).limit(1);
        if (baris) return this.keTransaksi(db, baris);
      }
    }

    const periode = await this.periodeAktif(db, organizationId, masukan.tanggal);
    const kode = kodeTransaksi(
      new Date().getFullYear(),
      await this.urutanTransaksi(db, organizationId),
    );

    const [baru] = await db
      .insert(transactions)
      .values({
        organizationId,
        financialPeriodId: periode.id,
        kode,
        jenis: masukan.jenis,
        arah: masukan.arah,
        accountId: masukan.akunId,
        accountTujuanId: masukan.accountTujuanId ?? null,
        nominal: masukan.nominal,
        keterangan: masukan.keterangan,
        tanggal: masukan.tanggal,
        status: 'DRAFT',
        programId: masukan.programId ?? null,
        eventId: masukan.eventId ?? null,
        dicatatOleh: pengguna.memberId,
        idempotencyKey: masukan.idempotencyKey ?? null,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal mencatat transaksi.');

    await catatAudit(this.dbSvc, {
      organizationId,
      aksi: 'EXPENSE_CREATED',
      entitasTabel: 'transactions',
      entitasId: baru.id,
      pengguna,
      requestId: permintaan.requestId,
      sesudah: { kode: baru.kode, nominal: baru.nominal, jenis: baru.jenis },
    });

    return this.keTransaksi(db, baru);
  }

  /**
   * Setujui transaksi lalu posting ke ledger dalam SATU transaksi database.
   * `ledger_entries` bersifat immutable — koreksi hanya lewat ADJUSTMENT baru.
   */
  async putuskanTransaksi(
    id: string,
    keputusan: 'APPROVED' | 'REJECTED',
    komentar: string | undefined,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<Transaksi> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [sebelum] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.organizationId, organizationId)))
      .limit(1);
    if (!sebelum) throw galatTidakDitemukan('Transaksi tidak ditemukan.');

    if (sebelum.status !== 'DRAFT' && sebelum.status !== 'PENDING_APPROVAL') {
      throw galatTransisi(`Transaksi berstatus ${sebelum.status} tidak bisa diputus lagi.`);
    }
    if (sebelum.dicatatOleh && sebelum.dicatatOleh === pengguna.memberId) {
      throw galatIzinDitolak('Pencatat transaksi tidak boleh menyetujui transaksinya sendiri.');
    }

    const hariIni = this.hariIni();

    if (keputusan === 'REJECTED') {
      const [setelah] = await db
        .update(transactions)
        .set({ status: 'REJECTED', disetujuiOleh: pengguna.memberId, disetujuiPada: hariIni })
        .where(eq(transactions.id, id))
        .returning();
      if (!setelah) throw galatValidasi(undefined, 'Gagal memperbarui transaksi.');
      await this.catatAuditTransaksi(organizationId, 'EXPENSE_APPROVED', sebelum, setelah, pengguna, permintaan, komentar);
      return this.keTransaksi(db, setelah);
    }

    const hasil = await dalamTransaksi(db, async (tx: Db) => {
      const [disetujui] = await tx
        .update(transactions)
        .set({ status: 'APPROVED', disetujuiOleh: pengguna.memberId, disetujuiPada: hariIni })
        .where(eq(transactions.id, id))
        .returning();
      if (!disetujui) throw galatValidasi(undefined, 'Gagal menyetujui transaksi.');

      const [diposting] = await tx
        .update(transactions)
        .set({ status: 'POSTED', dipostingPada: hariIni })
        .where(eq(transactions.id, id))
        .returning();
      if (!diposting) throw galatValidasi(undefined, 'Gagal memposting transaksi.');

      const debit = sebelum.arah === 'IN' ? sebelum.nominal : 0;
      const kredit = sebelum.arah === 'OUT' ? sebelum.nominal : 0;

      await tx.insert(ledgerEntries).values({
        transaksiId: diposting.id,
        organizationId,
        financialPeriodId: sebelum.financialPeriodId,
        accountId: sebelum.accountId,
        tanggal: sebelum.tanggal,
        debit,
        kredit,
        narration: `[${diposting.kode}] ${sebelum.keterangan}`,
        createdBy: pengguna.memberId,
      });

      // TRANSFER: catat pula sisi tujuan agar buku kas dua arah tetap konsisten.
      if (sebelum.jenis === 'TRANSFER' && sebelum.accountTujuanId) {
        await tx.insert(ledgerEntries).values({
          transaksiId: diposting.id,
          organizationId,
          financialPeriodId: sebelum.financialPeriodId,
          accountId: sebelum.accountTujuanId,
          tanggal: sebelum.tanggal,
          debit: kredit,
          kredit: debit,
          narration: `[${diposting.kode}] Transfer masuk dari akun ${sebelum.accountId}`,
          createdBy: pengguna.memberId,
        });
      }

      return diposting;
    });

    await this.catatAuditTransaksi(organizationId, 'EXPENSE_APPROVED', sebelum, hasil, pengguna, permintaan, komentar);
    return this.keTransaksi(db, hasil);
  }

  /** Buku besar (ledger) — immutable, hanya boleh dibaca. */
  async daftarLedger(
    filter: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: unknown[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const page = Number(filter.page ?? 1);
    const limit = Number(filter.limit ?? 50);
    const syarat: ReturnType<typeof and>[] = [eq(ledgerEntries.organizationId, organizationId)];
    if (filter.akunId) syarat.push(eq(ledgerEntries.accountId, String(filter.akunId)));
    if (filter.periodeKeuanganId) {
      syarat.push(eq(ledgerEntries.financialPeriodId, String(filter.periodeKeuanganId)));
    }
    const rentang = (filter.rentang ?? {}) as { dari?: string; sampai?: string };
    if (rentang.dari) syarat.push(gte(ledgerEntries.tanggal, String(rentang.dari)));
    if (rentang.sampai) syarat.push(lte(ledgerEntries.tanggal, String(rentang.sampai)));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(ledgerEntries)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select({
        id: ledgerEntries.id,
        transaksiId: ledgerEntries.transaksiId,
        periodeKeuanganId: ledgerEntries.financialPeriodId,
        akunId: ledgerEntries.accountId,
        akunKode: accounts.kode,
        tanggal: ledgerEntries.tanggal,
        debit: ledgerEntries.debit,
        kredit: ledgerEntries.kredit,
        saldoBerjalan: ledgerEntries.saldoRunnable,
        narration: ledgerEntries.narration,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(...syarat))
      .orderBy(desc(ledgerEntries.tanggal), desc(ledgerEntries.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: baris.map((b) => ({
        id: b.id,
        transaksiId: b.transaksiId,
        periodeKeuanganId: b.periodeKeuanganId,
        akunId: b.akunId,
        akunKode: b.akunKode,
        tanggal: b.tanggal,
        debet: b.debit,
        kredit: b.kredit,
        saldoBerjalan: b.saldoBerjalan,
        narration: b.narration,
        createdAt: String(b.createdAt),
      })),
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

  /** Buku kas: saldo dihitung dari ledger, tidak pernah disimpan sebagai angka. */
  async kas(
    filter: {
      periodeKeuanganId?: string;
      dari?: string;
      sampai?: string;
      rentang?: { dari?: string; sampai?: string };
    },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<RingkasanKas & { periode: { dari: string; sampai: string } }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const periode = filter.periodeKeuanganId
      ? await this.ambilPeriodeKeuangan(db, filter.periodeKeuanganId, organizationId)
      : await this.periodeTerbaru(db, organizationId);

    const syarat: ReturnType<typeof and>[] = [
      eq(ledgerEntries.organizationId, organizationId),
      eq(ledgerEntries.financialPeriodId, periode.id),
    ];
    const rentangDari = filter.rentang?.dari ?? filter.dari;
    const rentangSampai = filter.rentang?.sampai ?? filter.sampai;
    if (rentangDari) syarat.push(gte(ledgerEntries.tanggal, String(rentangDari)));
    if (rentangSampai) syarat.push(lte(ledgerEntries.tanggal, String(rentangSampai)));

    const baris = await db
      .select({
        akunKode: accounts.kode,
        akunNama: accounts.nama,
        debit: ledgerEntries.debit,
        kredit: ledgerEntries.kredit,
        adalahKas: accounts.adalahKas,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(...syarat));

    let totalPemasukan = 0;
    let totalPengeluaran = 0;
    const petaKategori = new Map<string, { nama: string; nominal: number }>();

    for (const b of baris) {
      totalPemasukan += b.debit;
      totalPengeluaran += b.kredit;
      const kunci = b.akunKode;
      const ada = petaKategori.get(kunci);
      petaKategori.set(kunci, {
        nama: b.akunNama,
        nominal: (ada?.nominal ?? 0) + b.kredit,
      });
    }

    return {
      saldoAwal: periode.saldoAwal,
      totalPemasukan,
      totalPengeluaran,
      saldoAkhir: periode.saldoAwal + totalPemasukan - totalPengeluaran,
      perKategori: [...petaKategori.entries()].map(([akunKode, v]) => ({
        akunKode,
        akunNama: v.nama,
        nominal: v.nominal,
      })),
      periode: { dari: periode.mulaiPada, sampai: periode.selesaiPada },
    };
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private async periodeAktif(
    db: Db,
    organizationId: string,
    tanggal: string,
  ): Promise<typeof financialPeriods.$inferSelect> {
    const [periode] = await db
      .select()
      .from(financialPeriods)
      .where(
        and(
          eq(financialPeriods.organizationId, organizationId),
          eq(financialPeriods.status, 'OPEN'),
          lte(financialPeriods.mulaiPada, tanggal),
          gte(financialPeriods.selesaiPada, tanggal),
        ),
      )
      .limit(1);

    if (periode) return periode;
    const [terbaru] = await this.periodeTerbaruOptional(db, organizationId);
    if (terbaru) return terbaru;

    throw galatValidasi(
      { field: 'tanggal' },
      'Belum ada periode keuangan yang aktif untuk tanggal tersebut.',
    );
  }

  private async periodeTerbaru(
    db: Db,
    organizationId: string,
  ): Promise<typeof financialPeriods.$inferSelect> {
    const [periode] = await db
      .select()
      .from(financialPeriods)
      .where(eq(financialPeriods.organizationId, organizationId))
      .orderBy(desc(financialPeriods.mulaiPada))
      .limit(1);
    if (!periode) throw galatTidakDitemukan('Belum ada periode keuangan.');
    return periode;
  }

  private async periodeTerbaruOptional(
    db: Db,
    organizationId: string,
  ): Promise<(typeof financialPeriods.$inferSelect)[]> {
    return db
      .select()
      .from(financialPeriods)
      .where(eq(financialPeriods.organizationId, organizationId))
      .orderBy(desc(financialPeriods.mulaiPada))
      .limit(1);
  }

  private async ambilPeriodeKeuangan(
    db: Db,
    id: string,
    organizationId: string,
  ): Promise<typeof financialPeriods.$inferSelect> {
    const [periode] = await db
      .select()
      .from(financialPeriods)
      .where(and(eq(financialPeriods.id, id), eq(financialPeriods.organizationId, organizationId)))
      .limit(1);
    if (!periode) throw galatTidakDitemukan('Periode keuangan tidak ditemukan.');
    return periode;
  }

  private async urutanTransaksi(db: Db, organizationId: string): Promise<number> {
    const [baris] = await db
      .select({ jumlah: count() })
      .from(transactions)
      .where(eq(transactions.organizationId, organizationId))
      .limit(1);
    return Number(baris?.jumlah ?? 0) + 1;
  }

  private async catatAuditTransaksi(
    organizationId: string,
    aksi: string,
    sebelum: typeof transactions.$inferSelect,
    sesudah: typeof transactions.$inferSelect,
    pengguna: PenggunaPermintaan,
    permintaan: PermintaanBerkonteks,
    komentar?: string,
  ): Promise<void> {
    await catatAudit(this.dbSvc, {
      organizationId,
      aksi,
      entitasTabel: 'transactions',
      entitasId: sesudah.id,
      pengguna,
      requestId: permintaan.requestId,
      sebelum: { status: sebelum.status },
      sesudah: { status: sesudah.status, komentar },
    });
  }

  // ============================================================
  // Pengajuan pengeluaran / pemasukan
  // ============================================================

  async daftarPengajuan(
    filter: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: unknown[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const page = Number(filter.page ?? 1);
    const limit = Number(filter.limit ?? 20);
    const syarat: ReturnType<typeof and>[] = [eq(expenseRequests.organizationId, organizationId)];
    if (filter.status) syarat.push(eq(expenseRequests.status, filter.status as never));
    if (filter.programId) syarat.push(eq(expenseRequests.programId, String(filter.programId)));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(expenseRequests)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select({
        id: expenseRequests.id,
        kode: expenseRequests.kode,
        jenis: expenseRequests.jenis,
        nominal: expenseRequests.nominal,
        keterangan: expenseRequests.keterangan,
        tanggal: expenseRequests.tanggal,
        status: expenseRequests.status,
        pemohonMemberId: expenseRequests.pemohonMemberId,
        pemohonNama: members.nama,
        programId: expenseRequests.programId,
        disetujuiPada: expenseRequests.disetujuiPada,
        dibuatPada: expenseRequests.dibuatPada,
      })
      .from(expenseRequests)
      .innerJoin(members, eq(members.id, expenseRequests.pemohonMemberId))
      .where(and(...syarat))
      .orderBy(desc(expenseRequests.dibuatPada))
      .limit(limit)
      .offset((page - 1) * limit);

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: baris.map((b) => ({
        id: b.id,
        kode: b.kode,
        jenis: b.jenis,
        nominal: b.nominal,
        keterangan: b.keterangan,
        tanggal: b.tanggal,
        status: b.status,
        pemohonId: b.pemohonMemberId,
        pemohonNama: b.pemohonNama,
        programId: b.programId,
        disetujuiPada: b.disetujuiPada ? String(b.disetujuiPada) : null,
        dibuatPada: String(b.dibuatPada),
      })),
      meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  }

  async buatPengajuan(
    masukan: PayloadBuatPengajuan,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; kode: string }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    if (masukan.idempotencyKey) {
      const [ada] = await db
        .select({ id: expenseRequests.id, kode: expenseRequests.kode })
        .from(expenseRequests)
        .where(
          and(
            eq(expenseRequests.organizationId, organizationId),
            eq(expenseRequests.idempotencyKey, masukan.idempotencyKey),
          ),
        )
        .limit(1);
      if (ada) return { id: ada.id, kode: ada.kode };
    }

    const pemohon = masukan.pemohonMemberId ?? pengguna.memberId;
    if (!pemohon) throw galatValidasi({ field: 'pemohonMemberId' }, 'Pemohon wajib diketahui.');

    const kode = `PGJ-${new Date().getFullYear()}-${kodeDenganAwalan('').trim()}`;

    const [baru] = await db
      .insert(expenseRequests)
      .values({
        organizationId,
        kode,
        jenis: masukan.jenis,
        accountId: masukan.akunId,
        programId: masukan.programId ?? null,
        eventId: masukan.eventId ?? null,
        budgetId: masukan.anggaranId ?? null,
        nominal: masukan.nominal,
        keterangan: masukan.keterangan,
        tanggal: masukan.tanggal,
        status: 'SUBMITTED',
        buktiDokumenId: masukan.buktiDokumenId ?? null,
        pemohonMemberId: pemohon,
        idempotencyKey: masukan.idempotencyKey ?? null,
      })
      .returning({ id: expenseRequests.id, kode: expenseRequests.kode });

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat pengajuan.');
    return { id: baru.id, kode: baru.kode };
  }

  /**
   * Putuskan pengajuan: APPROVED / REJECTED. Setuju harus dilakukan orang lain
   * dari pemohon (spec keuangan: pemohon ≠ pemberi persetujuan).
   */
  async putuskanPengajuan(
    id: string,
    masukan: {
      keputusan: 'APPROVED' | 'REJECTED';
      komentar?: string;
      tandaiDibayar?: boolean;
      metodePembayaran?: 'CASH' | 'QRIS' | 'BANK_TRANSFER' | 'EWALLET';
      buktiTransfer?: string | null;
    },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; status: string }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [sebelum] = await db
      .select()
      .from(expenseRequests)
      .where(and(eq(expenseRequests.id, id), eq(expenseRequests.organizationId, organizationId)))
      .limit(1);
    if (!sebelum) throw galatTidakDitemukan('Pengajuan tidak ditemukan.');

    if (sebelum.status !== 'SUBMITTED' && sebelum.status !== 'REVIEWED') {
      throw galatTransisi(`Pengajuan berstatus ${sebelum.status} tidak bisa diputus lagi.`);
    }
    if (sebelum.pemohonMemberId === pengguna.memberId) {
      throw galatIzinDitolak('Pemohon tidak boleh memutuskan pengajuannya sendiri.');
    }

    const hariIni = this.hariIni();

    if (masukan.keputusan === 'REJECTED') {
      await db
        .update(expenseRequests)
        .set({ status: 'REJECTED', alasanPenolakan: masukan.komentar ?? null, disetujuiPada: hariIni })
        .where(eq(expenseRequests.id, id));

      await catatAudit(this.dbSvc, {
        organizationId,
        aksi: 'EXPENSE_APPROVED',
        entitasTabel: 'expense_requests',
        entitasId: id,
        pengguna,
        requestId: permintaan.requestId,
        sesudah: { status: 'REJECTED', komentar: masukan.komentar },
      });

      return { id, status: 'REJECTED' };
    }

    await db
      .update(expenseRequests)
      .set({
        status: masukan.tandaiDibayar ? 'PAID' : 'APPROVED',
        disetujuiOleh: pengguna.memberId,
        disetujuiPada: hariIni,
        dibayarOleh: masukan.tandaiDibayar ? pengguna.memberId : null,
        dibayarPada: masukan.tandaiDibayar ? hariIni : null,
        metodePembayaran: masukan.metodePembayaran ?? null,
        buktiTransfer: masukan.buktiTransfer ?? null,
      })
      .where(eq(expenseRequests.id, id));

    await catatAudit(this.dbSvc, {
      organizationId,
      aksi: 'EXPENSE_APPROVED',
      entitasTabel: 'expense_requests',
      entitasId: id,
      pengguna,
      requestId: permintaan.requestId,
      sesudah: { status: masukan.tandaiDibayar ? 'PAID' : 'APPROVED', komentar: masukan.komentar },
    });

    return { id, status: masukan.tandaiDibayar ? 'PAID' : 'APPROVED' };
  }

  // ============================================================
  // Reimbursement
  // ============================================================

  async daftarReimbursement(
    filter: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: unknown[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const page = Number(filter.page ?? 1);
    const limit = Number(filter.limit ?? 20);
    const syarat: ReturnType<typeof and>[] = [eq(reimbursements.organizationId, organizationId)];
    if (filter.status) syarat.push(eq(reimbursements.status, filter.status as never));

    const [totalBaris] = await db
      .select({ jumlah: count() })
      .from(reimbursements)
      .where(and(...syarat))
      .limit(1);

    const baris = await db
      .select({
        id: reimbursements.id,
        kode: reimbursements.kode,
        memberId: reimbursements.memberId,
        memberNama: members.nama,
        nominal: reimbursements.nominal,
        keterangan: reimbursements.keterangan,
        tanggal: reimbursements.tanggal,
        status: reimbursements.status,
        programId: reimbursements.programId,
        buktiDokumenId: reimbursements.buktiDokumenId,
        direviewOleh: reimbursements.direviewOleh,
        disetujuiOleh: reimbursements.disetujuiOleh,
        dibayarOleh: reimbursements.dibayarOleh,
        dibayarPada: reimbursements.dibayarPada,
        metodePembayaran: reimbursements.metodePembayaran,
        referensiPembayaran: reimbursements.referensiPembayaran,
        dibuatPada: reimbursements.dibuatPada,
      })
      .from(reimbursements)
      .innerJoin(members, eq(members.id, reimbursements.memberId))
      .where(and(...syarat))
      .orderBy(desc(reimbursements.dibuatPada))
      .limit(limit)
      .offset((page - 1) * limit);

    const total = Number(totalBaris?.jumlah ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: baris.map((b) => ({
        ...b,
        tanggal: b.tanggal,
        dibuatPada: String(b.dibuatPada),
        dibayarPada: b.dibayarPada ? String(b.dibayarPada) : null,
      })),
      meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };
  }

  async buatReimbursement(
    masukan: PayloadBuatReimbursement,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; kode: string }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    if (masukan.idempotencyKey) {
      const [ada] = await db
        .select({ id: reimbursements.id, kode: reimbursements.kode })
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.organizationId, organizationId),
            eq(reimbursements.idempotencyKey, masukan.idempotencyKey),
          ),
        )
        .limit(1);
      if (ada) return { id: ada.id, kode: ada.kode };
    }

    const memberId = pengguna.memberId;
    if (!memberId) throw galatValidasi(undefined, 'Akun ini belum terhubung ke data anggota.');

    const kode = `RMB-${new Date().getFullYear()}-${kodeDenganAwalan('').trim()}`;

    const [baru] = await db
      .insert(reimbursements)
      .values({
        organizationId,
        kode,
        memberId,
        accountId: masukan.akunId,
        programId: masukan.programId ?? null,
        nominal: masukan.nominal,
        keterangan: masukan.keterangan,
        tanggal: masukan.tanggal,
        status: 'SUBMITTED',
        buktiDokumenId: masukan.buktiDokumenId ?? null,
        idempotencyKey: masukan.idempotencyKey ?? null,
      })
      .returning({ id: reimbursements.id, kode: reimbursements.kode });

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat reimbursement.');
    return { id: baru.id, kode: baru.kode };
  }

  async putuskanReimbursement(
    id: string,
    masukan: {
      keputusan: 'APPROVED' | 'REJECTED';
      komentar?: string;
      tandaiDibayar?: boolean;
      metodePembayaran?: 'CASH' | 'QRIS' | 'BANK_TRANSFER' | 'EWALLET';
      referensiPembayaran?: string | null;
    },
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ id: string; status: string }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const [sebelum] = await db
      .select()
      .from(reimbursements)
      .where(and(eq(reimbursements.id, id), eq(reimbursements.organizationId, organizationId)))
      .limit(1);
    if (!sebelum) throw galatTidakDitemukan('Reimbursement tidak ditemukan.');

    if (sebelum.status !== 'SUBMITTED' && sebelum.status !== 'REVIEWED') {
      throw galatTransisi(`Reimbursement berstatus ${sebelum.status} tidak bisa diputus lagi.`);
    }
    if (sebelum.memberId === pengguna.memberId) {
      throw galatIzinDitolak('Pemohon reimbursement tidak boleh memutuskan pengajuannya sendiri.');
    }

    const hariIni = this.hariIni();

    if (masukan.keputusan === 'REJECTED') {
      await db
        .update(reimbursements)
        .set({ status: 'REJECTED', alasanPenolakan: masukan.komentar ?? null })
        .where(eq(reimbursements.id, id));
      return { id, status: 'REJECTED' };
    }

    const statusAkhir = masukan.tandaiDibayar ? 'PAID' : 'APPROVED';
    await db
      .update(reimbursements)
      .set({
        status: statusAkhir,
        direviewOleh: pengguna.memberId,
        direviewPada: hariIni,
        disetujuiOleh: pengguna.memberId,
        disetujuiPada: hariIni,
        dibayarOleh: masukan.tandaiDibayar ? pengguna.memberId : null,
        dibayarPada: masukan.tandaiDibayar ? hariIni : null,
        metodePembayaran: masukan.metodePembayaran ?? null,
        referensiPembayaran: masukan.referensiPembayaran ?? null,
      })
      .where(eq(reimbursements.id, id));

    await catatAudit(this.dbSvc, {
      organizationId,
      aksi: 'PAYMENT_SETTLED',
      entitasTabel: 'reimbursements',
      entitasId: id,
      pengguna,
      requestId: permintaan.requestId,
      sesudah: { status: statusAkhir, komentar: masukan.komentar },
    });

    return { id, status: statusAkhir };
  }

  private hariIni(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
