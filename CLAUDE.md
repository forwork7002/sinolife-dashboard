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
4. `src/app/api/v1/insights/margin/route.ts` — the canonical route, 15 lines
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

#### Handing one out: «ROP» inside «+ Yangi hisob» on `/users`

The scope above is the rule; this is the only place it is granted. `/users` is
ONE table now. It carried two readings behind a `SegmentedControl` —
«Hisoblar» and «ROP», the department heads — and the second tab was the only
door to a team-scoped account, so an administrator who wanted to give a ROP a
login had to know that the button marked «+ Yangi hisob» was the wrong one.
The heads are a CHOICE INSIDE that button now: «Oddiy hisob» / «Boʻlim rahbari
(ROP)», answered before anything else on the form. Everything the tab knew is
kept, in `HeadPicker`.

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
- **The team size in each option is asked of the REAL resolver**, one head at a
  time, and then run through `rowScopeFor` — not counted from the tree here. A
  second count would be a second definition of who is on a team, and the two
  would agree until the day they did not; going through `rowScopeFor` is what
  adds the reader themself, which a raw `teamEmployeeIds().length` omits for
  exactly the odd records worth checking. Roughly nineteen recursive queries,
  which is why the route takes **`?include=heads`** — a query parameter and not
  a second endpoint, because `routeAccess.test.ts` pins the ungated list and
  this has nothing new to say under it.
- **NOTHING ASKS FOR THE HEADS UNTIL SOMEBODY PICKS «ROP».** The query is
  `enabled: isRop` on the dialog and it no longer polls. On the tab it went out
  the moment the tab opened and again every five minutes; a modal that is open
  for a minute has nothing to learn from a second answer. `staleTime` stays at
  five minutes — the roster changes when the sync worker's reference-data pass
  names a new head, not while an administrator types a password — and that is
  what makes reopening the form instant. `refetchInterval` was DELETED rather
  than lowered: it never consults staleness, so leaving it would have restored
  the polling the enable flag exists to stop.
- **The selected head is derived from `employeeId`, never stored beside it.**
  Two pieces of state for one choice is how a form sends a scope anchored to
  one person while showing another's team size — and that number is the only
  thing between an administrator and granting nine teams by accident.
- **Heading the ROOT is «Butun kompaniya» wearing another label**, so the
  option's units line says so in red. The demo tree has one (`SinoLife`, 14 of
  14 people); production has one too.
- **Units nobody heads are NAMED under the picker.** «Тошкент онлайн» carries
  nine sales teams and names no `UF_HEAD` at all, so it cannot be on a list of
  people — and unsaid, an administrator hunts for it and reports the screen.
  The field to fill is in Bitrix24, not here.
- **Picking a head fills the name and guesses the login**, because the person
  is the first thing the form asks and retyping «Sirojov 115 Davlatbek» is
  where the typos are. `loginSuggestion` takes the first ASCII word carrying a
  letter, so a floor badge never becomes a login.
- **Switching the kind resets the scope, the anchor and the ticks**, which are
  answers to the kind question rather than to anything typed. ROP opens with
  Tasdiqlash + Sotuvchilar ticked: an empty list means «follow the role», and a
  SALES role's defaults include Logistika, a screen that refuses a narrowed
  account outright. Every tick stays editable.
- **A head who already signs in is a DISABLED option reading «hisobi bor».**
  `createUser` refuses an employee that already has a login
  (`assertEmployeeIsFree`) — `user.employeeId` is `@unique` and `provisionUser`
  writes it in its THIRD statement, so the clash was a `P2002` nothing
  translates, a 500 that left behind a real, signable account with no username,
  role SALES and scope ALL. Correcting such an account, its scope above all, is
  done by opening its row in the table, where every field is unlocked.
- **The table marks a TEAM account «ROP» on its name cell.** A team-scoped
  account IS a ROP account — that is the definition — so the list that used to
  live on its own tab is a chip on the row it was already on. Five columns, not
  eight: «Yaratilgan» and a column of its own for 2FA went (2FA is a glyph
  beside the status), and the role and the scope share one cell because they
  are read together. `minWidth` 1120 → 860, which is what took the horizontal
  scrollbar off the office laptop.

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
are one answer rendered three ways: the board, its record wall, and the
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
logistics, margin, dispatch, cohort, concentration and **marketing** — the last
was `ANALYTICS_READ` and had to be tightened, because the Roistat ledger has no
employee dimension to narrow by at all.

### Client data flow

Every `src/features/*/[A-Z]*Page.tsx` starts with `'use client'`. There is no
server-component fetching and no hydration boundary — pages are thin shells, all
data comes from `/api/v1` in the browser.

**ONE EXCEPTION, AND IT IS ABOUT THE FIRST FRAME: the viewer.** `layout.tsx` is
an async server component that calls `pageViewer()` and hands the result to the
client tree through `ViewerProvider` (`src/lib/viewer.tsx`); `Shell` reads it
with `useServerViewer()` and draws the sidebar from it, letting the
`/meta/filters` payload override it the moment it lands. Both copies are built by
`viewerOf` in `src/server/auth/viewer.ts`, so the handover is invisible — which
is the whole requirement. **Without it the rail had nothing to go on for about a
second and showed EVERYTHING**: the session comes from
`/api/auth/get-session`, which cannot have answered during the server render, so
every cold load shipped HTML carrying all eleven destinations — «Foydalanuvchilar»
included — to every account, and a salesperson whose account had just been opened
met the administrator's menu blinking at them. Reported by the client on
2026-09-11; pinned by `tests/features/navColdLoad.test.tsx`, which also pins the
direction of the override and the fail-closed default.

It costs no extra query: `pagePrincipal()` in `pageGuard.ts` is wrapped in React's
`cache`, so the layout and the page guard under it share ONE session-plus-user
resolution per request. The one thing it does cost is that the root layout now
reads cookies, so `/login` and `/_not-found` are server-rendered on demand like
everything else rather than prerendered — `next build` shows every route as `ƒ`.

`src/app/providers.tsx` sets the cadence **globally**: `refetchInterval: 60_000`
with `staleTime: 55_000`, matched to the sync worker's one-minute tick.
Per-page `refetchInterval` overrides were deliberately removed. Three
exceptions, each with a reason in place: `/meta/alerts` (one request a minute
for the whole app, keyed constantly), `/meta/filters` (5 min — reference data
changes on sync), and the ⌘K search.

**THE REFRESH BUTTON REPORTS, AND A DEPLOY NOW REACHES AN OPEN TAB.** Both
added 2026-09-14, after the client reported «yangilash ishlamayapti» four times
over an afternoon in which the button was measurably working. Two different
absences produced that.
*A press that lands on unchanged numbers looks like a press that did nothing* —
and for four hours that afternoon the numbers could not change at all, because
Bitrix24 was refusing every REST call. So the button now prints
«Yangilandi 16:12» beside itself for six seconds, or «Bitrix24 band — yangi
maʼlumot yoʻq» when the sync is blocked (`aria-live`, so it is announced as
well as drawn). The state is the timestamp rather than a flag: the message has
to name the moment or it reads as a status that was always true.
*And a single-page app does not notice a deploy* — five landed under that same
open tab. `scripts/writeBuildId.mjs` stamps `public/build-id.json` before every
`next build`; `useNewBuildAvailable` reads it on mount (that is what THIS tab is
running) and every minute after (that is what the server is serving now), and a
difference offers «Yangi versiya · yangilash». A BUTTON, never an automatic
reload: this dashboard is read in the middle of work and a page that reloads
itself loses the reader's scroll, filters and place in a table. A failed read —
offline, 404 in dev, HTML from a proxy — is never a new version. The file is
excluded from the auth matcher in `middleware.ts` for that last reason: an
expired session would otherwise answer the poll with the login PAGE.

**THE INTERVAL DOES NOT RUN WHILE THE TAB IS HIDDEN, so the focus refetch is
what keeps the promise.** `refetchIntervalInBackground` is false — a dashboard
left open for a week must not issue ten thousand queries nobody reads — which
means a reader who works in Bitrix24 and glances at this dashboard comes back
to whatever was on screen when they left. `refetchOnWindowFocus` was true, was
turned off on 2026-09-03 because every return reissued every query while
somebody switched tabs every few seconds, and is **true again since
2026-09-14**, when the client reported the other half of it as «avtomatik
yangilanmayapti» (measured: a return at +160 s was answered at +185 s, by the
timer, not by the return). What makes both true at once is `staleTime`: a
focus refetch fires only for a STALE query, so two returns inside a minute
cost nothing and a return after an hour is current at once. Changing either
value without the other brings one of the two failures back.

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

## The thirteen screens, and what each one dates by

**Two of the thirteen are PAUSED and two screens were removed.** «Boshqaruv markazi»
went entirely on 2026-09-10 («boshqaruv markazi boʻlimini toʻliq olib tashla»);
«Joʻnatish nuqtalari» and «Reklama samarasi» keep their section, their nav entry
and their endpoints but render `shared/SectionPending` and issue no request
(«hozircha api qilmay tur… bitta bitta keyinchalik toʻgʻrilab chiqaman»). The
feature files under `features/warehouse` and `features/marketing` are HELD, not
dead: switching one back on is an import and a `<Suspense>` in its
`src/app/<name>/page.tsx`, and that page's own comment says so.


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
| Savdo dinamikasi | `/analytics/sales` | `sales/SalesPage` + `ForecastSection` + `ConfirmationOutcomeSection` + `ConfirmationFaktSection` + `DeliveryBoardSection` | `/analytics/sellers` twice (the board, and `?include=faktTrend` for the chart) + `/insights/delivery` | SellerBoard, Pulse → SellerBoard, Pulse | the arrival in `C4:NEW` (`queued_at`) — **except the Доставка board, which has NO window at all**: a kanban column is where orders are standing now |
| Mijoz qaytishi | `/analytics/cohort` | `cohort/CohortPage` — ONE reading, the MATRIX FIRST. It had two modes («Oddiy» / «Batafsil», `?mode=`) until 2026-09-16; the manager's view and everything only it read are deleted. The matrix has THREE readings of one fetch — «Jami qaytgan» / «Oylik» / «Pul» — and ONE control that is a different question: `?rop=`, the acquiring team, which is its own cache entry and its own request | `/insights/cohorts`, `/insights/customers`, `/insights/concentration` | Insights, Concentration → Insights, Concentration | **nothing — the screen is DATELESS since 2026-09-15** (`period={false}`, like Struktura), and it now carries TWO CLOCKS, each named on screen. `closedAt` on revenue-bearing WON deals is the clock the matrix and the concentration band read; `/insights/customers` reads `createdAtSource` over its OWN trailing 90 days, so its customer totals legitimately differ — never sum across them; the matrix takes no window at all (`months` bounds which cohort ROWS are drawn and never the totals arm) and `/insights/concentration` resolves its OWN trailing 90 days (`trailingDays`). Nothing here reads `createdAtSource` |
| Qoʻngʻiroqlar | `/customers` | `calls/CallsPage` + `CallTable` | `/insights/calls` | Insights → Insights | `call_record."startedAt"` on the dashboard window, clamped below at `CALL_DATA_FLOOR` (2026-09-15 00:00 Tashkent). One clock, one request |
| Reklama samarasi | `/marketing` | **PAUSED** — `shared/SectionPending`; `marketing/MarketingPage` is held, not mounted | none while paused (`/marketing/overview`, `/marketing/breakdown`, `/marketing/verify` still answer) | Marketing → Marketing | `marketing_daily."date"` — the Roistat sheet's own lead date. **Not Bitrix24 data at all** |
| Target tahlili | `/target` | `target/TargetPage` + `TargetGroupTable` + `TargetLeadTable` + `TargetAds` | `/target/overview`, `/target/leads`, and `/marketing/breakdown` (which admits `['marketing', 'target']`) for the campaign table | Target → Target, Marketing → Marketing | **the deal's creation, `createdAtSource`** — a lead on the day it was registered, a sale on the day the seller's deal was opened. The ad block is the Roistat ledger over the same calendar days, on `marketing_daily."date"` |
| Yalpi marja | `/margin` | `margin/MarginPage` | `/insights/margin` | Insights → Insights | `closedAt`, WON + `countsAsRevenue` |
| Logistika | `/logistics` | `logistics/LogisticsPage` + `DailySection` | `/insights/logistics` | Insights → Insights | **the arrival in `C4:NEW`** (`queued_at`) — the confirmation queue's own cohort, since 2026-09-10. It was `createdAtSource` until then |
| Tasdiqlash navbati | `/confirmation` | `confirmation/ConfirmationPage` | `/insights/confirmations/orders` | Insights → Insights | **the arrival in `C4:NEW`** — the latest `deal_stage_history` row whose stage signals `CONFIRM_NEW`; `?queue=backlog` (where the bell lands) drops the window entirely |
| Joʻnatish nuqtalari | `/warehouse` | **PAUSED** — `shared/SectionPending`; `warehouse/WarehousePage` is held, not mounted | none while paused (`/insights/dispatch` still answers) | Insights → Insights | `createdAtSource` — a creation cohort graded by the deal's **current** stage |
| Sotuvchilar oyligi | `/payroll` | `payroll/PayrollPage` | `/payroll/sellers` | Payroll → Insights | **a payroll period — a calendar month or one half of it**, resolved on the server from `month` + `half`. No dashboard preset reaches it |
| Sotuvchilar reytingi | `/sellers` | `sellers/SellersPage` | `/analytics/sellers` | SellerBoard, Analytics → SellerBoard | the arrival in `C4:NEW` (`queued_at`) — the confirmation queue's own cohort. **The television board**: two podiums and two ranked lists (sellers left, teams right) — the sellers' seats and rows carry medals, the teams' carry none — and ONE control, the FAKT 1 / FAKT 2 switch in each heading; the FAKT 1 / FAKT 2 totals, conversion, bonus fund and ladder render on Savdo dinamikasi (`sales/ConfirmationFaktSection`), which is why the route lists both sections |
| KPI rejalari | `/kpi` | `kpi/KpiPage` | `/kpi` | Kpi, Analytics → Reference, Deal | **the plan's own `periodStart`/`periodEnd`** — the dashboard window only *selects* which plan is live |
| Struktura | `/structure` | `structure/StructurePage` | `/insights/structure`, `/insights/structure/roster` | Insights → Insights | **nothing — the screen is DATELESS.** `period={false}`, no window control, and neither endpoint takes one |

`/` RENDERS NOTHING. It is a signpost with **no** `requireSection`: it calls
`firstSectionFor(LANDING_ROUTE)` and redirects, because it is where every login
and every bookmark lands and a guard there would bounce the user off their own
home page. `LANDING_ROUTE` in `src/lib/sections.ts` is «Sotuvchilar reytingi» —
named rather than taken from the head of `SECTIONS`, so where 289 people land
after signing in is a decision and not an ordering detail. An account that does
not hold it falls through to the first section it does, then to `/account`.

