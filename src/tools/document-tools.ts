/**
 * Tool dokumen untuk AI agent.
 *
 * Batas yang dijaga:
 *
 * 1. **`organizationId` dan `actorUserId` bukan parameter.** Keduanya dari
 *    `context`, yang sudah diverifikasi backend.
 *
 * 2. **Isi dokumen berasal dari database, bukan dari teks model.** Daftar
 *    hadir untuk PDF diambil dari entri yang benar-benar ada. Kalau model
 *    boleh mengarang baris daftar, dokumen resmi berisi kehadiran orang yang
 *    tidak pernah dikonfirmasi siapa pun.
 *
 * 3. **Kirim dokumen selalu butuh persetujuan.** Berkas resmi yang dikirim ke
 *    nomor yang salah tidak bisa ditarik kembali.
 */
import { z } from 'zod'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'
import { PERMISSIONS } from '../security/permissions.js'
import type { DocumentService } from '../documents/service.js'
import {
  DocumentError,
  DOCUMENT_TEMPLATES,
  type DocumentTemplate,
} from '../documents/renderer.js'
import type { IdentityEngine } from '../identity/resolver.js'
import type { AttendanceService } from '../attendance/service.js'

export interface DocumentToolsDeps {
  documents: DocumentService
  identity: IdentityEngine
  attendance: AttendanceService
  whatsapp: {
    sendDocument: (
      chatJid: string,
      document: { buffer: Buffer; filename: string; mimetype: string },
    ) => Promise<{ status: string; providerMessageId: string | null }>
  }
  /** Default ke `context.actorUserId` kalau tidak diberi. */
  defaultSignerName?: string
}

const TEMPLAT_ENUM = [
  'surat_izin',
  'surat_tugas',
  'sertifikat',
  'rekap_absensi',
  'daftar_hadir',
] as const

/** Penjelasan tiap templat — dipakai di `.describe()` agar model memilih benar. */
const DESKRIPSI_TEMPLAT: Record<DocumentTemplate, string> = {
  surat_izin: 'surat izin tidak mengikuti kegiatan. Butuh: nama, alasan, dan kegiatan.',
  surat_tugas: 'surat tugas untuk yang mengerjakan tugas kegiatan. Butuh: nama, tugas, dan kegiatan.',
  sertifikat: 'sertifikat untuk orang yang mengikuti kegiatan. Butuh: nama dan kegiatan.',
  rekap_absensi: 'rekapitulasi daftar hadir dalam PDF. Butuh: daftar yang sudah ada (attendanceEventId).',
  daftar_hadir: 'daftar hadir yang siap dicetak dan ditandatangani. Butuh: daftar yang sudah ada (attendanceEventId).',
}

