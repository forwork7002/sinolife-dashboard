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
resolves to the linked employee's own unit, plus **every unit they HEAD and
everything under those**. Membership does not descend; headship does.

- **`ctx.scope` is `{ restrictToEmployeeIds: readonly string[] | null }` — one
  field, and it is plural.** It was `restrictToEmployeeId`, a single id. The
  singular was **removed rather than kept beside** the plural, because a
  repository honouring the old field and ignoring a new one would have served
  the whole company to a ROP without erroring. `null` is everybody; a non-null
  value is **never empty** (`NO_EMPLOYEE_IN_SCOPE`, `__no_employee_linked__`).
- **The subtree is resolved per request, in `ScopeRepository.teamEmployeeIds`,
  and only HEADSHIP descends.** The recursion walks down from every department
  whose `headId` is this person (`UNION`, not `UNION ALL`, so a `parentId`
  cycle terminates); the person's own `employee."departmentId"` is then unioned
  in **flat**. Both arms are needed and neither is redundant: «Навоий» names a
  head whose own units are elsewhere, so reading membership alone hands that
  man his own team and not the branch he runs — while letting a membership
  descend would hand an ordinary registrar filed in «Тошкент онлайн» the nine
  teams beneath it. Then everyone whose **primary** `departmentId` is in that
  set. Granting TEAM to whoever heads the ROOT is the same as granting ALL.
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

#### Handing one out: the «ROP» tab on `/users`

The scope above is the rule; this is the only place it is granted. `/users`
carries two readings behind a `SegmentedControl` — «Hisoblar», every account,
and «ROP», **the department heads**, whether or not they have a login yet.

- **The list is heads, not the roster, and that is the whole point.** An OWN or
  ALL account can be linked to anybody, so the ordinary picker offers all 289
  people. A TEAM account cannot: the scope is grown from the tree, so somebody
  filed nowhere who heads nothing anchors on nothing and `assertScopeIsUsable`
  refuses to save them. `listDepartmentHeads()` answers two `findMany`s and
  hands them to `departmentHeads()` in `domain/employees/departmentHeads.ts` —
  one row per PERSON, because `headId` is one head per unit but nothing stops
  one person running several.
- **EVERY department head, not only the fifteen «(ROP)» ones.** The client
  asked for it and headship descending makes a branch head a real grant. Sales
  teams sort first because ROP is what the floor calls this. Sorted with
  `localeCompare(…, 'ru')`, matching `branches.ts`: 'uz' collation files the
  digraphs Sh and Ch at the END of the alphabet, which is correct Uzbek and
  wrong for a list somebody scans with their eye.
- **The team size beside each name is asked of the REAL resolver**, one head at
  a time, and then run through `rowScopeFor` — not counted from the tree here.
  A second count would be a second definition of who is on a team, and the two
  would agree until the day they did not; going through `rowScopeFor` is what
  adds the reader themself, which a raw `teamEmployeeIds().length` omits for
  exactly the odd records worth checking. Roughly nineteen recursive queries,
  which is why the route takes **`?include=heads`** — a query parameter and not
  a second endpoint, because `routeAccess.test.ts` pins the ungated list and
  this has nothing new to say under it. Its own react-query key with **both**
  `staleTime` and `refetchInterval` at five minutes: `refetchInterval` never
  consults staleness, so setting one alone buys nothing.
- **Heading the ROOT is «Butun kompaniya» wearing another label**, so the row
  and the form both say so in red. The demo tree has one (`SinoLife`, 14 of 14
  people); production has one too.
- **Units nobody heads are NAMED under the table.** «Тошкент онлайн» carries
  nine sales teams and names no `UF_HEAD` at all, so it cannot be on a list of
  people — and unsaid, an administrator hunts for it and reports the screen.
  The field to fill is in Bitrix24, not here.
- **The form is the same `UserDialog`**, given a `head` prop. It fixes only the
  two fields that fail silently — `dataScope: 'TEAM'` and the linked employee —
  and pre-ticks Tasdiqlash + Sotuvchilar. Everything else, all eleven sections
  included, stays the administrator's choice; a head who already has a login
  opens the ordinary form so the scope can be corrected.
