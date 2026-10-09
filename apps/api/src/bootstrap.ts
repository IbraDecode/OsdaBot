/**
 * Bootstrap — menyiapkan aplikasi NestJS di atas Fastify.
 *
 * Urutan pendaftaran:
 *  1. FastifyAdapter + plugin keamanan (helmet, cookie, rate limit, multipart)
 *  2. CORS dari `CORS_ORIGINS`
 *  3. ValidationPipe (Zod, whitelist + forbidNonWhitelisted)
 *  4. Guard global: autentikasi → izin → organisasi
 *  5. Interceptor global: konteks permintaan + audit
 *  6. Filter galat global dengan bentuk `BentukError`
 *  7. Dokumentasi OpenAPI di `/api/docs`
 */
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { VERSI_KONTRAK } from '@osda/contracts';

import { AppModule } from './app.module.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import {
  CurrentUserInterceptor,
  HEADER_REQUEST_ID,
} from './common/interceptors/current-user.interceptor.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { IzinGuard } from './auth/guards/izin.guard.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { OrganizationGuard } from './auth/guards/organization.guard.js';
import { ValidationPipe as ValidasiPipeZod } from './common/pipes/validation.pipe.js';
import { KONFIGURASI, type Konfigurasi } from './config/konfigurasi.js';
import { LayananDatabase } from './database/database.service.js';
import { RoleCodeGuard } from './auth/guards/role-code.guard.js';

/** Alamat dokumentasi OpenAPI. */
export const RUTE_DOKUMEN = 'api/docs';

/** Hasil penyiapan aplikasi (dipakai `main.ts` dan pengujian). */
export interface HasilBootstrap {
  readonly app: NestFastifyApplication;
  readonly adapter: FastifyAdapter;
  readonly konfigurasi: Konfigurasi;
  readonly layananDb: LayananDatabase;
}

/**
 * Tipe pendaftaran plugin Fastify yang sengaja dilonggarkan.
 * Type augmentation beberapa paket `@fastify/*` bertentangan dengan generic
 * bawaan Fastify v5, sehingga penyetelan tipe cukup dilakukan di satu tempat ini.
 */
type PluginLoose = (instance: unknown, opsi: unknown) => unknown;

/** Daftarkan plugin Fastify lewat adapter Nest dengan opsi bebas. */
async function daftarPlugin(
  app: NestFastifyApplication,
  plugin: unknown,
  opsi?: Record<string, unknown>,
): Promise<void> {
  await app.register(plugin as PluginLoose, opsi as never);
}

/** Buat & konfigurasi aplikasi lengkap dengan Fastify. */
export async function siapkanAplikasi(): Promise<HasilBootstrap> {
  const adapter = new FastifyAdapter({
    // Batas badan permintaan; berkas besar lewat `multipart`.
    bodyLimit: 2 * 1_024 * 1_024,
    trustProxy: true,
    genReqId: (req: IncomingMessage) => {
      const nilai = req.headers[HEADER_REQUEST_ID];
      const teks = Array.isArray(nilai) ? nilai[0] : nilai;
      return typeof teks === 'string' && teks.length <= 64
        ? teks
        : crypto.randomUUID().slice(0, 16);
    },
    routerOptions: { ignoreTrailingSlash: true },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: true,
  });

  const konfigurasi = app.get<Konfigurasi>(KONFIGURASI);
  const layananDb = app.get(LayananDatabase);
  const reflector = app.get(Reflector);

  // 1. Plugin keamanan Fastify
  await daftarPlugin(app, fastifyHelmet, {
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
  });
  await daftarPlugin(app, fastifyCookie, {});
  await daftarPlugin(app, fastifyRateLimit, {
    max: konfigurasi.RATE_LIMIT_MAKS,
    timeWindow: konfigurasi.RATE_LIMIT_JENDELA,
  });
  await daftarPlugin(app, fastifyMultipart, {
    limits: { fileSize: konfigurasi.UPLOAD_MAKS_BYTE },
  });

  // 2. CORS sesuai daftar origin yang diizinkan
  app.enableCors({
    origin: [...konfigurasi.CORS_ORIGINS],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // 3. Validasi masukan berbasis Zod dari @osda/contracts.
  //    TIDAK memakai ValidationPipe bawaan Nest karena itu menuntut
  //    `class-validator` yang justru membuat duplikasi skema (spec §68).
  app.useGlobalPipes(
    new ValidasiPipeZod({ whitelist: true, forbidNonWhitelisted: true }),
  );

  // 4. Guard global (urutan = urutan eksekusi)
  app.useGlobalGuards(
    new JwtAuthGuard(reflector),
    new IzinGuard(reflector),
    new OrganizationGuard(reflector),
    new RoleCodeGuard(reflector),
  );

  // 5. Interceptor global
  app.useGlobalInterceptors(
    new CurrentUserInterceptor(),
    new AuditInterceptor(reflector, layananDb),
  );

  // 6. Filter galat — satu bentuk: { error: { code, message, requestId } }
  app.useGlobalFilters(new HttpExceptionFilter());

  // 7. Dokumentasi OpenAPI
  const dokumen = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('OSDA Platform API')
      .setDescription(
        'Backend OSDA — OSIS Digital Administration & Operations Platform. ' +
          'Seluruh izin mengikuti kontrak `@osda/contracts`; galat selalu ' +
          'berbentuk `{ error: { code, message, requestId } }`.',
      )
      .setVersion(VERSI_KONTRAK)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearerAuth')
      .addServer(konfigurasi.PUBLIC_API_URL)
      .build(),
  );
  SwaggerModule.setup(RUTE_DOKUMEN, app, dokumen, {
    swaggerOptions: { persistAuthorization: true },
    jsonDocumentUrl: `${RUTE_DOKUMEN}-json`,
  });

  // Rute health langsung (tanpa prefix versi) untuk probe infrastruktur.
  const instance = app.getHttpAdapter().getInstance();
  instance.get('/health/live', async () => ({
    status: 'hidup',
    waktu: new Date().toISOString(),
  }));
  instance.get('/health/ready', async (_permintaan: unknown, balasan: { status: (kode: number) => { send: (isi: unknown) => void } }) => {
    const hasil = await layananDb.kesehatan();
    balasan
      .status(hasil.ok ? 200 : 503)
      .send({ status: hasil.ok ? 'siap' : 'belum-siap', database: hasil });
  });

  await app.init();

  return { app, adapter, konfigurasi, layananDb };
}
