/**
 * OSDA Contracts — kontrak tunggal untuk seluruh client.
 *
 * Aturan:
 * 1. Paket ini TIDAK boleh mengimpor NestJS, React, atau driver database apa pun.
 * 2. Semua enum, permission, dan skema validasi didefinisikan di sini agar Web,
 *    Mobile, Bot, dan API tidak pernah berbeda.
 * 3. Bila ada perubahan yang merusak kompatibilitas, naikkan VERSI_KONTRAK.
 */

/** Versi kontrak — naik setiap ada perubahan yang tidak kompatibel. */
export const VERSI_KONTRAK = '2.0.0' as const;

export * from './permissions.js';
export * from './enums.js';
export * from './common.js';
export * from './profile.js';
export * from './auth.js';
export * from './members.js';
export * from './attendance.js';
export * from './meetings.js';
export * from './tasks.js';
export * from './programs.js';
export * from './finance.js';
export * from './documents.js';
export * from './communications.js';
export * from './notifications.js';
export * from './dashboard.js';
