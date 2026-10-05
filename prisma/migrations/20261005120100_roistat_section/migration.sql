-- «Roistat» (2026-10-05): Meta spend through to Bitrix24 sales on one screen.
-- It is granted to whoever reads «Reklama samarasi» today — but only to a
-- company-wide account: the endpoint refuses a TEAM or OWN one, so ticking it
-- for them would only hand out a link that answers 403. An account with no
-- explicit sections follows its role's default (src/lib/roles.ts), which
-- gains '/roistat' in the same commit.
UPDATE "user"
SET "sections" = array_append("sections", 'roistat')
WHERE 'marketing' = ANY ("sections")
  AND NOT ('roistat' = ANY ("sections"))
  AND "dataScope" = 'ALL';
