/**
 * FinanceController — keuangan organisasi.
 *
 * WAJIB: setiap endpoint punya izin keuangan yang sesuai
 * (`finance.read`, `finance.write`, `finance.approve`, `finance.export`).
 * Webhook pembayaran publik (dipanggil provider) tetapi tetap idempoten.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req, Inject} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  SkemaBuatAkun,
  SkemaBuatAnggaran,
  SkemaBuatPaymentIntent,
  SkemaBuatPengajuan,
  SkemaBuatPeriodeKeuangan,
  SkemaBuatReimbursement,
  SkemaFilterAnggaran,
  SkemaFilterLedger,
  SkemaFilterTransaksi,
  SkemaPutuskanPengajuan,
  SkemaWebhookPembayaran,
  type PayloadBuatAkun,
  type PayloadBuatAnggaran,
  type PayloadBuatPaymentIntent,
  type PayloadBuatPengajuan,
  type PayloadBuatPeriodeKeuangan,
  type PayloadBuatReimbursement,
  type PayloadWebhookPembayaran,
} from '@osda/contracts';
import { z } from 'zod';

import { Publik } from '../../common/decorators/publik.decorator.js';
import { Konteks } from '../../common/decorators/konteks.decorator.js';
import { Izin } from '../../common/decorators/izin.decorator.js';
import { Kueri, Parameter, Tubuh } from '../../common/decorators/masukan.decorator.js';
import { PenggunaSekarang } from '../../common/decorators/pengguna.decorator.js';
import type { PermintaanBerkonteks, PenggunaPermintaan } from '../../common/tipe.js';
import { FinanceService } from './finance.service.js';
import { PaymentIntentService } from './payment.service.js';
import {
  SkemaBuatTransaksi,
  SkemaFilterLaporan,
  SkemaKas,
  SkemaPutuskanReimbursement,
  SkemaPutuskanTransaksi,
  SkemaSetujuiTransaksi,
} from './dto/finance.dto.js';

const SkemaIdUmum = z.object({ id: z.string().uuid() });

@ApiTags('finance')
@ApiBearerAuth()
@Controller('api/v1/finance')
export class FinanceController {
  constructor(
    @Inject(FinanceService) private readonly service: FinanceService,
    @Inject(PaymentIntentService) private readonly pembayaran: PaymentIntentService,
  ) {}

  // ============================================================
  // Chart of accounts
  // ============================================================

  @Get('accounts')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Daftar chart of accounts' })
  daftarAkun(@Konteks() permintaan: PermintaanBerkonteks, @PenggunaSekarang() pengguna: PenggunaPermintaan) {
    return this.service.daftarAkun(permintaan, pengguna);
  }

  @Post('accounts')
  @Izin('finance.write')
  @ApiOperation({ summary: 'Buat akun baru' })
  buatAkun(
    @Tubuh(SkemaBuatAkun) masukan: PayloadBuatAkun,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatAkun(masukan, permintaan, pengguna);
  }

  // ============================================================
  // Periode keuangan
  // ============================================================

  @Get('periods')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Daftar periode keuangan' })
  daftarPeriode(@Konteks() permintaan: PermintaanBerkonteks, @PenggunaSekarang() pengguna: PenggunaPermintaan) {
    return this.service.daftarPeriodeKeuangan(permintaan, pengguna);
  }

  @Post('periods')
  @Izin('finance.write')
  @ApiOperation({ summary: 'Buat periode keuangan' })
  buatPeriode(
    @Tubuh(SkemaBuatPeriodeKeuangan) masukan: PayloadBuatPeriodeKeuangan,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatPeriodeKeuangan(masukan, permintaan, pengguna);
  }

  // ============================================================
  // Anggaran
  // ============================================================

  @Get('budgets')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Daftar anggaran' })
  daftarAnggaran(
    @Kueri(SkemaFilterAnggaran) filter: z.infer<typeof SkemaFilterAnggaran>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarAnggaran(filter, permintaan, pengguna);
  }

  @Post('budgets')
  @Izin('finance.write')
  @ApiOperation({ summary: 'Buat anggaran + butir' })
  buatAnggaran(
    @Tubuh(SkemaBuatAnggaran) masukan: PayloadBuatAnggaran,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatAnggaran(masukan, permintaan, pengguna);
  }

  // ============================================================
  // Transaksi, ledger, kas
  // ============================================================

  @Get('transactions')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Daftar transaksi kas' })
  daftarTransaksi(
    @Kueri(SkemaFilterTransaksi) filter: z.infer<typeof SkemaFilterTransaksi>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarTransaksi(filter, permintaan, pengguna);
  }

  @Post('transactions')
  @Izin('finance.write')
  @ApiOperation({ summary: 'Catat transaksi kas baru (status DRAFT)' })
  buatTransaksi(
    @Tubuh(SkemaBuatTransaksi) masukan: Parameters<FinanceService['buatTransaksi']>[0],
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatTransaksi(masukan, permintaan, pengguna);
  }

  @Post('transactions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Izin('finance.approve')
  @ApiOperation({ summary: 'Setujui & posting transaksi ke ledger' })
  @ApiResponse({ status: 403, description: 'Pencatat tidak boleh menyetujui transaksinya sendiri' })
  @ApiResponse({ status: 409, description: 'Status transaksi tidak memungkinkan' })
  putuskanTransaksi(
    @Parameter(SkemaIdUmum) { id }: { id: string },
    @Tubuh(SkemaPutuskanTransaksi) masukan: { keputusan: 'APPROVED' | 'REJECTED'; komentar?: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.putuskanTransaksi(id, masukan.keputusan, masukan.komentar, permintaan, pengguna);
  }

  @Get('ledger')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Buku besar (ledger) — immutable' })
  daftarLedger(
    @Kueri(SkemaFilterLedger) filter: Record<string, unknown>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarLedger(filter, permintaan, pengguna);
  }

  @Get('kas')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Buku kas — saldo dihitung dari ledger' })
  kas(
    @Kueri(SkemaKas) filter: { periodeKeuanganId?: string; dari?: string; sampai?: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.kas(filter, permintaan, pengguna);
  }

  // ============================================================
  // Pengajuan & reimbursement
  // ============================================================

  @Get('requests')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Daftar pengajuan pengeluaran/pemasukan' })
  daftarPengajuan(
    @Kueri(z.object({ status: z.string().optional(), programId: z.string().uuid().optional() })) filter: Record<string, unknown>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarPengajuan(filter, permintaan, pengguna);
  }

  @Post('requests')
  @Izin('finance.write')
  @ApiOperation({ summary: 'Buat pengajuan pengeluaran/pemasukan' })
  buatPengajuan(
    @Tubuh(SkemaBuatPengajuan) masukan: PayloadBuatPengajuan,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatPengajuan(masukan, permintaan, pengguna);
  }

  @Post('requests/:id/decide')
  @HttpCode(HttpStatus.OK)
  @Izin('finance.approve')
  @ApiOperation({ summary: 'Putuskan pengajuan (pemohon ≠ pemberi persetujuan)' })
  @ApiResponse({ status: 403, description: 'Pemohon tidak boleh menyetujui pengajuannya' })
  putuskanPengajuan(
    @Parameter(SkemaIdUmum) { id }: { id: string },
    @Tubuh(SkemaPutuskanPengajuan) masukan: {
      keputusan: 'APPROVED' | 'REJECTED';
      komentar?: string;
      tandaiDibayar: boolean;
      metodePembayaran?: 'CASH' | 'QRIS' | 'BANK_TRANSFER' | 'EWALLET';
      buktiTransfer?: string | null;
    },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.putuskanPengajuan(id, masukan, permintaan, pengguna);
  }

  @Get('reimbursements')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Daftar reimbursement' })
  daftarReimbursement(
    @Kueri(z.object({ status: z.string().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }))
    filter: Record<string, unknown>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarReimbursement(filter, permintaan, pengguna);
  }

  @Post('reimbursements')
  @Izin('finance.write')
  @ApiOperation({ summary: 'Ajukan reimbursement' })
  buatReimbursement(
    @Tubuh(SkemaBuatReimbursement) masukan: PayloadBuatReimbursement,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.buatReimbursement(masukan, permintaan, pengguna);
  }

  @Post('reimbursements/:id/decide')
  @HttpCode(HttpStatus.OK)
  @Izin('finance.approve')
  @ApiOperation({ summary: 'Putuskan reimbursement' })
  putuskanReimbursement(
    @Parameter(SkemaIdUmum) { id }: { id: string },
    @Tubuh(SkemaPutuskanReimbursement) masukan: {
      keputusan: 'APPROVED' | 'REJECTED';
      komentar?: string;
      tandaiDibayar: boolean;
      metodePembayaran?: 'CASH' | 'QRIS' | 'BANK_TRANSFER' | 'EWALLET';
      referensiPembayaran?: string | null;
    },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.putuskanReimbursement(id, masukan, permintaan, pengguna);
  }

  // ============================================================
  // Pembayaran QRIS
  // ============================================================

  @Post('payments')
  @Izin('finance.write')
  @ApiOperation({ summary: 'Buat payment intent QRIS (idempoten)' })
  buatPaymentIntent(
    @Tubuh(SkemaBuatPaymentIntent) masukan: PayloadBuatPaymentIntent,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.pembayaran.buatIntent(masukan, permintaan, pengguna);
  }

  @Get('payments')
  @Izin('finance.read')
  @ApiOperation({ summary: 'Daftar pembayaran' })
  daftarPembayaran(
    @Kueri(z.object({ status: z.string().optional(), memberId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }))
    filter: Record<string, unknown>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.pembayaran.daftarPembayaran(filter, permintaan, pengguna);
  }

  // ============================================================
  // Laporan
  // ============================================================

  @Get('reports/kas')
  @Izin('finance.export')
  @ApiOperation({ summary: 'Laporan kas (export)' })
  laporanKas(
    @Kueri(SkemaFilterLaporan) query: { dari?: string; sampai?: string },
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.kas(query, permintaan, pengguna);
  }

  @Get('reports/anggaran')
  @Izin('finance.export')
  @ApiOperation({ summary: 'Laporan realisasi anggaran (export)' })
  laporanAnggaran(
    @Kueri(SkemaFilterAnggaran) filter: z.infer<typeof SkemaFilterAnggaran>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarAnggaran(filter, permintaan, pengguna);
  }

  @Get('reports/ledger')
  @Izin('finance.export')
  @ApiOperation({ summary: 'Ekspor buku besar (ledger)' })
  eksporLedger(
    @Kueri(SkemaFilterLedger) filter: Record<string, unknown>,
    @Konteks() permintaan: PermintaanBerkonteks,
    @PenggunaSekarang() pengguna: PenggunaPermintaan,
  ) {
    return this.service.daftarLedger(filter, permintaan, pengguna);
  }
}

/**
 * Controller terpisah untuk webhook pembayaran karena bersifat publik
 * (dipanggil provider, bukan oleh klien OSDA).
 */
@ApiTags('webhooks')
@Controller('api/v1/webhooks')
export class WebhookPembayaranController {
  constructor(@Inject(PaymentIntentService) private readonly pembayaran: PaymentIntentService) {}

  @Publik()
  @Post('payment')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Webhook pembayaran provider (idempoten)' })
  terima(
    @Tubuh(SkemaWebhookPembayaran) payload: PayloadWebhookPembayaran,
    @Req() permintaan: PermintaanBerkonteks,
  ) {
    return this.pembayaran.prosesWebhook(payload, typeof permintaan.ip === 'string' ? permintaan.ip : null);
  }
}
