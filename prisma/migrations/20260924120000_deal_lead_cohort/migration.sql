/*
  «Lid kogortasi» — when a lead arrived, the day it was handed to a seller,
  when the AI qualified it, which ROP it went to, and whether it is a repeat.

  Nullable with no backfill here: the sync writes them on every deal it
  touches, and the worker's one-off DEALS_BACKFILL (syncWorker.ts) re-reads
  the weeks since the portal started filling them (2026-09-14).
*/

ALTER TABLE "deal" ADD COLUMN "leadArrivedAt" TIMESTAMP(3);
ALTER TABLE "deal" ADD COLUMN "leadDistributedOn" DATE;
ALTER TABLE "deal" ADD COLUMN "aiQualifiedAt" TIMESTAMP(3);
ALTER TABLE "deal" ADD COLUMN "leadRopEmployeeId" TEXT;
ALTER TABLE "deal" ADD COLUMN "repeatLead" TEXT;

ALTER TABLE "deal" ADD CONSTRAINT "deal_leadRopEmployeeId_fkey"
  FOREIGN KEY ("leadRopEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "deal_leadArrivedAt_idx" ON "deal"("leadArrivedAt");
CREATE INDEX "deal_leadDistributedOn_idx" ON "deal"("leadDistributedOn");
