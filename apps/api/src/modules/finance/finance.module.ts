/**
 * FinanceModule — keuangan: akun, periode, anggaran, transaksi, ledger, kas,
 * pengajuan, reimbursement, pembayaran QRIS, dan webhook.
 */
import { Module } from '@nestjs/common';

import { FinanceController, WebhookPembayaranController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { PaymentIntentService } from './payment.service.js';

@Module({
  controllers: [FinanceController, WebhookPembayaranController],
  providers: [FinanceService, PaymentIntentService],
  exports: [FinanceService, PaymentIntentService],
})
export class FinanceModule {}
