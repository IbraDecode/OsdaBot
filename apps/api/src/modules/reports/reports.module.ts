/**
 * ReportsModule — mesin laporan.
 */
import { Module } from '@nestjs/common';

import { CurrentUserInterceptor } from '../../common/interceptors/current-user.interceptor.js';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, CurrentUserInterceptor, AuditInterceptor],
  exports: [ReportsService],
})
export class ReportsModule {}
