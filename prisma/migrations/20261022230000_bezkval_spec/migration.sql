-- «Безквал» by the client's written spec (2026-10-22, `bezkval-lid-spec.md`):
-- a lead is a deal BORN in Регистрация / Первичный отдел (or standing there
-- now), its day is «Лид тушган сана» when Lead Guard brought it late, and one
-- client is every number their contact holds.
--
-- Two nullable columns on "deal" (ADD COLUMN with no default rewrites
-- nothing; the worker's DEALS_BACKFILL fills them), a new table, and one
-- expression index on "customer". lock_timeout fails the deploy fast instead
-- of queueing behind a sync write.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "leadVia" TEXT;
ALTER TABLE "deal" ADD COLUMN     "dealPhone" TEXT;

-- CreateTable
CREATE TABLE "crm_deal_birth" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "externalId" TEXT NOT NULL,
    "dealExternalId" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "stageExternalId" TEXT NOT NULL,
    "bornAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_birth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_deal_birth_dealExternalId_idx" ON "crm_deal_birth"("dealExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deal_birth_externalSource_externalId_key" ON "crm_deal_birth"("externalSource", "externalId");

/*
  EVERY NUMBER OF A CONTACT, AS «БЕЗКВАЛ» KEYS IT: digits only, the last nine,
  a number shorter than nine dropped. «Yangi / takror» asks which contacts
  hold any of a day's ~2 400 numbers; without an index that is every one of
  the ~330 000 contacts unnested and normalised per request. NOT in
  schema.prisma — Prisma cannot express an expression index (see
  20260831150000_global_search_indexes): `prisma migrate dev` reports it as
  drift, and dropping it is what would be wrong. IMMUTABLE is true: the
  function reads nothing but its argument.

  Plain CREATE INDEX, not CONCURRENTLY: Prisma runs a migration inside a
  transaction. The build holds writes to "customer" for its few seconds.
*/
CREATE OR REPLACE FUNCTION phone_nines(phones text[]) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT COALESCE(array_agg(DISTINCT right(x.d, 9)), '{}'::text[])
      FROM (SELECT regexp_replace(p, '[^0-9]', '', 'g') AS d FROM unnest(phones) AS p) x
     WHERE length(x.d) >= 9
  $$;

CREATE INDEX IF NOT EXISTS "customer_phone_nines_idx"
  ON "customer" USING gin (phone_nines("phones" || "phone"));

RESET lock_timeout;
