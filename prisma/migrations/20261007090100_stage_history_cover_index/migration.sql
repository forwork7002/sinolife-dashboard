-- The confirmation queue cohort (`queueSql` in insightsRepository.ts — the
-- bell, the board, Logistika, Sverka, the sellers board, RNP, payroll) starts
-- from `moves`:
--   FROM signal_stage ss JOIN "deal_stage_history" h
--     ON h."stageId" = ss."id" AND h."enteredAt" >= $1
-- and projects h."dealId". The existing ("stageId", "enteredAt") index finds
-- the range but every row still costs a heap visit for "dealId"; the queue
-- cohorts were ~230 s of database time per ten minutes on 2026-10-05. With
-- "dealId" in the key the same range scan can be answered from the index
-- alone (an index-only scan, as far as the visibility map allows). The
-- logistics CTEs (`delivered_at`, `dispatched`, `refused_at`) read the same
-- three columns.
--
-- A third KEY column rather than INCLUDE ("dealId"): Prisma's schema cannot
-- express INCLUDE, and a key column serves the same index-only scan while
-- keeping schema.prisma and the database in step. "leftAt" is deliberately
-- NOT in it — the sync rewrites that column on every next transition, and
-- indexing it would turn those updates non-HOT.
--
-- Additive only: the old ("stageId", "enteredAt") index stays; nothing is
-- dropped. Plain CREATE INDEX under lock_timeout, as for the "deal" indexes:
-- Prisma runs a migration inside a transaction, which forbids CONCURRENTLY.
SET lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS "deal_stage_history_stageId_enteredAt_dealId_idx" ON "deal_stage_history"("stageId", "enteredAt", "dealId");
RESET lock_timeout;
