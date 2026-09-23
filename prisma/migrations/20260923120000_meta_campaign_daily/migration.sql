/*
  Meta Ads per CAMPAIGN per day — the grain «Reklama samarasi» needs to tell
  lead-form spend («Отчёт Т») from Instagram-message spend («DM»). See the
  block above `MetaCampaignDaily` in schema.prisma. Filled by the same hourly
  pass as meta_ad_daily; an empty table reads from the history start.
*/
CREATE TABLE "meta_campaign_daily" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_campaign_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_campaign_daily_campaignId_date_key" ON "meta_campaign_daily"("campaignId", "date");
CREATE INDEX "meta_campaign_daily_date_idx" ON "meta_campaign_daily"("date");
