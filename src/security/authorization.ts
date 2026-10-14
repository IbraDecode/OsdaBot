/**
 * AuthorizationService — satu-satunya pintu cek izin.
 *
 * Prinsip yang ditegakkan file ini:
 *
 * 1. IDENTITAS AKTOR SELALU DARI BACKEND, BUKAN DARI ARGUMEN MODEL AI.
 *    `actorId` pada tool call yang dibuat AI tidak pernah dipercaya begitu saja;
 *    ia harus sama dengan konteks yang sudah diverifikasi.
 *
 * 2. DEFAULT-DENY. Permission yang tidak ada di daftar = TIDAK BOLEH.
 *
 * 3. SCOPE ORGANISASI WAJIB DIJAGA. Actor yang punya izin di OSIS tidak
 *    otomatis punya izin di LKBB, meskipun orangnya sama.
 *
 * 4. Aktor yang belum terhubung ke organisasi apa pun hanya boleh membaca
 *    kemampuannya sendiri — tidak boleh menyentuh data organisasi.
 */
import { prisma } from '../database/client.js'
import { logger } from '../observability/logger.js'
import { ALL_PERMISSIONS, type Permission } from './permissions.js'
import type { AuthorizationServiceDeps } from './authorization.types.js'

export interface AuthorizationRequest {
  /** UUID user internal — dari konteks terverifikasi. */
  actorId: string
  /** UUID organisasi — dari konteks terverifikasi. */
  organizationId: string
  permission: Permission
  /** Sumber daya spesifik, bila izinnyadepends pada resource. */
  resourceType?: string
  resourceId?: string
}

export type AuthorizationReason =
  | 'ALLOWED'
  | 'UNAUTHENTICATED'
  | 'MEMBERSHIP_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_SCOPE_MISMATCH'
  | 'APPROVAL_REQUIRED'

export interface AuthorizationDecision {
  allowed: boolean
  reason: AuthorizationReason
  /** Penjelasan ramah untuk ditampilkan ke pengguna (bukan stack trace). */
  message: string
}

const deny = (reason: AuthorizationReason, message: string): AuthorizationDecision => ({
  allowed: false,
  reason,
  message,
})

const allow = (): AuthorizationDecision => ({
  allowed: true,
  reason: 'ALLOWED',
  message: 'Diizinkan',
})

export class AuthorizationService {
  /**
   * Cache permission per aktor+organisasi.
   * invalidated setiap kali role berubah.
   */
  private readonly cache = new Map<string, { permissions: Set<string>; expiresAt: number }>()
  private readonly cacheTtlMs: number

  constructor(
    private readonly deps: AuthorizationServiceDeps = {
      prisma,
      logger: logger.child({ module: 'authorization' }),
      cacheTtlMs: 30_000,
    },
  ) {
    this.cacheTtlMs = deps.cacheTtlMs ?? 30_000
  }

  private get prisma() {
    return this.deps.prisma
  }

  private get log() {
    return this.deps.logger
  }

  /** Kunci cache: aktor + organisasi. */
  private cacheKey(actorId: string, organizationId: string): string {
    return `${actorId}:${organizationId}`
  }

  /**
   * Ambil seluruh permission aktor di satu organisasi.
   *
   * Sumber kebenaran:
   *   OrganizationMember (aktif) -> MemberRoleBinding -> OrganizationRole
   *   -> RolePermission -> Permission
   *
   * Kalau anggota tidak ada / nonaktif / belum punya role → kosong (default-deny).
   */
  async permissionsFor(actorId: string, organizationId: string): Promise<Set<string>> {
    const key = this.cacheKey(actorId, organizationId)
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.permissions

    try {
      const rows = await this.prisma.rolePermission.findMany({
        where: {
          role: {
            organizationId,
            memberBindings: {
              some: { member: { userId: actorId, isActive: true } },
            },
          },
        },
        select: { permissionId: true },
      })

      // Role OWNER punya '*' yang di-expand ke daftar lengkap saat seed.
      // Kalau untuk alasan apa pun '*' masih ada di DB, perlakukan sebagai full.
      const permissions = new Set(rows.map((row) => row.permissionId))
      if (permissions.has('*')) {
        for (const permission of ALL_PERMISSIONS) permissions.add(permission)
        permissions.delete('*')
      }

      const entry = { permissions, expiresAt: Date.now() + this.cacheTtlMs }
      this.cache.set(key, entry)
      return permissions
    } catch (error) {
      this.log.error({ err: error, actorId, organizationId }, 'gagal memuat permission aktor')
      // Fail CLOSED. Kalau tidak bisa memastikan, tolak.
      return new Set()
    }
  }

