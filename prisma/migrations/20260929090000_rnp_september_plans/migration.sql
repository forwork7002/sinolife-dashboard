-- «RNP jadvali»: September 2026's plans, imported from column C of the
-- client's «СентябрРНП 26» sheet (read 2026-09-28). Values are × 100 in the
-- row's own unit (see the RnpPlan model); FAKT 1 / FAKT 2 go to
-- team_month_plan, which «Sotuv · ROP» reads too.
--
-- NOT imported, because the sheet's own audit (spec §6) shows them wrong:
--   · «Средний чек факт 2» typed as 11 500 000 in ten blocks (a ×10 copy
--     error, §6.14) and the «Транзакция / Конверция факт 2» plans the sheet
--     derives from it (e.g. Lola 52 orders for a 600 mln plan);
--   · zero plans (0 orders, 0 %) — «no plan» is the absence of a row.
-- CORRECTED: Мафтуна РОП's ФАКТ 1 / ФАКТ 2 plans typed as 400 000 / 320 000
-- are 400 000 000 / 320 000 000 (§6.19).
--
-- ON CONFLICT DO NOTHING: a plan somebody has already typed on the screen
-- is theirs and is never overwritten.

INSERT INTO "rnp_plan" ("id", "month", "team", "metric", "fromDay", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_seed_2026_09_gulzora_leads', DATE '2026-09-01', 'Gulzora', 'leads', 1, 140000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_conversion', DATE '2026-09-01', 'Gulzora', 'conversion', 1, 3000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_avg_cheque1', DATE '2026-09-01', 'Gulzora', 'avg_cheque1', 1, 160000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_orders', DATE '2026-09-01', 'Gulzora', 'orders', 1, 38800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_plan_pct', DATE '2026-09-01', 'Gulzora', 'plan_pct', 1, 7500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_headcount', DATE '2026-09-01', 'Gulzora', 'headcount', 1, 300, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_orders2', DATE '2026-09-01', 'Gulzora', 'orders2', 1, 38500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_conversion2', DATE '2026-09-01', 'Gulzora', 'conversion2', 1, 2700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_avg_cheque2', DATE '2026-09-01', 'Gulzora', 'avg_cheque2', 1, 130000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_leads', DATE '2026-09-01', 'Sevinch', 'leads', 1, 180900, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_conversion', DATE '2026-09-01', 'Sevinch', 'conversion', 1, 3000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_avg_cheque1', DATE '2026-09-01', 'Sevinch', 'avg_cheque1', 1, 130000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_orders', DATE '2026-09-01', 'Sevinch', 'orders', 1, 53800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_plan_pct', DATE '2026-09-01', 'Sevinch', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_headcount', DATE '2026-09-01', 'Sevinch', 'headcount', 1, 600, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_orders2', DATE '2026-09-01', 'Sevinch', 'orders2', 1, 50000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_conversion2', DATE '2026-09-01', 'Sevinch', 'conversion2', 1, 2800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_avg_cheque2', DATE '2026-09-01', 'Sevinch', 'avg_cheque2', 1, 120000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_leads', DATE '2026-09-01', 'Lola', 'leads', 1, 175500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_conversion', DATE '2026-09-01', 'Lola', 'conversion', 1, 3600, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_avg_cheque1', DATE '2026-09-01', 'Lola', 'avg_cheque1', 1, 120000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_orders', DATE '2026-09-01', 'Lola', 'orders', 1, 62500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_plan_pct', DATE '2026-09-01', 'Lola', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_headcount', DATE '2026-09-01', 'Lola', 'headcount', 1, 700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_leads', DATE '2026-09-01', 'Saidaziz', 'leads', 1, 175500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_conversion', DATE '2026-09-01', 'Saidaziz', 'conversion', 1, 3200, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_avg_cheque1', DATE '2026-09-01', 'Saidaziz', 'avg_cheque1', 1, 120000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_orders', DATE '2026-09-01', 'Saidaziz', 'orders', 1, 56700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_plan_pct', DATE '2026-09-01', 'Saidaziz', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_headcount', DATE '2026-09-01', 'Saidaziz', 'headcount', 1, 700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_leads', DATE '2026-09-01', 'Asliddin', 'leads', 1, 216000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_conversion', DATE '2026-09-01', 'Asliddin', 'conversion', 1, 1700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_avg_cheque1', DATE '2026-09-01', 'Asliddin', 'avg_cheque1', 1, 240000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_orders', DATE '2026-09-01', 'Asliddin', 'orders', 1, 36700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_plan_pct', DATE '2026-09-01', 'Asliddin', 'plan_pct', 1, 8500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_headcount', DATE '2026-09-01', 'Asliddin', 'headcount', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_leads', DATE '2026-09-01', 'Sadriddin', 'leads', 1, 216000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_conversion', DATE '2026-09-01', 'Sadriddin', 'conversion', 1, 1800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_avg_cheque1', DATE '2026-09-01', 'Sadriddin', 'avg_cheque1', 1, 240000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_orders', DATE '2026-09-01', 'Sadriddin', 'orders', 1, 39600, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_plan_pct', DATE '2026-09-01', 'Sadriddin', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_headcount', DATE '2026-09-01', 'Sadriddin', 'headcount', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_calls', DATE '2026-09-01', 'Charos', 'calls', 1, 1080000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_conversion', DATE '2026-09-01', 'Charos', 'conversion', 1, 200, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_avg_cheque1', DATE '2026-09-01', 'Charos', 'avg_cheque1', 1, 240000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_orders', DATE '2026-09-01', 'Charos', 'orders', 1, 25000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_plan_pct', DATE '2026-09-01', 'Charos', 'plan_pct', 1, 10000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_headcount', DATE '2026-09-01', 'Charos', 'headcount', 1, 600, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_leads', DATE '2026-09-01', 'Marjona', 'leads', 1, 135000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_conversion', DATE '2026-09-01', 'Marjona', 'conversion', 1, 900, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_avg_cheque1', DATE '2026-09-01', 'Marjona', 'avg_cheque1', 1, 160000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_orders', DATE '2026-09-01', 'Marjona', 'orders', 1, 12500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_plan_pct', DATE '2026-09-01', 'Marjona', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_headcount', DATE '2026-09-01', 'Marjona', 'headcount', 1, 100, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_leads', DATE '2026-09-01', 'Azizbek', 'leads', 1, 135000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_conversion', DATE '2026-09-01', 'Azizbek', 'conversion', 1, 3100, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_avg_cheque1', DATE '2026-09-01', 'Azizbek', 'avg_cheque1', 1, 160000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_orders', DATE '2026-09-01', 'Azizbek', 'orders', 1, 42500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_plan_pct', DATE '2026-09-01', 'Azizbek', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_headcount', DATE '2026-09-01', 'Azizbek', 'headcount', 1, 2000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_leads', DATE '2026-09-01', 'Maftuna', 'leads', 1, 150000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_avg_cheque1', DATE '2026-09-01', 'Maftuna', 'avg_cheque1', 1, 200000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_plan_pct', DATE '2026-09-01', 'Maftuna', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_headcount', DATE '2026-09-01', 'Maftuna', 'headcount', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_avg_cheque2', DATE '2026-09-01', 'Maftuna', 'avg_cheque2', 1, 180000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_leads', DATE '2026-09-01', 'Saida', 'leads', 1, 135000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_conversion', DATE '2026-09-01', 'Saida', 'conversion', 1, 2000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_avg_cheque1', DATE '2026-09-01', 'Saida', 'avg_cheque1', 1, 160000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_orders', DATE '2026-09-01', 'Saida', 'orders', 1, 27000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_plan_pct', DATE '2026-09-01', 'Saida', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_headcount', DATE '2026-09-01', 'Saida', 'headcount', 1, 500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_hayot_leads', DATE '2026-09-01', 'Hayot', 'leads', 1, 135000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_hayot_conversion', DATE '2026-09-01', 'Hayot', 'conversion', 1, 2000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_hayot_avg_cheque1', DATE '2026-09-01', 'Hayot', 'avg_cheque1', 1, 160000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_hayot_orders', DATE '2026-09-01', 'Hayot', 'orders', 1, 27000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_hayot_plan_pct', DATE '2026-09-01', 'Hayot', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_hayot_headcount', DATE '2026-09-01', 'Hayot', 'headcount', 1, 500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_calls', DATE '2026-09-01', 'Baza', 'calls', 1, 2376000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_conversion', DATE '2026-09-01', 'Baza', 'conversion', 1, 100, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_avg_cheque1', DATE '2026-09-01', 'Baza', 'avg_cheque1', 1, 160000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_orders', DATE '2026-09-01', 'Baza', 'orders', 1, 27000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_plan_pct', DATE '2026-09-01', 'Baza', 'plan_pct', 1, 8000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_headcount', DATE '2026-09-01', 'Baza', 'headcount', 1, 1500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_reg_leads', DATE '2026-09-01', '', 'reg_leads', 1, 3470000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_reg_qualified', DATE '2026-09-01', '', 'reg_qualified', 1, 1735000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_reg_qualified_pct', DATE '2026-09-01', '', 'reg_qualified_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_budget_collagen', DATE '2026-09-01', '', 'budget_collagen', 1, 3600000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_meta_leads_collagen', DATE '2026-09-01', '', 'meta_leads_collagen', 1, 4500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_cpl_collagen', DATE '2026-09-01', '', 'cpl_collagen', 1, 80, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_cac', DATE '2026-09-01', '', 'cac', 1, 2500, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_primary_orders2', DATE '2026-09-01', '', 'primary_orders2', 1, 309000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_primary_conversion', DATE '2026-09-01', '', 'primary_conversion', 1, 1800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_primary_fakt2', DATE '2026-09-01', '', 'primary_fakt2', 1, 382500000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_fakt2', DATE '2026-09-01', '', 'fakt2', 1, 382500000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_fakt1', DATE '2026-09-01', '', 'fakt1', 1, 478125000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_orders2', DATE '2026-09-01', '', 'orders2', 1, 309000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_base_fakt2', DATE '2026-09-01', '', 'base_fakt2', 1, 38250000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_warehouse_orders', DATE '2026-09-01', '', 'warehouse_orders', 1, 309000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_success_rate', DATE '2026-09-01', 'Gulzora', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_refusal_rate', DATE '2026-09-01', 'Gulzora', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_success_rate', DATE '2026-09-01', 'Sevinch', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_refusal_rate', DATE '2026-09-01', 'Sevinch', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_success_rate', DATE '2026-09-01', 'Saidaziz', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_refusal_rate', DATE '2026-09-01', 'Saidaziz', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_success_rate', DATE '2026-09-01', 'Lola', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_refusal_rate', DATE '2026-09-01', 'Lola', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_success_rate', DATE '2026-09-01', 'Asliddin', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_asliddin_refusal_rate', DATE '2026-09-01', 'Asliddin', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_success_rate', DATE '2026-09-01', 'Sadriddin', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sadriddin_refusal_rate', DATE '2026-09-01', 'Sadriddin', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_success_rate', DATE '2026-09-01', 'Charos', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_charos_refusal_rate', DATE '2026-09-01', 'Charos', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_success_rate', DATE '2026-09-01', 'Marjona', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_marjona_refusal_rate', DATE '2026-09-01', 'Marjona', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_success_rate', DATE '2026-09-01', 'Azizbek', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_azizbek_refusal_rate', DATE '2026-09-01', 'Azizbek', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_shohjaxon_success_rate', DATE '2026-09-01', 'Shohjaxon', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_shohjaxon_refusal_rate', DATE '2026-09-01', 'Shohjaxon', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_success_rate', DATE '2026-09-01', 'Saida', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saida_refusal_rate', DATE '2026-09-01', 'Saida', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_success_rate', DATE '2026-09-01', 'Baza', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_refusal_rate', DATE '2026-09-01', 'Baza', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_success_rate', DATE '2026-09-01', 'Maftuna', 'success_rate', 1, 9000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_refusal_rate', DATE '2026-09-01', 'Maftuna', 'refusal_rate', 1, 1000, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("month", "team", "metric", "fromDay") DO NOTHING;

INSERT INTO "team_month_plan" ("id", "month", "rop", "fakt1Minor", "fakt2Minor", "updatedAt", "updatedBy")
VALUES
  ('tmp_seed_2026_09_gulzora', DATE '2026-09-01', 'Gulzora', 62000000000, 50000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_sevinch', DATE '2026-09-01', 'Sevinch', 70000000000, 60000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_lola', DATE '2026-09-01', 'Lola', 75000000000, 60000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_saidaziz', DATE '2026-09-01', 'Saidaziz', 68000000000, 51000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_asliddin', DATE '2026-09-01', 'Asliddin', 88000000000, 74800000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_sadriddin', DATE '2026-09-01', 'Sadriddin', 95000000000, 76000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_charos', DATE '2026-09-01', 'Charos', 60000000000, 60000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_marjona', DATE '2026-09-01', 'Marjona', 20000000000, 15000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_azizbek', DATE '2026-09-01', 'Azizbek', 68000000000, 55000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_maftuna', DATE '2026-09-01', 'Maftuna', 40000000000, 32000000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_saida', DATE '2026-09-01', 'Saida', 43200000000, 32400000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_hayot', DATE '2026-09-01', 'Hayot', 43200000000, 32400000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('tmp_seed_2026_09_baza', DATE '2026-09-01', 'Baza', 43200000000, 32400000000, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("month", "rop") DO NOTHING;

-- The lead's value changed on 14.09, not 19.09: the sheet's «План
-- бажарилиши» divides by 400 000 in columns G–S (01–13.09) and by 500 000
-- from T (14.09) — e.g. Гулзора on 14.09: 10 900 000 ÷ (23 × 500 000) = 95 %,
-- as the sheet prints. The first seed said 19. Matched on the seeded VALUE,
-- not on who saved it last: the «Rejalar» form re-sends every setting on
-- each save, so a manager who only typed a team's plan would otherwise have
-- «adopted» the wrong day and kept it.
UPDATE "rnp_plan"
SET "fromDay" = 14, "updatedAt" = CURRENT_TIMESTAMP
WHERE "month" = DATE '2026-09-01' AND "team" = '' AND "metric" = 'lead_value'
  AND "fromDay" = 19 AND "valueCenti" = 50000000
  AND NOT EXISTS (
    SELECT 1 FROM "rnp_plan" x
    WHERE x."month" = DATE '2026-09-01' AND x."team" = '' AND x."metric" = 'lead_value' AND x."fromDay" = 14
  );
