/**
 * Pembersihan sisa data uji.
 *
 * ── Kenapa file ini ada ─────────────────────────────────────────────────────
 *
 * Test integrasi membuat organisasi, anggota, dan job sementara lalu
 * menghapusnya di `afterAll`. Masalahnya: **`afterAll` tidak selalu jalan.**
 *
 * `vitest run -t <filter>` men-skip seluruh `describe` yang tidak punya test
 * yang cocok — termasuk `afterAll`-nya. Jadi setiap filtered run yang tidak
 * sengaja menyentuh file yang sama meninggalkan satu organisasi.
 *
 * Dampaknya nyata, bukan teoretis: verifikasi regresi memakai filter sepanjang
 * waktu, dan database pengembangan sampai berisi **924 organisasi uji** —
 * semuanya dari `afterAll` yang tidak pernah dipanggil.
 *
 * `bersihkanSisa()` dipanggil di `beforeAll`, jadi sisa dari run sebelumnya
 * ikut terhapus. `afterAll` tetap dipakai untuk kasus normal; ini cuma jaring
 * pengaman.
 */
import type { PrismaClient } from '@prisma/client'

/**
 * Hapus semua organisasi uji yang slug-nya diawali salah satu prefiks di bawah.
 *
 * Prefiks gathered dari file test yang membuat organisasi sementara. Kalau ada
 * test baru yang memakai slug di luar daftar ini, tambahkan di sana — kalau
 * tidak, organisasinya akan tetap tertinggal.
 */
const PREFIKS_SLUG_UJI = [
  'org-lain-',
  'org-kedua-',
  'org-monitor-uji-',
  'org-monitor-lain-',
  'uji-grup-',
  'uji-isolated-',
  'uji-organisasi-',
]

export async function bersihkanSisaOrganisasiUji(prisma: PrismaClient): Promise<number> {
  const hasil = await prisma.organization.deleteMany({
    where: { OR: PREFIKS_SLUG_UJI.map((prefiks) => ({ slug: { startsWith: prefiks } })) },
  })
  return hasil.count
}

/** Jumlah organisasi uji yang masih tertinggal. Untuk diagnosis. */
export async function hitungSisaOrganisasiUji(prisma: PrismaClient): Promise<number> {
  return prisma.organization.count({
    where: { OR: PREFIKS_SLUG_UJI.map((prefiks) => ({ slug: { startsWith: prefiks } })) },
  })
}