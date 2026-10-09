/**
 * AttendanceModule — sesi absensi, catatan kehadiran, token QR.
 */
import { Module } from '@nestjs/common';

import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
