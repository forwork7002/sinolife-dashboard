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

### Data scope: ALL, TEAM, OWN

**Three levels, and TEAM is the one the portal actually has most of.** A ROP
heads a sales team of a dozen or more; given ALL they read every rival team's
money, given OWN they read a board with one row on it. `dataScope = TEAM`
resolves to the linked employee's own unit **and everything under it**.

- **`ctx.scope` is `{ restrictToEmployeeIds: readonly string[] | null }` — one
  field, and it is plural.** It was `restrictToEmployeeId`, a single id. The
  singular was **removed rather than kept beside** the plural, because a
  repository honouring the old field and ignoring a new one would have served
  the whole company to a ROP without erroring. `null` is everybody; a non-null
  value is **never empty** (`NO_EMPLOYEE_IN_SCOPE`, `__no_employee_linked__`).
- **The subtree is resolved per request, in `ScopeRepository.teamEmployeeIds`.**
  Anchors are the person's own `employee."departmentId"` **and every department
  whose `headId` is them** — the second is not redundant: «Навоий» names a head
  whose own units are elsewhere, so anchoring on membership alone hands that
  man his own branch and not the one he runs. Then every department beneath the
  anchors (`UNION`, not `UNION ALL`, so a `parentId` cycle terminates), then
  everyone whose **primary** `departmentId` is in that set.
- **PRIMARY membership, never `department_member`.** That table lists a person
  in every unit Bitrix24 names, and it exists for the org chart. This is a
  money question — one unit credits a person — and reading memberships would
  put one operator's orders on two ROPs' boards.
- **`ScopeService` memoises the subtree for 60 s, keyed by employee id.** The
  key is the whole question; a key that omitted it would serve one account
  another's scope. A rejection is never cached.
- **`rowScopeFor(principal, teamEmployeeIds)` THROWS** if a TEAM principal
  arrives with nothing resolved. Widening there would be a silent leak, so it
  refuses to answer.
- **`ScopedWindow` (branches.ts) has a REQUIRED `restrictToEmployeeIds`**, so a
  bare `Period` will not type-check into the confirmation queries. That is what
  forces every caller to say whose rows it wants; `commandCentreService`'s
  `unscoped()` is the one place that says "everybody" out loud.

**Which endpoints admit a narrowed account is pinned by
`tests/http/routeAccess.test.ts`.** Declaring `permission: 'analytics:read:all'`
is how an endpoint says *"I cannot narrow my rows — refuse a ROP rather than
answer with the company's"*; declaring the any-of pair (or `leaderboard:read`,
or `employees:read`) says the opposite, and every route that says the opposite
must read `ctx.scope`. The test asserts both halves of that, so widening a
permission without threading the scope fails the gate.

Narrowed today: the confirmation queue and everything cut from its cohort (rows,
pagination count, tiles, ROP panel, ROP filter options, the header bell, the
rejection chart), the sellers board on both bases, the leaderboard, and the ten
routes that already spread scope. Still company-only, and still refusing:
the command centre, logistics, margin, dispatch, cohort, concentration,
channels, `finance/overview` and **marketing** — the last was `ANALYTICS_READ`
and had to be tightened, because the Roistat ledger has no employee dimension
to narrow by at all.

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
| Struktura | `/structure` | `structure/StructurePage` | `/insights/structure`, `/insights/structure/roster` | Insights → Insights | **mixed** — money columns on `closedAt`, every headcount undated |

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
  already rolled into every parent, so flattening double-counts. The screen
  re-creates the portal's own `hr/structure` org chart, with the old indented
  table kept behind a `?view=list` toggle — both are renderings of ONE
  `/insights/structure` answer, so they cannot disagree and switching costs no
  request. It prints **two headcounts that are both right**: `subordinateCount`
  is Bitrix24's membership minus the head, the figure the floor checks against
  the portal, while `activeHeadcount` counts who is CREDITED here and is what
  the money columns are built from. They differ on five of the twenty units.
  Everything else worth knowing about it is under *The org chart* below.

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

