/**
 * Pemeriksaan dokumentasi: memastikan seluruh dokumen wajib (spec §91) ada
 * dan tidak kosong.
 *
 * Jalankan: `pnpm docs:check`
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const AKAR = resolve(import.meta.dirname, '../..');
const DOKUMEN = resolve(AKAR, 'docs');

/** Daftar dokumen wajib beserta deskripsi singkat. */
const WAJIB = [
  ['ARCHITECTURE.md', 'Arsitektur sistem & lapisan'],
  ['DOMAIN_MODEL.md', 'Model domain & entitas inti'],
  ['DATABASE.md', 'Skema database'],
  ['API.md', 'Kontrak REST API'],
  ['AUTHORIZATION.md', 'RBAC, permission & scope'],
  ['ROLE_MATRIX.md', 'Matriks peran'],
  ['ATTENDANCE.md', 'Alur absensi'],
  ['MEETINGS.md', 'Rapat & notulen'],
  ['PROGRAMS.md', 'Program kerja'],
  ['TASKS.md', 'Manajemen tugas'],
  ['FINANCE.md', 'Sistem keuangan'],
  ['DOCUMENTS.md', 'Manajemen dokumen'],
  ['COMMUNICATION.md', 'Komunikasi & pengumuman'],
  ['WHATSAPP.md', 'WhatsApp Bot'],
  ['MOBILE.md', 'Aplikasi mobile'],
  ['WEB.md', 'Web Dashboard'],
  ['SECURITY.md', 'Keamanan'],
  ['AUDIT.md', 'Audit log'],
  ['MIGRATION.md', 'Migrasi dari bot v0.4'],
  ['DEPLOYMENT.md', 'Deployment'],
  ['DISASTER_RECOVERY.md', 'Pemulihan bencana'],
];

let gagal = 0;

for (const [berkas, deskripsi] of WAJIB) {
  const jalur = resolve(DOKUMEN, berkas);
  if (!existsSync(jalur)) {
    console.error(`✗ ${berkas.padEnd(26)} HILANG — ${deskripsi}`);
    gagal++;
    continue;
  }
  const isi = readFileSync(jalur, 'utf8');
  const baris = isi.split('\n').length;
  if (baris < 30) {
    console.error(`✗ ${berkas.padEnd(26)} terlalu pendek (${baris} baris) — ${deskripsi}`);
    gagal++;
  } else {
    console.log(`✓ ${berkas.padEnd(26)} ${String(baris).padStart(4)} baris — ${deskripsi}`);
  }
}

if (gagal > 0) {
  console.error(`\n${gagal} dokumen bermasalah.`);
  process.exit(1);
}
console.log(`\n✓ Seluruh ${WAJIB.length} dokumen wajib tersedia.`);
