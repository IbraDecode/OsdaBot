-- Nomor dokumen unik per organisasi.
--
-- Sebelumnya hanya ada index biasa, jadi dua permintaan bersamaan bisa
-- sama-sama membaca "nomor berikutnya 12" lalu sama-sama menulis
-- `SURAT/2026/012`. Dua dokumen resmi berbeda dengan identitas yang sama.
--
-- Constraint unik mengubahnya: satu menang, satu kena error P2002 — yang bisa
-- dicoba ulang dengan nomor berikutnya, bukan menerima nomor kembar.
--
-- Prisma tidak bisa membuat UNIQUE nullable lewat deklarasi model, jadi
-- `documentNumber` jadi nullable dulu, di-backfill, lalu dikunci.
--
-- Catatan: kolomnya sudah ada dan sudah terisi dari migrasi sebelumnya
-- (20261015054505_nomor_dokumen), jadi tidak ada backfill yang diperlukan.

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentRecord_organizationId_documentNumber_key"
  ON "DocumentRecord"("organizationId", "documentNumber");
