-- Indeks GIN ekspresi untuk pencarian full-text Bahasa Indonesia.
--
-- Dipakai sebagai `to_tsvector('indonesian', content)` di setiap query.
-- Indeks ekspresi menghindari kolom `tsvector` yang harus dipelihara lewat
-- trigger: kalau trigger gagal diam-diam, isi indeks tidak sinkron dan
-- dokumen yang ada tidak bisa dicari — pertanyaan dijawab "tidak ada datanya"
-- padahal datanya ada.
--
-- Kolom `KnowledgeDocument.searchVector` sengaja dibiarkan kosong. Prisma
-- menandainya `Unsupported`, jadi tidak bisa ditulis lewat ORM.

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_cari_indonesia_idx"
  ON "KnowledgeChunk"
  USING GIN (to_tsvector('indonesian', "content"));

-- Pencarian hampir selalu disaring per dokumen sebelum per organisasi.
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_org_status_idx"
  ON "KnowledgeDocument" ("organizationId", "status");
