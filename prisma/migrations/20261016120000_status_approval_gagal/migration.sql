-- Status terminal untuk persetujuan yang disetujui tapi gagal dijalankan.
--
-- Tanpa nilai ini, `APPROVED` + `executedAt` kosong indistinguishable dari
-- "menunggu dijalankan". Tidak ada worker yang mengambilnya, jadi approval
-- menggantung selamanya setelah satu kegagalan tool.
ALTER TYPE "ApprovalStatus" ADD VALUE 'FAILED';
