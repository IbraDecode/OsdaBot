/**
 * CommunicationsModule — pengumuman & kampanye (Humas).
 */
import { Module } from '@nestjs/common';

import { CurrentUserInterceptor } from '../../common/interceptors/current-user.interceptor.js';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CommunicationsController } from './communications.controller.js';
import { CommunicationsService } from './communications.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, CurrentUserInterceptor, AuditInterceptor],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
