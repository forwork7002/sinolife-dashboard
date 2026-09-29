-- «RNP jadvali»: the brand P&L (sheet rows 394–445).
--
-- Its three percentages, as the sheet's formulas state them: the marketing
-- cost plan is 11 % of ФАКТ 2 (row 407), the targetologist is paid 10 % of
-- the ad budget (row 410: 692 960 = 10 % of 6 929 600 on 01.09), the
-- marketer 1 % of ФАКТ 2 (row 416). Editable on the screen's «Rejalar» form.
INSERT INTO "rnp_plan" ("id", "month", "team", "metric", "fromDay", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_seed_2026_09_company_marketing_plan_pct', DATE '2026-09-01', '', 'marketing_plan_pct', 1, 1100, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_targetolog_pct', DATE '2026-09-01', '', 'targetolog_pct', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_marketer_pct', DATE '2026-09-01', '', 'marketer_pct', 1, 100, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("month", "team", "metric", "fromDay") DO NOTHING;

-- The cost lines the sheet has typed for September, each as a lump on 01.09
-- the way the sheet enters it: Коллаген «Маркетинг харажатлар» 5 075 000
-- (row 414); Зехтра «Брендфейс» 3 560 000 (440) and «Маркетинг харажатлар»
-- 5 040 000 (441). Soʻm × 100.
INSERT INTO "rnp_manual_day" ("id", "day", "team", "metric", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_day_20260901_collagen_cost_marketing', DATE '2026-09-01', 'Collagen', 'cost_marketing', 507500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260901_zextra_cost_brandface', DATE '2026-09-01', 'Zextra', 'cost_brandface', 356000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260901_zextra_cost_marketing', DATE '2026-09-01', 'Zextra', 'cost_marketing', 504000000, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("day", "team", "metric") DO NOTHING;
