/*
  Meta Ads spend per ad account per day, read from the Marketing API — the
  numbers the client's «Лид база» sheet is typed from by hand. See the block
  above `MetaAdDaily` in schema.prisma.
*/
CREATE TABLE "meta_ad_daily" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_ad_daily_accountId_date_key" ON "meta_ad_daily"("accountId", "date");
CREATE INDEX "meta_ad_daily_date_idx" ON "meta_ad_daily"("date");
