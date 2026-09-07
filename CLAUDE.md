# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

**SinoLife Sales Intelligence** — a Next.js App Router dashboard over the
`obey.bitrix24.kz` CRM plus a Roistat marketing ledger. UI language is Uzbek,
currency UZS, every reporting window computed in `Asia/Tashkent`. ~420 000
deals across nine pipelines.

**This file describes `origin/main`** — what is deployed and what a fresh clone
gets. Where the local checkout differs, it says so.

**Read the comment above the code before changing it.** This codebase records
*why* a decision was made, and a large share of those comments name a specific
production failure that forced it. Several took more than one attempt to get
right. Re-deriving what a comment already settles is the expensive mistake here.

**But a comment can outlive the code it explains.** Several are stale right now
and each one, followed, reintroduces something a test forbids — they are listed
under *Comments that lie*. When a comment and a test disagree, the test is the
code's real intent; fix the comment in the same change.

---

## This checkout is not `main` — check before you commit

Measured 2026-09-04. **`git rev-list --left-right --count origin/main...HEAD`
returns `20 0`: this working copy is twenty commits BEHIND `origin/main` and
ahead by none.** It is also a *shared* checkout — several Claude sessions edit
it at once, so never `git stash` here.

That combination is the dangerous part. The tree carries real uncommitted work,
but three of its files are **older** than main rather than divergent:

```
src/features/sellers/SellersPage.tsx            679 lines apart
src/server/repositories/insightsRepository.ts   204
tests/http/confirmationSellerRatingSql.test.ts   65
```

`git diff origin/main` on those three is 290 insertions against 658 deletions —
main holds more, because the sellers-board fixes of 2026-09-04 shipped from
elsewhere. **A "commit everything as-is" from this tree, or a careless conflict
resolution, reverts shipped work straight to production**, and
`deploy_on_push: true` means it goes live on the push. Re-derive the hunks you
want in a clean worktree off `origin/main`; do not commit this checkout wholesale.

### What is genuinely unshipped here

Everything in this list exists only in the working tree. The rest of this file
notes each one again where it is relevant.

| Work | Files |
|---|---|
| **Telephony removal** | deletes `responseRepository`/`responseService`, `/insights/calls`, `/insights/response`, the `CALLS` handler, `fetchCalls`; untracked migration `20260903131756_drop_call_records` |
| **Confirmation global search + «Jami»** | third queue mode `all`, `q` → all-time in the route, `PeriodFilter` `extra`/`muted`; `InsightsRepository.confirmationSearchScope` and untracked migration `20260906090000_confirmation_search_indexes`; the ROP / status / Статистика controls move out of the page header into `PageShell`'s new `toolbar`; tests `confirmationGlobalSearch`, `confirmationAllOrders`, `confirmationSearchScope` |
| **⌘K global search removed** | deletes `/api/v1/search`, `searchService`, `searchRepository`, `CommandPalette.tsx`, `tests/http/search.test.ts`, the container bindings, the `lib/api.ts` DTO mirror, the `palette` block in `messages.ts`, the header chip in `Shell.tsx`; the `commandCentreCacheKey` coverage that lived only in that test file is rescued into new `tests/services/commandCentreCacheKey.test.ts` |
| **Sellers name filter removed** | `SellersPage.tsx` only — the box is gone, the podium-as-door behaviour stays |
| **Nav-shell refactor** | `src/app/layout.tsx`, new `AppFrame.tsx`, new `loading.tsx`, `Shell`/`PageShell`/`Marketing`/`Account`; test `shellPeriodScreens` |
| **Dead-export sweep** | 7 exports across `sections`, `pageGuard`, `env`, `money`, `marketingFormat`, `performance`, plus `APP_DEFAULT_LOCALE` |
| **Shared-answer caching + render fixes** | new `src/server/services/ttlCache.ts` and `tests/services/`, `MarketingHeroTrend.tsx`, the `RefreshButton` leaf, route pathname in `handler.ts` logs |
| **Kadrlar tuzilmasi as the portal's own org chart** | new `orgLayout.ts`, `OrgCard`, `OrgChart`, `DepartmentPanel`, `StructureTable`; rewritten `StructurePage`; `view`/`dep` URL keys; `.org-*` in `globals.css`; new route `/insights/structure/roster`; tests `orgLayout`, `structureOrgChart`, `structureViewState`, `structureSql` |
| **Multi-department membership** | new `DepartmentMember` model + untracked migration `20260905090000_department_member`, `RawEmployee.departmentExternalIds`, the whole `UF_DEPARTMENT` array in `Bitrix24CrmProvider`, membership writes in `handlers.ts`, a real tree with heads in the demo catalogue |

`20260904113000_deal_operator_snapshot` is untracked here but **is already on
`main`** — the local copy is redundant. `20260903131756_drop_call_records`,
`20260905090000_department_member` and
`20260906090000_confirmation_search_indexes` are the three that are genuinely
new, and `prisma/schema.prisma` is *tracked*: `git commit -am` would ship the
first two schema changes without either migration, and the PRE_DEPLOY
`prisma migrate deploy` reports success having applied nothing.

The three are not equally safe to land. `drop_call_records` is **irreversible**
and takes 310 000 rows with it. `department_member` is additive, carries its
own backfill from `employee."departmentId"`, and changes no existing number —
nothing but the org chart reads it. `confirmation_search_indexes` touches no
model at all: it is five raw-SQL indexes, so forgetting it does not break a
build or an import, it just leaves every arm of `confirmationSearchScope`
without an index to start on and the confirmation search back at the shape it
was written to escape. Its own header carries the deploy note — Prisma runs
each migration inside a transaction, so `CREATE INDEX CONCURRENTLY` raises
25001 there and the file uses plain `CREATE INDEX … IF NOT EXISTS`; the safe
order on production is to build the five by hand with `CONCURRENTLY` before
the push, which turns the file into a no-op there and leaves it a real create
on a fresh clone.

### Two stray directories live inside the repo

`.podium-preview/` (a 1.5 GB peer worktree) and `dotfiles/` (a 272 MB OS-config
clone with its own nested `.git`) both sit in the repo root. Neither is project
code and both are now ignored twice over — `eslint.config.mjs` `globalIgnores`
and `.gitignore` — so `npm run verify` passes unscoped and `git add -A` no
longer sweeps them in.

That was not free, and the reason is worth keeping: **`globalIgnores` patterns
containing a `/` anchor to the repo root**, so `.next/**` never matched
`.podium-preview/.next/…` and bare `eslint .` walked 820 files of minified
chunks — 26 000 problems, 1 300 of them errors, one third of the gate reporting
noise nobody wrote. A future stray build tree does the same thing. The
`dotfiles/**` ignore is marked delete-when-gone; the directory itself is still
there, awaiting a decision.

A 62 MB `.deb` was swept in by `git add -A` once and had to be untracked
(commit c06652e). Stage by path anyway.

---

## Commands

```bash
npm run verify        # typecheck + lint + test — one third of the gate
npm run build         # prisma generate + next build
npm run db:check      # 11 data-integrity invariants (needs a database)
```

`docs/DEVELOPMENT.md` defines the gate as **all three**, and nothing runs them
for you — there is no CI, no git hook (no `.github/`, no `.husky/`, no
`core.hooksPath`, only `*.sample` in `.git/hooks`), and `.do/app.yaml` has
`deploy_on_push: true` on the `web` service and the `sync` worker. A push to
`main` builds, runs `prisma migrate deploy` against the production database, and
goes live with whatever the tree contained.

```bash
npx vitest run tests/domain/money.test.ts             # one file
npx vitest run tests/domain/money.test.ts -t "rounds" # one test by name
```

**Run vitest from the repo root only.** `vitest.config.mts` uses
`process.cwd()` for both the `tests/**` include glob and the `@` alias, so from
a subdirectory you get "No test files found". The default environment is
**node**, and component tests opt into jsdom per file with a
`@vitest-environment jsdom` docblock — a new `.tsx` test that forgets it fails
with `document is not defined`, which names nothing. `globals: true`, so tests
do not import `describe`/`it`/`expect`. No test touches a database.

**Do not pin a test count anywhere.** `docs/DEVELOPMENT.md` says 628; the tree
moved from 772 to 780 in the hour this file was written. That is what a pinned
count looks like a month later.

```bash
npm run bitrix:worker                  # the production sync loop, one tick a minute
npm run bitrix:import                  # one incremental pass by hand
npm run bitrix:import -- --full --reset
npm run bitrix:resync -- STAGES DEALS  # one entity, after a mapping fix
npm run roistat:import                 # the second, unrelated source — by hand
npm run roistat:verify                 # read-only reconciliation against Bitrix
npm run branch:verify                  # proof script for filial scoping
npm run db:seed:users -- --reset-password
```

**`npm run bitrix:resync -- DEAL_ITEMS` reports SUCCESS and does nothing.**
`resyncEntity.ts` validates the name against `SYNC_ENTITIES`; `SyncEngine.runEntity`
finds no handler (or a provider capability of `false`) and falls through to
`unsupported()`, which returns `status: 'SUCCESS'` with every counter at zero.
The same holds for `PRODUCT_CATEGORIES` and `PAYMENTS` — and, once the telephony
removal lands, for `CALLS`. A green run and an empty table look identical.

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

### The boundaries are ESLint rules — but check what is actually enforced

`eslint.config.mjs` — its header says why: *"A single `import { prisma }` inside
a React component would put database access in the browser bundle, and a single
`import { env }` would put the Bitrix24 webhook token there with it."*

| Scope | May not import | Actually enforced? |
|---|---|---|
| `src/server/domain/**` | Prisma, `next`, `react`, `@/server/config/*`, `@/server/repositories/*`, `@/server/integrations/*` | yes |
| `src/components/**`, `src/features/**`, `src/lib/**` | `@/server/*`, Prisma | yes |
| `src/app/api/**` | `@prisma/client`, `**/generated/prisma/client*` | **only those specifiers** |
| everywhere but `src/server/config/{env,providerFactory}.ts` | `env.DATA_SOURCE` (an AST selector) | **member access only** |

Three overstatements worth knowing, all latent holes rather than live bugs:

- The API-layer ban catches the package specifier, **not** the app's own
  singleton. `import { prisma } from '@/server/db/prisma'` inside a route lints
  clean — `src/app/api/health/route.ts` does exactly that and runs
  `prisma.$queryRaw` in the handler. Going through repositories so scoping
  cannot be bypassed is a convention here, not a rule.
- **`src/app/**` is covered by no client-side restriction at all.** The
  exemption is necessary — server pages must import `requireSection` from
  `@/server/auth/pageGuard` — but four `'use client'` files live there
  (`global-error.tsx`, `login/page.tsx`, `login/ChallengeForm.tsx`,
  `providers.tsx`) and nothing would stop them importing `@/server/*`.
- The `DATA_SOURCE` selector matches `MemberExpression[object.name='env']` and
  nothing else, so `const { DATA_SOURCE } = env` walks straight past it. Two
  files are exempt, not one.

`tests/**` is exempt on purpose — so a test that crosses a boundary will not
catch the violation.

`src/lib` sits on the **client** side, yet server modules import from it
(`sections`, `api`, `passwordPolicy` are the shared vocabulary). The sharing is
one-directional, and the repo pays for it by hand-mirroring unions:
`src/lib/roles.ts` `ROLE_VALUES`, `src/lib/dataScope.ts` `DATA_SCOPE_VALUES` and
`CONFIRMATION_OUTCOMES` in `src/lib/api.ts` restate types from
`@/server/domain/types`. **Nothing checks the mirror** — edit both sides. The
failure it produces: a value added on the server and forgotten on the client is
a 400 on the whole page the first time somebody clicks the control that sends
it. `src/lib/api.ts` also hand-mirrors whole DTO blocks (insightsService,
pulseService, concentrationService, `ConfirmationVisitDto`,
`ConfirmationOrderDto`) — unchecked too.

*Unshipped:* the global-search work adds a fourth mirror,
`CONFIRMATION_QUEUE_MODES`, and it is the first one with a parity assertion
(`tests/features/confirmationAllOrders.test.tsx`).

