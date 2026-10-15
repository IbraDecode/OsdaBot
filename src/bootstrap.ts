/**
 * Composition root — satu-satunya tempat semua modul disambung.
 *
 * Prinsip: modul tidak saling meng-import secara bebas. Semuanya menerima
 * dependency lewat sini, supaya:
 *  - graf dependensi terlihat jelas,
 *  - substitution test (test double) mudah,
 *  - tidak ada circular import yang menyulitkan.
 */
import { ApprovalEngine } from './approvals/engine.js'
import { ToolApprovalExecutor } from './approvals/executor.js'
import { AttendanceService } from './attendance/service.js'
import { FinanceService } from './finance/service.js'
import { GroupLinkService } from './groups/service.js'
import { DocumentService, LocalStorageDriver } from './documents/service.js'
import { AgentRuntime } from './agent/runtime.js'
import { OpenAiCompatibleProvider } from './agent/llm/openai-compatible.js'
import { env } from './config/env.js'
import { prisma } from './database/client.js'
import { IdentityEngine } from './identity/resolver.js'
import { logger } from './observability/logger.js'
import { MessageHandler } from './pipeline/message-handler.js'
import { ReminderWorker } from './queue/reminder-worker.js'
import { ReminderService } from './reminders/service.js'
import { OutboxDispatcher } from './outbox/dispatcher.js'
import { WhatsAppOutboxHandler } from './outbox/handlers.js'
import { MessagePipeline } from './pipeline/message-pipeline.js'
import { SkillRegistry } from './skills/registry.js'
import { AuthorizationService } from './security/authorization.js'
import { ALL_PERMISSIONS } from './security/permissions.js'
import { BaileysProvider } from './whatsapp/baileys-provider.js'
import type { WhatsAppProvider } from './whatsapp/types.js'
import { ToolRegistry } from './tools/registry.js'

const log = logger.child({ module: 'bootstrap' })

export interface Application {
  prisma: typeof prisma
  approvals: ApprovalEngine
  authorization: AuthorizationService
  identity: IdentityEngine
  attendance: AttendanceService
  finance: FinanceService
  groups: GroupLinkService
  documents: DocumentService
  tools: ToolRegistry
  skills: SkillRegistry
  agent: AgentRuntime
  reminders: ReminderService
  reminderWorker: ReminderWorker
  outbox: OutboxDispatcher
  pipeline: MessagePipeline
  handler: MessageHandler
  whatsapp: WhatsAppProvider
  shutdown: () => Promise<void>
}

