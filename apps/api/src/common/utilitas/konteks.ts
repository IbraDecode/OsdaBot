/**
 * Helper konteks permintaan: organisasi aktor, aktor audit, dan penulisan
 * audit dari dalam service (mis. saat menyetujui pengeluaran).
 */
import { auditLogs } from '@osda/db';

import { LayananDatabase } from '../../database/database.service.js';
import type { KonteksAktorPermintaan, PenggunaPermintaan } from '../tipe.js';
import { galatIzinDitolak } from '../galat.js';
import { tentukanSumberAudit } from './sumber-kanal.js';

/**
 * Pastikan organisasi konteks tersedia.
 * `organizationId` yang dikirim klien boleh berbeda dari header hanya bila
 * pengguna memang menjadi anggota organisasi tersebut.
 */
export function pastikanOrganisasiAktif(
  pengguna: PenggunaPermintaan,
  organizationIdHeader: string | null,
  organizationIdPermintaan?: string,
): string {
  const tujuan = organizationIdPermintaan ?? organizationIdHeader ?? pengguna.org[0];
  if (!tujuan) {
    throw galatIzinDitolak('Akun ini belum terhubung ke organisasi mana pun.');
  }
  if (!pengguna.org.includes(tujuan)) {
    throw galatIzinDitolak('Organisasi yang dipilih tidak dapat diakses oleh akun ini.');
  }
  return tujuan;
}

/** Bangun konteks aktor dari pengguna yang sedang login. */
export function konteksAktor(
  pengguna: PenggunaPermintaan | undefined,
  organizationId: string | null,
  requestId: string,
  permintaan?: { headers?: Record<string, string | string[] | undefined> },
): KonteksAktorPermintaan {
  return {
    userId: pengguna?.sub ?? null,
    organizationId,
    // Sumber mengikuti kanal permintaan (API / WHATSAPP), bukan hardcode.
    sumber: tentukanSumberAudit(permintaan),
    requestId,
    ip: null,
    userAgent: null,
  };
}

/**
 * Catat aksi sensitif langsung dari service (selain AuditInterceptor).
 * Dipakai untuk pembuatan/persetujuan finansial yang WAJIB punya jejak.
 */
export async function catatAudit(
  dbSvc: LayananDatabase,
  data: {
    organizationId: string | null;
    aksi: string;
    entitasTabel: string;
    entitasId?: string | null;
    pengguna?: PenggunaPermintaan;
    requestId?: string | null;
    sebelum?: unknown;
    sesudah?: unknown;
    berhasil?: boolean;
  },
): Promise<void> {
  try {
    const db = await dbSvc.ambilDb();
    await db.insert(auditLogs).values({
      organizationId: data.organizationId,
      aksi: data.aksi,
      entitasTabel: data.entitasTabel,
      entitasId: data.entitasId ?? null,
      actorId: data.pengguna?.sub ?? null,
      actorMemberId: data.pengguna?.memberId ?? null,
      sumber: 'API',
      requestId: data.requestId ?? null,
      sebelum: (data.sebelum ?? null) as never,
      sesudah: (data.sesudah ?? null) as never,
      berhasil: data.berhasil ?? true,
    });
  } catch {
    // audit tidak boleh menggagalkan operasi bisnis
  }
}
