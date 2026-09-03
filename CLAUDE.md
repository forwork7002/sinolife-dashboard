# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

**SinoLife Sales Intelligence** — a Next.js App Router dashboard over the
`obey.bitrix24.kz` CRM plus a Roistat marketing ledger. UI language is Uzbek,
currency UZS, every reporting window computed in `Asia/Tashkent`. ~420 000
deals across nine pipelines.

**Read the comment above the code before changing it.** This codebase records
*why* a decision was made, and a large share of those comments name a specific
production failure that forced it. Several took more than one attempt to get
right. Re-deriving what a comment already settles is the expensive mistake here.

---

## Commands

```bash
npm run verify        # typecheck + lint + test — one third of the gate
npm run build         # prisma generate + next build
npm run db:check      # 11 data-integrity invariants (needs a database)
```

`docs/DEVELOPMENT.md` defines the gate as **all three**, and nothing runs them
for you — there is no CI, no git hook, and `.do/app.yaml` has
`deploy_on_push: true` on `main`. A push to `main` builds, runs
`prisma migrate deploy` against the production database, and goes live.

```bash
npx vitest run tests/domain/money.test.ts             # one file
npx vitest run tests/domain/money.test.ts -t "rounds" # one test by name
```

**Run vitest from the repo root only.** `vitest.config.mts` uses
`process.cwd()` for both the `tests/**` include glob and the `@` alias, so from
a subdirectory you get "No test files found". No test touches a database; the
suite runs in ~9 s with nothing else installed.

**On a fresh clone, `npm run db:generate` (or `npm run build`) comes first.**
The Prisma client is generated into `src/generated/prisma`, which is
gitignored, and there is no `postinstall`. Until it exists, typecheck, lint and
the tests all fail. Regenerate after every schema edit and restart `next dev` —
a running dev server holds the old client and reports `Unknown argument`.

```bash
npm run bitrix:worker                  # the production sync loop, one tick a minute
npm run bitrix:import                  # one incremental pass by hand
npm run bitrix:import -- --full --reset
npm run bitrix:resync -- STAGES DEALS  # one entity, after a mapping fix
npm run db:seed:users -- --reset-password
```

---

## The one rule

**The frontend never talks to Bitrix24.** It talks to `/api/v1`. The API talks
to our database. Only the sync engine talks to a CRM, and only through
`CrmProvider`.

```
Bitrix24 / Demo  →  CrmProvider  →  SyncEngine  →  PostgreSQL
                                                        ↓
                    Repositories   the only layer that touches Prisma
                                                        ↓
                    Domain         pure functions, no framework imports
                                                        ↓
                    Services       orchestration → DTO
                                                        ↓
                    /api/v1/*      validate → authorise → delegate → envelope
                                                        ↓
                    React client   'use client', TanStack Query, never imports server code
```

### The boundaries are ESLint rules, not conventions

`eslint.config.mjs` — its header says why: *"A single `import { prisma }` inside
a React component would put database access in the browser bundle, and a single
`import { env }` would put the Bitrix24 webhook token there with it."*

| Scope | May not import |
|---|---|
| `src/server/domain/**` | Prisma, `next`, `react`, `@/server/config/*`, `@/server/repositories/*`, `@/server/integrations/*` |
| `src/components/**`, `src/features/**`, `src/lib/**` | `@/server/*`, Prisma |
| `src/app/api/**` | Prisma directly — go through repositories so scoping cannot be bypassed |
| anywhere but `providerFactory.ts` | `env.DATA_SOURCE` (an AST selector) |

`tests/**` is exempt on purpose — so a test that crosses a boundary will not
catch the violation.

`src/lib` sits on the **client** side, yet server modules import from it
(`sections`, `api`, `passwordPolicy` are the shared vocabulary). The sharing is
one-directional, and the repo pays for it by hand-mirroring unions:
`src/lib/roles.ts`, `src/lib/dataScope.ts` and the `ConfirmationOutcome` union
in `src/lib/api.ts` restate types from `@/server/domain/types`. **Nothing checks
the mirror** — edit both sides.

