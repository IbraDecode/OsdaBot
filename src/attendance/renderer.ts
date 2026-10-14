/**
 * Renderer daftar hadir WhatsApp.
 *
 * ── Masalah nyata yang harus diselesaikan ──────────────────────────────────
 * Anggota sering kirim daftar dalam format tertentu:
 *
 *     *LIST YANG HADIR LKBB, KAMIS, 15 OKTOBER 2026*
 *
 *     1. Ni Ketut Rianti (X MPK 1)
 *     2. Danya Sefti Cahyani (X AKL 3)
 *
 *     *IZIN*
 *     -
 *
 * Lalu permintaan: "ubah Ibra jadi izin karena ada meeting".
 *
 * Jawaban yang BENAR harus:
 *   - memakai ulang heading asli (bukan membuat ulang),
 *   - memindahkan/memperbarui baris yang dimaksud saja,
 *   - MENOMOR ULANG dengan benar (Ibra pindah ke bagian izin),
 *   - menambahkan alasan,
 *   - tidak mengubah anggota lain.
 *
 * Dua pemisahan penting:
 *   - `AttendanceEntry[]` = DATA (disimpan di DB, diubah lewat tool).
 *   - fungsi di file ini = PRESENTASI (tidak pernah mengubah DB).
 * Mengubah format tampilan TIDAK boleh mengubah data.
 */
import type { AttendanceEntry, AttendanceStatus } from '@prisma/client'

/** Template dengan placeholder `${...}` yang diganti data nyata. */
export interface AttendanceTemplate {
  /** Judul, mis. "*LIST YANG HADIR LKBB, KAMIS, 15 OKTOBER 2026*" */
  title: string
  /** Label tiap seksi status, mis. "IZIN" → "Izin". */
  sectionLabels: Partial<Record<AttendanceStatus, string>>
  /** Label untuk anggota yang belum ada statusnya. */
  defaultSectionLabel: string
  /** Urutan seksi saat render. */
  sectionOrder: AttendanceStatus[]
  /** Penanda bold WhatsApp: '*' atau '_' atau '' (tanpa). */
  boldMarker: string
  /** Template satu baris anggota: "${nomor}. ${nama} (${kelas})" */
  lineTemplate: string
  /** Template baris alasan: "${nama} (${kelas}) — ${alasan}" */
  reasonTemplate: string
  /** Teks yang dipakai saat seksi kosong. */
  emptyMarker: string
  /** Teks footer opsional (mis. "*Total: 3 orang*"). */
  footerTemplate: string | null
}

export const DEFAULT_TEMPLATE: AttendanceTemplate = {
  title: '*DAFTAR HADIR*',
  sectionLabels: {
    PRESENT: 'HADIR',
    EXCUSED: 'IZIN',
    SICK: 'SAKIT',
    ABSENT: 'ALPA',
    UNCONFIRMED: 'BELUM KONFIRMASI',
    PENDING: 'BELUM KONFIRMASI',
  },
  defaultSectionLabel: 'BELUM KONFIRMASI',
  sectionOrder: ['PRESENT', 'EXCUSED', 'SICK', 'ABSENT', 'UNCONFIRMED'],
  boldMarker: '*',
  lineTemplate: '${nomor}. ${nama}${kelas}',
  reasonTemplate: '${nama}${kelas} — ${alasan}',
  emptyMarker: '-',
  footerTemplate: null,
}

export interface RenderEntry {
  memberId: string | null
  displayName: string
  className: string | null
  status: AttendanceStatus
  reason: string | null
}

export interface RenderOptions {
  template?: Partial<AttendanceTemplate>
  /** Judul khusus untuk acara ini (bukan template title). */
  title?: string
  /** Tampilkan alasan di samping nama. Default true. */
  showReasons?: boolean
  /** Tampilkan kelas. Default true. */
  showClasses?: boolean
}

/** Ganti placeholder dalam template. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

/** Render daftar hadir dari data terstruktur ke teks WhatsApp. */
export function renderAttendanceList(entries: RenderEntry[], options: RenderOptions = {}): string {
  const template: AttendanceTemplate = { ...DEFAULT_TEMPLATE, ...options.template }
  const showReasons = options.showReasons ?? true
  const showClasses = options.showClasses ?? true

  const title = options.title ?? template.title
  const lines: string[] = [title, '']

  // Kelompokkan berdasarkan status, dengan urutan template.
  const groups = new Map<AttendanceStatus, RenderEntry[]>()
  for (const status of template.sectionOrder) groups.set(status, [])

  // Sortir stabil: sortOrder di-respecting lewat urutan masuk array.
  for (const entry of entries) {
    const bucket = groups.get(entry.status) ?? groups.get('UNCONFIRMED')!
    bucket.push(entry)
  }

  let nomor = 0

  for (const status of template.sectionOrder) {
    const bucket = groups.get(status)
    if (!bucket || bucket.length === 0) continue

    const label = template.sectionLabels[status] ?? template.defaultSectionLabel
    lines.push(`${template.boldMarker}${label}${template.boldMarker}`)

    if (status === 'PRESENT') {
      // Hanya status "hadir" yang biasanya bernomor (meniru daftar asli).
      for (const entry of bucket) {
        nomor += 1
        const kelas = showClasses && entry.className ? ` (${entry.className})` : ''
        const alasan = showReasons && entry.reason ? ` — ${entry.reason}` : ''
        lines.push(
          fill(template.lineTemplate, {
            nomor: String(nomor),
            nama: entry.displayName,
            kelas,
            alasan,
          }),
        )
      }
    } else {
      // Seksi non-hadir biasanya TIDAK bernomor di daftar sekolah Indonesia.
      // Kalau pengguna minta penomoran ulang di bagian ini, renderer tetap stabil
      // supaya format tidak berubah-ubah tanpa diminta.
      for (const entry of bucket) {
        const kelas = showClasses && entry.className ? ` (${entry.className})` : ''
        const alasan = showReasons && entry.reason ? entry.reason : ''
        const pattern = alasan ? template.reasonTemplate : template.lineTemplate.replace(/^\$\{nomor\}\.\s*/, '')
        lines.push(
          fill(pattern, {
            nomor: String(nomor + 1),
            nama: entry.displayName,
            kelas,
            alasan,
          }),
        )
      }
    }

    lines.push('')
  }

  // Kalau ada seksi kosong yang TIDAK ada di daftar, tambahkan penanda kosong.
  const totalEntries = entries.length
  if (totalEntries === 0) {
    return `${title}\n\n${template.emptyMarker}`
  }

  let result = lines.join('\n').replace(/\n{3,}$/g, '')

  if (template.footerTemplate) {
    result += `\n\n${fill(template.footerTemplate, { total: String(totalEntries) })}`
  }

  return result
}

