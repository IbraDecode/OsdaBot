-- AlterTable
ALTER TABLE "public"."DocumentRecord" ADD COLUMN     "documentNumber" TEXT;

-- CreateIndex
CREATE INDEX "DocumentRecord_organizationId_documentNumber_idx" ON "public"."DocumentRecord"("organizationId", "documentNumber");
