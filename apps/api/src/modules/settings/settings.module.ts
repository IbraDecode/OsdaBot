/**
 * SettingsModule — organisasi, periode, struktur, pengaturan, feature flag.
 *
 * Semua endpoint butuh izin `settings.manage` atau `period.manage`. Pergantian
 * periode selalu dicatat di audit (spec §39: "Semua aksi sensitif dicatat").
 */
import { Module } from '@nestjs/common';

import { CurrentUserInterceptor } from '../../common/interceptors/current-user.interceptor.js';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor.js';
import { AuditModule } from '../audit/audit.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService, CurrentUserInterceptor, AuditInterceptor],
  exports: [SettingsService],
})
export class SettingsModule {}
