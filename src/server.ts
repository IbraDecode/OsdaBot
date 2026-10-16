/**
 * Server HTTP (Fastify).
 *
 * Endpoint yang ada HANYA yang benar-benar dibutuhkan operasional:
 *  - `GET /health`  — liveness (apakah proses hidup).
 *  - `GET /ready`   — readiness (apakah dependency siap menerima pekerjaan).
 *  - `POST /webhooks/baturpay` — penerimaan notifikasi pembayaran.
 *
 * Tidak ada dashboard web. Terminal + WhatsApp adalah antarmuka utamanya,
 * sesuai keputusan arsitektur.
 *
 * CATATAN KEAMANAN: endpoint webhook butuh verifikasi HMAC. Tanpa itu, siapa pun
 * bisa mengirim "pembayaran sukses" palsu dan menandai transaksi lunas.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { env } from './config/env.js'
import { logger } from './observability/logger.js'
import type { Application } from './bootstrap.js'
import { handleBaturPayWebhook } from './payments/baturpay.js'

const log = logger.child({ module: 'server' })

/** Request yang menyimpan raw body untuk verifikasi signature webhook. */
interface FastifyRequestWithRawBody {
  rawBody?: Buffer
}

/**
 * Bandingkan bearer token secara waktu-konstan.
 *
 * `timingSafeEqual` menolak panjang berbeda, jadi panjangnya dibandingkan
 * lebih dulu. Panjang token bukan rahasia — yang tidak boleh bocor adalah
 * apakah tebakan panjangnya benar.
 */
function cocokToken(request: { headers: Record<string, unknown> }): boolean {
  const header = request.headers.authorization
  if (typeof header !== 'string') return false

  const token = env.SYSTEM_ADMIN_TOKEN
  if (!token) return false

  const diberikan = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(diberikan)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function createServer(app: Application): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false,
    bodyLimit: env.SERVER_BODY_LIMIT_BYTES,
    trustProxy: true,
  })

  // --- Health ---------------------------------------------------------------

  server.get('/health', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
  }))

  server.get('/ready', async (_request, reply) => {
    const checks = await runReadinessChecks(app)
    const ready = checks.every((check) => check.ok)

    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks,
    })
  })

  // --- Mode aman (endpoint administrative) --------------------------------
  //
  // Dibuat HANYA kalau `SYSTEM_ADMIN_TOKEN` diset. Kalau kosong, route-nya
  // tidak ada — bukan ada tapi menolak. Route yang "ada tapi 403" masih
  // memberi tahu pemindai bahwa ada sesuatu yang bisa dicoba.
  //
  // Bandingkan dengan `kill`: yang ini tidak memutus proses, tidak memutus
  // koneksi WhatsApp, dan tidak menghapus apa pun. Itu justru alasan ia perlu
  // ada sebagai endpoint — saat-saat kill justru waktu yang paling tidak tepat
  // untuk melakukan hal yang masih bisa diselamatkan.
  if (env.SYSTEM_ADMIN_TOKEN) {
    server.get('/admin/safe-mode', async (request, reply) => {
      if (!cocokToken(request)) {
        return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' })
      }
      return { ok: true, ...(await app.safeMode.snapshot()) }
    })

    server.post('/admin/safe-mode', async (request, reply) => {
      if (!cocokToken(request)) {
        return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' })
      }

      const body = (request.body ?? {}) as { enabled?: unknown; reason?: unknown }
      if (typeof body.enabled !== 'boolean') {
        return reply.code(400).send({ ok: false, error: 'BAD_REQUEST', detail: 'enabled harus boolean' })
      }

      const alasan = typeof body.reason === 'string' ? body.reason.slice(0, 300) : null
      const status = await app.safeMode.set({
        enabled: body.enabled,
        reason: alasan,
        changedBy: 'http',
      })

      return { ok: true, ...status }
    })
  } else {
    log.info('SYSTEM_ADMIN_TOKEN tidak diset — endpoint /admin/* tidak dibuat')
  }

  // --- Webhook pembayaran ---------------------------------------------------

  server.post('/webhooks/baturpay', async (request, reply) => {
    if (!env.BATURPAY_WEBHOOK_SECRET) {
      log.warn('webhook BaturPay dipanggil tanpa secret terkonfigurasi')
      return reply.code(503).send({ ok: false, error: 'WEBHOOK_NOT_CONFIGURED' })
    }

    // Verifikasi signature WAJIB memakai RAW BODY. Kalau body di-parse dulu lalu
    // di-serialize ulang, byte-nya bisa berbeda dan HMAC gagal (atau, lebih
    // buruk, lolos karena encoding berbeda).
    const rawBody =
      (request as FastifyRequestWithRawBody).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}))
    const signature = request.headers['x-baturpay-signature']
    const timestamp = request.headers['x-baturpay-timestamp']

    const verified =
      typeof signature === 'string' &&
      typeof timestamp === 'string' &&
      verifyBaturPaySignature(rawBody, timestamp, signature, env.BATURPAY_WEBHOOK_SECRET)

    if (!verified) {
      log.warn('webhook BaturPay ditolak: signature tidak cocok')
      return reply.code(401).send({ ok: false, error: 'INVALID_SIGNATURE' })
    }

    try {
      const result = await handleBaturPayWebhook(request.body as Record<string, unknown>, rawBody)
      return reply.code(result.accepted ? 200 : 202).send({ ok: true, ...result })
    } catch (error) {
      log.error({ err: error }, 'gagal memproses webhook BaturPay')
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' })
    }
  })

  // --- Raw body capture ----------------------------------------------------

  server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const buffer = body as Buffer
    // Simpan RAW BYTE di request. Verifikasi HMAC webhook MEMBUTUHKAN byte
    // persis seperti yang dikirim — kalau di-parse lalu di-serialize ulang,
    // hash-nya bisa berbeda dan signature tidak akan cocok.
    ;(request as FastifyRequestWithRawBody).rawBody = buffer
    try {
      done(null, buffer.length === 0 ? {} : JSON.parse(buffer.toString('utf8')))
    } catch (error) {
      const err = error as Error & { statusCode?: number }
      err.statusCode = 400
      done(err, undefined)
    }
  })

  await server.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT })

  log.info({ host: env.SERVER_HOST, port: env.SERVER_PORT }, 'server HTTP berjalan')
  return server
}

