-- Bendera sistem untuk kendali operasional.
--
-- Yang pertama memakainya: `system.safe_mode`. tombol darurat yang hanya
-- hidup di memory tidak berguna — bot yang restart setelah insiden akan
-- langsung mengulang kesalahan yang sama, dan tidak ada yang ingat menyalakan
-- lagi.
--
-- Sengaja tanpa `organizationId`. Ini kendali tingkat sistem, bukan data
-- organisasi: tidak boleh ikut terhapus bersama organisasinya, dan
-- tidak boleh terisolasi per organisasi.
CREATE TABLE IF NOT EXISTS "SystemFlag" (
    "key"       TEXT NOT NULL,
    "value"     JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemFlag_pkey" PRIMARY KEY ("key")
);
