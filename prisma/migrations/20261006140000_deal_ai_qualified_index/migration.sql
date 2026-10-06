-- «Lidlar»: `aiQualifiedStages` reads every deal whose «ИИ квал сана» falls
-- in the window — the portal's own filter on that field, any pipeline, any
-- creation day — and with no index on the column that was a sequential scan
-- of the whole "deal" table on every build of the tab (2026-10-06, «Lidlar
-- juda sekin»). An index answers the window directly.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma runs a migration inside a
-- transaction, which forbids it — the same choice as the other "deal"
-- indexes. It holds a SHARE lock (reads pass, the sync's writes wait) for the
-- few seconds the build takes; lock_timeout makes the deploy fail fast and
-- retryable instead of queueing behind a long write.
SET lock_timeout = '5s';
CREATE INDEX "deal_aiQualifiedAt_idx" ON "deal"("aiQualifiedAt");
RESET lock_timeout;
