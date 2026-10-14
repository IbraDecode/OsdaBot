/**
 * Validasi & akses konfigurasi lingkungan.
 *
 * Prinsip:
 * - Gagal KERAS saat boot kalau konfigurasi tidak valid, bukan diam-diam
 *   berjalan dengan default yang salah (bagian dari "fail fast").
 * - Tidak ada nilai rahasia yang boleh masuk ke log.
 */
import { z } from 'zod'

/** Env kosong dianggap "tidak diisi" — bukan string kosong yang sah. */
const emptyToUndefined = (value: unknown) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const optionalString = z.preprocess(emptyToUndefined, z.string().optional())

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    // --- Database ---
    DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
    DATABASE_DIRECT_URL: optionalString,

    // --- Redis ---
    REDIS_URL: z.string().min(1, 'REDIS_URL wajib diisi'),

    // --- AI Provider ---
    AI_BASE_URL: z.string().url('AI_BASE_URL harus URL valid'),
    AI_API_KEY: z.string().min(8, 'AI_API_KEY terlalu pendek'),
    AI_MODEL: z.string().min(1, 'AI_MODEL wajib diisi'),
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2048),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

    // --- WhatsApp ---
    WHATSAPP_SESSION_DIR: z.string().default('./auth_info_baileys'),
    WHATSAPP_OWNER_PHONE: optionalString,
    WHATSAPP_BOT_NAME: z.string().default('Osda'),
    WHATSAPP_MARK_ONLINE_ON_CONNECT: z.preprocess(emptyToUndefined, booleanish.default('false')),

    // --- Aplikasi ---
    APP_TIMEZONE: z.string().default('Asia/Makassar'),
    APP_LOCALE: z.string().default('id'),

    // --- Batas agent ---
    AGENT_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(12),
    AGENT_MAX_STEPS: z.coerce.number().int().positive().default(8),
    AGENT_MAX_CONTEXT_MESSAGES: z.coerce.number().int().positive().default(20),

    // --- Pembayaran (opsional) ---
    BATURPAY_API_KEY: optionalString,
    BATURPAY_BASE_URL: z.string().url().default('https://baturpay.vercel.app'),
    BATURPAY_WEBHOOK_SECRET: optionalString,

    // --- Penyimpanan ---
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    AWS_ENDPOINT_URL_S3: optionalString,
    AWS_REGION: optionalString,
    AWS_ACCESS_KEY_ID: optionalString,
    AWS_SECRET_ACCESS_KEY: optionalString,
    AWS_BUCKET: optionalString,

    // --- HTTP server ---
    SERVER_HOST: z.string().default('127.0.0.1'),
    SERVER_PORT: z.coerce.number().int().positive().default(8080),
    SERVER_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),

    // --- Rate limit ---
    RATE_LIMIT_MESSAGES_PER_MINUTE: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_TOOL_CALLS_PER_MINUTE: z.coerce.number().int().positive().default(60),
  })
  .superRefine((value, ctx) => {
    // BaturPay hanya boleh aktif kalau key + secret webhook tersedia.
    const baturpayDipakai = Boolean(value.BATURPAY_API_KEY || value.BATURPAY_WEBHOOK_SECRET)
    if (baturpayDipakai && !value.BATURPAY_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BATURPAY_API_KEY'],
        message: 'BATURPAY_WEBHOOK_SECRET diisi tapi BATURPAY_API_KEY kosong',
      })
    }

    // Penyimpanan S3 wajib lengkap semua variabelnya.
    if (value.STORAGE_DRIVER === 's3') {
      const wajib = [
        ['AWS_ENDPOINT_URL_S3', value.AWS_ENDPOINT_URL_S3],
        ['AWS_REGION', value.AWS_REGION],
        ['AWS_ACCESS_KEY_ID', value.AWS_ACCESS_KEY_ID],
        ['AWS_SECRET_ACCESS_KEY', value.AWS_SECRET_ACCESS_KEY],
        ['AWS_BUCKET', value.AWS_BUCKET],
      ] as const
      for (const [name, val] of wajib) {
        if (!val) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: `${name} wajib diisi saat STORAGE_DRIVER=s3`,
          })
        }
      }
    }

    if (value.NODE_ENV === 'production' && value.WHATSAPP_OWNER_PHONE) {
      const nomor = value.WHATSAPP_OWNER_PHONE.replace(/[^0-9]/g, '')
      if (nomor.length < 8 || nomor.length > 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_OWNER_PHONE'],
          message: 'Format nomor WhatsApp tidak valid (harus 8-15 digit, mis. 6281234567890)',
        })
      }
    }
  })

export type AppEnv = z.infer<typeof envSchema>

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    // Tulis manual supaya pesan zod yang rapi tidak tenggelam di stack trace.
    const rincian = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(`Konfigurasi lingkungan tidak valid:\n${rincian}\n\nPeriksa .env Anda.`)
  }

  return parsed.data
}

/** Konfigurasi proses tunggal, dibaca sekali saat boot. */
export const env: AppEnv = loadEnv()

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'