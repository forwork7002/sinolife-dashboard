-- Meta history before 2026-07-01 (2026-10-22): how far back each ad account
-- has been asked, per grain, so the walk back to Insights' 37-month floor is
-- a bounded step a pass and an account with no older spend is asked once.
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "meta_history_read" (
    "accountId" TEXT NOT NULL,
    "grain" TEXT NOT NULL,
    "readFrom" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_history_read_pkey" PRIMARY KEY ("accountId","grain")
);

-- Every screen's «Meta yangilangan» stamp is max("importedAt") on one of these
-- three tables, per request; unindexed it is a full scan, and the walk back
-- to 2023 multiplies the rows. A plain CREATE INDEX: the tables hold three
-- months today (tens of thousands of rows), a lock of well under a second.

-- CreateIndex
CREATE INDEX "meta_ad_daily_importedAt_idx" ON "meta_ad_daily"("importedAt");

-- CreateIndex
CREATE INDEX "meta_campaign_daily_importedAt_idx" ON "meta_campaign_daily"("importedAt");

-- CreateIndex
CREATE INDEX "meta_ad_insight_daily_importedAt_idx" ON "meta_ad_insight_daily"("importedAt");
