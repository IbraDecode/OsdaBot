-- CreateTable
CREATE TABLE "public"."seen_groups" (
    "id" UUID NOT NULL,
    "jid" TEXT NOT NULL,
    "subject" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "lastSenderName" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seen_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seen_groups_jid_key" ON "public"."seen_groups"("jid");

-- CreateIndex
CREATE INDEX "seen_groups_lastSeenAt_idx" ON "public"."seen_groups"("lastSeenAt" DESC);
