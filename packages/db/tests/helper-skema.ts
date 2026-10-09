/**
 * Helper bersama untuk tes skema.
 *
 * Hanya mengekspor objek `schema` agar berkas tes tidak perlu menyentuh
 * struktur internal Drizzle secara langsung.
 */
export { schema } from '../src/schema/index.js';