export interface ReadinessCheck {
  name: string
  ok: boolean
  latencyMs?: number
  detail?: string
}

export async function runReadinessChecks(app: Application): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = []

  const mulaiDb = Date.now()
  try {
    await app.prisma.$queryRaw`SELECT 1`
    checks.push({ name: 'postgresql', ok: true, latencyMs: Date.now() - mulaiDb })
  } catch (error) {
    checks.push({
      name: 'postgresql',
      ok: false,
      latencyMs: Date.now() - mulaiDb,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  const status = app.whatsapp.getStatus()
  // WhatsApp tidak "ok" kalau butuh auth ulang — tapi itu bukan kegagalan proses.
  checks.push({
    name: 'whatsapp',
    ok: status.state === 'connected' || status.state === 'connecting' || status.state === 'reconnecting',
    detail: `${status.state}${status.reason ? `: ${status.reason}` : ''}`,
  })

  checks.push({ name: 'tools', ok: app.tools.names().length > 0, detail: `${app.tools.names().length} tool` })
  checks.push({ name: 'skills', ok: app.skills.size() >= 0, detail: `${app.skills.size()} skill` })

  // Mode aman dilaporkan sebagai KEGAGALAN readiness.
  //
  // Ini bukan sekadar informasi. `/ready` ada supaya sistem pemantau, load
  // balancer, atau orkestrator tahu bot ini sedang tidak melayani — dan saat
  // mode aman dinyalakan, bot memang tidak melayani. Operator yang sengaja
  // menahan bot **ingin** melihat ini muncul.
  //
  // Yang tidak boleh terjadi: mode aman menyala diam-diam dan tidak ada
  // satu pun tanda di luar log terminal yang sedang tidak dibaca siapa pun.
  const safeMode = await app.safeMode.snapshot()
  checks.push({
    name: 'safe_mode',
    ok: !safeMode.enabled,
    detail: safeMode.enabled
      ? `AKTIF sejak ${safeMode.since?.toISOString() ?? 'tidak diketahui'}` +
        (safeMode.reason ? ` — ${safeMode.reason}` : '')
      : 'mati',
  })

  return checks
}

/**
 * Verifikasi HMAC BaturPay.
 *
 * Format (dari dokumentasi resmi BaturPay):
 *   expected = hex(HMAC-SHA256(timestamp + "." + rawBody, secret))
 *   Bandingkan dengan `timingSafeEqual`.
 *
 * Perbandingan harus timing-safe supaya tidak bisa dikira tebak-tebakan.
 */
export function verifyBaturPaySignature(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody])).digest('hex')

  const provided = Buffer.from(signature, 'hex')
  const computed = Buffer.from(expected, 'hex')

  if (provided.length !== computed.length) return false
  return timingSafeEqual(provided, computed)
}