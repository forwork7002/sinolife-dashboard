-- «Lidlar» (2026-09-25): «Lid kogortasi» and «Sotuv · ROP» moved off
-- «Reklama samarasi» onto a section of their own. Whoever was explicitly
-- granted «Reklama samarasi» could open those two tabs yesterday; granting
-- them the new section keeps exactly that access. An account with no explicit
-- sections follows its role's default (src/lib/roles.ts), which gains
-- '/leads' in the same commit, so it needs nothing here.
UPDATE "user"
SET "sections" = array_append("sections", 'leads')
WHERE 'marketing' = ANY ("sections")
  AND NOT ('leads' = ANY ("sections"));
