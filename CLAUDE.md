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

**The long reference lives in `docs/claude/`** — `screens.md`, `invariants.md`, `sync.md`, `data-scope.md`,
`history.md` (moved there whole on 2026-10-20: this file was 261 KB and every session paid for it on every
request). This file keeps the rules and points at them. When a change alters a screen, an invariant, the sync
or a scope rule, update its part in that file — never grow this one back.

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
  **Since 2026-10-19 the descent stops at a «(ROP)» team when it STARTED at
  one** (`"fromTeam"`): «Malika(ROP)» is the portal parent of Afruzaxon /
  Sadriddin / Asliddin(ROP), and Malika read 47 people instead of her 7. A
  non-team anchor (a branch, «Зехтра отдел продаж») still descends fully;
  the other twelve TEAM accounts measured unchanged. A member who HEADS a
  unit outside the scope is left out too («192 Charos», filed in
  «Malika(ROP)», heads «Зехтра отдел продаж»): Malika reads 264–269 only.
  **AND «Malika» IS HER PEOPLE ON EVERY SCREEN (2026-10-19, `ROSTER_TEAMS`
  in `domain/employees/roles.ts`, `InsightsRepository.teamSql`)**: a deal
  sold by someone filed in unit 94 (less a head of another unit) is «Malika»
  whatever «Организация сотрудника» says; a deal labelled «Charos(ROP)» /
  «Malika(ROP)» sold by anyone else goes to that seller's own unit. Every
  team reader goes through `teamSql` (the queue's `classified.rop`, which
  Logistika, /rnp, the sellers' teams and payroll read; `dealTeamSql`;
  Roistat; the cohort `?rop=`; /rnp calls). Portal, deals created 01–19.10:
  162 (305.5 mln) were split «Charos» / «Malika» and are one «Malika» now; 3
  (4.7 mln, Charos 192 ×2, Javohir 150) leave her.
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

#### Handing one out: «ROP» inside «+ Yangi hisob» on `/users` — in `docs/claude/data-scope.md`; read it before changing how an account gets a TEAM scope.

### Client data flow

Every `src/features/*/[A-Z]*Page.tsx` starts with `'use client'`. There is no
server-component fetching and no data handed over at hydration — pages are thin
shells, all data comes from `/api/v1` in the browser.

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

**THE RAIL AND HEADER ARE THE `(app)` LAYOUT'S (2026-10-20).** Every screen
lives under `src/app/(app)/` (the group adds nothing to the URL); its
`layout.tsx` draws `Shell` once and it stays mounted across navigations.
There is deliberately NO `loading.tsx`: once its outline is streamed, a page
guard's `redirect` cannot be a 307 any more (measured: 200 + meta refresh for
a stale session). The rail's links prefetch whole and mark a pending click
(`RailPending`); a ⌘K jump runs the header's sync line while it waits.
`PageShell` draws only the page and tells the shell `periodAware` /
`dataSource` through `components/layout/shellChrome.ts`. Never render `Shell`
from a page again — it would nest a second rail and bring back the
rebuild-on-every-click the client reported as «qotish»
(`tests/features/persistentShell.test.tsx`). **The shell hydrates BEFORE the
page** (the page sits in a Suspense boundary, the shell does not) and starts
`['filters']` and the session as it does: a page that renders shared data on
its first frame reads it through `useHydrated()` (`src/lib/useHydrated.ts`),
or it hydrates on data the server never had — React #418 on «Hisob», a
never-patched `disabled` on the filter pickers.

`src/app/providers.tsx` sets the cadence **globally**: `refetchInterval: 120_000`
with `staleTime: 115_000`, matched to the sync worker's 120 s production tick
(`SYNC_INTERVAL_SEC`; it was 60 s / 55 s until 2026-10-05).
Per-page `refetchInterval` overrides were deliberately removed. Three
exceptions, each with a reason in place: `/meta/alerts` (one request a minute
for the whole app, keyed constantly), `/meta/filters` (5 min — reference data
changes on sync), and two that never poll (`refetchInterval: false`, 2026-10-24):
the ⌘K search and the «ROP» heads list in «+ Yangi hisob».