export interface BootstrapOptions {
  /** Test double. Kalau diisi, provider Baileys tidak dibuat. */
  whatsappProvider?: WhatsAppProvider
  /** Test double untuk LLM. */
  llmProvider?: ConstructorParameters<typeof AgentRuntime>[0]['llm']
  /** Default true. CLI harus mengeset false supaya prosesnya bisa keluar. */
  startWorkers?: boolean
  skillRoot?: string
  maxToolCalls?: number
  maxSteps?: number
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<Application> {
  // --- Lapis keamanan -----------------------------------------------------
  const authorization = new AuthorizationService({ prisma, logger: log })

  // --- Lapis identitas & domain -------------------------------------------
  const identity = new IdentityEngine({ prisma })
  const attendance = new AttendanceService({ prisma })
  const finance = new FinanceService(prisma)

  // --- Lapis tool ---------------------------------------------------------
  const tools = new ToolRegistry({ prisma, logger: log, ...(options.maxToolCalls ? { maxCallsPerRun: options.maxToolCalls } : {}) })

  // --- Lapis AI -----------------------------------------------------------
  const llm = options.llmProvider ?? new OpenAiCompatibleProvider()

  const agent = new AgentRuntime({
    llm,
    tools,
    authorization,
    ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
  })

  // --- Lapis skill --------------------------------------------------------
  const skills = new SkillRegistry()
  const skillResult = await skills.load(options.skillRoot ?? new URL('../skills/', import.meta.url).pathname)
  if (skillResult.issues.length > 0) {
    log.warn({ issues: skillResult.issues }, 'sebagian skill tidak valid')
  }

  // --- Lapis WhatsApp -----------------------------------------------------
  const whatsapp = options.whatsappProvider ?? new BaileysProvider()

  // --- Lapis persetujuan --------------------------------------------------
  //
  // WAJIB dipasang sebelum handler dipakai. Tanpa broker, tool yang
  // `requiresApproval` akan ditolak — itu memang perilaku yang benar, tapi
  // berarti fitur tidak bisa dipakai sama sekali kalau lupa dipasang.
  const approvalExecutor = new ToolApprovalExecutor({
    prisma,
    tools,
    authorization,
    defaultTimezone: env.APP_TIMEZONE,
  })

  const approvals = new ApprovalEngine({ prisma, whatsapp, executor: approvalExecutor })
  tools.setApprovalBroker(approvals)

  // --- Lapis pipeline -----------------------------------------------------
  const groups = new GroupLinkService(prisma)
  const documents = new DocumentService(prisma, new LocalStorageDriver(env.STORAGE_LOCAL_DIR))
  const pipeline = new MessagePipeline({
    prisma,
    // Pesan dari grup yang belum tertaut dicatat, bukan dibuang diam-diam.
    // Tanpa ini operator tidak akan pernah tahu JID mana yang perlu
    // ditautkan, dan bot terlihat "rusak" tanpa penjelasan apa pun.
    onUnlinkedGroup: async (message) => {
      await groups.catatGrupBelumTertaut(message.chatJid, {
        senderName: message.senderPushName,
      })
      log.warn({ chatJid: message.chatJid }, 'grup belum tertaut — jalankan pnpm osda group:link')
    },
  })

  // --- Lapis pengingat -----------------------------------------------------
  //
  // Worker dinyalakan hanya di server. Di CLI, menyalakannya akan membuat
  // proses tidak pernah keluar.
  const reminders = new ReminderService(prisma)
  const reminderWorker = new ReminderWorker({ prisma, whatsapp })

  // --- Lapis outbox --------------------------------------------------------
  const outbox = new OutboxDispatcher(prisma)
  outbox.register(new WhatsAppOutboxHandler({ prisma, whatsapp }))

  const handler = new MessageHandler({
    pipeline,
    identity,
    agent,
    tools,
    skills,
    whatsapp,
    attendance,
    finance,
    documents,
    approvals,
    reminders,
  })

  // Tool butuh akses Prisma untuk query langsung (mis. daftar anggota).
  attachPrismaToRegistry(tools, prisma)

  await handler.registerTools()

  // Bersihkan persetujuan basi secara berkala. Expired tetap bisa dibaca untuk
  // audit, tapi tidak lagi bisa disetujui.
  const expiryTimer = setInterval(() => {
    void approvals.expireStale().catch((error: unknown) => log.warn({ err: error }, 'gagal mengexpire approval'))
  }, 60_000)
  expiryTimer.unref()

  if (options.startWorkers !== false) {
    reminderWorker.start()
    outbox.start()

    // Event yang tersisa di SENDING berarti proses sebelumnya mati saat
    // mengirim. Hasilnya tidak diketahui — dipindahkan ke UNKNOWN supaya
    // diperiksa manusia, BUKAN dikirim ulang.
    void outbox.recoverStuckSending().catch((error: unknown) => {
      log.warn({ err: error }, 'gagal memulihkan event outbox yang menggantung')
    })
  }

  const shutdown = async (): Promise<void> => {
    log.info('mematikan aplikasi')
    clearInterval(expiryTimer)
    await reminderWorker.stop()
    await outbox.stop()
    try {
      await whatsapp.disconnect()
    } catch (error) {
      log.warn({ err: error }, 'gagal menutup koneksi WhatsApp')
    }
    try {
      await prisma.$disconnect()
    } catch (error) {
      log.warn({ err: error }, 'gagal menutup koneksi database')
    }
  }

  return {
    prisma,
    approvals,
    authorization,
    identity,
    attendance,
    finance,
    groups,
    documents,
    tools,
    skills,
    agent,
    reminders,
    reminderWorker,
    outbox,
    pipeline,
    handler,
    whatsapp,
    shutdown,
  }
}

/**
 * Registry butuh Prisma untuk tool yang query langsung.
 * Kita pasang lewat WeakMap supaya tidak mengubah API publik ToolRegistry.
 */
const registryPrisma = new WeakMap<ToolRegistry, typeof prisma>()

export function attachPrismaToRegistry(registry: ToolRegistry, client: typeof prisma): void {
  registryPrisma.set(registry, client)
}

export function prismaForRegistry(registry: ToolRegistry): typeof prisma {
  const client = registryPrisma.get(registry)
  if (!client) throw new Error('Prisma belum dipasang pada ToolRegistry.')
  return client
}

/** Ringkasan konfigurasi untuk log boot — tanpa membocorkan rahasia. */
export function safeConfigSummary(): Record<string, unknown> {
  return {
    nodeEnv: env.NODE_ENV,
    timezone: env.APP_TIMEZONE,
    aiModel: env.AI_MODEL,
    aiBaseUrl: env.AI_BASE_URL,
    botName: env.WHATSAPP_BOT_NAME,
    sessionDir: env.WHATSAPP_SESSION_DIR,
    permissionCount: ALL_PERMISSIONS.length,
    baturpayConfigured: Boolean(env.BATURPAY_API_KEY),
    storageDriver: env.STORAGE_DRIVER,
  }
}