# Development

## The gate

```bash
npm run verify      # typecheck && lint && test
npm run build
npm run db:check    # 11 data-integrity invariants
```

All three must be green before a phase is called done. Not "should work" — run
them.

Currently: **628 tests, 0 lint errors, 0 type errors.**

A count in prose goes stale the moment somebody adds a test, so treat it as a
floor rather than a fact: `npm run verify` is what actually answers the
question. This line said 285 for long enough that it stopped being read.

## Conventions

**Money.** Never `number` for an amount. `BigInt` minor units, field name ends
in `Minor`, converted to a display value only at the API edge.

**Undefined results.** Return `null` or a tagged union, never a
plausible-looking fake. No `+Infinity%`, no `0%` standing in for "nothing
resolved yet". `null` (no data) and `0` (a real measurement) must stay
distinguishable all the way to the UI.

**Dates.** All boundaries come from `src/server/domain/period`. Never construct
a period inline; never call `new Date()` inside a pure function — inject it, so
tests are deterministic.

**Layer boundaries.** Enforced by ESLint. If a rule blocks an import, the fix
is almost never to disable the rule.

**`DATA_SOURCE`.** Read only in `providerFactory.ts`. Anywhere else, depend on
`CrmProvider.capabilities` or take the provider as a parameter. Lint enforces
this — it is what keeps the Bitrix24 cutover from becoming a rewrite.

**Authorisation.** Every permission decision goes through
`src/server/auth/rbac.ts`. A check spelled `user.role === 'ADMIN'` anywhere
else is how permissions drift. Route handlers spread `ctx.scope` **after** the
parsed query so a caller cannot widen their own scope.

**Secrets.** Never in a client component, never in a log, never in an API
response, never committed. `.env.example` carries names and comments only.

## Testing

```
tests/domain/        money, metrics, period, sales, performance, finance
tests/integrations/  demo provider, sync engine
tests/http/          envelope, errors, query validation, scope composition
tests/auth/          the RBAC matrix
```

The domain layer is pure, so it needs no database and no mocks. The sync engine
takes its persistence through an interface, so idempotence, incremental
watermarks, failure isolation and deletion sweeps are all tested with in-memory
fakes.

Write the test that would have caught the bug, not the test that restates the
implementation. The valuable ones here are the edge cases: zero baselines,
empty collections, month boundaries, February, and scope escalation.

## Phase history

| Phase | State |
|---|---|
| 1–2. Audit, architecture | Done |
| 3. Database | Done |
| 4. Backend API | Done |
| 5. Demo provider | Done |
| 6. Analytics engine | Done |
| 7–10. Dashboard, employees, KPI, deals | Done |
| 11. Auth / RBAC | Done |
| 12–14. Tests, performance, polish | Done for current scope |
| 15. Bitrix24 integration | Live — mapping confirmed, sync worker in production |

**Not built:** reports/export page, admin sync screen.

## Bugs worth remembering

These were all found by running things rather than reasoning about them, and
each is now covered by a test or a check.

- **KPI attainment read 246%.** KPI windows were UTC months while reporting
  periods were Tashkent months, and the selection rule was "any overlap" — so a
  5-hour sliver pulled in the previous month's targets and scored this month's
  results against them. Fixed by `calendarMonth()` plus containment of the
  period's as-of instant.
- **KPI rows silently doubled.** Fixing the above changed the window
  boundaries, which are part of the KPI natural key, so the old rows were
  orphaned rather than updated. Caught by a count, not a test — now guarded by
  `db:check`.
- **A full sync never removed upstream deletions.** Stale rows stayed attached
  to records that no longer matched. The sweep is guarded three ways: never on
  incremental runs, never after FAILED or PARTIAL, never on an empty read.
- **Sign-in was impossible.** better-auth matches the credential account on an
  `issuer` column the schema lacked.
- **Provisioning did not converge.** It checked only for the user row, so a run
  that created users but failed on credentials could never be repaired by
  re-running.
- **Middleware redirected signed-in users to login.** The cookie prefix was
  written in two places and drifted. Now declared once in `cookiePrefix.ts`.
- **`Secure` cookies broke local production.** Keyed off `NODE_ENV` instead of
  the URL scheme.

## Troubleshooting

**`DATABASE_URL still contains the placeholder password`** — edit `.env`. The
check is deliberate.

**`PrismaClient needs non-empty options`** — Prisma 7 requires a driver
adapter. Use the singleton in `src/server/db/prisma.ts`.

**`Unknown argument` from Prisma after a schema change** — run
`npx prisma generate`. A running dev server also holds the old client; restart
it.

**Redirected to `/login` while signed in** — the cookie prefix in
`cookiePrefix.ts` and the auth config have diverged, or `BETTER_AUTH_URL` says
`https` while you are serving `http`.

**`useSearchParams() should be wrapped in a suspense boundary`** — the page is
being statically prerendered. Add `export const dynamic = 'force-dynamic'`;
every authenticated page has it.

**`Cannot find name 'LayoutProps'`** — Next's generated route types are
missing. Run `npm run typecheck`, which runs `next typegen` first.

**BigInt literal errors** — `tsconfig` targets ES2022. If they reappear after a
config change, delete `tsconfig.tsbuildinfo`; the incremental cache goes stale.

**Prisma CLI vulnerability in `npm audit`** — a stack-exhaustion issue in
`deepmerge-ts`, reachable only through the Prisma **CLI** config loader, not at
runtime. `audit fix --force` downgrades Prisma. Left as is, tracked.
