-- Tasdiqlash navbati = Bitrix24 (2026-10-08): the portal's outgoing deal
-- events, queued by `/api/bitrix24/events` and drained by the sync worker
-- between ticks, so a deal deleted or moved in Bitrix24 is reflected within
-- seconds instead of the next by-id check or the nightly walk.
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "crm_event" (
    "id" SERIAL NOT NULL,
    "source" "ExternalSource" NOT NULL,
    "event" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "crm_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_event_source_processedAt_id_idx" ON "crm_event"("source", "processedAt", "id");

-- CreateIndex
CREATE INDEX "crm_event_processedAt_idx" ON "crm_event"("processedAt");
