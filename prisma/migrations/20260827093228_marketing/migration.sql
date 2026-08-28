-- CreateEnum
CREATE TYPE "MarketingDimension" AS ENUM ('CAMP', 'ADSET', 'CREATIVE', 'TARGETOLOG', 'FORM', 'SOURCE', 'PRODUCT', 'REGION', 'ROP', 'SELLER', 'REGISTRATOR', 'DAYS');

-- CreateTable
CREATE TABLE "marketing_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimension" "MarketingDimension" NOT NULL,
    "key" TEXT NOT NULL,
    "parent" TEXT NOT NULL DEFAULT '',
    "leads" INTEGER NOT NULL DEFAULT 0,
    "clean" INTEGER NOT NULL DEFAULT 0,
    "kval" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "newCustomers" INTEGER NOT NULL DEFAULT 0,
    "spendMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "orderedMinor" BIGINT NOT NULL DEFAULT 0,
    "soldMinor" BIGINT NOT NULL DEFAULT 0,
    "metaRevenueMinor" BIGINT NOT NULL DEFAULT 0,
    "dealDaysSum" INTEGER NOT NULL DEFAULT 0,
    "dealCount" INTEGER NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "reach" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "metaLeads" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_snapshot" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "usdRateMicro" BIGINT NOT NULL,
    "rateDate" DATE NOT NULL,
    "updatedLabel" TEXT NOT NULL,
    "today" DATE NOT NULL,
    "minDate" DATE NOT NULL,
    "maxDate" DATE NOT NULL,
    "dailyFrom" DATE NOT NULL,
    "freshFrom" DATE NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL,

    CONSTRAINT "marketing_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_daily_dimension_parent_date_idx" ON "marketing_daily"("dimension", "parent", "date");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_daily_dimension_date_key_parent_key" ON "marketing_daily"("dimension", "date", "key", "parent");