### Read these first, in order

1. `docs/ARCHITECTURE.md` — the layer contract (but see *Doc rot* below)
2. `eslint.config.mjs` — where that contract is actually enforced
3. `src/server/http/handler.ts` — `getHandler(access, schema, handle)`
4. `src/app/api/v1/dashboard/overview/route.ts` — the canonical route, 23 lines
5. `src/server/domain/period/period.ts` — every date boundary in the product
6. `src/server/integrations/crm/bitrix24/mapping.ts` — the portal's vocabulary
7. `prisma/schema.prisma` — the DESIGN CONTRACT block at the top

### Authorisation

`getHandler(access, …)` takes `access = { permission, section }`. **Both are
required fields**; `section: null` must be written out, so adding an endpoint is
always a decision about who reaches it. Two drill-down routes
(`deals/[id]`, `employees/[id]`) hand-roll `requirePermission` +
`assertSection` because they authorise per-resource — and
`tests/http/routeAccess.test.ts` is the only thing guarding that path. It also
pins the ungated list exactly, so **adding an endpoint with `section: null`
fails that test until you extend the array.**

Route handlers spread scope **last**:

```ts
{ ...ctx.query, ...ctx.scope }
```

That ordering is the mechanism — a `SALES` caller passing someone else's
`employeeIds` still gets their own restriction ANDed on top. `src/middleware.ts`
is *not* the boundary: it only checks that a session cookie is present so a
signed-out visitor is redirected instead of watching a shell flash.

### Client data flow

Every `src/features/*/[A-Z]*Page.tsx` starts with `'use client'`. There is no
server-component fetching, no prefetch/hydration boundary — pages are thin
shells, all data comes from `/api/v1` in the browser.

`src/app/providers.tsx` sets the cadence **globally**: `refetchInterval: 60_000`
with `staleTime: 55_000`, matched to the sync worker's one-minute tick.
Per-page `refetchInterval` overrides were deliberately removed. Three
exceptions, each with a reason in place: `/meta/alerts` (one request a minute
for the whole app, keyed constantly), `/meta/filters` (5 min — reference data
changes on sync), and the ⌘K search.

---

## The eleven screens, and what each one dates by

Every page is a thin shell under `src/app/`, the UI lives in
`src/features/<dir>/<Name>Page.tsx`, and each page calls
`requireSection('<id>')` — a courtesy redirect, not the boundary; the real gate
is the route's `ACCESS`. All of them also inherit `/meta/filters`,
`/meta/alerts` and the ⌘K `/search` from the shell.

**The last column is the one to check before writing a query.** A screen's
reporting window does not mean the same thing on every screen, and picking the
wrong basis is the mistake that produces plausible, wrong numbers.

