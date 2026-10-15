/**
 * Tool pengetahuan untuk AI agent.
 *
 * Batas yang paling penting di sini:
 *
 * 1. **Tidak boleh menjawab tanpa sumber.** Kalau pencarian mengembalikan
 *    kosong, tool mengatakannya. Model yang melihat "dokumen tidak ada" akan
 *   /Ask sumbernya; model yang melihat potongan kutipan bisa menyebutnya.
 *
 * 2. **Dokumen kedaluwarsa tidak dikembalikan.** Menjawab dengan aturan lama
 *    sama berbahaya dengan menjawab tanpa sumber — keduanya membuat orang
 *    bertindak berdasarkan informasi yang sudah tidak berlaku.
 *
 * 3. **Simpan dokumen butuh izin tulis.** Menyimpan teks ke dalam knowledge
 *    base organisasi berarti menyimpan keputusan/policy. Itu wewenang
 *    sekretaris atau ketua, bukan siapa saja yang bisa chat.
 */
import { z } from 'zod'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'
import { PERMISSIONS } from '../security/permissions.js'
import { KnowledgeError, type KnowledgeService } from '../knowledge/service.js'

export interface KnowledgeToolsDeps {
  knowledge: KnowledgeService
}

export function buildKnowledgeTools(deps: KnowledgeToolsDeps): Array<ToolDefinition<never, never>> {
  const { knowledge } = deps

  const search: ToolDefinition<{ query: string; documentType?: string; limit?: number }, unknown> = {
    name: 'knowledge_search',
    description:
      'Cari jawaban di dokumen resmi organisasi (peraturan, SOP, notulen, profil organisasi). ' +
      'Pakai ini SEBELUM menjawab pertanyaan tentang aturan, prosedur, nominal, atau deadline organisasi. ' +
      'Kalau hasilnya kosong, berarti tidak ada dokumen yang memuat itu — katakan begitu ke pengguna, jangan isi dari ingatan sendiri.',
    inputSchema: z
      .object({
        query: z
          .string()
          .max(300)
          .describe('Kata kunci pencarian. Gunakan kalimat pendek berisi istilah kunci, bukan pertanyaan panjang.'),
        documentType: z
          .string()
          .max(60)
          .optional()
          .describe('Saring jenis dokumen, mis. "peraturan", "prosedur", "notulen".'),
        limit: z.number().int().positive().max(10).optional().describe('Jumlah hasil. Default 5.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.KNOWLEDGE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const hasil = await knowledge.search(organizationId, input.query, {
        limit: input.limit ?? 5,
        ...(input.documentType ? { documentType: input.documentType } : {}),
      })

      if (hasil.length === 0) {
        // Struktur yang jelas, bukan array kosong. Model perlu tahu ini
        // "tidak ditemukan", bukan "belum ditanyakan".
        return {
          found: false,
          results: [],
          query: input.query,
          message:
            'Tidak ada dokumen organisasi yang memuat itu. Jawaban honestly harus "dokumennya belum ada" — ' +
            'jangan isi dari ingatan sendiri, dan tawarkan menyimpan aturan ini sebagai dokumen.',
        }
      }

      return {
        found: true,
        query: input.query,
        results: hasil.map((hit) => ({
          documentId: hit.documentId,
          title: hit.title,
          documentType: hit.documentType,
          excerpt: hit.excerpt,
          relevance: hit.score,
        })),
        message: `${hasil.length} sumber ditemukan. Sebutkan judul dokumennya saat menjawab.`,
      }
    },
  }

  const ingest: ToolDefinition<
    { title: string; content: string; documentType?: string; source?: string; validUntil?: string },
    unknown
  > = {
    name: 'knowledge_ingest',
    description:
      'Simpan teks ke dalam knowledge base organisasi supaya bisa ditanyakan nanti. ' +
      'Gunakan ini ketika pengguna mengirim aturan, SOP, notulen, atau keputusan rapat. ' +
      'Jangan menyimpan conjecture atau dugaan — hanya apa yang organisasi benar-benar sepakati. ' +
      'Teks yang disimpan akan dibaca anggota lain sebagai fakta.',
    inputSchema: z
      .object({
        title: z.string().max(200).describe('Judul dokumen, diambil dari yang disebut pengguna.'),
        content: z
          .string()
          .min(20)
          .max(2_000_000)
          .describe('Isi dokumen lengkap. Jangan ringkas — simpan persis seperti yang diberikan.'),
        documentType: z
          .string()
          .max(60)
          .optional()
          .describe('Jenis dokumen: "peraturan", "prosedur", "notulen", "profil", "panduan".'),
        source: z.string().max(200).optional().describe('Asal dokumen, mis. "keputusan rapat 12 Okt 2026".'),
        validUntil: z
          .string()
          .optional()
          .describe('Berlaku sampai tanggal YYYY-MM-DD. Isi kalau aturannya ada masa berlaku.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.KNOWLEDGE_WRITE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const hasil = await knowledge.ingest({
        organizationId,
        title: input.title,
        content: input.content,
        documentType: input.documentType ?? 'catatan',
        source: input.source ?? 'chat',
        validUntil: input.validUntil ? new Date(`${input.validUntil}T23:59:59`) : null,
        actorUserId: context.actorUserId,
      })

      return {
        documentId: hasil.documentId,
        title: hasil.title,
        chunkCount: hasil.chunkCount,
        characterCount: hasil.characterCount,
        message: `Dokumen "${hasil.title}" disimpan (${hasil.chunkCount} bagian, ${hasil.characterCount} karakter). Sekarang bisa ditanyakan lewat knowledge_search.`,
      }
    },
  }

  const list: ToolDefinition<{ limit?: number }, unknown> = {
    name: 'knowledge_list',
    description:
      'Tampilkan dokumen yang sudah tersimpan di knowledge base organisasi. Pakai ini untuk mengecek apakah suatu aturan sudah pernah disimpan sebelum menyimpannya lagi.',
    inputSchema: z
      .object({ limit: z.number().int().positive().max(50).optional().describe('Jumlah maksimal. Default 20.') })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.KNOWLEDGE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const rows = await knowledge.list(organizationId, { limit: input.limit ?? 20 })

      return {
        documents: rows.map((row) => ({
          documentId: row.id,
          title: row.title,
          documentType: row.documentType,
          source: row.source,
          status: row.status,
          chunkCount: row.chunkCount,
          validUntil: row.validUntil?.toISOString().slice(0, 10) ?? null,
        })),
        message: `${rows.length} dokumen tersimpan.`,
      }
    },
  }

  const archive: ToolDefinition<{ documentId: string }, unknown> = {
    name: 'knowledge_archive',
    description:
      'Tandai dokumen sudah tidak berlaku lagi, supaya tidak lagi dipakai sebagai sumber jawaban. ' +
      'Dokumen TIDAK dihapus — riwayatnya tetap ada untuk keperluan audit.',
    inputSchema: z
      .object({ documentId: z.string().uuid().describe('Id dokumen dari knowledge_list atau knowledge_ingest.') })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.KNOWLEDGE_WRITE],
    riskLevel: 'MEDIUM',
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const berhasil = await knowledge.archive(input.documentId, organizationId)

      if (!berhasil) {
        throw new ToolError('NOT_FOUND', 'Dokumen tidak ditemukan di organisasi ini.')
      }

      return {
        documentId: input.documentId,
        archived: true,
        message: 'Dokumen diarsipkan. Tidak lagi dipakai sebagai sumber jawaban.',
      }
    },
  }

  return [search, ingest, list, archive] as never
}

function requireOrg(context: ToolExecutionContext): string {
  const organizationId = context.organizationId
  if (!organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum terdeteksi untuk percakapan ini.')
  }
  return organizationId
}

/** Ubah KnowledgeError jadi ToolError yang bisa ditindaklanjuti model. */
export function mapKnowledgeError(error: unknown): ToolError {
  if (error instanceof KnowledgeError) {
    switch (error.code) {
      case 'CONTENT_EMPTY':
      case 'TITLE_REQUIRED':
      case 'CONTENT_TOO_LONG':
      case 'NOT_FOUND':
        return new ToolError('VALIDATION_FAILED', error.message)
    }
  }
  return new ToolError('INTERNAL_ERROR', 'Gagal memproses pengetahuan organisasi.')
}