- **`createUser` now refuses an employee that already has a login**
  (`assertEmployeeIsFree`). `user.employeeId` is `@unique` and `provisionUser`
  writes it in its THIRD statement, so the clash was a `P2002` nothing
  translates — a 500 — that left behind a real, signable account with no
  username, role SALES and scope ALL.

**Which endpoints admit a narrowed account is pinned by
`tests/http/routeAccess.test.ts`.** Declaring `permission: 'analytics:read:all'`
is how an endpoint says *"I cannot narrow my rows — refuse a ROP rather than
answer with the company's"*; declaring the any-of pair (or `leaderboard:read`,
or `employees:read`) says the opposite, and every route that says the opposite
must read `ctx.scope`. The test asserts both halves of that, so widening a
permission without threading the scope fails the gate.

Narrowed today: the confirmation queue and everything cut from its cohort (rows,
pagination count, tiles, ROP panel, ROP filter options, the header bell, the
rejection chart), the leaderboard, and the ten routes that already spread
scope.

**One route admits a narrowed caller and answers with the whole company on
purpose: `/analytics/sellers`.** The client asked for it on 2026-09-08 —
«sotuvchilar reytingi bo'limi hammaga bir xil ko'rinishi kerak… hamma
bir-birini natijasini ko'ra olishi uchun» — and a leaderboard whose readers
each see a different league is not a leaderboard. It was scoped for six weeks
and the trade was made the other way. THREE screens move with it, because they
are one answer rendered three ways: the board, its record ticker, and the
FAKT 1 / FAKT 2 band on Savdo dinamikasi, whose tiles are built from these
rows. What that discloses to every account: per seller and per team, FAKT 1 /
FAKT 2 money, order counts, conversion and rank — no deal rows, no customers,
no phone numbers, no costs. `routeAccess.test.ts` records the exemption by
name (`COMPANY_WIDE`) and fails if the route stops saying so out loud, so
every OTHER route in that list must still be seen reading `ctx.scope`. The
60-second memo in front of `SellerBoardService.board` is keyed WITHOUT a
scope, which is only safe while this holds: narrow the board again and the
memo has to gain the scope in the same commit or be deleted in it.

Still company-only, and still refusing:
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

### Light or dark

`globals.css` has carried a full second palette since it was written, but for a
long time the only thing that could reach it was the operating system —
somebody on a machine pinned to light by IT policy had no way to the dark one
at all. `src/lib/theme.ts` is the switch, and **the entire mechanism is one
attribute on `<html>`**: `:root[data-theme="dark"]` forces dark, and the
`prefers-color-scheme: dark` block is guarded `:not([data-theme="light"])` so
the attribute can force light BACK. That guard is the half a reader on a dark
machine depends on, and `tests/features/theme.test.ts` asserts it against the
stylesheet, because nothing in TypeScript can see it. No class list, no inline
colours, no second palette in JavaScript that could drift from the CSS.

**Three choices, not two.** «Tizim» is the absence of a decision rather than a
third theme, and it has to stay reachable, or one press of the header toggle
permanently detaches the dashboard from a machine that switches itself at
sunset. So `Shell`'s `ThemeButton` is a two-state toggle on the RESOLVED theme
— a three-state cycle hands a reader who wanted the other mode a press that
gives neither — and the three named states live in `AppearanceSection` on
`/account`. The store is read through `useSyncExternalStore` for the same
reason `periodMemory` and `sidebarCollapsed` are, and is remembered per browser
under `sinolife.theme.v1`.

Two duplications the feature cannot avoid, both deliberate:

- **The storage key is written out twice.** The attribute has to be on `<html>`
  before the body is parsed or every cold load flashes white at a dark reader,
  and a script that runs that early cannot import a client module — so
  `layout.tsx` carries an inline copy of the one line that sets it.
  `theme.test.ts` reads both files and pins them to the same key; the symptom
  it prevents is silent, because the preference still applies, one full paint
  too late.