**THE REFRESH BUTTON REPORTS, AND A DEPLOY NOW REACHES AN OPEN TAB.** Both
added 2026-09-14, after the client reported «yangilash ishlamayapti» four times
over an afternoon in which the button was measurably working. Two different
absences produced that.
*A press that lands on unchanged numbers looks like a press that did nothing* —
and for four hours that afternoon the numbers could not change at all, because
Bitrix24 was refusing every REST call. So the button now prints
«Yangilandi 16:12» beside itself for six seconds, or «Bitrix24 band — yangi
maʼlumot yoʻq» when the sync is blocked («Bitrix24 bilan aloqa yoʻq — …» for a
lost connection since 2026-10-20, matching the chip) (`aria-live`, so it is announced as
well as drawn). The state is the timestamp rather than a flag: the message has
to name the moment or it reads as a status that was always true.
*And a single-page app does not notice a deploy* — five landed under that same
open tab. `scripts/writeBuildId.mjs` stamps `public/build-id.json` before every
`next build`; `useNewBuildAvailable` reads it on mount (that is what THIS tab is
running), then every minute while the tab is visible and once each time it is
shown again (that is what the server is serving now — since 2026-10-24 a hidden
tab does not poll); a difference offers «Yangi versiya · yangilash» and the
polling stops. A BUTTON, never an automatic
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

