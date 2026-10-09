-- Tasdiqlash navbati (2026-10-09): an order refused yesterday and confirmed
-- today is a row on each day, and yesterday's row must keep the sum it was
-- refused at — the portal keeps only the deal's present OPPORTUNITY. The sync
-- stamps the deal's amount on each transition as it first imports it; rows
-- imported before this column, or long after the move, stay NULL and read the
-- deal's present amount.
--
-- A nullable column with no default: a catalogue change, no table rewrite.

-- AlterTable
ALTER TABLE "deal_stage_history" ADD COLUMN "amountMinor" BIGINT;
