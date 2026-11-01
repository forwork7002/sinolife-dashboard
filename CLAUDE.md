# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

**SinoLife Sales Intelligence** — a Next.js App Router dashboard over the `obey.bitrix24.kz` CRM plus a Roistat
marketing ledger. UI language is Uzbek, currency UZS, every reporting window computed in `Asia/Tashkent`. ~420 000 deals
across nine pipelines.

The repo is PUBLIC (`gh repo view`, 2026-11-01): no secret, customer phone or staff data in a commit (vault ISH Runbook).

**Read the comment above the code before changing it.** This codebase records *why* a decision was made, and a large
share of those comments name a specific production failure that forced it. Several took more than one attempt to get
right. Re-deriving what a comment already settles is the expensive mistake here.

**The long reference lives in `docs/claude/`** — `screens.md`, `invariants.md`, `sync.md`, `data-scope.md`, and the rest
under *Batafsil* at the end, which says when to read each. This file keeps the rules and points at them. When a change
alters a screen, an invariant, the sync or a scope rule, update its part in that file — never grow this one back.

## The one rule
**The frontend never talks to Bitrix24.** It talks to `/api/v1`. The API talks to our database. Only the sync engine
talks to a CRM, and only through `CrmProvider`.

### The boundaries are ESLint rules, not conventions
The table of what may not import what is in `docs/claude/architecture.md`. `tests/**` is exempt on purpose — so a test
that crosses a boundary will not catch the violation.

`src/lib` sits on the **client** side, yet server modules import from it (`sections`, `api`, `passwordPolicy` are the
shared vocabulary). The sharing is one-directional, and the repo pays for it by hand-mirroring unions:
`src/lib/roles.ts`, `src/lib/dataScope.ts` and the `ConfirmationOutcome` union in `src/lib/api.ts` restate types from
`@/server/domain/types`. **Nothing checks the mirror** — edit both sides.

### Authorisation
`getHandler(access, …)` takes `access = { permission, section }`. **Both are required fields**; `section: null` must be
written out, so adding an endpoint is always a decision about who reaches it. **No route authorises by hand:**
`tests/http/routeAccess.test.ts` fails a route that calls `requirePermission`, `requirePrincipal(` or `assertSection(`
instead of `getHandler` / `mutationHandler`. It also pins the ungated list exactly, so **adding an endpoint with
`section: null` fails that test until you extend the array.**

Route handlers spread scope **last**:

```ts
{ ...ctx.query, ...ctx.scope }
```

That ordering is the mechanism — a `SALES` caller passing someone else's `employeeIds` still gets their own restriction
ANDed on top. `src/middleware.ts` is *not* the boundary: it only checks that a session cookie is present so a signed-out
visitor is redirected instead of watching a shell flash.

### Data scope: ALL, TEAM, OWN
**Three levels, and TEAM is the one the portal actually has most of.** A ROP heads a sales team of a dozen or more;
given ALL they read every rival team's money, given OWN they read a board with one row on it. `dataScope = TEAM`
resolves to the linked employee's own unit, plus **every unit they HEAD and everything under those**. Membership does
not descend; headship does.

- **`ctx.scope` is `{ restrictToEmployeeIds: readonly string[] | null }` — one field, and it is plural.** It was
  `restrictToEmployeeId`, a single id. The singular was **removed rather than kept beside** the plural, because a
  repository honouring the old field and ignoring a new one would have served the whole company to a ROP without
  erroring. `null` is everybody; a non-null value is **never empty** (`NO_EMPLOYEE_IN_SCOPE`, `__no_employee_linked__`).
- **PRIMARY membership, never `department_member`.** That table lists a person in every unit Bitrix24 names, and it
  exists for the org chart. This is a money question — one unit credits a person — and reading memberships would put one
  operator's orders on two ROPs' boards.

#### Handing one out: «ROP» inside «+ Yangi hisob» on `/users` — in `docs/claude/data-scope.md`; read it before changing how an account gets a TEAM scope.
## The screens, and what each one dates by — in `docs/claude/screens.md`
Moved there whole on 2026-10-20 (it was 155 KB of this file): the removed screens, then the table page → URL → feature → endpoint(s) → service → repository → **which date the window filters on**, then one part per screen. Read the screen's table row and its part before changing a screen, its endpoint or any query behind it — the window basis differs per screen, and the wrong one gives plausible, wrong numbers.

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
`CrmProvider` (portal vocabulary) → handlers (`DEALS`, `STAGE_HISTORY`, …) → `SyncEngine` (cursors, status, sweeps) →
`PrismaSyncStore`. Bitrix24 field names (`UF_CRM_*`, `CATEGORY_ID`, `crm.deal.list`) stay inside
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
- **Server cannot reach the portal** — «aloqa yoʻq» on the chip, `UND_ERR_CONNECT_TIMEOUT` in the log; calls go through the `BITRIX24_PROXY_URL` relay; the whole rule and the 5-step diagnosis are in `sync.md`

