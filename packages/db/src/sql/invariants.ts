/**
 * Trigger & constraint database yang menegakkan invariant OSDA.
 *
 * File ini dijalankan SETELAH migrasi Drizzle (lihat migrate.ts).
 * Semua invariant yang JANGAN bisa dilanggar aplikasi — menyerahkan Responsibilities ini
 * kepada database sebagai lapis pertahanan terakhir.
 */

export const SQL_INVARIANT = `
-- ============================================================
-- 1. Trigger: kunci otomatis kolom diubah_pada
-- ============================================================

CREATE OR REPLACE FUNCTION osda_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.diubah_pada := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'diubah_pada' AND a.attnum > 0
       )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION osda_set_updated_at()',
      t
    );
  END LOOP;
END $$;

-- ============================================================
-- 2. Invariant: ledger_entries TIDAK BOLEH diubah atau dihapus
--    Koreksi selalu lewat transaksi ADJUSTMENT baru.
-- ============================================================

CREATE OR REPLACE FUNCTION osda_ledger_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries bersifat immutable. Gunakan transaksi ADJUSTMENT untuk koreksi. (tabel %, operasi %)',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_immutable ON ledger_entries;
CREATE TRIGGER trg_ledger_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION osda_ledger_immutable();

-- ============================================================
-- 3. Invariant: document_versions yang dikunci tidak boleh diubah
-- ============================================================

CREATE OR REPLACE FUNCTION osda_document_version_locked()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.dikunci THEN
    RAISE EXCEPTION 'Versi dokumen % sudah dikunci dan tidak dapat diubah.', OLD.versi
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dokumen_versi_locked ON document_versions;
CREATE TRIGGER trg_dokumen_versi_locked
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION osda_document_version_locked();

-- ============================================================
-- 4. Invariant: pemohon tidak boleh menjadi pemberi persetujuan
--    (mencegah satu orang mengendalikan seluruh alur uang)
--
-- PENTING: di dalam PL/pgSQL, identifier yang tidak dikutip DILIPAT ke
-- huruf kecil. NEW.disetujuiOleh menjadi new.disetujuioleh, sedangkan
-- kolomnya disetujui_oleh — trigger gagal untuk setiap baris, bukan hanya
-- saat self-approve terjadi. Semua rujukan kolom di file ini WAJIB
-- snake_case.
-- ============================================================

CREATE OR REPLACE FUNCTION osda_no_self_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.disetujui_oleh IS NOT NULL AND NEW.pemohon_member_id IS NOT NULL
     AND NEW.disetujui_oleh = NEW.pemohon_member_id THEN
    RAISE EXCEPTION 'Pemohon tidak boleh menyetujui pengajuannya sendiri.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_self_approval_expense ON expense_requests;
CREATE TRIGGER trg_no_self_approval_expense
  BEFORE UPDATE ON expense_requests
  FOR EACH ROW EXECUTE FUNCTION osda_no_self_approval();

CREATE OR REPLACE FUNCTION osda_no_self_approval_reimburse()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.disetujui_oleh IS NOT NULL AND NEW.member_id IS NOT NULL
     AND NEW.disetujui_oleh = NEW.member_id THEN
    RAISE EXCEPTION 'Anggota tidak boleh menyetujui reimbursement-nya sendiri.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_self_approval_reimburse ON reimbursements;
CREATE TRIGGER trg_no_self_approval_reimburse
  BEFORE UPDATE ON reimbursements
  FOR EACH ROW EXECUTE FUNCTION osda_no_self_approval_reimburse();

-- ============================================================
-- 5. Invariant: alasan WAJIB untuk status EXCUSED dan SICK
-- ============================================================

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS chk_alasan_wajib;
ALTER TABLE attendance_records
  ADD CONSTRAINT chk_alasan_wajib CHECK (
    status IN ('PRESENT', 'LATE', 'ABSENT')
    OR (alasan IS NOT NULL AND length(trim(alasan)) >= 3)
  );

-- ============================================================
-- 6. Invariant: nominal transaksi & ledger harus positif (tidak nol)
-- ============================================================

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_nominal_positif;
ALTER TABLE transactions
  ADD CONSTRAINT chk_nominal_positif CHECK (nominal > 0);

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS chk_ledger_nonzero;
ALTER TABLE ledger_entries
  ADD CONSTRAINT chk_ledger_nonzero CHECK (
    (debit > 0 AND kredit = 0) OR (kredit > 0 AND debit = 0)
  );

-- ============================================================
-- 7. Invariant: audit log bersifat append-only
-- ============================================================

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS chk_audit_append_only;
CREATE OR REPLACE FUNCTION osda_audit_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs bersifat append-only: % tidak diizinkan.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_logs;
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION osda_audit_append_only();

-- ============================================================
-- 8. Helper: saldo akun dihitung dari ledger (TIDAK disimpan)
-- ============================================================

CREATE OR REPLACE FUNCTION osda_saldo_akun(p_akun_id UUID, sampai DATE DEFAULT CURRENT_DATE)
RETURNS BIGINT AS $$
  SELECT COALESCE(SUM(debit - kredit), 0)::BIGINT
    FROM ledger_entries
   WHERE account_id = p_akun_id
     AND tanggal <= sampai;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION osda_saldo_organisasi(p_org UUID, sampai DATE DEFAULT CURRENT_DATE)
RETURNS BIGINT AS $$
  SELECT COALESCE(SUM(CASE WHEN a.adalah_kas THEN (l.debit - l.kredit) ELSE 0 END), 0)::BIGINT
    FROM ledger_entries l
    JOIN accounts a ON a.id = l.account_id
   WHERE l.organization_id = p_org
     AND l.tanggal <= sampai;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- 9. Invariant: hanya satu periode aktif per organisasi
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_periode_aktif
  ON organization_periods (organization_id)
  WHERE status = 'ACTIVE';

-- ============================================================
-- 10. Invariant: hanya satu periode keuangan OPEN per organisasi
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_periode_keuangan_aktif
  ON financial_periods (organization_id)
  WHERE status = 'OPEN';

-- ============================================================
-- 11. Invariant: approve hanya satu payment aktif per referensi
--     (pembayaran tidak boleh di-settle dua kali)
-- ============================================================

CREATE OR REPLACE FUNCTION osda_payment_settle_once()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'PAID' AND NEW.status = 'PAID' AND OLD.transaksi_id IS NOT NULL
     AND NEW.transaksi_id IS NOT NULL AND OLD.transaksi_id <> NEW.transaksi_id THEN
    RAISE EXCEPTION 'Pembayaran % sudah disettle dengan transaksi %; tidak boleh disettle lagi.',
      OLD.kode, OLD.transaksi_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_settle_once ON payments;
CREATE TRIGGER trg_payment_settle_once
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION osda_payment_settle_once();

-- ============================================================
-- 12. Pencarian full-text untuk dokumen & pengumuman
-- ============================================================

CREATE INDEX IF NOT EXISTS ix_documents_fts
  ON documents USING GIN (to_tsvector('simple', coalesce(judul, '') || ' ' || coalesce(deskripsi, '')));

CREATE INDEX IF NOT EXISTS ix_announcements_fts
  ON announcements USING GIN (to_tsvector('simple', coalesce(judul, '') || ' ' || coalesce(isi, '')));
`;
