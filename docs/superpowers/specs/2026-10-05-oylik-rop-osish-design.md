# «Sotuvchilar oyligi» — ROP lar boʻyicha, 15 kunlik, oʻsish

2026-10-05. The user's request: «ROP larga ajratilsin, ichida sotuvchilari
boʻlsin va aniq hisoblansin oylik … 15 kunlik ni ham tanla, oyning 1 chi
kunidan … kim qanchaga oʻsganligi … grafiklar bilan».

Answers (AskUserQuestion, same day):

- 15 kunlik is its own tab: «Haftalik | 15 kunlik | Oylik»; inside it
  «1–15» (default) and «16–oxiri». Half table 22.5 / 30 / 35 mln.
- Growth is against the previous like period: week → previous week,
  1–15 → previous month's 1–15, 16–oxiri → previous month's 16–end,
  month → previous month.
- ROP view: one collapsible card per ROP, its sellers inside.

## What does not change

- The pay rule (`domain/payroll/sellerPayroll`), FAKT 2 as the only basis,
  the queue cohort, the fold of team slices (a seller is under the ROP of
  their newest order and paid once on their whole FAKT 2), the endpoints'
  query parameters and the `analytics:read:all` gate.

## Backend

- `period.ts`
  - `previousPayrollMonth(yearMonth)` → `YYYY-MM` of the month before.
  - `previousPayrollMonday(mondayIso)` → the Monday a week earlier.
  - `comparablePayrollPeriod(current, previous, now)` — while `current` is
    open, `previous` is cut to the same elapsed time (floored to the
    minute, so the memo key is stable for a minute); a closed period
    compares whole with whole; a period not yet started gets an empty
    previous window.
- Routes build the previous window and hand both to the service, and echo it
  as `meta.comparisonPeriod` (an existing `ResponseMeta` field).
- `PayrollService` reads the rating for both windows in parallel, folds both,
  applies the same scheme to both, and adds:
  - per seller `previous: { fakt2, total } | null` (null = no delivered
    money then), `fakt2Delta`, `totalDelta` (`growth` → `toDeltaDto`);
  - `teams[]`: per ROP (null ROP last), current sellers / FAKT 2 / percent /
    fixed / total, previous sellers / FAKT 2 / total and both deltas. The
    previous side groups the previous period's sellers by THEIR label then;
  - `previous: { sellers, fakt2, total }` and deltas on the totals.
  - The memo key gains the previous window.

## Frontend

- Tabs «Haftalik | 15 kunlik | Oylik»; the 15 kunlik tab carries the month
  stepper and «1–15 | 16–oxiri».
- Hero: as now, with a delta pill on the fund, FAKT 2, foiz and fiksa, and the
  comparison window named («1–5 sentabr bilan»).
- «ROP lar taqqoslash»: horizontal bars per ROP, this period solid, previous
  period a muted bar under it, delta at the end (recharts).
- «Eng koʻp oʻsganlar / tushganlar»: top 5 / bottom 5 by FAKT 2 change in soʻm
  (sellers present in both periods), a diverging bar.
- ROP cards: header = ROP, fund, delta, sellers, FAKT 2; body = the existing
  per-seller table plus an «Oʻsish» column. Open by default; a search opens
  every card that has a match and hides the rest.
- The old «ROP lar boʻyicha» table goes (the cards replace it). Rule card and
  copy button stay; the copy gains «Oʻtgan davr FAKT 2» and «Oʻtgan JAMI».
- A running period prints one line: FAKT 2 of the newer cohort is still being
  delivered, so mid-period growth reads low.

## Verification

- Domain tests for the three period helpers (month/year edge, open/closed/
  future); service tests for previous rows, teams, deltas, totals identity
  (Σ teams = totals).
- `npm run verify`, `npm run build`, headless 375 / 1280 with a mocked
  payload, then the live endpoint vs «Sotuvchilar reytingi» FAKT 2.