export function buildDocumentTools(deps: DocumentToolsDeps): Array<ToolDefinition<never, never>> {
  const { documents, identity, attendance, whatsapp } = deps

  const create: ToolDefinition<
    {
      template: (typeof TEMPLAT_ENUM)[number]
      memberName?: string
      memberDetail?: string
      reason?: string
      eventTitle?: string
      eventDate?: string
      attendanceEventId?: string
      signerName?: string
      signerRole?: string
      signerPlace?: string
      notes?: string
      title?: string
      sendTo?: string
    },
    unknown
  > = {
    name: 'document_create',
    description:
      'Buat dokumen resmi (PDF): surat izin, surat tugas, sertifikat, daftar hadir, atau rekap absensi. ' +
      'Untuk daftar hadir dan rekap, isi `attendanceEventId` dari hasil attendance_get — jangan mengarang id, dan jangan menulis nama sendiri karena sistem mengambilnya dari daftar yang benar-benar ada. ' +
      'Surat izin dan surat tugas WAJIB punya alasan yang jelas; jangan mengarang alasan kalau pengguna tidak menyebutkannya. ' +
      'Kalau `sendTo` diisi, dokumen dikirim ke nomor itu setelah pengguna menyetujui.',
    inputSchema: z
      .object({
        template: z
          .enum(TEMPLAT_ENUM)
          .describe('Jenis dokumen. Pilih sesuai maksud: izin (tidak hadir), tugas (mengerjakan tugas), sertifikat (mengikuti kegiatan), daftar_hadir (untuk dicetak), rekap_absensi (rekapitulasi).'),
        memberName: z
          .string()
          .max(120)
          .optional()
          .describe('Nama anggota yang menjadi objek surat, persis seperti disebut pengguna. Boleh nama panggilan.'),
        memberDetail: z
          .string()
          .max(120)
          .optional()
          .describe('Kelas atau NIP, kalau diketahui.'),
        reason: z
          .string()
          .max(500)
          .optional()
          .describe('Alasan izin atau keterangan tugas. WAJIB untuk surat izin dan surat tugas.'),
        eventTitle: z.string().max(200).optional().describe('Nama kegiatan yang disebut pengguna.'),
        eventDate: z
          .string()
          .optional()
          .describe('Tanggal kegiatan format YYYY-MM-DD, dihitung di zona waktu organisasi.'),
        attendanceEventId: z
          .string()
          .uuid()
          .optional()
          .describe('Id daftar yang sudah ada. WAJIB untuk daftar_hadir dan rekap_absensi.'),
        signerName: z.string().max(120).optional().describe('Nama penanda tangan. Default: nama pengguna.'),
        signerRole: z.string().max(120).optional().describe('Jabatan penanda tangan, mis. "Ketua Osis".'),
        signerPlace: z.string().max(120).optional().describe('Kota penanda tangan.'),
        notes: z.string().max(1000).optional().describe('Catatan tambahan yang dicetak di dokumen.'),
        title: z.string().max(200).optional().describe('Judul dokumen. Default: judul standar sesuai templat.'),
        sendTo: z
          .string()
          .max(30)
          .optional()
          .describe('Nomor tujuan kirim (format 62...). Kosongkan kalau hanya ingin dibuat tanpa dikirim.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.DOCUMENTS_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const timezone = context.timezone

      // Daftar harus benar-benar ada. Baris diambil dari database, bukan
      // dari teks model.
      if (input.template === 'daftar_hadir' || input.template === 'rekap_absensi') {
        if (!input.attendanceEventId) {
          throw new ToolError(
            'VALIDATION_FAILED',
            'Daftar hadir dan rekap absensi harus menunjuk daftar yang sudah ada. ' +
              'Panggil attendance_get dulu, lalu pakai attendanceEventId dari hasilnya.',
          )
        }
        const event = await attendance.listEvents(organizationId, 20)
        const ketemu = event.find((e) => e.id === input.attendanceEventId)
        if (!ketemu) {
          throw new ToolError(
            'NOT_FOUND',
            'Daftar itu tidak ada di organisasi ini. Panggil attendance_list_events untuk melihat yang tersedia.',
          )
        }
      }

      // Nama anggota untuk surat & sertifikat.
      let subjectName = input.memberName ?? null
      let subjectDetail = input.memberDetail ?? null

      if (input.memberName) {
        const resolution = await identity.resolveMemberByName(organizationId, input.memberName)
        if (resolution.certainty === 'unique') {
          subjectName = resolution.memberName
          // Kelas diambil dari database kalau pengguna tidak menyebutnya, dan
          // hanya kalau pengguna tidak mengatakannya sendiri.
          if (!subjectDetail) subjectDetail = resolution.className
        } else if (resolution.certainty === 'ambiguous') {
          // Salah pilih berarti dokumen resmi atas nama orang yang salah.
          throw new ToolError(
            'AMBIGUOUS_REFERENCE',
            `"${input.memberName}" cocok dengan lebih dari satu anggota: ${resolution.candidates.map((c) => c.name).join(' / ')}. Tanya pengguna mana yang dimaksud.`,
          )
        }
        // certainty 'none' → biarkan; renderDocument yang menolak dengan
        // pesan yang menyebut field mana yang kurang.
      }

      if (input.template === 'surat_izin' && !input.reason?.trim()) {
        throw new ToolError(
          'VALIDATION_FAILED',
          'Surat izin tanpa alasan tidak bisa dibuat — surat tanpa alasan bukan keputusan. Tanya alasannya ke pengguna.',
        )
      }

      const hasil = await documents.create({
        organizationId,
        template: input.template,
        title: input.title ?? DOCUMENT_TEMPLATES[input.template].label,
        actorUserId: context.actorUserId,
        ...(timezone ? { timezone } : {}),
        signerName: input.signerName ?? deps.defaultSignerName ?? 'Penanggung Jawab',
        signerRole: input.signerRole ?? null,
        signerPlace: input.signerPlace ?? null,
        subjectName,
        subjectDetail,
        reason: input.reason ?? null,
        eventTitle: input.eventTitle ?? null,
        eventDate: input.eventDate ? new Date(`${input.eventDate}T00:00:00`) : null,
        attendanceEventId: input.attendanceEventId ?? null,
        notes: input.notes ?? null,
      })

      const dasar = {
        documentId: hasil.id,
        documentNumber: hasil.documentNumber,
        title: hasil.title,
        template: input.template,
        filename: hasil.filename,
        sizeBytes: hasil.sizeBytes,
        rowsCount: hasil.rowsCount,
        message: `Dokumen ${hasil.documentNumber} "${hasil.title}" dibuat (${Math.round(hasil.sizeBytes / 1024)} KB).`,
      }

      if (!input.sendTo) return { ...dasar, sent: false }

      const tujuan = normalizeNomor(input.sendTo)
      const isi = await documents.readBuffer(organizationId, hasil.id)
      if (!isi) {
        throw new ToolError('NOT_FOUND', 'Dokumen baru dibuat tapi berkasnya tidak terbaca. Tidak dikirim.')
      }

      const terkirim = await whatsapp.sendDocument(tujuan, {
        buffer: isi.buffer,
        filename: isi.filename,
        mimetype: isi.mimeType,
      })

      return {
        ...dasar,
        sent: true,
        sentTo: tujuan,
        deliveryStatus: terkirim.status,
        message: `${dasar.message} Dikirim ke ${tujuan} (${terkirim.status}).`,
      }
    },
  }

  const list: ToolDefinition<{ template?: (typeof TEMPLAT_ENUM)[number]; limit?: number }, unknown> = {
    name: 'document_list',
    description:
      'Tampilkan daftar dokumen yang sudah pernah dibuat di organisasi ini, beserta nomornya. Pakai ini untuk mencari dokumen lama, bukan membuat ulang.',
    inputSchema: z
      .object({
        template: z.enum(TEMPLAT_ENUM).optional().describe('Saring jenis dokumen. Kosongkan untuk semua.'),
        limit: z.number().int().positive().max(50).optional().describe('Jumlah maksimal. Default 20.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.DOCUMENTS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const rows = await documents.list(organizationId, {
        ...(input.template ? { documentType: input.template } : {}),
        limit: input.limit ?? 20,
      })

      return {
        documents: rows.map((row) => ({
          documentId: row.id,
          title: row.title,
          template: row.documentType,
          templateLabel: DOCUMENT_TEMPLATES[row.documentType as DocumentTemplate]?.label ?? row.documentType,
          createdAt: row.createdAt.toISOString().slice(0, 10),
        })),
        message: `${rows.length} dokumen.`,
      }
    },
  }

  const send: ToolDefinition<{ documentId: string; to: string }, unknown> = {
    name: 'document_send',
    description:
      'Kirim dokumen yang sudah dibuat ke nomor tertentu. Memerlukan persetujuan pengguna karena berkas resmi yang dikirim ke nomor yang salah tidak bisa ditarik kembali.',
    inputSchema: z
      .object({
        documentId: z.string().uuid().describe('Id dokumen dari document_create atau document_list.'),
        to: z.string().max(30).describe('Nomor tujuan format 62...'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.DOCUMENTS_DISTRIBUTE],
    riskLevel: 'HIGH',
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const buffer = await documents.readBuffer(organizationId, input.documentId)
      if (!buffer) {
        throw new ToolError('NOT_FOUND', 'Dokumen tidak ditemukan di organisasi ini.')
      }

      const tujuan = normalizeNomor(input.to)
      const hasil = await whatsapp.sendDocument(tujuan, {
        buffer: buffer.buffer,
        filename: buffer.filename,
        mimetype: buffer.mimeType,
      })

      return {
        documentId: input.documentId,
        sentTo: tujuan,
        deliveryStatus: hasil.status,
        message: `Dokumen dikirim ke ${tujuan} (${hasil.status}).`,
      }
    },
  }

  const describeTemplates: ToolDefinition<Record<string, never>, unknown> = {
    name: 'document_templates',
    description:
      'Tampilkan daftar jenis dokumen yang bisa dibuat beserta isinya. Pakai ini kalau pengguna minta sesuatu yang tidak jelas apakah bisa dibuat.',
    inputSchema: z.object({}).strict() as never,
    requiredPermissions: [PERMISSIONS.DOCUMENTS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute() {
      return {
        templates: Object.entries(DOCUMENT_TEMPLATES).map(([key, meta]) => ({
          template: key,
          label: meta.label,
          description: DESKRIPSI_TEMPLAT[key as DocumentTemplate],
        })),
        message: `${Object.keys(DOCUMENT_TEMPLATES).length} jenis dokumen tersedia.`,
      }
    },
  }

  return [create, list, send, describeTemplates] as never
}

/** Ubah nomor bebas menjadi format WhatsApp. */
function normalizeNomor(input: string): string {
  const angka = input.replace(/[^0-9]/g, '')
  if (angka === '') throw new ToolError('VALIDATION_FAILED', 'Nomor tujuan tidak terbaca.')
  const lokal = angka.startsWith('0') ? `62${angka.slice(1)}` : angka.startsWith('62') ? angka : `62${angka}`
  return `${lokal}@s.whatsapp.net`
}

function requireOrg(context: ToolExecutionContext): string {
  const organizationId = context.organizationId
  if (!organizationId) {
    throw new ToolError('UNAUTHENTICATED', 'Organisasi belum terdeteksi untuk percakapan ini.')
  }
  return organizationId
}

/** Ubah DocumentError jadi ToolError yang bisa ditindaklanjuti model. */
export function mapDocumentError(error: unknown): ToolError {
  if (error instanceof DocumentError) {
    switch (error.code) {
      case 'MISSING_FIELD':
      case 'TEMPLATE_UNKNOWN':
        return new ToolError('VALIDATION_FAILED', error.message)
      case 'FONT_UNAVAILABLE':
        return new ToolError('PROVIDER_UNAVAILABLE', error.message)
      case 'RENDER_FAILED':
        return new ToolError('INTERNAL_ERROR', error.message)
    }
  }
  return new ToolError('INTERNAL_ERROR', 'Gagal memproses dokumen.')
}