| Screen | URL | Feature | Endpoint(s) | Service → Repository | Window filters on |
|---|---|---|---|---|---|
| Boshqaruv markazi | `/` | `overview/CommandCentrePage` | `/dashboard/command` | CommandCentre, Insights, Concentration → Insights, Concentration | **mixed, 3 clocks** — `createdAtSource` (intake, funnel, logistics), `closedAt` (delivered revenue, products, headcount), `queued_at` (confirmation + rejection band) |
| Savdo tahlili | `/analytics/sales` | `sales/SalesPage` | `/analytics/sales`, `/analytics/sources`, `/analytics/products`, `/insights/pulse`, `/insights/flow` | Analytics, Pulse → Deal, Reference, Pulse | **mixed** — a permissive pre-filter admits anything touching the window, then each measure picks its own basis |
| Mijoz qaytishi | `/analytics/cohort` | `cohort/CohortPage` | `/insights/cohorts`, `/insights/concentration` | Insights, Concentration → Insights, Concentration | `closedAt`, on revenue-bearing WON deals only — nothing here reads `createdAtSource` |
| Kanallar | `/marketing` | `marketing/MarketingPage` | `/marketing/overview`, `/marketing/breakdown`, `/marketing/verify` | Marketing → Marketing | `marketing_daily."date"` — the Roistat sheet's own lead date. **Not Bitrix24 data at all** |
| Yalpi marja | `/margin` | `margin/MarginPage` | `/insights/margin` | Insights → Insights | `closedAt`, WON + `countsAsRevenue` |
| Logistika | `/logistics` | `logistics/LogisticsPage` | `/insights/logistics` | Insights → Insights, Reference | `createdAtSource`, uniformly in all three queries |
| Tasdiqlash navbati | `/confirmation` | `confirmation/ConfirmationPage` | `/insights/confirmations/orders` | Insights → Insights | **the arrival in `C4:NEW`** — the latest `deal_stage_history` row whose stage signals `CONFIRM_NEW`; `?queue=backlog` (where the bell lands) drops the window entirely |
| Joʻnatish nuqtalari | `/warehouse` | `warehouse/WarehousePage` | `/insights/dispatch` | Insights → Insights | `createdAtSource` — a creation cohort graded by the deal's **current** stage |
| Sotuvchilar reytingi | `/sellers` | `sellers/SellersPage` | `/analytics/sellers` | SellerBoard, Analytics → SellerBoard | `createdAtSource` — order intake, same column for board, drill-down and comparison |
| KPI rejalari | `/kpi` | `kpi/KpiPage` | `/kpi` | Kpi, Analytics → Reference, Deal | **the plan's own `periodStart`/`periodEnd`** — the dashboard window only *selects* which plan is live |
| Struktura | `/structure` | `structure/StructurePage` | `/insights/structure` | Insights → Insights | **mixed** — money columns on `closedAt`, others undated |

`/` is the one page with **no** `requireSection`: it calls `firstSectionFor()`
and forwards, because it is where every login and every bookmark lands, and a
guard there would bounce the user off their own home page. Its section id is
enforced at the API instead (`dashboard/command/route.ts`).

Per-screen traps worth knowing before you touch one:

- **Boshqaruv markazi** — the 45-second in-process cache key carries the
  *preset*, not just the window. Dropping it served «Shu hafta» the numbers for
  «Bugun» (78 where 103 was right, and the reverse).
- **Savdo tahlili** — the only endpoint whose money does not pass through
  `toMoneyDto`.
- **Mijoz qaytishi** — «Faol bazada» is a separate DISTINCT-customer total, not
  the sum of the ladder bars.
- **Kanallar** — the dashboard-wide `preset` and `filial` do **not** reach this
  screen; it resolves its own window from `from`/`to`/`today`.
- **Yalpi marja** — discounts are split by sign in SQL; never net them or
  re-sum them client-side.
- **Logistika** — `refused` vs `cancelledEarly` is decided by whether the deal
  ever has a dispatch-role stage-history row, not by its current stage.
- **Joʻnatish nuqtalari** — delivery rate's denominator is *resolved* orders;
  in-flight is excluded and reported separately.
- **Sotuvchilar reytingi** — company-wide on purpose: the route passes
  `ctx.query` and never `ctx.scope`.
- **KPI rejalari** — the preset picks the plan but does not slice it. «Bugun»
  and «Shu oy» give identical numbers inside one plan.
- **Struktura** — totals must be summed over the tree's roots; children are
  already rolled into every parent, so flattening double-counts.

---

## Invariants that break things quietly

**`countsAsRevenue` — name it in every query that touches money.** The portal
records the same order twice: `#10 База` mirrors `#6 Доставка` (97% of order
codes and amounts, created a median of ten days later). Pipeline roles are
decided in one place, `PIPELINE_ROLE_BY_ID` in `mapping.ts`, and denormalised
onto the deal at import. Bypass it and revenue is ~5 bn UZS (~30%) too high and
**nothing looks broken**. `scripts/import.ts` prints the excluded total on every
run; if it is ever zero, the guard has stopped working.

