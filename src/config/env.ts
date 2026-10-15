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

    // Redis TIDAK lagi dipakai. Outbox dan pengingat memakai PostgreSQL
    // sebagai sumber kebenaran — kalau job hilang dari Redis, yang hilang juga
    // catatan pengirimannya. Variabel ini dibiarkan opsional supaya berkas
    // `.env` lama tidak langsung rusak; kalau nanti dibutuhkan, kembalikan
    // ke `z.string().min(1)`.
    REDIS_URL: optionalString,

    // --- AI Provider ---
    AI_BASE_URL: z.string().url('AI_BASE_URL harus URL valid'),
    AI_API_KEY: z.string().min(8, 'AI_API_KEY terlalu pendek'),
    AI_MODEL: z.string().min(1, 'AI_MODEL wajib diisi'),
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2048),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
    /**
     * Percobaan ulang untuk error transien (timeout, 5xx, rate limit).
     *
     * Gateway yang dipakai adalah Cloudflare Tunnel yang memang tidak
     * stabil — satu kedip tunnel seharusnya tidak langsung menjadi jawaban
     * "AI provider bermasalah" untuk pengguna.
     */
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

    // --- WhatsApp ---
    WHATSAPP_SESSION_DIR: z.string().default('./auth_info_baileys'),
    /**
     * Nomor akun yang AKAN DITAUTKAN ke Baileys — yaitu nomor BOT.
     * Ini yang dikirim ke `sock.requestPairingCode()`. Kalau diisi nomor yang
     * salah, akun itu yang tertaut sebagai bot.
     */
    WHATSAPP_LINK_PHONE: optionalString,
    /**
     * Nomor pemilik/admin yang mengendalikan. TIDAK pernah dikirim ke
     * WhatsApp; dipakai untuk penyaringan & audit.
     */
    WHATSAPP_ADMIN_PHONE: optionalString,
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

    // Penyimpanan S3 BELUM diimplementasikan — hanya `local` yang jalan.
    //
    // Diam-diam jatuh ke disk lokal jauh lebih berbahaya: operator
    // menyiapkan bucket dan kredensial, lalu dokumen resmi justru tersimpan
    // di disk container yang hilang saat di-restart. Gagal booting lebih
    // jujur daripada menyimpan di tempat yang tidak diminta.
    if (value.STORAGE_DRIVER === 's3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_DRIVER'],
        message:
          'STORAGE_DRIVER=s3 belum diimplementasikan. Pakai STORAGE_DRIVER=local, ' +
          'atau implementasikan S3StorageDriver di src/documents/service.ts.',
      })
    }

    // Nomor WhatsApp divalidasi sebagai digits + kode negara.
    const nomorValid = (value: string | undefined): boolean => {
      if (!value) return true
      return /^\d{8,15}$/.test(value)
    }

    for (const [key, label] of [
      ['WHATSAPP_LINK_PHONE', 'nomor akun bot yang akan ditautkan'],
      ['WHATSAPP_ADMIN_PHONE', 'nomor admin'],
    ] as const) {
      if (!nomorValid(value[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Format tidak valid untuk ${label}. Gunakan digits + kode negara tanpa '+', '-', spasi, atau kurung.`,
        })
      }
    }

    // Guardrails: nomor bot dan nomor admin tidak boleh sama. Kalau sama,
    // kemungkinan besar ada kesalahan isi di konfigurasi — dan akun pemilik bisa
    // ikut ter-link sebagai bot.
    if (
      value.WHATSAPP_LINK_PHONE &&
      value.WHATSAPP_ADMIN_PHONE &&
      value.WHATSAPP_LINK_PHONE === value.WHATSAPP_ADMIN_PHONE
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_LINK_PHONE'],
        message:
          'WHATSAPP_LINK_PHONE (akun bot) tidak boleh sama dengan WHATSAPP_ADMIN_PHONE. ' +
          'Kalau memang sama, kosongkan ADMIN_PHONE.',
      })
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