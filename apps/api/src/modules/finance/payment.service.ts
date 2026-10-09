/**
 * PaymentIntentService — pembayaran QRIS & webhook provider.
 *
 * WAJIB IDEMPOTEN (spec §44):
 *  - `payments.idempotency_key` unik per organisasi → mencegah intent ganda.
 *  - `payments.referensi_provider` unik per organisasi → satu referensi aktif
 *    hanya boleh di-settle SEKALI, walaupun webhook dipanggil berulang kali.
 *  - Webhook masuk dicatat di `webhook_events` (unik provider + event_id).
 *
 * Tanpa integrasi payment gateway nyata, `qr_string` dibangkitkan lokal; ketika
 * provider tersedia, ganti `bangunQris()` dengan pemanggilan API provider.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { dalamTransaksi } from '@osda/db';
import type {
  PayloadBuatPaymentIntent,
  PayloadWebhookPembayaran,
  PaymentIntent,
} from '@osda/contracts';
import {
  accounts,
  financialPeriods,
  members,
  payments,
  transactions,
  webhookEvents,
  ledgerEntries,
  type Db,
} from '@osda/db';

import {
  galatDuplikat,
  galatTidakDitemukan,
  galatTransisi,
  galatValidasi,
} from '../../common/galat.js';
import { pastikanOrganisasiAktif } from '../../common/utilitas/konteks.js';
import { catatAudit } from '../../common/utilitas/konteks.js';
import { kodeDenganAwalan, kodePembayaran, kodeTransaksi, referensiProvider } from '../../common/utilitas/kode.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { LayananDatabase } from '../../database/database.service.js';

/** Masa berlaku QRIS pembayaran (menit). */
const QRIS_KEDALUWARSA_MENIT = 30;

@Injectable()
export class PaymentIntentService {
  private readonly pencatat = new Logger('Pembayaran');

  constructor(@Inject(LayananDatabase) private readonly dbSvc: LayananDatabase) {}

