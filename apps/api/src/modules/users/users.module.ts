/**
 * UsersModule — profil & dasbor per peran.
 *
 * Dasbor dibaca dari database, bukan dari data yang di-hardcode. Bentuk
 * dasbor mengikuti izin efektif pengguna (lihat `UsersService.dasbor`).
 *
 * `LayananIzin` disediakan oleh `AuthModule`, sehingga modul ini mengimpornya.
 */
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CurrentUserInterceptor } from '../../common/interceptors/current-user.interceptor.js';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, CurrentUserInterceptor, AuditInterceptor],
  exports: [UsersService],
})
export class UsersModule {}