**Money is BigInt minor units, end to end.** `src/server/domain/money/money.ts`.
`toMajorNumber` is lossy and one-way and throws past `MAX_SAFE_INTEGER`.
`MoneyDto` carries `amountMinor` as a string plus a lossy `amount` for charts.
BigInt crosses the wire as a decimal string (`envelope.ts` `jsonReplacer`).

**Every window comes from `period.ts`.** Half-open `[start, end)`.
`this_week` / `this_month` / `this_year` mean **to-date**, so a mid-month view
compares 1–23 Aug against 1–23 Jul rather than showing a fake collapse.
All arithmetic in `env.APP_TIMEZONE`.

**Cache and comparison keys must include the PRESET.** On a Monday, `today` and
`this_week` resolve to the identical window but demand different comparisons.
`commandCentreCacheKey.ts` keys on `preset | start | end | currency`; pinned by
`tests/http/search.test.ts`.

**A deal has four date bases and they may not be substituted.** `*AtSource`
columns are the CRM's timestamps and are what analytics uses; `createdAt` /
`updatedAt` are *our* row lifecycle — using them would move every deal into the
current period on a re-sync. Durations come from `deal_stage_history`, never
from close-minus-create.

**Delivered revenue and seller-close are two metrics, never blended.**
`src/server/domain/analytics/sellerClose.ts` — 2 798 seller-stage entries vs
3 729 Доставка-won in one month, only 1 152 shared. The row carries both.

**A rate with no denominator is `null`, not `0`.** `rateBp` returns null over an
empty denominator and deliberately does not round — `pct` rounds again for
display, and double-rounding moved one region across the 85% tone threshold.
`null` (no data) and `0` (a measurement) stay distinct to the UI.

**Scope narrows, never widens.** `intersectEmployeeScope` is an intersection,
never a union. An empty scope may not be an empty array — every repository
tests `ids?.length`, so `[]` reads as "no filter" and silently widens to the
whole company. Hence the sentinels `NO_EMPLOYEE_IN_SCOPE` and
`__no_employee_linked__`.

**Branch (`filial`) scoping is fully built and has zero callers.** Domain,
schema, query param, service door, tests and a proof script all exist;
`grep -rn scopedContext src/` returns only its own definition. Do not assume any
screen is branch-scoped today.

**Confirmation queue: cohorted by arrival in `C4:NEW`, not by Дата создания.**
Five stages speak (`CONFIRMATION_SIGNAL_STAGES` in `mapping.ts`), every other
stage leaves the status alone. An order joins the board the moment it reaches
Тасдиклаш — the move out of «Регистрация» / «Сделка успешна» — and a deal with
no arrival (~52 that appear straight in `C6:NEW`) is not on the board at all.
`tests/http/confirmationQueueSql.test.ts` pins the cohort, the `numbered`
partition key, the never-queued exclusion and the left-only history bound.

**«🔁 ҚАЙТА ТУШДИ» counts GAPS, not entries, and the gap is six hours.** The
bot marks a return by remembering each deal's previous stage; we read the same
fact from the stage history, where every entry into `C4:NEW` is a row. But an
order can enter twice in fifteen minutes because one person confirmed it, saw a
mistake and pulled it back — deal 319494 on 2026-09-03 did exactly that, wore
the mark here and correctly did not in Telegram. `REPEAT_GAP_HOURS` is the
bot's own threshold, so the two surfaces cannot contradict each other in front
of the same operator. The lookup is unbounded by the window (a return in
September against a July arrival is still a return) and runs after the page's
LIMIT, so it costs 25 index lookups rather than a second pass over the cohort.

