/**
 * Tipe dependensi untuk AuthorizationService.
 *
 * Dipisah supaya modul keamanan bisa diuji dengan test double tanpa
 * harus menyentuh database sungguhan.
 */
import type { PrismaClient } from '@prisma/client'
import type { Logger } from '../observability/logger.js'

export interface AuthorizationServiceDeps {
  prisma: PrismaClient
  logger: Logger
  cacheTtlMs?: number
}