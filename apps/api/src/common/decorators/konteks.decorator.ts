/**
 * Dekorator `@Konteks()` — menyuntikkan permintaan Fastify yang sudah diperkaya
 * (`requestId`, `organizationId`, `pengguna`) ke dalam parameter controller.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { PermintaanBerkonteks } from '../tipe.js';

export const Konteks = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PermintaanBerkonteks => {
    return ctx.switchToHttp().getRequest<PermintaanBerkonteks>();
  },
);
