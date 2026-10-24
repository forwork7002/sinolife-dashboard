-- «Безквал»: the counting rules a stored day was counted by
-- (`BEZKVAL_RULES` in bezkvalRefresh.ts). A day counted by other rules is
-- counted again by the worker. Nullable, no default: nothing is rewritten,
-- and every day stored so far reads as counted by older rules.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "bezkval_day" ADD COLUMN "rules" TEXT;

RESET lock_timeout;
