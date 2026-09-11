# API

Base path `/api/v1`. JSON only. **Every endpoint requires authentication.**

## Authentication

better-auth, email + password, session cookie, optional TOTP second factor.
Endpoints live under `/api/auth/*` (`sign-in/email`, `sign-out`,
`get-session`, `change-password`, `two-factor/*`).

Public sign-up is **disabled**. Accounts are provisioned server-side via
`provisionUser()`; see `prisma/seedUsers.ts`.

> `/api/auth/*` speaks **better-auth's** response shape — `{ "message": …,
> "code": … }` on error — not the `{ data, meta }` envelope below. The envelope
> is the `/api/v1` contract; the auth routes are the library's and are
> documented here as they actually answer.

The full rationale for every rule in this section — and an equally explicit
list of what is *not* protected — is in [SECURITY.md](SECURITY.md).

### Signing in

`POST /api/auth/sign-in/email` with `{ email, password }`. Three outcomes:

| Outcome | Response |
|---|---|
| Correct, 2FA off | 200, session cookie set |
| Correct, 2FA armed | **200 with `{ "twoFactorRedirect": true }` and no session.** The password was right and the sign-in is not finished |
| Wrong password, unknown address, or no credential | 401. Deliberately the same answer for all three — which address exists is not disclosed |
| Locked out | **429**, code `ACCOUNT_LOCKED_OUT`, with the remaining minutes in the message |

`twoFactorRedirect` is a flag, not a redirect: the client plugin is configured
without `twoFactorPage` and without `onTwoFactorRedirect`, so nothing navigates
and the login form swaps its own fields for a code prompt, keeping the
in-flight state and the `?next=` target it already holds.

Finish with **one** of:

- `POST /api/auth/two-factor/verify-totp` — `{ code, trustDevice? }`
- `POST /api/auth/two-factor/verify-backup-code` — `{ code }`, single use

### Arming the second factor

Two steps, and the gap between them is the point: the backup codes are in the
owner's hands before anything is armed, so an abandoned setup leaves the
account signing in exactly as it did.

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/auth/two-factor/enable` | `{ password }` | Returns `totpURI` **and ten backup codes**. Creates an *unverified* `two_factor` row. Changes nothing about sign-in |
| `POST /api/auth/two-factor/verify-totp` | `{ code }` | First correct code flips `user.twoFactorEnabled`. Only now is 2FA real |
| `POST /api/auth/two-factor/disable` | `{ password }` | Turns it off. The password is required, so a stolen session alone cannot remove the factor |

`twoFactorEnabled` is exposed on the session user for rendering only. It is
contributed by the plugin's own schema with `input: false`, so no request body
can set it.

### Lockout and rate limits

| Route | Budget |
|---|---|
| `/api/auth/*` | 200 / minute |
| `/sign-in/email` | 5 / minute |
| `/forget-password` | 5 / minute — the route exists in the library; **no mail sender is configured**, so it sends nothing |
| `/two-factor/*` | 3 / 10 seconds |

On top of the throttle, a **per-account lockout** counted in Postgres
(`sign_in_lockout`): five consecutive failures buy 15 minutes, doubling on each
further five to a one-hour ceiling, cleared by a correct password or by 24
hours of not trying. Rate limiting bounds how fast someone guesses; only the
lockout bounds how many times in total — and unlike the in-memory rate
counters, it survives a redeploy.

The row is keyed by **SHA-256 of the email**, never the email: an address with
no account has to be lockable too, or "too many attempts" would answer the
question of which addresses exist.

### Setting a password

`/sign-up/email`, `/change-password` and `/reset-password` run two checks
before better-auth hashes anything:

1. The house policy (`src/lib/passwordPolicy.ts`) — 12+ characters, 3 of 4
   character classes, no banned fragment, no keyboard run, not the email or the
   name. Returns 400 with every failed rule, not just the first.
2. A breach check against Have I Been Pwned — `PASSWORD_COMPROMISED` if the
   password is in a public dump. It sends a five-character hash prefix, never
   the password, and **fails open**: a network failure lets the change through
   rather than blocking the one action a worried owner needs.

A successful change revokes every **other** session immediately
(`revokeSessionsOnPasswordReset`).

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
| `ACCOUNT_LOCKED_OUT` | 429 | Sign-in only, and on `/api/auth/*` rather than in this envelope. The failure budget for this address is spent; the message says for how long |
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

**Twenty endpoints, and this is the whole list.** Fifteen more were deleted on
2026-09-10 — every endpoint no screen in `src/features` had called since the
product narrowed to the sections the client asked for. `find src/app/api/v1
-name route.ts` is the authority if this table ever drifts again.

