-- Persetujuan yang bisa dieksekusi.
--
-- Kenapa kolom ini dibutuhkan
--
-- `payload`: Approval menyimpan `payloadHash` (untuk memastikan isi tidak
-- berubah antara permintaan dan persetujuan) tapi TIDAK menyimpan payload
-- aslinya. Artinya setelah disetujui, tidak ada yang bisa dijalankan — approval
-- jadi dekorasi. Payload disimpan supaya tindakan bisa dieksekusi nanti.
--
-- `chatJid`: tempat permintaan dikirim. Balasan "setuju"/"batal" hanya
-- diterima dari chat yang sama. Tanpa ini, siapa pun di grup bisa
-- menyetujui tindakan orang lain.
--
-- `correlationId`: mengaitkan approval ke satu putaran percakapan agent,
-- supaya hasilnya bisa dilaporkan ke percakapan yang benar.
ALTER TABLE "Approval"
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "chatJid" TEXT,
  ADD COLUMN "correlationId" TEXT;

-- Jalur panas: setiap pesan masuk menanyakan apakah ini balasan persetujuan.
CREATE INDEX "Approval_chatJid_status_idx" ON "Approval"("chatJid", "status");

-- Menjaga integritas approve/reject: satu approval hanya boleh selesai sekali.
CREATE INDEX "Approval_requestedBy_status_idx" ON "Approval"("requestedBy", "status");