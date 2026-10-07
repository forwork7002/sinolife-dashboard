-- The sync worker's «ИИ обработка» re-read (`closedTriageDealIds`,
-- sync/triageMoves.ts) asks every five minutes for the AI_TRIAGE pipeline's
-- closed deals modified by the portal's clock since two days ago:
--   JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'AI_TRIAGE'
--   WHERE … AND d."updatedAtSource" >= $2
-- No index named "updatedAtSource", so production read the whole "deal" heap
-- each time — ~100 s of database time per ten minutes, measured with
-- pg_stat_statements on 2026-10-05. Pipeline first, then the modification
-- time: the pipeline join resolves to one id, and the range is then a short
-- walk. The hourly wide reach (no time bound) reads the same pipeline prefix.
--
-- Additive only: no column, no row and no existing index changes.
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma runs a migration inside a
-- transaction, which forbids it — the same choice as the other "deal"
-- indexes. It holds a SHARE lock (reads pass, the sync's writes wait) for the
-- few seconds the build takes; lock_timeout makes the deploy fail fast and
-- retryable instead of queueing behind a long write.
SET lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS "deal_pipelineId_updatedAtSource_idx" ON "deal"("pipelineId", "updatedAtSource");
RESET lock_timeout;