| Method | Path | Permission | Returns |
|---|---|---|---|
| `GET` | `/analytics/sellers` | `leaderboard:read` | The sellers' and teams' board on the FAKT 1 / FAKT 2 basis. **Company-wide for every caller, on purpose** |
| `GET` | `/kpi` | kpi | Targets, attainment, pace-aware status |
| `GET` | `/insights/cohorts` | `analytics:read:all` | Return-rate ladder by first-purchase cohort |
| `GET` | `/insights/concentration` | `analytics:read:all` | Customer Pareto, HHI by source and region, repeat-purchase intervals |
| `GET` | `/insights/confirmations/orders` | `analytics:read:all` | The confirmation queue as orders, paginated |
| `GET` | `/insights/confirmations/regions` | `analytics:read:all` | The РЕГИОН column filter's options, cut from the same cohort |
| `GET` | `/insights/delivery` | analytics | The Доставка kanban — what is standing where, right now. **No window** |
| `GET` | `/insights/dispatch` | `analytics:read:all` | Per-dispatch-point orders, delivery rate, revenue |
| `GET` | `/insights/logistics` | `analytics:read:all` | The client’s logistics sheet: six columns over the Доставка funnel, daily rows, post offices, regions, all eighteen stages verbatim and the refusal reasons. Cohorted on the arrival in `C4:NEW`, so ЗАКАЗ is FAKT 1 and Успешно is FAKT 2 |
| `GET` | `/insights/margin` | `analytics:read:all` | Gross margin per product and its coverage |
| `GET` | `/insights/structure` | `employees:read` | The org chart. **Dateless, and no money on it** |
| `GET` | `/insights/structure/roster` | `employees:read` | One unit's members |
| `GET` | `/marketing/overview` | `analytics:read:all` | Roistat spend, leads and return |
| `GET` | `/marketing/breakdown` | `analytics:read:all` | The same ledger cut by campaign / ad set / creative |
| `GET` | `/marketing/verify` | `analytics:read:all` | Roistat's own totals against ours, for reconciliation |
| `GET` | `/meta/filters` | `employees:read` | Filter dropdown options |
| `GET` | `/meta/alerts` | none (section `null`) | Freshness and the header's bell |
| `GET` | `/search` | none (section `null`) | ⌘K — every group section-gated, every row scope-narrowed |
| `GET`/`POST` | `/users` | `users:manage` | Account administration |
| `GET`/`PATCH`/`DELETE` | `/users/:id` | `users:manage` | One account |

The three `/marketing/*` routes still answer, but **nothing calls them**: the
screen was paused on 2026-09-10 and renders `shared/SectionPending` instead. The
same is true of `/insights/dispatch`. Both are held rather than removed, so
switching either screen back on needs no server work.

"analytics" means either `analytics:read:all` or `analytics:read:own` — access
is the same question for both roles; how much data comes back is decided
separately by the scope.

**`analytics:read:all` on its own is a refusal, not a wider answer.** Only an
account whose `dataScope` is `ALL` holds it, so an endpoint that names it alone
is saying "I cannot narrow my rows — refuse a ROP rather than hand them the
company's". Endpoints that CAN narrow name the pair and apply `ctx.scope` in
SQL. `tests/http/routeAccess.test.ts` pins which endpoints are in which set, so
widening a permission without threading the scope fails the gate.

`/insights/concentration` is the one August 2026 indicator endpoint left;
`pulse`, `flow` and `response` went with the screens that read them. The rest of
`/insights/*` are the module endpoints — cohorts, logistics, confirmations,
margin, dispatch, structure — whose payloads are described module-by-module in
[SUPERDASHBOARD.md](SUPERDASHBOARD.md).

**Not built yet:** `/reports/:type`, `POST /sync/run`, `GET /sync/logs`. The
`sync:run` and `sync:read` permissions exist and the engine is complete; only
the HTTP surface and admin UI are missing.

### The insight endpoints

`/insights/concentration` requires `analytics:read:all` — it is a company-wide
read by construction (a Pareto over only your own customers is not a
concentration figure), so a `SALES` caller gets 403. It is period-aware only and
ignores the people and source filters, like the other `/insights/*` endpoints;
pages that show these numbers next to filtered ones say so on screen. It returns
`meta.period` and nothing else, because it computes no deltas and advertising a
comparison window it never reads would be a false caption.

Field names below are the exact DTO mirror in `src/lib/api.ts`.

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
