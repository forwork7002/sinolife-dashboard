# API

Base path `/api/v1`. JSON only. **Every endpoint requires authentication.**

## Authentication

better-auth, email + password, session cookie. Endpoints live under
`/api/auth/*` (`sign-in/email`, `sign-out`, `get-session`).

Public sign-up is **disabled**. Accounts are provisioned server-side via
`provisionUser()`; see `prisma/seedUsers.ts`.

Two details that are easy to get wrong and were:

- The session cookie prefix is declared once, in
  `src/server/auth/cookiePrefix.ts`, and used by both the auth config and the
  edge middleware. When the two drifted, the middleware looked for a cookie
  that did not exist and redirected every signed-in user back to `/login`
  while the API happily accepted the same session.
- `Secure` cookies follow the **URL scheme** (`BETTER_AUTH_URL`), not
  `NODE_ENV`. `next start` sets `NODE_ENV=production` even on
  `http://localhost`, which would issue a `Secure` cookie the browser then
  refuses to send back — sign-in returns 200 and every later request is
  silently unauthenticated.

### Roles

| Role | Scope |
|---|---|
| `ADMIN` | Everything, including sync and user management |
| `MANAGER` | All analytics and all employees; no admin operations |
| `SALES` | Own deals and own KPI only; no finance |

`SALES` scoping is applied as a WHERE clause in the repository, so it cannot be
bypassed by calling the API directly. Route handlers spread the authorisation
scope **after** the parsed query, so `?employeeIds=<someone-else>` narrows
within the caller's scope rather than widening it.

A resource the caller may not see returns **404, not 403** — a 403 would
confirm the record exists, which is itself a disclosure.

## Envelope

Every response has one of exactly two shapes.

**Success**

```jsonc
{
  "data": { /* endpoint-specific */ },
  "meta": {
    "dataSource": "DEMO",
    "generatedAt": "2026-08-23T09:30:00.000Z",
    "period":            { "preset": "this_month", "start": "...", "end": "...", "timeZone": "Asia/Tashkent", "days": 23 },
    "comparisonPeriod":  { "preset": "this_month", "start": "...", "end": "...", "timeZone": "Asia/Tashkent", "days": 23 },
    "comparisonTruncated": false,
    "unavailable": ["PAYMENTS"]
  }
}
```

**Error**

```jsonc
{
  "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "path": "pageSize", "message": "Too big" }] },
  "meta": { "dataSource": "DEMO", "generatedAt": "…", "correlationId": "…" }
}
```

Three deliberate properties:

- **`meta.dataSource` is on every response**, success and error alike. The demo
  badge reads it, so no screen can forget to check provenance.
- **Stack traces never cross the wire.** The cause is logged against
  `correlationId`; a stack trace would disclose the ORM, schema and file layout.
- **`meta.unavailable`** lists entities the active provider cannot supply, so
  the UI renders "not connected" instead of a confident `0`.

### BigInt on the wire

Money is BigInt server-side, serialised as a **decimal string** so JSON keeps
it exact:

```json
{ "amountMinor": "34000000000", "currency": "UZS", "amount": 340000000 }
```

`amount` is a lossy convenience for charts and sorting. Never compute with it.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad query or body; see `details` |
| `UNAUTHENTICATED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | No such record, or not visible to this role |
| `CONFLICT` | 409 | Concurrent modification |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTEGRATION_PENDING` | 501 | Feature works, data source not connected |
| `DATA_SOURCE_UNAVAILABLE` | 503 | Upstream CRM unreachable |
| `INTERNAL_ERROR` | 500 | Unexpected; quote `correlationId` |

`INTEGRATION_PENDING` is separate from `INTERNAL_ERROR` on purpose: nothing is
broken, the data simply is not connected yet.

## Shared query parameters

