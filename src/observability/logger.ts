/**
 * Logger terstruktur (Pino).
 *
 * Aturan:
 * - Semua log Eventsync yang punya `event` agar bisa dicari/di-filter.
 * - Rahasia dan isi pesan pribadi tidak boleh masuk log.
 * - Redaction dilakukan di level logger, bukan di tiap pemanggil — supaya tidak
 *   bisa bocor hanya karena ada satu pemanggil yang lupa.
 */
import { pino, type Logger } from 'pino'
import { env, isProduction } from '../config/env.js'

/** Kunci yang nilainya wajib disamarkan di mana pun. */
const REDACT_PATHS = [
  'apiKey',
  'API_KEY',
  'aiApiKey',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'password',
  'secret',
  'webhookSecret',
  'baturpayWebhookSecret',
  'sessionKey',
  'authInfo',
  'creds',
  '*.apiKey',
  '*.token',
  '*.password',
  '*.secret',
  '*.credentials',
  '*.sessionKey',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
]

const baseLogger: Logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'osdabot', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,service',
          },
        },
      }),
})

export const logger = baseLogger

/** Logger anak dengan correlationId supaya satu alur pekerjaan bisa ditelusuri. */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return baseLogger.child(bindings)
}

export type { Logger }