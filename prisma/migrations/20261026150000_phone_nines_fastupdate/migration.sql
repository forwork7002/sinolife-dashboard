/*
  «Безквал»'s number lookup without the GIN pending list (2026-10-26).

  The history read probes `customer_phone_nines_idx` once per number of the
  day (~1 300 probes, `RegistrationRepository.bezkvalHistorySql`). With
  fastupdate on — the default — new and changed contacts wait in the index's
  pending list until a vacuum, and EVERY probe scans that whole list: in
  PGlite 1 110 probes took 6.9 s before VACUUM and 23 ms after; production
  counted a day in 6–30 s, swinging with the list's size, not the day's.
  Off, a contact's numbers go straight into the index — the sync writes a few
  thousand contacts a day, a cost nobody will see — and the probes stay
  index lookups. The list already pending is merged now.

  Not in schema.prisma, like the index itself (Prisma cannot express it).
*/
SET lock_timeout = '5s';

ALTER INDEX IF EXISTS "customer_phone_nines_idx" SET (fastupdate = off);
SELECT gin_clean_pending_list('"customer_phone_nines_idx"'::regclass);

RESET lock_timeout;