  /** Buat payment intent (QRIS). Idempoten lewat `idempotency_key` klien. */
  async buatIntent(
    masukan: PayloadBuatPaymentIntent,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<PaymentIntent> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(
      pengguna,
      permintaan.organizationId,
      masukan.organizationId,
    );

    const [ada] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, organizationId),
          eq(payments.idempotencyKey, masukan.idempotencyKey),
        ),
      )
      .limit(1);
    if (ada) return this.kePaymentIntent(db, ada);

    const [anggota] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, masukan.memberId), eq(members.organizationId, organizationId)))
      .limit(1);
    if (!anggota) throw galatTidakDitemukan('Anggota pembayar tidak ditemukan.');

    const kode = kodePembayaran();
    const referensi = referensiProvider();
    const kedaluwarsa = new Date(Date.now() + QRIS_KEDALUWARSA_MENIT * 60_000)
      .toISOString()
      .slice(0, 10);

    const [baru] = await db
      .insert(payments)
      .values({
        organizationId,
        kode,
        memberId: masukan.memberId,
        jenis: masukan.jenis,
        periode: masukan.periode ?? null,
        programId: masukan.programId ?? null,
        eventId: masukan.eventId ?? null,
        nominal: masukan.nominal,
        metode: 'QRIS',
        status: 'PENDING',
        idempotencyKey: masukan.idempotencyKey,
        referensiProvider: referensi,
        qrString: this.bangunQris(referensi, masukan.nominal),
        qrUrl: null,
        kedaluwarsaPada: kedaluwarsa,
        dicatatOleh: pengguna.memberId,
      })
      .returning();

    if (!baru) throw galatValidasi(undefined, 'Gagal membuat payment intent.');
    return this.kePaymentIntent(db, baru);
  }

  async daftarPembayaran(
    filter: Record<string, unknown>,
    permintaan: PermintaanBerkonteks,
    pengguna: PenggunaPermintaan,
  ): Promise<{ data: PaymentIntent[]; meta: unknown }> {
    const db = await this.dbSvc.ambilDb();
    const organizationId = pastikanOrganisasiAktif(pengguna, permintaan.organizationId);

    const page = Number(filter.page ?? 1);
    const limit = Number(filter.limit ?? 20);
    const syarat: ReturnType<typeof and>[] = [eq(payments.organizationId, organizationId)];
    if (filter.status) syarat.push(eq(payments.status, filter.status as never));
    if (filter.memberId) syarat.push(eq(payments.memberId, String(filter.memberId)));

    const baris = await db
      .select()
      .from(payments)
      .where(and(...syarat))
      .orderBy(sql`${payments.dibuatPada} desc`)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: await Promise.all(baris.map((b) => this.kePaymentIntent(db, b))),
      meta: { page, limit, total: baris.length, totalPages: 1, hasNext: false, hasPrev: page > 1 },
    };
  }

  /**
   * Proses webhook pembayaran — WAJIB idempoten.
   *
   * Urutan:
   *  1. Catat event masuk ke `webhook_events` (unik provider + event_id).
   *     Bila sudah pernah diproses, kembalikan hasil tanpa mengubah apa pun.
   *  2. Cari pembayaran lewat `referensi_provider` (unik).
   *  3. Bila status belum PAID, tandai PAID dan posting transaksi kas + ledger
   *     dalam SATU transaksi database.
   */
  async prosesWebhook(
    payload: PayloadWebhookPembayaran,
    ip: string | null,
  ): Promise<{ diproses: boolean; sudahDiproses?: boolean; pesan: string }> {
    const db = await this.dbSvc.ambilDb();

    // 1. Cegah pemrosesan ganda di level event provider.
    let eventIdTersimpan: string | null = null;
    try {
      const [event] = await db
        .insert(webhookEvents)
        .values({
          provider: 'QRIS',
          eventId: payload.orderId,
          tipe: payload.event,
          signatureValid: Boolean(payload.signature),
          diproses: false,
          payload: payload.raw as Record<string, unknown>,
        })
        .returning({ id: webhookEvents.id });
      eventIdTersimpan = event?.id ?? null;
    } catch {
      // Unique violation (provider, event_id) → event sudah pernah masuk.
      this.pencatat.debug(`Webhook ${payload.orderId} sudah pernah diterima — dilewati.`);
      return { diproses: false, sudahDiproses: true, pesan: 'Event sudah diproses sebelumnya.' };
    }

    // 2. Cari pembayaran dari referensi provider (unik per organisasi).
    const [pembayaran] = await db
      .select()
      .from(payments)
      .where(eq(payments.referensiProvider, payload.orderId))
      .limit(1);

    if (!pembayaran) {
      await this.tandaiEventGalat(eventIdTersimpan, 'Referensi pembayaran tidak dikenali.');
      return { diproses: false, pesan: 'Referensi pembayaran tidak dikenali.' };
    }

    if (pembayaran.status === 'PAID') {
      await this.tandaiEventSelesai(eventIdTersimpan);
      return { diproses: false, sudahDiproses: true, pesan: 'Pembayaran sudah diselesaikan.' };
    }

    if (pembayaran.nominal !== payload.amount) {
      await this.tandaiEventGalat(
        eventIdTersimpan,
        `Nominal tidak cocok: webhook ${payload.amount} vs intent ${pembayaran.nominal}`,
      );
      throw galatDuplikat('Nominal pembayaran tidak cocok dengan permintaan.');
    }

    if (payload.status !== 'PAID' && payload.status !== 'SETTLED' && payload.status !== 'SUCCESS') {
      await this.tandaiEventSelesai(eventIdTersimpan);
      return { diproses: false, pesan: `Status ${payload.status} tidak perlu disettle.` };
    }

    // 3. Settle dalam satu transaksi: pembayaran + transaksi kas + ledger.
    await dalamTransaksi(db, async (tx: Db) => {
      const hariIni = new Date().toISOString().slice(0, 10);

      await tx
        .update(payments)
        .set({
          status: 'PAID',
          dibayarPada: hariIni,
          jumlahWebhook: pembayaran.jumlahWebhook + 1,
        })
        .where(eq(payments.id, pembayaran.id));

      const akunKas = await this.akunKasTujuan(tx, pembayaran.organizationId);

      const [periode] = await tx
        .select()
        .from(financialPeriods)
        .where(
          and(
            eq(financialPeriods.organizationId, pembayaran.organizationId),
            eq(financialPeriods.status, 'OPEN'),
          ),
        )
        .limit(1);
      if (!periode) throw galatValidasi(undefined, 'Periode keuangan sedang tidak terbuka.');

      const kode = kodeTransaksi(
        new Date().getFullYear(),
        Math.floor(Math.random() * 90_000) + 10_000,
      );

      const [transaksi] = await tx
        .insert(transactions)
        .values({
          organizationId: pembayaran.organizationId,
          financialPeriodId: periode.id,
          kode,
          jenis: 'INCOME',
          arah: 'IN',
          accountId: akunKas.id,
          nominal: pembayaran.nominal,
          keterangan: `Pembayaran ${pembayaran.jenis} — ${pembayaran.kode}`,
          tanggal: hariIni,
          status: 'POSTED',
          programId: pembayaran.programId,
          eventId: pembayaran.eventId,
          paymentId: pembayaran.id,
          dipostingPada: hariIni,
        })
        .returning();

      if (transaksi) {
        await tx.insert(ledgerEntries).values({
          transaksiId: transaksi.id,
          organizationId: pembayaran.organizationId,
          financialPeriodId: periode.id,
          accountId: akunKas.id,
          tanggal: hariIni,
          debit: pembayaran.nominal,
          kredit: 0,
          narration: `Pembayaran QRIS ${pembayaran.kode} (${payload.orderId})`,
        });
      }

      await tx
        .update(payments)
        .set({ transaksiId: transaksi?.id ?? null })
        .where(eq(payments.id, pembayaran.id));
    });

    await this.tandaiEventSelesai(eventIdTersimpan);
    void ip;

    await catatAudit(this.dbSvc, {
      organizationId: pembayaran.organizationId,
      aksi: 'PAYMENT_SETTLED',
      entitasTabel: 'payments',
      entitasId: pembayaran.id,
      sesudah: { referensi: payload.orderId, nominal: pembayaran.nominal },
    });

    this.pencatat.log(`Pembayaran ${pembayaran.kode} disettle dari webhook ${payload.orderId}.`);
    return { diproses: true, pesan: 'Pembayaran berhasil diselesaikan.' };
  }

  // ============================================================
  // Helper internal
  // ============================================================

  private async kePaymentIntent(
    db: Db,
    b: typeof payments.$inferSelect,
  ): Promise<PaymentIntent> {
    const [anggota] = await db
      .select({ nama: members.nama })
      .from(members)
      .where(eq(members.id, b.memberId))
      .limit(1);

    return {
      id: b.id,
      kode: b.kode,
      memberId: b.memberId,
      memberNama: anggota?.nama ?? '',
      nominal: b.nominal,
      status: b.status,
      metode: b.metode,
      qrString: b.qrString,
      qrUrl: b.qrUrl,
      referensiProvider: b.referensiProvider,
      kedaluwarsaPada: b.kedaluwarsaPada,
      dibayarPada: b.dibayarPada ? String(b.dibayarPada) : null,
      dibuatPada: String(b.dibuatPada),
    };
  }

  private async akunKasTujuan(
    tx: Db,
    organizationId: string,
  ): Promise<{ id: string }> {
    const [akun] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.organizationId, organizationId),
          eq(accounts.adalahKas, true),
          eq(accounts.aktif, true),
        ),
      )
      .orderBy(sql`${accounts.kode} asc`)
      .limit(1);

    if (!akun) throw galatValidasi(undefined, 'Belum ada akun kas aktif untuk organisasi ini.');
    return akun;
  }

  /** Bangun payload QRIS (tanpa provider: cukup string deterministik). */
  private bangunQris(referensi: string, nominal: number): string {
    return `OSDA-QRIS|${referensi}|${nominal}`;
  }

  private async tandaiEventSelesai(eventId: string | null): Promise<void> {
    if (!eventId) return;
    const db = await this.dbSvc.ambilDb();
    await db
      .update(webhookEvents)
      .set({ diproses: true, diprosesPada: new Date() })
      .where(eq(webhookEvents.id, eventId));
  }

  private async tandaiEventGalat(eventId: string | null, pesan: string): Promise<void> {
    if (!eventId) return;
    const db = await this.dbSvc.ambilDb();
    await db
      .update(webhookEvents)
      .set({ pesanGalat: pesan, diprosesPada: new Date() })
      .where(eq(webhookEvents.id, eventId));
  }
}