Per-screen traps worth knowing before you touch one:

- **Target tahlili** — added 2026-09-19 («targetingni toʻliq qanday
  boʻlayapti koʻrish uchun… pul maʼlumotlari… toʻliq leadlar haqida»). The
  client's «Target» Google Sheet is private and was never read; the screen is
  built from what that sheet is built from (`~/bitrix-sheets/Bitrix24Sync.gs`):
  deals on the seven `TARGET_SOURCE_IDS` in `mapping.ts`.
  **A LEAD AND ITS SALE ARE TWO DEALS.** The lead is the Регистрация (LEAD)
  deal; «Сделка успешна» makes the portal open a SECOND deal for the same
  contact in Первичный отдел, copying SOURCE_ID and the targetolog, and that
  deal id moves on to Тасдиклаш and Доставка. The summary counts both sets over
  one creation window and never adds them — per-source and per-targetolog rows
  pair them by the fields the portal copied, not by a join. Only the lead LIST
  joins, per row after the LIMIT (`LEFT JOIN LATERAL` on `customerId`).
  База is never read. «Buyurtma» = a sales deal now in CONFIRMATION or REVENUE;
  «Tushum» = REVENUE + WON.
  **THREE NEW DEAL COLUMNS** — `targetolog` (enum, `UF_CRM_1772197583641`),
  `creative` and `primarySource` (type unknown while empty, read with
  `labelOrText`). Null is «Koʻrsatilmagan», never organic; 5% of target leads
  carried a targetolog on 16.08–15.09.2026 and the screen prints that share.
  Backfill a window with `npm run bitrix:resync -- DEALS --since=YYYY-MM-DD`
  (`runEntity`'s `updatedSince`, which never moves the worker's watermark).
  **THE AD BLOCK IS THE ROISTAT LEDGER, SIDE BY SIDE.** Its lead count is
  printed beside the portal's, never divided into it. On 2026-09-19 the blob
  had 13 M September impressions and $0 / 0 leads — the sheet's spend is
  filled later — so `TargetAds` says so instead of printing a bare «$0.00».
  Company-wide (`analytics:read:all`, in `COMPANY_WIDE`): it names customers
  and phones, and neither half has a team to narrow by.

