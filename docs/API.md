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
| `GET` | `/insights/pulse` | analytics | Sales velocity, run-rate forecast, cycle percentiles, win rate |
| `GET` | `/insights/flow` | analytics | Ever-reached stage conversion; stage aging and stuck deals |
| `GET` | `/insights/concentration` | `analytics:read:all` | Customer Pareto, HHI by source and region, repeat-purchase intervals |
| `GET` | `/insights/response` | `analytics:read:all` | First-call speed, attempts to connect, revenue per talk-hour |

"analytics" means either `analytics:read:all` or `analytics:read:own` — access
is the same question for both roles; how much data comes back is decided
separately by the scope.

The four `/insights/*` rows are the August 2026 indicator endpoints,
documented below. They sit alongside the older module endpoints under
`/insights/*` (cohorts, logistics, confirmations, channels, margin, calls,
dispatch, structure), whose payloads are described module-by-module in
[SUPERDASHBOARD.md](SUPERDASHBOARD.md).

**Not built yet:** `/reports/:type`, `POST /sync/run`, `GET /sync/logs`. The
`sync:run` and `sync:read` permissions exist and the engine is complete; only
the HTTP surface and admin UI are missing.

### The insight endpoints

All four take the shared analytics query parameters and return the standard
envelope. Two differences worth knowing before calling them:

- **Permissions differ.** `/insights/pulse` and `/insights/flow` are open to
  both roles and apply the caller's scope in SQL. `/insights/concentration`
  and `/insights/response` require `analytics:read:all` — they are
  company-wide reads by construction (a Pareto over only your own customers is
  not a concentration figure), so a `SALES` caller gets 403.
- **Filters are honoured unevenly, deliberately.** Pulse and flow honour
  `employeeIds`, `departmentIds` and `sourceIds` (plus the scope), and ignore
  `productIds`, `stageIds`, `status` and `q`. Concentration and response are
  period-aware only and ignore the people/source filters, like the other
  `/insights/*` endpoints. Pages that show these numbers next to filtered ones
  say so on screen.

Pulse and flow return `meta.period`, `meta.comparisonPeriod` and
`meta.comparisonTruncated`; concentration and response return `meta.period`
only — they compute no deltas, so advertising a comparison window they never
read would be a false caption.

Field names below are the exact DTO mirror in `src/lib/api.ts`.

#### `GET /insights/pulse`

```
velocity  { openDeals, openValue, winRatePercent, avgWonAmount,
            medianCycleDays, salesVelocityPerDay }
forecast  { periodToDate, elapsedPercent, projected, previousFull, delta }
cycle     { p50Days, p75Days, p90Days, wonCount }
winRate   { countPercent, valuePercent, wonCount, lostCount,
            countDelta, valueDelta }
```

`salesVelocityPerDay` = open revenue deals × win rate × average won amount ÷
median cycle days, in soʻm/day. It is **null whenever any component is null**
— the components still travel so the UI can show which leg of the formula is
missing, and the right rendering is an em dash, never a zero.

The forecast is a run rate over the **full calendar unit**, not the to-date
window: `elapsedPercent` says how much of the month (or week, or year) has
passed, `projected` is period-to-date ÷ that fraction, and `previousFull` is
the previous *complete* unit the projection is read against. `projected` is
null under 2% elapsed — a projection from the first hours of a month is
arithmetic, not information. Cycle percentiles are `closedAt −
createdAtSource` on won revenue deals — the one whole-deal duration the
data-model rules sanction.

#### `GET /insights/flow`

```
stageConversion  { basis: 'created_in_period',
                   stages: [{ stageId, stageName, pipelineName, category,
                              logisticsRole, sortOrder, dealCount,
                              conversionFromPreviousPercent }] }
aging            { stages: [{ …stage identity, openCount, openValue,
                              dwellP50Hours, dwellP90Hours,
                              historicalP50Hours, stuckCount, stuckValue }],
                   totals: { openCount, openValue, stuckCount, stuckValue } }
```

`basis` is in the payload because it is the honest denominator and captions
must repeat it: the conversion ladder counts deals **created in the period**
(revenue pipelines, ever-reached basis from `DealStageHistory`), so the UI
says "davrda yaratilgan bitimlar boʻyicha". `conversionFromPreviousPercent` is
against the previous stage of the *same* pipeline and null on each pipeline's
first stage.

Aging is a **point-in-time** reading over open revenue deals: dwell is `now −
enteredAt` of the open history row, and a deal is "stuck" when its dwell
exceeds 2× that stage's own historical median (`historicalP50Hours`, from
completed visits) — the stage judged against itself, not a global constant.

#### `GET /insights/concentration`

```
pareto  { top5SharePercent, top10SharePercent, customersFor80Percent,
          totalCustomers, nullCustomerSharePercent }
hhi     { bySource, byRegion }   each: { hhi, band, groups, nullSharePercent }
repeat  { medianDaysBetweenFirstAndSecond, p90Days, pairsMeasured,
          repurchaseWithin90Percent, cohortSize, repeatRevenueSharePercent,
          bitrixFlagSharePercent }
```

`customerId` is nullable, so the Pareto shares cover **identified customers
only** and `nullCustomerSharePercent` discloses how much of the period's
revenue was booked with no customer attached — the blind spot travels with the
figure it blinds. The HHI cuts do the same: the null source / null region
group is excluded from the index and its share reported beside it. `band`
applies the DOJ thresholds (≥2500 concentrated, ≥1500 moderate).

`repurchaseWithin90Percent` divides over first-time buyers with a **complete
90-day horizon** — the cohort is first purchases in the period shifted back 90
days, so no member is censored mid-horizon. `bitrixFlagSharePercent` is the
same repeat-revenue claim from Bitrix24's own `isReturnCustomer` flag;
divergence from `repeatRevenueSharePercent` is a data-quality signal, so the
UI shows both and reconciles neither.

#### `GET /insights/response`

```
firstTouch  { p50Minutes, p90Minutes, calledWithin15MinPercent,
              calledWithin60MinPercent, noCallSharePercent, deals }
attempts    { medianAttemptsToConnect, neverConnectedAfter5Percent, groups }
efficiency  { won: { deals, avgCalls, avgTalkSeconds },
              lost: { deals, avgCalls, avgTalkSeconds },
              revenuePerTalkHour,
              topEmployees: [{ employeeId, fullName, revenue,
                               talkHours, revenuePerTalkHour }] }
```

Two denominators keep first-touch honest. The percentiles run over deals that
**were** called — "never" is not a large number of minutes — while the 15- and
60-minute rates divide by **all** cohort deals, and `noCallSharePercent`
discloses the deals no outbound call ever reached. The first call is matched
by `dealId`, falling back to the same `customerId`, outbound only.

The won/lost effort split attributes calls by **customer over the deal's
lifetime** (`createdAtSource` → `closedAt`), not by `dealId`: of ~300k call
records exactly one carries a `dealId`, so a deal-keyed join would report
"0 calls" for every deal — a claim of no effort where the truth is no linkage.
Deals without a customer link are excluded from the averages rather than
rendered as zeros; a customer with two concurrent deals can have a call counted
against both, which the UI caption discloses.

`revenuePerTalkHour` is period revenue over *connected* talk time — dialling
is not conversation — and is **null under one connected talk-hour**: a ratio
over minutes of talk is noise wearing a currency, so the API withholds it
rather than letting a spectacular number rest on seventy minutes. The same
one-hour floor gates `topEmployees` (max 10).

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