**The header bell counts the BACKLOG, so its link must carry `queue=backlog`.**
One SQL definition answers two questions: `window` — what arrived in the
selected period, and where each of those stands — and `backlog` — what is
waiting right now, whenever it arrived. `alertsService` asks for
`queuePressure(allTime, 120, 'backlog')`, so a link without that mode opens a
board counting a different population: the badge read 44 over a page reading 1,
both correct, nothing on screen saying they answered different questions. The
mode rides the URL through `useDashboardFilters` (`reset()` keeps it — it is a
question, not a filter), and `tests/features/confirmationBacklog.test.tsx` pins
the pair together.

---

## The sync pipeline

`CrmProvider` (portal vocabulary) → handlers (`DEALS`, `STAGE_HISTORY`, …) →
`SyncEngine` (cursors, status, sweeps) → `PrismaSyncStore`. Bitrix24 field names
(`UF_CRM_*`, `CATEGORY_ID`, `crm.deal.list`) stay inside
`src/server/integrations/crm/bitrix24/` — a strong convention, not a lint rule.

- **`batchWalk` uses id-chained seeks, never offsets.** 50 chained commands per
  `batch`, `filter[>ID]` + `start=-1`, 2 500 rows a round trip. Offsets were
  measured: `start=400000` ran 25 minutes and then got *every* `crm.contact.list`
  call in the account answered `OPERATION_TIME_LIMIT` for ten minutes.
- **`encodeParams` percent-encodes filter KEYS, not just values.** Get it wrong
  and the portal silently drops the filter and returns the whole table — 20 750
  fetched rows held 12 800 distinct ones. `>=DATE_MODIFY` is built the same way,
  so the same bug turns every incremental sync into a full one.
- **`skipped` must not block the watermark; `failed` must.** Stage history
  finishes `PARTIAL` on every run (2 346 of 193 344 rows point at things that no
  longer exist), and blocking on skips left the cursor permanently stuck,
  re-reading 191 000 transitions every tick to change nothing.
- **…but a run that skipped rewinds 35 minutes, for `DEALS` and
  `STAGE_HISTORY`.** Not every skip is permanent. The hot entities run in
  sequence, each capturing its own start, so a deal created between the DEALS
  read and the STAGE_HISTORY read has its arrival in `C4:NEW` skipped for an
  unresolvable `dealId` — and `>CREATED_TIME` then means that arrival is never
  offered again, which leaves the order off the confirmation board with nothing
  reporting a gap. Measured 2026-09-03: portal 44, the client's own bot board
  44, ours 43 (deal 935632), and 1–4 a day over the preceding days.
  `SKIP_LOOKBACK_MS` in `SyncEngine.ts` — applied only after a run that skipped,
  and always derived from that run's own start, so it advances every tick
  regardless.
- **The upsert may not rewrite a row's primary key.** `rowId()` mints a fresh
  id per batch and the conflict target is the EXTERNAL key, so `id` has to be
  `insertOnly` — without it the update set carried `"id" = EXCLUDED."id"` and
  every re-import gave an existing row a new identity (proved on production:
  the one deal of nineteen the sync touched in 100 s came back under a new id).
  Children followed it — `deal_item` and `deal_stage_history` cascade on update
  — and `/deals/[id]` plus the confirmation trace panel address a deal by that
  column, so links went stale within a minute.
  `tests/integrations/bulkUpsert.test.ts` pins it, including for tables added
  later.
- **Only a FULL run may delete**, and only from `SUCCESS`. An incremental run
  sees just the changed records, so "not seen" says nothing about existence.
- **The production sweep bypasses the SyncEngine on purpose** — it collects ids
  and calls `deleteMissing` directly, because a FULL engine run also re-upserts
  all 434 000 deals. It must not run at tick 0 (`0 % N === 0`); reference data
  loading at tick 0 *is* intended.
- **The sweep's temp table lives inside one interactive transaction.**
  `CREATE TEMP TABLE … ON COMMIT DROP` outside a transaction vanishes at commit;
  the next `TRUNCATE` then raised `42P01`, which the engine swallowed as a
  warning — deletions silently never happened.
