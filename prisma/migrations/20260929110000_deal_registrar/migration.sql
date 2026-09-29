-- «Регистрация» (UF_CRM_1747975291848) on the deal — the registrar who
-- qualified the lead, for «RNP jadvali»'s registration «guruh» rows. Nullable
-- with no backfill here: the sync writes it on every deal it touches, and the
-- worker's one-off DEALS_BACKFILL re-reads September's deals at night.
--
-- A nullable column with no default is a catalogue change only, but it still
-- needs a moment of ACCESS EXCLUSIVE on "deal". Behind a long read (the sheet's
-- month scans run seconds) it would queue and stall every read and write
-- behind it, sync worker included; with lock_timeout the deploy fails fast
-- instead and can simply be retried.
SET lock_timeout = '5s';
ALTER TABLE "deal" ADD COLUMN "registrar" TEXT;
RESET lock_timeout;
