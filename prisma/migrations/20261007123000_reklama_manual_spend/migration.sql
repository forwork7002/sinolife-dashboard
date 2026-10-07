-- «Targetologlar · kunlik» — ad money typed by hand (2026-10-07, the client:
-- «telegramga ketgan xarajatlar ham bo'lishi kerak»): the sheet's «Telegram»
-- block, one row per day × project × channel in whole US cents. A new,
-- empty table: nothing is rewritten and no lock on a busy table is taken.

-- CreateTable
CREATE TABLE "reklama_manual_spend" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "project" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "reklama_manual_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reklama_manual_spend_day_idx" ON "reklama_manual_spend"("day");

-- CreateIndex
CREATE UNIQUE INDEX "reklama_manual_spend_day_project_channel_key" ON "reklama_manual_spend"("day", "project", "channel");