- **`IdResolver.mapFor()`, not `map()`, on the hot path.** The full deal map is
  ~200 MB and the worker runs in a 512 MB container whose heap tops out near
  258 MB. `mapFor` deliberately does not cache: caching a partial view under the
  full map's key would be a silent wrong answer.
- **Empty string is the foreign-key trap.** `('' && map.get('')) ?? null` yields
  `''`, which fails the constraint and takes the whole multi-row insert with it.
  Closed at the provider edge (`nonEmpty`) and the handler edge (`link`).
- **One worker only**, enforced by `pg_try_advisory_lock` on a **dedicated**
  connection. A pooled connection returns to the pool and Postgres drops the
  lock with it — looks like it works, enforces nothing. A second worker waits
  rather than exiting, because exiting produces a platform restart loop.
- **`DEAL_ITEMS` reads in-memory state left by the `DEALS` pass** in the same
  process, and ignores `updatedSince`. Running it alone yields zero rows and
  reports `SUCCESS`.
- The provider **ignores `pageSize`** and returns one page for most entities.
- Roistat is a second, unrelated source (a `var D = {…}` literal inside a 5.5 MB
  static page, parsed by brace-matching, not regex). It lands in its own tables
  and is spawned as a child process, hourly.

Worker cadence lives in `scripts/syncWorker.ts`: `SYNC_INTERVAL_SEC` 60,
reference data every 30 ticks, sweep and Roistat every 60, and
`SYNC_HISTORY_BACKFILL_DAYS` 45 — the stage-history cursor is wound back once
at startup so the ordinary incremental pass repairs arrival rows lost before
the watermark learned to rewind (`historyBackfillCursor`; it never writes a
cursor where there is none, and never moves one forward). 76 000 of 222 000
rows, under a minute, once per start. Backoff is a
**floor**, not an addend — as an addend it disappeared exactly when it was
needed.

---

## Deploy

`.do/app.yaml` is the entire deployment: `web`, the `sync` worker
(`instance_count: 1`), a PRE_DEPLOY `migrate` job and a POST_DEPLOY
`provision-admin` job. No Dockerfile, no CI.

**Never re-apply the committed spec over a running app.** Its secrets say
`CHANGE_ME`, and `doctl apps update --spec` replaces the whole spec — the app
stops at its next boot. Take the live spec, edit it, apply that:

```bash
doctl apps spec get <app-id> > /tmp/live.yaml   # secrets come back as EV[1:...]
doctl apps update <app-id> --spec /tmp/live.yaml
```

The health check must stay pointed at `/api/health`, which opens a real database
connection. It used to point at `/login`, which Next serves from the build
output and answers 200 with the database gone.

---

## Doc rot — verify before trusting

- `docs/ARCHITECTURE.md` documents `getHandler(permission, schema, handle)`. The
  real signature takes `access = { permission, section }`, and the word
  "section" appears nowhere in that file — half the authorisation model is
  undocumented there.
- `docs/BITRIX24.md` says `assertMappingComplete()` guards startup. It is a
  no-op with no callers, and the `sourceField` / `confirmed: true` fields its
  "steps to finish" tell you to edit do not exist. It also references a
  `POST /api/v1/sync/run` route that was never built.
- `docs/DEVELOPMENT.md` carries a stale test count and a finished phase table.
- `src/lib/sections.ts` cites a `src/server/auth/sections.ts` that does not
  exist. The invariant it describes still holds — by direct import.

## Local database

`.env` points at `127.0.0.1:5433`; the only cluster on this machine is 5432 and
the role it names does not exist, so `db:deploy`, `db:check`, `db:studio` and
`prisma migrate` all fail with `P1001`. `.env.example` says 5432. Everything
else — typecheck, lint, the whole test suite, `next build` — runs without a
database.
