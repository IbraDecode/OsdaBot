/**
 * Dekorator masukan berbasis Zod.
 *
 * `@Tubuh(skema)`, `@Kueri(skema)`, dan `@Parameter(skema)` membungkus
 * `ValidationPipe` (lihat `common/pipes/validation.pipe.ts`) sehingga tubuh,
 * query string, dan parameter path divalidasi sebelum masuk ke controller.
 *
 * Tidak ada `class-validator`/`class-transformer`: seluruh skema berasal dari
 * `@osda/contracts`.
 */
import { Body, Param, Query } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

import { ValidationPipe } from '../pipes/validation.pipe.js';

/** Badan permintaan (JSON) yang divalidasi dengan skema Zod. */
export function Tubuh<T extends ZodTypeAny>(skema: T) {
  return Body(new ValidationPipe(skema));
}

/** Query string yang divalidasi dengan skema Zod (filter & paginasi). */
export function Kueri<T extends ZodTypeAny>(skema: T) {
  return Query(new ValidationPipe(skema));
}

/** Parameter path yang divalidasi dengan skema Zod. */
export function Parameter<T extends ZodTypeAny>(skema: T, nama?: string) {
  return Param(nama as string, new ValidationPipe(skema));
}
