/**
 * Tool untuk membaca lampiran pesan.
 *
 * Dua aturan yang menentukan desainnya:
 *
 * 1. **Hanya PDF yang bisa dibaca.** Mendukung DOCX berarti menambah pustaka
 *    parser lagi; yang lebih penting, format lain (gambar, audio, video) tidak
 *    punya teks sama sekali dan hasilnya pasti kosong. Lebih baik ditolak
 *    dengan alasan yang jelas daripada mengembalikan string kosong yang
 *    disalahartikan sebagai "dokumennya memang kosong".
 *
 * 2. **Tidak ada OCR.** PDF hasil pindai adalah gambar. Mengarang isinya dari
 *    nama berkas adalah hal yang paling merusak di seluruh sistem — hasilnya
 *    akan tersimpan sebagai sumber yang padahal tidak pernah ditulis siapa pun.
 */
import { z } from 'zod'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'
import { PERMISSIONS } from '../security/permissions.js'
import { ExtractionError, extractPdfText } from '../knowledge/extract.js'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import type { KnowledgeService } from '../knowledge/service.js'

export interface MediaToolsDeps {
  whatsapp: Pick<WhatsAppProvider, 'downloadMediaById'>
  knowledge: KnowledgeService
}

/** Jenis MIME yang bisa diubah jadi teks. */
const MIME_DIBACA: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'teks',
}