- **Savdo dinamikasi** — **stripped to FAKT 1 / FAKT 2 on 2026-09-10**, on the
  client's instruction («bu boʻlimda koʻp malumotlar ortiqcha boʻlib ketgan…
  menga bu boʻlim fakt 1 va fakt 2 va bitrix24dan»). Gone: the «Yopilgan
  tushum» hero figure and its composition line, «Yopilgan bitimlar boʻyicha»,
  «Savdo pulsi», «Bosqichlar qamrovi», «Mahsulotlar boʻyicha», «Manbalar
  boʻyicha» and the bonus ladder. What that bought is the reason to keep it
  that way: the screen had SEVEN requests on THREE clocks and now has two on
  one, so nothing on it can disagree with anything else on it. Re-adding any
  closedAt figure re-adds the reconciliation prose with it.
  `/analytics/sales`, `/insights/flow` and `/insights/pulse` lost their last
  caller with those blocks and were **deleted on 2026-09-10** in the callerless
  sweep below, along with their services. The URL `/analytics/sales` is still
  the SCREEN's address; only the endpoint of that name is gone.
  **The one block on that screen with a different clock is the Доставка board**,
  and it is deliberate: `/insights/delivery` takes a period and uses none of it,
  because the client reads these columns beside the portal's own kanban, where
  an order that arrived in June and is still in VODIY is in VODIY today. Two
  traps live in that one query and both print a plausible board rather than an
  error — the dashboard filters must ride the LEFT JOIN's ON clause (moved to
  the WHERE they delete every empty column) and the count must be
  `count(d."id")` (an outer join makes `count(*)` print 1 for an empty one).
  `tests/http/deliveryBoardSql.test.ts` pins both, and every stage name is
  printed VERBATIM in Russian — the block's whole value is that it reconciles
  against the screen it was copied from.
  **«PROGNOZ» — THE RUN-RATE AT EVERY LEVEL THE BOARD REPORTS, since
  2026-09-16.** Asked for by the client for FAKT 1 and FAKT 2 together, for the
  company, each ROP team and each seller. What existed before was ONE
  projection — of FAKT 2, for the company — behind one tile on the queue band,
  and `forecast.projected` is now `forecast.fakt1` / `forecast.fakt2`, the
  singular REMOVED rather than kept beside the pair for the same reason
  `restrictToEmployeeId` was.
  **IT COSTS NO REQUEST, NO ENDPOINT AND NO SQL.** A straight-line run-rate is
  `money ÷ elapsed fraction` and that fraction is ONE number for the whole
  screen, so every figure — 126 sellers, fifteen teams, the company — is
  arithmetic over rows already on `/analytics/sellers`. `ForecastSection` reads
  `useFaktBoard`, the same cache entry the hero and the FAKT band read, which
  is what makes it unable to disagree with the figures above it. The page still
  makes its two requests.
  **THE HORIZON IS THE SELECTED PERIOD'S OWN CALENDAR UNIT.**
  `projectionElapsedFraction` → `fullUnitWindow`, never the report window: a
  to-date preset is by construction nearly spent, and «Shu oy» on the 9th read
  94.4% and projected FAKT 2 forward by six percent. A finished preset passes
  through with an elapsed fraction of 1 and the block SAYS «davr yakunlangan»
  rather than printing a total under a forecast heading; below
  `PROJECTION_ELAPSED_FLOOR` (2%, ~the first fourteen hours) it says «erta».
  **NULL IS NEVER A ZERO, and on this cohort that is not a nicety** — delivery
  lags the arrival it is projected from by about two days, so «0 soʻm» in a
  column headed «prognoz» tells a floor that is working normally that its month
  ends at nothing. Every projection column prints an em dash instead.
  **A TEAM IS PROJECTED FROM ITS OWN MONEY, not from its sellers' projections
  summed.** Identical under a straight line, and the reading that stays true to
  what the column is asked the moment the rule grows a floor or a cap.
  **THE CHART RUNS PAST TODAY, DASHED, AND THE BUCKETS RIDE THE BOARD RATHER
  THAN `faktTrend`.** Appended to the trend they would reach
  `ConfirmationOutcomeSection`, which reduces the confirmation rate over every
  point it is handed and cannot tell a projection from a measurement — the rate
  would have been dragged towards zero with nothing on screen saying so. Three
  things in that continuation print a plausible chart rather than an error and
  all three are pinned: the granularity is `chooseGranularity(ctx.period)`
  passed in EXPLICITLY (the default would take it from the full unit — on «Shu
  yil» in February that is 46 days against 365, one either side of the 62-day
  threshold, so six weekly dashes would continue forty-six daily points); only
  buckets starting at or after the report window's end are drawn, so today's
  half-elapsed bucket is never drawn twice; and `spreadRemainingMinor`
  distributes the truncation remainder, so the dashed area sums to EXACTLY the
  tile above it. `tests/services/sellerForecast.test.ts`,
  `tests/features/faktTrendRows.test.ts`, `tests/domain/spreadRemaining.test.ts`
  and `tests/features/salesForecast.test.tsx` are what hold all of it; each was
  checked by mutation.
  **IT IS A PACE RESTATED AND NOTHING MORE.** No weekday shape, no holiday, no
  portal outage, no allowance for the FAKT 2 lag. Every projected figure is
  printed beside what has actually landed and the block names the method and
  the horizon in its first sentence, which is the only thing that makes the
  numbers safe to quote.
  **«TASDIQLASH NATIJASI» SITS DIRECTLY UNDER THE HERO, since 2026-09-15**
  («tasdiqlanganlar, tasdiqlanmay chiqdilar bilan tasdiqlanmaganlar nisbati…
  oʻrtachasi»). It is the hero's «navbatda jami N ta» opened up: the queue's
  FIVE states as a partition of the cohort — count, share and money each —
  the «Тасдиқланиш %» figure, and that rate day by day with the period's rate
  dashed across it. **It adds NO request.** The partition is `totals.outcomes`
  on the board `useFaktBoard` already holds, and the daily line divides
  `byOutcome` counts riding on the same `?include=faktTrend` points the FAKT
  chart draws — so the screen is still two requests to one endpoint and the
  block cannot disagree with the figure above it. Both come from the same
  `ratingSql` / `faktTrendSql` statements as FAKT 1 (five `state_*` columns
  beside it, `null` on `basis=intake`), pinned by
  `confirmationSellerRatingSql.test.ts` and `confirmationFaktTrendSql.test.ts`.
  **SHARES ARE OF THE COHORT, NEVER OF FAKT 1** — the Тасдиқлаш board divides
  by everything that entered, and a reader carries the number between the two
  screens. **The dashed «davr oʻrtachasi» is the POOLED rate**
  (ΣТасдиқланди ÷ Σcohort, the queue board's own `Math.round(x·1000)/10`),
  not the mean of the days: a Sunday with three orders at 100% weighs a
  thirtieth of the month in one and a thousandth in the other, and one screen
  carries one figure under that name — the same one the tile prints.
  `faktTrendSql` LOST ITS `HAVING` for this: a day whose every order was
  refused is a 0% point on the rate line, not a gap, and the FAKT chart never
  needed the gate (the service zero-fills every bucket). Measured on
  production for August 2026: 3 222 entered, 2 873 Тасдиқланди (89.2%), 331
  Тасдиқланмади, 17 Тасдиқланмай чиқди, 1 still queued. Per-ROP was offered
  and DECLINED («faqat kompaniya boʻyicha») — do not add the columns unasked.
- **Mijoz qaytishi** — **REWORKED ON 2026-09-15**, on the client's instruction
  («kogorta jadvalini … kuchaytirish … oddiylashtirish kerak, mijoz qaytishi
  boʻlimini toʻliqligicha yaxshilash»). Three things changed and each fixed a
  reading, not a look.
  **THE MATRIX DEFAULTS TO CUMULATIVE.** «Jami qaytgan» — of this cohort, how
  many have come back at least once BY month N — with «Oylik», the old
  per-month reading, one press away. Measured on production: monthly repeat
  purchase here runs **0–4%**, so ~250 cells landed in the two palest steps of
  a five-step ramp and the grid said nothing; the same customers read
  cumulatively run **0–37%**. It is NOT derivable from the monthly cells — a
  customer returning in +1 and again in +3 is in two of them — so the
  repository counts each returner's FIRST return month (`first_return` →
  `first_offsets`, emitted as a third `is_total = 2` UNION arm — see the 566 ms
  note below for why it is an arm and not a join) and the service runs a total
  over it. That CTE replaced the old `count(DISTINCT customer_id)` rather than
  joining it: a count(DISTINCT) already groups by customer inside each cohort,
  so this is the same work with the month kept. **The identity to check:** a row's last measured cell equals
  its «Qaytgan» share, because the increments sum to `returned` by
  construction. The cumulative reading drops the `0` column (100% monthly, 0%
  cumulatively, for every row there has ever been) and has its OWN colour bands
  — 0/5/10/20/30 against the monthly 0/2/4/7/12, since one ramp cannot carry
  both scales. `tests/components/cohortMatrix.test.tsx` pins both readings and
  the double-count that would send the curve past 100%.
  **A «Jami · oʻrtacha» CELL UNDER `SUMMARY_MIN_BASE` (30) IS PRINTED BUT NOT
  PAINTED**, found on production hours after this shipped. That row read
  4 7 9 10 11 11 12 12 13 13 14 19 27 36 **0** — every figure correct, and
  together a cliff. Each column averages only the cohorts old enough to have
  reached it, so the far right is one or two ancient cohorts and the last
  column was ONE cohort of ONE customer who never returned. On the ramp beside
  fourteen real averages that reads as a collapse in retention. Same floor and
  same argument as Logistika's `WAIT_BAND_MIN_ORDERS`; the figure and its
  fraction stay, the colour and the trend do not.
  **THE GRID OPENS ON TWELVE MONTHS, AND IT IS ONE FIELD RATHER THAN 250
  CHIPS** — 2026-09-15, a second pass on the same instruction («kogorta
  jadvalini … tushunarliroq … soddaroq»). The query asks for eighteen months of
  cohorts, so the table drew up to nineteen columns and only the oldest cohort
  had cells in them: the right half was hatch a reader scrolled sideways
  through. `months` on `CohortHeatmap` (12 by default, «6 oy / 12 oy /
  Hammasi» beside the reading switch) is counted as an **offset, not a column
  count** — cumulative drops the `0` column and monthly keeps it, so a window
  counted in columns would end on «+12» in one reading and «+11» in the other
  under the same label. With the window on, the month columns FLEX between
  `W_MONTH` 44 and `W_MONTH_MAX` 72 so the matrix still fills its card; the
  three pinned columns keep fixed widths because every sticky `left` is a whole
  sum of them, and the hover panel now clamps against the table's MEASURED
  width rather than that minimum. The tiles meet — `GRID_LINE` draws the
  separation as a hairline in the card's own colour and `crosshair()` lights the
  hovered row AND column across the grid, which is what makes «2025-avg × +3» a
  cell anybody can find. The per-cell «%» is gone (the column group already
  says «…ulushi, %», and each cell's `aria-label` still states the figure as a
  percentage), and «Qaytgan» prints the SHARE alone — «117 · 3%» was two
  numbers in two formats in one right-aligned column — with the distinct count
  moved to that cell's `aria-label` and to the row's hover panel.
  **THE IDENTITY ABOVE IS WINDOW-DEPENDENT.** «A row's last cell equals its
  «Qaytgan» share» is true of the last MEASURED cell, never of the last DRAWN
  one, so a truncated grid would have a reader compare a twelve-month figure
  against an eighteen-month one and find the table contradicting itself. The
  legend swaps that sentence for the caveat whenever `truncated` is set.
  **«База» IS FOUR STATES, NOT FIFTEEN STAGES.** The card drew one bar per
  portal stage under copy promising «1 kun, 3 kun, 10 kun, 20 kun, 30 kun» —
  five of the fifteen; the other ten were never named. The partition is
  `src/lib/retentionGroups.ts` (Yangi / Aloqa siklida / Faol mijoz / Sovigan),
  keyed by **stage id** and read by BOTH sides exactly as `logisticsBuckets` is.
  Every level is its own `count(DISTINCT customerId)` under one `GROUPING SETS`
  — stage, group, funnel — because a customer on two stages of one group is one
  person in it, and summing the level below is how this screen once printed a
  base 1 660 people too big. The four still **do not** add up to the base
  (one customer, two open deals, two states) and the card says so rather than
  presenting them as parts of a whole. An unmapped stage becomes its own
  «Boshqa bosqichlar» row; `tests/domain/retentionGroups.test.ts` and
  `tests/http/retentionStagesSql.test.ts` pin the partition and the statement,
  and `tests/features/retentionStateBars.test.tsx` renders the card — the demo
  seed has no RETENTION pipeline at all, so production is the only place the
  bars have ever drawn.
  **«Faol bazada» LEFT THE TILE ROW**, where it read «12 558» beside «Jami
  mijozlar 11 512» — two numbers contradicting each other on their faces
  unless the reader already knew one counts База deals and the other counts
  first purchases. It is stated on the База card now, over its own denominator.
  Still a separate DISTINCT-customer total, never the sum of the bars.
  **AND THE PERIOD CONTROL IS GONE, because it drove nothing.** The matrix
  needs the whole history, the База bars are today's snapshot — so the only
  thing the control reached was `/insights/concentration`, which inherited the
  dashboard default of «Bugun». Read on production 2026-09-15 that gave the
  band **12 customers, ONE first-to-second pair and a cohort of four**, under
  «Top-10 mijoz ulushi 89%» painted critical red. Every figure was
  arithmetically correct and the band as a whole was noise. The endpoint now
  resolves its own trailing 90 days (`trailingDays` in `period.ts`; `days` is a
  parameter, wired to no control), and the four tiles refuse to print at all
  under `MIN_CUSTOMERS` 30 / `MIN_PAIRS` 10 / `MIN_COHORT` 30 — low on purpose,
  to catch a day's trading rather than a quiet fortnight.
  **THE MATRIX IS THE FIRST THING ON THE PAGE, AND «ODDIY» IS GONE —
  2026-09-16, on the client's instruction («kogorta jadvali tepaga chiqarish
  kerak va oddiy degan narsa kerak emas»).** The screen carried TWO renderings
  of one fetch: «Oddiy» (`SimpleView` — three questions in sentences and
  shapes) and «Batafsil» (the matrix and the bands under it), chosen by
  `?mode=`. Both are removed, the toggle with them, and the matrix now opens
  the page with nothing above it.
  **WHAT WENT WITH THE MODE, because it had no other reader.**
  `SimpleView.tsx`, `ReturnAnswer.tsx` and `ArrivalBars.tsx`; the mode half of
  `useCohortMode.ts`, whose file is now `useCohortRop.ts` and carries the team
  cut alone; five test files (`cohortSimpleMode`, `cohortAgreement`,
  `cohortArrivals`, `cohortReturnAnswer`, `cohortMode`); and THREE DTO FIELDS
  — `currentMonth`, `revenueTotalAll`, `revenuePerCustomerAll` — which
  «Oddiy» was the only reader of, in BOTH mirrors. Net **−2 100 lines**.
  `currentMonth` is still COMPUTED on the server (it is the horizon every
  row's `ageMonths` is measured from); it simply no longer travels, and the
  statement underneath is unchanged.
  **FIVE EXPORTS IN `Heatmap.tsx` BECAME INTERNAL** — `columnAverage`,
  `MIN_COHORTS_FOR_AVERAGE`, `sharePercentText`, `columnMoneyAverage`,
  `multipleText` and their three types. Every one was exported for
  `ReturnAnswer`, so that «Oddiy»'s milestone and the grid's summary row could
  not drift apart. With one reading left there is nothing to keep in step, and
  an export with no importer is an invitation to build a second reading again.
  **AND BOTH QUERY GATES WENT.** `/insights/concentration` and
  `/insights/customers` were `enabled: mode === 'detail'`, which earned its
  place while most visits never opened the analyst's view. Every consumer is
  now drawn on every visit, so the gate would be a condition that is always
  true. **The keys stay literals**, and that is the half of
  `cohortStale.test.tsx` that survives: no query here is disabled any more, but
  `providers.tsx` still applies `placeholderData` on any KEY CHANGE, so giving
  one of these reads a moving key puts the latch one `enabled` away from
  being reachable again. That file's DOM cases were rewritten rather than
  deleted — the page must still never be dimmed — and its source pins kept.
  **ONE TEST WAS DELETED RATHER THAN RE-POINTED**: the «izoh» tooltip audit in
  `cohortExplains.test.tsx`. Every tip it checked lived in «Oddiy»; the one
  tooltip left is `RepeatShareCard`'s, which is not in that set, and the
  deleted test's own comment says asserting over an empty set is vacuous.
  **AND ITS `openPage` NOW WAITS ON «Jami · oʻrtacha», NOT ON A CARD TITLE** —
  the title renders before the fetch resolves, so waiting on it would let every
  assertion race the data and fail as «the page does not say this».
  **«YETKAZILGAN» AND «YOPILGAN (WON)» NAME THE SAME EVENT.** A deal becomes
  WON the instant it reaches Успешно, which is the instant Logistika would
  call it delivered; there is no second clock here and an earlier comment
  claiming a 20–25 day gap between the two was wrong (that gap is real, but it
  is order→delivery, and every figure on this screen already sits on the
  delivery side of it). **What does not reconcile against Logistika is the
  DENOMINATOR**: Logistika counts ORDERS that arrived in a bounded C4:NEW
  window, this counts DISTINCT CUSTOMERS by their first purchase over all
  history. A customer with three orders is one here and three there, and a
  customer whose first order predates the window is here and not there. That
  is said to the reader once, in `cohort-total-hint` under the tiles; pinned by
  `tests/features/cohortExplains.test.tsx`.
  **`cohorts()` IS DELIBERATELY UNSCOPED, and that is a business fact, not an
  oversight.** The route declares `analytics:read:all` and the repository
  method takes `{ months }` and nothing else — no `restrictToEmployeeIds`
  reaches it. A customer's purchases are spread across whoever happened to
  answer the phone, so a per-seller retention curve would be measuring which
  seller's colleagues sold to their customers. There is no correct narrowing,
  which is why the endpoint refuses a narrowed account outright rather than
  answering it with a number. See *Which endpoints admit a narrowed account*
  above — cohort is in the still-refusing list, and it belongs there.
  **TWO IDENTITIES A READER CAN CHECK WITHOUT LEAVING THE TABLE.** A row's
  last MEASURED cumulative cell equals that row's «Qaytgan» share, by
  construction: the curve is a running sum of `firstReturners`, each returning
  customer walked in exactly once, advanced only inside the row's reachable
  span. And the matrix footer's money is its own column summed and nothing
  wider — the grid's own `months` prop bounds COLUMNS, so the figure does not
  move under the 6 / 12 / Hammasi control. Both were re-measured against
  production on 2026-09-15 and held on every cohort.
  **«MIJOZLAR OQIMI» IS MOUNTED — 2026-09-16.** The endpoint, the service, the
  three repository statements, `src/lib/customerStates.ts`, `CustomerFlowChart`
  and two test files had all shipped on 2026-09-15 and **nothing rendered
  them**: the screen was one `useQuery` and a band away from the work being
  finished. Four tiles, the new-vs-returning chart, sources and today's
  silence, directly under the matrix.
  **IT INTRODUCES THE SCREEN'S SECOND CLOCK, and both are named out loud.** The
  band dates a customer from the day they ORDERED (`createdAtSource`);
  everything below dates them from the day their first order was DELIVERED.
  «Kogorta tahlili»'s hint gained «Yetkazilgan sana boʻyicha» in the same
  change. The two customer totals differ on purpose and **must never be
  summed**; unlabelled, they read as one of them being broken, which is the
  first conclusion a reader reaches and the one nothing else corrects.
  `cohortExplains.test.tsx` pins both sentences present at once.
  **IT RESOLVES ITS OWN NINETY DAYS, server-side**, exactly as
  `/insights/concentration` does and for the reason that route records: the
  period control was removed on 2026-09-15, and an endpoint wired to a control
  that does not exist is how the sibling came to report twelve customers under
  a critical-red gauge. The span is printed from `meta.period`, not from the
  literal 90, so changing the default moves the sentence with it.
  **ITS KEY IS A LITERAL, AND THAT IS THE HALF THAT STILL MATTERS.** It
  shipped `enabled: mode === 'detail'` and lost the gate hours later with the
  mode; every consumer is on the page unconditionally now. The literal key
  stays, because `cohortStale.test.tsx` exists for the hazard a CHANGING key
  creates: `providers.tsx` gives every query `placeholderData`, which
  query-core applies with no `enabled` check, so `isPlaceholderData` latches
  and nothing clears it. That file's source pin names this key too, and
  `stale=` is still absent from the page.
  **THE BAND CARRIES SOʼM, NOT A THIRD «TAKRORIY TUSHUM ULUSHI»** — a
  deliberate departure from the plan, which asked for a gauge there. That label
  was already on this screen TWICE (whole history, and `RepeatShareCard`'s own
  ninety days), and two was only acceptable because each names its own SPAN; a
  third reading «soʻnggi 90 kun» would have put two ninety-day repeat shares,
  on two different clocks, under one name. «Takroriy xarid tushumi» collides
  with nothing and is the figure that share divides.
  `cohortExplains.test.tsx` pins the count at exactly two.
  **AND TWO PHRASES ARE OWNED BY ONE BLOCK EACH.** «bugungi holat» belongs to
  the База card; the band's silence tile says «davrga bogʻliq emas» instead,
  although it is also a snapshot. `getByText` throws on a second match, which
  is what enforces it. The states block likewise does NOT redraw the portal's
  own four-state verdict — it measures silence from order dates and points at
  the База card rather than inviting a comparison.
  **The sources card is TWO PANELS ON TWO CLOCKS, IN ONE ROW ORDER.** The count
  is the band's ninety days; the repeat rate is the whole history on a fixed
  ninety-day maturity horizon. The lower panel is never re-sorted — what makes
  the pair readable as one answer is that the eye runs down ONE column of
  labels, and sorting it would quietly turn one card into two.
  **STILL UNVERIFIED AGAINST PRODUCTION** — the plan's Task 10 (a probe
  asserting four invariants, then the timing) has not run: this checkout
  cannot reach the database. The statements themselves were measured when they
  shipped; what has never been checked is the band drawn end to end.
  **EVERY CELL NOW PRINTS ITS OWN DENOMINATOR — 2026-09-16, on the client's
  instruction to rebuild the screen around «foizlar va raqamlar bilan
  koʻrsatilgan» matrix.** A cell said «12» and kept the headcount in a tooltip
  and an `aria-label`, so the module's own opening claim — nothing here is a
  number whose denominator the reader has to guess — was true only of a reader
  with a pointer, and this table is read by a manager scanning a column.
  «12 · 47» states both. `W_MONTH` 44 → **66**, measured from the widest pair
  the grid can produce («100» at 11px tabular is 20.5px, the count at 9px
  carries «11 500» in 32 — the summary row's «Oylik +0» cell is every
  first-time buyer in the matrix at once). **The cost was taken deliberately:**
  twelve months plus the 460px pinned block is 1 252px against ~988 on a
  1280px laptop with the rail open, so that screen scrolls by ~264px where it
  scrolled by ~10. The pinned block is sticky and «6 oy» is one press away.
  The share is `data-share` and the count `data-count`, because «the grid's
  figure» used to be `[data-heat]`'s whole `textContent`, which
  `cohortAgreement.test.tsx` compared against «Oddiy»'s milestone. That test
  and that milestone are both gone; the addresses stay, because a tile holding
  two figures needs each of them separately reachable whatever asserts on it
  next. **A cell the reading cannot measure prints
  no count either**: `· 0` under an em dash would report a measured zero where
  the grid means «this month has not happened».
  **A THIRD READING, «PUL», AND IT COSTS NO REQUEST.** `revenue` has ridden
  every row since the matrix learned to print a cohort's money, so the money
  view is arithmetic in the browser over the payload the other two readings
  draw — the page still makes its two requests and the three readings cannot
  disagree. A cell is the cohort's money **through** that month divided by the
  cohort («13,5 ming»), with the multiple against its OWN first month beside
  it («×1,4»). **CUMULATIVE ONLY, deliberately**: a single later month is
  0–4% of the customers times one order, which is a sawtooth across a row and
  noise down a column. **THE RAMP IS ON THE MULTIPLE, NOT ON THE SOʼM** — soʼm
  cannot be banded (product mix and inflation move it and the grid goes one
  colour), the multiple is scale-free, and it is printed in the cell so the
  colour converts back. **«0» IS KEPT HERE AND DROPPED CUMULATIVELY, and the
  two absences mean opposite things**: cumulatively that column is 0% for
  every row there has ever been, in money it is the denominator every other
  cell divides by — so it keeps its soʼm, loses its multiple (×1,00 is a
  definition, not a measurement) and comes off the ramp. **AND THE COLUMN
  COMPARES DOWN, which is the point**: the pinned «1 mijozga» column may not
  be read down its column (`MONEY_YOUNG_MONTHS` — it ranks rows by AGE), and a
  matrix column has no such defect because every cell in «+6» is a cohort at
  six months old. The legend says so, because a reader who has taken the first
  rule to heart will not assume the exception. The row's identity: **the last
  MEASURED money cell equals the pinned «1 mijozga» figure**, by construction.
  **THE FIVE MONEY BANDS ARE NOT MEASURED AGAINST PRODUCTION** (1,02 / 1,1 /
  1,25 / 1,5) — the customer ramps were cut from measured ranges and nothing
  has yet read the money curve on the live portal. A grid in one step is the
  symptom and those five numbers are the whole fix.
  **AND THE MATRIX CAN BE CUT BY THE TEAM THAT BROUGHT THE CUSTOMER IN —
  `?rop=`, 2026-09-16.** The team is whoever made the customer's FIRST
  delivered order, read from `deal."operatorTeamSource"` with the seller's
  current department as the fallback: the same basis, in the same order, as
  Logistika's per-ROP strip, so the two screens name teams identically.
  **RETURNS ARE NOT RE-ATTRIBUTED** — a customer Sevinch acquired who buys
  again from Charos is still Sevinch's returning customer. That makes it a
  measure of WHOSE CUSTOMERS COME BACK and not of who does the retention work,
  which on this portal is whoever answers the phone; the screen says so in
  three sentences above the grid, built from the response's echoed `rop` and
  never from the control, which holds the new team for one render while the
  old rows are still drawn.
  **A DIMENSION, NOT A SCOPE.** The route still declares `analytics:read:all`,
  still refuses a narrowed account outright, and `ctx.scope` still reaches
  nothing — cohort stays in the still-refusing list above and belongs there.
  A ROP choosing to look at their own team and a ROP restricted to it are
  different mechanisms and only the first exists.
  **THE DEFAULT STATEMENT IS BYTE-IDENTICAL TO THE MEASURED ONE.** The
  attribution CTEs, the `$3` filter and the team-list arm are INTERPOLATED, not
  parameterised away, so a page that did not ask for the cut runs what it ran
  before. This endpoint's plan is measured, not assumed — 566 ms once hid in a
  single mis-estimated join — and charging every cold load a grouping, two
  joins and a regexp per customer for a cut most readers never open is the
  trade the wrong way round. `cohortsSql.test.ts` builds BOTH forms through a
  fake client and pins it: the default statement contains no `employee` at
  all. That file's old blanket ban on the word (a source-text assertion) is
  gone; what it forbids now is a SCOPE predicate, in either form.
  **THE SCOPED PATH IS UNMEASURED.** Nothing has run `EXPLAIN` on it — there is
  no production database reachable from the checkout it was written in. Time
  it from the app or from beside the database, never from a laptop in Tashkent
  (see the payroll note for the probe that lied by a factor of ten).
  **THE TEAM LIST RIDES `?include=rops`**, the same choice `/users` made for
  its department heads, and the picker fetches it on the FIRST reach rather
  than on load — its own cache key, `staleTime` five minutes, `months=3`
  because that request throws its own matrix away. `База` and the
  concentration band are NOT cut and say so: the follow-up cycle is run
  centrally, so there is no acquiring team to partition it by.
  **TWO DIFFERENT THINGS ARE BOTH CALLED `months`, and confusing them is how
  you write a wrong sentence about this screen.** The **API parameter**
  (`COHORT_HISTORY_MONTHS` = 18 in `CohortPage`, `$2` in the statement) bounds
  which cohort **ROWS** the matrix arm draws, and the totals arm deliberately
  ignores it. The **`CohortHeatmap` prop** of the same name is the 6 / 12 /
  Hammasi control and bounds which **COLUMNS** are drawn, of rows the grid was
  already given. Neither touches the other: the reader's column choice cannot
  move a row total, and the eighteen-month request cannot move a column.
  **TWO FLOORS, AND NEITHER IS DECORATION.** Per-customer money prints greyed
  under `MONEY_YOUNG_MONTHS` = 3 (a three-month-old cohort's lifetime value is
  noise, and a money column is an invitation to compare down it); a summary
  cell comes off the ramp under `MIN_COHORTS_FOR_AVERAGE` = 3 cohorts, after
  +12 once printed one cohort's number as the company average. That floor was
  shared with «Oddiy»'s milestone, which refused outright below it — the
  milestone is gone, the floor is not. The sparkline was truncated on that
  same floor
  rather than drawn past it. A third, `SUMMARY_MIN_BASE` = 30, takes a thin
  summary cell off the colour ramp.
  **A STATED LIMIT: DUPLICATE IDENTITIES.** Bitrix24 holds the same human
  under more than one contact row, and a second row is a second first
  purchase — so a returning customer is occasionally counted as a new one and
  the curve reads slightly low. The stated limit is **39 of 11 517 buyers,
  0.34%**, measured 2026-09-15 — kept because it is the higher, more
  conservative of the two figures taken that day. **The denominator moves and
  the method matters**: the same day's probe counted **11 536** buyers (the
  roster grows daily) and found **35 surplus rows sharing a normalised phone
  number, 0.30%**, which is the same finding by a narrower match. Quote the
  0.34% and say which of the two matchings you mean; do not present retention
  here as exact to the person.
  **THE CURVE IS FREE — BUT ONLY AS A THIRD UNION ARM, AND THAT COST 566 ms
  TO LEARN.** The cumulative curve was argued to be free because `first_return`
  REPLACES the old `count(DISTINCT customer_id)` grouping rather than adding
  one. That half is true and is worth about 1 ms. What the argument missed is
  that the per-offset counts then have to reach the matrix — and as
  `LEFT JOIN first_offsets fo ON fo.cohort = p.cohort AND fo.first_offset =
  p.months_since` they were the most expensive node in the product's slowest
  statement. **The planner cannot estimate a CTE**: it read `first_offsets` as
  3 rows against an actual 912, took a **Nested Loop Left Join** and rescanned
  it once per matrix row — `loops=13460`, **1 165 954 rows discarded by the
  join filter, 566 ms of self time**. `first_offsets` is emitted as its own
  `is_total = 2` **arm** instead, merged in the fold by
  `(cohort, months_since)`: ~87 extra rows on the wire, no join at all.
  Measured on production 2026-09-15, `EXPLAIN (ANALYZE, BUFFERS)`, three
  statements interleaved on one connection, twelve runs each — medians
  **pre-change (`7404c2a`) 414–415 ms · with the join 900–959 ms · with the
  third arm 405–467 ms**. The arm is back in the pre-change plan's range; the
  join's Nested Loop is gone from the plan and the only `Rows Removed by Join
  Filter` left (176 672, `returners`) is the one the pre-change plan has too.
  Folded payloads from the two shapes are **byte-identical**.
  **Buffers are `shared hit=24722`, `read=0` on all three shapes**, which is
  the fact that decides where to look next: none of this is I/O, so **an index
  could not have fixed it and cannot fix what is left**. `MATERIALIZED` on the
  CTE was tried and measured and did not help — the estimate drives the plan,
  not the materialisation.
  **The lever on this endpoint is therefore the JOIN SHAPE first and the SCAN
  second**, which is the reverse of what this file and
  `tests/http/cohortsSql.test.ts` said before 2026-09-15: the two `deal` scans
  are ~120–190 ms of the statement, the one join was 566. The covering index
  named in the method's own comment is still worth having; it is no longer the
  biggest thing available. And the 1587 ms recorded for this endpoint is an
  END-TO-END p50 from 2026-09-11, **not** a server-side execution time — do
  not compare it to any figure above. It should be re-timed on the deploy.
- **Qoʻngʻiroqlar** (URL `/customers`, section id `customers`) — **NEW ON
  2026-09-16 as «Mijozlar va qoʻngʻiroqlar», RENAMED AND STRIPPED ON
  2026-09-17** («eng asosiy malumotlarni koʻrsat, keraksiz narsalarni olib
  tashla… har bir narsa aniq vaqti bilan… kim qancha gaplashayapti»). The
  section id and URL did NOT change: ids are stored on account grants, and
  renaming one silently takes the screen away from everyone who holds it.
  **What is on it:** a line with the exact window and the newest call the sync
  has written (CALLS arrives on the three-hourly reference pass, so «Bugun» at
  14:30 can honestly end at 11:48), five tiles, the operators table — talk
  time spelled out with a share bar, team under the name, median AND mean,
  first–last call in Tashkent time — an hour-of-day chart, a per-day chart
  when the window spans days, and the teams table. **All of it is ONE
  statement** (`callActivity`, five `GROUPING SETS` arms), so every table
  and chart sums to the tiles.
  **What went, and must not come back unasked:** the customer-flow band (its
  endpoint `/insights/customers` still serves «Mijoz qaytishi» and its
  `section` moved back to `cohort`), the База / not-База call split and the
  buyer split `customerBaseSplit`, the duration bands, the calls-per-customer
  bands, the unlinked-calls note and p90. Their statements, DTO fields (both
  mirrors), constants and tests were deleted with them.
  **CALL DURATIONS BEFORE 2026-09-15 ARE WRONG IN THE DATABASE.** The
  per-minute pass read `voximplant.statistic.get` from its own watermark, so it
  stored calls mid-conversation and never re-read them. `CALL_DATA_FLOOR` in
  `src/lib/callQuality.ts` clamps every call query to the next midnight, and
  `SETTLE_LOOKBACK_MS` in `SyncEngine.ts` re-reads three hours of calls every
  pass so it cannot recur. Every time on the screen is bucketed with the
  two-step `AT TIME ZONE 'UTC' AT TIME ZONE` — see *Invariants*.
  **A CALL JOINS A CUSTOMER, NEVER AN ORDER** — `dealId` is set on 1 row of
  366 300 — and **direction is the leg, not the intent**, so the screen splits
  by neither.
  **THE MEDIAN IS ON SCREEN BESIDE THE MEAN, AND THE MEAN IS NOT ON THE WIRE.**
  169 s mean against 53 s median above the floor: 8.4% of calls hold half the
  talk time. Durations are spelled in units («2 daq 47 s», «3 soat 12 daq»),
  not `m:ss`, which beside a column of hours read as either.
  **THE TEAM IS `employee."departmentId"`, NEVER `department_member`**, with
  «(ROP)» stripped and non-ROP departments KEPT.
  **NOTHING OF IT RENDERS LOCALLY** — the demo seed has no calls — so
  `tests/features/callsPage.test.tsx` carries production figures.
- **Kanallar** — the dashboard-wide `preset` and `filial` do **not** reach this
  screen; it resolves its own window from `from`/`to`/`today`.
- **Yalpi marja** — discounts are split by sign in SQL; never net them or
  re-sum them client-side.
- **Logistika** — **REBUILT ON THE QUEUE COHORT ON 2026-09-10**, on the
  client's instruction («logistika boʻlimini yaxshilaymiz… tubdan»). It is
  now their own Google Sheet — ЗАКАЗ, ТАСТИКЛАНГАН, не собран, В пути,
  Ожидание/нд, Отказ, Успешно, %покрытия — and the columns are the eighteen
  Доставка stages grouped six ways by `deal_stage."logisticsRole"`. The
  partition lives in `src/lib/logisticsBuckets.ts`, which BOTH sides read:
  the repository builds its `CASE` from it and the screen draws its labels
  and colours from it, so a business definition the client approved stage by
  stage has one home rather than a hand-mirror. Pinned by
  `tests/domain/logisticsBuckets.test.ts` against `DELIVERY_STAGE_ROLES`.
  **THE COHORT WAS MEASURED, NOT CHOSEN.** Against the client's own week
  (31.08–06.09.2026) their ЗАКАЗ of 893 489 993 sits 98.6% on FAKT 1
  (881 270 000) and their Успешно of 698 539 996 sits 100.4% on FAKT 2
  (701 570 000); the old `createdAtSource` cohort gives 788 670 000 — 88.3%.
  So **ЗАКАЗ is FAKT 1, Успешно is FAKT 2 and %покрытия is one over the
  other**, measured with `FAKT1_OUTCOMES` and `faktDeliveredSql` — the same
  constants `ratingSql` groups by, so this screen and Savdo dinamikasi
  cannot drift. Verified against production: `summary.ordered` equals
  `/analytics/sellers` `totals.ordered` to the soʻm.
  `refused` vs `cancelledEarly` is still decided by whether the deal ever
  has a dispatch-role stage-history row, NOT by its current stage — on that
  week all 48 refusals stand in «Отказ предварительно» and all 48 had
  already reached a post office, so the stage name reports the opposite of
  the truth.
  **THE SHEET SPECIFIED THE COLUMNS; BITRIX24 SUPPLIES THE NUMBERS** — settled
  by the client on 2026-09-11 («bitrix24dagi malumot toʻgʻri… google sheet ni
  koʻrsatganim sababi shu malumotlar dashboardda boʻlishi mumkin… undagi
  malumotlarga tayanma»). Their sheet and ours split «still at a post office»
  against «refused» differently (8.4% vs their 16.70%, 10.9% vs their 4.25%)
  while Успешно and both totals agree to the soʻm — and that is not an open
  defect to chase: the portal wins, the mapping it specified is confirmed
  stage by stage, and nothing here changes. The last block on the screen is
  therefore an AUDIT TRAIL rather than a dispute — every Доставка stage
  verbatim with the column it feeds, so the six can be checked against
  obey.bitrix24.kz instead of trusted. **No stage COUNT is written down**,
  in that block or in `messages.ts`: it was eighteen until 2026-09-10 and is
  nineteen now, and both places said eighteen on a live screen for a day.
  `countsAsRevenue` is NAMED but COUNTED rather than filtered:
  the cohort is chosen by an arrival in Тасдиклаш (#4), which is not a
  revenue pipeline, so a `WHERE` would drop every queued and every refused
  order — `summary.offRevenueOrders` is the tripwire and is expected to be 0.
  **It counts only orders still INSIDE Доставка, and the narrowing is what
  makes the 0 mean anything.** Counted over the whole cohort it read 14 at
  60 days, 589 at 180 and 636 at a year, under a red line saying it must be
  0; every one was a confirmed order handed on to another funnel, 13 of the
  14 into «База» — a repeat purchase, already reported by name as
  `unbucketedOrders`, and the red line sent a reader hunting a defect that
  was ordinary business. Inside the funnel AND unflagged is the case that
  cannot happen, and it measures 0 at 60, 180 and 365 days.
  **The wait gradient follows the page's window, and a fixed trailing window
  was measured and REJECTED.** One row per order, resolved only, at five
  horizons: the first three bands hold at 94 / 86 / 75 whatever the window,
  but the last reads 61.5 (14 d) · 66.9 (30 d) · 62.5 (60 d) · 76.6 (120 d) ·
  78.5 (240 d) — a parcel that sat for weeks and was eventually collected
  only enters the measurement once the window contains its ending. Freezing
  one horizon would have frozen one answer into the block whose whole subject
  is how that answer moves. What a short window really costs is orders, not
  bias, so the guard is on the count: under `WAIT_BAND_MIN_ORDERS` = 30 the
  band prints its count and no rate (at thirty, one parcel is 3.3 points —
  about the gap between two neighbouring bands), and over a fortnight that
  bites on exactly the last band (13 orders against 378 / 333 / 188).
  **PER-ROP FAKT 1 / FAKT 2 SITS DIRECTLY UNDER THE HERO** — asked for on
  2026-09-12 («ROP larni FAKT 1 larini tortgansan… keyingi tarafida FAKT 2 si
  ROP larni har biriga kerak»). It is an eighth `GROUPING SETS` arm (`by_rop`)
  over rows already in memory, not a second question, and its total row IS the
  hero: `ropTotal` must equal `summary.ordered` and `summary.won` to the soʻm,
  which is what makes the table checkable. Like `by_fakt` it is **not** filtered
  to FAKT 1 — FAKT 2 is not a subset of FAKT 1, and a `WHERE k.fakt1` would
  print a full ЗАКАЗ beside a short Успешно.
  **THE TEAM COMES OFF THE DEAL, NOT OFF TODAY'S ORG CHART.** Settled by the
  client on 2026-09-14: «Организация сотрудника (не удалять)» on the deal card
  — `deal."operatorTeamSource"`, which the portal stamps at the moment of sale
  and never rewrites. The seller's CURRENT department (`c.rop`) is only the
  fallback, for the older orders the portal wrote no field on. Under the
  department basis a seller who changes team drags their whole history across
  and a settled month moves; one sampled July order still names
  «Husniddin(ROP)», a department the portal no longer has. **This screen only** —
  `c.rop` itself is untouched, so `/confirmation`, its РОП filter, its daily
  numbering and `/sellers` name teams exactly as before. The strip now has one
  home, `InsightsRepository.ropNameSql`, read by both bases; pinned by
  `tests/http/logisticsSql.test.ts` and `tests/http/confirmationQueueSql.test.ts`.
- **Joʻnatish nuqtalari** — delivery rate's denominator is *resolved* orders;
  in-flight is excluded and reported separately.
- **Sotuvchilar reytingi** — company-wide on purpose, and it is the ONLY route
  that admits a narrowed caller without narrowing: it passes `ctx.query` and
  never `ctx.scope`, and `boardFilters` drops `restrictToEmployeeIds` a second
  time so a scope cannot reach the SQL by one edit. See the block above
  *Client data flow* for the reason and what it discloses.
  **The FAKT 1 / FAKT 2 switch re-ranks in the BROWSER, and one press moves
  BOTH columns.** Added 2026-09-10 — «ikkita boʻlimni sotuvchilar va
  komandalar boʻyichasini fakt 1 va fakt 2 boʻyicha koʻrish mumkin boʻlsin».
  Every row is already on the payload carrying both facts, so this is one
  answer read two ways and not a second question: no parameter, no request, no
  cache key, nothing that can straddle a sync. `rankedBy` in
  `sellers/SellersPage.tsx` (it lived in `sellers/board.ts` only while the EFIR
  redesigns did)
  therefore MIRRORS `SellerBoardService` — `buildBoard` for the sellers and
  `teamRows` for the teams — the fact being read, then the other one, then the
  key, with competition ranking over BOTH figures; change that rule on the
  server and it has to change here in the same commit, or the two columns
  disagree about who is second.
  `tests/features/sellersTvBoard.test.tsx` is what holds the mirror: read on
  FAKT 2 it asserts the ranks the service sent, shared ranks and skips
  included. The choice lives on the page, not in the column, because a team's
  money is its sellers' money summed and two halves reading different facts is
  the reconciliation the seat's own FAKT caption exists to prevent, one column
  deep. It
  opens on 'auto' — the board's old behaviour, FAKT 2 once anybody has
  delivered — so a television nobody touches is unchanged.
  **MEDALS, AND NO LEVELS — 2026-09-17** («uroven kerak emas, medallar
  qolsin»). Four redesigns of this board were rejected and the client asked
  for the pre-medal board (`912fc63`) back with medals on it; spec
  `docs/superpowers/specs/2026-09-17-klassik-taxta-medallar-design.md`.
  `?include=medals` answers `{ sellers: [{ employeeId, medals }], from }` and
  nothing else: the level ladder, its titles, the promotion date and the
  per-medal unlock table were DELETED from `domain/analytics/sellerMedals.ts`,
  the service, both DTO mirrors and `sellers/medalCatalog.ts`, so **every
  medal the engine finds is transmitted** — an invisible level cannot hide a
  medal. The fourteen rules and their thresholds were calibrated on production
  and did not move; `MEDAL_ORDER` (true metal first) is pinned on both sides
  by `tests/features/medalCatalogMirror.test.ts`. A seller with a month fact
  in the window is listed even with `medals: []`, rows sort by `employeeId`
  (the reader keys a map by id), the window is fixed to `RECORDS_FROM` → now
  whatever the period filter says, and the 10-minute memo is keyed on the
  window START — never its end, which is `ctx.now` and would never hit.
  **WHERE THE MEDALS STAND, AND THE THREE THINGS THEY MAY NOT DO.** The board
  is `912fc63`'s to the pixel wherever there is no medal; `SellersPage` mounts
  one `<MedalDefs />`, asks `?include=medals` on its own ten-minute clock with
  NO period on the key (the record wall's pattern — a failed medal request
  leaves the ranking exactly as it was), and joins by `employeeId`. A seat
  carries ONE shelf under the team chip — champion up to 4 at 40px, the
  other two up to 3 at 36px (`seatMedals`), a repeat as the ×N chip (`CountChip`)
  inside the SVG; a row carries up to 3 at 26px at the right-hand end of the
  name cell, across the bar and chase lines (`rowMedalsOf`, `first-sale` never
  drawn there). **No «+N» and no caption anywhere; `TeamsColumn` has no prop
  that could receive a medal.** The three promises are CSS, in the MEDALS
  block of `globals.css`, and each was measured against the old board running
  beside it: **the podium does not grow** (489.0 → 488.9px at 1920×1080, and the same
  0.1px under the old board at 1600 and 2560, on «Shu oy», «Bugun» and the
  morning alike — the shelf's 46px came out of the seat's gaps, its paddings
  and a pedestal step that is the old expression LESS 1.2px, 28.6 where the
  old board had 29.8, still 1 : 1.6 : 2.4; the gap ABOVE the ring
  was left alone, because 4px less slides the crown under the plaque. **The
  step was 22px for a day** — blocks a quarter lower, which bought a fifth
  whole row — and the review measured the cost: numerals 47 → 33px, blocks
  that read as strips, bronze standing 3.5px above silver. §1.6 allows a
  tenth; `tvBoardLayout.test.ts` now holds the step within that of the old
  one. The teams' podium carries no shelf and is 46px SHORTER than it was,
  443 → 397); **the row does not
  grow** (the holder is exactly one 26px medal tall inside the 27.9 / 26.5px
  the bar and chase lines already took — 28px would not fit a laptop); **the
  number columns do not move** (`contain: inline-size` plus margins on the
  medals rather than padding on the holder, so the cell's minimum width is
  what it was — 10px of padding once dropped a team chip to a second line at
  1366). A medal that does not fit beside the chase wraps to a line that is
  never painted and so disappears WHOLE: three fit on the television, one or
  two on a 1366 laptop, and a phone gives them a line of their own. **Every
  bar in a list with medals shortens by the same `--row-medals-room`**,
  because the bars share one scale — 96px from 1800, 64px between 1280 and
  1799, and ZERO over 1280–1319 and 1600–1659, the two stretches just after
  the table gains columns, where the name cell is ~190px against a ~160px
  chase: no medal fits there, so no bar gives anything up and the rows are the
  old board's. Spec §1.6 also
  tightened the rows by a tenth (65.4 → 61.5px): at 1920×1080 the sellers'
  list shows 4 whole rows and 0.8 of the fifth (it was 4 and a half), the
  teams' 6 whole (it was 5); and it turned the
  «Bugun» morning's bold «0» into a muted «—» on rows with nothing on EITHER
  fact. **On a 1366 laptop the seat's shelf steps down to 36 / 32px** with the
  rest of the seat type (a 40px medal over a 17px sum out-shouted the money);
  the television keeps 40 / 36. **Steel medals — ~95% of what rows wear — were
  lifted in the two DARK token blocks only**: their body stood 1.6–2.4:1
  against the row and only the gilt device survived at 26px. **A new medal
  lands ONCE**: `useNewMedals` drops its flag after `NEW_MEDAL_MS`, because a
  flag that lived until the next ten-minute payload replayed the animation on
  every remount — a FAKT press, a re-rank, the phone's tab. `tests/features/sellersMedals.test.tsx` holds all of it, the CSS
  included, and was checked by mutation. **One old-board defect the audit DID
  fix:** the champion's pill «+21,500,000 soʻm oldinda» was one 150px nowrap
  run in a pill a 1366 laptop caps at 148px, so the words stood 1.2px outside
  it on both sides (9px at 1280). Between 1280 and 1599 the seat's pill now
  steps down with the rest of the seat type (10px, 6px pill padding, 8px card
  side padding — two lines at 1366, where the podium is 436px against the old
  board's 444), and the run may part
  before «oldinda», never inside the sum, so under ~1345px it takes a third
  line instead of spilling; pinned in `sellersTvBoard.test.tsx`. **Still the
  old board's and not fixed:** at 1366×768 the list is 69px tall (it was 61)
  and no row is whole; the phone's `.tv-seat-card` 8px side padding is a dead
  rule (the card's `padding` shorthand is written after it), on both boards.
  **«EMAL» MEDALS, LINE ICONS AND THE MEDAL KEY — 2026-09-18.** The client
  found the ZARB coins «oʻyinchoqdek» and chose «Yangi medallar + sayqal» on a
  frozen copy of the production page; spec
  `docs/superpowers/specs/2026-09-18-emal-medallar-design.md`, and its
  `assets/…/IMPLEMENT.md` wins any disagreement. A medal is the rank disc's
  small sibling now — an enamel field in a thin metal ring, three tiers told by
  the METAL (a solid disc for a year or a month won, a gold ring for the rare
  three, a steel ring for the daily seven); no laurels, no path-digits, and the
  ×N is the board's own chip (`CountChip`, real text inside the medal's SVG —
  so a seat's shelf now has `textContent`, and only that). `medalDefs.ts` is
  generated (`node scripts/genMedalDefs.mjs`), 26 ids, every colour a
  `--emal-*` token read on `:root` in all three theme blocks; NOTHING is
  re-bound on `.medal-defs` / `.medal-mark` any more. Every colour emoji on the
  board is a `BoardIcon` (one span, the emoji's own advance, so nothing beside
  it moved), and **the crown is centred by MARGIN**: `.rise` ends on
  `transform: none` with fill-mode `both`, which had been wiping the inline
  `translateX(-50%)` and leaving the shipped crown 12.5px right of its ring.
  **The SAYQAL section sits AFTER every other board rule on purpose** — several
  of its rules tie the specificity of what they refine and win on source order,
  which is how the mock was measured (podium −1px at 1920, −2px at 1366,
  number columns and row height Δ 0).
  **«MEDALLAR TASNIFI» CRAWLS ALONG THE FOOT** («medallar tasnifi pastda
  aylanib turishi kerak», the same day): `MedalTasnif` — all fourteen medals,
  drawing + name + the rule it is awarded on, in three named groups, on the
  record wall's mechanism to the letter. It runs the full width of the foot
  (`.tv-foot`) and the credit sits under its right end, absolutely placed in
  `main`'s 24px bottom padding (client: «pastiga koʻchir, kichikroq … medallarni
  ful oxirigacha»), so the two lists gave up 24px at 1920×1080 (a 38px strip
  where a 14px credit stood), not a whole row, and the credit costs nothing. **Its sentences restate the engine's
  thresholds by hand** — the layer rule forbids the import — and
  `tests/features/medalTasnif.test.tsx` checks them against
  `sellerMedals.ts`' constants; change a threshold and that test names the
  sentence. **At 1366×768 the strip sits at its 34px floor** and the lists
  give up 20px — the sellers' list, already 69px there with no whole row,
  keeps about 51px, i.e. its sticky header and a sliver of the first row. Not
  hidden there on purpose: the floor's television may be a 720p panel, and
  the client asked for the key ON the television.
  It is a key to the MEDALS, not the level ladder returning: the
  level guard in `sellersMedals.test.tsx` still refuses that board's class
  vocabulary anywhere on the page, which is why the component and its CSS are
  named «tasnif» and «group». **The same deploy removed the board's dead CSS**:
  the PODIUM block's rules for classes no component has rendered since the
  television board replaced the banner podium (`.podium-name`, `.podium-banner`,
  `.podium-ghost*`, `.podium-story`, `.rank-1/2/3`, `.rank-row`, `.rank-num`,
  `.figure-sum-hero/-runner`), and every base declaration SAYQAL always
  overrides — each base rule now names the SAYQAL item that paints it.
  Verified by diffing the computed style of every element under `<main>` in
  six states (1920 dark/light, 1366, 1440, a phone): identical, except the
  table heads' `font-feature-settings`, whose one rule (`"case"`) the shipped
  Inter subset cannot honour — the heads are byte-identical in a screenshot
  with and without it.
  **A MEDAL OPENS ITS OWN CARD ON HOVER** (the client, the same day: «medal
  ustiga olib borganda medal tasnifi kelib chiqsin»): name ×N, group, rule and
  THIS seller's latest instance — «3 marta · oxirgisi Avgust 2026 · 1,065,…
  soʻm». ONE `MedalTip` for the whole board, listening on the document for
  `.tv-board svg.medal-mark`, NOT the shared `Tooltip` around each medal: its
  `inline-flex` wrapper would break the MEDALS block's direct-child rules and
  with them the row-height and column promises. The seller is found through
  `data-employee` on the seat shelf and the row holder (sellers only — a team
  key is a ROP name). The rule text is `MEDAL_RULES` in `medalCatalog.ts`, the
  ONE source for the card and the strip. `orders` is read per medal and never
  generically (place on `rookie`, days on `work-month`). A TV has no pointer,
  so nothing depends on it; a phone opens it on a tap. The strip's title now
  says where the count starts («1-avg 2026 dan», the payload's `from`).
  **NOT MEASURED ON A FULL BOARD**: the local
  database seats two sellers, so the whole-rows count at 1920×1080 after the
  strip is arithmetic (4 whole and ~0.4 of a fifth for sellers), not a reading.
- **Sotuvchilar oyligi** — **NEW ON 2026-09-14**, the client's own pay scheme
  («hodimlar oyligi ni hisoblovchi bo'lim kerak… sotuvchilar oyligi fakt 2 ga
  qarab olinadi»). Three parts, three columns, each checkable: **8% of FAKT 2
  from the first soʻm**, a **fixed** part from the tier that figure clears
  (month: 45 → 500 000, 60 → 750 000, 70 → 1 000 000 mln soʻm; fortnight: the
  same table at 22.5 / 30 / 35), and a **dollar** incentive (40 mln → 50$,
  50 mln → 100$, first place **+25$ on top**, so the leader of a good month
  takes 125$). The rule is `domain/payroll/sellerPayroll` — quoted, not
  derived, like `analytics/sellerBonus`, and the two are DIFFERENT schemes:
  that one is the client's published dashboard ladder, this is the payroll.
  `tests/domain/sellerPayroll.test.ts` types out every worked example the
  client sent, including the one contradiction they settled — 60 mln pays
  **5 550 000** (the formula), not the 5 500 000 their sheet prints beside it.
  **NOBODY IS DISMISSED AND NOBODY IS ZEROED.** Their sheet says a seller
  under 30 mln leaves; they corrected it in the same conversation («ishdan
  ketmaydi shunchaki yozilgan… 30 mln dan pastlarni ham hisoblayver»), so
  every seller with delivered money is on the table with their 8% and no fixed
  part. Reinstating a dismissal rule would delete real pay.
  **FAKT 2 AND NOTHING ELSE**, read from `confirmationSellerRating` — the same
  query the sellers board reads — so a disputed figure can be traced on a
  screen the floor already has. The service does NOT go through
  `SellerBoardService`: that file serves the protected board, and payroll asks
  a narrower question on a different clock.
  **THE WINDOW IS A CALENDAR FACT.** `payrollPeriod(month, half, tz)` in
  `period.ts`; the endpoint takes `month` + `half` and never from/to, because a
  browser in another timezone would otherwise shift a day of pay from one half
  into the other. It is **not clipped to now** — a running period reports what
  has been delivered so far and the screen says so (`open`).
  **COMPANY-WIDE, AND FOR A DIFFERENT REASON FROM THE REST OF `COMPANY_WIDE`.**
  It could be narrowed; it is refused to a narrowed account because a team's
  payroll is twelve people's salaries. Opening it to a ROP takes three changes
  in one commit: the route's permission, the scope threaded through the
  service, and the scope added to its memo key.
  **IT IS NOT SLOW, AND THE FIRST MEASUREMENT SAYING SO WAS MEASURING THE
  WRONG THING.** A local `npx tsx` probe read 9–11 s for a whole month and the
  figure went into this file; the same query answered from the app in
  **0.9–1.1 s** (measured 2026-09-14 on `/api/v1/payroll/sellers`, both a
  fortnight and a full month). The gap is the probe's own round trips from
  Tashkent to fra1, not the database — a lesson worth keeping for the next
  probe: time a query from something that sits beside the database, or time
  the endpoint.
- **KPI rejalari** — the preset picks the plan but does not slice it. «Bugun»
  and «Shu oy» give identical numbers inside one plan.
- **Struktura** — **no money and no reporting window, and both are load-bearing
  absences.** The client's instruction was that money is stated on «Boshqaruv
  markazi» and nowhere else; that screen was removed on 2026-09-10 and the
  instruction stood, so this page still states none — the card's revenue, the
  list view's «Sotuv» /
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

## The 2026-09-10 cull — what is gone, and how to tell

The client asked for «Boshqaruv markazi» to be removed outright and for all dead
code to go with it («loyihadagi barcha oʻlik kodlarni yoʻqotish»). What went was
everything with **no caller in `src/features`** — the API had grown a long tail
of endpoints whose screens had been removed one instruction at a time.

**Fifteen endpoints** — every `/analytics/*` except `sellers`; `/dashboard/command`
and `/dashboard/overview`; `/deals` and `/deals/[id]`; `/employees/[id]`;
`/finance/overview`; `/insights/calls`, `/channels`, `/confirmations` (the
parent — `orders` and `regions` stayed), `/flow`, `/pulse` and `/response`.
Twenty remain. **Four services**: CommandCentre, Finance, Response, and the
whole instance side of Analytics — `AnalyticsService` is now two statics,
`context()` and `periodMeta()`, which is all three live routes ever asked it for.
**Two repositories** (Finance, Response) and ~40 methods out of four more.
**Forty-odd DTOs** from `src/lib/api.ts`, which lost a third of its lines.

**How to check the claim rather than trust it**, because this is the sort of
list that rots:

```bash
# Every endpoint, and whether any client code names it.
for r in $(find src/app/api/v1 -name route.ts | sed 's|.*api/v1/||;s|/route.ts||'); do
  echo "$r $(grep -rl "'/${r%%/\[*}" src/features src/components src/lib | wc -l)"
done
```

**Two things were deliberately NOT removed** although nothing calls them, and
both would look like oversights:

- `src/server/repositories/enumParity.ts` — imported by nobody on purpose. It is
  a compile-time assertion that the domain unions match the Prisma enums, and
  `tsc` reads it because `tsconfig.json` includes `**/*.ts`.
- `resetCrmProvider`, `resetAlertsQueueCache`, `marketingService.__internals` —
  test seams whose own comments say no test drives them yet. They exist so the
  first test that does is not the one that discovers the cache is shared.
- `REVENUE_PIPELINES`, `REVENUE_RULE` and `PAYMENTS_AVAILABLE` in
  `bitrix24/mapping.ts` — decision records with the measurements in their
  comments. `countsAsRevenue` on the deal row is what the code actually reads.

**What the sweep exposed and did not fix:** the ⌘K «Mahsulotlar» group still
links to `/analytics/sales?productIds=…`, and that screen has applied no product
filter since it was stripped to FAKT 1 / FAKT 2. The «Manbalar» group beside it
is fine — `sourceIds` does reach `sellerBoardRepository`.

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

**AND THE BACKLOG'S «LIVE ORDERS ONLY» FILTER LIVES IN THE COHORT, NOT IN THE
HISTORY SCAN.** It rode `moves` as `JOIN "deal" d0 … d0."status" = 'OPEN'`
until 2026-09-14, on the reasoning that open deals are a small fraction of the
table — they are **303 286 of 462 968**, so the join removed a third of the
rows and paid one random `deal_pkey` probe per confirmation move ever recorded
(70 876, against a 257 MB heap on a 1 GB database) to do it: **6.1 s of the
bell's 7.8 s**, once a minute per open tab, which is what had `/meta/alerts`
answering in 13 s or returning `INTERNAL_ERROR` on the afternoon the portal was
refusing us. `status` is a fact about the DEAL, so the predicate selects the
same deal_ids on either side of the per-deal aggregate; in `dated` it probes
the 165 orders whose latest signal is CONFIRM_NEW instead. **8.3 s → 1.7 s,
same 74 rows, row for row, board included** (measured back to back on
production). `confirmationQueueSql.test.ts` pins which CTE holds it.

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
  all 434 000 deals. It must not run at tick 0.
- **THE REFERENCE PASS AND THE SWEEP RUN ON THE WALL CLOCK, NOT THE TICK
  COUNTER — 2026-09-17** (`sync/schedule.ts`). `tick` restarts at zero in every
  process, so every deploy re-ran the reference pass (sixteen a day against
  eight scheduled) and a day with two deploys never reached the sweep's tick
  720 — no sweep ran in the 48 hours before this was measured. The worker now
  reads when each last ran from `sync_log` at startup: the reference pass is
  dated by its first entity's row, and the sweep writes its own `DEALS` /
  `FULL` / `SUCCESS` row (`recordsRead` = portal deals, `recordsUpdated` =
  rows deleted). A failed sweep retries after an hour, never on the next tick.
  The env vars still count TICKS and are converted with `SYNC_INTERVAL_SEC`.
  **A deploy now costs the portal nothing beyond the hot tick.**
- **`sync_log` keeps 30 days**, and a `RUNNING` row older than a day (a process
  killed mid-pass) is deleted — at startup and after each sweep.
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
- **AND IT HAS ITS OWN INDEX, because the chip is polled by every open tab.**
  `ORDER BY "finishedAt" DESC LIMIT 1` under a status filter was a sequential
  scan plus a top-N sort — **816 ms over 120 342 rows**, measured on production
  2026-09-14, and the endpoint ran it TWICE per request (the failure lookup
  re-read the success the caller had just fetched). Once a minute per open tab,
  on the one vCPU that answers every screen, that was enough for `/meta/alerts`
  to return `INTERNAL_ERROR` while the worker was catching up. Now
  `@@index([status, finishedAt(sort: Desc)])` serves both readers as a short
  backwards walk, and `findCurrentSyncFailure(lastSuccess)` takes the timestamp
  instead of re-reading it. If either the index or the parameter is removed, the
  header starts timing out again under exactly the conditions it exists to
  report on.
- **THE FRESHNESS CLOCK READS AN ALLOWLIST — `FRESHNESS_ENTITIES`, three of
  them.** «Necha daqiqa oldin» promises that the numbers on screen are current,
  and every number here is built from DEALS, STAGE_HISTORY and CUSTOMERS.
  `findLastSuccessfulSync` used to take the newest success of ANY entity, and
  on 2026-09-14 — four hours into a portal-wide `OVERLOAD_LIMIT` — two
  different passes made it lie in turn. `DEAL_ITEMS` makes no portal call at
  all (it reads what the DEALS pass left in memory), so with DEALS failing it
  finished SUCCESS once a minute and the header read «1 daqiqa oldin» over
  45-minute-old data: CUSTOMERS 11 failures, DEALS 11, STAGE_HISTORY 11,
  CALLS 9, DEAL_ITEMS 11 successes. Excluding it, `DEPARTMENTS` did the same
  more quietly — its method was still being answered while every deal call was
  refused — and the chip said «2 daqiqa oldin» over deals four hours old. Both
  readings were true and both were useless to the reader. THIS is what the
  client kept reporting as «avtomatik yangilanmayapti»: the refresh worked and
  the clock lied. A pass that read zero rows because nothing changed still
  counts — the portal answered for the data the chip is about.
- **`STORES` AND `STOCK` ARE NOT SCHEDULED AT ALL SINCE 2026-09-16; `CALLS`
  WAS UNSCHEDULED THE SAME AFTERNOON AND PUT BACK THE SAME EVENING.**
  `store` and `stock_level` are written by the sync and read by NOTHING —
  «Joʻnatish nuqtalari» is paused, and `catalog.storeproduct.list` returns
  zero rows on this portal. `call_record` was in the same position at 15:32
  (`35a5354`) and gained a reader hours later: «Qoʻngʻiroqlar».
  So CALLS is back in `REFERENCE` — the path that commit's own comment
  prescribed — on the three-hourly reference clock, at roughly 60–120
  invocations a pass against the 15 000-an-hour `portalBudget`. Unscheduled,
  not deleted, for the other two: handlers, provider methods and tables stay,
  and `npm run bitrix:resync -- STORES` fills one the day a screen needs it.
- The provider **ignores `pageSize`** and returns one page for most entities.
- Roistat is a second, unrelated source (a `var D = {…}` literal inside a 5.5 MB
  static page, parsed by brace-matching, not regex). It lands in its own tables
  and is spawned as a child process, hourly.

- **THE PORTAL CAN BLOCK ITSELF, AND THE DASHBOARD NOW SAYS SO.** On
  2026-09-14 every REST call came back `401` with
  `OVERLOAD_LIMIT — REST API is blocked due to overload`: Bitrix24's own
  throttle, portal-wide, lifting on its own. Three things were wrong with how
  that played out, and all three are fixed.
  **The reason was thrown away.** A non-ok response reported «Bitrix24
  responded 401» and dropped the body, so the sync log read like a revoked
  token for fifteen minutes and diagnosing it needed a probe against the live
  portal. `Bitrix24CrmProvider` now appends the portal's own code and sentence.
  **The screen said nothing.** The freshness chip went orange, printed
  «13 daqiqa oldin» and left the reader to conclude the REFRESH BUTTON was
  broken — they pressed it, reloaded, cleared the cache, and none of it could
  help. `/meta/alerts` now carries `syncError` (the code, the entity, when),
  the chip prints «Bitrix24 band» for a throttle and «sinx xatosi» otherwise,
  and the tooltip says whether to wait or to call somebody.
  `findCurrentSyncFailure` only reports a failure NEWER than the last success,
  so a healthy dashboard never wears a red mark for last week.
  **AND ON 2026-09-15 IT GAINED THE TWO THINGS IT STILL COULD NOT SAY.**
  `syncError.since` is when the run of failures BEGAN — `at` is the newest
  failed tick, which during an outage is always seconds old, so a four-hour
  block and a four-minute blip read identically; the tooltip now says «06:05 dan
  beri». And `syncError.kind` classifies the refusal SERVER-SIDE
  (`bitrix24/refusal.ts`), replacing a two-element allowlist of Bitrix24 codes
  that sat inside `Shell.tsx` — the portal's vocabulary on the wrong side of
  the one rule, and unreachable from the worker that needs the same judgement.
  A `CREDENTIAL` failure skips the deliberate five-minute quiet period the chip
  gives a throttle, turns the dot critical and names the act («portalda yangi
  kalit ochilib, dashboardga qoʻyilishi kerak»): a revoked webhook will never
  clear on its own, so waiting it out is exactly wrong. On 2026-09-15 that
  silence ran from 06:10 until somebody happened to look.
  `/meta/alerts` also reads its two halves with `allSettled`, so a slow backlog
  aggregate can no longer take the freshness clock down with it — the moment the
  database is under strain is the moment the header most needs to answer.
  **The worker exited.** `process.exit(1)` on a failed startup health check
  turned a transient throttle into a restart loop that re-issued the refused
  call every cycle. It logs and starts the tick loop instead; the loop already
  backs off up to five minutes.
  **And the restart itself was expensive.** `historyBackfillCursor` re-read 45
  days of stage history on EVERY start — five deploys in two hours is five
  such passes. It now runs only when the cursor has been still for half an
  hour, which is the case it was written for (a worker that was DOWN); a
  redeploy under a healthy sync is covered by `SKIP_LOOKBACK_MS`.

**A REFUSED PORTAL IS NOT ASKED AGAIN UNTIL A PROBE SAYS IT IS —
`PortalGate`, and it replaced the flat ten-minute wait on 2026-09-15.**

The old `throttled` flag could not do the job it was written for: it is
computed from the RESULTS of `runAll`, so by the time it is true every entity
in that tick has already been refused. Measured that morning under a 401
`OVERLOAD_LIMIT` — a hot tick sent 3 requests of which **2 left after** the
portal had already said no, a reference tick sent 12 of which 11 did, and a
restart inside the block sent 11 more because tick 0 is always a reference
tick. Over a four-hour block, ~107 requests fired into a door already shut.

The gate sits inside `call()`, BEFORE the rate limiter, so it covers every
caller — the engine, the sweep, `scripts/import.ts`, a hand-run resync. The
first refusal shuts it; every later call in that tick throws locally with the
remembered code and sends nothing. `scripts/syncWorker.ts` then does no work at
all while it is shut, and asks ONE cheap `profile` question on a ladder:
**60 s, 120 s, 240 s, 480 s, then 600 s** for a throttle (the ten minutes
`THROTTLED_WAIT_MS` used to be, now the ladder's ceiling in `portalGate.ts`),
and a flat **300 s** for a credential failure, which will not clear on its own
and where backing off only delays noticing that somebody fixed it. A successful
probe closes the gate and runs a full tick at once, so recovery is 1–3 minutes
into any block instead of always ten.

**The four refusals are one vocabulary, in `bitrix24/refusal.ts`.** `THROTTLE`
(OVERLOAD_LIMIT, QUERY_LIMIT_EXCEEDED) and `CREDENTIAL` (a revoked webhook, and
any unparsable 401) shut the whole gate; `METHOD` (OPERATION_TIME_LIMIT) holds
ONE method for ten minutes and leaves the rest answering; `TRANSIENT` tolerates
two failures before shutting. **`null` is the fifth answer and the load-bearing
one** — `INVALID_ARG_VALUE` is how `batchWalk` learns a chain ran dry, so
classifying it as a refusal would shut the gate on every SUCCESSFUL pass.
Branch on the CODE, never on `error_description`, which arrives in the portal's
interface language.

**The worker starts already knowing.** `lastRefusal()` reads the newest FAILED
row against the last `FRESHNESS_ENTITIES` success — two index walks, no portal
call — and seeds the gate shut when a refusal newer than that success is under
fifteen minutes old. A restart inside a block cost ~11 requests
re-discovering it, ~17 times a day; seeded, it costs 0 until a probe is due.

**AND THE ERROR MESSAGE STOPPED LYING.** «failed after 4 attempts» was a
constant, false on every non-retryable error — a 401 breaks out after ONE
request. That sentence went into `sync_log`, the dashboard tooltip and the
2026-09-14 incident notes, and it is why that outage first read as «the client
is hammering the portal four times over». It reports the attempts it made. The
429/5xx branch also stopped dropping the response body, which is what hid a
`QUERY_LIMIT_EXCEEDED` behind a bare «Bitrix24 responded 503» and kept the
ten-minute wait from ever engaging: measured at 40 HTTP requests where 10 were
expected.

**THE ROOT CAUSE OF THE THREE BLOCKS, MEASURED — `npm run bitrix:cost`.**
`obey.bitrix24.kz` blocked this integration three mornings running: 2026-09-14
11:20 (six hours), 2026-09-15 10:50, 2026-09-16 11:53, all `OVERLOAD_LIMIT`.
Every investigation before this one counted REQUESTS and RECORDS — the numbers
our side of the wire can see — and by both the integration looked modest. The
cause was found only by asking a third question: **how long does the PORTAL
spend answering us.** `sync_log` had held the answer since the day it was
written, because `finishedAt − startedAt` on a pass is almost entirely the
portal's execution time. Nobody had summed it. Over the three days ending
2026-09-16:

| entity | passes | avg | **total portal time** | records read | **s per record** |
|---|---|---|---|---|---|
| **DEALS** | 1 968 | **31.8 s** | **17.4 h** | 32 778 | **1.91** |
| STAGE_HISTORY | 1 969 | 1.2 s | 38 min | 1 465 859 | 0.0015 |
| CUSTOMERS | 1 975 | 0.9 s | 30 min | 8 739 | 0.21 |

**DEALS read 45× fewer records than STAGE_HISTORY and spent 28× more of the
portal's time — 1 200× more per record.** The cost was not the data; it was the
fixed fifty-command chain, and it was specific to `crm.deal.list`, whose
`CATEGORY_ID` filter and wide `select` over 464 000 rows make each command cost
**~0.64 s** of portal execution against `crm.contact.list`'s ~0.018 s. Forty-eight
of those fifty existed only to learn there was nothing more to read. Sustained,
that was **145 s of portal time per ten minutes on one method, day and night** —
30% of the 480 s Bitrix24 nominally allows, and three times that before the tick
was slowed from 60 s to 180 s on 2026-09-14. **Every block landed between 10:50
and 11:59** because that is when the client's own sales floor is working
`crm.deal.*` hardest: our steady 30% plus their morning emptied the method's
basket. It is also why cutting our REQUEST volume 7× after the first block did
not stop the next two — the requests were never the expensive part.

**THE HISTORICAL CAUSE WAS DIFFERENT AND IS ALSO GONE.** Before 2026-09-14 the
worker restarted **45–65 times a day** (`DEPARTMENTS` rows per day in `sync_log`:
57, 67, 59, 61 against a scheduled 16) and each restart wound the stage-history
cursor back 45 days: STAGE_HISTORY read **1 372 072 rows on 2026-09-13** from a
222 000-row table, six full re-reads a day. The Roistat heap cap stopped the
restarts and `historyBackfillCursor` stopped the re-reads: **2 730 rows on
2026-09-16, a 500× cut.** That is what the support ticket describes. It was
real, it was fixed, and it was not what caused the two blocks that followed.

**THE CURE AND THE GUARD, AND WHICH IS WHICH.** The cure is `CHAIN_MIN`: an idle
DEALS pass sends 2 commands, ~1.3 s instead of ~32 s, which at the 120 s tick is
~6.5 s per ten minutes — **from 30% of the method's budget to ~1.4%.** The guard
is the measured fallback in `portalMeter.ts`, because **this portal sends no
`time` block** and the gauge had nothing to read: `call()` now times every
successful request and bills it to the WALKED method, and above 60 s of our own
time per ten minutes a method is paced, above 120 s it waits. Those rungs are set
BELOW the 145 s that got blocked, deliberately — the portal's own users share the
basket and we cannot see their half. `portalMeter.test.ts` replays the incident
(a 36 s DEALS pass every 180 s is stopped) and the cure (a 1.3 s pass every 120 s
is never touched).

**HOW TO KNOW IT HELD, WITHOUT TRUSTING THIS PARAGRAPH:** `npm run bitrix:cost`
against production. The DEALS row's `o‘rt s` must read ~1–2, not ~32, and its
`sek/10daq` single digits, not 145. If it creeps back up, read the chain width
first.

**THE GAUGE WAS ALWAYS ON THE WIRE AND NOTHING EVER READ IT — `portalMeter.ts`,
2026-09-16.** Every successful Bitrix24 answer carries `time.operating` (seconds
of operating time this method has already spent in the current basket, against
the 480 s the portal allows per method per ten minutes) and
`time.operating_reset_at` (when the basket empties). `Bitrix24Response` had no
field for either, so `response.json()` parsed and discarded both on every call
this integration has ever made. **Everything this file says about our own
load — the 2 rps limiter, «107 requests into a closed door», the volumes in the
support ticket — was therefore an estimate made from OUR side of the wire,
against a limit only the portal can see**, and both blocks (2026-09-14, four
hours; 2026-09-16 11:53, three entities) were diagnosed after the fact from
`sync_log` row counts.

`PortalGate` is what happens AFTER a refusal; the meter is what keeps us off
the wall. They are deliberately separate — a tripped gate is a fact about the
past, a basket at 70% is a fact about the next minute. Above `SOFT_FRACTION`
(60%) `call()` paces, spreading what is left of the basket over what is left of
the window; above `HARD_FRACTION` (85%) it waits the basket out, because there
is nothing to pace INTO when the wall empties on a clock the portal hands us.
**A stale reading is no reading** — once its `resetAt` passes it is discarded,
or the meter would invent an outage of its own.

**IT BILLS THE METHOD THAT WAS SPENT, NEVER THE TRANSPORT.** A chained walk
sends `batch` and drains `crm.deal.list`'s basket fifty times over; filing that
under «batch» would hide the only method the portal was ever going to refuse,
which is exactly the blindness that made 2026-09-14 take a live probe against
the portal to diagnose. The sub-readings come from `result.result_time` and the
WORST is taken — the lowest is the state that method was in before this batch
ran. `OVERLOAD_LIMIT` is administrative and portal-wide with no published
threshold, so nothing here can promise to avoid it; what it can do is make our
consumption a measured number. `meter.stats().peak` is what the next support
ticket quotes.

**`npm run bitrix:meter` asks the portal once and prints all of it** — answering
or refused, which code, whether to wait or to issue a new webhook, and how full
the basket is. Safe during a block: it is the cheapest call there is.

**IT CALLS `healthCheck`, NEVER `probe`, AND THE FIRST VERSION GOT THAT WRONG.**
`probe()` exists for the gate: it swallows the error and answers a bare boolean,
because the gate only needs «is the door open». A diagnostic needs the REASON —
and the first version called `probe()` inside a try/catch and printed «✓ portal
javob berdi» on the strength of nothing having been thrown. Measured 2026-09-16
against a webhook the portal answers `INVALID_CREDENTIALS`: it reported the
portal healthy in 508 ms. **A tool whose whole job is to say «wait» or «issue a
new key» must not fail open.**

**THE PORTAL DOES SEND `time` — THE «IT SENDS NONE» READING WAS AN ERROR
RESPONSE.** It was measured against a webhook the portal answered
`INVALID_CREDENTIALS`, and an error body carries no `time` block. Against the
live webhook (`/rest/8868/…`, issued 2026-09-16) every success carries
`time.operating` and `operating_reset_at`, so the gauge READS here and the
measured fallback is a backstop again. Measured through the new chain that
afternoon: an incremental DEALS read of 18 changed rows took **1.6–2.2 s**
(against 31.8 s at the fixed fifty) and `crm.deal.list` stood at 5.9 s of 480
(1%) after three of them. Never measure the portal through a key it refuses.

**AND THE WALK STOPPED SENDING 48 COMMANDS NOBODY NEEDED — `CHAIN_MIN`.**
`batchWalk` sent a fixed chain of FIFTY id-chained seeks on every call,
including the once-a-minute incremental tick where the first command covers 50
changed rows and the portal has perhaps five. Each of the other 49 resolves a
`$result` reference to a row that does not exist; the portal executes,
validates and refuses each one with `INVALID_ARG_VALUE` — which the walk
correctly reads as «the data ended», and which is also fifty invocations of
`crm.deal.list` billed to read five rows. **From here that is invisible**: one
HTTP request a minute per entity, comfortably inside our own 2 rps limiter, is
all our side of the wire sees. Counted at the deployed cadence — four HOT
entities, one tick a minute, stage history walking two passes — it is **~288 000
method invocations a day of which ~277 000 exist only to discover there was
nothing more to read**, the largest single thing this integration does to the
portal.

A walk now OPENS at `CHAIN_MIN` (2) and WIDENS ×4 only when a chain comes back
FULL, which is the walk proving there is more; a chain that runs dry ends the
walk and **resets the width**, so the six-hourly sweep's widening cannot leave
every tick after it paying fifty. The floor is 2 rather than 1 so an ordinary
busy minute of 51–100 changed rows still finishes in one round trip. A full
import pays three extra round trips at the start (2 + 8 + 32 + 50 + 50 …):
`listDealIds` reaches 464 000 deals in 188 requests against the old 186. A
quiet tick costs **8 invocations instead of 200**.

**AND THE CEILING THAT MAKES IT NOT COME BACK — `portalBudget.ts`.** Everything
else in that directory limits a RATE, and **the rate was never the problem**: 2
requests a second was true for every second of both blocks. What earned them was
VOLUME, and a rate limiter has no memory — it answers «may this leave now», never
«how much have we asked for today». `PortalBudget` is that memory: a rolling
60-minute ceiling on INVOCATIONS, enforced inside `call()` below every caller
(the engine, the sweep, `scripts/import.ts`, a hand-run resync). Above 70% it
paces; at the ceiling it **refuses locally and sends nothing** until the window
drains. Refusing is safe wherever it lands — `listDealIds` throws rather than
returning a short read, `sweepByAntiJoin` will not delete on an empty source, and
no watermark advances except after a clean run — so a refusal costs freshness and
nothing else.

`DEFAULT_HOURLY_INVOCATIONS` is **15 000**, and the number is set by the one
expensive hour that is legitimate: the sweep's, at ~9 500. **WHAT IT DOES AND
DOES NOT CATCH, stated honestly, because an earlier draft of this paragraph
claimed more than it can deliver.** It does NOT catch a return to the
fifty-command chain on its own — that is ~6 000 an hour at the deployed tick,
comfortably under a ceiling the sweep forces to be high. `portalBudget.test.ts`
is what catches that, and it is why the test pins an EXACT number. What the
ceiling catches is the shape neither a test nor a comment can: an UNBOUNDED
loop. A cursor that stops advancing, a restart storm re-reading 45 days of
stage history over and over, a full walk retried in a tick loop — the
2026-09-14 pattern, where 94–97% of a day's traffic was the same 45-day window
read 11–29 times. Any of those crosses 15 000 in minutes. It
is `BITRIX24_HOURLY_INVOCATIONS`, so a portal under strain can be throttled
**without a deploy**, which is the one thing nobody could do during either block.
`scripts/import.ts` raises it to 250 000 — a full import is a deliberate act
somebody is watching, and sizing the worker's ceiling for a run that happens
twice a year would defeat having one. **A budget refusal must not trip
`PortalGate`**: the portal never said no, we did, and tripping it would put
«Bitrix24 band» on the freshness chip over our own accounting.
`classifyRefusal` returns `null` for `LOCAL_BUDGET_EXCEEDED` — listed BY NAME in
`NOT_A_REFUSAL`, because the bare-401 fallback would otherwise sweep it into
`CREDENTIAL` and tell an operator to go and issue a new webhook for a portal that
is answering every call.

**AND A SELF-IMPOSED STOP READS AS OURS, ALL THE WAY TO THE CHIP.** Three things
had to line up or it would have reported as a Bitrix24 outage:
*the code has to survive the MESSAGE* — `sync_log` stores text and
`syncErrorCode` recovers the code from it with a regex, so a code carried only on
the error's `code` field reaches the header as «UNKNOWN», which is the one word
nobody can act on; `SELF_LIMIT_CODE` is therefore one exported constant and it is
printed at the front of the thrown message.
*the chip needs a fifth reading* — `AlertsDto.syncError.kind` gains `SELF_LIMIT`,
and **it is NOT a `RefusalClass`**: that union answers «what should the CALLER
do» and `PortalGate` switches on it, so a fifth member there would fall into the
THROTTLE/CREDENTIAL branch and shut the gate over our own accounting. The two
were already joined by `?? 'UNKNOWN'`, which is the seam. The union is
hand-mirrored in `src/lib/api.ts` and `Shell.tsx` — **nothing checks the mirror**.
*and the sentence has to say so*: «Dashboard oʻzini toʻxtatdi… Bitrix24 sogʻlom»,
not «Bitrix24 dan maʼlumot olinmayapti — texnik yordam kerak».
The worker prints the same judgement with the remedy attached, naming the three
methods that spent the hour.

**THE HONEST COST OF THE CEILING: a cold start on an EMPTY database will hit
it.** The first walks are millions of rows — ~9 300 invocations for the deals
alone and far more for stage history — so an unattended worker filling a fresh
database makes progress at 15 000 invocations an hour instead of running flat
out. That is the intended behaviour and not a bug to route around:
`npm run bitrix:import` is the path built for that case and raises the ceiling
to 250 000. The worker's log says exactly this when it trips.

**THE TEST IS THE GUARANTEE, NOT THE COMMENT.** `portalBudget.test.ts` walks a
simulated hour of the deployed cadence against a portal where nothing changed
and counts what would have been asked for: **241 requests, 481 invocations** —
pinned EXACTLY rather than bounded, because a range absorbs a new pass without
anybody noticing it was added, and «one more entity, it is only fifty commands»
is how the old number reached ~15 000 an hour in the first place. Widen the chain back, add a pass nobody costed, or make
a walk re-read its window, and the number moves THERE before it moves on the
portal.

**TWO CADENCES WENT WITH IT, 2026-09-16.** The **deletion sweep** is DAILY
(`SYNC_SWEEP_EVERY` 1440, was 360): the narrow chain took the hot path to
~11 500 a day and did not touch the sweep, which walks a fixed 464 396 ids
however narrow the chain is — so at four bursts a day it had become **three
quarters of everything we spend** (37 200 against 11 500). One burst is ~9 300.
A deleted deal can now be counted here for up to a DAY; read a day-old test deal
as this setting. The **reference pass** is THREE-HOURLY (`SYNC_REFERENCE_EVERY`
180, was 30): departments, employees, products, pipelines, stages, sources and
stores change a few times a MONTH and were being re-read 48 times a day, and
`PRODUCTS`/`STOCK` page `catalog.*` fifty rows at a time so the pass is dozens of
requests, not one. A new department head now reaches the org chart and a TEAM
account's scope up to three hours later; `npm run bitrix:resync -- DEPARTMENTS
EMPLOYEES` does it in seconds when a hand-over has to land now.

**`SYNC_REFERENCE_EVERY` IS SET IN `.do/app.yaml`, SO THE CODE DEFAULT ALONE
CHANGES NOTHING IN PRODUCTION** — and the LIVE spec overrides the committed one
again (see *Deploy*: take the live spec, edit it, apply that). A cadence changed
in one of the three places and not the others is invisible and silent, which is
how it would come back.

**THE WHOLE DAY, BEFORE AND AFTER — AND THE TICK LENGTH IS PART OF THE SUM.**
Every figure above counts INVOCATIONS PER TICK; the day depends on how long a
tick is, and **the deployed app and this repository disagreed about that until
2026-09-16**. `.do/app.yaml` said `SYNC_INTERVAL_SEC` 60 and the LIVE spec said
180, so the same `SYNC_SWEEP_EVERY` meant six hours here and eighteen there, and
neither file looked wrong on its own. Read the tick and the two tick-COUNTS
together or none of them.

| | as deployed before | as deployed now |
|---|---|---|
| tick | 180 s | **120 s** |
| hot path | ~96 000 /day | **~5 800** |
| deletion sweep | ~12 400 /day (18 h) | **~9 300** (24 h) |
| reference | 16 passes/day (90 min) | **8** (3 h) |
| **total** | **~108 000** | **~15 000, an 86% cut** |

At the code's own default 60 s tick the old hot path is ~288 000 a day, which is
the figure the commit message quotes; production was a third of that because its
tick was three times longer. Both are true and they are not the same number.

The tick went to **120 s** on the client's instruction («2 minutda yangilansin»)
rather than back to the code's 60: the load cut bought the freshness back, and
two minutes was what they wanted. **The sweep is now ~62% of everything we
spend**, so it is where the next cut comes from if one is ever needed. No screen
reads anything different.

**WHAT THAT LEAVES, AND WHERE THE NEXT LEVER IS.** ~288 000 → ~11 500
invocations a day on the hot path, against the deletion sweep's unchanged
~37 200 (4 runs × 186 requests × 50 commands). **The sweep is now ~75% of
everything we spend**, so if blocks continue it is the next thing to cut, and
it is one environment variable: `SYNC_SWEEP_EVERY` (360 today, see the
six-hourly note above for what raising it costs — a deleted deal survives that
much longer here). `tests/integrations/portalMeter.test.ts` pins the gauge and
the request-versus-invocation gap; `bitrix24.test.ts` pins the narrow opening
and the widening, by counting the commands the walk actually sent.

- **THE CHIP NAMED ONE ENTITY FOR A PORTAL-WIDE OUTAGE.** `syncError.entity` is
  whichever pass failed LAST, so an hour with every number on every screen
  frozen was reported as «stage_history» — the narrowest thing on the portal,
  and a reader who knows what it is would have taken the deal figures for
  current. `findCurrentSyncFailure` also counts the DISTINCT entities failing
  since the last success (an index walk bounded by that timestamp, 0.3 ms on
  production, and it does not run at all while the sync is healthy), and
  `syncFailureScope` prints «9 ta boʻlim» instead of a name whenever the count
  is known and above one. A null count means *not counted*, never *narrow*, so
  it falls back to the name rather than inventing a scope. It is read beside
  `syncError.since`, which says how LONG.
- **THE LADDER HAS TO ACTUALLY CLIMB, AND UNTIL 2026-09-16 IT DID NOT.** Watched
on production under a live `OVERLOAD_LIMIT`, the worker printed «60s kutiladi»
on EVERY probe instead of 60 → 120 → 240 → 480 → 600. Two things combined. The
startup health check failed three times at network level, and `transientRun` was
only ever reset by a SUCCESS — of which there are none during a block — so the
count sat at the tolerance for the whole outage. And the TRANSIENT branch called
`openGate`, which REWRITES `kind`: one stray socket error turned a THROTTLE gate
into a TRANSIENT one, whose delay is a flat 60 s and whose `probes` counter
starts again at zero, and the next `OVERLOAD_LIMIT` then saw a kind mismatch and
opened at rung zero. Round and round, ~860 probes a day at a portal that had
administratively blocked us. **THROTTLE and CREDENTIAL are specific diagnoses
and TRANSIENT is the absence of one, so the specific one wins**: a transient no
longer demotes a named gate, and any named refusal — `OPERATION_TIME_LIMIT`
included, which is why the reset sits ABOVE the METHOD branch — ends the
transient run. Pinned by three cases in `portalRefusal.test.ts`.

**BITRIX24'S PUBLISHED LIMITS, AND WHERE THIS INTEGRATION STANDS — measured
2026-09-17** against apidocs.bitrix24.ru/limits.html. Three documented limits
and one that is not:
- **Intensity** — a leaky bucket on HTTP REQUESTS per source IP per portal
  (`batch` is one request): Enterprise drains 5/s with 250 of headroom, every
  other plan 2/s with 50. `QUERY_LIMIT_EXCEEDED`, 503. Our `RateLimiter` is 2/s,
  the lower plan's drain rate, so it holds on either plan; a hot tick is ~5
  requests every 120 s.
- **Execution time of one request** — 60 s on the cloud, after which the portal
  interrupts it. `PORTAL_REQUEST_LIMIT_MS`; our local abort is 65 s (it was
  180 s for a `batch`), pinned by `portalRefusal.test.ts`.
- **Operating time** — per METHOD, per WEBHOOK, over ten one-minute baskets;
  `OPERATION_TIME_LIMIT`, 429, blocks that method for that webhook only.
  **It is not shared with the portal's own users**, which corrects the reading
  above that «our steady 30% plus their morning emptied the method's basket»:
  the three blocks were `OVERLOAD_LIMIT`, which that page does not mention at
  all — an administrative, portal-wide protection. Our basket for
  `crm.deal.list` read **6.6 s** (1.4%) on 2026-09-17 09:18 Tashkent.
- **`OVERLOAD_LIMIT` is undocumented**, so no setting can promise to avoid it;
  keeping our share of the portal's load small is the only lever.
Steady state that morning, 16 h with no failure: DEALS 1.5–1.8 s a pass
(~8 s per 10 min), CUSTOMERS 0.95 s, STAGE_HISTORY 0.8 s; reference EMPLOYEES
15.5 s and PRODUCTS 14 s, eight times a day. The deletion sweep is cheap per
command — eight `select: ['ID']` seeks cost ~0.06 s of portal time against
~0.23 s for the hot `select` — and dropping the nine-pipeline `CATEGORY_ID`
filter was measured and changes nothing.

**A NEW WEBHOOK DOES NOT LIFT AN ADDRESS BLOCK — 2026-09-16.** After the third
`OVERLOAD_LIMIT` the webhook was replaced (`/rest/8868/…`). The new key answered
in 480 ms from an office machine and the deployed worker still could not reach
the portal: `fetch failed [UND_ERR_CONNECT_TIMEOUT]`. Measured from the worker:
TCP opened to all four portal addresses in 44 ms and the TLS handshake never
completed on any of them — small ClientHello and TLS 1.2 included — while the
same key answered from an office machine in 250 ms. No key was ever read;
Bitrix24's protection had stopped answering the SERVER'S ADDRESS.
The probe keeps its reason (`lastProbeError`, printed as «sabab:» under the
worker's wait line) and every failure message carries Node's socket code,
because «UNKNOWN» was all the log said. A network failure climbs its OWN, slower
ladder (`NETWORK_LADDER_MS`: 2, 5, 15, then every 30 minutes) with ONE attempt
per rung. **The ban lifted for a moment at 11:35 UTC and the worker answered
with a full reference tick and was dropped again inside a minute** — so a
recovery now runs `CALM_TICKS` (3) hot-only ticks before any reference pass or
sweep, a restart inside the block seeds the gate shut from `sync_log` (and a
failed startup health check shuts it too), and `reachability.ts` is no longer
run by the worker: its ~11 simultaneous unfinished handshakes answered the
question once and afterwards looked like a scan. **Read `UND_ERR_CONNECT_TIMEOUT` / `ECONNRESET` in that line as
«our address is blocked or the route is down»: rotating the key changes nothing,
waiting, Bitrix24 support (with the egress IP) or a new egress IP do.**

**THE ATTEMPT COUNT IN A FAILURE MESSAGE IS EVIDENCE.** `sync_log` is what
  this integration hands Bitrix24 support when it is asked what load it was
  putting on the portal, and the ticket opened after the 2026-09-14 block
  promises in writing that we back off when refused. That is what the gate's
  probe ladder honours, and what its 600 s ceiling bounds — do not raise it
  without remembering what it answers to.
- **`isCredentialFailure` IS STILL EXPORTED, AND IT IS NOW A READING OF
  `refusal.ts` RATHER THAN A SECOND LIST.** It takes a MESSAGE, because that is
  what survives into `sync_log`; `classifyRefusal` reads a live error's `code`
  field first and falls back to the same screen. Two copies of the portal's
  vocabulary in one repository is exactly the drift this file keeps warning
  about.

**THE WORKER WAS DYING SEVENTEEN TIMES A DAY, AND THE ROISTAT CHILD WAS THE
BALLOON.** Measured 2026-09-14 and fixed the same day. DigitalOcean sets
`NODE_OPTIONS=--max-old-space-size=768` on this worker; `spawn(..., {env:
process.env})` handed the Roistat child the same licence, so a 1 024 MB
container held two V8 isolates each entitled to 768 MB. Neither felt pressure,
neither collected defensively, neither raised a JavaScript OOM — the kernel got
there first, which is why no out-of-memory message was ever in any log and the
death showed up only as an unnamed `code === null`.

The evidence, none of it estimated: the worker's own RSS is flat at 262–297 MB
for a whole hour and the deletion sweep adds ~65 MB (304–327 MB on the two
tick-60 windows it survived), while DO's `memory_percentage` metric for
component `sync` caught the container at **999.0 MB of 1 024** in the tick-60
window; `sync_log` shows 15 gaps >100 s in 24 h, all 62–67 minutes apart and
**every one beginning the instant CALLS finished** — inside the sweep-plus-
Roistat block — twelve of them followed by a `DEPARTMENTS` boot (a fresh
process), three by a `CUSTOMERS` tick (the same one). Ruled out with the same
data: a socket idle-drop (cannot land on tick 60 fifteen times), a leak (RSS
flat), the sweep's id Set (65 MB, measured), the 200 MB `IdResolver` map
(`PAYMENTS` is in neither HOT nor REFERENCE, so it is never built).

`ROISTAT_HEAP_MB` = 320 on the child's own argv, with `NODE_OPTIONS` stripped
from its environment. A synchronous `spawn` throw is now caught too: it was the
one awaited call in the tick loop with no catch, so ENOMEM there rejected into
`main().catch` and exited the process — a second, quieter version of the same
death. And `close` names the signal, so `SIGKILL` says «xotira chegarasi»
instead of hiding as an interruption.

**How to check it stayed fixed, without container logs** (`doctl apps logs …
--type run` answers `websocket: close 1011`): count `DEPARTMENTS` rows in
`sync_log` for a day — that entity only runs at tick 0 and every 30 ticks, so
12–17 a day means the worker is still booting that often and 2 (the deploys)
means it is not. Container memory comes from the metrics API directly —
`monitoring/metrics/apps/memory_percentage?app_id=…`, filter
`metric.app_component == 'sync'`, ×10.24 for MB — because doctl does not wrap
it. And `SELECT max("importedAt") FROM marketing_snapshot` must keep advancing
hourly: if it stops, the child is hitting the new 320 MB cap and the log line
above will say so.

Worker cadence lives in `scripts/syncWorker.ts`: `SYNC_INTERVAL_SEC` 60,
reference data every 30 ticks, Roistat every 60, **the deletion sweep every 360
(six-hourly since 2026-09-15, was 60)**, and
`SYNC_HISTORY_BACKFILL_DAYS` 45 — the stage-history cursor is wound back once
at startup so the ordinary incremental pass repairs arrival rows lost before
the watermark learned to rewind (`historyBackfillCursor`; it never writes a
cursor where there is none, and never moves one forward). 76 000 of 222 000
rows, under a minute, once per start. Backoff is a
**floor**, not an addend — as an addend it disappeared exactly when it was
needed.

**THE SWEEP WENT SIX-HOURLY, AND A DELETED DEAL NOW SURVIVES UP TO SIX HOURS
HERE.** `listDealIds` walks all 464 396 deals at 2 500 a round trip = 180
requests, ninety seconds of continuous traffic at the 2 rps limiter. Hourly
that was 4 320 requests a day — **32% of the worker's entire HTTP volume** —
carrying 9 000 `crm.deal.list` invocations an hour against that method's
ten-minute operating basket, to detect an event the code's own comment calls
rare. Bitrix24's helpdesk names «an app that checks all CRM activities every
five minutes» as the kind of thing that earns an administrative block, and this
portal issued one on 2026-09-14 and again on 2026-09-15. 24 bursts a day became
4. Nothing about the walk, `sweepByAntiJoin` or the short-read guard changed, so
correctness is untouched — **read a six-hour-old test deal as `SYNC_SWEEP_EVERY`,
not as a sync fault**, and set it lower on the deployed app if the client ever
wants the old latency back.

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
- `docs/BITRIX24.md` says `assertMappingComplete()` guards startup. It was a
  no-op with no callers and was deleted on 2026-09-10 with the rest of the
  callerless code; the `sourceField` / `confirmed: true` fields its "steps to
  finish" tell you to edit do not exist either. It also references a
  `POST /api/v1/sync/run` route that was never built.
- `docs/API.md` still lists fifteen endpoints that no longer exist — every
  `/analytics/*` but `sellers`, `/dashboard/*`, `/deals*`, `/employees/[id]`,
  `/finance/overview`, `/insights/{channels,confirmations,flow,pulse,response}`.
  (`/insights/calls` is listed again since 2026-09-16 — a new endpoint at the
  old address.) `find src/app/api/v1 -name route.ts` is the authority;
  twenty-three on 2026-09-16.
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
