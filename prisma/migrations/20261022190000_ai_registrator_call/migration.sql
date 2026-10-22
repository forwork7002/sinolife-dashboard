-- «AI registrator» (2026-10-22): every finished call of the Sinolife voice
-- agent, pushed by it to /api/ai-registrator/calls, so «Lidlar → AI
-- registrator» can follow the deals it put through to a seller.
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "ai_registrator_call" (
    "callId" TEXT NOT NULL,
    "dealExternalId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "transferredTo" TEXT,
    "transferAttempts" JSONB,
    "result" JSONB,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_registrator_call_pkey" PRIMARY KEY ("callId")
);

-- CreateIndex
CREATE INDEX "ai_registrator_call_startedAt_idx" ON "ai_registrator_call"("startedAt");

-- CreateIndex
CREATE INDEX "ai_registrator_call_dealExternalId_idx" ON "ai_registrator_call"("dealExternalId");
