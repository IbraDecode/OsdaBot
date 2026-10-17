/**
 * Tool organisasi & WhatsApp.
 *
 * Catatan keamanan untuk `whatsapp.send_message`:
 *  - pengiriman massal WAJIB lewat permission terpisah (`whatsapp.bulk_send`),
 *    bukan memakai izin kirim biasa;
 *  - `requiresApproval` untuk pengiriman ke grup, karena pengirim bisa menyalah-
 *    paham dan bot akan mengirim atas namanya;
 *  - hasil pengiriman dikembalikan apa adanya (termasuk status `unknown` yang
 *    berarti "tidak diketahui", bukan "gagal").
 */
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { canonicalizeName } from '../identity/name-normalizer.js'
import { PERMISSIONS } from '../security/permissions.js'
import { formatMention, parseJid } from '../whatsapp/jid.js'
import type { WhatsAppProvider } from '../whatsapp/types.js'
import { ToolError, type ToolDefinition, type ToolExecutionContext } from './types.js'

export interface OrganizationToolsDeps {
  prisma: PrismaClient
  whatsapp: WhatsAppProvider
}

// =============================================================================
// Organisasi
// =============================================================================

export function buildOrganizationTools(deps: OrganizationToolsDeps): Array<ToolDefinition<never, never>> {
  const { prisma, whatsapp } = deps

  const listMembers: ToolDefinition<{ search?: string; limit?: number; offset?: number }, unknown> = {
    name: 'organization_list_members',
    description:
      'Lihat daftar anggota organisasi, boleh disaring dengan pencarian nama. Gunakan saat pengguna menanyakan isi keanggotaan ataujumlah anggota.',
    inputSchema: z.object({
      search: z.string().max(120).optional().describe('Saring berdasarkan nama atau panggilan.'),
      limit: z.number().int().positive().max(200).optional().describe('Jumlah hasil. Default 50.'),
      offset: z.number().int().min(0).optional(),
    }) as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const search = input.search ? canonicalizeName(input.search) : null
      const take = input.limit ?? 50

      const members = await prisma.organizationMember.findMany({
        where: {
          organizationId,
          isActive: true,
          ...(search
            ? {
                OR: [
                  { searchName: { contains: search } },
                  { nickname: { contains: search, mode: 'insensitive' as const } },
                  { aliases: { some: { alias: { contains: search, mode: 'insensitive' as const } } } },
                ],
              }
            : {}),
        },
        orderBy: [{ fullName: 'asc' }],
        skip: input.offset ?? 0,
        take,
        select: {
          id: true,
          fullName: true,
          className: true,
          nickname: true,
          aliases: { select: { alias: true } },
          // Identitas WhatsApp ikut diambil supaya "kirim tagihan ke Budi"
          // bisa dijawab tanpa menebak nomornya.
          //
          // Hanya yang **terverifikasi** yang diambil: mention otomatis ke
          // orang yang belum membuktikan nomornya adalah kesalahan yang tidak
          // bisa ditarik kembali.
          identityLinks: {
            where: { verifiedAt: { not: null } },
            select: { identity: { select: { id: true, pnJid: true, lidJid: true } } },
            take: 1,
          },
        },
      })

      const total = await prisma.organizationMember.count({ where: { organizationId, isActive: true } })

      return {
        total,
        returned: members.length,
        members: members.map((member) => {
          const identitas = member.identityLinks[0]?.identity ?? null
          return {
            memberId: member.id,
            name: member.fullName,
            class: member.className,
            nickname: member.nickname,
            aliases: member.aliases.map((alias) => alias.alias),
            whatsappVerified: Boolean(identitas),
            // Hanya diisi kalau tautannya terverifikasi. `null` berarti "tidak
            // tahu" — bukan berarti nomornya tidak ada.
            whatsappJid: identitas?.pnJid ?? identitas?.lidJid ?? null,
          }
        }),
      }
    },
  }

  /**
   * Cari satu anggota secara presisi.
   *
   * Mengembalikan objek, bukan pesan — pemanggil butuh membedakan "tidak ada"
   * dari "ambigu", dan keduanya harus ditolak dengan alasan berbeda.
   */
  async function cariSatuAnggota(
    organizationId: string,
    memberId: string | undefined,
    nama: string | undefined,
  ): Promise<
    | { anggota: null; ambigu: false; kandidat: Array<{ id: string; fullName: string; className: string | null }> }
    | { anggota: { id: string; fullName: string; className: string | null; nickname: string | null; isActive: boolean }; ambigu: false; kandidat: [] }
    | { anggota: null; ambigu: true; kandidat: Array<{ id: string; fullName: string; className: string | null }> }
  > {
    if (memberId) {
      const anggota = await prisma.organizationMember.findFirst({
        where: { id: memberId, organizationId },
        select: { id: true, fullName: true, className: true, nickname: true, isActive: true },
      })
      if (anggota) return { anggota, ambigu: false, kandidat: [] }
      return { anggota: null, ambigu: false, kandidat: [] }
    }

    if (!nama) return { anggota: null, ambigu: false, kandidat: [] }

    const query = canonicalizeName(nama)
    const kandidat = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        OR: [
          { searchName: { contains: query } },
          { searchName: { contains: query.split(' ')[0] ?? query } },
          { nickname: { contains: nama, mode: 'insensitive' } },
          { aliases: { some: { alias: { contains: query } } } },
        ],
      },
      take: 6,
      select: { id: true, fullName: true, className: true, nickname: true, isActive: true },
    })

    // Hanya anggota aktif yang bisa jadi target perubahan data — kalau tidak,
    // "ubah data Budi" bisa diam-diam menghidupkan kembali anggota yang sudah
    // dinonaktifkan.
    const aktif = kandidat.filter((k) => k.isActive)

    if (aktif.length === 1) return { anggota: aktif[0]!, ambigu: false, kandidat: [] }
    if (aktif.length > 1) {
      return {
        anggota: null,
        ambigu: true,
        kandidat: kandidat.map((k) => ({ id: k.id, fullName: k.fullName, className: k.className })),
      }
    }
    return {
      anggota: null,
      ambigu: false,
      kandidat: kandidat.map((k) => ({ id: k.id, fullName: k.fullName, className: k.className })),
    }
  }

  /** Pesan error yang bisa langsung ditampilkan ke pengguna. */
  function pesanAmbiguitas(candidates: Array<{ id: string; fullName: string; className: string | null }>): string {
    return (
      `Ada lebih dari satu anggota yang cocok (${candidates.length} orang): ` +
      candidates.map((c) => `${c.fullName}${c.className ? ` (${c.className})` : ''}`).join(', ') +
      '. Tanya pengguna yang mana yang dimaksud — jangan menebak.'
    )
  }

  const searchMember: ToolDefinition<{ query: string }, unknown> = {
    name: 'organization_search_members',
    description:
      'Cari anggota berdasarkan nama atau panggilan. WAJIB dipakai sebelum mengubah data yang menyebut nama orang, supaya tidak salah orang. Kalau hasilnya lebih dari satu, wajib minta klarifikasi ke pengguna.',
    inputSchema: z.object({
      query: z.string().min(1).max(120).describe('Nama atau panggilan anggota yang dicari.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const query = canonicalizeName(input.query)

      const members = await prisma.organizationMember.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { searchName: { contains: query } },
            { searchName: { contains: query.split(' ')[0] ?? query } },
            { nickname: { contains: input.query, mode: 'insensitive' } },
            { aliases: { some: { alias: { contains: input.query, mode: 'insensitive' } } } },
          ],
        },
        take: 25,
        select: {
          id: true,
          fullName: true,
          className: true,
          nickname: true,
          aliases: { select: { alias: true } },
          identityLinks: {
            where: { verifiedAt: { not: null } },
            select: { identity: { select: { pnJid: true, lidJid: true } } },
          },
        },
      })

      if (members.length === 0) {
        return {
          status: 'not_found',
          query: input.query,
          message: `Anggota "${input.query}" tidak ada di daftar organisasi ini. Jangan mengarang — tanyakan nama yang tepat.`,
        }
      }

      // Cocokkan persis dengan nama/panggilan/alias supaya bisa menilai ambiguitas.
      const exact = members.filter((member) => {
        const kandidat = [member.fullName, member.nickname ?? '', ...member.aliases.map((a) => a.alias)]
        return kandidat.some((value) => value && canonicalizeName(value) === query)
      })

      const toCandidate = (member: (typeof members)[number]) => ({
        memberId: member.id,
        name: member.fullName,
        class: member.className,
        whatsappVerified: member.identityLinks.length > 0,
      })

      if (exact.length === 1 && exact[0]) {
        return { status: 'unique', ...toCandidate(exact[0]) }
      }

      if (exact.length > 1) {
        return {
          status: 'ambiguous',
          candidates: exact.map(toCandidate),
          message: `Ada ${exact.length} anggota yang cocok. Minta pengguna pilih — jangan menebak.`,
        }
      }

      // Tidak ada yang persis → kembali daftar kandidat terdekat.
      return {
        status: 'multiple_candidates',
        candidates: members.slice(0, 8).map(toCandidate),
        message: `Tidak ada yang persis cocok dengan "${input.query}". Yang paling mirip — tanyakan ke pengguna.`,
      }
    },
  }

  const createMember: ToolDefinition<{ fullName: string; className?: string | null; aliases?: string[] }, unknown> = {
    name: 'organization_create_member',
    description:
      'Tambahkan anggota baru ke master anggota organisasi. Gunakan saat pengguna mengirim daftar nama (mis. "masukin daftar ini jadi anggota LKBB") atau menambah orang baru. Data anggota TIDAK otomatis terhubung ke nomor WhatsApp — itu perlu verifikasi terpisah.',
    inputSchema: z.object({
      fullName: z.string().min(2).max(160).describe('Nama lengkap anggota.'),
      className: z.string().max(60).nullish().describe('Kelas / rombongan, mis. "X AKL 3".'),
      aliases: z.array(z.string().min(1).max(80)).max(10).optional().describe('Nama panggilan tambahan.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_CREATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      // Cek duplikat nama persis agar tidak menambah dua orang dengan nama sama
      // tanpa sadar (menyembunyikan baris 'cadangan' pun dibuat diam-diam).
      const searchName = canonicalizeName(input.fullName)
      const existing = await prisma.organizationMember.findMany({
        where: { organizationId, isActive: true, searchName },
        select: { id: true, fullName: true, className: true },
      })

      const created = await prisma.organizationMember.create({
        data: {
          organizationId,
          fullName: input.fullName.trim(),
          className: input.className?.trim() ?? null,
          searchName,
          aliases: {
            create: (input.aliases ?? []).map((alias) => ({ alias: canonicalizeName(alias) })),
          },
        },
        select: { id: true, fullName: true, className: true },
      })

      return {
        memberId: created.id,
        name: created.fullName,
        class: created.className,
        possibleDuplicates: existing.map((member) => ({ name: member.fullName, class: member.className })),
        warning:
          existing.length > 0
            ? `Perhatian: sudah ada anggota bernama "${input.fullName}" di organisasi ini. Kalau ini orang yang sama, bilang saja supaya tidak jadi dua data.`
            : undefined,
        message: `${created.fullName} sudah ditambahkan. Nomor WhatsApp-nya belum terhubung — itu perlu verifikasi manual.`,
      }
    },
  }

  /**
   * Ubah data anggota yang sudah ada.
   *
   * ── Kenapa tool ini perlu ─────────────────────────────────────────────────
   *
   * Izin `members.update` ada di katalog sejak awal, tapi tidak ada tool yang
   * memakainya. Akibatnya permintaan "ganti nama saya jadi Ibra Ramdan" dijawab
   * "fitur edit belum tersedia" — dan itu benar secara harfiah: memang tidak
   * ada jalannya. Satu-satunya jalan adalah menambah anggota baru, yang
   * menghasilkan **dua** orang dengan nama berbeda untuk orang yang sama.
   */
  const updateMember: ToolDefinition<
    {
      memberId?: string
      memberName?: string
      fullName?: string
      className?: string | null
      nickname?: string | null
      addAliases?: string[]
    },
    unknown
  > = {
    name: 'organization_update_member',
    description:
      'Ubah data anggota yang SUDAH ADA: nama, kelas, nama panggilan, alias. ' +
      'Pakai saat pengguna ingin memperbaiki atau mengganti data yang salah — ' +
      'mis. "ganti nama saya", "kelasnya X TKJ 3", "panggilannya Ibra". ' +
      'Jangan pakai untuk menambah orang baru; itu `organization_create_member`. ' +
      'Cari dulu dengan `organization_search_members`; kalau lebih dari satu cocok, wajib minta klarifikasi.',
    inputSchema: z
      .object({
        memberId: z.string().uuid().optional().describe('ID anggota — paling presisi. Ambil dari organization_list_members.'),
        memberName: z.string().min(2).max(160).optional().describe('Nama anggota yang mau diubah, kalau memberId tidak diketahui.'),
        fullName: z.string().min(2).max(160).optional().describe('Nama baru. Kosongkan kalau hanya kelas yang diubah.'),
        className: z.string().max(60).nullable().optional().describe('Kelas / rombongan baru. `null` menghapus kelas.'),
        nickname: z.string().max(80).nullable().optional().describe('Nama panggilan baru. `null` menghapus.'),
        addAliases: z.array(z.string().min(1).max(80)).max(10).optional().describe('Alias tambahan yang belum ada.'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_UPDATE],
    riskLevel: 'MEDIUM',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const ditemukan = await cariSatuAnggota(organizationId, input.memberId, input.memberName)
      if (ditemukan.ambigu) {
        throw new ToolError('VALIDATION_FAILED', pesanAmbiguitas(ditemukan.kandidat))
      }
      const anggota = ditemukan.anggota
      if (!anggota) {
        throw new ToolError(
          'NOT_FOUND',
          `Anggota "${input.memberName ?? ''}" tidak ditemukan di organisasi ini. ` +
            'Periksa dengan organization_search_members.',
        )
      }

      const namaBaru = input.fullName?.trim() ?? anggota.fullName
      const kelasBaru = input.className !== undefined ? (input.className?.trim() ?? null) : anggota.className
      const panggilanBaru = input.nickname !== undefined ? (input.nickname?.trim() ?? null) : anggota.nickname

      const adaPerubahan =
        namaBaru !== anggota.fullName || kelasBaru !== anggota.className || panggilanBaru !== anggota.nickname

      if (!adaPerubahan && !input.addAliases?.length) {
        throw new ToolError(
          'VALIDATION_FAILED',
          `Tidak ada yang perlu diubah. Data ${anggota.fullName} sudah: ` +
            `kelas "${anggota.className ?? 'kosong'}", panggilan "${anggota.nickname ?? 'kosong'}". ` +
            'Kalau maksudnya menambah orang baru, pakai organization_create_member.',
        )
      }

      // `searchName` ditulis ulang supaya pencarian nama lama tidak lagi
      // menemukan orang ini — kalau tidak, "cari Ibra" akan mengembalikan dua
      // anggota setelah penggantian nama.
      await prisma.organizationMember.update({
        where: { id: anggota.id },
        data: {
          fullName: namaBaru,
          searchName: canonicalizeName(namaBaru),
          ...(kelasBaru !== anggota.className ? { className: kelasBaru } : {}),
          ...(panggilanBaru !== anggota.nickname ? { nickname: panggilanBaru } : {}),
        },
      })

      const aliasTambah: string[] = []
      for (const alias of input.addAliases ?? []) {
        const dinormalkan = canonicalizeName(alias)
        if (!dinormalkan || dinormalkan === canonicalizeName(namaBaru)) continue
        const sudah = await prisma.memberAlias.findFirst({
          where: { memberId: anggota.id, alias: dinormalkan },
          select: { id: true },
        })
        if (!sudah) {
          await prisma.memberAlias.create({ data: { memberId: anggota.id, alias: dinormalkan } })
          aliasTambah.push(alias)
        }
      }

      return {
        memberId: anggota.id,
        name: namaBaru,
        class: kelasBaru,
        nickname: panggilanBaru,
        // Rincian perubahan, supaya bot bisa memberi tahu apa yang benar-benar
        // berubah — bukan sekadar "sudah diubah" yang tidak bisa diperiksa.
        changes: {
          name: namaBaru !== anggota.fullName ? { from: anggota.fullName, to: namaBaru } : null,
          class: kelasBaru !== anggota.className ? { from: anggota.className, to: kelasBaru } : null,
          nickname: panggilanBaru !== anggota.nickname ? { from: anggota.nickname, to: panggilanBaru } : null,
          aliasesAdded: aliasTambah,
        },
        message: `Data ${namaBaru} sudah diperbarui.`,
      }
    },
  }

  /**
   * Ubah nama tampilan orang yang sedang bicara.
   *
   * Terpisah dari `organization_update_member` karena ini untuk **diri sendiri**.
   * "Siapa saya?" adalah pertanyaan yang paling sering muncul, dan jawaban
   * "nama asli kamu belum saya tahu" terasa seperti kegagalan total.
   *
   * Tidak butuh persetujuan, dan tidak menyentuh anggota mana pun: orang hanya
   * mengubah nama yang dipanggil untuk dirinya sendiri.
   */
  const updateSelf: ToolDefinition<{ displayName?: string }, unknown> = {
    name: 'organization_update_self',
    description:
      'Ubah nama tampilan orang yang sedang chat — nama yang dipakai untuk menyapa dia. ' +
      'Pakai saat pengguna berkata "nama saya ...", "panggil saya ...", atau "kenapa nama saya Admin?". ' +
      'Ini HANYA mengubah nama tampilan, bukan data anggota. Untuk mengubah nama anggota di daftar, pakai organization_update_member.',
    inputSchema: z
      .object({
        displayName: z.string().min(2).max(80).describe('Nama yang ingin dipakai dari sekarang.'),
      })
      .strict() as never,
    /**
     * `members.update`, bukan tanpa izin.
     *
     * Awalnya `[]` —.NODEBUAT dengan alasan "mengubah nama sendiri seharusnya
     * tanpa izin". Tapi
     * nama tampilan itu bagian dari data organisasi —(organisasi yang memiliki
     * dan menampilkan), dan bot punya invarian yang bisa diuji: aktor tanpa izin
     * apa pun tidak boleh menerima satu pun tool. Tool tanpa izin membuat
     * invarian itu mati tanpa disadari.
     *
     * Praktisnya tidak mengunci apa pun: yang mengubah namanya adalah admin
     * dan anggota yang memang sudah berizin.
     */
    requiredPermissions: [PERMISSIONS.MEMBERS_UPDATE],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      if (!context.actorUserId) {
        throw new ToolError('PERMISSION_DENIED', 'Tidak tahu kamu siapa. Masuk dari WhatsApp dulu ya.')
      }

      const namaBaru = input.displayName!.trim()

      // Baca DULU, baru tulis.
      //
      // `update()` mengembalikan nilai SETELAH perubahan, jadi kalau nama lama
      // diambil dari sana, `previousDisplayName` selalu `null`. Bot
      // tidak pernah bisa bilang "namamu berubah dari X jadi Y".
      const sebelum = await prisma.user.findUnique({
        where: { id: context.actorUserId },
        select: { displayName: true },
      })

      await prisma.user.update({
        where: { id: context.actorUserId },
        data: { displayName: namaBaru },
        select: { displayName: true },
      })

      const berubah = sebelum?.displayName !== namaBaru

      // Nama di daftar anggota tidak ikut berubah — itu data organisasi dan
      // butuh `members.update`. Doisnya sengaja dipisahkan supaya mengubah
      // nama panggilan tidak diam-diam mengubah master data.
      return {
        displayName: namaBaru,
        previousDisplayName: berubah ? (sebelum?.displayName ?? null) : null,
        affectsMemberRecord: false,
        message: berubah
          ? `Nama kamu sekarang ${namaBaru}. Data di daftar anggota tidak ikut berubah — itu terpisah.`
          : `Nama kamu sudah ${namaBaru}.`,
      }
    },
  }

  /**
   * Nonaktifkan anggota (pensiun, keluar, atau data salah).
   *
   * ── Kenapa soft delete, bukan hapus ────────────────────────────────────────
   *
   * Baris anggota dirujuk tagihan, absensi, dan tugas. Menghapusnya berarti
   * mencabut riwayat kas dan kehadiran orang itu dari organisasi — sesuatu yang
   * tidak bisa ditarik kembali dan tidak boleh terjadi karena salah ketik satu
   * pesan.
   *
   * Jadi anggota ditandai tidak aktif dengan `leftAt` dicatat. Namanya masih
   * bisa dicari (riwayat tetap utuh), tapi tidak muncul lagi di daftar dan tidak
   * bisa dipilih untuk pencatatan baru.
   *
   * Butuh persetujuan: dampaknya terlihat oleh orang lain, dan salah target orang
   * adalah kesalahan yang tidak bisa dibatalkan dengan "iya" lagi.
   */
  const deactivateMember: ToolDefinition<
    { memberId?: string; memberName?: string; reason?: string },
    unknown
  > = {
    name: 'organization_deactivate_member',
    description:
      'Nonaktifkan anggota supaya tidak muncul lagi di daftar dan tidak bisa dipilih untuk pencatatan baru. ' +
      'Riwayat tagihan, absensi, dan tugasnya TETAP ADA. ' +
      'Pakai saat pengguna bilang "hapus anggota", "pensiunkan", "keluarkan", atau "data ini salah". ' +
      'Kalau hanya salah ketik, lebih baik organization_update_member.',
    inputSchema: z
      .object({
        memberId: z.string().uuid().optional().describe('ID anggota — paling presisi.'),
        memberName: z.string().min(2).max(160).optional().describe('Nama anggota yang mau dinonaktifkan.'),
        reason: z.string().max(160).optional().describe('Alasan singkat, mis. "pensiun" atau "bukan anggota OSIS".'),
      })
      .strict() as never,
    requiredPermissions: [PERMISSIONS.MEMBERS_DELETE],
    riskLevel: 'HIGH',
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)

      const ditemukan = await cariSatuAnggota(organizationId, input.memberId, input.memberName)
      if (ditemukan.ambigu) {
        throw new ToolError('VALIDATION_FAILED', pesanAmbiguitas(ditemukan.kandidat))
      }
      const anggota = ditemukan.anggota
      if (!anggota) {
        throw new ToolError(
          'NOT_FOUND',
          `Anggota "${input.memberName ?? ''}" tidak ditemukan di organisasi ini. ` +
            'Kalau memang tidak ada, tidak ada yang perlu dinonaktifkan.',
        )
      }

      if (!anggota.isActive) {
        return {
          memberId: anggota.id,
          name: anggota.fullName,
          alreadyInactive: true,
          historyPreserved: true,
          message:
            `${anggota.fullName} sudah tidak aktif sebelumnya. Tidak ada yang berubah — ` +
            'riwayat tagihan, absensi, dan tugasnya tetap tersimpan.',
        }
      }

      await prisma.organizationMember.update({
        where: { id: anggota.id },
        data: { isActive: false, leftAt: new Date() },
      })

      return {
        memberId: anggota.id,
        name: anggota.fullName,
        class: anggota.className,
        reason: input.reason ?? null,
        // Dinyatakan eksplisit: data historis TIDAK hilang. Bot yang melaporkan
        // "dihapus" tanpa ini akan membuat pengguna mengira tagihannya ikut hilang.
        historyPreserved: true,
        message:
          `${anggota.fullName} sudah dinonaktifkan dan tidak muncul lagi di daftar. ` +
          'Riwayat tagihan, absensi, dan tugasnya tetap tersimpan.',
      }
    },
  }

  const getRoles: ToolDefinition<Record<string, never>, unknown> = {
    name: 'organization_get_roles',
    description: 'Lihat daftar peran dalam organisasi beserta izinnya. Gunakan saat ada pertanyaan soal siapa boleh melakukan apa.',
    inputSchema: z.object({}) as never,
    requiredPermissions: [PERMISSIONS.ROLES_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(_input, context) {
      const organizationId = requireOrg(context)
      const roles = await prisma.organizationRole.findMany({
        where: { organizationId },
        orderBy: { key: 'asc' },
        select: {
          key: true,
          name: true,
          description: true,
          permissions: { select: { permissionId: true } },
          _count: { select: { memberBindings: true } },
        },
      })

      return {
        roles: roles.map((role) => ({
          key: role.key,
          name: role.name,
          description: role.description,
          memberCount: role._count.memberBindings,
          permissions: role.permissions.map((permission) => permission.permissionId),
        })),
      }
    },
  }

  const getEvents: ToolDefinition<{ limit?: number }, unknown> = {
    name: 'organization_get_events',
    description: 'Lihat kegiatan yang sudah tercatat di organisasi beserta tanggalnya.',
    inputSchema: z.object({ limit: z.number().int().positive().max(50).optional() }) as never,
    requiredPermissions: [PERMISSIONS.EVENTS_READ],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const events = await prisma.event.findMany({
        where: { organizationId },
        orderBy: { startsAt: 'desc' },
        take: input.limit ?? 20,
        select: { id: true, title: true, startsAt: true, endsAt: true, location: true, status: true },
      })
      return {
        events: events.map((event) => ({
          eventId: event.id,
          title: event.title,
          startsAt: event.startsAt?.toISOString() ?? null,
          endsAt: event.endsAt?.toISOString() ?? null,
          location: event.location,
          status: event.status,
        })),
      }
    },
  }

  // =============================================================================
  // WhatsApp
  // =============================================================================

  const sendMessage: ToolDefinition<
    { to?: string; text: string; quoteMessageId?: string | null; mentionMemberIds?: string[] },
    unknown
  > = {
    name: 'whatsapp_send_message',
    description:
      'Kirim pesan teks WhatsApp. TUJUAN WAJIB diisi eksplisit — kalau tidak, pakai chat tempat perintah datang. Untuk mengirim ke grup, tanyakan dulu ke pengguna karena pesan yang terkirim tidak bisa ditarik kembali.',
    inputSchema: z.object({
      to: z
        .string()
        .optional()
        .describe('JID tujuan (mis. 628123@s.whatsapp.net atau 123-456@g.us). Kosongkan untuk chat aktif.'),
      text: z.string().min(1).max(4000).describe('Isi pesan.'),
      quoteMessageId: z.string().max(128).nullish().describe('Balas pesan tertentu.'),
      mentionMemberIds: z
        .array(z.string().uuid())
        .max(50)
        .optional()
        .describe('ID anggota yang perlu di-mention. Hanya yang nomornya sudah terverifikasi.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'MEDIUM',
    // Selalu perlu persetujuan: pesan yang terkirim tidak bisa ditarik, dan
    // penerima bisa salah orang. Untuk pesan biasa di chat sendiri pun masih
    // dicek di registry lewat `approvalPolicy`.
    requiresApproval: true,
    async execute(input, context) {
      const organizationId = requireOrg(context)
      const target = input.to?.trim() || context.chatJid

      const parsed = parseJid(target)
      if (!parsed) throw new ToolError('VALIDATION_FAILED', `JID tujuan tidak valid: ${target}`)

      // Resolusi mention HANYA dari identitas yang sudah terverifikasi.
      const mentions: string[] = []
      const skippedMentions: Array<{ memberId: string; name: string; reason: string }> = []

      for (const memberId of input.mentionMemberIds ?? []) {
        const link = await prisma.memberIdentityLink.findFirst({
          where: {
            memberId,
            organizationId,
            verifiedAt: { not: null },
            identity: { OR: [{ pnJid: { not: null } }, { lidJid: { not: null } }] },
          },
          select: {
            identity: { select: { pnJid: true, lidJid: true } },
            member: { select: { fullName: true } },
          },
        })

        const jid = link?.identity.pnJid ?? link?.identity.lidJid
        if (jid) {
          mentions.push(jid)
        } else {
          skippedMentions.push({
            memberId,
            name: link?.member.fullName ?? memberId,
            reason: 'Nomor WhatsApp belum terverifikasi',
          })
        }
      }

      if ((input.mentionMemberIds?.length ?? 0) > 0 && !mentions.length) {
        throw new ToolError(
          'PERMISSION_DENIED',
          'Tidak ada anggota yang bisa di-mention karena nomor WhatsApp-nya belum terverifikasi. Jangan mengarang nomor.',
        )
      }

      const body = mentions.length > 0 ? `${input.text}\n\n${mentions.map(formatMention).join(' ')}` : input.text

      const result = await whatsapp.sendText(target, body, {
        targetJid: target,
        ...(input.quoteMessageId ? { quotedMessageId: input.quoteMessageId } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
        idempotencyKey: `tool:${organizationId}:${context.correlationId}:${target}`,
      })

      // Status jujur: `provider_accepted` BUKAN "sudah dibaca".
      return {
        to: target,
        providerMessageId: result.providerMessageId,
        status: result.status,
        mentioned: mentions.length,
        skippedMentions,
        message: deliveryMessage(result.status, target),
      }
    },
  }

  const reactMessage: ToolDefinition<{ messageId: string; emoji: string }, unknown> = {
    name: 'whatsapp_react_message',
    description: 'Beri reaksi pada sebuah pesan (mis. centang saat tugas selesai). Emoji kosong menghapus reaksi.',
    inputSchema: z.object({
      messageId: z.string().min(1).max(128),
      emoji: z.string().max(8).describe('Emoji reaksi. String kosong untuk menghapus.'),
    }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const result = await whatsapp.reactToMessage(context.chatJid, input.messageId, input.emoji)
      if (result.status === 'failed') {
        throw new ToolError('PROVIDER_UNAVAILABLE', 'Reaksi gagal dikirim.', true)
      }
      return { ok: true, status: result.status }
    },
  }

  const getGroupMembers: ToolDefinition<Record<string, never>, unknown> = {
    name: 'whatsapp_get_group_members',
    description:
      'Ambil daftar anggota grup WhatsApp. Hanya untuk memastikan keanggotaan grup — BUKAN untuk menilai siapa yang berwenang dalam organisasi.',
    inputSchema: z.object({}) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(_input, context) {
      const parsed = parseJid(context.chatJid)
      if (parsed?.kind !== 'group') {
        throw new ToolError('VALIDATION_FAILED', 'Perintah ini hanya bisa dijalankan di dalam grup.')
      }

      const metadata = await whatsapp.getGroupMetadata(context.chatJid)
      if (!metadata) throw new ToolError('PROVIDER_UNAVAILABLE', 'Metadata grup tidak bisa diambil.', true)

      return {
        groupJid: metadata.jid,
        subject: metadata.subject,
        participantCount: metadata.participantCount,
        participants: metadata.participants.map((participant) => ({
          jid: participant.jid,
          isGroupAdmin: participant.isAdmin,
        })),
        note: 'Status admin di grup WhatsApp BUKAN berarti hak administrasi dalam organisasi.',
      }
    },
  }

  const getGroupMetadata: ToolDefinition<{ groupJid?: string }, unknown> = {
    name: 'whatsapp_get_group_metadata',
    description: 'Ambil metadata grup (nama, jumlah anggota). Berguna untuk mengenali grup yang belum tertaut ke organisasi.',
    inputSchema: z.object({ groupJid: z.string().optional() }) as never,
    requiredPermissions: [PERMISSIONS.WHATSAPP_SEND],
    riskLevel: 'LOW',
    requiresApproval: false,
    async execute(input, context) {
      const jid = input.groupJid ?? context.chatJid
      const metadata = await whatsapp.getGroupMetadata(jid)
      if (!metadata) throw new ToolError('NOT_FOUND', 'Grup tidak ditemukan atau tidak bisa diakses.')

      const linked = await prisma.group.findUnique({
        where: { jid: metadata.jid },
        select: { organizationId: true, purpose: true, activation: true },
      })

      return {
        groupJid: metadata.jid,
        subject: metadata.subject,
        description: metadata.description,
        participantCount: metadata.participantCount,
        linkedOrganizationId: linked?.organizationId ?? null,
        purpose: linked?.purpose ?? null,
        activation: linked?.activation ?? null,
      }
    },
  }

  return [
    listMembers,
    searchMember,
    createMember,
    updateMember,
    updateSelf,
    deactivateMember,
    getRoles,
    getEvents,
    sendMessage,
    reactMessage,
    getGroupMembers,
    getGroupMetadata,
  ] as never
}

// =============================================================================
// Helper
// =============================================================================

function requireOrg(context: ToolExecutionContext): string {
  if (!context.organizationId) {
    throw new ToolError('PERMISSION_DENIED', 'Organisasi belum ditentukan untuk percakapan ini.')
  }
  return context.organizationId
}

/** Pesan jujur tentang hasil pengiriman. */
export function deliveryMessage(status: string, target: string): string {
  switch (status) {
    case 'provider_accepted':
      return 'Pesan sudah diserahkan ke WhatsApp (belum tentu sudah dibaca).'
    case 'delivered':
      return 'Pesan sudah sampai.'
    case 'unknown':
      return 'Status pengiriman belum diketahui. Jangan menganggap gagal, tapi jangan juga menganggap terkirim.'
    case 'failed':
      return `Pesan gagal dikirim ke ${target}.`
    default:
      return 'Pengiriman sedang diproses.'
  }
}