/**
 * SistemModule — pekerjaan latar (scheduler) tanpa Redis/BullMQ.
 */
import { Module } from '@nestjs/common';

import { SchedulerService } from './scheduler.service.js';

@Module({
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SistemModule {}
