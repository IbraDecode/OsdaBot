ALTER TABLE "members" ADD COLUMN "legacy_id" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "legacy_tabel" text;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "legacy_id" text;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "legacy_tabel" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_org_legacy" ON "members" USING btree ("organization_id","legacy_tabel","legacy_id");