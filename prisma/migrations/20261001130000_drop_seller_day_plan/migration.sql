-- «Sotuv · ROP» was removed on 2026-10-01, and with it the only reader and
-- writer of the sellers' day plans. The user approved dropping the table and
-- its rows the same day. `team_month_plan` stays: «RNP jadvali» keeps its
-- FAKT 1 / FAKT 2 plans there.
--
-- Nothing reads the table, so the ACCESS EXCLUSIVE lock waits on nobody;
-- lock_timeout keeps a surprise from stalling the deploy all the same.
SET lock_timeout = '5s';
DROP TABLE IF EXISTS "seller_day_plan";
RESET lock_timeout;
