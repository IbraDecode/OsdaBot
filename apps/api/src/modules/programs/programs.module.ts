/**
 * ProgramsModule — program kerja, tim, milestone, evaluasi.
 */
import { Module } from '@nestjs/common';

import { ProgramsController } from './programs.controller.js';
import { ProgramsService } from './programs.service.js';

@Module({
  controllers: [ProgramsController],
  providers: [ProgramsService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