export function buildMediaTools(deps: MediaToolsDeps): Array<ToolDefinition<never, never>> {
  const { whatsapp, knowledge } = deps

  const read: ToolDefinition<{ messageId?: string }, unknown> = {
    name: 'media_read_document',
    description:
      'Baca isi lampiran PDF atau berkas teks yang baru dikirim pengguna, lalu ambil teksnya. ' +
      'Pakai ini kalau pengguna mengirim PDF (peraturan, surat, notulen) dan minta isinya disimpan atau dijawab. ' +
      'Kalau hasilnya kosong atau gagal, katakan tidak bisa dibaca — jangan mengarang isinya dari nama berkas.',
    inputSchema: z
      .object({
        messageId: z
          .string()
          .max(80)
          .optional()
          .describe('Id pesan berisi lampiran. Kalau tidak disebut, pakai lampiran terakhir di percakapan ini.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.KNOWLEDGE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const messageId = input.messageId ?? context.pendingMediaId
      if (!messageId) {
        throw new ToolError(
          'VALIDATION_FAILED',
          'Tidak tahu lampiran yang mana. Panggil media_pending dulu untuk melihat lampiran terakhir.',
        )
      }

      const buffer = await whatsapp.downloadMediaById(messageId)
      if (!buffer) {
        throw new ToolError(
          'NOT_FOUND',
          'Lampirannya sudah tidak tersimpan (WhatsApp menyimpan media hanya 15 menit). ' +
            'Minta pengguna mengirim ulang berkasnya.',
        )
      }

      // Deteksi format dari isinya, bukan dari nama berkas yang dikirim.
      const magic = buffer.subarray(0, 5).toString('ascii')
      const teksPolos = buffer.subarray(0, 4096).toString('utf8')
      const format = magic === '%PDF-' ? 'pdf' : MIME_DIBACA['text/plain'] && !/[\x00-\x08\x0E-\x1F]/.test(teksPolos) ? 'teks' : null

      if (!format) {
        throw new ToolError(
          'VALIDATION_FAILED',
          'Format berkas ini belum bisa dibaca (hanya PDF dan berkas teks). Gambar dan DOCX belum didukung.',
        )
      }

      const teks = format === 'pdf' ? await ekstrak(buffer) : buffer.toString('utf8').trim()

      return {
        messageId,
        format,
        characterCount: teks.length,
        preview: teks.slice(0, 600),
        text: teks.slice(0, 200_000),
        message:
          `Terbaca ${teks.length} karakter dari lampiran. ` +
          'Kalau pengguna ingin ini bisa ditanyakan nanti, panggil knowledge_ingest dengan teksnya.',
      }
    },
  }

  const pending: ToolDefinition<Record<string, never>, unknown> = {
    name: 'media_pending',
    description:
      'Tampilkan lampiran terakhir yang dikirim di percakapan ini (jenis berkas dan ukurannya). ' +
      'Pakai ini kalau pengguna mengirim berkas tapi belum jelas apa yang harus dilakukan.',
    inputSchema: z.object({}).strict() as never,
    requiredPermissions: [PERMISSIONS.KNOWLEDGE_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(_input, context) {
      if (!context.pendingMedia) {
        return {
          hasMedia: false,
          message: 'Tidak ada lampiran di percakapan ini.',
        }
      }

      const media = context.pendingMedia
      return {
        hasMedia: true,
        messageId: media.messageId,
        fileName: media.fileName,
        mimetype: media.mimetype,
        type: media.type,
        readable: media.mimetype !== null && media.mimetype in MIME_DIBACA,
        message: media.mimetype && media.mimetype in MIME_DIBACA
          ? `Lampiran: ${media.fileName ?? '(tanpa nama)'}. Bisa dibaca dengan media_read_document.`
          : `Lampiran: ${media.fileName ?? '(tanpa nama)'} (${media.mimetype ?? 'tipe tidak diketahui'}). Format ini belum bisa dibaca.`,
      }
    },
  }

  const ingest: ToolDefinition<{ title?: string; documentType?: string }, unknown> = {
    name: 'media_ingest_document',
    description:
      'Baca lampiran PDF terakhir lalu simpan isinya ke knowledge base supaya bisa ditanyakan. ' +
      'Hanya untuk PDF dan berkas teks. Kalau lampirannya hasil pindai/foto, sistem akan bilang tidak bisa dibaca.',
    inputSchema: z
      .object({
        title: z.string().max(200).optional().describe('Judul dokumen. Default: nama berkas.'),
        documentType: z.string().max(60).optional().describe('Jenis dokumen, mis. "peraturan", "notulen".'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.KNOWLEDGE_WRITE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const media = context.pendingMedia
      if (!media) {
        throw new ToolError('VALIDATION_FAILED', 'Tidak ada lampiran di percakapan ini.')
      }

      const buffer = await whatsapp.downloadMediaById(media.messageId)
      if (!buffer) {
        throw new ToolError(
          'NOT_FOUND',
          'Lampirannya sudah tidak tersimpan. Minta pengguna mengirim ulang berkasnya.',
        )
      }

      const magic = buffer.subarray(0, 5).toString('ascii')
      if (magic !== '%PDF-') {
        const teksPolos = buffer.subarray(0, 4096).toString('utf8')
        if (/[\x00-\x08\x0E-\x1F]/.test(teksPolos)) {
          throw new ToolError(
            'VALIDATION_FAILED',
            'Format berkas ini belum bisa dibaca. Hanya PDF dan berkas teks yang didukung.',
          )
        }
      }

      const teks = magic === '%PDF-' ? await ekstrak(buffer) : buffer.toString('utf8').trim()
      const judul = input.title ?? media.fileName ?? 'Dokumen dari lampiran'

      const hasil = await knowledge.ingest({
        organizationId: requireOrg(context),
        title: judul.replace(/\.[a-z0-9]+$/i, ''),
        content: teks,
        documentType: input.documentType ?? 'dokumen',
        source: `chat:${media.messageId}`,
        actorUserId: context.actorUserId,
      })

      return {
        documentId: hasil.documentId,
        title: hasil.title,
        characterCount: hasil.characterCount,
        chunkCount: hasil.chunkCount,
        message: `Isi lampiran "${hasil.title}" disimpan ke knowledge base (${hasil.characterCount} karakter). Sekarang bisa ditanyakan.`,
      }
    },
  }

  return [pending, read, ingest] as never
}

async function ekstrak(buffer: Buffer): Promise<string> {
  try {
    const hasil = await extractPdfText(buffer)
    return hasil.text
  } catch (error) {
    if (error instanceof ExtractionError) {
      // Pesan diteruskan apa adanya: "PDF ini hasil pindai" jauh lebih berguna
      // daripada "gagal".
      throw new ToolError('VALIDATION_FAILED', error.message)
    }
    throw error
  }
}

function requireOrg(context: ToolExecutionContext): string {
  if (!context.organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum terdeteksi untuk percakapan ini.')
  }
  return context.organizationId
}