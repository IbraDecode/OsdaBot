/**
 * Pencatatan jalan agent (`AgentTask` + `AgentStep`).
 *
 * ── Celah yang ditutup ─────────────────────────────────────────────────────
 *
 * `ToolExecution` sudah mencatat setiap pemanggilan tool: nama, aktor, hasil,
 * durasi. Itu menjawab "apa yang dipanggil".
 *
 * Tapi tidak menjawab "kenapa". Data yang ada di produksi sebelum modul ini:
 *
 * ```
 * ToolExecution : 2232 baris
 *   dengan taskId : 0        ← tidak terhubung ke apa pun
 * AgentTask     : 0 baris
 * AgentStep     : 0 baris
 * ```
 *
 * Jadi kalau bot menjawab dengan sesuatu yang salah, tidak ada yang bisa
 * dijawab: apakah model salah membaca, tool yang salah dipanggil, langkah
 * habis, atau penyedia error? Log ada, tapi log tidak bisa dijawab dalam
 * bentuk pertanyaan.
 *
 * Yang ditambahkan di sini adalah **unit yang bisa ditanyakan**: satu
 * percakapan = satu `AgentTask`, tiap putaran LLM = satu `AgentStep`.
 *
 * ── Apa yang disimpan, dan apa yang tidak ───────────────────────────────────
 *
 * | Disimpan | Tidak disimpan |
 * |---|---|
 * | Aktivitas: chat atau grup | Isi pesan (sudah ada di `Message`) |
 * | Langkah, tool yang dipanggil, hasilnya | Isi balasan (sudah ada di `Message`) |
 * | Alasan berhenti: `MAX_STEPS`, `LLM_ERROR` | Argumen lengkap tiap tool |
 * | Perhitungan token | Rahasia, kredensial |
 *
 * Alasan lain bukan menggandakan isi pesan di sini: pesannya sudah
 * tersimpan sekali di `Message`, dan `AgentTask` menunjuk ke percakapan yang
 * sama. Menyalinnya berarti dua tempat harus ikut dihapus kalau ada permintaan
 * penghapusan data — dan hanya satu yang biasanya terlupakan.
 *
 * ── Menulis rekaman TIDAK BOLEH menggagalkan percakapan ─────────────────────
 *
 * Ini jalur terpanas sistem. Kalau pencatatan error dan ikut menggagalkan, bot
 * mati sepenuhnya karena masalah audit. Semua penulisan dibungkus try/catch dan
 * kegagalan hanya dicatat.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { logger } from '../observability/logger.js'

const log = logger.child({ module: 'agent-run' })

/** Alasan agent berhenti. Nilainya masuk ke `AgentTask.errorCode`. */
export type AlasanSelesai =
  | 'JAWABAN_FINAL'
  | 'MAX_STEPS'
  | 'LLM_ERROR'
  | 'EMPTY_RESPONSE'
  | 'BATAS_TOOL_CALL'
  | 'SAFE_MODE'

export interface MulaiParams {
  correlationId: string
  actorUserId: string | null
  organizationId: string | null
  conversationId: string | null
  chatJid: string
  isGroup: boolean
  /** Nama tool yang dikirim ke model. Bantu melihat apakah penyaringan skill bekerja. */
  availableToolNames: string[]
}

/** Satu putaran LLM. */
export interface LangkahParams {
  /** Tool yang dipanggil di putaran ini. Kosong = ini jawaban final. */
  toolNames: string[]
  /** Kenapa tool-nya tidak dijalankan, kalau memang tidak dijalankan. */
  dilewati?: string | null
}

export interface SelesaiParams {
  status: 'completed' | 'failed'
  alasan: AlasanSelesai
  /** Berapa tool call yang benar-benar dieksekusi. */
  toolCalls: number
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  errorCode?: string | null
  retryable?: boolean
}