/**
 * Render daftar KOSONG (seksi sudah ada tapi belum ada isinya).
 * Dipakai saat membuat kegiatan baru supaya format langsung konsisten.
 */
export function renderEmptyAttendanceList(
  title: string,
  options: RenderOptions = {},
): string {
  const template: AttendanceTemplate = { ...DEFAULT_TEMPLATE, ...options.template }
  return `${title}\n\n${template.boldMarker}${template.sectionLabels.PRESENT}${template.boldMarker}\n${template.emptyMarker}`
}

/**
 * Teks ringkasan singkat — untuk kasus "siapa yang izin?" tanpa format lengkap.
 */
export function renderStatusSummary(entries: RenderEntry[], options: RenderOptions = {}): string {
  const template: AttendanceTemplate = { ...DEFAULT_TEMPLATE, ...options.template }
  const byStatus = new Map<AttendanceStatus, RenderEntry[]>()
  for (const entry of entries) {
    const bucket = byStatus.get(entry.status) ?? []
    bucket.push(entry)
    byStatus.set(entry.status, bucket)
  }

  const bagians: string[] = []
  for (const status of template.sectionOrder) {
    const bucket = byStatus.get(status)
    if (!bucket || bucket.length === 0) continue
    const label = template.sectionLabels[status] ?? status
    bagians.push(`*${label}*`)
    for (const entry of bucket) {
      const kelas = options.showClasses !== false && entry.className ? ` — ${entry.className}` : ''
      const alasan = entry.reason ? ` — ${entry.reason}` : ''
      bagians.push(`• ${entry.displayName}${kelas}${alasan}`)
    }
    bagians.push('')
  }

  return bagians.join('\n').trim()
}

/**
 * Deteksi gaya penomoran & heading dari markdown yang diberikan pengguna.
 * Hasilnya disimpan di `formatHints` supaya renderer berikutnya konsisten.
 */
export function detectFormatHints(markdown: string): Partial<AttendanceTemplate> {
  const hints: Partial<AttendanceTemplate> = {}

  // Bold marker: cari pola _xxx_ di baris judul.
  const heading = markdown.split('\n').find((line) => line.trim().startsWith('*') || line.trim().startsWith('_'))
  if (heading) {
    const trimmed = heading.trim()
    if (trimmed.startsWith('_') && trimmed.endsWith('_')) hints.boldMarker = '_'
    else if (trimmed.startsWith('*') && trimmed.endsWith('*')) hints.boldMarker = '*'
  }

  // Baris kosong sebagai penanda seksi kosong: "|IZIN|\n|-"
  if (/^-\s*$/m.test(markdown)) hints.emptyMarker = '-'

  // Deteksi baris dengan pola "1. Nama (Kelas)".
  const numbered = /^\s*\d+[.)]\s+/m.test(markdown)
  const bulleted = /^\s*[•*-]\s+/m.test(markdown)
  if (numbered) {
    hints.lineTemplate = '${nomor}. ${nama}${kelas}${alasan}'
  } else if (bulleted) {
    hints.lineTemplate = '${nomor}. ${nama}${kelas}${alasan}'
  }

  return hints
}

/**
 * Ambil judul dari markdown, dipakai kembali saat me-render ulang.
 * Kalau tidak ada heading, pakai fallback.
 */
export function extractTitle(markdown: string, fallback = DEFAULT_TEMPLATE.title): string {
  const lines = markdown.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if ((trimmed.startsWith('*') && trimmed.endsWith('*')) || (trimmed.startsWith('_') && trimmed.endsWith('_'))) {
      return trimmed
    }
    // Baris pertama yang pendek & bukan daftar → anggap judul.
    if (trimmed.length <= 90 && !/^\s*\d+[.)]\s/.test(trimmed)) return trimmed
  }
  return fallback
}

/** Ubah entri Prisma menjadi bentuk render. */
export function toRenderEntries(
  entries: Array<Pick<AttendanceEntry, 'memberId' | 'displayName' | 'className' | 'status' | 'reason'>>,
): RenderEntry[] {
  return entries.map((entry) => ({
    memberId: entry.memberId,
    displayName: entry.displayName,
    className: entry.className,
    status: entry.status,
    reason: entry.reason,
  }))
}