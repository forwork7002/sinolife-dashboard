-- «RNP jadvali»: the registration «guruh» rows (sheet rows 47–73).
CREATE TABLE "rnp_registrar_group" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "registrar" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "rnp_registrar_group_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rnp_registrar_group_month_registrar_key" ON "rnp_registrar_group"("month", "registrar");

-- September's groups where the sheet's own kval matched the portal exactly on
-- 02.09 and 03.09.2026 (registrar = the UF_CRM_1747975291848 label):
--   Sevinch guruh = Фарангиз + Назокат (58/58, 65/65); Aziz guruh = Маржона
--   (72/72, 71/71); Lola guruh = Дилафруз + Мафтуна (49/49, 51/51);
--   Saidaziz guruh = Эъзоза + Севинч (33/33, 39/39); Zextra = Рухшона +
--   Ситора (rows 72/73: 17 = 17, 20 = 20).
-- Gulzora guruh and Maftuna guruh matched no set of registrars; the client
-- chose (2026-09-29) to assign them on the screen.
INSERT INTO "rnp_registrar_group" ("id", "month", "registrar", "group", "updatedAt", "updatedBy")
VALUES
  ('rnp_rg_2026_09_0', DATE '2026-09-01', 'Фарангиз', 'Sevinch', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_1', DATE '2026-09-01', 'Назокат', 'Sevinch', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_2', DATE '2026-09-01', 'Маржона', 'Aziz', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_3', DATE '2026-09-01', 'Дилафруз', 'Lola', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_4', DATE '2026-09-01', 'Мафтуна', 'Lola', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_5', DATE '2026-09-01', 'Эъзоза', 'Saidaziz', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_6', DATE '2026-09-01', 'Севинч', 'Saidaziz', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_7', DATE '2026-09-01', 'Рухшона', 'Zextra', CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_rg_2026_09_8', DATE '2026-09-01', 'Ситора', 'Zextra', CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("month", "registrar") DO NOTHING;

-- The typed «без квал» cells (the group's intake; rows 50, 53, … 65) and
-- the Zextra desk's lead count (row 69) — no Bitrix24 field holds a lead's
-- registrar before it is qualified, so these stay typed.
INSERT INTO "rnp_manual_day" ("id", "day", "team", "metric", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_day_20260902_sevinch_reg_group_intake', DATE '2026-09-02', 'Sevinch', 'reg_group_intake', 15600, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260903_sevinch_reg_group_intake', DATE '2026-09-03', 'Sevinch', 'reg_group_intake', 13900, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260904_sevinch_reg_group_intake', DATE '2026-09-04', 'Sevinch', 'reg_group_intake', 18100, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260905_sevinch_reg_group_intake', DATE '2026-09-05', 'Sevinch', 'reg_group_intake', 11000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260906_sevinch_reg_group_intake', DATE '2026-09-06', 'Sevinch', 'reg_group_intake', 0, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260907_sevinch_reg_group_intake', DATE '2026-09-07', 'Sevinch', 'reg_group_intake', 11000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260908_sevinch_reg_group_intake', DATE '2026-09-08', 'Sevinch', 'reg_group_intake', 20000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260909_sevinch_reg_group_intake', DATE '2026-09-09', 'Sevinch', 'reg_group_intake', 16300, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260910_sevinch_reg_group_intake', DATE '2026-09-10', 'Sevinch', 'reg_group_intake', 14000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260914_sevinch_reg_group_intake', DATE '2026-09-14', 'Sevinch', 'reg_group_intake', 8800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260902_gulzora_reg_group_intake', DATE '2026-09-02', 'Gulzora', 'reg_group_intake', 8200, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260903_gulzora_reg_group_intake', DATE '2026-09-03', 'Gulzora', 'reg_group_intake', 7400, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260904_gulzora_reg_group_intake', DATE '2026-09-04', 'Gulzora', 'reg_group_intake', 11700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260902_aziz_reg_group_intake', DATE '2026-09-02', 'Aziz', 'reg_group_intake', 25000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260903_aziz_reg_group_intake', DATE '2026-09-03', 'Aziz', 'reg_group_intake', 20000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260904_aziz_reg_group_intake', DATE '2026-09-04', 'Aziz', 'reg_group_intake', 11800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260902_maftuna_reg_group_intake', DATE '2026-09-02', 'Maftuna', 'reg_group_intake', 8200, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260903_maftuna_reg_group_intake', DATE '2026-09-03', 'Maftuna', 'reg_group_intake', 7400, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260904_maftuna_reg_group_intake', DATE '2026-09-04', 'Maftuna', 'reg_group_intake', 6600, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260910_maftuna_reg_group_intake', DATE '2026-09-10', 'Maftuna', 'reg_group_intake', 3000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260902_lola_reg_group_intake', DATE '2026-09-02', 'Lola', 'reg_group_intake', 16000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260903_lola_reg_group_intake', DATE '2026-09-03', 'Lola', 'reg_group_intake', 14300, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260904_lola_reg_group_intake', DATE '2026-09-04', 'Lola', 'reg_group_intake', 15200, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260910_lola_reg_group_intake', DATE '2026-09-10', 'Lola', 'reg_group_intake', 11300, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260902_saidaziz_reg_group_intake', DATE '2026-09-02', 'Saidaziz', 'reg_group_intake', 14800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260903_saidaziz_reg_group_intake', DATE '2026-09-03', 'Saidaziz', 'reg_group_intake', 11800, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260904_saidaziz_reg_group_intake', DATE '2026-09-04', 'Saidaziz', 'reg_group_intake', 18100, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260902_company_reg_zextra_leads', DATE '2026-09-02', '', 'reg_zextra_leads', 13900, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260903_company_reg_zextra_leads', DATE '2026-09-03', '', 'reg_zextra_leads', 22700, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_day_20260904_company_reg_zextra_leads', DATE '2026-09-04', '', 'reg_zextra_leads', 23800, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("day", "team", "metric") DO NOTHING;

-- Their plans, column C. NOT imported: C69 = 7 (a Zextra lead plan of seven
-- is a typo) and C70 = 17 350 (a copy of Collagen's C48).
INSERT INTO "rnp_plan" ("id", "month", "team", "metric", "fromDay", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_seed_2026_09_sevinch_reg_group_intake', DATE '2026-09-01', 'Sevinch', 'reg_group_intake', 1, 500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_reg_group_qualified', DATE '2026-09-01', 'Sevinch', 'reg_group_qualified', 1, 250000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_sevinch_reg_group_pct', DATE '2026-09-01', 'Sevinch', 'reg_group_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_reg_group_intake', DATE '2026-09-01', 'Gulzora', 'reg_group_intake', 1, 500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_reg_group_qualified', DATE '2026-09-01', 'Gulzora', 'reg_group_qualified', 1, 250000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_gulzora_reg_group_pct', DATE '2026-09-01', 'Gulzora', 'reg_group_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_aziz_reg_group_intake', DATE '2026-09-01', 'Aziz', 'reg_group_intake', 1, 500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_aziz_reg_group_qualified', DATE '2026-09-01', 'Aziz', 'reg_group_qualified', 1, 250000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_aziz_reg_group_pct', DATE '2026-09-01', 'Aziz', 'reg_group_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_reg_group_intake', DATE '2026-09-01', 'Maftuna', 'reg_group_intake', 1, 500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_reg_group_qualified', DATE '2026-09-01', 'Maftuna', 'reg_group_qualified', 1, 250000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_maftuna_reg_group_pct', DATE '2026-09-01', 'Maftuna', 'reg_group_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_reg_group_intake', DATE '2026-09-01', 'Lola', 'reg_group_intake', 1, 500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_reg_group_qualified', DATE '2026-09-01', 'Lola', 'reg_group_qualified', 1, 250000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_lola_reg_group_pct', DATE '2026-09-01', 'Lola', 'reg_group_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_reg_group_intake', DATE '2026-09-01', 'Saidaziz', 'reg_group_intake', 1, 500000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_reg_group_qualified', DATE '2026-09-01', 'Saidaziz', 'reg_group_qualified', 1, 250000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_saidaziz_reg_group_pct', DATE '2026-09-01', 'Saidaziz', 'reg_group_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_рухшона_reg_registrar_qualified', DATE '2026-09-01', 'Рухшона', 'reg_registrar_qualified', 1, 240000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_ситора_reg_registrar_qualified', DATE '2026-09-01', 'Ситора', 'reg_registrar_qualified', 1, 240000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_company_reg_zextra_pct', DATE '2026-09-01', '', 'reg_zextra_pct', 1, 5000, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("month", "team", "metric", "fromDay") DO NOTHING;
