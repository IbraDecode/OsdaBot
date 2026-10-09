/**
 * AuditModule — hanya baca. Log audit bersifat append-only.
 */
import { Module } from '@nestjs/common';

import { CurrentUserInterceptor } from '../../common/interceptors/current-user.interceptor.js';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, CurrentUserInterceptor, AuditInterceptor],
  exports: [AuditService],
})
export class AuditModule {}
