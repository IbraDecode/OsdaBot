/**
 * Modul database bersama (infrastruktur).
 */
import { Global, Module } from '@nestjs/common';

import { LayananDatabase } from './database.service.js';
import { LayananPengunci } from './pengunci.service.js';

@Global()
@Module({
  providers: [LayananDatabase, LayananPengunci],
  exports: [LayananDatabase, LayananPengunci],
})
export class DatabaseModul {}
