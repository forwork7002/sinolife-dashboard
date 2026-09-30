-- «RNP jadvali»: no number on the screen is typed by hand any more (the
-- client's rule of 2026-09-29), so nothing reads or writes the day cells.
-- The client approved dropping the table and its rows on 2026-09-30.
--
-- Nothing reads the table, so the ACCESS EXCLUSIVE lock waits on nobody;
-- lock_timeout keeps a surprise from stalling the deploy all the same.
SET lock_timeout = '5s';
DROP TABLE IF EXISTS "rnp_manual_day";
RESET lock_timeout;