- **`<meta name="theme-color">` is set from the CSS, not from a hex literal.**
  The layout's pair is keyed to `prefers-color-scheme`, which is exactly what a
  forced theme overrides — so a reader who picks light on a dark phone would
  otherwise get a black address bar over a white page. `paintBrowserChrome`
  reads `--page` back out of `getComputedStyle` and prepends its own meta (the
  FIRST matching one wins). It runs from `subscribeTheme`, which React calls
  from an effect; `/login` is the one screen nothing subscribes on, so its
  address bar follows the machine until the reader is through the door.

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
| Savdo tahlili | `/analytics/sales` | `sales/SalesPage` | `/analytics/sales`, `/analytics/sources`, `/analytics/products`, `/insights/pulse`, `/insights/flow`, `/analytics/sellers` (the FAKT 1 / FAKT 2 band, `sales/ConfirmationFaktSection`) | Analytics, Pulse, SellerBoard → Deal, Reference, Pulse, Insights | **mixed** — a permissive pre-filter admits anything touching the window, then each measure picks its own basis |
| Mijoz qaytishi | `/analytics/cohort` | `cohort/CohortPage` | `/insights/cohorts`, `/insights/concentration` | Insights, Concentration → Insights, Concentration | `closedAt`, on revenue-bearing WON deals only — nothing here reads `createdAtSource` |
| Kanallar | `/marketing` | `marketing/MarketingPage` | `/marketing/overview`, `/marketing/breakdown`, `/marketing/verify` | Marketing → Marketing | `marketing_daily."date"` — the Roistat sheet's own lead date. **Not Bitrix24 data at all** |
| Yalpi marja | `/margin` | `margin/MarginPage` | `/insights/margin` | Insights → Insights | `closedAt`, WON + `countsAsRevenue` |
| Logistika | `/logistics` | `logistics/LogisticsPage` | `/insights/logistics` | Insights → Insights, Reference | `createdAtSource`, uniformly in all three queries |
| Tasdiqlash navbati | `/confirmation` | `confirmation/ConfirmationPage` | `/insights/confirmations/orders` | Insights → Insights | **the arrival in `C4:NEW`** — the latest `deal_stage_history` row whose stage signals `CONFIRM_NEW`; `?queue=backlog` (where the bell lands) drops the window entirely |
| Joʻnatish nuqtalari | `/warehouse` | `warehouse/WarehousePage` | `/insights/dispatch` | Insights → Insights | `createdAtSource` — a creation cohort graded by the deal's **current** stage |
| Sotuvchilar reytingi | `/sellers` | `sellers/SellersPage` | `/analytics/sellers` | SellerBoard, Analytics → SellerBoard | the arrival in `C4:NEW` (`queued_at`) — the confirmation queue's own cohort. **The television board**: two podiums and two ranked lists (sellers left, teams right), nothing else; the FAKT 1 / FAKT 2 totals, conversion, bonus fund and ladder render on Savdo dinamikasi (`sales/ConfirmationFaktSection`), which is why the route lists both sections |
| KPI rejalari | `/kpi` | `kpi/KpiPage` | `/kpi` | Kpi, Analytics → Reference, Deal | **the plan's own `periodStart`/`periodEnd`** — the dashboard window only *selects* which plan is live |
| Struktura | `/structure` | `structure/StructurePage` | `/insights/structure`, `/insights/structure/roster` | Insights → Insights | **nothing — the screen is DATELESS.** `period={false}`, no window control, and neither endpoint takes one |

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
- **Sotuvchilar reytingi** — company-wide on purpose, and it is the ONLY route
  that admits a narrowed caller without narrowing: it passes `ctx.query` and
  never `ctx.scope`, and `boardFilters` drops `restrictToEmployeeIds` a second
  time so a scope cannot reach the SQL by one edit. See the block above
  *Client data flow* for the reason and what it discloses.
- **KPI rejalari** — the preset picks the plan but does not slice it. «Bugun»
  and «Shu oy» give identical numbers inside one plan.
- **Struktura** — **no money and no reporting window, and both are load-bearing
  absences.** The client's instruction was that money is stated on Boshqaruv
  markazi and nowhere else, so the card's revenue, the list view's «Sotuv» /
  «Tushum» columns, the roster's per-person figures and the «Ishlagan xodimlar»
  ring are all gone. «Ishlagan» went with them because it is not a headcount at
  all — it is "closed a revenue deal in the window", which on a page with no
  window would silently have meant *today* and printed 0 beside almost every
  unit at nine in the morning. With nothing left on the page reading a window,
  the control over it could only lie, so `PageShell` gets `period={false}` and
  both endpoints dropped their `Period` argument. Do not reintroduce a figure
  here without reintroducing a window and a gate; `tests/http/routeAccess.test.ts`
  fails if a route grows `periodFrom`, `ctx.currency` or `analytics:read:all`
  back.
  Totals must be summed over the tree's roots; children are already rolled into
  every parent, so flattening double-counts. The screen re-creates the portal's
  own `hr/structure` org chart, with the old indented table kept behind a
  `?view=list` toggle — both are renderings of ONE `/insights/structure` answer,
  so they cannot disagree and switching costs no request. It prints **two
  headcounts that are both right**: `subordinateCount` is Bitrix24's membership
  minus the head, the figure the floor checks against the portal, while
  `activeHeadcount` counts who is CREDITED here by this dashboard. They differ
  on five of the twenty units. Everything else worth knowing about it is under
  *The org chart* below.

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

