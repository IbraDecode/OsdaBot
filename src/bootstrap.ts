/**
 * Composition root — satu-satunya tempat semua modul disambung.
 *
 * Prinsip: modul tidak saling meng-import secara bebas. Semuanya menerima
 * dependency lewat sini, supaya:
 *  - graf dependensi terlihat jelas,
 *  - substitution test (test double) mudah,
 *  - tidak ada circular import yang menyulitkan.
 */
import { AttendanceService } from './attendance/service.js'
import { AgentRuntime } from './agent/runtime.js'
import { OpenAiCompatibleProvider } from './agent/llm/openai-compatible.js'
import { env } from './config/env.js'
import { prisma } from './database/client.js'
import { IdentityEngine } from './identity/resolver.js'
import { logger } from './observability/logger.js'
import { MessageHandler } from './pipeline/message-handler.js'
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
  authorization: AuthorizationService
  identity: IdentityEngine
  attendance: AttendanceService
  tools: ToolRegistry
  skills: SkillRegistry
  agent: AgentRuntime
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

  // --- Lapis pipeline -----------------------------------------------------
  const pipeline = new MessagePipeline({ prisma })

  const handler = new MessageHandler({ pipeline, identity, agent, tools, skills, whatsapp, attendance })

  // Tool butuh akses Prisma untuk query langsung (mis. daftar anggota).
  attachPrismaToRegistry(tools, prisma)

  await handler.registerTools()

  const shutdown = async (): Promise<void> => {
    log.info('mematikan aplikasi')
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
    authorization,
    identity,
    attendance,
    tools,
    skills,
    agent,
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