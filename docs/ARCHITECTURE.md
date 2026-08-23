# Architecture

## The one rule

**The frontend never talks to Bitrix24.** It talks to our API. Our API talks to
our database. Only the synchronisation engine talks to a CRM, and only through
a provider interface.

```
Bitrix24 ──┐
           ├─► CrmProvider (interface) ◄── DemoCrmProvider
Demo gen ──┘            │
                        ▼
                  SyncEngine          upsert on (externalSource, externalId)
                        ▼
                  PostgreSQL
                        ▼
                  Repositories        the only layer that touches Prisma
                        ▼
                  Domain / Analytics  pure functions, no framework imports
                        ▼
                  Services            orchestration → DTO
                        ▼
                  /api/v1/*           validate → authorise → delegate → envelope
                        ▼
                  React client        never imports server code
```

## Why one Next.js app

A separate backend service would make the boundary obvious but cost two builds,
two deploys and duplicated types from day one — for a team of this size, on an
internal tool, that is overhead without a matching benefit.

The boundary is instead enforced **structurally**:

- `src/server/domain/**` imports no framework, no Prisma, no config. It is
  plain TypeScript that could be lifted into a separate service unchanged.
- `src/components/**`, `src/features/**`, `src/lib/**` may not import
  `@/server/*` at all.
- `src/app/api/**` may not import Prisma directly; it goes through repositories,
  so authorisation scoping cannot be bypassed.
- `env.DATA_SOURCE` may be read **only** in `providerFactory.ts`.

These are ESLint rules, not conventions — see `eslint.config.mjs`. A violation
fails `npm run verify`. Verified by probe: importing `@/server/config/env` from
a component produces two lint errors.

## Layers

| Layer | Path | May depend on | Never depends on |
|---|---|---|---|
| Domain | `src/server/domain` | nothing | Prisma, Next, React, config |
| Integrations | `src/server/integrations` | domain | Prisma, React |
| Repositories | `src/server/repositories` | domain, Prisma | React, HTTP |
| Services | `src/server/services` | domain, repositories | React, HTTP |
| Auth | `src/server/auth` | domain, Prisma | React, HTTP handlers |
| HTTP | `src/server/http`, `src/app/api` | services, auth, domain | Prisma directly |
| UI | `src/components`, `src/features` | `/api/v1` over fetch | anything in `src/server` |

## Authorisation

Every endpoint is built by `getHandler(permission, schema, handle)`. The
permission is a **required argument**, so a new endpoint cannot ship
unprotected by forgetting a middleware line — there is no code path that skips
the check.

The handler receives a `Principal` and a `scope`. Route handlers spread the
scope **after** the parsed query:

```ts
{ ...ctx.query, ...ctx.scope }
```

That ordering is the whole mechanism: a `SALES` caller passing
`?employeeIds=<someone-else>` still has their own restriction applied on top,
and the repository ANDs both clauses. Scope is a WHERE clause, never a filter
applied after loading.

An unlinked `SALES` account fails **closed** — `dealScopeFor` returns a
sentinel that matches no row, rather than an empty scope that would show the
whole company.

The edge middleware only checks for the *presence* of a session cookie so a
signed-out visitor is redirected instead of watching a shell flash. It is not
the boundary: it does not verify the cookie, and a forged one simply collects
401s from every endpoint.

## Key decisions

### Money is BigInt minor units

Not float, not `Decimal`. Every amount is an integer count of the currency's
smallest unit, and the field name ends in `Minor`.

Floating point cannot represent `0.1` exactly. Summing thousands of deal
amounts as floats accumulates visible error, and a sales dashboard that
disagrees with accounting is worthless. Integers stay exact through SQL `SUM`
and port across database engines. Conversion to a display number happens once,
at the API edge, and never feeds back into a calculation.

`toMajorNumber` throws rather than silently losing precision above
`Number.MAX_SAFE_INTEGER`.

### Undefined results are modelled, not faked

Growth against a zero baseline returns `{ kind: 'no_baseline' }`, not
`+Infinity%` and not an invented `+100%`. A conversion rate over zero resolved
deals returns `null`, not `0%`. `null` (no data) and `0` (a real measurement)
are kept distinct all the way to the UI.

These are the errors that make dashboards quietly lie, so they are pinned by
tests before anything is built on top of them.

### Periods are half-open, in a fixed timezone

`[start, end)`. The end instant is excluded. The common alternative — an
inclusive end at `23:59:59.999` — drops rows in the final millisecond and
breaks against microsecond columns. Half-open intervals tile perfectly: one
period's end is the next one's start.

"This month" means **month-to-date**. On 23 August it is 1–23 August, compared
against 1–23 July. Comparing a third of a month against a whole previous month
would show a fake collapse in revenue every time someone opened the dashboard
mid-month.

All boundaries are computed in `APP_TIMEZONE` (default `Asia/Tashkent`).

### Provenance travels with the data

Every response carries `meta.dataSource`. The demo badge reads that field and
nothing else, so no screen can forget to check whether it is showing real data.

### Capability flags, not zeros

A provider declares what it can supply. The Bitrix24 provider reports
`PAYMENTS: false` because standard Bitrix24 has no payment ledger and this
business's arrangement is unknown. The API then reports payments as
*unavailable* rather than as `0 so'm outstanding`, which would be a lie.

## Directory map

```
src/
  app/            routes; api/v1 handlers stay thin
  server/
    config/       env validation, provider factory
    db/           Prisma singleton
    domain/       money, period, analytics, types  ← framework-free
    integrations/crm/
      CrmProvider.ts        the boundary
      demo/                 deterministic generator
      bitrix24/             transport done, mapping pending
      sync/                 SyncEngine
    repositories/  services/  http/  auth/  logging/
  components/     pure UI
  features/       per-domain hooks and composed views
prisma/           schema + migrations
tests/            mirrors src/server
docs/
```
