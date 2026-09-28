-- «RNP» (2026-09-28): the client's «СентябрРНП» sheet as a screen of its own.
-- The month plans and header settings it needs beyond FAKT 1 / FAKT 2, which
-- stay in "team_month_plan". See the RnpPlan model.
CREATE TABLE "rnp_plan" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "team" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "fromDay" INTEGER NOT NULL DEFAULT 1,
    "valueCenti" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "rnp_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rnp_plan_month_team_metric_fromDay_key" ON "rnp_plan"("month", "team", "metric", "fromDay");

-- The sheet is read by whoever reads «Lidlar» today (its «Sotuv · ROP» tab
-- is this sheet's short form). An account with no explicit sections follows
-- its role's default (src/lib/roles.ts), which gains '/rnp' in the same commit.
UPDATE "user"
SET "sections" = array_append("sections", 'rnp')
WHERE 'leads' = ANY ("sections")
  AND NOT ('rnp' = ANY ("sections"));

-- September 2026's header, as the client's sheet types it (B2, and the lead
-- value its «План бажарилиши» rows multiply by: 400 000 through 18.09,
-- 500 000 from 19.09). Values are × 100 (see the model). Editable on the
-- screen's «Rejalar» form like every other plan.
INSERT INTO "rnp_plan" ("id", "month", "team", "metric", "fromDay", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_seed_usd_rate_2026_09', DATE '2026-09-01', '', 'usd_rate', 1, 1220000, CURRENT_TIMESTAMP, 'migration'),
  ('rnp_seed_lead_value_2026_09_1', DATE '2026-09-01', '', 'lead_value', 1, 40000000, CURRENT_TIMESTAMP, 'migration'),
  ('rnp_seed_lead_value_2026_09_19', DATE '2026-09-01', '', 'lead_value', 19, 50000000, CURRENT_TIMESTAMP, 'migration')
ON CONFLICT ("month", "team", "metric", "fromDay") DO NOTHING;
