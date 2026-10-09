/**
 * NotificationsModule — pusat notifikasi dalam aplikasi.
 *
 * Modul ini hanya membaca/menulis notifikasi in-app (`notifications` di schema
 * system). Pengiriman ke kanal lain (WhatsApp, email, push) dikerjakan oleh
 * paket `@osda/notifications` di worker terpisah agar gagal kirim tidak pernah
 * menggagalkan permintaan utama.
 */
import { Module } from '@nestjs/common';

import { CurrentUserInterceptor } from '../../common/interceptors/current-user.interceptor.js';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, CurrentUserInterceptor, AuditInterceptor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
