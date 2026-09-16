# Mijozlar va qoʻngʻiroqlar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `/customers` section — «Mijozlar va qoʻngʻiroqlar» — carrying a full telephony block on the dashboard window and the already-built customer-flow band on its own ninety days, plus the база / not-база split and the importer fix that stops call durations being truncated.

**Architecture:** One new endpoint (`/api/v1/insights/calls`) over three statements in `InsightsRepository`, memoised in `InsightsService` the way `customerFlow` already is. One new client-safe module (`src/lib/callQuality.ts`) owns the data floor and the duration bands so the SQL's `CASE` and the screen's labels are built from one table. The customer half is **not rewritten** — `/insights/customers` already works end to end on this branch; it changes `section` and is mounted on the new page instead of on `CohortPage`. The importer fix is one unconditional lookback table in `SyncEngine`.

**Tech Stack:** Next.js App Router (see `AGENTS.md` — read `node_modules/next/dist/docs/` before writing route code), TypeScript, Prisma 7 (`$queryRawUnsafe` for every statement here), PostgreSQL 16, TanStack Query, recharts, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-16-mijozlar-va-qongiroqlar-design.md`

**Worktree:** `/home/smack/Work/ISH-oqim`, branch `mijozlar-oqimi`. Run every command from that directory — `vitest.config.mts` resolves `tests/**` and the `@` alias from `process.cwd()`, so a subdirectory reports "No test files found".

## Global Constraints

- **`npm run verify` is one third of the gate.** The full gate is `npm run verify && npm run build && npm run db:check`. There is no CI and `main` has `deploy_on_push: true`. **Do not push.** Commit locally; the user pushes on «deploy qil».
- **Never `git add -A`.** Two other sessions edit this tree. Stage the exact paths each task names. `src/features/cohort/CohortPage.tsx` currently holds an uncommitted 5-line change from the previous session — Task 12 is the only task that touches it.
- **`src/lib/**` may not import `@/server/*` or Prisma** (`eslint.config.mjs`). `src/lib/callQuality.ts` is client-safe by that rule; the repository imports *from* it, never the other way.
- **Bucket dates as `("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $tz)`.** The column is naive UTC. The one-step `AT TIME ZONE 'Asia/Tashkent'` form shifts every day boundary by five hours — the probes in the spec used it, which is why Task 13 re-verifies the day series against production.
- **A rate with no denominator is `null`, never `0`** (`rateBp` / `pct` in the repository). `null` means "nobody asked"; `0` is a measurement.
- **Money is never stated on this screen.** No `MoneyDto`, no `ctx.currency` on the calls route. The customer band's `firstRevenue` / `repeatRevenue` already exist and are unchanged.
- **Scope spreads last** in every route (`{ ...ctx.query, ...ctx.scope }`) — but both endpoints here ask for `analytics:read:all`, so neither reads `ctx.scope` and `routeAccess.test.ts` requires `customers` to be named in `COMPANY_WIDE`.
- **Uzbek UI, Latin script.** Labels go in `src/lib/messages.ts` (`nav`, `modules`) or in the module that owns the business definition. Russian appears only where it is the portal's own verbatim vocabulary.
- **Every card gets loading, error and empty states.** Three renderings, not one em dash — `StatTile`'s `status` prop and `CategoryBarList`'s `status` prop exist for this.

---

## ⚠ Amendment — read before Tasks 6, 7, 10, 11, 12, 13

> **Floor correction (spec §11):** `CALL_DATA_FLOOR` is **2026-09-15 00:00
> Tashkent** (`2026-09-14T19:00:00Z`), not 2026-09-13. Every measured figure a
> later task copies into a comment or a test fixture comes from spec §11.2, not
> from §2. In particular Task 11's fixture rows and Task 12's comments.

Added 2026-09-16 during execution, after Tasks 1–5 were committed. See spec §10.

«база не база **мижозларга** call duration» is a CALL cut, and the client also
kept the customer split («Ikkalasi ham»). Where this section and a task below
disagree, **this section wins**.

### A1. New Task 5b — `callActivity` gains a side (between Tasks 5 and 6)

**Files:** `src/lib/callQuality.ts`, `src/server/repositories/insightsRepository.ts`,
`tests/domain/callQuality.test.ts`, `tests/http/callActivitySql.test.ts`.

1. Add to `src/lib/callQuality.ts`:

```ts
/**
 * Which side of the base a call landed on — decided at the moment of the call.
 *
 * «Baza» means the customer had a База deal created BEFORE the call started.
 * Membership TODAY would move 376 calls (~9% of the База side, measured above
 * the floor) across: a lead rung on Monday who buys on Friday enters База
 * afterwards, and "today" would retroactively make Monday's call a База call.
 *
 * Colours are unique within the card that draws them — this screen carries
 * eleven categorical entities and the palette has eight tokens, one of them the
 * red reserved for «Yoʻqotilgan». `--ink-muted` for the unlinked side, because
 * it is not a kind of customer.
 */
export const CALL_SIDES = [
  { key: 'BAZA', label: 'Baza mijozi', colour: '--series-1' },
  { key: 'NOT_BAZA', label: 'Baza emas', colour: '--series-2' },
  { key: 'UNLINKED', label: 'Mijozga bogʻlanmagan', colour: '--ink-muted' },
] as const satisfies readonly { key: string; label: string; colour: string }[]