/**
 * Langkah yang sudah terkumpul, ditulis sekaligus di akhir.
 *
 * Ditulis per langkah akan menambah satu penulisan database per putaran LLM —
 * dan putaran LLM butuh puluhan detik lewat gateway. Format yang dikumpulkan
 * di memori lalu ditulis sekali membuat pencatatan tidak menambah latensi yang
 * dirasakan orang yang menunggu balasan.
 *
 * Konsekuensinya jujur: kalau proses mati di tengah jalan, langkahnya hilang.
 * Yang tetap ada adalah `ToolExecution` per pemanggilan tool, jadi tidak ada
 * jejak yang benar-benar hilang — hanya konteks "kenapa".
 */
interface LangkahTertunda {
  ordinal: number
  description: string
  toolName: string | null
  status: string
  dependsOn: string[]
  result: Record<string, unknown> | null
  error: string | null
}

export class AgentRunRecorder {
  /** Langkah yang belum ditulis. Kosong kalau pencatatan dimatikan. */
  private readonly tertunda: LangkahTertunda[] = []
  private readonly mulaiPada = Date.now()
  private taskId: string | null = null
  private ordinal = 0
  private dimatikan = false

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Buka baris `AgentTask`.
   *
   * Mengembalikan id yang harus dipakai sebagai `context.taskId`, supaya
   * `ToolExecution` punya Something untuk ditautkan. Kalau gagal, `null` —
   * percakapan tetap berjalan tanpa rekaman.
   */
  async mulai(params: MulaiParams): Promise<string | null> {
    try {
      const dibuat = await this.prisma.agentTask.create({
        data: {
          kind: params.isGroup ? 'chat_grup' : 'chat_personal',
          // Judul dibuat dari bentuk + chat asal, BUKAN isi pesan.
          //
          // Isi pesan ada di `Message`; menyalinnya ke sini berarti dua tempat
          // harus ikut dihapus kalau ada permintaan penghapusan data — dan
          // biasanya hanya satu yang terlupakan.
          //
          // `chatJid` boleh dipakai: ini pengenal percakapan, bukan isi pesan,
          // dan tanpa itu semua baris titled sama dan mustahil dipilah dari
          // daftar.
          title: `chat ${params.isGroup ? 'grup' : 'personal'} ${params.chatJid}`,
          status: 'RUNNING',
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          actorUserId: params.actorUserId,
          // `AgentTask` tidak punya kolom `correlationId` — jadi disimpan di
          // `state`. Kolomnya sudah dipakai `ToolExecution`, dan sekarang
          // `ToolExecution.taskId` menunjuk ke baris ini, jadi pencarian lewat
          // id sudah cukup tanpa kolom tambahan.
          state: {
            correlationId: params.correlationId,
            chatJid: params.chatJid,
            isGroup: params.isGroup,
            availableTools: params.availableToolNames,
          },
        },
        select: { id: true },
      })

      this.taskId = dibuat.id
      return dibuat.id
    } catch (error) {
      this.dimatikan = true
      log.warn({ err: error }, 'gagal membuka rekaman agent — percakapan tetap berjalan tanpa rekaman')
      return null
    }
  }

  /** Catat satu putaran LLM. Tidak menyentuh database. */
  langkah(params: LangkahParams): void {
    if (this.dimatikan) return

    this.ordinal += 1
    const toolNames = params.toolNames

    this.tertunda.push({
      ordinal: this.ordinal,
      description: toolNames.length > 0 ? `memanggil ${toolNames.join(', ')}` : 'menyusun jawaban akhir',
      // Satu langkah satu tool. Kalau model meminta beberapa tool sekaligus,
      // hanya yang pertama yang jadi nama utama; sisanya ada di `result`.
      toolName: toolNames[0] ?? null,
      status: params.dilewati ? 'skipped' : 'completed',
      dependsOn: [],
      result: toolNames.length > 0 ? { tools: toolNames } : { jawaban: true },
      error: params.dilewati ?? null,
    })
  }

