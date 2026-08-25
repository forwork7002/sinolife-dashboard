-- CreateEnum
CREATE TYPE "PipelineRole" AS ENUM ('REVENUE', 'RETENTION', 'CONFIRMATION', 'QUALIFICATION', 'LEAD', 'AI_TRIAGE', 'IGNORED');

-- CreateEnum
CREATE TYPE "LogisticsRole" AS ENUM ('PREPARING', 'WAREHOUSE', 'CONFIRMED', 'IN_TRANSIT', 'REGIONAL_HUB', 'CARRIER', 'CHASING', 'DELIVERED', 'REFUSED', 'CANCELLED_EARLY');

-- CreateEnum
CREATE TYPE "ConfirmStatus" AS ENUM ('CONFIRMED', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'CALLBACK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyncEntity" ADD VALUE 'PIPELINES';
ALTER TYPE "SyncEntity" ADD VALUE 'STAGE_HISTORY';
ALTER TYPE "SyncEntity" ADD VALUE 'CALLS';
ALTER TYPE "SyncEntity" ADD VALUE 'STORES';
ALTER TYPE "SyncEntity" ADD VALUE 'STOCK';

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "confirmStatus" "ConfirmStatus",
ADD COLUMN     "countsAsRevenue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "customerGrade" TEXT,
ADD COLUMN     "fulfilmentPoint" TEXT,
ADD COLUMN     "isReturnCustomer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orderCode" TEXT,
ADD COLUMN     "paymentMethodRaw" TEXT,
ADD COLUMN     "pipelineId" TEXT,
ADD COLUMN     "productLine" TEXT,
ADD COLUMN     "refusalReason" TEXT,
ADD COLUMN     "region" TEXT;

-- AlterTable
ALTER TABLE "deal_item" ADD COLUMN     "discountMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "discountRateBp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "deal_stage" ADD COLUMN     "logisticsRole" "LogisticsRole",
ADD COLUMN     "pipelineId" TEXT;

-- AlterTable
ALTER TABLE "department" ADD COLUMN     "headId" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "costMinor" BIGINT;

-- CreateTable
CREATE TABLE "pipeline" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "role" "PipelineRole" NOT NULL DEFAULT 'IGNORED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stage_history" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "externalId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_record" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "externalId" TEXT NOT NULL,
    "employeeId" TEXT,
    "customerId" TEXT,
    "dealId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "phoneNumber" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "failedCode" TEXT,
    "recordUrl" TEXT,
    "transcript" TEXT,
    "score" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_level" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_spend" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_role_idx" ON "pipeline"("role");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_externalSource_externalId_key" ON "pipeline"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "deal_stage_history_dealId_enteredAt_idx" ON "deal_stage_history"("dealId", "enteredAt");

-- CreateIndex
CREATE INDEX "deal_stage_history_stageId_enteredAt_idx" ON "deal_stage_history"("stageId", "enteredAt");

-- CreateIndex
CREATE UNIQUE INDEX "deal_stage_history_externalSource_externalId_key" ON "deal_stage_history"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "call_record_employeeId_startedAt_idx" ON "call_record"("employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "call_record_dealId_idx" ON "call_record"("dealId");

-- CreateIndex
CREATE INDEX "call_record_startedAt_idx" ON "call_record"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "call_record_externalSource_externalId_key" ON "call_record"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "store_isActive_idx" ON "store"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "store_externalSource_externalId_key" ON "store"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "stock_level_productId_idx" ON "stock_level"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_level_storeId_productId_key" ON "stock_level"("storeId", "productId");

-- CreateIndex
CREATE INDEX "ad_spend_periodStart_idx" ON "ad_spend"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_sourceId_periodStart_key" ON "ad_spend"("sourceId", "periodStart");

-- CreateIndex
CREATE INDEX "deal_pipelineId_idx" ON "deal"("pipelineId");

-- CreateIndex
CREATE INDEX "deal_orderCode_idx" ON "deal"("orderCode");

-- CreateIndex
CREATE INDEX "deal_countsAsRevenue_status_closedAt_idx" ON "deal"("countsAsRevenue", "status", "closedAt");

-- CreateIndex
CREATE INDEX "deal_countsAsRevenue_region_closedAt_idx" ON "deal"("countsAsRevenue", "region", "closedAt");

-- CreateIndex
CREATE INDEX "deal_confirmStatus_createdAtSource_idx" ON "deal"("confirmStatus", "createdAtSource");

-- CreateIndex
CREATE INDEX "deal_stage_pipelineId_idx" ON "deal_stage"("pipelineId");

-- CreateIndex
CREATE INDEX "deal_stage_logisticsRole_idx" ON "deal_stage"("logisticsRole");

-- CreateIndex
CREATE INDEX "department_parentId_idx" ON "department"("parentId");

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_headId_fkey" FOREIGN KEY ("headId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage" ADD CONSTRAINT "deal_stage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "deal_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_record" ADD CONSTRAINT "call_record_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_record" ADD CONSTRAINT "call_record_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_record" ADD CONSTRAINT "call_record_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sales_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