export type CallSideKey = (typeof CALL_SIDES)[number]['key']
```

   and a test: three sides, keys exactly `['BAZA', 'NOT_BAZA', 'UNLINKED']`, colours unique.

2. Tests first — amend `tests/http/callActivitySql.test.ts`:
   * the grouping-sets case now expects
     `GROUPING SETS ((employee_id), (team), (day), (side), (day, side), ())`;
   * **new:** `first_baza` reads `p."role" = 'RETENTION'`, never a category id;
   * **new:** the side compares `f.first_at <= s.started_at` — before the call, not today;
   * **new:** `first_baza` is bounded to the customers called in the window
     (`IN (SELECT customer_id FROM called)`), so it does not scan every База deal ever;
   * the backtick guard stays.

3. SQL changes inside `callActivity`:

```sql
      WITH scoped AS (
        SELECT
          r."employeeId"  AS employee_id,
          r."customerId"  AS customer_id,
          r."durationSec" AS duration_sec,
          r."connected"   AS connected,
          r."startedAt"   AS started_at,
          (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day
        FROM "call_record" r
        WHERE r."startedAt" >= $1 AND r."startedAt" < $2
      ),
      called AS (
        SELECT DISTINCT customer_id FROM scoped WHERE customer_id IS NOT NULL
      ),
      first_baza AS (
        SELECT d."customerId" AS customer_id, min(d."createdAtSource") AS first_at
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId"
        WHERE p."role" = 'RETENTION'
          AND d."customerId" IN (SELECT customer_id FROM called)
        GROUP BY d."customerId"
      ),
      labelled AS (
        SELECT
          s.*,
          e."fullName" AS employee_name,
          COALESCE(...unchanged...) AS team,
          CASE
            WHEN s.customer_id IS NULL THEN 'UNLINKED'
            WHEN f.first_at IS NOT NULL AND f.first_at <= s.started_at THEN 'BAZA'
            ELSE 'NOT_BAZA'
          END AS side
        FROM scoped s
        LEFT JOIN "employee" e ON e."id" = s.employee_id
        LEFT JOIN "department" dp ON dp."id" = e."departmentId"
        LEFT JOIN first_baza f ON f.customer_id = s.customer_id
      )
      SELECT
        GROUPING(employee_id)::int AS g_employee,
        GROUPING(team)::int        AS g_team,
        GROUPING(day)::int         AS g_day,
        GROUPING(side)::int        AS g_side,
        employee_id, min(employee_name) AS employee_name, team, day, side,
        ...measures unchanged...
      FROM labelled
      GROUP BY GROUPING SETS ((employee_id), (team), (day), (side), (day, side), ())
      ORDER BY g_employee, g_team, g_day, g_side, talk_sec DESC
```

   Arm identification — **every arm now names all four flags**, or `(day, side)`
   rows leak into the day series:

   | Arm | Flags |
   |---|---|
   | total | all four = 1 |
   | operators | `g_employee = 0` |
   | teams | `g_team = 0` |
   | series | `g_day = 0 && g_side = 1` |
   | sides | `g_side = 0 && g_day = 1` |
   | seriesBySide | `g_day = 0 && g_side = 0` |

   `CallActivityRows` gains:

```ts
  /** In CALL_SIDES order, all three present even when empty. */
  readonly sides: readonly CallActivityRow[]
  /** One row per (day, side) that carries calls. */
  readonly seriesBySide: readonly { readonly day: string; readonly side: CallSideKey; readonly talkSec: number }[]
```

   `sides` is built by mapping `CALL_SIDES` and filling an absent side with the
   empty row — a GROUP BY never emits an empty group, and a split missing its
   quiet side reads as a split with one side.

   Why reading RETENTION here does not breach `35aca08`: that decision protects
   the **stage partition** of База, which `retentionStages()` owns. This reads
   one timestamp per customer — when they entered База — which no other
   statement answers. Say so in the SQL comment (no backticks).

4. Run the method against the local schema (`probe-calls-repo-local.ts`), then
   `npm run verify`, then commit.

### A2. Task 6 is REPLACED — `customerBaseSplit()`, not a CTE on `customerStates`

**Do not touch `customerStates()` or `tests/http/customerStatesSql.test.ts`.**
That test's case «no longer reads the retention funnel at all» is a decision from
commit `35aca08`, and it stays true.

**Files:** `src/server/repositories/insightsRepository.ts`,
create `tests/http/customerBaseSplitSql.test.ts`.

```ts
  async customerBaseSplit(): Promise<{
    readonly customers: number
    readonly inBase: number
    readonly notInBase: number
  }>
```

```sql
      WITH cust AS (
        SELECT DISTINCT d."customerId" AS cid
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
      ),
      based AS (
        SELECT DISTINCT d."customerId" AS cid
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId"
        WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
      )
      SELECT
        count(*)::bigint AS customers,
        count(*) FILTER (WHERE b.cid IS NOT NULL)::bigint AS in_base,
        count(*) FILTER (WHERE b.cid IS NULL)::bigint AS not_in_base
      FROM cust c
      LEFT JOIN based b ON b.cid = c.cid
```

One pass over the buyer set, so the halves sum to `customers` by construction.
`cust` is the SAME CTE `customerStates` uses, so `customers` here equals
`states.customers` — Task 13 checks it. **No `countsAsRevenue` on `based`**:
RETENTION is precisely the role that does not count, and filtering on it empties
the CTE.

The doc comment must state the measured caveat: of 11 607 customers with a WON
order, 11 586 (99.8%) are in База, because the portal places every delivered
customer there automatically — so «Bazada yoʻq» is overwhelmingly customers
whose order was never delivered.

Test (`tests/http/customerBaseSplitSql.test.ts`, same extraction helper as the
other SQL tests): no backtick; RETENTION by role; `countsAsRevenue` on `cust`
and absent from `based`; a `LEFT JOIN` partition (`FILTER (WHERE b.cid IS NOT
NULL)` and `IS NULL`); no `deal_stage` (this is membership, not the stage
partition).

### A3. Task 7 additions

* `src/lib/api.ts` and the server-side mirror:

```ts
export interface CallSideSeriesPointDto {
  readonly day: string
  /** Seconds per side; every side present, zero when silent. */
  readonly talkSec: Readonly<Record<'BAZA' | 'NOT_BAZA' | 'UNLINKED', number>>
}
```

  `CallActivityDto` gains `sides: readonly CallRowDto[]` and
  `seriesBySide: readonly CallSideSeriesPointDto[]` (pivoted in the service, one
  point per day, ascending). `CustomerFlowDto['states']` gains `inBase` and
  `notInBase`.
* Service: `customerBaseCache` beside `customerStatesCache`, keyed `'base'` (a
  fact about today, like the states), added to `customerFlow`'s `Promise.all`.
  Row labels for `sides` come from `CALL_SIDES`.

### A4. Task 10 — `CallTalkChart` draws stacked areas by side

Props become `{ data: readonly CallSideSeriesPointDto[]; height?: number }`.
One `<Area stackId="talk">` per `CALL_SIDES` entry, in that order, hours on one
axis. **The stack top equals the «Suhbat vaqti» tile**, which is why the unlinked
side is drawn rather than dropped: without it the stack falls 12.5% short of the
tile beside it. Tooltip lists all three sides and their total.

### A5. Task 12 additions

* `CallActivitySection`: directly under the five tiles, a `ChartCard`
  «Baza va baza emas mijozlar» rendering `CallRowTable` over `sides` with
  `headLabel="Mijoz turi"`. Its hint states the definition — «qoʻngʻiroq
  paytida bazada boʻlgan mijoz» — because «bazada» alone reads as today.
* `CustomerFlowSection`: the «Mijozlar holati — bugun» card gains «Bazada» and
  «Bazada yoʻq» rows under the three state rows, separated by a rule, with the
  hint «Yetkazilgan har bir mijoz bazaga avtomatik tushadi — «Bazada yoʻq»
  asosan buyurtmasi yetkazilmagan mijozlar».

### A6. Task 13 — three more invariants

6. `sum(sides[].calls) = total.calls`
7. `sum over seriesBySide of every side's talkSec = total.talkSec`
8. `customerBaseSplit().customers = customerStates().customers`

---

## File Structure

**Create:**
- `src/lib/callQuality.ts` — the data floor, the six duration bands, the four customer bands. Read by the repository and the screen.
- `src/app/api/v1/insights/calls/route.ts` — the endpoint.
- `src/app/customers/page.tsx` — the thin shell.
- `src/features/customers/CustomersPage.tsx` — the two queries and the band layout.
- `src/features/customers/CallActivitySection.tsx` — band A, on the dashboard window.
- `src/features/customers/CustomerFlowSection.tsx` — band B, on its own ninety days.
- `src/features/customers/CallRowTable.tsx` — the ranked table, rendered twice (operators, teams).
- `src/components/charts/CallTalkChart.tsx` — one line, connected talk hours per day.
- `tests/domain/callQuality.test.ts`, `tests/domain/durationFormat.test.ts`
- `tests/http/callActivitySql.test.ts`
- `tests/features/callActivityBlock.test.tsx`

**Modify:**
- `src/server/repositories/insightsRepository.ts` — three new methods; one CTE added to `customerStates`.
- `src/server/services/insightsService.ts` — `callActivity`, three caches, the `CustomerStatesDto` base split.
- `src/lib/api.ts` — the new DTOs, plus `inBase` / `notInBase` on the customer-flow states.
- `src/lib/format.ts` — `formatDuration`.
- `src/components/ui/Stat.tsx` — a `'duration'` unit on `StatValue` and `StatTile`.
- `src/server/integrations/crm/sync/SyncEngine.ts` — `SETTLE_LOOKBACK_MS`.
- `src/lib/sections.ts`, `src/lib/roles.ts`, `src/lib/messages.ts` — register the section.
- `src/app/api/v1/insights/customers/route.ts` — `section: 'cohort'` → `'customers'`.
- `src/features/cohort/CohortPage.tsx` — drop the two unused imports.
- `tests/http/customerStatesSql.test.ts`, `tests/integrations/syncEngine.test.ts`
- `CLAUDE.md`, `docs/SUPERDASHBOARD.md`, `docs/API.md`

---

### Task 1: `src/lib/callQuality.ts` — the floor and the bands

**Files:**
- Create: `src/lib/callQuality.ts`
- Test: `tests/domain/callQuality.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CALL_DATA_FLOOR: Date`; `CALL_DURATION_BANDS: readonly CallDurationBand[]` where `CallDurationBand = { key: string; maxSec: number | null; label: string; colour: string }`; `CALL_CUSTOMER_BANDS: readonly CallCustomerBand[]` where `CallCustomerBand = { key: string; maxCalls: number | null; label: string }`; `callWindowStart(start: Date): Date`; `callFloorApplied(start: Date): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/callQuality.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  CALL_CUSTOMER_BANDS,
  CALL_DATA_FLOOR,
  CALL_DURATION_BANDS,
  callFloorApplied,
  callWindowStart,
} from '@/lib/callQuality'

/**
 * THE BANDS ARE A PARTITION, AND THE FLOOR IS A MEASURED DATE.
 *
 * `logisticsBuckets.test.ts` is the shape this follows: the business
 * definition has one home and this file is where the definition itself is
 * checked, rather than the SQL built from it. A band added with an overlapping
 * bound would produce a distribution whose shares sum past 100% — a plausible
 * table rather than an error.
 */
describe('the call duration bands', () => {
  it('covers every non-negative duration exactly once', () => {
    expect(CALL_DURATION_BANDS).toHaveLength(6)

    // Ascending, with the open-ended band last and only there.
    const bounds = CALL_DURATION_BANDS.map((band) => band.maxSec)
    expect(bounds[bounds.length - 1]).toBeNull()
    expect(bounds.slice(0, -1)).toEqual([10, 30, 60, 180, 600])

    // No duration falls through, and none matches twice. 0 is a real value —
    // 18 connected calls above the floor carry it.
    for (const seconds of [0, 9, 10, 29, 30, 59, 60, 179, 180, 599, 600, 3600]) {
      const matches = CALL_DURATION_BANDS.filter(
        (band, i) =>
          seconds >= (i === 0 ? 0 : (CALL_DURATION_BANDS[i - 1]!.maxSec ?? 0)) &&
          (band.maxSec === null || seconds < band.maxSec),
      )
      expect(matches, `${seconds}s`).toHaveLength(1)
    }
  })

  it('gives every band its own palette token, none of them the page accent', () => {
    const colours = CALL_DURATION_BANDS.map((band) => band.colour)
    expect(new Set(colours).size).toBe(colours.length)
    for (const colour of colours) expect(colour).toMatch(/^--series-\d$/)
  })
})

describe('the customer call bands', () => {
  it('is 1 / 2-3 / 4-5 / 6+, open-ended last', () => {
    expect(CALL_CUSTOMER_BANDS.map((band) => band.maxCalls)).toEqual([1, 3, 5, null])
  })
})

describe('the data floor', () => {
  /*
    2026-09-13 is where the truncated window ends — see the spec §4. Written
    as a Tashkent midnight, because that is the day boundary every other
    figure in this product uses.
  */
  it('is 2026-09-13 Tashkent midnight', () => {
    expect(CALL_DATA_FLOOR.toISOString()).toBe('2026-09-12T19:00:00.000Z')
  })

  it('clamps a window that starts below it, and leaves one above it alone', () => {
    const below = new Date('2026-08-01T00:00:00.000Z')
    const above = new Date('2026-09-20T00:00:00.000Z')

    expect(callWindowStart(below)).toEqual(CALL_DATA_FLOOR)
    expect(callFloorApplied(below)).toBe(true)

    expect(callWindowStart(above)).toEqual(above)
    expect(callFloorApplied(above)).toBe(false)
  })

  it('does not report the floor as applied when the window starts exactly on it', () => {
    // A reader asking for the first honest day is not being given less than
    // they asked for, so the screen must not print the caveat.
    expect(callFloorApplied(CALL_DATA_FLOOR)).toBe(false)
    expect(callWindowStart(CALL_DATA_FLOOR)).toEqual(CALL_DATA_FLOOR)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/callQuality.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/callQuality"`.

- [ ] **Step 3: Write the module**

Create `src/lib/callQuality.ts`:

```ts
/**
 * What the telephony data can honestly be asked, and how a call's length is
 * banded.
 *
 * WHY A DATA FLOOR EXISTS, AND WHY IT IS A DATE RATHER THAN A FILTER ON THE
 * ROW. Every call imported between 2026-08-28 and 2026-09-12 carries a
 * duration that had not finished happening. The per-minute incremental pass
 * read `voximplant.statistic.get` from its own watermark, which picks a call
 * up while it is still ringing or still being spoken; `CALL_DURATION` is then
 * whatever has elapsed, the watermark advances past that call's start, and the
 * row is never re-read. The symptom is a per-day ceiling of roughly one sync
 * interval — a week of 26 511 calls whose longest conversation was six minutes
 * — and a connected share of 11.6% against a normal 31%, because a leg caught
 * mid-dial has not been given its code 200 either.
 *
 * So BOTH measures are wrong in that window, not just the duration, and no
 * predicate on the row can tell a truncated call from a genuinely short one.
 * A date is the only honest discriminator. It reads correctly again from
 * 2026-09-13, when `CALLS` left the per-minute list for the half-hourly
 * reference pass (done for the portal's overload, not for this) — and
 * `SETTLE_LOOKBACK_MS` in `SyncEngine.ts` is what stops the floor ever needing
 * to move again.
 *
 * The sixteen days stay wrong in `call_record`. The client chose the floor
 * over a ~7 000-request portal re-read; correcting them later needs no code,
 * only a full CALLS pass and one edit here.
 *
 * WHY IT LIVES IN `src/lib`. Both sides read it: the repository clamps its
 * window and builds its `CASE` from the bands, and the screen draws its labels
 * and colours from the same table. A business definition must not have two
 * homes — the arrangement `logisticsBuckets.ts` and `customerStates.ts`
 * already use. `src/lib` is client-safe (no server imports).
 */

/**
 * Tashkent midnight on 2026-09-13, as a UTC instant.
 *
 * Written out rather than computed from a timezone library: this is a fact
 * about one past date, and `Asia/Tashkent` has been UTC+5 with no DST since
 * 1992. Computing it would make a constant depend on a lookup table.
 */
export const CALL_DATA_FLOOR = new Date('2026-09-12T19:00:00.000Z')

/** The lower bound a call query may actually use, whatever was asked for. */
export function callWindowStart(start: Date): Date {
  return start < CALL_DATA_FLOOR ? CALL_DATA_FLOOR : start
}

/**
 * Whether the reader is being shown less than they asked for.
 *
 * STRICTLY below, so a window starting exactly on the floor prints no caveat:
 * a reader who asked for the first honest day got the day they asked for.
 */
export function callFloorApplied(start: Date): boolean {
  return start < CALL_DATA_FLOOR
}

export interface CallDurationBand {
  readonly key: string
  /** EXCLUSIVE upper bound in seconds. `null` on the last band only. */
  readonly maxSec: number | null
  readonly label: string
  /** A CSS custom property from `globals.css`. */
  readonly colour: string
}

/**
 * Six bands, because the mean call is 3.3x the median and neither figure
 * explains the other.
 *
 * Measured above the floor: 167 s mean against a 50 s median, with 8.4% of
 * calls running past ten minutes and holding 52% of all talk time. An average
 * alone tells a ROP that a typical call runs nearly three minutes when half of
 * them end inside fifty seconds. The distribution is what makes both readable,
 * and it is what the client asked for by «call duration toʻliq malumot».
 *
 * `colour` follows the entity, never its rank (docs/DESIGN.md) — one ramp from
 * short to long, fixed per band and never reassigned by size.
 */
export const CALL_DURATION_BANDS = [
  { key: 'S0', maxSec: 10, label: '0-9 s', colour: '--series-1' },
  { key: 'S10', maxSec: 30, label: '10-29 s', colour: '--series-2' },
  { key: 'S30', maxSec: 60, label: '30-59 s', colour: '--series-3' },
  { key: 'M1', maxSec: 180, label: '1-3 daq', colour: '--series-4' },
  { key: 'M3', maxSec: 600, label: '3-10 daq', colour: '--series-5' },
  { key: 'M10', maxSec: null, label: '10+ daq', colour: '--series-6' },
] as const satisfies readonly CallDurationBand[]

export interface CallCustomerBand {
  readonly key: string
  /** INCLUSIVE upper bound in calls. `null` on the last band only. */
  readonly maxCalls: number | null
  readonly label: string
}

/**
 * How many calls one customer takes.
 *
 * INCLUSIVE bounds here, unlike the duration bands: a call count is a small
 * whole number a reader counts on their fingers, and «2-3» is the label they
 * expect to mean two or three. Measured over three days above the floor:
 * 8 323 customers called once, 2 773 two or three times, 520 four or five,
 * 301 six or more.
 */
export const CALL_CUSTOMER_BANDS = [
  { key: 'C1', maxCalls: 1, label: '1' },
  { key: 'C2', maxCalls: 3, label: '2-3' },
  { key: 'C4', maxCalls: 5, label: '4-5' },
  { key: 'C6', maxCalls: null, label: '6+' },
] as const satisfies readonly CallCustomerBand[]
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run tests/domain/callQuality.test.ts && npm run verify`
Expected: PASS, and `verify` green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/callQuality.ts tests/domain/callQuality.test.ts
git commit -m "Date the telephony we can trust, and band a call by its length

Sixteen days of call_record carry a duration that had not finished happening:
the per-minute pass read voximplant.statistic.get from its own watermark and so
picked calls up mid-conversation, and the watermark then advanced past them.
Both the duration and the connected flag are wrong in that window and no
predicate on the row can tell a truncated call from a short one, so the
discriminator is a date.

The bands exist because the mean call above the floor is 3.3x the median (167 s
against 50 s): 8.4% of calls run past ten minutes and hold 52% of all talk
time, so an average alone misdescribes a typical call. Both sides read this
module, as they read logisticsBuckets and customerStates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: A duration reads as a duration

**Files:**
- Modify: `src/lib/format.ts` (add `formatDuration`)
- Modify: `src/components/ui/Stat.tsx:177-222` (`StatValue`) and `:29-46` (`StatTile`'s `unit` union)
- Test: `tests/domain/durationFormat.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatDuration(seconds: number): string`; `StatValue`/`StatTile` accept `unit: 'duration'`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/durationFormat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { formatDuration } from '@/lib/format'

/**
 * A call length is read beside other call lengths, so the format has to sort
 * by eye. Minutes and seconds, zero-padded, with the unit named once — not
 * «167» under a header saying "seconds", which is what a raw count gives and
 * which nobody converts in their head while comparing two rows.
 */
describe('formatDuration', () => {
  it('prints under a minute as seconds', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(9)).toBe('9 s')
    expect(formatDuration(59)).toBe('59 s')
  })

  it('prints a minute and over as m:ss', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(167)).toBe('2:47')
    expect(formatDuration(514)).toBe('8:34')
    expect(formatDuration(2717)).toBe('45:17')
  })

  it('rounds to the nearest second rather than truncating', () => {
    // The mean arrives as talkSec / connected and is rarely whole.
    expect(formatDuration(59.6)).toBe('1:00')
    expect(formatDuration(0.4)).toBe('0 s')
  })

  it('never prints a negative, which would mean a bug upstream', () => {
    expect(formatDuration(-5)).toBe('0 s')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/durationFormat.test.ts`
Expected: FAIL — `formatDuration is not a function`.

- [ ] **Step 3: Add the formatter**

Append to `src/lib/format.ts`:

```ts
/**
 * A call length, as the floor reads one.
 *
 * Under a minute reads in seconds and a minute or more as `m:ss`, so a column
 * of durations sorts by eye without anybody dividing by sixty. Seconds are
 * NOT zero-padded below a minute («9 s», not «0:09») — the unit is the
 * information there, and a leading `0:` on a nine-second call reads as a
 * missing value.
 *
 * Negative input clamps to zero rather than printing a minus: a duration
 * cannot be negative, so a negative one is a bug upstream and printing it
 * would put the bug on the reader.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} s`
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
```

- [ ] **Step 4: Teach the tile the unit**

In `src/components/ui/Stat.tsx`, add `'duration'` to BOTH `unit` unions (the one on `StatTile`, line ~42, and the one on `StatValue`, line ~183), import `formatDuration` alongside the existing `format` imports, and add a case to `StatValue`'s switch immediately before `case 'count'`:

```ts
    /*
      NOT AnimatedNumber. Every other unit here counts up on first paint, and
      a duration counting from «0 s» through «0:37» to «2:47» reads as a
      stopwatch running — a figure that looks live when it is a period
      aggregate. The number is static and the tile beside it still animates.
    */
    case 'duration':
      return <>{formatDuration(value)}</>
```

- [ ] **Step 5: Run the suite**

Run: `npx vitest run tests/domain/durationFormat.test.ts && npm run verify`
Expected: PASS. `verify` green — the union widened, so no existing caller changes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/format.ts src/components/ui/Stat.tsx tests/domain/durationFormat.test.ts
git commit -m "Let a tile state a call length without the reader dividing by sixty

Additive: the unit union widens and the switch gains a case, so nothing that
already passes a unit changes. Deliberately not AnimatedNumber — a duration
counting up from 0 s reads as a stopwatch running, which is a live figure, and
this is a period aggregate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The importer stops freezing unfinished durations

**Files:**
- Modify: `src/server/integrations/crm/sync/SyncEngine.ts:79-101`
- Test: `tests/integrations/syncEngine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextWatermark(entity, startedAt, skipped)` now moves CALLS back three hours on **every** run.

- [ ] **Step 1: Write the failing test**

Append to `tests/integrations/syncEngine.test.ts` (inside the file's top-level `describe` block, or as a new one):

```ts
describe('nextWatermark — the settle lookback', () => {
  const START = new Date('2026-09-16T09:00:00.000Z')

  /*
    CALLS is the one entity whose record is not FINISHED when the portal first
    reports it. voximplant.statistic.get answers with the call's elapsed
    duration, so a pass that reads from its own watermark freezes whatever had
    happened so far and never asks again. That is not a skip — the row was
    written — so SKIP_LOOKBACK_MS cannot reach it.
  */
  it('moves CALLS back three hours although nothing was skipped', () => {
    expect(nextWatermark('CALLS', START, 0)).toEqual(
      new Date('2026-09-16T06:00:00.000Z'),
    )
  })

  it('leaves an entity with no settle lookback alone on a clean run', () => {
    expect(nextWatermark('CUSTOMERS', START, 0)).toEqual(START)
    expect(nextWatermark('DEALS', START, 0)).toEqual(START)
  })

  it('takes the LARGER lookback when both apply', () => {
    // DEALS skipping wants 95 minutes and has no settle lookback.
    expect(nextWatermark('DEALS', START, 3)).toEqual(
      new Date('2026-09-16T07:25:00.000Z'),
    )
    // CALLS skipping wants nothing extra; three hours still wins.
    expect(nextWatermark('CALLS', START, 3)).toEqual(
      new Date('2026-09-16T06:00:00.000Z'),
    )
  })

  it('cannot stall — it is always derived from THIS run start', () => {
    const later = new Date(START.getTime() + 30 * 60_000)
    expect(nextWatermark('CALLS', later, 0).getTime()).toBeGreaterThan(
      nextWatermark('CALLS', START, 0).getTime(),
    )
  })
})
```

Add `nextWatermark` to that file's existing import from `@/server/integrations/crm/sync/SyncEngine` if it is not already there.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integrations/syncEngine.test.ts -t "settle lookback"`
Expected: FAIL — the first case returns `START` unchanged.

- [ ] **Step 3: Add the table and read it**

In `src/server/integrations/crm/sync/SyncEngine.ts`, directly below `SKIP_LOOKBACK_MS` (line ~82):

```ts
/**
 * How far back an entity re-reads on EVERY run, so a record can settle.
 *
 * DIFFERENT FROM `SKIP_LOOKBACK_MS` ABOVE, AND THE DIFFERENCE IS THE WHOLE
 * POINT. That one fires after a run that dropped something, because the row we
 * wanted was not written. This one fires always, because the row WAS written
 * and was not finished: `voximplant.statistic.get` reports a call's elapsed
 * duration, so reading from the watermark picks calls up mid-conversation,
 * stores `CALL_DURATION` as whatever had happened so far, and then advances
 * past them for good.
 *
 * Measured on production: sixteen days imported that way carry a per-day
 * maximum duration of roughly one sync interval (28-360 s over a week of
 * 26 511 calls) and a connected share of 11.6% against a normal 31%, because a
 * leg caught mid-dial has not been given its code 200 yet either. See
 * `src/lib/callQuality.ts`, which dates the damage for the reader.
 *
 * THREE HOURS, NOT THIRTY MINUTES. CALLS rides the half-hourly reference pass,
 * so anything shorter than the interval leaves a call that started just before
 * a pass read exactly once. Three hours reads every call at least twice —
 * roughly 560 rows and twelve requests per pass, against a portal that has
 * refused us for overload twice this month.
 *
 * It cannot stall: the value is still derived from THIS run's start, so the
 * cursor advances by a whole tick every tick — the property the comment above
 * `SKIP_LOOKBACK_MS` says blocking on skips did not have.
 */
const SETTLE_LOOKBACK_MS: Partial<Record<SyncEntityValue, number>> = {
  CALLS: 3 * 60 * 60_000,
}
```

Then replace the body of `nextWatermark`:

```ts
export function nextWatermark(
  entity: SyncEntityValue,
  startedAt: Date,
  skipped: number,
): Date {
  const settle = SETTLE_LOOKBACK_MS[entity] ?? 0
  const skip = skipped === 0 ? 0 : (SKIP_LOOKBACK_MS[entity] ?? 0)
  // The larger of the two, not their sum: they are two reasons to re-read the
  // same stretch, and adding them would widen the window for no extra record.
  const lookback = Math.max(settle, skip)
  return lookback === 0 ? startedAt : new Date(startedAt.getTime() - lookback)
}
```

Amend the doc comment above `nextWatermark` (line ~84-92) so it no longer claims the move happens "only then":

```ts
/**
 * Where the next incremental run starts reading.
 *
 * `startedAt`, moved back by the larger of two lookbacks: this entity's
 * SKIP lookback when the run dropped anything, and its SETTLE lookback
 * always. A clean run of an entity with no settle lookback costs nothing and
 * is unchanged. It can never stall: the value is always derived from THIS
 * run's start, so it advances by a whole tick every tick however many records
 * keep being skipped or re-read.
 */
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run tests/integrations/syncEngine.test.ts && npm run verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/integrations/crm/sync/SyncEngine.ts tests/integrations/syncEngine.test.ts
git commit -m "Re-read three hours of calls every pass, so a duration can finish

voximplant.statistic.get reports a call's elapsed duration, so an incremental
pass reading from its own watermark stores whatever had happened by the moment
it asked and then advances past the call for good. Sixteen days of production
data carry a per-day ceiling of about one sync interval because of it.

This is not a skip — the row was written — so SKIP_LOOKBACK_MS could not reach
it. A second table beside it, applied unconditionally, and nextWatermark takes
the larger of the two rather than their sum. Three hours because CALLS rides
the half-hourly pass: anything shorter leaves a call that started just before a
pass read exactly once. ~560 rows and twelve requests per pass.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `InsightsRepository.callActivity()` — one statement, four arms

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` (new method; place it directly after `customerStates`)
- Test: `tests/http/callActivitySql.test.ts`

**Interfaces:**
- Consumes: `callWindowStart` from Task 1; `Period` from `@/server/domain/period/period`; the file's own `int()` helper (line ~67) and `this.tz`.
- Produces:

```ts
export interface CallActivityRow {
  readonly key: string
  readonly label: string
  readonly calls: number
  readonly connected: number
  readonly talkSec: number
  readonly medianSec: number | null
  readonly p90Sec: number | null
  readonly customers: number
}

export interface CallActivityRows {
  readonly total: CallActivityRow
  readonly operators: readonly CallActivityRow[]
  readonly teams: readonly CallActivityRow[]
  readonly series: readonly CallActivityRow[]
  readonly unlinkedCalls: number
}

// on the class:
async callActivity(options: { period: Period }): Promise<CallActivityRows>
```

- [ ] **Step 1: Write the failing test**

Create `tests/http/callActivitySql.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE CALL-ACTIVITY STATEMENT PROMISES.
 *
 * Four arms over one scan — the window's totals, per operator, per team and
 * per day — so nothing on the block can disagree with anything else on it.
 * Every arm carries the same measures for the same reason.
 *
 * This reads the source text rather than running the query, like every other
 * test in this directory: no test here touches a database, and the mistakes
 * worth catching are all visible in the SQL.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

function activitySql(): string {
  const at = SOURCE.indexOf('async callActivity(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

function code(): string {
  return activitySql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the call activity statement', () => {
  it('is one scan with four grouping sets and no more', () => {
    expect(code()).toMatch(/GROUPING SETS\s*\(\s*\(employee_id\)\s*,\s*\(team\)\s*,\s*\(day\)\s*,\s*\(\)\s*\)/i)
  })

  it('buckets the day through UTC first, never in one step', () => {
    /*
      `startedAt` is a naive UTC timestamp. The one-step form
      `AT TIME ZONE 'Asia/Tashkent'` READS the column as Tashkent local and
      returns an instant five hours off, which silently moves every call near
      midnight into the wrong day. CLAUDE.md states the two-step rule; this is
      where it is enforced for this statement.
    */
    expect(code()).toMatch(/"startedAt"\s+AT TIME ZONE 'UTC'\s+AT TIME ZONE/i)
    expect(code()).not.toMatch(/"startedAt"\s+AT TIME ZONE \$?\d*'?Asia/i)
  })

  it('names `connected` on every duration measure', () => {
    /*
      Above the floor no failed leg carries seconds, so the FILTER changes no
      number today — it states the population. Without it, the day the portal
      starts reporting ring time on a failed call, talk time silently grows.
    */
    const sql = code()
    expect(sql).toMatch(/sum\(duration_sec\)\s+FILTER \(WHERE connected\)/i)
    expect([...sql.matchAll(/FILTER \(WHERE connected\)/gi)].length).toBeGreaterThanOrEqual(4)
  })

  it('uses percentile_disc, never percentile_cont', () => {
    /*
      A duration is a whole number of seconds the portal observed.
      Interpolating between two of them invents a call that did not happen.
    */
    expect(code()).toMatch(/percentile_disc\(0\.5\)/i)
    expect(code()).toMatch(/percentile_disc\(0\.9\)/i)
    expect(code()).not.toMatch(/percentile_cont/i)
  })

  it('counts customers distinctly, never rows', () => {
    expect(code()).toMatch(/count\(DISTINCT customer_id\)/i)
  })

  it('groups the team on the employee’s PRIMARY department', () => {
    /*
      `department_member` lists one person in every unit Bitrix24 names, so
      grouping on it inflates the total and the team arm stops summing to the
      overall arm. Measured: Azizbek(ROP) reads 1 902 calls on the primary
      department and 2 847 through memberships.
    */
    expect(code()).toMatch(/"employee"[\s\S]{0,200}"departmentId"/i)
    expect(code()).not.toMatch(/department_member/i)
  })

  it('strips (ROP) but keeps a department that has no marker', () => {
    /*
      `ropOf` in sellerBoardRepository returns null without the marker.
      Applying that rule here would drop Регистрация, Операцион and NEWGEN —
      4 420 of 20 607 calls, 21.4% — into an unlabelled hole.
    */
    const sql = code()
    expect(sql).toMatch(/regexp_replace\(\s*dp\."name"/i)
    expect(sql).toMatch(/COALESCE\(/i)
  })

  it('clamps the window at the data floor rather than trusting the caller', () => {
    // The clamp is in TypeScript, not SQL — assert the method reads it.
    const body = SOURCE.slice(SOURCE.indexOf('async callActivity('))
    expect(body.slice(0, 1200)).toMatch(/callWindowStart\(/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/http/callActivitySql.test.ts`
Expected: FAIL — `expect(at).toBeGreaterThan(-1)` fails; `callActivity` does not exist.

- [ ] **Step 3: Write the method**

Add to `src/server/repositories/insightsRepository.ts`. Add `callWindowStart` to the existing `@/lib/callQuality` import (create the import line beside the `@/lib/customerStates` one). Place the method directly after `customerStates`:

```ts
  /**
   * Who spoke to customers, for how long, and how that splits four ways.
   *
   * ONE SCAN, FOUR ARMS — overall, per operator, per team, per day — because
   * every one of them is a grouping of the same rows. Asking four questions
   * would let the block's own tiles disagree with the table under them, which
   * is the failure `GROUPING SETS` exists here to make impossible. The team
   * rows and the day rows each sum to the overall row by construction, and
   * that identity is what makes the block checkable against the portal.
   *
   * THE WINDOW IS CLAMPED, NOT VALIDATED. `callWindowStart` moves a start
   * below `CALL_DATA_FLOOR` up to it; the caller is told through
   * `floorApplied` on the DTO rather than refused, because a reader who picks
   * «Shu oy» in September is asking a reasonable question about a month whose
   * first twelve days we cannot answer. Refusing would leave them with an
   * error where a shorter true answer exists.
   *
   * MEASURES THAT LOOK REDUNDANT AND ARE NOT. `calls` counts every leg and
   * `connected` counts the ones that reached somebody: a third of outbound
   * dialling connecting is ordinary here, so a block reporting only connected
   * calls would understate the work by three times. `talkSec` is summed over
   * connected legs only — above the floor no failed leg carries seconds, so
   * the FILTER changes no number today and states the population for the day
   * the portal starts reporting ring time.
   *
   * MEDIAN AND P90, NOT A MEAN. Measured above the floor: 167 s mean against
   * a 50 s median, because 8.4% of calls run past ten minutes and hold 52% of
   * all talk time. The mean is not queried at all — the screen divides
   * `talkSec` by `connected`, so the two figures cannot be rounded into
   * disagreement. `percentile_disc` rather than `_cont`: a duration is a whole
   * number of seconds somebody observed.
   *
   * DIRECTION IS NOT AN ARM. `voximplant.statistic.get` reports the LEG and
   * not the intent — 338 467 inbound against 27 833 outbound on a floor whose
   * job is ringing customers, because an operator taking a queued outbound leg
   * is recorded as receiving a call. A split by direction reads backwards, so
   * there is none.
   *
   * NO SCOPE, NO CURRENCY. `customers` is COMPANY_WIDE and the route asks for
   * `analytics:read:all`, so there is no `restrictToEmployeeIds` to thread;
   * the block states no money, so there is nothing to tag with a currency.
   * Both absences are what make the service's memo key safe — see there.
   *
   * Measured from Tashkent (which adds ~1.4 s of round trip): 1 487 ms over
   * three days and 8 063 ms over thirty. It is memoised for that reason.
   */
  async callActivity(options: { period: Period }): Promise<CallActivityRows> {
    const start = callWindowStart(options.period.start)

    const rows = await this.prisma.$queryRawUnsafe<
      {
        g_employee: number
        g_team: number
        g_day: number
        employee_id: string | null
        employee_name: string | null
        team: string | null
        day: Date | null
        calls: bigint | null
        connected: bigint | null
        talk_sec: bigint | null
        median_sec: number | null
        p90_sec: number | null
        customers: bigint | null
        unlinked: bigint | null
      }[]
    >(
      `
      WITH scoped AS (
        SELECT
          r."employeeId"  AS employee_id,
          r."customerId"  AS customer_id,
          r."durationSec" AS duration_sec,
          r."connected"   AS connected,
          ("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date AS day
        FROM "call_record" r
        WHERE r."startedAt" >= $1 AND r."startedAt" < $2
      ),
      labelled AS (
        SELECT
          s.*,
          e."fullName" AS employee_name,
          /*
            THE TEAM IS THE PRIMARY DEPARTMENT, WITH «(ROP)» STRIPPED.

            Same spelling as every other screen for a sales team, and complete
            for the three departments that ring customers without the marker —
            Регистрация, Операцион, NEWGEN, together 21.4% of the calls.
            COALESCE's last arm catches an employee filed nowhere.
          */
          COALESCE(
            NULLIF(btrim(regexp_replace(dp."name", '\\(ROP\\)', '', 'i')), ''),
            dp."name",
            $4
          ) AS team
        FROM scoped s
        LEFT JOIN "employee" e ON e."id" = s.employee_id
        LEFT JOIN "department" dp ON dp."id" = e."departmentId"
      )
      SELECT
        GROUPING(employee_id)::int AS g_employee,
        GROUPING(team)::int        AS g_team,
        GROUPING(day)::int         AS g_day,
        employee_id,
        min(employee_name) AS employee_name,
        team,
        day,
        count(*)::bigint AS calls,
        count(*) FILTER (WHERE connected)::bigint AS connected,
        COALESCE(sum(duration_sec) FILTER (WHERE connected), 0)::bigint AS talk_sec,
        (percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_sec)
           FILTER (WHERE connected))::int AS median_sec,
        (percentile_disc(0.9) WITHIN GROUP (ORDER BY duration_sec)
           FILTER (WHERE connected))::int AS p90_sec,
        count(DISTINCT customer_id)::bigint AS customers,
        count(*) FILTER (WHERE customer_id IS NULL)::bigint AS unlinked
      FROM labelled
      GROUP BY GROUPING SETS ((employee_id), (team), (day), ())
      ORDER BY g_employee, g_team, g_day, talk_sec DESC
      `,
      start,
      options.period.end,
      this.tz,
      InsightsRepository.NO_TEAM,
    )

    const total = rows.find((r) => r.g_employee === 1 && r.g_team === 1 && r.g_day === 1)

    const shape = (
      row: (typeof rows)[number],
      key: string,
      label: string,
    ): CallActivityRow => ({
      key,
      label,
      calls: int(row.calls),
      connected: int(row.connected),
      talkSec: int(row.talk_sec),
      // NULL when nothing in this group connected — a group with no
      // conversation has no typical conversation, and 0 would claim one of
      // zero seconds.
      medianSec: row.median_sec ?? null,
      p90Sec: row.p90_sec ?? null,
      customers: int(row.customers),
    })

    return {
      total: total
        ? shape(total, 'TOTAL', 'Jami')
        : {
            key: 'TOTAL',
            label: 'Jami',
            calls: 0,
            connected: 0,
            talkSec: 0,
            medianSec: null,
            p90Sec: null,
            customers: 0,
          },
      operators: rows
        .filter((r) => r.g_employee === 0)
        .map((r) =>
          shape(
            r,
            r.employee_id ?? InsightsRepository.NO_TEAM,
            r.employee_name ?? 'Nomaʼlum xodim',
          ),
        ),
      teams: rows
        .filter((r) => r.g_team === 0)
        .map((r) => shape(r, r.team ?? InsightsRepository.NO_TEAM, r.team ?? InsightsRepository.NO_TEAM)),
      /*
        ASCENDING, unlike the other two arms. A time axis is read left to
        right; the ORDER BY sorts every arm by talk time because the ranked
        arms need it, so the series is re-sorted here rather than in a second
        query.
      */
      series: rows
        .filter((r) => r.g_day === 0)
        .map((r) => {
          const iso = r.day ? r.day.toISOString().slice(0, 10) : ''
          return shape(r, iso, iso)
        })
        .sort((a, b) => a.key.localeCompare(b.key)),
      unlinkedCalls: int(total?.unlinked),
    }
  }
```

Add the `NO_TEAM` constant beside the class's existing `NO_ROP` (search for `NO_ROP` — it is a private static on the same class):

```ts
  /** An employee the portal files in no department at all. */
  private static readonly NO_TEAM = 'Boʻlimsiz'
```

Add the two interfaces near the file's other exported row types (top of file, beside `CustomerStateCounts`):

```ts
export interface CallActivityRow {
  readonly key: string
  readonly label: string
  readonly calls: number
  readonly connected: number
  readonly talkSec: number
  /** Null when nothing in this group connected — never a manufactured zero. */
  readonly medianSec: number | null
  readonly p90Sec: number | null
  readonly customers: number
}

export interface CallActivityRows {
  readonly total: CallActivityRow
  /** Ranked by talk time, descending. */
  readonly operators: readonly CallActivityRow[]
  readonly teams: readonly CallActivityRow[]
  /** One row per Tashkent day, ascending. */
  readonly series: readonly CallActivityRow[]
  /** Calls with no customer attached — disclosed, never silently dropped. */
  readonly unlinkedCalls: number
}
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run tests/http/callActivitySql.test.ts && npm run verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/insightsRepository.ts tests/http/callActivitySql.test.ts
git commit -m "Ask the telephony four questions in one scan

Overall, per operator, per team and per day are groupings of the same rows, so
they are one GROUPING SETS rather than four queries: the team rows and the day
rows sum to the overall row by construction, and that identity is what makes
the block checkable against the portal.

Three decisions the SQL records in place. The team is the employee's PRIMARY
department with (ROP) stripped — department_member would put one person in
several units and the arm would stop summing — and a department without the
marker is kept rather than nulled, because Регистрация, Операцион and NEWGEN
are 21.4% of the calls. percentile_disc and not _cont, because a duration is a
whole number of seconds somebody observed. And no mean is queried: the screen
divides talkSec by connected, so a tile cannot round into disagreement with the
table under it.

The day bucket goes through UTC first. startedAt is naive UTC and the one-step
form reads it as Tashkent local, which moves every call near midnight into the
wrong day.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The two band statements

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` (two methods after `callActivity`)
- Test: `tests/http/callActivitySql.test.ts` (extend)

**Interfaces:**
- Consumes: `CALL_DURATION_BANDS`, `CALL_CUSTOMER_BANDS`, `callWindowStart` (Task 1).
- Produces:

```ts
export interface CallBandRow {
  readonly key: string
  readonly calls: number
  readonly talkSec: number
}
export interface CallCustomerBandRow {
  readonly key: string
  readonly customers: number
  readonly talkSec: number
}
async callDurationBands(options: { period: Period }): Promise<readonly CallBandRow[]>
async callCustomerBands(options: { period: Period }): Promise<readonly CallCustomerBandRow[]>
```

- [ ] **Step 1: Write the failing test**

Append to `tests/http/callActivitySql.test.ts`:

```ts
function namedSql(marker: string): string {
  const at = SOURCE.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  return SOURCE.slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the duration band statement', () => {
  it('builds its CASE from CALL_DURATION_BANDS rather than typing bounds out', () => {
    /*
      The bands are a business definition with one home. A CASE written by hand
      here would be a second copy, and the two would agree until the day
      somebody moved a bound.
    */
    const body = SOURCE.slice(SOURCE.indexOf('async callDurationBands('))
    expect(body.slice(0, 1500)).toMatch(/CALL_DURATION_BANDS/)
  })

  it('bands connected calls only', () => {
    expect(namedSql('async callDurationBands(')).toMatch(/WHERE[\s\S]{0,120}connected/i)
  })

  it('clamps at the floor', () => {
    const body = SOURCE.slice(SOURCE.indexOf('async callDurationBands('))
    expect(body.slice(0, 1500)).toMatch(/callWindowStart\(/)
  })
})

describe('the customer band statement', () => {
  it('aggregates per customer before banding, not per call', () => {
    /*
      The question is how many calls ONE customer takes, so the GROUP BY on
      customerId has to happen first and the CASE reads its count. Banding the
      calls directly would answer nothing.
    */
    const sql = namedSql('async callCustomerBands(')
    expect(sql).toMatch(/GROUP BY[\s\S]{0,40}customer_id/i)
    expect(sql).toMatch(/count\(\*\)/i)
  })

  it('excludes the unlinked calls rather than bucketing them as one customer', () => {
    /*
      `customerId` is null on 0.7% of rows. Grouped, every one of them would
      collapse into a single enormous "customer". They are excluded here and
      disclosed as `unlinkedCalls` on the activity payload.
    */
    expect(namedSql('async callCustomerBands(')).toMatch(/customer_id IS NOT NULL|"customerId" IS NOT NULL/i)
  })

  it('clamps at the floor', () => {
    const body = SOURCE.slice(SOURCE.indexOf('async callCustomerBands('))
    expect(body.slice(0, 1500)).toMatch(/callWindowStart\(/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/http/callActivitySql.test.ts -t "band statement"`
Expected: FAIL — neither method exists.

- [ ] **Step 3: Write the two methods**

Add to `src/server/repositories/insightsRepository.ts` after `callActivity`, and extend the `@/lib/callQuality` import with `CALL_CUSTOMER_BANDS` and `CALL_DURATION_BANDS`:

```ts
  /**
   * How the window's conversations distribute by length.
   *
   * A SECOND STATEMENT RATHER THAN A FIFTH GROUPING ARM. The four arms of
   * `callActivity` are groupings of a row; this is a `CASE` over one. Measured
   * at 144 ms on production, so merging them would buy nothing and would put a
   * `CASE` into a statement whose whole readability is that every arm carries
   * the same measures.
   *
   * THE `CASE` IS GENERATED FROM `CALL_DURATION_BANDS`, never typed out. The
   * bands are read by the screen too, and a hand-written copy here would agree
   * with them until somebody moved a bound. Same arrangement as
   * `logisticsBuckets`.
   *
   * Connected calls only: an unanswered leg has no length to band.
   */
  async callDurationBands(options: { period: Period }): Promise<readonly CallBandRow[]> {
    const start = callWindowStart(options.period.start)

    /*
      Ordered ascending and evaluated in order, so each band's lower bound is
      its predecessor's `maxSec` and only needs the upper one written. The last
      band has `maxSec: null` and becomes the ELSE.
    */
    const cases = CALL_DURATION_BANDS.filter((band) => band.maxSec !== null)
      .map((band) => `WHEN duration_sec < ${band.maxSec} THEN '${band.key}'`)
      .join('\n            ')
    const fallback = CALL_DURATION_BANDS[CALL_DURATION_BANDS.length - 1]!.key

    const rows = await this.prisma.$queryRawUnsafe<
      { band: string; calls: bigint | null; talk_sec: bigint | null }[]
    >(
      `
      SELECT
        CASE
            ${cases}
            ELSE '${fallback}'
        END AS band,
        count(*)::bigint AS calls,
        COALESCE(sum(duration_sec), 0)::bigint AS talk_sec
      FROM (
        SELECT r."durationSec" AS duration_sec
        FROM "call_record" r
        WHERE r."startedAt" >= $1 AND r."startedAt" < $2 AND r."connected"
      ) c
      GROUP BY band
      `,
      start,
      options.period.end,
    )

    const byKey = new Map(rows.map((row) => [row.band, row]))

    /*
      RETURNED IN BAND ORDER, WITH THE ABSENT BANDS PRESENT AND ZERO.
      `GROUP BY` never emits an empty group, and a distribution missing its
      quiet bands is read as a distribution with fewer bands — the shape is the
      information here.
    */
    return CALL_DURATION_BANDS.map((band) => {
      const row = byKey.get(band.key)
      return {
        key: band.key,
        calls: int(row?.calls),
        talkSec: int(row?.talk_sec),
      }
    })
  }

  /**
   * How many calls one customer takes, and how long those add up to.
   *
   * THE GROUPING IS PER CUSTOMER FIRST. The question is about a person, not
   * about a leg, so the inner query collapses each customer to a count and the
   * `CASE` bands that. Banding calls directly would answer a different
   * question and look like this one.
   *
   * CALLS WITH NO CUSTOMER ARE EXCLUDED, NOT BUCKETED. `customerId` is null on
   * 0.7% of rows; grouped, all of them would collapse into one enormous
   * "customer" sitting in the 6+ band. They are disclosed instead, as
   * `unlinkedCalls` on the activity payload — the same way
   * `/insights/concentration` discloses revenue booked with no customer.
   *
   * There is no per-order equivalent of this and there cannot be:
   * `call_record."dealId"` is set on 1 row of 366 300, because the portal
   * answers `CRM_ENTITY_TYPE = 'CONTACT'` for effectively every call.
   */
  async callCustomerBands(
    options: { period: Period },
  ): Promise<readonly CallCustomerBandRow[]> {
    const start = callWindowStart(options.period.start)

    // INCLUSIVE bounds — see CALL_CUSTOMER_BANDS.
    const cases = CALL_CUSTOMER_BANDS.filter((band) => band.maxCalls !== null)
      .map((band) => `WHEN calls <= ${band.maxCalls} THEN '${band.key}'`)
      .join('\n            ')
    const fallback = CALL_CUSTOMER_BANDS[CALL_CUSTOMER_BANDS.length - 1]!.key

    const rows = await this.prisma.$queryRawUnsafe<
      { band: string; customers: bigint | null; talk_sec: bigint | null }[]
    >(
      `
      WITH per_customer AS (
        SELECT
          r."customerId" AS customer_id,
          count(*)::int AS calls,
          COALESCE(sum(r."durationSec") FILTER (WHERE r."connected"), 0)::bigint AS talk_sec
        FROM "call_record" r
        WHERE r."startedAt" >= $1 AND r."startedAt" < $2
          AND r."customerId" IS NOT NULL
        GROUP BY customer_id
      )
      SELECT
        CASE
            ${cases}
            ELSE '${fallback}'
        END AS band,
        count(*)::bigint AS customers,
        COALESCE(sum(talk_sec), 0)::bigint AS talk_sec
      FROM per_customer
      GROUP BY band
      `,
      start,
      options.period.end,
    )

    const byKey = new Map(rows.map((row) => [row.band, row]))

    return CALL_CUSTOMER_BANDS.map((band) => {
      const row = byKey.get(band.key)
      return {
        key: band.key,
        customers: int(row?.customers),
        talkSec: int(row?.talk_sec),
      }
    })
  }
```

Add the two row interfaces beside `CallActivityRows`:

```ts
export interface CallBandRow {
  readonly key: string
  readonly calls: number
  readonly talkSec: number
}

export interface CallCustomerBandRow {
  readonly key: string
  readonly customers: number
  readonly talkSec: number
}
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run tests/http/callActivitySql.test.ts && npm run verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/insightsRepository.ts tests/http/callActivitySql.test.ts
git commit -m "Distribute the window's calls by length, and by customer

Two small statements rather than two more grouping arms: the four arms of
callActivity are groupings of a row, and these are a CASE over one. Both CASEs
are generated from the tables in callQuality.ts, which the screen also reads,
so a moved bound cannot mean two things.

Both return every band, including the empty ones, because a distribution
missing its quiet bands reads as a distribution with fewer bands. The customer
statement collapses each customer before banding and EXCLUDES the 0.7% of calls
with no customer attached — grouped, they would collapse into one enormous
customer in the 6+ band. They are disclosed as unlinkedCalls instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: «база / база emas» — one CTE on `customerStates`

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` (`customerStates`, ~line 1240)
- Test: `tests/http/customerStatesSql.test.ts`

**Interfaces:**
- Consumes: the existing `CustomerStateCounts` type in the same file.
- Produces: `CustomerStateCounts` gains `readonly base: { readonly inBase: number; readonly notInBase: number }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/http/customerStatesSql.test.ts` (it already reads the statement — reuse its existing `code()` helper; if the helper is named differently, use that name):

```ts
describe('the база split', () => {
  it('asks the RETENTION pipeline by ROLE, never by a hardcoded category id', () => {
    /*
      `PipelineRole` exists so a module can say "the retention pipeline"
      instead of naming CATEGORY_ID 10, and so the portal can reclassify one
      with an UPDATE instead of a redeploy.
    */
    expect(code()).toMatch(/p\."role"\s*=\s*'RETENTION'/i)
    expect(code()).not.toMatch(/CATEGORY_ID|category_id|=\s*10\b/)
  })

  it('splits BUYERS, not the whole customer table', () => {
    /*
      `customer` holds 352 550 rows and most of them never bought. The question
      is how many of OUR CUSTOMERS are being worked in База, so the split rides
      the `cust` CTE — which is already `countsAsRevenue` — rather than a fresh
      scan of `customer`.
    */
    const sql = code()
    const at = sql.indexOf('based AS (')
    expect(at).toBeGreaterThan(-1)
    expect(sql).toMatch(/FROM cust/i)
  })

  it('counts the two halves so they sum to the buyer total', () => {
    const sql = code()
    expect(sql).toMatch(/in_base/i)
    expect(sql).toMatch(/not_in_base/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/http/customerStatesSql.test.ts -t "база split"`
Expected: FAIL — no `based AS (` in the statement.

- [ ] **Step 3: Add the CTE and the counts**

In `customerStates`, extend the raw type with `in_base: bigint | null; not_in_base: bigint | null`, add the CTE after the existing `cust` CTE, and add the two counts to the SELECT:

```sql
      based AS (
        /*
          WHICH BUYERS ARE IN «База» AT ALL.

          `База` (#10) is the retention funnel — a follow-up cadence, and the
          portal's mirror of a Доставка order, which is why its money is never
          counted. Whether a customer is IN it is a different fact from how
          long they have been silent, and it is the one the client asked for:
          «база / база emas».

          Asked by ROLE, not by CATEGORY_ID. `PipelineRole` exists so this
          reads as a business statement and so a reclassification is an UPDATE.

          NO `countsAsRevenue` HERE, on purpose: the retention pipeline is
          precisely the one that does not count, so filtering on it would
          empty this CTE and print every buyer as «Bazada yoʻq».
        */
        SELECT DISTINCT d."customerId" AS cid
        FROM "deal" d
        JOIN "pipeline" p ON p."id" = d."pipelineId"
        WHERE p."role" = 'RETENTION' AND d."customerId" IS NOT NULL
      ),
```

and in the final SELECT, beside the three state counts:

```sql
        /*
          THE TWO HALVES SUM TO `customers`, and that is the check.

          Both are counted over the BUYER set (`cust`), not over the 352 550-row
          customer table: the question is how many of our customers are being
          worked in База, not how big the lead pool is. Counted the other way
          the figure would be dominated by contacts that never bought anything.
        */
        (SELECT count(*) FROM cust c WHERE EXISTS (SELECT 1 FROM based b WHERE b.cid = c.cid))::bigint AS in_base,
        (SELECT count(*) FROM cust c WHERE NOT EXISTS (SELECT 1 FROM based b WHERE b.cid = c.cid))::bigint AS not_in_base,
```

Extend the return value:

```ts
      /*
        A TWO-WAY SPLIT OF BUYERS, AND NOT THE «База» LADDER ON CohortPage.
        That one partitions OPEN retention deals by stage and its bars
        deliberately do not sum — one customer with two open deals stands in
        two of them. This does sum, to `customers`. Both are right; neither is
        the other's total.
      */
      base: {
        inBase: int(row?.in_base ?? 0n),
        notInBase: int(row?.not_in_base ?? 0n),
      },
```

and add the field to `CustomerStateCounts`:

```ts
  readonly base: {
    /** Buyers with any deal in the RETENTION pipeline. */
    readonly inBase: number
    /** Buyers with none. `inBase + notInBase === customers`. */
    readonly notInBase: number
  }
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run tests/http/customerStatesSql.test.ts tests/domain/customerStates.test.ts && npm run verify`
Expected: PASS. If `tests/domain/customerStates.test.ts` builds a `CustomerStateCounts` fixture, add `base` to it.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/insightsRepository.ts tests/http/customerStatesSql.test.ts tests/domain/customerStates.test.ts
git commit -m "Say how many of our customers are in База, and how many are not

The client asked for «база ne baza». Whether a customer sits in the retention
funnel at all is a different fact from how long they have been silent, and
nothing in the product stated it: the ladder on Mijoz qaytishi partitions OPEN
retention deals by stage and its bars deliberately do not sum.

One CTE on a statement that already walks every buyer. Counted over BUYERS and
not over the 352 550-row customer table, so the figure answers how many of our
customers are being worked rather than how big the lead pool is — and the two
halves sum to the buyer total, which is the check. Asked by pipeline ROLE, and
with no countsAsRevenue filter: RETENTION is precisely the role that does not
count, so filtering would print every buyer as outside the base.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: DTOs and the service

**Files:**
- Modify: `src/lib/api.ts` (new DTOs; `inBase`/`notInBase` on the customer-flow states)
- Modify: `src/server/services/insightsService.ts` (mirrored DTOs, three caches, `callActivity`, the base split on `customerFlow`)

**Interfaces:**
- Consumes: Task 4, 5 and 6 repository methods; `CALL_DURATION_BANDS`, `CALL_CUSTOMER_BANDS`, `callFloorApplied`.
- Produces:

```ts
export interface CallRowDto {
  readonly key: string
  readonly label: string
  readonly calls: number
  readonly connected: number
  /** Null when there were no calls at all. */
  readonly connectPercent: number | null
  readonly talkSec: number
  readonly medianSec: number | null
  readonly p90Sec: number | null
  readonly customers: number
}

export interface CallDurationBandDto {
  readonly key: string
  readonly label: string
  readonly colour: string
  readonly calls: number
  /** Share of `total.connected`. Null when nothing connected. */
  readonly sharePercent: number | null
  readonly talkSec: number
}

export interface CallCustomerBandDto {
  readonly key: string
  readonly label: string
  readonly customers: number
  readonly avgTalkSec: number
  readonly talkSec: number
}

export interface CallActivityDto {
  readonly total: CallRowDto
  readonly operators: readonly CallRowDto[]
  readonly teams: readonly CallRowDto[]
  readonly series: readonly CallRowDto[]
  readonly durationBands: readonly CallDurationBandDto[]
  readonly customerBands: readonly CallCustomerBandDto[]
  readonly unlinkedCalls: number
  readonly floorApplied: boolean
}

// InsightsService:
async callActivity(period: Period): Promise<CallActivityDto>
```

`CustomerFlowDto['states']` gains `readonly inBase: number` and `readonly notInBase: number`.

- [ ] **Step 1: Write the failing test**

There is no service-level test harness here (no test touches a database), so the gate for this task is the SQL/domain tests plus `npm run verify` and the contract test. Extend `tests/http/contract.test.ts`'s DTO-mirror check if it enumerates DTOs; otherwise this task's gate is Step 4. **Do not skip Step 2** — run the suite first so you know what was already green.

Run: `npx vitest run tests/http/contract.test.ts`
Expected: PASS today. Record the test count.

- [ ] **Step 2: Add the DTOs to `src/lib/api.ts`**

Add the four interfaces above, beside `CustomerFlowDto`, each with the comments given in the Interfaces block. Then extend `CustomerFlowDto`:

```ts
  readonly states: {
    readonly customers: number
    /** In `CUSTOMER_STATES` order — see `src/lib/customerStates.ts`. */
    readonly rows: readonly CustomerStateRowDto[]
    /** Buyers with any deal in the «База» funnel. */
    readonly inBase: number
    /** Buyers with none. `inBase + notInBase === customers`. */
    readonly notInBase: number
  }
```

- [ ] **Step 3: Write the service method**

In `src/server/services/insightsService.ts`:

1. Mirror the four DTOs server-side (this file already hand-mirrors `CustomerFlowDto` — follow that pattern exactly, including the comment explaining that nothing checks the mirror).
2. Add three caches beside `customerFlowCache`:

```ts
/**
 * The call block's three statements, memoised separately because they cost
 * differently and change together. Same TTL as `customerFlowCache` — the
 * numbers move when the sync worker's half-hourly reference pass lands, and a
 * reader pressing refresh twice inside that window is asking the same
 * question.
 */
const callActivityCache = ttlCache<Awaited<ReturnType<InsightsRepository['callActivity']>>>(
  INSIGHTS_TTL_MS,
)
const callDurationCache = ttlCache<Awaited<ReturnType<InsightsRepository['callDurationBands']>>>(
  INSIGHTS_TTL_MS,
)
const callCustomerCache = ttlCache<Awaited<ReturnType<InsightsRepository['callCustomerBands']>>>(
  INSIGHTS_TTL_MS,
)
```

(use whatever the file's existing TTL constant is called — copy it from `customerFlowCache`'s declaration) and clear all three in the existing reset seam beside `customerFlowCache.clear()`.

3. The method:

```ts
  /**
   * «Qoʻngʻiroqlar» — the telephony block, on the dashboard's own window.
   *
   * THREE STATEMENTS, ONE KEY SHAPE. All three take the same period, so they
   * share a key built the same way and cannot answer about different windows.
   * The key is `period.start` plus the span in days — the DAY it lands on
   * rather than the instant — matching `customerFlow`'s key and for the same
   * reason: a band that re-queried per request would put an 8-second statement
   * into a one-vCPU database once per reader per minute.
   *
   * NEITHER `currency` NOR `timeZone` NOR SCOPE IS IN THE KEY, and each
   * absence is safe for a reason that would stop being true under a different
   * change:
   *
   *   - this block states NO MONEY, so there is no currency to tag with. The
   *     day a soʻm figure appears here, the key needs one.
   *   - the repository buckets with its own fixed `this.tz`
   *     (`env.APP_TIMEZONE`) and never reads `period.timeZone`, so the zone
   *     cannot vary between two callers sharing an entry.
   *   - `customers` is COMPANY_WIDE and the route asks for
   *     `analytics:read:all`, so every caller who gets through reads the same
   *     rows. Narrow this section and the key gains the scope in the same
   *     commit or the memo goes.
   *
   * THE MEAN IS NOT COMPUTED HERE EITHER. It is `talkSec / connected`, and the
   * screen does that division. Rounding it on the way out and again for
   * display is how a tile comes to disagree with the table under it.
   */
  async callActivity(period: Period): Promise<CallActivityDto> {
    const key = `calls|${period.start.toISOString()}|${periodLengthInDays(period)}`

    const [activity, durationBands, customerBands] = await Promise.all([
      callActivityCache.get(key, () => this.repository.callActivity({ period })),
      callDurationCache.get(key, () => this.repository.callDurationBands({ period })),
      callCustomerCache.get(key, () => this.repository.callCustomerBands({ period })),
    ])

    const row = (source: CallActivityRow): CallRowDto => ({
      key: source.key,
      label: source.label,
      calls: source.calls,
      connected: source.connected,
      // Null over an empty denominator — see `rateBp`. A day with no calls has
      // no connect rate; 0% would claim a hundred unanswered dials.
      connectPercent: pct(rateBp(source.connected, source.calls)),
      talkSec: source.talkSec,
      medianSec: source.medianSec,
      p90Sec: source.p90Sec,
      customers: source.customers,
    })

    const bandLabels = new Map(CALL_DURATION_BANDS.map((band) => [band.key, band]))
    const customerLabels = new Map(CALL_CUSTOMER_BANDS.map((band) => [band.key, band]))

    return {
      total: row(activity.total),
      operators: activity.operators.map(row),
      teams: activity.teams.map(row),
      series: activity.series.map(row),
      durationBands: durationBands.map((band) => {
        const spec = bandLabels.get(band.key)
        return {
          key: band.key,
          // The repository returns the band table's own keys, so a miss is
          // impossible rather than unlikely; the fallbacks exist so a future
          // edit to one table fails loudly on screen instead of throwing.
          label: spec?.label ?? band.key,
          colour: spec?.colour ?? '--series-1',
          calls: band.calls,
          // Against CONNECTED calls, which is what the bands partition — not
          // against every leg, which would make the six shares sum to a third.
          sharePercent: pct(rateBp(band.calls, activity.total.connected)),
          talkSec: band.talkSec,
        }
      }),
      customerBands: customerBands.map((band) => {
        const spec = customerLabels.get(band.key)
        return {
          key: band.key,
          label: spec?.label ?? band.key,
          customers: band.customers,
          // Integer seconds: the screen formats it, and a fraction of a second
          // of average talk time is not a fact about anything.
          avgTalkSec: band.customers === 0 ? 0 : Math.round(band.talkSec / band.customers),
          talkSec: band.talkSec,
        }
      }),
      unlinkedCalls: activity.unlinkedCalls,
      /*
        Read from the REQUESTED start, not the clamped one — the clamp is what
        this reports. Asked of the module rather than compared here, so the
        screen's caveat and the repository's bound cannot disagree.
      */
      floorApplied: callFloorApplied(period.start),
    }
  }
```

4. In `customerFlow`, pass the two new counts through:

```ts
      states: {
        customers: states.customers,
        rows,
        inBase: states.base.inBase,
        notInBase: states.base.notInBase,
      },
```

- [ ] **Step 4: Run the suite**

Run: `npm run verify`
Expected: PASS, with the same test count as Step 1 plus the new files' cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/server/services/insightsService.ts
git commit -m "Serve the call block, and carry the база split on the flow payload

Three statements behind one key shape, so they cannot answer about different
windows, and behind ttlCache for the reason customerFlow is: thirty days of
calls is an 8-second statement and this database has one vCPU.

Three things are deliberately absent from the key and each says why in place —
no currency because the block states no money, no timezone because the
repository buckets with its own fixed zone, no scope because the section is
COMPANY_WIDE. The mean is absent from the payload for the same reason it is
absent from the SQL: the screen divides talkSec by connected, and rounding that
twice is how a tile disagrees with its own table.

Band shares are taken against CONNECTED calls, which is what the bands
partition; against every leg the six would sum to a third.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The endpoint, and the section `/insights/customers` now belongs to

**Files:**
- Create: `src/app/api/v1/insights/calls/route.ts`
- Modify: `src/app/api/v1/insights/customers/route.ts` (one line)
- Test: `tests/http/routeAccess.test.ts` (extend if it enumerates sections)

**Interfaces:**
- Consumes: `InsightsService.callActivity` (Task 7); `periodQuerySchema` from `@/server/http/queryParams`; `getHandler`, `periodFrom` from `@/server/http/handler`.
- Produces: `GET /api/v1/insights/calls` → `{ data: CallActivityDto, meta: { period } }`.

- [ ] **Step 1: Run the access suite and record what it sees**

Run: `npx vitest run tests/http/routeAccess.test.ts`
Expected: PASS today. The route count floor in that file is a smoke test, not a budget — read its comment before touching it.

- [ ] **Step 2: Write the route**

Create `src/app/api/v1/insights/calls/route.ts`:

```ts
import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const

/**
 * «Qoʻngʻiroqlar» — who spoke to customers, for how long.
 *
 * THE ADDRESS IS REUSED AND THE ENDPOINT IS NOT. A `/insights/calls` existed
 * until the 2026-09-10 callerless cull took it with the screen it fed. That
 * one answered response-speed questions — time to first call, attempts to
 * connect, revenue per talk-hour — all of which need a call joined to a deal.
 * `call_record."dealId"` is set on 1 row of 366 300 (the portal answers
 * `CRM_ENTITY_TYPE = 'CONTACT'` for effectively every call), so none of that
 * is restorable and none of it is attempted here. What is on the payload joins
 * a call to a CUSTOMER (99.3%) and to an EMPLOYEE (100%).
 *
 * `periodQuerySchema`, NOT `analyticsQuerySchema`. The filter half carries
 * employee, stage, product, source and `filial` — and `filial` has a non-empty
 * default, so taking the combined schema would hand this endpoint a branch
 * narrowing that no column in `call_record` can honour. Savdo dinamikasi
 * dropped two filters for the same reason: a control that changes nothing is
 * worse than an absent one.
 *
 * IT HONOURS THE DASHBOARD WINDOW, AND «Bugun» IS A GOOD QUESTION HERE.
 * `/insights/customers` beside it resolves its own trailing ninety days
 * because its sibling `/insights/concentration` once inherited the «Bugun»
 * default and reported twelve customers and one first-to-second pair under a
 * critical-red gauge. Nothing about a day of telephony is degenerate — «who
 * spoke to customers today» is the floor's own question — so this one takes
 * the control.
 *
 * The window is clamped to `CALL_DATA_FLOOR` inside the repository and the
 * clamp is reported as `data.floorApplied`, so the screen can say why it is
 * showing less than was asked for. `meta.period` carries the window the
 * caller asked for; the resolved lower bound is stated on the block.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await insightsService.callActivity(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
```

- [ ] **Step 3: Move `/insights/customers` onto the new section**

In `src/app/api/v1/insights/customers/route.ts`, change the one line and say why:

```ts
/**
 * Who reaches this endpoint: the capability, then the screen it feeds.
 *
 * `customers` since 2026-09-16, not `cohort`: the band this serves was
 * specified for «Mijoz qaytishi» and the client chose a section of its own for
 * it. `section` names the screen, so it moves with the screen.
 */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const
```

- [ ] **Step 4: Run the access suite and the whole gate**

Run: `npx vitest run tests/http/routeAccess.test.ts && npm run verify`
Expected: PASS. If the suite fails on an unknown section, Task 9 registers it — do Task 9 and re-run. If it fails on the route-count floor, read that test's comment and move the floor with the reason.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/insights/calls/route.ts src/app/api/v1/insights/customers/route.ts
git commit -m "Answer for the telephony at /insights/calls, on the dashboard's window

The address is reused; the endpoint is not. The old one answered response-speed
questions that all need a call joined to a deal, and dealId is set on 1 row of
366 300 — so nothing of it is restorable and nothing is attempted.

periodQuerySchema and not analyticsQuerySchema: the filter half carries filial,
which has a non-empty default and which no column in call_record can honour.
And unlike /insights/customers beside it, this one takes the dashboard control
— «Bugun» is the floor's own question about telephony, where for a
ninety-day customer cohort it was twelve people under a red gauge.

/insights/customers moves to the same section, because section names the screen
and the screen moved.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Register the section

**Files:**
- Modify: `src/lib/sections.ts` (`SECTIONS`, `COMPANY_WIDE`)
- Modify: `src/lib/roles.ts` (`ALL_ROUTES`)
- Modify: `src/lib/messages.ts` (`nav`, `modules`)
- Create: `src/app/customers/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: section id `'customers'`, route `/customers`, `t.nav.customers`, `t.modules.customers.{title,lead}`.

- [ ] **Step 1: Run the tests that read the section list**

Run: `npx vitest run tests/http/routeAccess.test.ts tests/features/navColdLoad.test.tsx`
Expected: PASS or a failure naming `customers` as unknown — either way, record it.

- [ ] **Step 2: Add the section**

In `src/lib/sections.ts`, add to `SECTIONS` after the `cohort` entry (nav order follows this array):

```ts
  {
    id: 'customers',
    route: '/customers',
    label: 'Mijozlar va qoʻngʻiroqlar',
    group: 'Tahlil',
  },
```

and to `COMPANY_WIDE`, with the reason:

```ts
  /*
    «MIJOZLAR VA QOʻNGʻIROQLAR» IS COMPANY-WIDE FOR TWO DIFFERENT REASONS AT
    ONCE, and the second is the one that keeps it here.

    The customer-flow half genuinely cannot narrow: «new» is decided against a
    customer's whole history and «lost» against today, neither of which a team
    scope can cut without changing what the words mean — the same argument
    `cohort` already stands on.

    The telephony half COULD narrow, and is refused like `payroll` is: the
    operators table names a person and states their talk time, their connect
    rate and their median call. Opening it to a ROP takes three changes in one
    commit — the route's permission, the scope threaded through the service, and
    the scope added to its memo key.
  */
  'customers',
```

- [ ] **Step 3: Add the nav route and the words**

In `src/lib/roles.ts`, add `'/customers'` to `ALL_ROUTES` after `'/analytics/cohort'`. **Not to `SALES`** — add a comment saying so where the SALES list is, if one is not already implied by the block comment above it:

```ts
  // Withheld from SALES with cohort, margin and structure, and for the
  // sharpest version of that reason: this screen names every operator's talk
  // time. An administrator grants it per account.
```

In `src/lib/messages.ts`, add to `nav` after `cohort`:

```ts
    customers: 'Mijozlar va qoʻngʻiroqlar',
```

and to `modules`:

```ts
    customers: {
      title: 'Mijozlar va qoʻngʻiroqlar',
      /*
        THE LEAD NAMES WHAT A CALL IS JOINED TO, because the obvious reading of
        this screen is wrong. A reader who sees call counts beside customer
        counts assumes a call can be traced to an order; `dealId` is set on 1
        row of 366 300, so it cannot. Saying it here is cheaper than the
        question it prevents.
      */
      lead: 'Mijozlar qanday kelayapti va ketayapti, va operatorlar ular bilan qancha gaplashgani. Qoʻngʻiroq mijozga bogʻlanadi — buyurtmaga emas.',
    },
```

- [ ] **Step 4: Add the page shell**

Create `src/app/customers/page.tsx`, copying the shape of `src/app/analytics/cohort/page.tsx` (read it first — it is the canonical thin shell, and `AGENTS.md` warns this Next differs from training data):

```tsx
import { Suspense } from 'react'

import { CustomersPage } from '@/features/customers/CustomersPage'
import { requireSection } from '@/server/auth/pageGuard'

export default async function Page() {
  await requireSection('customers')
  return (
    <Suspense>
      <CustomersPage />
    </Suspense>
  )
}
```

Match the sibling page's exact imports and signature — if it does not use `Suspense`, do not add one.

- [ ] **Step 5: Run the gate**

Run: `npm run verify`
Expected: FAIL — `CustomersPage` does not exist yet. That is expected; this task's own gate is that `routeAccess` and `navColdLoad` pass:

Run: `npx vitest run tests/http/routeAccess.test.ts tests/features/navColdLoad.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit (the page shell too — it is one decision)**

```bash
git add src/lib/sections.ts src/lib/roles.ts src/lib/messages.ts src/app/customers/page.tsx
git commit -m "Give «Mijozlar va qoʻngʻiroqlar» a section of its own

COMPANY_WIDE for two reasons stated in place. The customer half cannot narrow —
«new» is decided against a customer's whole history and «lost» against today,
which a team scope cannot cut without changing what the words mean. The
telephony half could, and is refused the way payroll is: the operators table
names a person and states their talk time and median call.

Granted to ADMIN and MANAGER through ALL_ROUTES, and deliberately not to SALES.
The module lead names what a call is joined to, because the obvious reading is
wrong: dealId is set on 1 row of 366 300, so a call cannot be traced to an
order and a reader will assume it can.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `CallTalkChart` — one line, talk hours per day

**Files:**
- Create: `src/components/charts/CallTalkChart.tsx`

**Interfaces:**
- Consumes: `CallRowDto` (Task 7).
- Produces: `CallTalkChart({ data, height }: { data: readonly CallRowDto[]; height?: number })`.

- [ ] **Step 1: Read the component this one copies**

Read `src/components/charts/CustomerFlowChart.tsx` end to end. It is the closest shape — a daily series from a DTO, one Y axis, `useReducedMotion`, a custom tooltip, and a comment about not inventing zeros for absent days. Copy its structure rather than inventing one.

- [ ] **Step 2: Write the component**

Create `src/components/charts/CallTalkChart.tsx`:

```tsx
'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useReducedMotion } from '@/lib/useReducedMotion'
import type { CallRowDto } from '@/lib/api'
import { formatDateShort, formatNumber } from '@/lib/format'

/**
 * Connected talk time per day — one line, one axis.
 *
 * HOURS AND NOT SECONDS on the axis. A day of this floor is 100 000-odd
 * seconds of conversation, and an axis in six figures is read as an error.
 * The conversion is here rather than on the payload because the payload's
 * `talkSec` is what every other figure on the block divides.
 *
 * ONE SERIES, deliberately. Calls made and calls connected were tried
 * alongside it and they are counts against a duration — two units, which is a
 * second Y axis, which is forbidden in this codebase. The counts are in the
 * tiles and in the tables; this answers how much of the day was spent talking.
 *
 * ABSENT DAYS ARE ABSENT. The repository emits only days that carry calls, and
 * recharts draws a straight segment across a gap. That is the honest
 * rendering: a manufactured zero would assert that nobody spoke, where the
 * truth is that the portal recorded nothing — and on this data those are
 * different claims, because sixteen days of it are known bad.
 */
export function CallTalkChart({
  data,
  height,
}: {
  data: readonly CallRowDto[]
  height?: number
}) {
  const reducedMotion = useReducedMotion()

  const points = data.map((row) => ({
    label: formatDateShort(row.key),
    hours: row.talkSec / 3600,
    calls: row.calls,
    connected: row.connected,
  }))

  return (
    <ResponsiveContainer width="100%" height={height ?? '100%'}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--rule)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
          stroke="var(--rule)"
        />
        <YAxis
          tick={{ fill: 'var(--ink-muted)', fontSize: 11 }}
          stroke="var(--rule)"
          tickFormatter={(value: number) => formatNumber(Math.round(value))}
          width={40}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const point = payload[0]?.payload as (typeof points)[number] | undefined
            if (!point) return null
            return (
              <div className="chart-tooltip">
                <p className="font-medium">{label}</p>
                <p>
                  {formatNumber(Math.round(point.hours * 10) / 10)} soat suhbat
                </p>
                <p style={{ color: 'var(--ink-muted)' }}>
                  {formatNumber(point.connected)} / {formatNumber(point.calls)} ulangan
                </p>
              </div>
            )
          }}
        />
        <Line
          type="monotone"
          dataKey="hours"
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={!reducedMotion}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

**Before writing this, read `CustomerFlowChart.tsx` and match it**: the tooltip class name, the `useReducedMotion` import path, the axis props and the grid colour must be whatever that file uses, not what is guessed here. If it uses a shared `chartTooltip.tsx` helper, use that instead of the inline `div`.

- [ ] **Step 3: Run the gate**

Run: `npm run verify`
Expected: FAIL only on `CustomersPage` still being absent. No new failures from this file.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/CallTalkChart.tsx
git commit -m "Draw the day's talk time as one line on one axis

Hours on the axis, not seconds: a day of this floor is a six-figure number of
seconds and an axis in six figures is read as an error. One series, because
calls made and calls connected are counts against a duration — two units, so a
second Y axis, which this codebase forbids. The counts are in the tiles.

Absent days stay absent. The repository emits only days carrying calls, and a
manufactured zero would assert that nobody spoke where the truth is that
nothing was recorded — on this data those are different claims.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `CallRowTable` — the ranked table, rendered twice

**Files:**
- Create: `src/features/customers/CallRowTable.tsx`
- Test: `tests/features/callActivityBlock.test.tsx`

**Interfaces:**
- Consumes: `CallRowDto`; `formatDuration`, `formatNumber`, `formatPercent`, `NO_VALUE` from `@/lib/format`.
- Produces: `CallRowTable({ rows, headLabel, status }: { rows: readonly CallRowDto[]; headLabel: string; status: 'loading' | 'error' | 'ready' })`.

- [ ] **Step 1: Write the failing test**

Create `tests/features/callActivityBlock.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CallRowTable } from '@/features/customers/CallRowTable'
import type { CallRowDto } from '@/lib/api'

/**
 * The block cannot be seen locally — `call_record` is EMPTY on the demo seed
 * (verified 2026-09-16: 0 rows), so every local render is an empty state and
 * the only place this table has ever drawn is production. That is exactly the
 * case a test has to carry, and the rows below are production figures read
 * above the data floor on 2026-09-16.
 *
 * What it pins is the claim the table makes that a reader would otherwise take
 * on trust: the MEAN and the MEDIAN are both printed, and they differ wildly.
 * A later edit that keeps one «to save a column» removes the whole reason this
 * block reports a distribution.
 */
const ROWS: CallRowDto[] = [
  {
    key: 'e1',
    label: 'Sotuvchi 156',
    calls: 253,
    connected: 71,
    connectPercent: 28.1,
    talkSec: 25_920, // 7.2 h
    medianSec: 81,
    p90Sec: 1244,
    customers: 180,
  },
  {
    key: 'e2',
    label: 'Sirojov 115 Davlatbek',
    calls: 85,
    connected: 39,
    connectPercent: 45.9,
    talkSec: 24_480, // 6.8 h
    medianSec: 574,
    p90Sec: 1435,
    customers: 60,
  },
  {
    // An operator who dialled and reached nobody. Real, and the row that
    // breaks a table computing its own mean without a guard.
    key: 'e3',
    label: 'Hayot(ROP) xodimi',
    calls: 4,
    connected: 0,
    connectPercent: 0,
    talkSec: 0,
    medianSec: null,
    p90Sec: null,
    customers: 4,
  },
]

describe('the call row table', () => {
  it('prints the mean AND the median, and they are allowed to disagree', () => {
    render(<CallRowTable rows={ROWS} headLabel="Operator" status="ready" />)

    // 25 920 / 71 = 365 s = 6:05 mean, against a 1:21 median.
    expect(screen.getByText('6:05')).toBeInTheDocument()
    expect(screen.getByText('1:21')).toBeInTheDocument()

    // 24 480 / 39 = 628 s = 10:28 mean, against a 9:34 median.
    expect(screen.getByText('10:28')).toBeInTheDocument()
    expect(screen.getByText('9:34')).toBeInTheDocument()
  })

  it('never divides by zero — a row that reached nobody prints no durations', () => {
    render(<CallRowTable rows={ROWS} headLabel="Operator" status="ready" />)
    const row = screen.getByText('Hayot(ROP) xodimi').closest('tr')
    expect(row).not.toBeNull()
    // Mean, median and p90 all absent: three em dashes, not «0 s» three times,
    // which would claim three measurements nobody made.
    expect(row!.textContent).toContain('—')
    expect(row!.textContent).not.toContain('0 s')
  })

  it('keeps the order it was given — the server ranked by talk time', () => {
    render(<CallRowTable rows={ROWS} headLabel="Operator" status="ready" />)
    const names = screen.getAllByRole('row').slice(1).map((r) => r.textContent ?? '')
    expect(names[0]).toContain('Sotuvchi 156')
    expect(names[1]).toContain('Sirojov 115 Davlatbek')
  })

  it('has a loading and an error rendering that are not the empty one', () => {
    const { rerender } = render(<CallRowTable rows={[]} headLabel="Operator" status="loading" />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<CallRowTable rows={[]} headLabel="Operator" status="error" />)
    expect(screen.getByText('Olinmadi')).toBeInTheDocument()

    rerender(<CallRowTable rows={[]} headLabel="Operator" status="ready" />)
    expect(screen.getByText(/Maʼlumot yoʻq/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/features/callActivityBlock.test.tsx`
Expected: FAIL — `Failed to resolve import "@/features/customers/CallRowTable"`.

- [ ] **Step 3: Write the component**

Create `src/features/customers/CallRowTable.tsx`:

```tsx
'use client'

import type { CallRowDto } from '@/lib/api'
import { NO_VALUE, formatDuration, formatNumber, formatPercent } from '@/lib/format'

/**
 * One ranked table, rendered twice — once for operators, once for teams.
 *
 * THE MEAN AND THE MEDIAN ARE BOTH COLUMNS, and dropping either is the one
 * edit that breaks this block. Measured above the floor: the mean connected
 * call runs 167 s and the median 50 s, because 8.4% of calls pass ten minutes
 * and hold 52% of all talk time. A table with only the mean tells a ROP that a
 * typical call is nearly three minutes; with only the median it hides where the
 * day actually went.
 *
 * THE MEAN IS COMPUTED HERE, from `talkSec / connected`. Neither the SQL nor
 * the service carries it: rounded on the way out and again for display, a
 * tile and this table would disagree by a second and nobody could say which
 * was right.
 *
 * EVERY ROW IS RENDERED — 164 operators on the live payload. `/sellers`
 * renders every seller for the same reason: a performance table that stops at
 * twenty invites «where am I», and there is no truncation rule in this
 * codebase to copy.
 *
 * THE ORDER IS THE SERVER'S. It ranked by talk time; re-sorting here would be
 * a second definition of «top».
 */
export function CallRowTable({
  rows,
  headLabel,
  status,
}: {
  rows: readonly CallRowDto[]
  headLabel: string
  status: 'loading' | 'error' | 'ready'
}) {
  if (status === 'loading') {
    return (
      <div className="skeleton h-[220px] w-full rounded-lg" role="status">
        <span className="sr-only">Yuklanmoqda</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--status-critical)' }}>
        Olinmadi
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        Maʼlumot yoʻq.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--ink-muted)' }}>
            <th className="py-2 text-left font-medium">{headLabel}</th>
            <th className="py-2 text-right font-medium">Qoʻngʻiroq</th>
            <th className="py-2 text-right font-medium">Ulangan</th>
            <th className="py-2 text-right font-medium">Suhbat</th>
            <th className="py-2 text-right font-medium">Oʻrtacha</th>
            <th className="py-2 text-right font-medium">Median</th>
            <th className="py-2 text-right font-medium">p90</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            /*
              NULL, NOT ZERO, WHEN NOBODY WAS REACHED. An operator who dialled
              four numbers and reached none has no average call — printing
              «0 s» would state a measurement that was never made, three times
              across the row.
            */
            const meanSec = row.connected === 0 ? null : row.talkSec / row.connected

            return (
              <tr key={row.key} style={{ borderTop: '1px solid var(--rule)' }}>
                <td className="py-2 pr-3">{row.label}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(row.calls)}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumber(row.connected)}
                  <span className="ml-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {formatPercent(row.connectPercent)}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumber(Math.round((row.talkSec / 3600) * 10) / 10)}
                  <span className="ml-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    soat
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {meanSec === null ? NO_VALUE : formatDuration(meanSec)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {row.medianSec === null ? NO_VALUE : formatDuration(row.medianSec)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {row.p90Sec === null ? NO_VALUE : formatDuration(row.p90Sec)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

Check `formatPercent`'s signature before using it (`src/lib/format.ts:153` — it takes `number | null`), and match the table's class names to an existing table in `src/features` rather than inventing a style.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/features/callActivityBlock.test.tsx`
Expected: PASS, all four cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/CallRowTable.tsx tests/features/callActivityBlock.test.tsx
git commit -m "Rank the callers, with the mean and the median side by side

One table rendered twice, for operators and for teams. Both duration columns
are load-bearing: above the floor the mean connected call runs 167 s and the
median 50 s, because 8.4% of calls pass ten minutes and hold 52% of the talk
time. With only the mean a ROP reads a typical call as three minutes; with only
the median the day's hours are unexplained.

The mean is computed here from talkSec / connected, so it cannot be rounded
twice into disagreeing with a tile. A row that reached nobody prints em dashes
rather than «0 s» three times — that would be three measurements nobody made,
and the demo seed has no calls at all, so this test is the only place the row
has ever been rendered.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The screen

**Files:**
- Create: `src/features/customers/CallActivitySection.tsx`
- Create: `src/features/customers/CustomerFlowSection.tsx`
- Create: `src/features/customers/CustomersPage.tsx`
- Modify: `src/features/cohort/CohortPage.tsx` (drop the two unused imports)

**Interfaces:**
- Consumes: `CallActivityDto`, `CustomerFlowDto`; `CallRowTable` (Task 11); `CallTalkChart` (Task 10); `CustomerFlowChart`, `CategoryBarList`, `ChartCard`, `StatTile`, `SectionHeader`, `PageShell`, `useDashboardFilters`, `CALL_DURATION_BANDS`, `CUSTOMER_STATES`.
- Produces: `CustomersPage()`.

- [ ] **Step 1: Read the two pages this one is assembled from**

Read `src/features/cohort/CohortPage.tsx` (how `SectionHeader`, `ChartCard`, `CategoryBarList` and `StatTile` are used here, and how a query's `status` reaches a card) and `src/features/logistics/LogisticsPage.tsx` (a page whose blocks sit on the dashboard window). Match their idiom; the code below names the right components but not necessarily the right class names.

- [ ] **Step 2: Write `CallActivitySection`**

Create `src/features/customers/CallActivitySection.tsx`. Its shape:

- `SectionHeader` title «Qoʻngʻiroqlar», hint assembled from the resolved window plus, **only when `data.floorApplied`**, the clause «suhbat davomiyligi 13.09.2026 dan ishonchli».
- Five `StatTile`s: Qoʻngʻiroqlar soni (`unit="count"`), Ulangan (`unit="percent"`, `context` naming the connected count), Suhbat vaqti (`unit="hours"`, `value={total.talkSec / 3600}`), Oʻrtacha suhbat (`unit="duration"`, `value={total.connected === 0 ? null : total.talkSec / total.connected}`), Median suhbat (`unit="duration"`, `value={total.medianSec}`).
- `ChartCard` «Kunlik suhbat vaqti» → `CallTalkChart`.
- `ChartCard` «Suhbat davomiyligi boʻyicha» → two `CategoryBarList`s, `mode="share"` above (calls per band) and `mode="magnitude"` below (talk hours per band), **the same row order in both, the lower panel never re-sorted**.
- `ChartCard` «Operatorlar» → `CallRowTable` with `headLabel="Operator"`.
- `ChartCard` «Komandalar» → `CallRowTable` with `headLabel="Komanda"`, and a `hint` stating that the rows sum to the tiles.
- `ChartCard` «Bitta mijozga qancha qoʻngʻiroq» → `CategoryBarList` over `customerBands`, with `unlinkedCalls` disclosed underneath when it is non-zero.

Each card takes the query's `status`. The section's own comment must record:

```tsx
/**
 * «Qoʻngʻiroqlar» — the telephony block, on the dashboard's window.
 *
 * FIVE TILES AND THE LAST TWO ARE A PAIR. «Oʻrtacha» and «Median» sit side by
 * side because either alone misdescribes this floor: 167 s against 50 s,
 * because 8.4% of calls pass ten minutes and hold 52% of the talk time. The
 * pair is the block's whole claim, and the band card under it is the evidence.
 *
 * THE MEAN TILE IS NULL WHEN NOTHING CONNECTED, never zero — `StatTile`
 * renders `null` as an em dash and zero as a measurement.
 *
 * THE BAND CARD'S TWO PANELS SHARE ONE ROW ORDER. `CategoryBarList` in its
 * two-panel arrangement: share of calls above, talk hours below, and the lower
 * panel is NOT re-sorted. That is the component's stated mechanism and it is
 * exactly what makes «few calls, most of the hours» legible in one glance —
 * re-sorting the lower panel would put the same band in two different rows.
 *
 * THE FLOOR CLAUSE IS CONDITIONAL. It prints only when `floorApplied`, so a
 * reader who asked for a window that is wholly honest is not told about a
 * problem they do not have.
 */
```

- [ ] **Step 3: Write `CustomerFlowSection`**

Create `src/features/customers/CustomerFlowSection.tsx` — the band specified in `2026-09-15-mijozlar-oqimi-design.md` §6, mounted here:

- `SectionHeader` «Mijozlar oqimi», hint «Buyurtma berilgan sana boʻyicha · <meta.period dates>».
- Four `StatTile`s: Yangi mijozlar (hint naming `newCustomersWon`), Qaytgan mijozlar, Faol mijozlar, Takroriy tushum ulushi.
- `ChartCard` «Yangi va qaytgan mijozlar» → `CustomerFlowChart`.
- `ChartCard` «Mijoz qayerdan kelayapti» → `CategoryBarList` `mode="magnitude"` above (new customers per source) and `mode="rate"` below (that source's repeat %), same row order.
- `ChartCard` «Mijozlar holati — bugun» → hand-drawn rows, not a chart: the three `CUSTOMER_STATES` rows, then **Bazada / Bazada yoʻq**. Hint «bugungi holat», because neither figure takes a window.

The section's comment must record why two windows sit on one screen:

```tsx
/**
 * «Mijozlar oqimi» — arrivals, returns, sources and who went quiet.
 *
 * ITS OWN NINETY DAYS, AND THE HEADING SAYS SO. The block above it honours the
 * dashboard control and this one does not, which is the one thing a reader
 * could take for a bug. It is deliberate: `sources[].repeatPercent` is measured
 * on a ninety-day maturity horizon and the state rows are a fact about today,
 * so a window control over them would change the numbers without changing what
 * they mean. `/insights/customers` resolves the span itself and returns it in
 * `meta.period`; this heading prints the dates it actually got.
 *
 * «BAZADA» AND «BAZADA YOʻQ» SUM TO THE BUYER TOTAL. They are a two-way split
 * of buyers, NOT the four-group «База» ladder on `CohortPage` — that one
 * partitions open retention deals by stage and its bars deliberately do not
 * sum. Both are right and neither is the other's total; they are on different
 * screens for that reason.
 */
```

- [ ] **Step 4: Write `CustomersPage`**

Create `src/features/customers/CustomersPage.tsx`:

```tsx
'use client'
```

- `useDashboardFilters()` for the period.
- Two `useQuery`s: `/insights/calls` with the period params (`keepPreviousData`, so a preset switch does not collapse the block to skeletons — copy how `SalesPage` does it), and `/insights/customers` with **no params and a constant key**, because it resolves its own window.
- `PageShell` with `period` on, `title` and `description` from `t.modules.customers`, and `meta` from the calls query's `meta.period`.
- The two sections, calls first.

Record the two-clock discipline on the page:

```tsx
/**
 * «Mijozlar va qoʻngʻiroqlar» — a new section, 2026-09-16.
 *
 * TWO BLOCKS, TWO WINDOWS, AND EACH STATES ITS OWN IN ITS OWN HEADING. That is
 * the discipline this codebase demands of any screen carrying two clocks, and
 * it is why «Savdo dinamikasi» was refused as a home for this: that screen was
 * stripped to one clock on 2026-09-10 precisely so nothing on it could
 * disagree with anything else on it, and re-adding a second would re-add the
 * reconciliation prose with it.
 *
 * They are on one screen because the client asked for one («shu narsalarni
 * qoʻshib ber dashboardga»), and they may never be summed: the call block
 * counts legs in a chosen window, the flow block counts PEOPLE over a fixed
 * ninety days on the order clock.
 *
 * THE FLOW QUERY TAKES NO PARAMS AND ITS KEY IS CONSTANT. `/insights/customers`
 * resolves its own trailing ninety days. A key carrying the dashboard filters
 * would make every preset press a cache miss for an identical answer — and, far
 * worse, would suggest the control reaches it.
 */
```

- [ ] **Step 5: Clean up `CohortPage`**

`src/features/cohort/CohortPage.tsx` carries an uncommitted 5-line change from the previous session: imports of `CategoryBarList`, `CustomerFlowChart`, `CustomerFlowDto`, `CustomerStateRowDto` and `CUSTOMER_AT_RISK_DAYS` that nothing on that page uses. Remove exactly those five added lines, leaving the rest of the file untouched. `git diff src/features/cohort/CohortPage.tsx` must come back empty afterwards.

- [ ] **Step 6: Run the whole gate**

Run: `npm run verify && npm run build`
Expected: both PASS. `npm run db:check` needs a database and the local one is empty — run it if a database is up, and record that it was skipped if not.

- [ ] **Step 7: Commit**

```bash
git add src/features/customers src/features/cohort/CohortPage.tsx
git commit -m "Mount both bands on «Mijozlar va qoʻngʻiroqlar»

Two blocks, two windows, each stating its own in its own heading — the
discipline that made «Savdo dinamikasi» the wrong home for this, since that
screen was stripped to one clock in September precisely so nothing on it could
disagree with anything else on it. The call block honours the dashboard
control; the flow block resolves its own ninety days because its source repeat
rates are measured on a ninety-day horizon and its state rows are a fact about
today.

The five tiles put the mean and the median side by side and the band card under
them is the evidence. The two-panel band cards share one row order, which is
what makes «few calls, most of the hours» readable at a glance.

Also drops the two unused imports the previous session left in CohortPage:
the band they were for is on this screen instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Verify against production, then write it down

**Files:**
- Create: `probe-calls-verify.ts`
- Modify: `CLAUDE.md`, `docs/SUPERDASHBOARD.md`, `docs/API.md`

**Interfaces:**
- Consumes: the finished endpoints.
- Produces: nothing in code.

- [ ] **Step 1: Check the production database is reachable**

Run: `curl -s https://api.ipify.org` and compare against
`doctl databases firewalls list 352cdb7b-53a7-4567-842f-5fee6d852f38`.
If the IP is absent, ask the user to run
`doctl databases firewalls append 352cdb7b-53a7-4567-842f-5fee6d852f38 --rule ip_addr:<ip>` with the `!` prefix — the auto-mode classifier refuses it. Then:

```bash
SP=/tmp/claude-1000/-home-smack-Work/<session>/scratchpad
doctl databases connection 352cdb7b-53a7-4567-842f-5fee6d852f38 --format URI --no-header > $SP/dburi
doctl databases get-ca 352cdb7b-53a7-4567-842f-5fee6d852f38 --no-header > $SP/db-ca.pem
```

Write the probe with the **Write tool, not a heredoc** — a heredoc chained to `git add` and `npx tsx` in one command was refused by the classifier on 2026-09-16. `git add` it immediately: untracked files in this repo get wiped periodically.

- [ ] **Step 2: Check the five invariants the spec names**

The probe must assert, over the period 2026-09-13 → now, and print each as a pass/fail line:

1. `sum(operators[].calls) = total.calls`
2. `sum(teams[].calls) = total.calls` — the one that fails if anybody swaps `employee."departmentId"` for `department_member`
3. `sum(series[].calls) = total.calls`
4. `sum(durationBands[].calls) = total.connected`
5. `inBase + notInBase = states.customers`

Run the same SQL the repository runs — reach the private statement the way the SQL-shape tests do, or copy the statement text. Then **check the day series a second way**: group by `("startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date` and confirm the first and last buckets are Tashkent days, not five-hour-shifted ones. The probes behind the spec used the one-step form and their day boundaries are off; this is where that is corrected.

- [ ] **Step 3: Time the endpoint, not the query**

Sign in against production with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`:

```bash
curl -s -c $SP/jar -X POST https://meridian-61c3bf-77zgw.ondigitalocean.app/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"…","password":"…"}' > /dev/null
curl -s -b $SP/jar -w '\n%{time_total}s\n' \
  'https://meridian-61c3bf-77zgw.ondigitalocean.app/api/v1/insights/calls?preset=this_month' | head -c 400
```

**Time it from the app, cold and warm.** `/payroll/sellers` measured 9–11 s from a local probe and 0.9–1.1 s from the app; the difference was Tashkent-to-fra1 round trips, and that mistake went into `CLAUDE.md` once already. Record both numbers. This step runs **after** the user deploys, so if the branch is unpushed, do Steps 4–5 now and return to this one.

- [ ] **Step 4: Correct the false sentence in `docs/SUPERDASHBOARD.md`**

§6 «Qoʻngʻiroqlar» claims "the recordings are stored and the schema carries
null-ready `transcript` and `score` columns, so a scorer added later reads this
table instead of facing a year-long gap." Replace it:

```markdown
**Not scored, and the recordings are NOT stored.** `recordUrl` is populated on
**0 of 366 300 rows** (measured 2026-09-16) although the importer maps
`CALL_RECORD_URL`, so a call-quality scorer added later faces exactly the gap
this section used to promise it would not. `transcript` and `score` are still
null-ready columns. Whether the portal returns that URL under another field, or
withholds it for this webhook's scopes, is unanswered.
```

Add the duration-truncation window and the floor to the same section, and the `dealId` finding, so the next reader does not re-measure them.

- [ ] **Step 5: Add the screen to `CLAUDE.md`**

Three edits:

1. The heading «The ten screens, and what each one dates by» and its lead paragraph — there are now **eleven** rows in that table and a twelfth screen. Count the rows before writing a number; the file has been wrong about a count before (the «eighteen stages» note).
2. A row in the table:

| Mijozlar va qoʻngʻiroqlar | `/customers` | `customers/CustomersPage` + `CallActivitySection` + `CustomerFlowSection` | `/insights/calls`, `/insights/customers` | Insights → Insights | **two windows, stated separately.** The call block takes the dashboard window on `call_record."startedAt"`, clamped below at `CALL_DATA_FLOOR` (2026-09-13); the flow block resolves its OWN trailing 90 days on `createdAtSource` and its state rows take no window at all |

3. A per-screen trap block under «Per-screen traps worth knowing», carrying: the sixteen truncated days and why; the `dealId` = 1-of-366 300 fact and what it rules out; direction being the leg; the team basis being the primary department; the mean-versus-median measurement; and that `SETTLE_LOOKBACK_MS` is what stops the floor moving again. Also amend the `CALLS` bullet under *The sync pipeline* — it says `call_record` "is written by the sync and read by NOTHING", which stops being true with this work.

- [ ] **Step 6: Note the endpoint in `docs/API.md`**

That file's doc-rot entry in `CLAUDE.md` lists `/insights/calls` among endpoints that no longer exist. Add the endpoint back to `docs/API.md` and correct the `CLAUDE.md` doc-rot bullet so it no longer names `calls`.

- [ ] **Step 7: Commit**

```bash
git add probe-calls-verify.ts CLAUDE.md docs/SUPERDASHBOARD.md docs/API.md
git commit -m "Verify the call block against production, and correct what the docs claim

Five invariants hold on the live data: the operator, team and day arms each sum
to the overall arm, the duration bands sum to the connected count, and the
база split sums to the buyer total. The day series is re-checked with the
two-step timezone conversion, because the probes behind the spec used the
one-step form and their day boundaries were five hours off.

SUPERDASHBOARD §6 said the call recordings are stored. recordUrl is populated on
0 of 366 300 rows, so a scorer added later faces exactly the gap that sentence
promised it would not — corrected, along with the duration window, the floor
and the dealId finding, so the next reader does not measure them again.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of `2026-09-16-mijozlar-va-qongiroqlar-design.md` maps to a task: §2.1 → Tasks 1, 4, 11; §2.2 → Task 4; §2.3 → Task 7; §3 → Task 8; §3.1 → Task 4; §3.2/3.3 → Task 5; §3.4/3.5 → Task 7; §4 → Tasks 1, 3; §5 → Tasks 9, 12; §5.3 → Task 6; §5.4 → Task 9; §6 → the test step of each task plus Task 13; §7/§8 → Task 13's documentation.

**Two things the spec assumed and this plan makes explicit.** The spec put `CALL_SETTLE_MS` in `src/lib/callQuality.ts`; the plan puts it in `SyncEngine.ts` as `SETTLE_LOOKBACK_MS`, beside the watermark policy it belongs to, and `callQuality.ts` keeps only what both sides read. And the spec's probes bucketed days with the one-step `AT TIME ZONE` form — the Global Constraints and Task 4's test pin the two-step form, and Task 13 re-verifies the series.

**Type consistency.** `CallActivityRow`/`CallActivityRows`/`CallBandRow`/`CallCustomerBandRow` are repository types (Tasks 4, 5); `CallRowDto`/`CallDurationBandDto`/`CallCustomerBandDto`/`CallActivityDto` are the wire types (Task 7) and are hand-mirrored in `insightsService.ts` — **nothing checks that mirror**, so edit both sides. `CustomerStateCounts.base` (Task 6) surfaces as `CustomerFlowDto['states'].inBase` / `.notInBase` (Task 7). `formatDuration` (Task 2) is used by `CallRowTable` (Task 11) and by `StatValue`'s `'duration'` unit (Task 2).

**One known gap, deliberate.** There is no service-level test for `callActivity` because no test in this repo touches a database and there is no service harness to copy. Its gate is the SQL-shape test, the component test and Task 13's production invariants — which is how `customerFlow` was verified on this same branch.