**The same class of mirror runs across the TypeScript/SQL line.**
`src/server/domain/employees/roles.ts` decides what a sales team is
(`SALES_TEAM_SUFFIX` = `(ROP)`), and the SQL `LIKE` pattern is *derived* from
that one constant rather than retyped. `tests/domain/employeeRoles.test.ts` pins
the derivation, pins that the suffix contains no `%`, `_` or `\` (a wildcard
inside it would make SQL match names the TypeScript classifier rejects), and
carries the authoritative roster: **fifteen (ROP) teams** — Lola, Azizbek,
Sevinch, Baza, Asliddin, Gulzora, Saidaziz, Maftuna, NEW, Saida, Hayot,
Sevinchxon, Charos, Kompaniya, Marjona — against the non-sales departments
NEWGEN, Регистрация, Операцион, Навоий, Тошкент онлайн.

### Read these first, in order

1. `docs/ARCHITECTURE.md` — the layer contract (but see *Doc rot* below)
2. `eslint.config.mjs` — where that contract is actually enforced
3. `src/server/http/handler.ts` — `getHandler(access, schema, handle)`
4. `src/app/api/v1/dashboard/overview/route.ts` — the canonical route, 23 lines
5. `src/server/domain/period/period.ts` — every date boundary in the product
6. `src/server/integrations/crm/bitrix24/mapping.ts` — the portal's vocabulary
7. `prisma/schema.prisma` — the DESIGN CONTRACT block at the top (accurate in
   all four clauses; the stale prose in that file is 830 lines further down)

### Authorisation

`getHandler(access, …)` takes `access = { permission, section }`. **Both are
required fields**; `section: null` must be written out, so adding an endpoint is
always a decision about who reaches it. Two drill-down routes
(`deals/[id]`, `employees/[id]`) hand-roll `requirePermission` + `assertSection`
because they authorise per-resource.

`tests/http/routeAccess.test.ts` is the only thing guarding that path, and it
guards less than it looks:

- It walks the filesystem under **`src/app/api/v1` only**. A route added
  anywhere else under `src/app/api/` is never checked — `health` and
  `auth/[...all]` already live there.
- Its anti-vacuity floor is `routes.length > 20` against the **33** route files
  this tree holds under `src/app/api/v1`.
- Section detection is the regex `/section:\s*(null|'[a-z]+'|\[)/`. All eleven
  section ids happen to be pure lowercase letters; add `deal-flow` or `sales2`
  and every route naming it fails "states a section" while being perfectly
  guarded.
- It pins the ungated list exactly — `['meta/alerts', 'meta/filters', 'users',
  'users/[id]']` — so **adding an endpoint with `section: null` fails that test
  until you extend the array.** Deleting one is free, because the walk is by
  filesystem. *Unshipped:* `'search'` was the fifth entry until the ⌘K palette
  was deleted, and it went out of the array with the route — which is exactly
  the free direction.

An array in `access.permission` means **any-of**: `ANALYTICS_READ` is
`['analytics:read:all', 'analytics:read:own']`, because requiring both would
lock salespeople out of their own numbers and collapsing them into one would
lose the distinction `dealScopeFor` keys off.

**Every authenticated request re-reads the live user row.** better-auth caches
`role` and `isActive` into the session, so trusting the cookie let a revoked or
deleted account keep working until it expired — sign-in returned 401 while the
old tab carried on. A missing row is a 401, never a fallback.

**`mutationHandler` refuses a write with no `Origin`, before resolving the
principal.** This API is cookie-authenticated, so a browser attaches the session
cookie to a cross-site form post as readily as to our own fetch. Absence is
refused rather than waved through: every browser sends one on a cross-origin
write, so a missing header is either a non-browser client (which should use a
token) or an attempt to skip the check. Only the three `users` write handlers
take this path — that is the entire mutation surface of the API.

**The two hand-rolled routes return 404, not 403, for a resource the caller may
not see.** A 403 confirms the record exists, which tells a salesperson exactly
which employee ids are real. `deals/[id]` gets it free by passing
`dealScopeFor(principal)` into the WHERE clause; `employees/[id]` does it
explicitly via `canViewEmployee`. "Fixing" these to a correct-looking 403
reintroduces an enumeration oracle.

Route handlers spread scope **last**:

```ts
{ ...ctx.query, ...ctx.scope }
```

That ordering is the mechanism — a `SALES` caller passing someone else's
`employeeIds` still gets their own restriction ANDed on top. It is **not
universal**: 11 of 33 routes spread scope. The company-wide screens
(confirmation, logistics, margin, warehouse, cohort, command centre, sellers)
never do, because they refuse an OWN account at the permission gate instead —
there is no honest answer to give one, since the company's figures would leak
and a blank page would lie.

`src/middleware.ts` is *not* the boundary: it only checks that a session cookie
is present so a signed-out visitor is redirected instead of watching a shell
flash.

**There is a third scoping mechanism.** `DealRepository.findForAnalysis`
coalesces identical concurrent reads into one query — the sales screen opens
five endpoints at once and three need the same fetch — and **the map's key is
what stands between a SALES-scoped caller and the whole company's rows.**
`tests/db/dealAnalysisCoalescing.test.ts` pins the dangerous cases: a different
authorisation scope must never share, a different window must never share, and
the entry must be gone once the promise settles (this is coalescing, not a
cache). Add a parameter to `findForAnalysis` without adding it to the key and
one caller is served another caller's scope.

*Unshipped, and the same rule generalised:* `src/server/services/ttlCache.ts`
lifts the command centre's hand-rolled memo into a module — "not a cache in
front of the database, a memo in front of ONE ANSWER, keyed by the whole
question". The distinction is the safety property, stated in its own header:
**a key that omits an argument does not serve a slightly stale answer, it
serves the WRONG one.** It exists because that screen is where every login
lands, so its readers arrive together and six of them inside a minute put
ninety-six queries into a queue eight connections wide — the tail waited past
the connect timeout and the page 500'd. Anything keyed this way joins
`commandCentreCacheKey`, `boardSummaryKey` and the coalescing map in the same
rule: the key must carry every argument that could change the answer.

**The ⌘K search and the header bell are section-gated, and an omitted group is
omitted entirely** — never rendered as "0 matches". The reason is in
`tests/http/search.test.ts`: *saying "3 you may not see" still says the customer
exists, which is the thing being withheld.* An account holding only `logistics`
gets `groups: []` for a term that matches five groups; one holding only
`confirmation` gets exactly `['deals', 'customers']`. An OWN-scoped account is
passed its own employeeId down into the SQL. The bell is gated the same way — an
account without the confirmation section gets no bell, not a count of something
it may not open.

### Client data flow

Every `src/features/*/[A-Z]*Page.tsx` starts with `'use client'`. There is no
server-component fetching, no prefetch/hydration boundary — pages are thin
shells, all data comes from `/api/v1` in the browser.

On `main`, `Shell` is rendered **by each page**, through `PageShell` (and
directly on Marketing and Account). It therefore unmounts and remounts on every
navigation, which is why `/meta/alerts`'s `staleTime` is set **equal to** its
interval rather than half of it: a fresh observer refetches anything older than
its staleTime, and at 30 s that meant a full `/meta/alerts` on nearly every page
change — the all-time backlog cohort over the whole stage history, ~4 s on
production.

*Unshipped, and it changes the above:* the nav-shell refactor mounts `Shell`
**once** in `src/app/layout.tsx` via a new client `AppFrame` (bare children for
`/login`), inside `<Suspense fallback={null}>` — the boundary is for the build,
not the eye: `Shell` reads `useSearchParams`, and the statically prerendered
not-found page cannot answer that on the server, so without it `next build`
fails. `Shell` loses its `dataSource`/`periodAware` props and recognises the
screen from the address instead, via an exported `SCREENS_WITHOUT_A_PERIOD`
(`['/users', '/account', '/marketing']` — the three screens with no reporting
window of their own, where a preset wrote a window nothing on the page reads,
pinned it into the address and the sidebar link, and left no control to clear
it). A new `src/app/loading.tsx` is the app's only loading boundary and exists
for prefetch: Next fetches a dynamic route only as far as its loading boundary,
so with none it fetched nothing and a click blocked on the server render —
320–725 ms of an unresponsive page, measured on production.

A shell that persists has a new failure mode the per-page one did not:
**`useIsFetching` re-renders its subscriber on every query start AND stop**, so
reading it at the top of a permanent `Shell` re-renders the whole chrome once a
minute per query. It now lives in a `RefreshButton` leaf, which is the general
rule for any global-activity hook once the shell outlives the page.

`src/app/providers.tsx` sets the cadence **globally**: `refetchInterval: 60_000`
with `staleTime: 55_000`, matched to the sync worker's one-minute tick. That is
the default because most screens read Bitrix24 data that genuinely can move on
every tick.

A per-page override is legitimate exactly where the data **provably cannot move
that fast**, and each one must set **both fields**: `refetchInterval` runs on its
own clock and never consults staleness, so raising only `staleTime` changes
nothing about how often the request goes out. The overrides in place:

| Query | Cadence | Why |
|---|---|---|
| `/meta/alerts` (`Shell`) | 60 s | one request a minute for the whole app — the key is constant, so every screen gets the same cached answer |
| `/meta/filters` (`PageShell`) | 5 min | reference data changes on sync |
| Mijoz qaytishi | 5 min | two of the heaviest queries in the app — `first_win` groups every won revenue deal by customer with **no date bound**, `retentionStages` counts distinct customers over the entire Baza pipeline — ran sixty times an hour per open tab to redraw a matrix whose cell moves once a day |
| Reklama samarasi | 10 min *(unshipped)* | not Bitrix24 data at all. Roistat is imported on the hour, so 59 of every 60 polls re-fetched a table that provably did not move — and each round is three requests, `/marketing/verify` alone running seven passes over `deal` on a one-core database shared with the sync worker: ~420 deal scans an hour for one open tab |
| ⌘K search | own | typing cadence, not a clock |

*Unshipped:* `/meta/alerts` is also **memoised server-side for 60 s**
(`ttlCache`), and its header names two things that must never enter that cache:
the freshness stamp (it would make the chip lie about its own staleness by up to
a minute) and a **rejection** — caching a timeout turns one bad minute into
sixty seconds of them, which is the opposite of the point.

**The reporting window is persisted per browser**, in localStorage under
`sinolife.period.v2` — ONE window for the whole dashboard, not one per route. It
used to be per route, on the reasoning that the confirmation queue is read for
today and the sales chart for the month; but a reader moves between screens
asking the same question of each, and two screens became impossible to compare.
**The URL always wins** — a link pasted into Telegram must open on the dates it
was copied on, so storage only supplies a window when the address bar carries
none, and every sidebar link carries it as a query string via `periodQuery()`.
Changing the key silently forgets every reader's window (`v2` is already the
second key). Every read and write is wrapped in try/catch: a private window or
blocked site data must cost a date, not a render.

**A JS-driven animation cannot be reached by `prefers-reduced-motion` in CSS.**
`src/lib/useReducedMotion.ts` exists so the preference is asked one way
everywhere — Recharts draw-in, rAF tweens, `AnimatedNumber` — instead of each
chart wiring its own `matchMedia`. It uses `useSyncExternalStore`, server
snapshot `false`, so a live OS change re-renders immediately rather than at the
next mount.

---

## The screens

Thirteen pages, eleven of them sections. Every page is a thin shell under
`src/app/`, the UI lives in `src/features/<dir>/<Name>Page.tsx`, and each
sectioned page calls `requireSection('<id>')` — a courtesy redirect, not the
boundary; the real gate is the route's `ACCESS`. All of them inherit
`/meta/filters`, `/meta/alerts` and the ⌘K `/search` from the shell.

**The last column is the one to check before writing a query.** A screen's
reporting window does not mean the same thing on every screen, and picking the
wrong basis is the mistake that produces plausible, wrong numbers.

| Screen (label in `sections.ts`) | id | URL | Endpoint(s) | Window filters on |
|---|---|---|---|---|
| Boshqaruv markazi | `overview` | `/` | `/dashboard/command` | **mixed, 3 clocks** — `createdAtSource` (intake, funnel, logistics), `closedAt` (delivered revenue, products, headcount), `queued_at` (confirmation + rejection band) |
| Savdo dinamikasi | `sales` | `/analytics/sales` | `/analytics/sales`, `/analytics/sources`, `/analytics/products`, `/insights/pulse`, `/insights/flow` | **mixed** — a permissive pre-filter admits anything touching the window, then each measure picks its own basis. `/insights/pulse` is a `closedAt` cohort; `/insights/flow` is a `createdAtSource` one |
| Mijoz qaytishi | `cohort` | `/analytics/cohort` | `/insights/cohorts`, `/insights/concentration` | `closedAt`, on revenue-bearing WON deals only |
| Reklama samarasi | `marketing` | `/marketing` | `/marketing/overview`, `/marketing/breakdown`, `/marketing/verify` | `marketing_daily."date"` — the Roistat sheet's own lead date. **Not Bitrix24 data at all** |
| Yalpi marja | `margin` | `/margin` | `/insights/margin` | `closedAt`, WON + `countsAsRevenue` |
| Logistika natijasi | `logistics` | `/logistics` | `/insights/logistics` | `createdAtSource`, uniformly, in **two** statements |
| Tasdiqlash navbati | `confirmation` | `/confirmation` | `/insights/confirmations/orders` | **the arrival in `C4:NEW`**; `?queue=backlog` (where the bell lands) drops the window entirely |
| Joʻnatish nuqtalari | `warehouse` | `/warehouse` | `/insights/dispatch` | `createdAtSource` — a creation cohort graded by the deal's **current** stage |
| KPI rejalari | `kpi` | `/kpi` | `/kpi` | **the plan's own `periodStart`/`periodEnd`** — the dashboard window only *selects* which plan is live |
| Kadrlar tuzilmasi | `structure` | `/structure` | `/insights/structure`, `/insights/structure/roster` | **mixed** — money columns and `workingHeadcount` on `closedAt`; every headcount undated |
| Sotuvchilar reytingi | `sellers` | `/sellers` | `/analytics/sellers` | **the arrival in `C4:NEW`** (`queued_at`) — the confirmation queue's own cohort. **Not `createdAtSource`** |
| *(no section)* | — | `/users` | `/users`, `/users/[id]` | undated. `{ permission: 'users:manage', section: null }` — "not a section, account administration is a permission". The only place `mutationHandler` is used |
| *(no section)* | — | `/account` | better-auth routes | undated. Password + TOTP; needs only a session |

`/` is the one sectioned page with **no** `requireSection`: it calls
`firstSectionFor()` and forwards, because it is where every login and every
bookmark lands, and a guard there would bounce the user off their own home page.
Its section id is enforced at the API instead (`dashboard/command/route.ts`).

**Ten of the 33 live v1 routes have no client caller** — `/analytics/employees`,
`/analytics/funnel`, `/analytics/leaderboard`, `/dashboard/overview`, `/deals`,
`/deals/[id]`, `/employees/[id]`, `/finance/overview`, `/insights/channels`,
`/insights/confirmations`. Note the last: `/insights/confirmations` is **not**
what the confirmation screen calls. That screen makes exactly one request, to
`/insights/confirmations/orders`.

Per-screen traps worth knowing before you touch one:

- **Boshqaruv markazi** — the 45-second in-process cache key carries the
  *preset*, not just the window. Dropping it served «Shu hafta» the numbers for
  «Bugun» (78 where 103 was right, and the reverse).
- **Savdo dinamikasi** — the only endpoint whose money does not pass through
  `toMoneyDto`. `summarizeDeals` returns domain `Money` and the route spreads it
  straight into the payload, so every money field arrives as a bare decimal
  string with no lossy `amount` companion; `SalesPage` types them `RawMoney`
  deliberately. `formatCompactUzs(x.amount)` on one prints a literal `NaN` — the
  exact failure `/analytics/employees` hit across all 288 rows before it was
  given a `summaryDto`.
- **Mijoz qaytishi** — «Faol bazada» is a separate DISTINCT-customer total, not
  the sum of the ladder bars.
- **Reklama samarasi** — the dashboard-wide `preset` and `filial` do **not**
  reach this screen; it resolves its own window from `from`/`to`/`today` and
  defaults to `{ choice: 'all' }`, no bound at all.
- **Yalpi marja** — discounts are split by sign in SQL; never net them or re-sum
  them client-side.
- **Logistika natijasi** — `refused` vs `cancelledEarly` is decided by whether
  the deal ever has a dispatch-role stage-history row, not by its current stage.
  The two cuts (routes and regions) are **one statement**, not two: they used to
  differ by one projected column and each rebuilt three unbounded history CTEs,
  measured at 2 212 ms and 1 361 ms side by side for a single card.
  `refusalReasons` is the second statement and is skippable
  (`options.withReasons === false`).
- **Joʻnatish nuqtalari** — delivery rate's denominator is *resolved* orders;
  in-flight is excluded and reported separately.
- **KPI rejalari** — the preset picks the plan but does not slice it. «Bugun»
  and «Shu oy» give identical numbers inside one plan. **The `kpi` table has no
  writer in production**: the route is GET-only, there is no POST/PATCH
  anywhere, and `seedKpi.ts` says targets "will be managed through the admin UI
  for real use" — an admin UI that does not exist. In **demo** mode the table is
  seeded, so the sellers board's plan column reads `basis: 'target'` there and
  `basis: 'delivery'` in production, with nothing on screen saying so.
- **Kadrlar tuzilmasi** — totals must be summed over the tree's roots; children
  are already rolled into every parent, so flattening double-counts. *Unshipped:*
  the screen is now a re-creation of the portal's own `hr/structure` org chart
  (see below) with the old table kept behind a `?view=list` toggle, and **it
  prints two headcounts that are both right**: `subordinateCount` is Bitrix24's
  membership minus the head — the figure the floor checks against the portal —
  while `activeHeadcount` counts who is CREDITED here and is what the money
  columns are built from. They differ on five of the twenty units.
- **Sotuvchilar reytingi** — see FAKT 1 / FAKT 2 below. Still company-wide on
  purpose (the route passes `ctx.query`, never `ctx.scope`) — but it is
  unscoped, not unscopable: `restrictToEmployeeId` is honoured in SQL when a
  caller's filters set it.

---

## Invariants that break things quietly

**`countsAsRevenue` — name it in every query that touches money, with one
documented exception.** The portal records the same order twice: `#10 База`
mirrors `#6 Доставка` (97% of order codes and amounts, created a median of ten
days later). Pipeline roles are decided in one place, `PIPELINE_ROLE_BY_ID` in
`mapping.ts`, and denormalised onto the deal at import. Bypass it and revenue is
~5 bn UZS (~30%) too high and **nothing looks broken**. `scripts/import.ts`
prints the excluded total on every run; if it is ever zero, the guard has
stopped working.

The exception is `confirmationSellerRating`, and it is asserted:
`tests/http/confirmationSellerRatingSql.test.ts` requires the SQL **not** to
contain `countsAsRevenue`. Every deal in `classified` arrived through a
confirmation-signal stage in pipeline 4, 6 or 12 and never through «#10 База»
(the duplicate never touches a signal stage), so the flag cannot change the
total — but pipelines 4 and 12 are not revenue pipelines, so adding the guard
"to be safe" silently drops every still-queued and every refused order, the two
states the board exists to show.

**Money is BigInt minor units, end to end.** `src/server/domain/money/money.ts`.
`toMajorNumber` is lossy and one-way and throws past `MAX_SAFE_INTEGER`.
`MoneyDto` carries `amountMinor` as a string plus a lossy `amount` for charts.
BigInt crosses the wire as a decimal string (`envelope.ts` `jsonReplacer`).

**Every window comes from `period.ts`. Half-open `[start, end)` — except one
repository.** `this_week` / `this_month` / `this_year` mean **to-date**, so a
mid-month view compares 1–23 Aug against 1–23 Jul rather than showing a fake
collapse. All arithmetic in `env.APP_TIMEZONE`.

`marketingRepository` is the exception: its queries filter
`"date" BETWEEN $2::date AND $3::date` — **inclusive at both ends**, and its
Bitrix-side comparisons cast to `::date` and use `BETWEEN` too. Copying a bound
from that screen into a Bitrix query, or the reverse, shifts a day.

**A deal has four date bases and they may not be substituted.** `*AtSource`
columns are the CRM's timestamps and are what analytics uses; `createdAt` /
`updatedAt` are *our* row lifecycle — using them would move every deal into the
current period on a re-sync. Durations come from `deal_stage_history`, never
from close-minus-create.

**A deal is credited to `COALESCE(d."operatorEmployeeId", d."employeeId")`,
never to `employeeId` alone.** `ASSIGNED_BY_ID` is the deal's owner *today* and
this portal reassigns deals to back office while they are processed. In July
2026 that put **556 orders on Fazliddinov Bunyodjon, head of Операцион**, making
him the sellers board's number one at 4.2× the client's own leader; twelve of
twelve sampled deals named a different, real seller in the portal's own snapshot
field. COALESCE and not a bare join because that field was added in May 2026 —
July is ~20% empty, August ~10% — so a deal without it keeps the assignee rather
than dropping off the board. The join lives in the shared `classified` CTE
precisely so the confirmation queue and the sellers board cannot disagree about
whose order it is. Six sites carry it in `insightsRepository`: `confirmations`,
the day chart, `classified`, `ratingSql`, `confirmationBoard`,
`confirmationOrders`.

**The floor badge is the only stable join between three spellings of one
person.** Bitrix keeps it on `LAST_NAME`, so `user.get` reads «Davlatbek
Sirojov 115»; this application composes `fullName` the other way round and
stores «Sirojov 115 Davlatbek»; the portal's operator snapshot spells it the
Bitrix way again. Measured over all 289 production employees on 2026-09-04:
**90 names carry the number first, 16 last, 237 somewhere, 50 none at all** — an
end-anchored regex matches a sixth of the roster, and the old one gated all but
three people out of a bonus they were owed. Separators are not always spaces
(«130-Salomat Shoimova» is a real row). `floorNumberOf` in
`src/server/domain/employees/floorNumber.ts` takes exactly one standalone 2–4
digit token; two numbers in a name is an ambiguity, not a match.
`indexByFloorNumber` **drops collisions rather than picking a winner**, because
resolving either way silently moves somebody's sales — of 127 badges in the
client's naming space, 123 resolve to exactly one active employee, 1 collides,
3 name nobody. Never extract digits in a query. Note `scripts/verifyRoistat.ts`
carries a third, independent copy of this rule (exact → sorted-token → code),
with a deliberate ceiling: *"Nothing fuzzier than that. Edit distance would
start inventing matches, and an invented match is worse than an honest unmatched
line."*

**Delivered revenue and seller-close are two metrics, never blended.**
`src/server/domain/analytics/sellerClose.ts` — 2 798 seller-stage entries vs
3 729 Доставка-won in one month, only 1 152 shared. The row carries both. The
address changed with the sellers rebuild: this is now a fact about
`/analytics/employees` and `/analytics/leaderboard`. The sellers board no longer
reads `sellerClose` at all — it runs on `classified` + `ratingSql` and grades
delivery by `ds."logisticsRole" = 'DELIVERED'`.

**A rate with no denominator is `null`, not `0`.** `rateBp` returns null over an
empty denominator and deliberately does not round — `pct` rounds again for
display, and double-rounding moved one region across the 85% tone threshold.
`null` (no data) and `0` (a measurement) stay distinct to the UI. The same
no-re-rounding rule has production behind it on the format side: `formatPercent`
prints «<0.1%» rather than a rounded «0.0%», because a 1.1 bn soʻm product line
printed 0% beside a visibly non-zero bar, and six sellers who had won money
shared «0.0%» with eight who had won none.

**A person belongs to ONE unit for money and to SEVERAL for the org chart, and
the two must never be swapped.** *(Unshipped.)* Bitrix24's `UF_DEPARTMENT` is an
ARRAY, and the portal's own `hr/structure` screen counts a person once in EVERY
unit it names — nine of this portal's 208 active people sit in two. The importer
kept only `[0]`, so five of the twenty cards were short by one or two: Тошкент
онлайн 0 against 1, Asliddin(ROP) 8 against 10, Azizbek(ROP) 14 against 16,
Saidaziz(ROP) 14 against 15, Sevinchxon(ROP) 8 against 10 (measured 2026-09-05).
`department_member` now carries the full set and **nothing but the org chart
reads it**. `employee."departmentId"` is untouched and stays the PRIMARY unit:
every analytic on this dashboard credits a person to exactly one unit, and
rolling a two-unit person up both branches would count their headcount and their
money twice. `tests/http/structureSql.test.ts` pins which CTE reads which — the
`members` CTE the join table, the `people` CTE the column — because swapping
them produces a plausible number rather than an error.

Three subsidiary rules of that screen, all invisible when they break:

- **The head is not one of their own subordinates.** «Подчинённые: 13» sits over
  a unit of fourteen. Dropping the subtraction adds one to every card at once.
- **A head the portal does not list IN the unit gets no head row.** «Навоий»
  names `UF_HEAD` = Мурод Содиков, whose own two units are «Kompaniya(ROP)» and
  «Тошкент онлайн»; the portal draws that card with no head row rather than
  seating him where his record does not. `head` is null for exactly that case,
  and `headName` is still on the DTO beside it.
- **The subtree pill counts PEOPLE, not memberships.** Somebody in both
  «Регистрация» and «Azizbek(ROP)» is one person under NEWGEN, so the count is
  `DISTINCT`; summing the row below would double them.

**Scope narrows, never widens.** `intersectEmployeeScope` is an intersection,
never a union. An empty scope may not be an empty array — every repository tests
`ids?.length`, so `[]` reads as "no filter" and silently widens to the whole
company. Hence the sentinels `NO_EMPLOYEE_IN_SCOPE` and
`__no_employee_linked__`.

**Branch (`filial`) scoping is fully built and has zero callers.** Domain,
schema, query param, service door, tests and a proof script all exist;
`grep -rn scopedContext src/` returns only its own definition. Do not assume any
screen is branch-scoped today. *Unshipped caveat:* the telephony removal breaks
`npm run branch:verify` — `scripts/verifyBranchScope.ts` counts rows
`FROM "call_record"` twice and would raise `42P01` against a migrated database.
Typecheck and lint cannot see it; the references are inside `$queryRaw`
template literals.

### The confirmation queue

**Cohorted by arrival in `C4:NEW`, not by Дата создания.** Five stages speak
(`CONFIRMATION_SIGNAL_STAGES` in `mapping.ts`), every other stage leaves the
status alone. An order joins the board the moment it reaches Тасдиклаш — the
move out of «Регистрация» / «Сделка успешна» — and a deal with no arrival (~52
that appear straight in `C6:NEW`) is not on the board at all, in any mode. Дата
создания undercounts: measured 08-31, 99 by creation date against 125 arrivals
and 135 portal visits. `tests/http/confirmationQueueSql.test.ts` pins the
cohort, the `numbered` partition key, the never-queued exclusion and the
left-only history bound.

**«🔁 ҚАЙТА ТУШДИ» counts GAPS, not entries, and the gap is six hours.** The bot
marks a return by remembering each deal's previous stage; we read the same fact
from the stage history, where every entry into `C4:NEW` is a row. But an order
can enter twice in fifteen minutes because one person confirmed it, saw a
mistake and pulled it back — deal 319494 on 2026-09-03 did exactly that, wore
the mark here and correctly did not in Telegram. `REPEAT_GAP_HOURS` is the bot's
own threshold, so the two surfaces cannot contradict each other in front of the
same operator. The lookup is unbounded by the window and runs after the page's
LIMIT, so it costs 25 index lookups rather than a second pass.

**The LAST arrival dates the row, so the row has to carry the earlier ones.**
One order is one row — counting visits would let «тасдиқланиш %» exceed the
orders it divides — but that means an order confirmed on the 29th and pulled
back on the 31st leaves the 29th. Deal 834920 did exactly that, and six of the
127 orders that arrived on 2026-08-29 did; the operator reading the 29th found
an order their Telegram channel had announced that morning simply gone.
`QUEUE_HISTORY_SQL` returns every visit as JSON, newest first, and the СТАТУС
column draws them as a chain: only the last state is lit as a chip, an arrow
points up from each earlier one, and **every step carries its own date,
including the lit chip's** — because САНА is two columns away and routinely
scrolled off, which left the lit state looking like the older one (commit
240e0e7). A single-visit order renders as a bare chip with no date — 3 077 of
the 3 269 orders in a month. **It is shown and never summed**: the tiles, the
Статистика panel, the state filter and the header bell all read the single
`classified.outcome`, and `queueHistory[0]` IS that outcome, which is why the
UNCONFIRMED_SHIPPED refinement is confined to the last visit («Тастиклаш анализ»
is a field on the DEAL describing where it stands now, so reading it onto an
August visit would invent a fact). Production holds at most three visits per
order. Pinned by `tests/features/confirmationHistory.test.tsx`.

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

**The page prints no resolved date line under its title** (`meta={undefined}`,
unconditionally). The preset row directly below already names the active window,
so printing the resolved dates restated a control the reader was looking at; in
backlog mode `meta.period` is honest that the route answered for all of time,
which renders as «01.01.1970 – 31.12.2099».

**The board has a SECOND cache key, and the tile band deliberately does not
follow its own selection.** `boardSummaryKey` strips the state selection, the
page number, the page size and the sort: a band whose figures moved to match the
state you picked could not be used to compare one state against another, which
is the only reason to put six of them side by side (the ROP panel and the ROP
filter's options ignore it for the same reason). The page used to mark the whole
response stale on `isPlaceholderData`, which is true for *any* key change, so
clicking «Кутилмоқда» dropped six tiles to skeletons and brought them back a
second later with identical numbers. The key is stamped onto the answer
(`askedFor`) and compared as `summaryIsCurrent`, because a placeholder response
from the previous key is otherwise indistinguishable; its entries are **sorted**,
because `apiParams` is built conditionally and a filter cleared then set again
arrives with its keys in another order. Pinned by
`tests/features/boardSummaryKey.test.ts`.

#### Unshipped: the global search and «Жами»

`CONFIRMATION_QUEUE_MODES` becomes `['window', 'backlog', 'all']`, and the route
**drops the reporting window whenever `q` is set or `queue=all`**, swapping
`periodFrom(...)` for `allTime(ctx.timeZone)` before the service is called. The
board opens on «Bugun», so before this every search for an order older than this
morning answered «Buyurtma topilmadi» with nothing on screen naming the window
as the reason — and the operator typing a phone number has the customer on the
line and does not know which day the order reached Тасдиклаш; that is the fact
they are calling to establish. The decision lives in the route so `meta.period`
reports the span actually queried, and the tiles and ROP panel ride the same
window as the rows.

- **Three modes, two branches.** Only `backlog` has cohort SQL of its own; `all`
  is the **windowed** branch of `queueSql` handed an all-time span, because a
  third branch would be a third definition of "an order is on this board". The
  span is chosen twice — in the route *and* in
  `insightsService.confirmationQueue`, written as
  `mode === 'window' ? window : allTime` rather than as a list of exceptions —
  so a direct caller passing `queue=all&preset=today` cannot reach a
  half-bounded board and a fourth mode cannot arrive silently bounded.
- **Neither widens the COHORT.** `dated` still requires an arrival in `C4:NEW`,
  so the ~52 deals that appear straight in `C6:NEW` remain unfindable — a
  «topilmadi» for one of those is correct, not a bug.
- The predicate searches deal title, order code, Bitrix id, region and delivery
  address, the customer's name, and **digits-only** over phones and the amount,
  plus three correlated `EXISTS` tables (employee, sales_source,
  deal_item→product). Correlated `EXISTS` rather than joins because the
  predicate may only depend on what all three consumers — list, tiles, ROP panel
  — join, and because joining `deal_item` multiplies the row.
- There is a **separate head/tail branch for the masked form**: the column holds
  `+998944340037` while the screen displays `+99894***0037`, and people search by
  copying what they can see; digits-only turns that into `998940037`, a sequence
  in no phone number, so the obvious search silently found nothing. The digits
  branch is guarded on non-empty, or it reduces to `'%%'` and matches every row.
- **Every search runs the slow shape.** `allTime` starts at `new Date(0)`, so
  `moves`'s left bound stops bounding anything — the comment above it calls that
  bound "the whole reason this query is affordable" — and `periodLengthInDays`
  is far past `LONG_WINDOW_DAYS = 62`, so the two-statement shape is never used:
  ~5 s for a year against 2–3 s for a month. Hence the 350 ms debounce.
- **`globalSearch` is read off the ANSWER (`askedQ`); `allOrders` off the URL.**
  The search box is debounced, so the URL flips ahead of the rows; read from
  `filters.q`, the banner would announce an all-time search while windowed rows
  were still on screen. «Жами» is not debounced, so its chip must light on the
  click that set it.
- **`reset()` keeps `queue` and drops `q`; picking a date preset clears
  `queue=all` but must never clear `queue=backlog`.** «Жами» sits inside the same
  control as Bugun/Kecha/Shu oy, so clicking a preset while it is on is a request
  for that date; backlog mode hides the period control entirely, so it can never
  get there through the UI, and clearing it blind would lose the bell's board.
- The board is **company-wide**: the route passes `{}` as the scope argument, so
  a global search is not a scope bypass — it is the scope this endpoint always
  had. Anyone adding scoping must do it there, not in the search predicate.

### The sellers board: FAKT 1 and FAKT 2

The board runs on the confirmation queue's cohort. `basis` is hard-coded on the
page (`const basis = 'queue' as const`) and defaults to `'queue'` at the route.
`?basis=intake` still exists, but only as **the oracle**: it is the one reading
measured against the client's published dashboard (fact1 0.11%, fact2 0.04%,
trans 0.52% off), kept so a queue regression can be checked against it — not a
second board anyone was meant to read, and a toggle offering it invited exactly
that. The two are nothing alike: 3.89 bn of July intake against 0.98 bn
delivered, same month, same deals.

**FAKT 1 is `c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')` — two states,
never one.** 🟣 Тасдиқланмай чиқди is not a refusal: the operator never reached
the customer and the order shipped anyway, so the goods and money moved exactly
as a confirmed order's did. The client's board printed 91 ✅ beside 3 🟣 on
2026-09-04 and FAKT 1 owes the floor both. It is stated once as `FAKT1_OUTCOMES`
and interpolated wherever it is needed; the test counts **six occurrences in the
built `ratingSql`**, because FAKT 1's money, its order count, «yoʻlda» and
«bekor qilindi» are one population from four angles — if one still read
`= 'CONFIRMED'` the row would carry money no other column could account for. The
Тасдиклаш board itself still keeps all five states apart; only the rating folds
two together.

**FAKT 2 is `ds."logisticsRole" = 'DELIVERED'` on the deal's CURRENT stage —
never a bare `status = 'WON'`.** The client's rule is «moved to Завершить
сделку», the Доставка kanban's end drop-zone. Nine stages across nine pipelines
carry category WON and two hold real deals that never met a courier: «База ·
Успешно» (the retention kanban) and «Регистрация · Сделка успешна», the
automation stamp that *hands* a lead to Тасдиклаш. Over this cohort all-time
that is 41 База rows worth 56 900 000 soʻm and 33 Регистрация rows worth nothing
but inflating the delivered COUNT, which drives conversion; August alone carried
3 (6 300 000) and April 26 (33 550 000). Reading the current stage also means an
order delivered and bounced back is not delivered money today — of 19 such
August orders, 7 went to «Отказ предварительно» and 11 back to a hub.

**FAKT 2 is NOT a subset of FAKT 1.** Never label it «shundan» / «of which», and
never print one as a share of the other. An order shipped Тасдиқланмай чиқди
never entered FAKT 1 and still delivers real money into FAKT 2, so the two cross
over: the board has printed 57.6 mln confirmed beside 58.8 mln delivered under a
tile that said "of which", which reads as a broken page rather than as the fact
it is (commit 5638d90).

**The per-seller day chart measures what the row above it measures.** It groups
by `COALESCE(d."operatorEmployeeId", d."employeeId")`, grades delivered money by
`ds."logisticsRole" = 'DELIVERED'`, and its `HAVING` admits a day whose only
money was delivered without a confirmation — *"the same gate as the board"*.
This was a real drift once (the query kept `employeeId` and a bare WON while the
board moved on) and it is fixed on `main`; the local checkout predates the fix.

Everything else on that board that a query would get wrong:

- **The gate is `HAVING count(*) > 0`** — every operator in the cohort, a
  deliberate departure from the client's own page, which drops rows with no
  FAKT 2. Their stated model is that the ОПЕРАТОР on a «barcha buyurtmalar» row
  IS the seller, so a seller who took nine orders and had all nine refused is
  exactly the row a floor manager needs. Under the old confirmed-OR-delivered
  gate, seven operators and 29 orders were invisible in July — four of them in
  real (ROP) teams — and their 28 refusals were also missing from the conversion
  denominator, flattering the whole board.
- **Ranking is FAKT 2 first, FAKT 1 second, employee id last**, and a rank is
  shared only when BOTH money figures match. Delivered money leads because that
  is what the floor is paid on, but delivery takes days, so on «Bugun» every row
  holds zero FAKT 2 — ranking on it alone collapsed the board into one tie
  broken by an internal id, leaving 55 sellers and 148 mln soʻm of confirmed
  work unranked. Competition ranking (1, 2, 2, 4) must compare both, or two
  sellers level on FAKT 2 and far apart on FAKT 1 print 1, 1, 3 over visibly
  different rows — and `/analytics/leaderboard` ranks the same floor 1, 2, 2, 4,
  which is the kind of disagreement a bonus argument starts over.
- **A zero FAKT 2 on «Bugun» is a date, not a fault** — the board says so rather
  than printing nothing, because delivery lags confirmation by days.
- **`lostOrders` is queue refusals PLUS confirmed-then-cancelled, and «yoʻlda»
  requires `status = 'OPEN'`.** The old in-transit predicate was "confirmed and
  not won", which filed an order the seller confirmed and then LOST as live work
  — in July, 102 orders and 176 230 000 soʻm, a fifth of the money the screen
  labelled in-transit. Conversion's denominator is *resolved* orders; counting
  only queue refusals flattered July by 3.4 points, 84.1% where the truth is
  80.7%.
- **`cohortOrders` and `orders` are two counts and both must be printed.**
  `cohortOrders` is every order the operator has in the cohort — the population
  the Тасдиклаш page shows for the same period — while `orders` (FAKT 1) counts
  only what left the queue as an order. For one August that is 3 228 against
  2 874: two pages stating two true numbers 354 apart with nothing explaining the
  difference is a support ticket.
- **«Plan bajarish» answers one of two questions and the DTO says which**
  (`basis: 'target' | 'delivery' | null`). The client's own board switches
  silently: FAKT 2 against a target where one exists, FAKT 2 against FAKT 1 where
  none does — verified against their published July board, 86 of 93 rows match to
  the percent. A target wins because it is a contract, not a rate; company-wide
  `kpi` rows (null `employeeId`) are DROPPED, since charging one to a seller
  reads as that seller missing the company's plan single-handed. No target and no
  confirmed money is `null`, not 0% — an empty bar beside «0%» claims the seller
  missed something that was never set. The percentage is uncapped in value,
  clamped at 100% in bar width, capped at «999%+» in text (their board prints
  1343% and 44 029.3%, and one such row sets the column's width). `planWindow` is
  null unless every target on the board shares one span, and subtracts 1 ms from
  `end` so an August plan reads «1-avg — 31-avg».
- **Prognoz is one divisor for the whole board** — the period's elapsed fraction
  — null once the period is over and below a 2% elapsed floor. Dividing by a
  sliver of a month multiplies one early order into a fantasy, and a finished
  total is not a forecast. The per-row column reuses the service's own global
  divisor so the column and the footer strip cannot state two different paces.
- **The bonus ladder is the client's, quoted**: 45 / 60 / 70 mln soʻm of FAKT 2
  pays 1 / 1.5 / 2 mln, stored **descending** because the reading is "the highest
  tier whose floor you have cleared" — ascending awards the first match and pays
  1 mln to a seller who earned 2. It is gated on the **107–147 floor band
  first**, which is their own `idInRange()`: without it this board pays a bonus
  to people their own page pays nothing, and not marginally — July's top three
  all sit outside the band and all clear the top rung. A name with no badge is
  not eligible; inventing a payment is worse than withholding one. Of 289
  employees, 237 carry a floor number and 55 fall inside the band.
- **The podium seats whoever has money** (`won > 0 || ordered > 0`), not only
  whoever has delivered — otherwise it stood empty over a floor that had
  confirmed 148 mln soʻm between 55 people. Each card states which figure earned
  the place. Medal metal is chrome only: rims, washes, avatar rings, pedestal
  numerals. Rank travels on size, elevation and position (72 / 48 / 30 px
  blocks), never on a colour that encodes a value.
- **There is deliberately no ROP colour coding.** Two reasons, the second
  decisive: the design system caps categorical identity at eight slots, and the
  client's thirteen-entry map is already stale — `department.get` returns fifteen
  (ROP) teams, their map names ten, and three of its entries (Husniddin,
  Shohjaxon, Vohidjon) no longer exist.
- **The name filter FILTERS, it does not re-rank.** Rank, share and the podium
  always come from the whole board — this replaces the client's 128-tab operator
  strip, whose job is "find me", and if filtering re-ranked, every seller who
  searched their own name would be shown as number one. Podium cards are doors:
  clicking one opens that row's drill-down and scrolls to it after a double rAF,
  so the row exists before it is scrolled to.
- **Lid, Konv. (lid) and FOT are permanently null by design — never render 0.**
  There is no lead anywhere in this database (no `Lead` model, no LEADS sync
  entity, nothing in `CrmProvider`); the client fills that column from outside
  Bitrix24. Nothing holds pay either. The columns are carried because a column
  that states its own gap is a question somebody can answer, and a zero would be
  an answer, the wrong one. `conversionPercent` (won / resolved) and
  `leadConversionPercent` (orders / leads) are two different questions with two
  different denominators.

**`operatorTeamSource` is written on every deal and read by nothing.** The
column exists because a seller's past months belong to the team they were in
then — one July row reads «Husniddin(ROP)», a department the portal no longer
has — but `classified.rop` is still derived from the resolved employee's
**current** department. Anyone about to "fix" ROP attribution should know the
column they need is already populated and unused, not missing.

**The ROP strip's backslashes must be DOUBLED** —
`regexp_replace(dep."name", '\\(ROP\\)', '', 'gi')` — because the SQL lives in a
JavaScript template literal. `\(` is not a JS escape, so a single backslash
collapses and Postgres receives a bare capture group round the three letters,
matching them and leaving the parentheses: «Sevinch(ROP)» → «Sevinch()». Every
РОП on the Тасдиклаш board, in the filter dropdown, in the Статистика panel and
in the sellers board's ROP column would have read that way. The `replace()` it
was refactored from was never wrong, so this was a regression nothing on screen
would have called a bug — only ugly. `tests/http/confirmationQueueSql.test.ts`
asserts on the **built string**, not the source; the comment above the line must
itself avoid a lone backslash and a backtick or it terminates the literal it
documents.

---

### Unshipped: Kadrlar tuzilmasi as the portal's own org chart

`/structure` re-creates `obey.bitrix24.kz/hr/structure/`: department cards on a
pannable, zoomable canvas joined by orthogonal elbow connectors, one row per
level, a floating control row at the top and a zoom stepper bottom-left, a
per-card expand/collapse footer, a «SIZ» badge on the reader's own unit, and a
roster panel docked over the canvas. The old indented table is the `?view=list`
reading behind the toggle. Both are two drawings of ONE `/insights/structure`
answer, so they cannot disagree and switching costs no request.

- **Every write affordance the portal has is deliberately absent** — ДОБАВИТЬ,
  the «+» on the connectors, the drag handle, the «...» menu. All four write
  into Bitrix24, and the frontend never talks to a CRM; the entire mutation
  surface of this API is three `/users` handlers. The client's instruction was
  «bitrix24 dan hech narsani oʻzgartirma». What the card gains instead is the
  one thing the portal cannot print: the unit's money over the window.
- **The second level down starts FOLDED, and the chart fits ONCE.** Fully open,
  this portal's tree is 4 332 canvas units wide — nine teams under «Тошкент
  онлайн», six under «Навоий» — which fitted into a 1 500px card is 35% zoom and
  a screen of unreadable rectangles. Re-fitting on every shape change was worse:
  the answer to "show me this branch" was the whole company zoomed out and the
  branch smaller than before the click. Expanding now holds the clicked card
  still (a `useLayoutEffect` anchor) and «Sigʻdirish» is the way back.
- **Pan writes the transform straight onto the stage node.** The viewport is a
  ref, never state; only the zoom READOUT re-renders, and it moves in steps.
- **Avatars are initials, not photos.** `user.get` returns `PERSONAL_PHOTO` on
  `cdn-ru.bitrix24.kz` and the CSP is `img-src 'self' data: blob:`, so every one
  of them would be a broken image. `InitialChip` is the whole answer.
- **The money is withheld from an OWN-scoped reader, not the screen.** This is
  the one company-wide page a salesperson is meant to open — the client asked
  for it precisely so the floor can see who reports to whom — so the route
  serves the tree and gates the figures on `analytics:read:all`, the same
  permission every other company-wide number is behind. Null, never zero, and
  the columns and the tile are not rendered at all.
- **The search matches PEOPLE, not just units.** Every active member's name
  rides the tree's own payload (`memberNames`, ~290 strings, a few KB on a
  request the page already makes), because the first thing a seller types into
  this screen is their own name — and matching only the unit and its head
  answered «topilmadi» over a dimmed company while their row sat two clicks
  away in the panel. A match force-opens its ancestors and is centred once.
- **A `?dep=` link force-opens its own way in.** The selected unit's ancestors
  are unfolded by the same derivation the search uses, so "this is the team,
  look" pasted into a chat opens on the card and not on a panel floating over a
  folded tree. Derived, not written into the fold state: the recipient's own
  folds come back when they close the panel.
- **`/insights/structure/roster` is a SECOND request on purpose.** The chart
  draws twenty cards and a reader opens one panel; putting 289 people on every
  node would ship the whole roster again on every change of the window.
- The roster lists membership, so a person shown in their SECOND unit carries
  their own money while that money counts towards their FIRST unit — the panel
  says so in a footnote rather than letting the column quietly fail to add up.

## The sync pipeline

`CrmProvider` (portal vocabulary) → handlers (`DEALS`, `STAGE_HISTORY`, …) →
`SyncEngine` (cursors, status, sweeps) → `PrismaSyncStore`. Bitrix24 field names
(`UF_CRM_*`, `CATEGORY_ID`, `crm.deal.list`) stay inside
`src/server/integrations/crm/bitrix24/` — a strong convention, not a lint rule.

- **`batchWalk` uses id-chained seeks, never offsets.** 50 chained commands per
  `batch`, `filter[>ID]` + `start=-1`, 2 500 rows a round trip. Offsets were
  measured: `start=400000` ran 25 minutes and then got *every*
  `crm.contact.list` call in the account answered `OPERATION_TIME_LIMIT` for ten
  minutes.
- **`encodeParams` percent-encodes filter KEYS, not just values.** Get it wrong
  and the portal silently drops the filter and returns the whole table — 20 750
  fetched rows held 12 800 distinct ones. `>=DATE_MODIFY` is built the same way,
  so the same bug turns every incremental sync into a full one.
- **`skipped` must not block the watermark; `failed` must.** Stage history
  finishes `PARTIAL` on every run (2 346 of 193 344 rows point at things that no
  longer exist), and blocking on skips left the cursor permanently stuck,
  re-reading 191 000 transitions every tick to change nothing.
- **…but a run that skipped rewinds — 95 minutes for `DEALS`, 35 for
  `STAGE_HISTORY`.** Not the same number, and not interchangeable. The hot
  entities run in sequence, each capturing its own start, so a deal created
  between the DEALS read and the STAGE_HISTORY read has its arrival in `C4:NEW`
  skipped for an unresolvable `dealId` — and `>CREATED_TIME` then means that
  arrival is never offered again, which leaves the order off the confirmation
  board with nothing reporting a gap. Measured 2026-09-03: portal 44, the
  client's own bot board 44, ours 43 (deal 935632), and 1–4 a day over the
  preceding days. STAGE_HISTORY keeps the tight window because its race resolves
  in the very next tick; DEALS waits on reference data that reloads every **30
  ticks**, and a tick has no ceiling, so 95 minutes covers thirty ticks
  averaging three. Over five hours of production DEALS skipped on none of its
  293 runs. `SKIP_LOOKBACK_MS` in `SyncEngine.ts`, applied only after a run that
  skipped and always derived from that run's own start, pinned by two separate
  assertions in `tests/integrations/syncEngine.test.ts`.
- **Stage history has a SECOND, post-write pass, and it was the most expensive
  statement this app ever ran.** Closing each transition's `leftAt` with the
  start of the next used to run a window function over all 222 600
  `deal_stage_history` rows **every minute** to update about two dozen of them:
  **21.6% of all execution time on production, 7 472 calls at a mean of 1 745 ms
  and a worst case of 67 SECONDS**, 178 379 changed rows lifetime — on the same
  single vCPU that answers every page, which is most of what "the dashboard is
  slow" actually was. `historyLeftAtSql(scoped)` adds
  `WHERE "dealId" = ANY($1::text[])` on an incremental run, scoped to the deals
  that run wrote, which is **exact** rather than approximate because `leftAt` is
  decided by the next row of the same deal. The two forms must differ by the
  WHERE clause and nothing else — the partition stays
  `PARTITION BY "dealId" ORDER BY "enteredAt", "id"` in both, or a tick's answer
  disagrees with a full import's for the same order. Pinned by
  `tests/integrations/historyFinalize.test.ts`.
- **The upsert may not rewrite a row's primary key.** `rowId()` mints a fresh id
  per batch and the conflict target is the EXTERNAL key, so `id` has to be
  `insertOnly` — without it the update set carried `"id" = EXCLUDED."id"` and
  every re-import gave an existing row a new identity (proved on production: the
  one deal of nineteen the sync touched in 100 s came back under a new id).
  Children followed it — `deal_item` and `deal_stage_history` cascade on update —
  and `/deals/[id]` plus the confirmation trace panel address a deal by that
  column, so links went stale within a minute.
  `tests/integrations/bulkUpsert.test.ts` pins it, including for tables added
  later.
- **Only a FULL run may delete**, and only from `SUCCESS`. An incremental run
  sees just the changed records, so "not seen" says nothing about existence.
- **The production sweep bypasses the SyncEngine on purpose** — it collects ids
  and calls `deleteMissing` directly, because a FULL engine run also re-upserts
  all 434 000 deals. **The sweep and the Roistat import both skip tick 0**
  (`tick > 0 &&`), because `tick` starts at zero and `0 % N === 0` fired both on
  the first tick after every start, restart and redeploy — a 5 MB page fetch
  delaying the first real Bitrix sync. Reference data loading at tick 0 *is*
  intended.
- **The sweep's temp table lives inside one interactive transaction.**
  `CREATE TEMP TABLE … ON COMMIT DROP` outside a transaction vanishes at commit;
  the next `TRUNCATE` then raised `42P01`, which the engine swallowed as a
  warning — deletions silently never happened.
- **`IdResolver.mapFor()`, not `map()`, on the hot path.** The full deal map is
  ~200 MB and the worker runs in a 512 MB container whose heap tops out near
  258 MB. `mapFor` deliberately does not cache: caching a partial view under the
  full map's key would be a silent wrong answer.
- **The EMPLOYEES pass REPLACES each person's department memberships, it does
  not merge them — and the delete and the insert are ONE transaction.**
  *(Unshipped.)* A person moved out of a unit leaves no record saying so, so
  anything absent from this pass's `UF_DEPARTMENT` is gone. But `fetchEmployees`
  returns the whole roster in a single page, so the delete empties
  `department_member` outright: as two statements that is a 20–150 ms window
  (measured 1.6 ms + 15.5 ms locally on 298 rows, plus round trips) in which
  every card on the org chart reads zero members — once every thirty ticks and
  again on every restart and redeploy, with nothing erroring and nothing logged.
  A unit we never imported is dropped rather than guessed at: the FK would
  refuse the row and take the whole multi-row insert with it, which is the same
  empty-string trap two bullets down.
- **The badge→employee roster map is cached for ONE RUN and deliberately not
  across runs.** The roster is ~290 rows and every DEALS batch needs the same
  map, so fetching it per batch would be 175 identical queries on a full pass;
  caching it across runs would mean a resync after a hiring change never sees the
  new people, silently leaving their orders on the assignee.
- **Empty string is the foreign-key trap.** `('' && map.get('')) ?? null` yields
  `''`, which fails the constraint and takes the whole multi-row insert with it.
  Closed at the provider edge (`nonEmpty`) and the handler edge (`link`).
- **`UF_CRM_1778416910` (operator name) and `UF_CRM_1778416806` (operator team)
  are FREE TEXT — read them with `nonEmpty()`, never `label()`.** `label()`
  resolves enumeration ids against the field dictionary and returns undefined for
  a free-text field, so routing these through it discards every value while
  looking like a normal mapping. Same trap as ADDRESS.
- **One worker only**, enforced by `pg_try_advisory_lock` on a **dedicated**
  connection. A pooled connection returns to the pool and Postgres drops the lock
  with it — looks like it works, enforces nothing. A second worker waits rather
  than exiting, because exiting produces a platform restart loop.
- **`DEAL_ITEMS` reads in-memory state left by the `DEALS` pass** in the same
  process, and ignores `updatedSince`. Running it alone yields zero rows and
  reports `SUCCESS`.
- The provider **ignores `pageSize`** and returns one page for most entities.
- **In demo mode the won stage must carry `logisticsRole: 'DELIVERED'`**, or the
  whole sellers board renders FAKT 2 at zero. The demo models a single pipeline,
  so its won stage is the one that means a courier arrived; without saying so,
  demo reads as a broken screen. For the same reason `DemoCrmProvider` sets
  `operatorNameSource` to the assignee's own name — a screen grouping by the
  snapshot needs something to group by. *Unshipped, same rule:* the demo's four
  parentless departments are now a TREE — one root, two branches, four teams,
  three deep like the portal — with heads, `sortOrder`, and every fourth person
  in two units. Flat and headless, the org chart drew four disconnected cards
  and read as a broken page, and none of the three head cases the portal
  actually contains (head inside the unit, head outside it, no head at all) was
  reachable in a test. Pinned by `tests/integrations/demoProvider.test.ts`.

Worker cadence lives in `scripts/syncWorker.ts`: `SYNC_INTERVAL_SEC` 60,
reference data every 30 ticks, sweep and Roistat every 60, and
`SYNC_HISTORY_BACKFILL_DAYS` 45 — the stage-history cursor is wound back once at
startup so the ordinary incremental pass repairs arrival rows lost before the
watermark learned to rewind (`historyBackfillCursor`; it never writes a cursor
where there is none, and never moves one forward). 76 000 of 222 000 rows, under
a minute, once per start. Backoff is a **floor**, not an addend — as an addend
it disappeared exactly when it was needed.

`HOT` on `main` is `['CUSTOMERS', 'DEALS', 'DEAL_ITEMS', 'STAGE_HISTORY',
'CALLS']`. The order *is* the race `SKIP_LOOKBACK_MS` exists for.

**Every one of the worker's knobs bypasses `env.ts` validation.** `env.ts`
declares the web app's variables only; the worker reads each cadence knob raw
through `Number(process.env.X ?? default)`. `Number('')` is 0 and
`Number('sixty')` is NaN — a typo in the App Platform panel silently turns the
sweep off (0 disables it) or makes every `tick % NaN` comparison false, and
nothing throws. `env.ts` already has a `blankAsUndefined` preprocessor for
exactly this class of bug and the worker does not use it. Three knobs have no
`.env.example` entry at all: `SYNC_ROISTAT_EVERY`, `SYNC_HISTORY_BACKFILL_DAYS`,
`ROISTAT_SOURCE_URL`.

### The operator snapshot

`prisma/migrations/20260904113000_deal_operator_snapshot` adds three nullable
columns to `deal` with no backfill: `operatorNameSource`, `operatorTeamSource`
(the portal's free-text snapshot of who sold the order and which ROP team they
were in at the time) and `operatorEmployeeId` (that name resolved to one of our
employees at import, by floor badge). The FK is `ON DELETE SET NULL`, not
RESTRICT, because a denormalised convenience must not block deleting an employee
whose deals still have a real owner.

**NULL is normal, not an error.** The portal field was added in May 2026, so
July is ~20% empty and August ~10%; it is also null wherever the badge is
ambiguous. Coverage on Доставка deals specifically was measured at 99.96% for
August and 99.2% for July, but the stored columns only fill as the sync rewrites
each deal, so no reader may assume a value.

**Schema and migration are out of step.** The migration creates
`deal_operatorNameSource_idx`; the model declares only
`@@index([operatorEmployeeId])`. The next `prisma migrate dev` reads the name
index as drift and emits a `DROP INDEX` for it.

**Read every generated migration for four specific `DROP INDEX` lines before
committing it**: `customer_name_trgm_idx`, `customer_phone_trgm_idx`,
`deal_ordercode_trgm_idx`, `deal_title_trgm_idx`. Those are the GIN trigram
indexes behind the ⌘K search, created in raw SQL because Prisma's schema
language cannot express them — so every generated migration reads them as drift
and tries to remove them.

### Unshipped: the telephony removal

Prepared in the working tree, not on `main`. It deletes `CallRecord`,
`CallDirection`, `RawCall`, `CrmProvider.fetchCalls`, the day-windowed
`voximplant.statistic.get` reader, the `CALLS` handler, both routes
(`/insights/calls`, `/insights/response`), `ResponseRepository` and
`ResponseService`, plus an untracked `DROP TABLE call_record` migration.

**Why:** `call_record` holds 310 000 rows and 118 MB and is by a wide margin the
most sequentially scanned table on the database — **2.8 billion tuples read
against `deal`'s 15 million** — re-imported every minute to answer two endpoints
that no screen in the app has ever called. (A surviving comment in the headcount
query records the table at 299 141 rows at an earlier date; the migration's
figure is the one that justifies the deletion.)

What whoever lands it must know:

- **`SyncEntity.CALLS` stays** in the Postgres enum and in `SYNC_ENTITIES` — the
  sync log holds thousands of historical rows naming it, and `enumParity.ts`
  asserts the union is mutually assignable with `$Enums.SyncEntity`, so dropping
  the member is a compile error unless the database enum is altered too. Only its
  place in `SYNC_ORDER` and in `HOT` is removed. A future `prisma migrate dev`
  that "cleans up" the enum takes the run history with it.
- **The drop is irreversible and fires on the next push to `main`.** Prisma
  writes no down migration. The migration's note that the data "can be
  re-imported by restoring the model and the CALLS handler" is only true because
  Bitrix24 is the system of record — every line of the reader is deleted in the
  same change set and would have to be written again.
- **One surviving metric silently changes meaning.** «Ishlaganlar ulushi» /
  «Ishlagan xodimlar» on the command centre and Kadrlar tuzilmasi have an
  `active` CTE whose first `EXISTS` branch asks `call_record` whether the
  employee did anything in the window. With that branch gone, "active" means
  **closed revenue in the window** only, and the numerator narrows by everyone
  who dialled and closed nothing — on this roster, the back office rather than a
  seller. The grading was calibrated on the wider population (the command centre
  turns amber under 60%, Kadrlar tuzilmasi under 70%, and its own comment cites
  "58 of 206 people" silent). Every one of those numbers moves. **The command
  centre's caption becomes factually false**: it still renders «…qoʻngʻiroq qildi
  yoki bitim yopdi» over a query that would know nothing about calls.
- **Nothing recomputes first-touch or response speed from another source.**
  Creation→first-outbound-call p50/p90, the 15- and 60-minute contact rates,
  median dials to connect, never-connected-after-5, revenue per talk-hour: the
  whole family is deleted, not migrated.
- **Residue the change set leaves behind**: `src/lib/api.ts` keeps the entire
  `Response*` DTO family under a comment pointing at a deleted file, plus
  orphaned `CallDirectionDto` / `CallActivityDto`; `BITRIX24_CALL_MONTHS` and the
  provider's `callHistoryMonths` stay wired through three scripts and the
  constructor and configure nothing; `.env.example` still tells an operator to
  grant the `telephony` webhook scope and tune a knob with a 12-line
  justification that would be fiction; `scripts/verifyBranchScope.ts` still
  queries the dropped table; and the `CallRecord` doc comment ends up directly
  above `model DealItem`.

---

## The database layer

`src/server/db/prisma.ts` and `poolConfig.ts` carry the most numerically
specific production failure in the repo.

**The pool is EIGHT, and the arithmetic includes the deploy.** The managed
instance reports `max_connections = 25`. The sync worker holds five plus one
dedicated advisory-lock connection; a deploy runs two jobs; and during a rolling
deploy the OLD web container and the NEW one are both alive with a full pool
each: **2 × 8 + 6 + 2 = 24**. It was raised to fourteen once on the sum
`14 + 6 + 2 = 22`, which forgot the second container — `2 × 14 + 8 = 36`, the
next deploy's post-deploy job died on `TooManyConnections` and rolled the
release back. `connectionTimeoutMillis` is 20 s rather than 10 so a burst
**queues** in front of the pool instead of erroring. Serverless (NETLIFY /
VERCEL / AWS_LAMBDA_FUNCTION_NAME detected) gets max 3.

**`?sslmode=require` means two different things and one of them broke every
connection.** DigitalOcean hands out that parameter and signs the cluster with
its own CA. `pg` reads `require` as "verify against the system trust store"
where libpq reads it as "encrypt, do not verify", so every connection was
rejected with `self-signed certificate in certificate chain` and the app never
reached the database at all. `poolConfig` therefore forces
`{ rejectUnauthorized: false }` for `sslmode=require` with no CA, and
`{ ca, rejectUnauthorized: true }` once `DATABASE_CA_CERT` is supplied — it also
repairs literal `\n` that survived a dashboard paste. Seven cases in
`tests/db/poolConfig.test.ts`.

`prisma.ts` throws outright if imported where `typeof window !== 'undefined'`.
**Prisma 7 makes a driver adapter mandatory** — a bare `new PrismaClient()`
throws.

---

## Auth and disclosure

`src/server/auth/` is nine files; `docs/SECURITY.md` is the long form. What a
fresh session gets wrong:

- **The login is a login NAME, not an email address.** `users/route.ts`
  validates it against better-auth's username plugin character set.
- **The HIBP breach check fails OPEN on purpose.** The stock plugin turns a
  network failure into a 500, which would stop the owner changing a password
  they believe is compromised because HIBP is down. The wrapper keeps only
  `PASSWORD_COMPROMISED` (rethrown) and lets a 4 s timeout, DNS failure or 503
  fall through and hash unchecked. The password never leaves the server — SHA-1,
  first five hex characters, k-anonymity.
- **TOTP is opt-in and must stay that way.** `twoFactorEnabled` flips only when a
  real code is posted to `/two-factor/verify-totp`, so the codes are always
  already in the user's hands. The escape hatch is a documented
  `UPDATE "user" SET "twoFactorEnabled" = false WHERE email = '<address>'`.
- **The sign-in lockout lives in Postgres, not memory** — "an in-memory counter
  is a reset button with a deploy button on it". Five consecutive failures buy
  15 minutes, doubling to a one-hour ceiling (5→15, 6→30, 7+→60), decaying after
  24 h. An hour and not a day because there is nobody behind the single owner to
  lift a lock. **The key is a hash of the email**, so an address with no account
  is lockable too — otherwise the lockout message is an account-existence oracle
  — and so the table does not become a list of who banks here.
- **`APP_TRUSTED_PROXIES` guards the rate limiter, and getting it wrong fails
  closed.** better-auth keys rate limits on the client IP, and behind a proxy the
  only source is `X-Forwarded-For` — a header the *client* writes. With no proxy
  list, a single-value header is taken at face value, so
  `X-Forwarded-For: 1.2.3.4` picks a fresh bucket and the next value picks
  another: unlimited password attempts, one per bucket. Naming the proxies makes
  better-auth walk the chain **from the right**, the end infrastructure appends
  to. The default includes `100.64.0.0/10` because DigitalOcean's internal
  network uses carrier-grade NAT — safe only because the container is reachable
  solely through the balancer, which is exactly why the variable exists to narrow
  it on a host clients can reach directly. An unrecognised chain resolves to no
  IP and every request shares one bucket.
- **`src/server/http/auditContext.ts` deliberately inverts that rule** and takes
  the LEFT-most `x-forwarded-for` entry. That is safe only because the audit
  log's authority is `actorUserId` from a verified session and never the IP — "a
  forged header would put a false address in the log"; it is a best-effort label.
  Both values are bounded before storage (ip ≤ 64 chars, user-agent 300).
  "Fixing" one to match the other changes what the audit log records without
  changing what it means, or hands the rate limiter a client-chosen bucket.

---

## The front-end platform

**`next.config.ts` is 110 lines of load-bearing decisions.**

- A full CSP is set in `headers()`. `connect-src 'self'` and `form-action 'self'`
  mean an injected script could not post the sales figures — or a session — off
  this origin; `frame-ancestors 'none'` and `base-uri 'self'` close framing and
  `<base href>` tricks.
- **`'unsafe-inline'` on scripts is not an oversight**: Next inlines its
  hydration bootstrap and flight data, and a per-request nonce cannot be threaded
  through middleware for statically rendered routes. `'unsafe-eval'` is
  development-only (React Refresh).
- **HSTS is applied only when `NEXT_PUBLIC_APP_URL` starts with `https://`** —
  sending it in local development pins localhost to https in the browser's HSTS
  store for a year, which is genuinely hard to undo.
- `serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg']` —
  bundling the generated client breaks its runtime schema/adapter resolution and
  the function fails on first query with a module error that looks nothing like a
  database problem.
- `devIndicators: false`, because Next draws the route indicator bottom-left,
  exactly where this app puts the signed-in user. In this major `appIsrStatus` /
  `buildActivity` / `buildActivityPosition` were removed and only `position`
  survives.

**The typeface is self-hosted from `src/app/fonts/InterVariable.woff2`, and
`public/` is completely empty.** Inter Variable rather than a system stack for
three reasons that are content, not taste: it carries **Cyrillic** (the portal
returns «Успешно заказ», «Доставка» — Cyrillic is content here, and a Latin-only
face falls back mid-sentence and changes weight), it has real **tabular figures**
(what `.tabular` depends on so a money column stays aligned as digits change),
and it has an **optical-size axis** so headings get a display cut from the same
file with no second download. Self-hosted rather than `next/font/google` because
CSP allows `font-src 'self'` and nothing else, and a build that fetches
fonts.googleapis.com fails on a host with no outbound network. Subsetted to Latin
+ Cyrillic + the modifier letters Uzbek needs for oʻ and gʻ: 197 KB from 352 KB.
`adjustFontFallback: 'Arial'` is written out explicitly because the line once
read `adjustFontFallback: false` under a comment claiming the opposite — the one
deliberate opt-out in the file was of the exact feature the comment said it had,
and every cold load reflowed on swap.

**Layout: there is exactly ONE content width.** `--content-width: 2400px` via
`.page-container`. Do not write a `max-w-[…]` on a page wrapper. The old 1400px
cap was chosen when the rail was the only thing beside the content; on the 1920px
displays this is actually read on it left ~230px of empty canvas while the tables
inside were still eliding columns. Measured with the rail open and 16px gutters,
1920 leaves 1633px and 2560 leaves 2273px — both under the cap — and the number
exists only for 3440, where a three-card row would give 1000px cards holding one
24px figure each. A page centring on a different width than its neighbour makes
the app look like it shifts sideways, and the view transition *animates* that
shift, so it reads as a bug. `AccountPage`'s `max-w-[720px]` is the one
deliberate exception: a 2000px password field is not a wider form.

**Everything after line 1 of `globals.css` is UNLAYERED**, so `.page-container`
beats any Tailwind `max-w-*` on the same element. `@import "tailwindcss"` puts
utilities in `@layer utilities`, and an unlayered rule beats a layered one
regardless of specificity — the same mechanism the file already documents for
`--radius-sm`, where redefining Tailwind's token in `:root` silently changed
every `rounded-lg` from 8px to 18px. A page author adding `max-w-[1400px]` to
"narrow it back" sees nothing happen.

**Light or dark is a choice now, and the whole mechanism is ONE attribute.**
*(Shipped 2026-09-07 as `0c1f1da`, off `origin/main` — this checkout holds the
same work, with `ThemeButton`'s comment written for the permanent shell.)*
`globals.css` has carried a full second palette since it was
written, but the only thing that could reach it was the operating system —
somebody on a machine pinned to light by IT policy had no way to the dark one
at all. `src/lib/theme.ts` writes `data-theme` on `<html>` and nothing else:
`:root[data-theme="dark"]` forces dark, and the `prefers-color-scheme: dark`
block is guarded `:not([data-theme="light"])` so the attribute can force light
BACK. That guard is the half a reader on a dark machine depends on, and
`tests/features/theme.test.ts` asserts it against the stylesheet, because
nothing in TypeScript can see it.

Three choices, not two — «Tizim» is the absence of a decision, not a third
theme, and it has to stay reachable or one press of the header toggle
permanently detaches the dashboard from a machine that switches itself at
sunset. So the header's `ThemeButton` is a two-state toggle on the RESOLVED
theme (a three-state cycle hands a reader who wanted the other mode a press
that gives neither), and the three named states live in `AppearanceSection` on
`/account`.

Two duplications the feature cannot avoid, both deliberate:

- **The storage key is written out twice.** The attribute must be on `<html>`
  before the body is parsed or every cold load flashes white at a dark reader,
  and a script that runs that early cannot import a client module — so
  `layout.tsx` carries an inline copy of the one line. `theme.test.ts` reads
  both files and pins them to the same key; the symptom it prevents is silent,
  because the preference still applies, one full paint too late.
- **`<meta name="theme-color">` is set from the CSS, not from a hex literal.**
  The layout's pair is keyed to `prefers-color-scheme`, which is exactly what a
  forced theme overrides — so a reader who picks light on a dark phone would
  get a black address bar over a white page. `paintBrowserChrome` reads `--page`
  back out of `getComputedStyle` and prepends its own meta (the FIRST matching
  one wins). It runs from `subscribeTheme`, which React calls from an effect;
  `/login` is the one screen nothing subscribes on, so its address bar follows
  the machine until the reader is through the door.

**The page gutter is 16px at every width**, in `main` and in the header bar;
`lg:px-6` was removed from all three places and must not come back. Past `lg` the
rail already takes 240px out of the same row, so the margin is not breathing room
— it is the last thing between the data and the edge. The client asked for it
back on a 1920 display («boʻshliqni kamaytiramiz, juda ham emas») and 16px is the
"not too much". The header carried a second bug: `px-3 sm:px-4 lg:px-6` put its
content 12px in on a phone and 24px in on a desktop while the page beneath sat at
16px both times, so the search box and the page title were never on the same
vertical line at any width.

**Full-digit money is a mode, not a size.** `StatTile money="full"` changes the
formatter, the size class **and** removes the tooltip *and* its tab stop together
— under `money="full"` the exact-soʻm tooltip would repeat the text under the
cursor and cost a keyboard reader one stop per tile to reveal nothing. It exists
for the sellers board only, whose figures are reconciled against the client's own
Bitrix24 board and Telegram channel, both of which print sums in full. Size it
from `--figure-sum-size` / `.figure-sum`, never a literal: a compact figure is
four characters wide whatever it says, «40,123,456,789» is 7.48em of tabular
Inter, and the tile holding it is 139px on a phone and 206px at 1280 where the
KPI band turns four across behind the 240px rail — hence a second ramp at
`min-width: 1280px`, because the tile *halves* there and a single vw slope is
still climbing at exactly the width where the box collapses. `.figure-sum-hero`
must stay **below** `.figure-hero` in the file: same single-class specificity,
source order is the only thing making it win.

**`formatFullUzs` prints digits with no unit; `formatUzs` is the same digits plus
« soʻm ».** Pick by whether the call site sets its own unit span — every one that
leads with a figure does, at its own size, so appending the suffix inside the
formatter would put «soʻm» at 32px inside a podium card. `formatUzs` delegates,
so the two can never disagree about grouping. **Nothing in `format.ts` may
re-round**: `formatFullUzs` uses `maximumFractionDigits: 0` and does **not** go
through `trim()`, which is the compact path and rounds to one decimal below 100.
Routing the sellers board through it would print «106.4 mln» where the floor is
reading «106,432,000» off their own board, and the two stop reconciling.

**A chart under a full-digit tile prints full digits too.** `SellerDaysChart`'s
two panels share a **fixed** `AXIS_WIDTH = 84`; `width="auto"` — what every other
chart uses — is exactly wrong here, because the two panels must put day N at the
same pixel and `auto` would measure «213,000,000» in one and «41» in the other,
offsetting the plots by sixty pixels. 84 rather than 62 because «200,000,000» is
62px at 11px tabular with nothing left for the gap, and a day can carry a
billion. Only the lower panel prints tick labels: a repeated date row between two
panels reads as two charts.

**The ranked-row wash goes on the `<tr>`, never on the `<td>`s**, and the rail is
an inset `box-shadow`, never a border. Painted per cell the gradient restarts in
every column and the row reads as a set of bands; a border on the first cell
changes the row's box and shifts every column by four pixels.

*Unshipped:* `PeriodFilter` grows `muted` (dim, still working) and `extra` (a
fourth chip inside the preset group), and while `extra.active` is true no date
preset and not the custom picker may light — two lit chips would say two windows
are in force and one of them would be wrong. Muted is dimmed and **not** hidden
(hiding reflows the filter row sideways under the caret on every search and again
on every clear) and **not** disabled (the window must be settable before the
search is cleared). A page reaches all of it only through `PageShell`'s `period` /
`periodMuted` / `periodMutedReason` / `periodExtra`: the chip's **place** belongs
to the shell, its **meaning** to the page.

---

## The second pipeline: Roistat

Roistat is a second, unrelated source — a `var D = {…}` literal inside a 5.5 MB
static page, parsed by **brace-matching, not regex**. It lands in its own tables
and is spawned as a child process, hourly. Its source URL default is hard-coded
(`https://rustamov0277-cmd.github.io/roistat/`, overridable by
`ROISTAT_SOURCE_URL`) and deliberately **not** in `env.ts`, because that module
is the contract for what the server needs to boot and the dashboard boots
perfectly well without ever knowing this URL.

Three re-run guards, in order of damage prevented:

1. A blob that parses but is empty, or missing a dimension, or carrying a
   non-positive rate, is **refused before the transaction opens**.
2. A blob carrying a small fraction of what is stored is refused unless
   `--force` — a truncated publish is far likelier than the client deleting nine
   tenths of their history.
3. Writes happen in ONE transaction replacing only the date range **each
   dimension actually covers**. The dimensions do *not* share a range
   (camp/adset/creative/days run to the blob's `today`, the sheet-fed ones stop
   days earlier), so a global delete throws away days only the longer dimensions
   hold.

Flags: `--dry-run`, `--file p.html`, `--force`.

`verifyRoistat` runs every statement inside `SET TRANSACTION READ ONLY`, so an
accidental UPDATE is refused by Postgres, and it compares Bitrix by
**`createdAtSource`, not `closedAt`**, because Roistat attributes money to the
LEAD's date («Выручка привязана к дате лида», printed in their own footer). The
close-date total is printed beside it so the definitional gap is visible rather
than assumed.

---

## Tooling in the repo

`scripts/mcp/bitrixMcp.mjs` is an MCP server that lives inside this repository,
and it is **how every "measured on production" number in this file was
obtained**: a stdio JSON-RPC server speaking both to the portal named by
`BITRIX24_WEBHOOK_URL` and to the database the sync engine writes into, because
`mcp-dev.bitrix24.com/mcp` serves only the REST documentation and can quote the
shape of `crm.deal.list` without reading a single deal.

Its safety rules are not decoration — do not relax them:

- **Read-only by default.** Mutating Bitrix24 methods are refused unless
  `B24_MCP_ALLOW_WRITE=1`.
- SQL is restricted to a **single** SELECT/WITH statement, run inside a
  **rolled-back** transaction.
- The webhook URL embeds an access token and is never echoed into a result or an
  error.
- Its rate limiting mirrors `bitrix24/rateLimiter.ts`, because the portal
  throttles **per account** — tripping it blocks the customer's own CRM users,
  not just us.
- It resolves `.env` against its own file location rather than the process cwd,
  since the launcher chooses the working directory.

---

## Deploy

`.do/app.yaml` is the entire deployment: `web`, the `sync` worker
(`instance_count: 1`), a PRE_DEPLOY `migrate` job and a POST_DEPLOY
`provision-admin` job. No Dockerfile, no CI. `deploy_on_push: true` is declared
on exactly two blocks — the `web` service and the `sync` worker.

**Never re-apply the committed spec over a running app.** Its secrets say
`CHANGE_ME`, and `doctl apps update --spec` replaces the whole spec — the app
stops at its next boot. Take the live spec, edit it, apply that:

```bash
doctl apps spec get <app-id> > /tmp/live.yaml   # secrets come back as EV[1:...]
doctl apps update <app-id> --spec /tmp/live.yaml
```

- **The health check must stay pointed at `/api/health`**, which opens a real
  database connection. It used to point at `/login`, which Next serves from the
  build output and answers 200 with the database gone.
- **`NODE_ENV` must stay `scope: RUN_TIME`.** Scoped to build time as well,
  `npm ci` obeys it and installs no devDependencies, so `next build` cannot
  resolve `@tailwindcss/postcss` and fails before it starts. Next sets
  `NODE_ENV=production` for `next build`/`next start` itself; the variable is
  declared purely so anything else reading it at run time agrees.
- **The worker's run command is `node --import tsx scripts/syncWorker.ts`,
  deliberately not the `tsx` binary.** The `tsx` shim is a shell wrapper and
  `sh -c` does not forward SIGTERM: a stop signal reached the wrapper, the
  wrapper died, and Node kept syncing until the platform killed it thirty seconds
  later, mid-write. Straight to Node, the handler runs and the advisory lock is
  released for the replacement instance.
- **The Roistat import is deliberately NOT a deploy job.** It used to be one,
  which made a marketing-data refresh able to fail a deployment: the importer
  downloads a 5.5 MB page and parses ~25k rows, which a 512 MB job container did
  not survive, so a perfectly good release was rolled back over a marketing
  table. It is run by hand, is idempotent, and refuses a blob that shrank.

---

## Doc rot — verify before trusting

- `docs/ARCHITECTURE.md` documents `getHandler(permission, schema, handle)`. The
  real signature takes `access = { permission, section }`, and the word "section"
  appears nowhere in that file — half the authorisation model is undocumented
  there.
- `docs/BITRIX24.md` says `assertMappingComplete()` guards startup. Its body is
  empty (*"Confirmed against the live portal — nothing to assert."*) with zero
  callers, `findMappingGaps()` beside it returns `[]` unconditionally, and the
  `sourceField` / `confirmed: true` fields its "steps to finish" tell you to edit
  do not exist. It also references a `POST /api/v1/sync/run` route that was never
  built.
- `docs/DEVELOPMENT.md` says **628 tests**; there are 772. It also carries a
  finished phase table.
- `docs/DESIGN.md` documents `.figure-hero` as "at most one per screen" at
  `clamp(34px, 24px + 1.5625vw, 40px)`, which the sellers podium now overrides by
  source order; and it has **no layout section at all**, so
  `--content-width: 2400px` and the one-gutter rule are documented only in the
  CSS comments.
- `src/lib/sections.ts` cites a `src/server/auth/sections.ts` that does not
  exist. The invariant it describes still holds — `rbac.ts` imports
  `effectiveSections` from `@/lib/sections` by direct import.
- *Once the telephony removal lands*, add: `docs/API.md` documents
  `GET /insights/response`; `docs/SUPERDASHBOARD.md` carries an entire telephony
  module («6. Qoʻngʻiroqlar», voximplant, 12 400 calls a day); `docs/DEPLOY.md`
  documents `BITRIX24_CALL_MONTHS` as a live setting that "grows it by roughly
  120 MB per extra" month.

### Comments that lie

Same rule, inside the source. Each of these, followed, reintroduces something a
test forbids:

- `ConfirmationSellerRatingRow`'s docblock still defines FAKT 2 as
  `deal.status = 'WON'` on a Доставка deal — the exact bare-WON definition the
  SQL and `confirmationSellerRatingSql.test.ts` forbid.
- `SellersPage`'s header still says the intake reading "stays behind the
  «Yaratilgan sana» toggle" — a control the same file removed.
- `src/lib/messages.ts` contradicts itself in committed code: two consecutive
  docblocks over the same `nav` object, the first saying the sections are
  "Cyrillic and untranslated on purpose", the second saying the client confirmed
  Latin was fine. The second is the one the code obeys. Both say *nine* sections;
  `SECTIONS` holds eleven.
- `queryParams.ts`'s docstring for `queue` says `window` means the order's own
  Дата создания. The cohort has been the arrival in `C4:NEW` since the board was
  rebuilt to the client's spec.
- *Introduced by the unshipped work:* `commandHeadcount`'s docblock promises an
  `active` union "over calls and won deals"; `SyncEngine`'s header lists CALLS as
  a fifth hot entity; the `CallRecord` doc comment lands above `model DealItem`.

---

## Local database

`.env` points at `postgresql://kali@127.0.0.1:5433/sinolife`, and **that cluster
is up** — an older note in this file claiming every Prisma command fails with
`P1001` is obsolete. All migrations are applied locally, including the
uncommitted `drop_call_records` (`to_regclass('call_record')` is already NULL
there, which is why local behaviour can differ from `main`'s).

`npm run db:check` runs and reports **3 of its 11 invariants failing** —
payments-on-won, status/stage agreement, close-date agreement — against 1 600
deals, 14 employees, 627 won. That is the **demo seed's own data**, not a
production signal, and it is the reason none of the production numbers quoted
throughout this file can be reproduced locally.

The eleven invariants, since the count alone tells you nothing: deal amount
equals the sum of its line items; no deal paid more than its value; payments only
on won deals; status agrees with stage category; resolved deals have a close date
and open ones do not; no deal closes before it was created; no duplicate external
ids per source; every deal has a resolvable employee and stage; every KPI target
positive; no employee has two KPI windows covering the same instant; no sync run
finished FAILED.

Everything else — typecheck, lint, the whole test suite, `next build` — runs
without a database.

**On a fresh clone, `npm run db:generate` (or `npm run build`) comes first.** The
Prisma client is generated into `src/generated/prisma`, which is gitignored, and
there is no `postinstall`. Until it exists, typecheck, lint and the tests all
fail. Regenerate after every schema edit and restart `next dev` — a running dev
server holds the old client and reports `Unknown argument`.

`.gitignore` excludes `bitrix24-discovery.json`, `bitrix24-analysis.json`,
`bitrix24-pipelines.json`, `bitrix24-duplication.json` and
`bitrix24-final-dup.json` because portal discovery output **contains real
customer data** — a rule that only holds as long as new probe scripts keep
writing to those exact filenames.