**A person belongs to ONE unit for money and to SEVERAL for the org chart, and
the two must never be swapped.** Bitrix24's `UF_DEPARTMENT` is an ARRAY, and the
portal's own `hr/structure` screen counts a person once in EVERY unit it names —
nine of this portal's 208 active people sit in two. The importer kept only `[0]`,
so five of the twenty cards were short by one or two: Тошкент онлайн 0 against 1,
Asliddin(ROP) 8 against 10, Azizbek(ROP) 14 against 16, Saidaziz(ROP) 14 against
15, Sevinchxon(ROP) 8 against 10 (measured 2026-09-05). `department_member` now
carries the full set and **nothing but the org chart reads it**.
`employee."departmentId"` is untouched and stays the PRIMARY unit: every analytic
credits a person to exactly one unit, and rolling a two-unit person up both
branches would count their headcount and their money twice.
`tests/http/structureSql.test.ts` pins which CTE reads which — the `members` CTE
the join table, the `people` CTE the column — because swapping them produces a
plausible number rather than an error.

Three subsidiary rules of that screen, all invisible when they break:

- **The head is not one of their own subordinates.** «Подчинённые: 13» sits over
  a unit of fourteen. Dropping the subtraction adds one to every card at once —
  and the subtraction and the total are computed in ONE pass under ONE
  `isActive` filter, because a head the portal has deactivated is not in the
  total and taking one off anyway printed five active people as four.
- **A head the portal does not list IN the unit gets no head row.** «Навоий»
  names `UF_HEAD` = Мурод Содиков, whose own two units are «Kompaniya(ROP)» and
  «Тошкент онлайн»; the portal draws that card with no head row rather than
  seating him where his record does not. `head` is null for exactly that case,
  and `headName` is still on the DTO beside it.
- **The subtree pill counts PEOPLE, not memberships.** Somebody in both
  «Регистрация» and «Azizbek(ROP)» is one person under NEWGEN, so the count is
  `DISTINCT`; summing the row below would double them.

**Scope narrows, never widens.** `intersectEmployeeScope` takes two LISTS now
(the authorisation side is a team, not a person) and is an intersection,
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

**The LAST arrival dates the row, so the row has to carry the earlier ones.**
One order is one row — their bot and their board keep one entry per deal, and
counting visits would let «тасдиқланиш %» exceed the orders it divides — but
that means an order confirmed on the 29th and pulled back into Тасдиклаш on the
31st leaves the 29th. Deal 834920 did exactly that, and six of the 127 orders
that arrived on 2026-08-29 did; the operator reading the 29th found an order
their Telegram channel had announced that morning simply gone. `QUEUE_HISTORY_SQL`
(the same LATERAL that draws 🔁) therefore returns every visit as JSON, newest
first, and the СТАТУС column draws them as a chain: only the last state is
lit as a chip, an arrow points up from each earlier one, and every step
carries its own date — the chip's included, because САНА is two columns away
and routinely scrolled off, which left the lit state looking like the older.
**It is shown and never summed** — the tiles, the Статистика panel, the state
filter and the header bell all read the single `classified.outcome`, and
`queueHistory[0]` IS that outcome, which is why the UNCONFIRMED_SHIPPED
refinement is confined to the last visit. Production holds at most three
visits per order. Pinned by `tests/features/confirmationHistory.test.tsx`.

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

### The org chart

`/structure` re-creates `obey.bitrix24.kz/hr/structure/`: department cards on a
pannable, zoomable canvas joined by orthogonal elbow connectors, one row per
level, a floating control row at the top and a zoom stepper bottom-left, a
per-card expand/collapse footer, a «SIZ» badge on the reader's own unit, and a
roster panel docked over the canvas.

- **Every write affordance the portal has is deliberately absent** — ДОБАВИТЬ,
  the «+» on the connectors, the drag handle, the «...» menu. All four write
  into Bitrix24, and the frontend never talks to a CRM; the entire mutation
  surface of this API is three `/users` handlers. What the card gains instead is
  the one thing the portal cannot print: the unit's money over the window,
  rolled up over the subtree while the headcount above it is not — the card says
  which is which, because on this tree «Навоий» reads 0 people over six teams'
  worth of revenue.