Accepted by every analytics endpoint.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `preset` | `today \| yesterday \| this_week \| this_month \| previous_month \| this_year \| custom` | `this_month` | |
| `from`, `to` | `YYYY-MM-DD` | — | Required for `custom`. `to` is inclusive |
| `compare` | `true \| false` | `true` | Compute previous-equivalent deltas |
| `employeeIds` | csv | — | Max 200 |
| `departmentIds`, `stageIds`, `productIds`, `sourceIds` | csv | — | |
| `status` | `OPEN \| WON \| LOST` | — | |
| `q` | string | — | Free text, 1–120 chars |

Pagination, on list endpoints:

| Parameter | Default | Bounds |
|---|---|---|
| `page` | 1 | 1–10000 |
| `pageSize` | 25 | **1–200** |
| `sort` | `createdAtSource` | allowlist: `createdAtSource`, `closedAt`, `amountMinor`, `title`, `status` |
| `order` | `desc` | `asc \| desc` |

`pageSize` is capped and `sort` is an allowlist, not a passthrough — an
unbounded page size is a denial-of-service and an arbitrary sort column is an
information leak. Filtering and pagination execute in SQL.

### Period semantics

`this_week`, `this_month` and `this_year` mean **to-date**. On 23 August,
`this_month` is 1–23 August and its comparison is 1–23 July.

Where the comparison cannot match exactly — the whole of March has no 31-day
counterpart in February — it is capped at the shorter month and
`meta.comparisonTruncated` is `true`.

## Endpoints

| Method | Path | Permission | Returns |
|---|---|---|---|
| `GET` | `/dashboard/overview` | analytics | KPI cards, deltas, trend, KPI attainment |
| `GET` | `/analytics/sales` | analytics | Revenue trend, sources, products, summary |
| `GET` | `/analytics/employees` | analytics | Per-employee performance + KPI |
| `GET` | `/analytics/leaderboard` | `leaderboard:read` | Ranking; `metric=revenue\|deals_won\|conversion\|kpi_achievement` |
| `GET` | `/analytics/products` | analytics | Product revenue, units, share, delta |
| `GET` | `/analytics/sources` | analytics | Revenue and conversion by lead source |
| `GET` | `/analytics/funnel` | analytics | Stage distribution for the period cohort |
| `GET` | `/employees/:id` | `employees:read` | Drill-down: metrics, trend, team comparison |
| `GET` | `/deals` | deals | Paginated, filtered, sorted deals |
| `GET` | `/deals/:id` | deals | Line items, payments, settlement |
| `GET` | `/kpi` | kpi | Targets, attainment, pace-aware status |
| `GET` | `/finance/overview` | `finance:read` | Invoiced/collected/outstanding, ageing, debtors |
| `GET` | `/meta/filters` | `employees:read` | Filter dropdown options |

"analytics" means either `analytics:read:all` or `analytics:read:own` — access
is the same question for both roles; how much data comes back is decided
separately by the scope.

**Not built yet:** `/reports/:type`, `POST /sync/run`, `GET /sync/logs`. The
`sync:run` and `sync:read` permissions exist and the engine is complete; only
the HTTP surface and admin UI are missing.

### Leaderboard ranks by one metric

`metric` selects a single measure. There is deliberately no blended "score":
the weights would be arbitrary, nobody could explain their position, and the
ranking would stop being actionable.

Ties share a rank, competition style (1, 2, 2, 4). Employees with no measurable
value sort **last** regardless of direction — "no data" is not an achievement.

The leaderboard is company-wide for every role, `SALES` included: a ranking
each person can only see themselves in is not a ranking. Only aggregate
per-employee figures are exposed; no individual deals.

### Finance is capability-gated

`/finance/overview` returns **501 `INTEGRATION_PENDING`** when the active
provider does not supply payments. The demo provider does; the Bitrix24
provider deliberately does not, because whether that portal exposes a payment
ledger is an open question (see [BITRIX24.md](BITRIX24.md) §7).

A page of zeros would tell a finance team nothing is outstanding. That is a
different claim from "we cannot see what is outstanding", and only one of them
is true.
