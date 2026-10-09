/**
 * AppModule — akar aplikasi.
 *
 * Urutan penting:
 *  1. `ConfigModule` memuat `.env` dari akar monorepo (isGlobal: true).
 *  2. `KonfigurasiModul` (global) memvalidasi environment dengan Zod.
 *  3. `DatabaseModul` (global) menyediakan koneksi Drizzle + advisory lock.
 *  4. Modul fitur memakai keduanya.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './modules/auth/auth.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { CommunicationsModule } from './modules/communications/communications.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MeetingsModule } from './modules/meetings/meetings.module.js';
import { MembersModule } from './modules/members/members.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ProgramsModule } from './modules/programs/programs.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { SistemModule } from './modules/sistem/sistem.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { UsersModule } from './modules/users/users.module.js';

import { KonfigurasiModul, cariEnvPath } from './config/konfigurasi.module.js';
import { DatabaseModul } from './database/database.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: cariEnvPath(),
      ignoreEnvFile: false,
    }),
    KonfigurasiModul,
    DatabaseModul,
    SistemModule,

    HealthModule,
    AuthModule,
    MembersModule,
    AttendanceModule,
    MeetingsModule,
    TasksModule,
    ProgramsModule,
    EventsModule,
    FinanceModule,
    CommunicationsModule,
    NotificationsModule,
    ReportsModule,
    AuditModule,
    SettingsModule,
    UsersModule,
  ],
})
export class AppModule {}
