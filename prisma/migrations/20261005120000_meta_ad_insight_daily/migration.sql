/*
  Meta Ads per AD per day, with its ad set and campaign — the grain the
  «Roistat» screen drills Кампании → Адсеты → Объявления from. See the block
  above `MetaAdInsightDaily` in schema.prisma. Filled by the same hourly pass
  as meta_ad_daily and meta_campaign_daily; an empty table reads from the
  history start. `reach` is per day and does not add up across days.
*/
CREATE TABLE "meta_ad_insight_daily" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "adsetId" TEXT NOT NULL,
    "adsetName" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "reach" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_insight_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_ad_insight_daily_adId_date_key" ON "meta_ad_insight_daily"("adId", "date");
CREATE INDEX "meta_ad_insight_daily_date_idx" ON "meta_ad_insight_daily"("date");
CREATE INDEX "meta_ad_insight_daily_accountId_date_idx" ON "meta_ad_insight_daily"("accountId", "date");
CREATE INDEX "meta_ad_insight_daily_campaignId_date_idx" ON "meta_ad_insight_daily"("campaignId", "date");
CREATE INDEX "meta_ad_insight_daily_adsetId_date_idx" ON "meta_ad_insight_daily"("adsetId", "date");
