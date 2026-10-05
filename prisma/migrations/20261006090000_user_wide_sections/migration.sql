/*
  Per-section scope for a narrowed account (the client, 2026-10-05: a ROP
  reads some screens for their own team and others for the whole company).
  Empty for every existing account, so nobody reads anything they did not.
*/
ALTER TABLE "user" ADD COLUMN "wideSections" TEXT[] DEFAULT ARRAY[]::TEXT[];

/*
  «RNP JADVALI», AND ONLY IT, for the TEAM accounts that already hold it: the
  client asked for it by name («RNP ham global koʻriladi tanlansa»), it was
  ticked and refused, and the form now sends such a tick as wide. Every other
  company-only screen — Lidlar, Reklama, Oylik (salaries), Qoʻngʻiroqlar (talk
  time), Target (phones), … — waits for an administrator to open the account
  and save it beside the «Butun kompaniya» chip: several of those ticks came
  from earlier migrations (`leads_section`, `rnp_section`), not from anybody's
  decision about this account. OWN and ALL accounts are left as they are.
*/
UPDATE "user"
SET "wideSections" = ARRAY['rnp']
WHERE "dataScope" = 'TEAM' AND 'rnp' = ANY ("sections");
