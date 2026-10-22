-- A deal's optional link the sync could not resolve when it wrote the deal
-- (2026-10-22): a source made, or a ROP / creator hired, after the last
-- reference pass was written NULL and stayed NULL until the deal changed
-- again. The portal's id waits here until the reference row exists.
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "deal_pending_link" (
    "externalSource" "ExternalSource" NOT NULL,
    "dealExternalId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_pending_link_pkey" PRIMARY KEY ("externalSource","dealExternalId","field")
);

-- CreateIndex
CREATE INDEX "deal_pending_link_createdAt_idx" ON "deal_pending_link"("createdAt");
