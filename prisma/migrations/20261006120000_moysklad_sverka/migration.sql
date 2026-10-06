/*
  «Sverka» (2026-10-06): Bitrix24 against MoySklad, deal by deal.

  `product."parentExternalId"` — a trade offer's product, so an order line on
  «Sinolife collagen marine kakao» (offer 676) is compared under «Collagen
  Marine Sinolife» (674), whose XML_ID is MoySklad's externalCode. Filled by
  the next reference pass; null until then (and always null on a product).

  `moysklad_order` / `moysklad_order_item` — MoySklad's customer orders, read
  by the sync worker (GET only). No foreign key to `deal`: an order whose deal
  is missing here is a finding, not a constraint violation.

  `moysklad_sync` — one row recording the import's last success and last
  failure, so the screen can tell a quiet night from a revoked token.

  No section grant: ADMIN and MANAGER reach every route by role default
  (src/lib/roles.ts); an account with an explicit list is ticked by hand.
*/
-- AlterTable
ALTER TABLE "product" ADD COLUMN     "parentExternalId" TEXT;

-- CreateTable
CREATE TABLE "moysklad_order" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bitrixDealId" TEXT,
    "moment" TIMESTAMP(3) NOT NULL,
    "stateName" TEXT,
    "sumMinor" BIGINT NOT NULL,
    "payedMinor" BIGINT NOT NULL DEFAULT 0,
    "shippedMinor" BIGINT NOT NULL DEFAULT 0,
    "sellerName" TEXT,
    "projectName" TEXT,
    "logistics" TEXT,
    "region" TEXT,
    "applicable" BOOLEAN NOT NULL DEFAULT true,
    "updatedAtSource" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moysklad_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moysklad_order_item" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productCode" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,

    CONSTRAINT "moysklad_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moysklad_sync" (
    "id" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moysklad_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moysklad_order_bitrixDealId_idx" ON "moysklad_order"("bitrixDealId");

-- CreateIndex
CREATE INDEX "moysklad_order_moment_idx" ON "moysklad_order"("moment");

-- CreateIndex
CREATE INDEX "moysklad_order_updatedAtSource_idx" ON "moysklad_order"("updatedAtSource");

-- CreateIndex
CREATE INDEX "moysklad_order_item_orderId_idx" ON "moysklad_order_item"("orderId");

-- AddForeignKey
ALTER TABLE "moysklad_order_item" ADD CONSTRAINT "moysklad_order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "moysklad_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