- **The second level down starts FOLDED, and the chart fits ONCE.** Fully open,
  this portal's tree is 4 332 canvas units wide, which fitted into a 1 500px
  card is 35% zoom and a screen of unreadable rectangles. Re-fitting on every
  shape change was worse: the answer to "show me this branch" was the whole
  company zoomed out and the branch smaller than before the click. Expanding
  holds the clicked card still (a `useLayoutEffect` anchor measured at 0.0px
  drift); «Sigʻdirish» is the way back, and it stops at a legibility floor of
  0.5 rather than shrinking the names away.
- **Pan writes the transform straight onto the stage node.** The viewport is a
  ref, never state; only the zoom READOUT re-renders, and it moves in steps.
- **The cards ARE the treeitems.** `role="tree"` owns its `treeitem`s, so the
  layout's coordinates go on the treeitem itself rather than on a positioning
  wrapper, and the treeitem is the focusable element rather than a button
  inside it — a nested button is announced as a button and throws away the
  level, the position among siblings and the expanded state. One roving tab
  stop for the whole chart, and it falls back to the first card whenever the
  focused one is folded away, or the chart has no tab stop at all.
- **The canvas key handler only fires on a card.** It lives on the canvas, which
  also holds the search box: unscoped, SPACE in that box selected a department
  instead of typing, and Home/End/arrows moved the tree rather than the cursor.
- **Avatars are initials, not photos.** `user.get` returns `PERSONAL_PHOTO` on
  `cdn-ru.bitrix24.kz` and the CSP is `img-src 'self' data: blob:`, so every one
  of them would be a broken image. `InitialChip` is the whole answer.
- **The money is withheld from a narrowed reader, not the screen.** This is
  the one company-wide page a salesperson is meant to open — the client asked
  for it precisely so the floor can see who reports to whom — so the route
  serves the tree and gates the figures on `analytics:read:all`, the same
  permission every other company-wide number is behind. Null, never zero, and
  the columns and the tile are not rendered at all.
- **The search matches PEOPLE, not just units.** Every active member's name
  rides the tree's own payload (`memberNames`, ~290 strings), because the first
  thing a seller types into this screen is their own name — matching only the
  unit and its head answered «topilmadi» over a dimmed company while their row
  sat two clicks away in the panel. A match force-opens its ancestors and is
  centred once.
- **A `?dep=` link force-opens its own way in**, by the same derivation, so
  "this is the team, look" pasted into a chat opens on the card rather than on a
  panel floating over a folded tree.
- **`/insights/structure/roster` is a SECOND request on purpose.** The chart
  draws twenty cards and a reader opens one panel; putting 289 people on every
  node would ship the whole roster again on every change of the window. It
  lists membership, so a person shown in their SECOND unit carries their own
  money while that money counts towards their FIRST — the panel says so in a
  footnote rather than letting the column quietly fail to add up.

## The sync pipeline

`CrmProvider` (portal vocabulary) → handlers (`DEALS`, `STAGE_HISTORY`, …) →
`SyncEngine` (cursors, status, sweeps) → `PrismaSyncStore`. Bitrix24 field names
(`UF_CRM_*`, `CATEGORY_ID`, `crm.deal.list`) stay inside
`src/server/integrations/crm/bitrix24/` — a strong convention, not a lint rule.

- **The EMPLOYEES pass REPLACES each person's department memberships, and the
  delete and the insert are ONE transaction.** A person moved out of a unit
  leaves no record saying so, so anything absent from this pass's
  `UF_DEPARTMENT` is gone. But `fetchEmployees` returns the whole roster in a
  single page, so the delete empties `department_member` outright: as two
  statements that is a 20–150 ms window (measured 1.6 ms + 15.5 ms locally on
  298 rows, plus round trips) in which every card on the org chart reads zero
  members, once every thirty ticks and again on every restart and redeploy,
  with nothing erroring and nothing logged. A unit we never imported is dropped
  rather than guessed at: the FK would refuse the row and take the whole
  multi-row insert with it.
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