  /** Pemeriksaan izin inti. */
  async check(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const { actorId, organizationId, permission, resourceType, resourceId } = request

    if (!actorId || !organizationId) {
      return deny('UNAUTHENTICATED', 'Aktor atau organisasi belum teridentifikasi.')
    }

    const permissions = await this.permissionsFor(actorId, organizationId)

    if (!permissions.has(permission)) {
      return deny(
        'PERMISSION_DENIED',
        `Akunmu belum punya izin "${permission}" di organisasi ini.`,
      )
    }

    // Cek tambahan khusus resource bila diminta oleh pemanggil.
    if (resourceType && resourceId) {
      const resourceCheck = await this.checkResourceScope({
        organizationId,
        resourceType,
        resourceId,
      })
      if (!resourceCheck.allowed) return resourceCheck
    }

    return allow()
  }

  /**
   * Pastikan resource benar-benar milik organisasi yang diminta.
   *
   * Ini adalah lapis kedua. Lapis pertama (permission) mengecek "apakah orang
   * ini boleh"; lapis ini mengecek "apakah objek yang dimaksud memang milik
   * organisasi yang sedang dibahas". Tanpa lapis ini, orang dengan izin bisa
   * menebak UUID milik organisasi lain.
   */
  private async checkResourceScope(params: {
    organizationId: string
    resourceType: string
    resourceId: string
  }): Promise<AuthorizationDecision> {
    const { organizationId, resourceType, resourceId } = params

    try {
      const modelMap: Record<string, { findFirst: (args: unknown) => Promise<unknown> }> = {
        event: this.prisma.event as never,
        attendance_event: this.prisma.attendanceEvent as never,
        task: this.prisma.task as never,
        invoice: this.prisma.invoice as never,
        finance_account: this.prisma.financeAccount as never,
        document: this.prisma.documentRecord as never,
        knowledge_document: this.prisma.knowledgeDocument as never,
        group: this.prisma.group as never,
        workflow: this.prisma.workflow as never,
      }

      const model = modelMap[resourceType]
      if (!model) {
        // Tipe resource tidak dikenal → jangan diasumsikan aman.
        return deny('RESOURCE_NOT_FOUND', `Tipe resource "${resourceType}" tidak dikenali.`)
      }

      const found = await model.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })

      if (!found) {
        return deny(
          'RESOURCE_SCOPE_MISMATCH',
          'Data yang diminta tidak ditemukan di organisasi ini.',
        )
      }
    } catch (error) {
      this.log.error({ err: error, resourceType, resourceId }, 'gagal memverifikasi scope resource')
      return deny('RESOURCE_SCOPE_MISMATCH', 'Gagal memverifikasi kepemilikan data.')
    }

    return allow()
  }

  /** Cek banyak izin sekaligus — untuk menentukan daftar tool mana yang boleh ditampilkan. */
  async checkMany(
    actorId: string,
    organizationId: string,
    permissions: Permission[],
  ): Promise<Set<Permission>> {
    if (permissions.length === 0) return new Set()
    const owned = await this.permissionsFor(actorId, organizationId)
    return new Set(permissions.filter((permission) => owned.has(permission)))
  }

  /** Buang cache (dipanggil saat role berubah). */
  invalidate(actorId?: string, organizationId?: string): void {
    if (!actorId && !organizationId) {
      this.cache.clear()
      return
    }
    for (const key of this.cache.keys()) {
      const [cachedActor, cachedOrg] = key.split(':')
      const cocokAktor = !actorId || cachedActor === actorId
      const cocokOrg = !organizationId || cachedOrg === organizationId
      if (cocokAktor && cocokOrg) this.cache.delete(key)
    }
  }
}

/** Deskripsi singkat untuk pesan penolakan ke pengguna (tanpa membocorkan konfigurasi). */
export function describeDenial(decision: AuthorizationDecision): string {
  if (decision.reason === 'MEMBERSHIP_REQUIRED') {
    return 'Akunmu belum terhubung ke organisasi ini.'
  }
  if (decision.reason === 'RESOURCE_SCOPE_MISMATCH' || decision.reason === 'RESOURCE_NOT_FOUND') {
    return 'Data yang kamu minta tidak ada di organisasi ini.'
  }
  if (decision.reason === 'APPROVAL_REQUIRED') {
    return 'Tindakan ini perlu persetujuan terdaftar lebih dulu.'
  }
  return 'Aksesmu belum mencukupi untuk tindakan ini.'
}