## Commands
```bash
npm run verify        # typecheck + lint + test — one third of the gate
npm run build         # prisma generate + next build
npm run db:check      # 11 data-integrity invariants (needs a database)
```

`docs/DEVELOPMENT.md` defines the gate as **all three**, and nothing runs them for you — there is no CI, no git hook,
and `.do/app.yaml` has `deploy_on_push: true` on `main`. A push to `main` builds, runs `prisma migrate deploy` against
the production database, and goes live.

Before every push (owner, vault ISH Decisions 2026-10-22): `npm run verify && npm run build` — red means no push.
`db:check` needs a database and none is local (`.env` → `127.0.0.1:5433`, nothing listens, `P1001`; checked 2026-11-01):
run it in production, from `doctl apps console <app-id> web`. Nothing else needs one (Node 22.22.2+).

```bash
npx vitest run tests/domain/money.test.ts             # one file
npx vitest run tests/domain/money.test.ts -t "rounds" # one test by name
```

**Run vitest from the repo root only.** `vitest.config.mts` uses `process.cwd()` for both the `tests/**` include glob
and the `@` alias, so from a subdirectory you get "No test files found". No test touches a database; the suite runs in
~9 s with nothing else installed.

**On a fresh clone, `npm run db:generate` (or `npm run build`) comes first.** The Prisma client is generated into
`src/generated/prisma`, which is gitignored, and there is no `postinstall`. Until it exists, typecheck, lint and the
tests all fail. Regenerate after every schema edit and restart `next dev` — a running dev server holds the old client
and reports `Unknown argument`.

## Deploy
- Work in `../.ish-<task>` (`git worktree add -b <task> ../.ish-<task> origin/main`, `cp -al` the main `node_modules` —
  Turbopack refuses a symlink — then `npm run db:generate`), not in `.claude/worktrees/`, which this ESLint config does
  not ignore (vault ISH Decisions 2026-10-22; checked 2026-11-01).
- Push only when no deployment is BUILDING or PENDING (`doctl apps list-deployments <app-id>`) — a push cancels it, and
  a LandingPage-1 push deploys this app too. Done = the new deployment ACTIVE and `/api/health` 200.

`.do/app.yaml` holds `web`, the `sync` worker (`instance_count: 1`), a PRE_DEPLOY `migrate` job and a POST_DEPLOY
`provision-admin` job — no Dockerfile, no CI — but the live spec also runs LandingPage-1's `collagen-landing`, which the
committed one lacks (`doctl apps get`, 2026-11-01).

**Never re-apply the committed spec over a running app.** Its secrets say `CHANGE_ME`, and `doctl apps update --spec`
replaces the whole spec — the app stops at its next boot. Take the live spec, edit it, apply that:

```bash
doctl apps spec get <app-id> > /tmp/live.yaml   # secrets come back as EV[1:...]
doctl apps update <app-id> --spec /tmp/live.yaml
```

The health check must stay pointed at `/api/health`, which opens a real database connection. It used to point at
`/login`, which Next serves from the build output and answers 200 with the database gone.

## Batafsil — the file to read before the work (all in `docs/claude/`)
- `screens.md` — a screen, its endpoint or a query behind it; the index of screens is at its end.
- `invariants.md` — money, periods, pipelines, scope, the confirmation queue, the header bell, the org chart.
- `sync.md` — sync handlers, Bitrix24 calls, the sweep, the portal budget; the sync commands are at its end.
- `data-scope.md` — granting TEAM («+ Yangi hisob»); «Scope mechanics» at its end before touching `ScopeRepository`,
  `ScopeService`, `rowScopeFor`, `ScopedWindow` or a team query — every team reader goes through `teamSql`.
- `client.md` — «Client data flow», «Light or dark»: layouts, `Shell`, `providers.tsx`, refresh / new-version button,
  live-data styles, theme. Never render `Shell` from a page again; `refetchInterval` and `staleTime` move together —
  changing either value without the other brings one of the two failures back.
- `architecture.md` — the layer diagram, the ESLint import table, the files to read first.
- `ops.md` — reading `slow request` / `slow page guard` lines in the web log.
- `doc-rot.md` — before trusting `docs/ARCHITECTURE.md`, `docs/BITRIX24.md`, `docs/API.md` or `docs/DEVELOPMENT.md`.
- `local-db.md` — making a local database, which `db:*` scripts and `prisma migrate` need.
- `history.md` — the 2026-09-10 cull, and CLAUDE.md text superseded on 2026-11-01, each with its reason.