**THE BOARD IS THE PAGE — `PageShell`'s `fill`, the second screen to take it —
and `640` TURNED FROM A CEILING INTO A FLOOR.** The client asked for the
«Барча буюртмалар» section to occupy more of the screen. The table was capped
at a literal `maxHeight={640}`, a number that can only be wrong twice: too tall
for a laptop, and permanently too short for the 27-inch screen a floor manager
reads it on, where the browser had 800 spare pixels the board refused to use.
The page body is now one flex column — banner, state tiles, Статистика panel
all `shrink-0`, the results Card `flex-1` — and the table's bound is
`maxHeight="100%"`, the height the card was given, which is whatever the screen
had left. Same mechanism as the org chart's canvas: `Shell` is exactly `100dvh`
and `main` is `min-h-0 flex-1`, so a percentage resolves without anything
measuring the header.

**The floor is `min-h-[746px]` on the Card and the number is load-bearing** —
640 of table plus the card's own 106px of chrome. It only ever bites when the
column does not fit, and a column that does not fit makes `main` scroll, so on
exactly the screens where it applies the page is scrolling anyway: there is no
reason to show a SHORTER table than before on a page that scrolls just as much
as before. A comfortable-looking 540 was tried and measured as a loss — 6 rows
where the old cap gave 9 on a 1280×800 laptop, and on a phone a letterbox
inside a page that still scrolled. The break-even is a window about 1054px
tall; above it the floor is slack and nothing scrolls. Measured: 2560×1440 →
13 rows against 8, maximised 1920×1080 → 8 against 7 (that row is the caption
the page no longer prints), 1280×800 → exactly what it was.

Two more things a later edit would undo. `fill` hands a page ONE plain block
with no `display: flex` and no gap, so the column is built in
`ConfirmationPage`, not in `PageShell` — changing the wrapper would move the
org chart for a reason that has nothing to do with it. And the Статистика panel
had to be bounded (`maxHeight={300}`, `shrink-0`) in the same change: fifteen
(ROP) groups unbounded is ~390px of panel opening ABOVE the card that takes
what is left, and a demo database returns ONE, so neither the gate nor a local
screenshot can see it.

**Nothing is printed between the title and the controls, in any mode.**
`description={null}` AND `meta={undefined}`, which say one thing together.
`null` is not the same as omitting the prop: PageShell RESERVES that line by
default, because a page that will print `meta.period`'s dates has to claim the
height before the first response lands. This board never prints them, so an
omitted prop held twenty pixels plus its margin open forever above the densest
table in the application. The sentence that used to sit there — orders in
Тасдиклаш have states, the window is the C4:NEW arrival — is not lost: the
first is what the six state tiles directly under it say, the second is what the
preset row says, and both are stated at length here and in the queue SQL, which
is where somebody reconciling against the portal actually looks.
`t.modules.confirmation.lead` was deleted with its last call site.

**Its РОП / status / Статистика controls are `toolbar`, not `actions`.**
`actions` is the header slot beside the title, right-aligned — for a page-level
ACTION, which is what Foydalanuvchilar' «+ Yangi hisob» is. These three are
filters, and passed as `actions` they sat on the far right of the header while
the window and the search box sat on the left: one screen carrying two toolbars
a metre apart, with the reader crossing the page to narrow one table. `toolbar`
puts them in the filter row after the shell's own controls, and it opens that
row on its own (`period || anyFilter || toolbar`) — backlog mode has no window
and no filters and still needs its ROP filter and Статистика. «Filtrlarni
tozalash» is hoisted out of the filters fragment so it stays LAST, rather than
standing between the search box and the controls it also clears. Pinned by
`tests/features/pageShellToolbar.test.tsx`.

