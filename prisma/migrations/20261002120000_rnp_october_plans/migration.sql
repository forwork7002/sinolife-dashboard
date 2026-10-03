-- «RNP jadvali»: October 2026's plans — September's, copied once (2026-10-02,
-- the client's decision).
--
-- WHY. «Rejalar» was removed on 2026-10-01, so a new month opens with no
-- plans until somebody types every cell in the grid: October had none — plan,
-- index and day plan empty on every row. The client's own «Октябр» tab is a
-- copy of September: 85 of its typed plans equal the September rows here, and
-- only two changed — «Бюджет Collagen» 36 000 $ → 16 000 $ and «Колич Collagen
-- лид» 45 000 → 18 000. The tab's other differences are NOT taken from it:
-- its ×10 «Средний чек факт 2» and Мафтуна's 400 000 / 320 000 FAKT plans are
-- the sheet's typos that September's rows already correct
-- (20260929090000_rnp_september_plans), and its plan % (75–85) differs from
-- September's because an admin saved 100 there on 01.10. September's rows
-- are copied as they stand; any cell can be retyped in the grid
-- (POST /rnp/plan).
--
-- WHAT IS COPIED: every September plan from day 1 under a metric the screen
-- reads (`RNP_PLAN_METRICS` in src/server/domain/rnp/rnpSheet.ts as of this
-- migration), except `lead_value` — a setting, inherited month to month on
-- its own (`RnpRepository.inheritedLeadValues`) — and `usd_rate`, retired for
-- the Central Bank's rate. Rows under keys nothing reads (the old form's
-- orders, conversions, refusal_rate …) stay in September. Every FAKT 1 / FAKT 2
-- plan of `team_month_plan` too.
--
-- ON CONFLICT DO NOTHING throughout: a plan already typed on the screen is
-- theirs and is never overwritten — and the two changed values go in first,
-- so the copy cannot shadow them. Values are × 100 in the row's own unit (see
-- the RnpPlan model). Ids are deterministic, as the September import's were.

-- 1. The two plans the client changed for October.
INSERT INTO "rnp_plan" ("id", "month", "team", "metric", "fromDay", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_seed_2026_10_company_budget_collagen', DATE '2026-10-01', '', 'budget_collagen', 1, 1600000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_10_company_meta_leads_collagen', DATE '2026-10-01', '', 'meta_leads_collagen', 1, 1800000, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("month", "team", "metric", "fromDay") DO NOTHING;

-- 2. Every other September plan the screen reads.
INSERT INTO "rnp_plan" ("id", "month", "team", "metric", "fromDay", "valueCenti", "updatedAt", "updatedBy")
SELECT 'rnp_copy_2026_10_' || md5(p."team" || '|' || p."metric" || '|' || p."fromDay"),
       DATE '2026-10-01', p."team", p."metric", p."fromDay", p."valueCenti", CURRENT_TIMESTAMP, 'sheet_import'
FROM "rnp_plan" p
WHERE p."month" = DATE '2026-09-01'
  AND p."fromDay" = 1
  AND p."metric" IN (
    'budget', 'budget_collagen', 'budget_zextra', 'meta_leads', 'meta_leads_collagen', 'meta_leads_zextra',
    'cpl', 'cpl_collagen', 'cpl_zextra', 'cac', 'marketing_share',
    'reg_qualified', 'reg_qualified_pct', 'reg_group_qualified',
    'marketing_plan_pct', 'targetolog_pct', 'marketer_pct',
    'brand_fakt1', 'brand_primary_fakt2', 'brand_leads', 'brand_qualified', 'brand_qualified_pct', 'brand_cpl',
    'brand_orders2', 'brand_conversion', 'brand_cheque2', 'brand_cost', 'brand_cac', 'brand_cost_share',
    'leads', 'calls', 'avg_cheque1', 'avg_cheque2', 'fakt1', 'fakt2', 'headcount', 'plan_pct', 'success_rate',
    'warehouse_orders'
  )
ON CONFLICT ("month", "team", "metric", "fromDay") DO NOTHING;

-- 3. Every team's FAKT 1 / FAKT 2 plan.
INSERT INTO "team_month_plan" ("id", "month", "rop", "fakt1Minor", "fakt2Minor", "updatedAt", "updatedBy")
SELECT 'tmp_copy_2026_10_' || md5(t."rop"),
       DATE '2026-10-01', t."rop", t."fakt1Minor", t."fakt2Minor", CURRENT_TIMESTAMP, 'sheet_import'
FROM "team_month_plan" t
WHERE t."month" = DATE '2026-09-01'
ON CONFLICT ("month", "rop") DO NOTHING;
