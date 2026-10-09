/**
 * TasksModule — tugas, penugasan, verifikasi, riwayat aktivitas.
 */
import { Module } from '@nestjs/common';

import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
