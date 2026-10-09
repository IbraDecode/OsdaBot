DROP INDEX "uq_rapat_undangan_slot";--> statement-breakpoint
CREATE INDEX "ix_rapat_slot" ON "meetings" USING btree ("organization_id","tanggal","waktu_mulai");