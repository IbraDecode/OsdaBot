/**
 * Agregator skema OSDA.
 *
 * Semua tabel diekspor dari sini. `@osda/db` consumer cukup mengimpor satu
 * titik agar tidak ada yang berubahUI karena urutan file.
 */

// Dasar & enum
export * from './_base.js';

// Organisasi & struktur
export * from './organization.js';

// Identitas, anggota, sesi
export * from './identity.js';

// Otorisasi
export * from './authorization.js';

// Absensi
export * from './attendance.js';

// Rapat & notulen
export * from './meetings.js';

// Tugas
export * from './tasks.js';

// Program & acara
export * from './programs.js';

// Keuangan
export * from './finance.js';

// Dokumen
export * from './documents.js';

// Komunikasi, notifikasi, sistem
export * from './system.js';

import * as identity from './identity.js';
import * as organization from './organization.js';
import * as authorization from './authorization.js';
import * as attendance from './attendance.js';
import * as meetings from './meetings.js';
import * as tasks from './tasks.js';
import * as programs from './programs.js';
import * as finance from './finance.js';
import * as documents from './documents.js';
import * as system from './system.js';

/** Semua objek tabel, dipakai Drizzle Kit & seeding. */
export const schema = {
  ...organization,
  ...identity,
  ...authorization,
  ...attendance,
  ...meetings,
  ...tasks,
  ...programs,
  ...finance,
  ...documents,
  ...system,
};

/** Nama semua tabel OSDA (berguna untuk audit & tooling migrasi). */
export const NAMA_TABEL = Object.keys(schema).filter(
  (k) => typeof (schema as Record<string, unknown>)[k] === 'object' && k !== 'schema',
);
