-- How much data an account reads, split out of the role.
--
-- Back-filled so nobody's access changes by accident in either direction:
--
--   * an account already scoped to one salesperson (SALES with a linked
--     employee) keeps that scope, spelled out explicitly as OWN;
--   * every other account gets ALL, which is what ADMIN and MANAGER already
--     had, and what a SALES account with no linked employee should have had
--     instead of the nothing it was silently given.
CREATE TYPE "DataScope" AS ENUM ('ALL', 'OWN');

ALTER TABLE "user" ADD COLUMN "dataScope" "DataScope" NOT NULL DEFAULT 'ALL';

UPDATE "user"
   SET "dataScope" = 'OWN'
 WHERE "role" = 'SALES'
   AND "employeeId" IS NOT NULL;
