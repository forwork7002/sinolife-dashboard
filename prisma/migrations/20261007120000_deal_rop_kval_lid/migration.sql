-- «Безквал» (2026-10-07): the portal now stamps «ROP KVAL LID»
-- (UF_CRM_ROP_KVAL_LID) on every Регистрация deal — the ROP it was handed to,
-- kept when the ROP passes it on — and filled the older deals over the API.
-- The column fills as the sync re-reads deals; the worker's DEALS_BACKFILL
-- re-reads the rest.
--
-- Same shape as 20261006160000_deal_owner_change: ADD COLUMN with no default
-- rewrites nothing, the foreign key is NOT VALID and never validated (the
-- column is all NULL, and every row written from now on is checked), and
-- lock_timeout fails the deploy fast instead of queueing behind a sync write.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "ropKvalLidEmployeeId" TEXT;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_ropKvalLidEmployeeId_fkey" FOREIGN KEY ("ropKvalLidEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

RESET lock_timeout;
