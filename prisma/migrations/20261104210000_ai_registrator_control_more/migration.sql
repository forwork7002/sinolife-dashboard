-- «AI registrator → Boshqaruv», the rest of the panel (2026-11-04, T144, the owner:
-- «hamma narsani boshqara olsin … to'xtatib qo'yish funksiyalari, SIP bilan ishlash»).
-- ADD COLUMN and a new table only — nothing existing is changed or dropped. The one
-- config row reads as before: every day, no pause, every line on, the agent's own tuning.

-- AlterTable
ALTER TABLE "ai_registrator_config" ADD COLUMN     "linesOff" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pauseUntil" TIMESTAMP(3),
ADD COLUMN     "tuning" JSONB,
ADD COLUMN     "workDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "ai_registrator_action" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "line" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT NOT NULL,
    "requestedById" TEXT,
    "state" TEXT,
    "text" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ai_registrator_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_registrator_action_requestedAt_idx" ON "ai_registrator_action"("requestedAt");
