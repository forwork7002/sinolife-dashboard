-- Requests SENT, beside the rows received.
--
-- A batch is one call and up to 2 500 rows, so `recordsRead` cannot answer
-- "how much did we ask of the portal" — the question Bitrix24 support asked
-- after the 2026-09-14 block, and the one the daily call budget is counted
-- against. Nullable-by-default rather than backfilled: rows written before
-- this column existed did not measure it, and a 0 there would be a claim.
ALTER TABLE "sync_log" ADD COLUMN "apiCalls" INTEGER NOT NULL DEFAULT 0;