---

### The org chart

`/structure` re-creates `obey.bitrix24.kz/hr/structure/`: department cards on a
pannable, zoomable canvas joined by orthogonal elbow connectors, one row per
level, a floating control row at the top and a zoom stepper bottom-left, a
per-card expand/collapse footer, a «SIZ» badge on the reader's own unit, and a
roster panel docked over the canvas.

**IT IS THE WHOLE PAGE.** The screen carries a title, a Chizma/Roʻyxat toggle
and then the canvas, which takes every remaining pixel. There is no header
band, no KPI tile, no reporting window and no figure in soʻm — the client asked
for all four to go («shu joy kerak emas… shu boʻlimni kattaroq qil, sahifani
qoplasin»), and what they cost was the thing the page exists for: the chart used
to start below the fold on a 1080p window.

The height is `height: 100%` on `.org-canvas` under `PageShell`'s `fill` — the
first of the two pages that take it, the confirmation board being the other —
NOT a `calc(100dvh − N)`. `Shell` is exactly `100dvh` and `main` is `min-h-0 flex-1`,
which gives a flex item a definite main size, so a percentage resolves against
what is actually left — and no constant has to be re-measured when the header
changes. The hand-measured expression this replaced was already stale and also
mixed `100vh` against a shell sized in `100dvh`.

- **Every write affordance the portal has is deliberately absent** — ДОБАВИТЬ,
  the «+» on the connectors, the drag handle, the «...» menu. All four write
  into Bitrix24, and the frontend never talks to a CRM; the entire mutation
  surface of this API is three `/users` handlers. What the card gains instead is
  the TEAM: where the money used to be there is now a stack of `InitialChip`s
  for the unit's first five active members and a «+N» for the rest, because
  «har bir sotuvchi bilishi kerak kim kimlar borligini» was previously answered
  one unit at a time by opening a panel. The names already ride the payload for
  the search box, so a face on every card at once costs no request.
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
- **THE CHAIN OF COMMAND IS DRAWN, NOT LEFT TO THE EYE.** Every card from the
  one under the pointer — or picked, or focused — up to the company root wears
  `data-chain`, and every connector along it lights. Before this exactly ONE
  connector ever lit (`edge.to === selectedId`), so a reader was told who their
  immediate parent was and left to trace the rest across nineteen identical grey
  lines. With nothing picked at all the chain falls back to the READER'S OWN
  unit, so the first frame answers the question before they touch anything.
  `data-chain` is in the `forced-colors` block for the same reason
  `data-selected` is: the one thing this screen exists to show is carried by
  colour, and that mode discards colour.
- **The opening frame is the reader's own chain, fitted.** An account linked to
  an employee opens unfolded to its own unit with the whole chain to the root in
  view — the fold comes from `openingCollapsed`, derived rather than written by
  an effect, and the viewport is sized to the chain's BOUNDING BOX (not just its
  height: the root sits over the middle of its children, so a chain hanging off
  the leftmost branch is as wide as it is tall, and a phone showed the reader's
  card with the connector running off to a root that was not on screen). It does
  not SELECT the unit — that would open the roster over a third of the chart and
  write `?dep=` into an address nobody chose. «Hammasini yopish» still returns
  the structural default, which is why that is a separate set.
- **The chain is also printed in words.** A second line of the floating control
  row reads «Siz  NEWGEN › Тошкент онлайн › Sevinch(ROP)  ·  Rahbaringiz: …»,
  every crumb a button. It is the only affordance here that needs no
  interaction at all, and it survives panning, zooming, folding and a phone.
  «Rahbaringiz» walks UP until it finds a head, because «Тошкент онлайн» has no
  `UF_HEAD` and «Навоий»'s is not listed inside it — stopping at the reader's own
  unit would tell a third of the floor «Rahbar tayinlanmagan».
