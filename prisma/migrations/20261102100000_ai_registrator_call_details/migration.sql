-- «AI registrator» (2026-11-02): what the agent now sends with each finished
-- call (ai_registrator ca9c52a) — the AI line, the product, the client's first
-- name, whether the lead will be tried again and when.
--
-- Five NULLABLE columns, no default, no backfill: in PostgreSQL that is a
-- catalogue change only — nothing is rewritten or locked beyond an instant.

-- AlterTable
ALTER TABLE "ai_registrator_call" ADD COLUMN "aiLine" TEXT,
ADD COLUMN "product" TEXT,
ADD COLUMN "clientName" TEXT,
ADD COLUMN "leadStatus" TEXT,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