  /** Tutup rekaman: tulis semua langkah, lalu perbarui baris induknya. */
  async selesai(params: SelesaiParams): Promise<void> {
    if (this.dimatikan || !this.taskId) return

    const taskId = this.taskId

    try {
      // Langkah ditulis lebih dulu. Kalau ini gagal, baris induk tetap ada
      // dan masih berguna: ada berapa langkah, tool apa saja yang dipanggil,
      // dan kenapa berhenti. Baris induk tanpa langkah masih menjawab
      // pertanyaan yang paling sering muncul.
      if (this.tertunda.length > 0) {
        await this.prisma.agentStep.createMany({
          data: this.tertunda.map((l) => ({
            taskId,
            ordinal: l.ordinal,
            description: l.description,
            toolName: l.toolName,
            status: l.status,
            dependsOn: l.dependsOn,
            result: (l.result ?? {}) as Prisma.InputJsonValue,
            error: l.error,
          })),
          skipDuplicates: true,
        })
      }

      // `state` digabung, bukan ditimpa.
      //
      // Versi pertama memakai `update: { state: {...ringkasan} }` dan itu
      // menghapus `correlationId` serta `chatJid` yang sudah ditulis saat
      // `mulai()`. Akibatnya rekaman kehilangan info yang membuatnya bisa
      // dicari — jadi tercatat, tapi tidak bisa ditanyakan.
      //
      // Prisma tidak punya operator "gabung JSON" yang aman di semua versi,
      // jadi isinya dibaca dulu lalu ditulis ulang. Perawatannya satu baris,
      // dan biayanya satu pembacaan pada saat yang bukan jalur terpanas.
      const sebelumnya = await this.prisma.agentTask.findUnique({
        where: { id: taskId },
        select: { state: true },
      })
      const isiLama = (sebelumnya?.state ?? {}) as Record<string, unknown>

      await this.prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: params.status === 'completed' ? 'COMPLETED' : 'FAILED',
          currentStep: this.ordinal,
          totalSteps: this.ordinal,
          errorCode: params.alasan,
          endedAt: new Date(),
          state: {
            ...isiLama,
            alasanBerhenti: params.alasan,
            toolCalls: params.toolCalls,
            usage: params.usage,
            retryable: params.retryable ?? null,
            durasiMs: Date.now() - this.mulaiPada,
          } as Prisma.InputJsonValue,
        },
      })
    } catch (error) {
      // Percakapan sudah selesai dengan jawabannya. Gagal mencatat tidak
      // boleh mengubah apa yang dilihat pengguna.
      log.error({ err: error, taskId }, 'gagal menutup rekaman agent')
    }
  }

  /** Id baris induk, kalau pencatatan hidup. */
  get id(): string | null {
    return this.taskId
  }
}

/**
 * Ringkas rekaman jadi satu baris yang enak dibaca.
 *
 * Dipakai CLI supaya operator tidak perlu menulis SQL sendiri.
 */
export function ringkasRekaman(baris: {
  id: string
  kind: string
  status: string
  errorCode: string | null
  createdAt: Date
  endedAt: Date | null
  steps: Array<{ ordinal: number; description: string; toolName: string | null; status: string; error: string | null }>
  state: unknown
  conversationId: string | null
}): string {
  const state = (baris.state ?? {}) as Record<string, unknown>
  const usage = (state.usage ?? {}) as Record<string, number>

  const bagian = [
    `run ${baris.id.slice(0, 8)}`,
    `[${baris.status}]`,
    baris.errorCode ? `berhenti=${baris.errorCode}` : null,
    `${baris.steps.length} langkah`,
    usage.totalTokens ? `${usage.totalTokens} token` : null,
    baris.endedAt
      ? `${Math.round((baris.endedAt.getTime() - baris.createdAt.getTime()) / 1000)} detik`
      : 'BELUM SELESAI',
  ].filter(Boolean)

  return bagian.join(' · ')
}