- **A plain wheel ZOOMS, and it could not before.** The handler used to return
  early unless ctrl/meta was held, because the canvas was a card inside a
  scrolling `main` and an unconditional `preventDefault` would have trapped the
  page. The canvas is the page now, so the gesture is free to take. Three riders
  make it safe: it bails over `.org-panel` (whose body scrolls), it scales by
  `deltaY` magnitude honouring `deltaMode` (a trackpad fires dozens of small
  deltas per flick and a fixed step would cross the whole range in one gesture),
  and Shift+wheel takes over the sideways pan the wheel no longer does.
  `touch-action` moved from `pan-y` to `none` for the same reason. The honest
  cost: a Mac trackpad's two-finger scroll now zooms rather than pans — nothing
  in a wheel event distinguishes the devices — and the pan is a drag on the
  background.
- **The search matches PEOPLE, not just units.** Every active member's name
  rides the tree's own payload (`memberNames`, ~290 strings), because the first
  thing a seller types into this screen is their own name — matching only the
  unit and its head answered «topilmadi» over a dimmed company while their row
  sat two clicks away in the panel. A match force-opens its ancestors and is
  centred once.
- **A `?dep=` link force-opens its own way in**, by the same derivation, so
  "this is the team, look" pasted into a chat opens on the card rather than on a
  panel floating over a folded tree.
- **The search answers with NAMES, not a count.** It used to print «3 ta» and
  centre one card silently, so if three units held a Malika the second and third
  were unreachable and nothing ever said which person had matched. Up to twelve
  rows now read «Ismoilov Aziz — Sevinch(ROP)»; picking one selects that unit,
  flies to its card and marks that person's row in the roster. The mark travels
  as a NAME rather than an id, because `memberNames` and `DepartmentMemberDto.
  fullName` are the same `employee."fullName"` column — carrying ids would mean
  turning `array_agg` into a `jsonb_agg` of objects and rippling that through
  the node type, the `src/lib/api.ts` mirror and both test fixtures to mark one
  row.
- **`/insights/structure/roster` is a SECOND request on purpose.** The chart
  draws twenty cards and a reader opens one panel; putting 289 people on every
  node would ship the whole roster again on every change of selection. Its
  header carries the unit's ancestors as clickable crumbs and the person it
  answers to; its rows carry membership, so somebody shown in their SECOND unit
  is tagged «Ikkinchi boʻlim» — without it a borrowed operator reads as a member
  of that team, which is the one thing this screen must not get wrong.
- **The endpoint touches no `deal` table and takes no parameters.** `structureSql`
  used to carry an `active` CTE (feeding the period-scoped `workingHeadcount`)
  and a `sales` CTE (the card's revenue); together they were the only readers of
  `deal`, the only users of `$1`/`$2`, and **3.4 of the query's 3.5 seconds** —
  on the single vCPU that answers every other screen, for the page every seller
  is meant to open. What is left reads `department`, `department_member` and
  `employee`. `tests/http/structureSql.test.ts` fails on a `$1`, on a `"deal"`,
  on a fourth table, and on `WITH RECURSIVE` going missing — which is the exact
  edit deleting the first CTE invites, and which fails with a
  relation-does-not-exist error naming `walk` rather than the missing keyword.

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
- `docs/DEVELOPMENT.md`'s test count is current as of 2026-09-07 (928) but the
  phase table below it is finished work; `npm run verify` is the authority.
- `src/lib/sections.ts` cites a `src/server/auth/sections.ts` that does not
  exist. The invariant it describes still holds — by direct import.

## Local database

`.env` points at `127.0.0.1:5433` and **nothing serves that port** — the
throwaway cluster this checkout used was deleted on 2026-09-07 with the machine
move, so `db:deploy`, `db:check`, `db:studio` and `prisma migrate` all fail with
`P1001` until one is made. `.env.example` says 5432.

```bash
initdb -D ~/pg-sinolife -A trust -U "$USER"
pg_ctl -D ~/pg-sinolife -o "-p 5433 -c listen_addresses=127.0.0.1" start
createdb -h 127.0.0.1 -p 5433 sinolife
npm run db:deploy && npm run db:seed && npm run db:seed:users
```

On a database made that way all **16 migrations apply and `db:check` returns 11
of 11** (1 600 deals, 14 employees, 611 won) — measured 2026-09-07. A failing
invariant on a database that has been sitting around is a stale database, not a
broken rule.

Everything else — typecheck, lint, the whole test suite, `next build` — runs
without a database, on Node 22.22.2+ (see `.nvmrc`; Node 20 cannot run the
tests, `jsdom` refuses it).
