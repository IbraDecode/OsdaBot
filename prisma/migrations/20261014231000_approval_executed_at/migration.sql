-- Jejak eksekusi.
--
-- Tanpa kolom ini, tidak ada cara membedakan "sudah disetujui tapi belum
-- dijalankan" dari "sudah disetujui DAN sudah dijalankan". Executor memakainya
-- sebagai pagar idempotensi: satu persetujuan menghasilkan paling banyak satu
-- eksekusi, walau balasan "iya" datang dua kali.
ALTER TABLE "Approval"
  ADD COLUMN "executedAt" TIMESTAMP(3);