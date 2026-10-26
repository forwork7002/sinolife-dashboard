-- «Безквал» by the client's spec v2 (2026-10-26, `bezkval-lid-spec (1).md`):
-- a kirim is a deal created in Регистрация or moved there from «ИИ обработка»,
-- and Первичный отдел's births are «Kval», counted beside it.
--
-- Additive only: two new tables, two nullable columns and one more nullable
-- column on "bezkval_day" (ADD COLUMN with no default rewrites nothing). Every
-- stored day is counted again by the worker under the new rules
-- (`BEZKVAL_RULES`), so nothing here is backfilled. lock_timeout fails the
-- deploy fast instead of queueing behind a sync write.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "bezkval_client" ADD COLUMN "bucket" TEXT;

-- AlterTable
ALTER TABLE "bezkval_day" ADD COLUMN "kvalDeals" INTEGER;
ALTER TABLE "bezkval_day" ADD COLUMN "kvalClients" INTEGER;

-- CreateTable
CREATE TABLE "kval_client" (
    "day" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "rop" TEXT,
    "bucket" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "phone" TEXT,
    "hour" INTEGER NOT NULL,
    "source" TEXT,
    "deals" JSONB NOT NULL,
    "dealCount" INTEGER NOT NULL,

    CONSTRAINT "kval_client_pkey" PRIMARY KEY ("day","key")
);

-- CreateTable
CREATE TABLE "crm_deal_move" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "externalId" TEXT NOT NULL,
    "dealExternalId" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "stageExternalId" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_move_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_deal_move_dealExternalId_idx" ON "crm_deal_move"("dealExternalId");

-- CreateIndex
CREATE INDEX "crm_deal_move_categoryId_movedAt_idx" ON "crm_deal_move"("categoryId", "movedAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deal_move_externalSource_externalId_key" ON "crm_deal_move"("externalSource", "externalId");

RESET lock_timeout;
