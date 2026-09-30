-- «RNP jadvali»: the month's registration scan (LEAD + AI_TRIAGE pipelines
-- over a creation window) ANDed the single-column pipelineId and
-- createdAtSource bitmaps, went lossy and read ~33 000 heap pages — 6.7 s
-- warm and past the pool's 20 s cold on production (2026-09-30). One
-- composite index answers both conditions exactly.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma runs a migration inside a
-- transaction, which forbids it — the same choice as the other "deal"
-- indexes. It holds a SHARE lock (reads pass, the sync's writes wait) for the
-- few seconds the build takes; lock_timeout makes the deploy fail fast and
-- retryable instead of queueing behind a long write.
SET lock_timeout = '5s';
CREATE INDEX "deal_pipelineId_createdAtSource_idx" ON "deal"("pipelineId", "createdAtSource");
RESET lock_timeout;