**WHAT A READER SEES WHILE FIGURES ARE REPLACED — 2026-10-14** (the client:
«yangilanayotganda … bilishimiz kerakki yangilanayapti, yangi maʼlumot
chiqdi»; asked whether to blur on every refresh). Three signals, one per
moment, all in LIVE DATA at the end of `globals.css`: a 3px `.sync-line`
under the header while a PAGE query is in flight (`isPageQuery` in
`components/layout/liveData.ts` leaves out `meta`, `filters`, `search` and the
rail's lead-watch badge; shown after 250 ms); a «Yangi maʼlumot keldi · HH:MM»
pill (`useFreshDataAt`) when a re-ask of the SAME key came back with a
different `data` — structural sharing keeps `data` by reference when equal,
`meta.generatedAt` always moves — never on a first answer, a new filter or a
`manual` write; and `.data-stale` (dim + 1.5px blur) on PageShell's BODY only
while `stale`, so the filter row being used stays sharp. **A background poll
never blurs or dims anything** — every two minutes on a wall screen would make
it unreadable. On a phone the pill rises from the bottom (it covered the
title). Checked on a local build at 375 / 768 / 1440 with a delayed, altered
API answer.

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

## The screens, and what each one dates by — in `docs/claude/screens.md`

Moved there whole on 2026-10-20 (it was 155 KB of this file): the removed screens, then the table page → URL → feature → endpoint(s) → service → repository → **which date the window filters on**, then one part per screen. Read the screen's table row and its part before changing a screen, its endpoint or any query behind it — the window basis differs per screen, and the wrong one gives plausible, wrong numbers.

Screens: Savdo dinamikasi `/analytics/sales` · Mijoz qaytishi `/analytics/cohort` · Qoʻngʻiroqlar `/customers` · Reklama samarasi `/marketing` · Lidlar `/leads` · AI registrator `/leads/ai-registrator` · RNP jadvali `/rnp` · Target tahlili `/target` · Roistat `/roistat` · Yalpi marja `/margin` · Logistika `/logistics` · Sverka `/sverka` · Tasdiqlash navbati `/confirmation` · Sotuvchilar oyligi `/payroll` · Sotuvchilar reytingi `/sellers` · KPI rejalari `/kpi` · Struktura `/structure`.

## The 2026-09-10 cull — in `docs/claude/history.md` (what was deleted for having no client caller, and how to tell).

## Invariants that break things quietly — full text in `docs/claude/invariants.md`

Each rule is explained there with its numbers and the incident behind it, and the org chart's rules follow. Read the matching part before touching money, periods, pipelines, scope, the confirmation queue, the header bell or the org chart.

- **`countsAsRevenue` — name it in every query that touches money.**
- **Money is BigInt minor units, end to end.**
- **Every window comes from `period.ts`.**
- **Cache and comparison keys must include the PRESET.**
- **A deal has four date bases and they may not be substituted.**
- **Delivered revenue is not a seller's close.**
- **A rate with no denominator is `null`, not `0`.**
- **The head is not one of their own subordinates.**
- **A head the portal does not list IN the unit gets no head row.**
- **The subtree pill counts PEOPLE, not memberships.**
- **Scope narrows, never widens.**
- **Branch (`filial`) scoping was removed on 2026-09-30.**
- **Confirmation queue: cohorted by arrival in `C4:NEW`, not by Дата создания.**
- **«🔁 ҚАЙТА ТУШДИ» counts GAPS, not entries, and the gap is six hours.**
- **THE TASDIQLASH BOARD FILES AN ORDER UNDER EVERY DAY IT ARRIVED ON — 2026-10-09.**
- **The LAST arrival dates the row, so the row has to carry the earlier ones.**
- **The header bell counts the BACKLOG, so its link must carry `queue=backlog`.**
- **The floor is `min-h-[746px]` on the Card and the number is load-bearing**
- **Nothing is printed between the title and the controls, in any mode.**
- **Its РОП / status / Статистика controls are `toolbar`, not `actions`.**
- **The org chart** — its rules are the last part of that file.

## The sync pipeline — full text in `docs/claude/sync.md`

`CrmProvider` (portal vocabulary) → handlers (`DEALS`, `STAGE_HISTORY`, …) →
`SyncEngine` (cursors, status, sweeps) → `PrismaSyncStore`. Bitrix24 field names
(`UF_CRM_*`, `CATEGORY_ID`, `crm.deal.list`) stay inside
`src/server/integrations/crm/bitrix24/` — a strong convention, not a lint rule.


Read that file before touching sync handlers, Bitrix24 calls, the sweep or the portal budget (the portal blocked us for OVERLOAD_LIMIT; the cure, the guard and how to check they held are all there). Its rules:
- **`batchWalk` uses id-chained seeks, never offsets.**
- **`encodeParams` percent-encodes filter KEYS, not just values.**
- **`skipped` must not block the watermark; `failed` must.**
- **The upsert may not rewrite a row's primary key.**
- **Only a FULL run may delete**
- **The production sweep bypasses the SyncEngine on purpose**
- **`sync_log` keeps 30 days**
- **The sweep's temp table lives inside one interactive transaction.**
- **`IdResolver.mapFor()`, not `map()`, on the hot path.**
- **Empty string is the foreign-key trap.**
- **One worker only**
- **`DEAL_ITEMS` reads in-memory state left by the `DEALS` pass**
- **The four refusals are one vocabulary, in `bitrix24/refusal.ts`.**
- **The worker starts already knowing.**
- **`npm run bitrix:meter` asks the portal once and prints all of it**
- **Intensity**
- **Execution time of one request**
- **Operating time**
- **`OVERLOAD_LIMIT` is undocumented**
- **How to check it stayed fixed, without container logs**
- **Server cannot reach the portal** — «aloqa yoʻq» on the chip, `UND_ERR_CONNECT_TIMEOUT` in the log; fronts that drop us are skipped, one request per connection and every batch sized to `RESPONSE_BUDGET_BYTES` (the route freezes a connection after ~20 KB), probed every tick; since 2026-10-20 the portal filters DigitalOcean itself — `BITRIX24_PROXY_URL` sends the calls through a relay outside it; the 5-step diagnosis is there

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

**`slow request` AND `slow page guard` IN THE WEB LOG (2026-10-14).** Any API
request or page-guard lookup taking a second or more leaves one warn line:
path (cut to 160), the shape-only query keys, status, `ms`, `authMs` (the
caller lookup) and the pool's `{ total, idle, waiting }` read when the request
arrived (`poolAtStart`) and when it ended (`pool`) —
`src/server/http/slowRequest.ts`; `/api/health` writes `slow health check`
the same way. `poolAtStart.waiting > 0` is a request that arrived at a full
pool; nothing in the line proves a slow query on its own (a screen can queue
for connections after the caller is resolved too). A `slow page guard` with
`resolved: false` is a signed-in reader the guard may have sent to /login:
`optionalPrincipal` answers null on any failure. Read them with
`doctl apps logs <app-id> web --type run | grep 'slow '`.

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
