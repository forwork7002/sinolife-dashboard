-- «RNP jadvali»: what one connected call of a БАЗА team is worth, as the
-- client's sheet prices it (2026-10-02, the client's decision).
--
-- WHY. A БАЗА team's «План бажарилиши» is FAKT 1 ÷ (connected calls × a
-- value), and the sheet's value is the team's own constant, not the company's
-- lead value: Малика's block divides by `G156*400000` every day of September,
-- Фаррух's by `G235*400000` through 26.09 and `*200000` from 27.09, and the
-- «Октябр» tab keeps 400 000 for both. With only the company's rows (400 000,
-- 500 000 from 14.09) the screen priced their calls at 500 000 and read 20 %
-- under the client's sheet on every reliable day — 60 % under for Фаррух on
-- 27–30.09.
--
-- A team's own `lead_value` rows win over the company's (`leadValueDays` in
-- rnpSheet.ts), and a month with none of its own inherits each team's last
-- value (`RnpRepository.inheritedLeadValues`). October is written out, not
-- left to that: it would inherit Фаррух's LAST September row, 200 000.
--
-- ON CONFLICT DO NOTHING: a value already saved for the month is kept.
-- Values are soʻm × 100.
INSERT INTO "rnp_plan" ("id", "month", "team", "metric", "fromDay", "valueCenti", "updatedAt", "updatedBy")
VALUES
  ('rnp_seed_2026_09_charos_lead_value_1', DATE '2026-09-01', 'Charos', 'lead_value', 1, 40000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_lead_value_1', DATE '2026-09-01', 'Baza', 'lead_value', 1, 40000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_09_baza_lead_value_27', DATE '2026-09-01', 'Baza', 'lead_value', 27, 20000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_10_charos_lead_value_1', DATE '2026-10-01', 'Charos', 'lead_value', 1, 40000000, CURRENT_TIMESTAMP, 'sheet_import'),
  ('rnp_seed_2026_10_baza_lead_value_1', DATE '2026-10-01', 'Baza', 'lead_value', 1, 40000000, CURRENT_TIMESTAMP, 'sheet_import')
ON CONFLICT ("month", "team", "metric", "fromDay") DO NOTHING;
