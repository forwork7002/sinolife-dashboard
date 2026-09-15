# Kogorta — the screen a manager can read: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/analytics/cohort` open on a view a manager reads in three
sentences — how many customers arrive, whether they come back, where the money
is — with the full matrix one press away, extended with order counts and
money, and with the dead employee-scope parameter removed.

**Architecture:** Every figure the manager's view needs is already in the
`/insights/cohorts` response; the view is a second rendering of one payload,
not a second query. The statement gains two cheap aggregates (first-return
offsets, order counts) and loses one redundant one, so the curve arrives at
roughly zero net cost on the slowest endpoint in the product. The matrix
itself is ported wholesale from the `kogorta` branch.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 + PostgreSQL 16
(raw SQL via `$queryRawUnsafe`), TanStack Query, Tailwind 4, Vitest +
Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-kogorta-rahbar-design.md`
(builds on `docs/superpowers/specs/2026-09-15-mijoz-qaytishi-one-vocabulary-design.md`)

## Global Constraints

- **Worktree:** `/home/smack/Work/ISH-rahbar`, branch `kogorta-rahbar`, taken
  from `main` at `7bfeaca`. Never run commands from `/home/smack/Work/ISH` —
  another session edits it.
- **The gate is `npm run verify`** (`typecheck && lint && test`) and it must be
  run **on the commit**, not the working tree. After committing:
  `git -C /home/smack/Work/.ish-gate checkout --detach <sha> && cd /home/smack/Work/.ish-gate && npm run verify`.
  A green working tree is evidence about neither the commit nor the deploy.
- **Nothing is pushed.** Commits stay local until the client says «deploy qil».
- **`/sellers` and `/confirmation` are out of bounds.** `insightsRepository.ts`
  holds the confirmation queue's SQL in the same file; every change in this plan
  is confined to the `cohorts()` method and to `src/features/cohort/**`,
  `src/components/charts/Heatmap.tsx`.
- **This plan does NOT touch the stage vocabulary.** `retentionStages()`,
  `customerStates.ts`, `RETENTION_STATE_STAGES` and the «База» card are the
  subject of a separate plan (P1). When porting from `kogorta`, take the
  cumulative-curve half of each diff and leave the `stages` → `groups` half
  alone. Porting `StateBars.tsx` or `retentionGroups.ts` here would introduce
  the two-vocabulary conflict P1 exists to resolve.
- **UI copy is Uzbek (Latin), UZS, `Asia/Tashkent`.** Use `ʻ` (U+02BB) in
  Uzbek words as the rest of the codebase does (`boʻyicha`, `oʻrtacha`).
- **No count that the database produces is written into copy.** Stage counts,
  customer totals and cohort sizes are read at render time.
- **URL state is written shallowly** (`history.replaceState`), never with a
  router push: a full navigation on a filter click costs 521 ms of frozen UI on
  this project, measured.

---

### Task 1: The statement learns first returns and order counts, and forgets a scope it never had

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` — `CohortCell` (155-159), `cohorts()` (925-1129)
- Modify: `src/server/services/insightsService.ts` — `cohorts()` signature and the `options` object (~836-846)
- Test: `tests/http/cohortsSql.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CohortCell` gains `readonly orders: number` and `readonly firstReturners: number`.
  - `InsightsService.cohorts(currency: string, months?: number): Promise<CohortSummaryDto>` — **the third parameter is gone**.

**Why the curve is nearly free.** `returners` currently runs
`count(DISTINCT customer_id)` over the ~180 000-row `purchases` set. The new
`first_return` CTE groups the same filtered set by `(cohort, customer_id)` —
the same one-pass grouping — and `returners` then aggregates its ~11 000-row
output instead. So the statement does the expensive grouping **once** where it
used to do it twice, and the cumulative curve rides along on it. `orders` is
`count(*)` inside a `GROUP BY` that is already running.

- [ ] **Step 1: Write the failing tests**

Append to `tests/http/cohortsSql.test.ts`, inside the existing
`describe('the cohort statement', …)`:

```ts
  it('finds each returning customer’s FIRST return, once', () => {
    /*
      The cumulative curve is a running sum of first returns. Summing the
      monthly cells instead counts a monthly buyer once a month and sends the
      curve past 100%; `min(months_since)` per customer is what walks each
      returning customer in exactly once.
    */
    const sql = code()
    expect(sql).toMatch(/first_return AS \(/i)
    expect(sql).toMatch(/min\(months_since\) AS first_offset/i)
  })

  it('derives the returner headcount from first_return, not from a second DISTINCT', () => {
    /*
      `first_return` already holds one row per returning customer per cohort,
      so counting it is the same answer as `count(DISTINCT customer_id)` over
      `purchases` — and it is the answer this statement has already paid for.
      Doing both would group ~180 000 rows twice to learn one number.
    */
    const returners = code().slice(code().indexOf('returners AS ('))
    expect(returners).toMatch(/FROM first_return/i)
  })

  it('counts orders and customers with DIFFERENT aggregates', () => {
    /*
      A cell says «15 mijoz · 23 ta buyurtma». `count(*)` counts
      revenue-bearing deals, `count(DISTINCT customer_id)` counts people, and
      a cell that blurred them would report a repeat buyer as two customers.
    */
    const rowArm = code().slice(code().indexOf('0 AS is_total'))
    expect(rowArm).toMatch(/count\(\*\)::bigint AS orders/i)
    expect(rowArm).toMatch(/count\(DISTINCT p\.customer_id\)::bigint AS customers/i)
  })

  it('carries the same column list in both UNION arms, in the same order', () => {
    /*
      A UNION ALL matches columns BY POSITION. `ORDER BY 1, 2, 4` is positional
      too. Inserting a column into one arm only would silently transpose the
      whole read rather than fail.
    */
    const sql = code()
    const rowArm = sql.slice(sql.indexOf('0 AS is_total'), sql.indexOf('UNION ALL'))
    const totalsArm = sql.slice(sql.indexOf('1 AS is_total'))
    const aliases = (arm: string) =>
      [...arm.matchAll(/ AS ([a-z_]+),?\n/g)].map((m) => m[1])
    expect(aliases(totalsArm)).toEqual(aliases(rowArm))
  })

  it('narrows by nothing but the month bound — a cohort is a company-wide fact', () => {
    /*
      `InsightsService.cohorts()` used to build an `EmployeeScopeFilter` and
      hand it to a method whose SQL has no employee predicate at all;
      TypeScript missed it because the argument was a variable rather than an
      object literal. It leaked nothing — the route passes no scope — but a
      filter that appears to apply and does not is the one defect this screen
      cannot carry. Deleted rather than implemented: one customer's purchases
      are spread across sellers, so narrowing a retention curve by employee
      produces a figure with no business meaning.
    */
    expect(code()).not.toMatch(/assignee|ownerId|restrictTo|employee/i)
  })
```

Create `tests/services/cohortScope.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The scope parameter that was passed and never read.
 *
 * `cohorts()` built `{ months, restrictToEmployeeIds }` and handed it to a
 * repository method typed `{ months: number }`, whose statement contains no
 * employee predicate. Excess-property checking does not fire on a variable, so
 * this compiled and was silently discarded for as long as it existed.
 *
 * This test pins the DELETION, because the natural repair is to add the
 * parameter back. A cohort is a company-wide fact about a customer: their
 * purchases are spread across sellers and months, so «did this seller's
 * customers come back» is a question about customers that seller no longer
 * owns.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/services/insightsService.ts'),
  'utf8',
)

/** The body of `InsightsService.cohorts`, up to the next method. */
function cohortsMethod(): string {
  const at = SOURCE.indexOf('  async cohorts(')
  expect(at).toBeGreaterThan(-1)
  const next = SOURCE.indexOf('\n  /**', at)
  expect(next).toBeGreaterThan(at)
  return SOURCE.slice(at, next)
}

describe('the cohort service', () => {
  it('takes no employee scope', () => {
    expect(cohortsMethod()).not.toMatch(/EmployeeScopeFilter|restrictToEmployeeIds/)
  })

  it('says why it is unscoped, so it is not re-added as an oversight', () => {
    expect(cohortsMethod()).toMatch(/company-wide|unscoped/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/http/cohortsSql.test.ts tests/services/cohortScope.test.ts
```

Expected: FAIL — the five new SQL cases fail on missing `first_return`,
missing `orders`, and the `employee` match in the service's own comment; both
`cohortScope` cases fail on `EmployeeScopeFilter` still being present.

- [ ] **Step 3: Add the two CTEs and the two columns to the statement**

In `src/server/repositories/insightsRepository.ts`, extend `CohortCell`
(line 155):

```ts
export interface CohortCell {
  readonly monthsSince: number
  readonly customers: number
  /**
   * Revenue-bearing WON deals in this cell — a count of ORDERS, where
   * `customers` is a count of PEOPLE. A repeat buyer makes these differ, and
   * the difference is the useful half: «15 mijoz · 23 ta buyurtma».
   */
  readonly orders: number
  /**
   * Customers whose FIRST return landed on this offset.
   *
   * The cumulative curve is a running sum of these and of nothing else.
   * Summing `customers` would count a monthly buyer once a month and walk the
   * curve past 100%.
   */
  readonly firstReturners: number
  readonly revenueMinor: bigint
}
```

Add the two rows to the raw-row type at the top of `cohorts()`:

```ts
        orders: bigint | null
        first_returners: bigint | null
```

Replace the `returners` CTE and insert the two new ones. The existing block is:

```sql
      returners AS (
        SELECT cohort, count(DISTINCT customer_id) AS returned
          FROM purchases
         WHERE months_since > 0
         GROUP BY cohort
      ),
```

Replace it with:

```sql
      /*
        EACH RETURNING CUSTOMER'S FIRST RETURN, AND THE TWO THINGS BUILT ON IT.

        This replaced a `count(DISTINCT customer_id)` over `purchases` that
        answered only the headcount. Grouping the same filtered set by
        (cohort, customer_id) costs the same single pass and answers three
        questions instead of one: who returned, when they FIRST returned, and
        how many there were. The expensive grouping over ~180 000 rows now
        happens once where it used to happen twice, which is how the
        cumulative curve arrives at no net cost on the slowest endpoint in the
        product.

        A customer who returned in +1 AND +3 is ONE returner, at +1. Summing
        the matrix cells double-counts them; taking only the first cell counts
        only the ones who came back immediately. Measured on this database:
        320 by that reading against 751 who actually returned.
      */
      first_return AS (
        SELECT cohort, customer_id, min(months_since) AS first_offset
          FROM purchases
         WHERE months_since > 0
         GROUP BY cohort, customer_id
      ),
      -- How many of the cohort came back for the first time IN this month.
      -- Tens of rows per cohort; the running sum happens in TypeScript.
      first_offsets AS (
        SELECT cohort, first_offset, count(*)::bigint AS first_returners
          FROM first_return
         GROUP BY cohort, first_offset
      ),
      -- One row per returning customer is already what `first_return` holds,
      -- so counting it IS the distinct count, without grouping 180 000 rows
      -- a second time to learn the same number.
      returners AS (
        SELECT cohort, count(*)::bigint AS returned
          FROM first_return
         GROUP BY cohort
      ),
```

In the **row arm**, add the two columns immediately after `revenue` — position
matters, see Step 1's UNION test:

```sql
        sum(p.amount)::text AS revenue,
        count(*)::bigint AS orders,
        COALESCE(fo.first_returners, 0)::bigint AS first_returners,
```

add the join beneath `LEFT JOIN returners`:

```sql
      LEFT JOIN first_offsets fo
             ON fo.cohort = p.cohort AND fo.first_offset = p.months_since
```

and extend the `GROUP BY`:

```sql
      GROUP BY p.cohort, s.size, p.months_since, r.returned, fo.first_returners
```

In the **totals arm**, add the matching padding after `NULL::text AS revenue`:

```sql
        NULL::bigint AS orders,
        NULL::bigint AS first_returners,
```

Finally, read them in the row loop:

```ts
      entry.cells.push({
        monthsSince: row.months_since,
        customers: int(row.customers),
        orders: int(row.orders),
        firstReturners: int(row.first_returners),
        revenueMinor: money(row.revenue),
      })
```

- [ ] **Step 4: Delete the dead scope parameter**

In `src/server/services/insightsService.ts`, replace the `cohorts` signature
and its `options` object:

```ts
  /**
   * Cohort retention.
   *
   * Retention is expressed against the cohort's own size, so every row starts
   * at 100% by construction and the interesting number is how fast it falls.
   * A month with no repeat buyers reports 0, not null — the absence IS the
   * finding. Null is reserved for offsets that have not happened yet, which is
   * a different statement entirely.
   *
   * DELIBERATELY UNSCOPED, and it used to pretend otherwise. This method built
   * an `EmployeeScopeFilter` and handed it to a repository method whose
   * statement contains no employee predicate of any kind; TypeScript let it
   * through because the argument was a variable rather than an object literal,
   * so the filter was silently discarded for as long as it existed. It leaked
   * nothing — the route passes no scope — but a filter that appears to apply
   * and does not is the one defect a screen valued for its numbers cannot
   * carry.
   *
   * Deleted rather than implemented. A cohort is a company-wide fact about a
   * CUSTOMER: their purchases are spread across sellers and across months, so
   * «did this seller's customers come back» asks about customers that seller
   * no longer owns. There is no honest branch answer to give.
   */
  async cohorts(currency: string, months = 18): Promise<CohortSummaryDto> {
    const [matrix, base] = await Promise.all([
      this.repository.cohorts({ months }),
      this.repository.retentionStages(),
    ])
```

Delete the now-unused `options` object above it. If `EmployeeScopeFilter` is
no longer imported anywhere in the file, leave the import — other methods use
it; `npm run lint` will say so if not.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/http/cohortsSql.test.ts tests/services/cohortScope.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Prove the statement still runs and the new columns are right**

The dev seed is small but it is enough to catch a transposed column. With the
local server on port 3000 and a session cookie (see `local-dev-setup`):

```bash
cd /home/smack/Work/ISH-rahbar
npx tsx -e '
import { PrismaClient } from "./src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const { InsightsRepository } = await import("./src/server/repositories/insightsRepository")
  const repo = new InsightsRepository(prisma, "Asia/Tashkent")
  const m = await repo.cohorts({ months: 18 })
  for (const row of m.rows.slice(0, 3)) {
    const bad = row.cells.filter((c) => c.orders < c.customers)
    console.log(row.cohort, "size", row.size, "returned", row.returned,
      "sum(firstReturners)", row.cells.reduce((a, c) => a + c.firstReturners, 0),
      "cells with orders<customers:", bad.length)
  }
  await prisma.$disconnect()
}
main()
'
```

Expected, for every row: `sum(firstReturners) === returned`, and
`cells with orders<customers: 0`. If the first identity fails the join in
Step 3 is wrong; if the second fails the two aggregates are transposed.

- [ ] **Step 7: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/server/repositories/insightsRepository.ts src/server/services/insightsService.ts tests/http/cohortsSql.test.ts tests/services/cohortScope.test.ts
git commit -m "$(cat <<'EOF'
Ask the cohort statement when each customer FIRST came back

The matrix can say how many bought again in a given month; it could not say
how many had come back by one, which is the curve a reader actually follows.
Monthly repeat purchase runs 0-4% on this portal, so 250 cells land in two
indistinguishable shades; the same customers read cumulatively run 0-37%.

The curve is nearly free because it replaces work rather than adding it.
`returners` ran count(DISTINCT customer_id) over the ~180 000-row purchases
set to learn one number. Grouping that same set by (cohort, customer_id)
costs the same pass and answers three questions -- who returned, when they
first returned, how many -- so the expensive grouping happens once where it
used to happen twice. `orders` is a count(*) inside a GROUP BY already running.

Also deletes a scope parameter that was passed and never read: cohorts() built
an EmployeeScopeFilter and handed it to a method whose SQL has no employee
predicate at all. TypeScript missed it because the argument was a variable,
not an object literal. It leaked nothing -- the route passes no scope -- but a
filter that appears to apply and does not is the one defect this screen cannot
carry. Deleted rather than implemented: one customer's purchases are spread
across sellers, so a per-seller retention curve has no business meaning.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The service ships the cumulative curve and the order counts

**Files:**
- Modify: `src/server/services/insightsService.ts` — `CohortDto` (69-77), the row loop in `cohorts()` (~889-1000)
- Modify: `src/lib/api.ts` — the client-side `CohortDto` mirror (~404-463)
- Test: `tests/services/cohortCumulative.test.ts`

**Interfaces:**
- Consumes: `CohortCell.firstReturners`, `CohortCell.orders` from Task 1.
- Produces, on `CohortDto`:
  - `readonly cumulative: readonly (number | null)[]`
  - `readonly cumulativeCustomers: readonly (number | null)[]`
  - `readonly orders: readonly (number | null)[]`
  - `readonly revenueTotal: MoneyDto` — the cohort's whole revenue
  - `readonly revenuePerCustomer: MoneyDto` — `revenueTotal / size`
  - `readonly ageMonths: number` — alias of `maxOffset`, named for the reader

**The null rule is load-bearing and is not negotiable.** `null` means «this
month has not happened yet». `0` means «measured, and nobody came back». Every
new array nulls in exactly the same positions as `retention` does, which is
`offset > reachable`. A `0` beside a blank cell is the one reading this matrix
must never produce.

- [ ] **Step 1: Write the failing test**

Create `tests/services/cohortCumulative.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { CohortMatrix, InsightsRepository } from '@/server/repositories/insightsRepository'
import { InsightsService } from '@/server/services/insightsService'

/**
 * THE CURVE, AND THE TWO WAYS IT GOES WRONG.
 *
 * A cumulative retention curve is a running sum of FIRST returns. Build it
 * from the monthly headcounts instead and a customer who buys every month is
 * counted every month, so the curve walks past 100%. Carry the running total
 * past the measured horizon and a row's last drawn value stops agreeing with
 * its own «Qaytgan» column, which is the one cross-check the matrix offers a
 * reader.
 */

const cell = (
  monthsSince: number,
  over: Partial<{ customers: number; orders: number; firstReturners: number; revenueMinor: bigint }> = {},
) => ({
  monthsSince,
  customers: over.customers ?? 0,
  orders: over.orders ?? 0,
  firstReturners: over.firstReturners ?? 0,
  revenueMinor: over.revenueMinor ?? 0n,
})

/** One cohort of 10, of whom 4 ever return: 2 in +1, 1 in +2, 1 in +4. */
const MATRIX: CohortMatrix = {
  rows: [
    {
      cohort: '2026-01-01',
      size: 10,
      returned: 4,
      cells: [
        cell(0, { customers: 10, orders: 12, revenueMinor: 1_000n }),
        cell(1, { customers: 2, orders: 2, firstReturners: 2, revenueMinor: 200n }),
        cell(2, { customers: 3, orders: 4, firstReturners: 1, revenueMinor: 400n }),
        cell(3, { customers: 0, orders: 0, firstReturners: 0, revenueMinor: 0n }),
        cell(4, { customers: 1, orders: 1, firstReturners: 1, revenueMinor: 100n }),
      ],
    },
  ],
  totals: {
    customers: 10,
    returned: 4,
    firstRevenueMinor: 1_000n,
    laterRevenueMinor: 700n,
  },
  // June 2026: the cohort has lived five whole months, +0 … +5.
  currentMonth: '2026-06-01',
}

function service(matrix: CohortMatrix): InsightsService {
  const repository = {
    cohorts: async () => matrix,
    retentionStages: async () => ({ stages: [], workedCustomers: 0 }),
  } as unknown as InsightsRepository
  return new InsightsService(repository)
}

describe('the cumulative curve', () => {
  it('walks each returning customer in exactly once', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    // 2 of 10 by +1, 3 by +2, still 3 by +3, 4 by +4.
    expect(rows[0]?.cumulativeCustomers.slice(0, 5)).toEqual([0, 2, 3, 3, 4])
    expect(rows[0]?.cumulative.slice(0, 5)).toEqual([0, 20, 30, 30, 40])
  })

  it('starts at 0, not 100 — nobody has RETURNED in the month they first bought', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    expect(rows[0]?.cumulative[0]).toBe(0)
    expect(rows[0]?.retention[0]).toBe(100)
  })

  it('ends its last MEASURED value on the «Qaytgan» share', async () => {
    /*
      `returned / size` is counted by the database, once per customer. The
      curve is folded in TypeScript. The two must land on the same number or
      the matrix disagrees with its own left-hand column.
    */
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    const row = rows[0]!
    const lastMeasured = row.cumulative[row.maxOffset]
    expect(lastMeasured).toBe(Math.round((row.returned / row.size) * 1000) / 10)
  })

  it('nulls in exactly the same places as the monthly reading', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    const row = rows[0]!
    const nulls = (a: readonly (number | null)[]) => a.map((v) => v === null)
    expect(nulls(row.cumulative)).toEqual(nulls(row.retention))
    expect(nulls(row.cumulativeCustomers)).toEqual(nulls(row.retention))
    expect(nulls(row.orders)).toEqual(nulls(row.retention))
  })

  it('reports a measured month with no returns as 0, never as null', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    // +3 happened and nobody returned in it; +5 has not been reached by data
    // but HAS elapsed, so it is a measured zero too.
    expect(rows[0]?.retention[3]).toBe(0)
    expect(rows[0]?.cumulative[3]).toBe(30)
    expect(rows[0]?.retention[5]).toBe(0)
  })

  it('sums the cohort’s whole revenue and divides it by the cohort', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    const row = rows[0]!
    // 1000 + 200 + 400 + 0 + 100 = 1700 minor units, over 10 customers.
    expect(row.revenueTotal.amount).toBe(1_700)
    expect(row.revenuePerCustomer.amount).toBe(170)
  })

  it('states the cohort’s age, so money-to-date is never compared blind', async () => {
    const { rows } = await service(MATRIX).cohorts('UZS', 18)
    expect(rows[0]?.ageMonths).toBe(5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/services/cohortCumulative.test.ts
```

Expected: FAIL — `cumulative`, `orders`, `revenueTotal`, `revenuePerCustomer`
and `ageMonths` do not exist on `CohortDto`.

- [ ] **Step 3: Extend `CohortDto`**

In `src/server/services/insightsService.ts`:

```ts
export interface CohortDto {
  readonly cohort: string
  readonly size: number
  /** Retention percentage per month offset. Index 0 is the cohort month. */
  readonly retention: readonly (number | null)[]
  /**
   * The share of the cohort that has come back AT LEAST ONCE by each offset.
   *
   * Monotonic by construction — a running sum of first returns over a fixed
   * denominator — and its last measured value is `returned / size`, the figure
   * the «Qaytgan» column prints. That identity is what makes the matrix
   * checkable against its own left-hand column.
   *
   * Index 0 is 0, not 100: nobody has RETURNED in the month they first bought.
   * The monthly array says 100 there, and the two are answering different
   * questions — which is why the screen hides that column in this reading
   * rather than printing a zero beside a hundred.
   */
  readonly cumulative: readonly (number | null)[]
  /** The headcount behind each `cumulative` share, same offsets, same nulls. */
  readonly cumulativeCustomers: readonly (number | null)[]
  readonly customers: readonly (number | null)[]
  /**
   * Revenue-bearing WON deals per offset — ORDERS, where `customers` counts
   * PEOPLE. Same offsets, same nulls. The pair is what lets a cell say
   * «15 mijoz · 23 ta buyurtma» without a third aggregate.
   */
  readonly orders: readonly (number | null)[]
  readonly revenue: readonly MoneyDto[]
  /** Every month of this cohort's money added up — its whole revenue. */
  readonly revenueTotal: MoneyDto
  /**
   * `revenueTotal / size`, and it DOES NOT COMPARE ACROSS ROWS.
   *
   * A thirteen-month-old cohort has had thirteen months to spend and a
   * one-month-old cohort has had one, so ranking rows on this ranks them on
   * age. The screen defends against that with a label («hozirgacha»), with
   * `ageMonths` in every hover, and by greying rows under three months old.
   * Normalising to a fixed horizon was considered and rejected: it would
   * discard the repeat revenue that is the whole subject of the screen.
   */
  readonly revenuePerCustomer: MoneyDto
  /** How many whole months this cohort has lived. Same number as `maxOffset`. */
  readonly ageMonths: number
  readonly maxOffset: number
}
```

- [ ] **Step 4: Fold the curve in the row loop**

Inside `cohorts()`, in the `rows.map(...)` callback, add the accumulators
beside the existing ones:

```ts
      const cumulative: (number | null)[] = []
      const cumulativeCustomers: (number | null)[] = []
      const orders: (number | null)[] = []
      /* Running total of customers who have come back at least once. Reset per
         row, and only ever added to inside the measured span. */
      let everReturned = 0
      let revenueMinor = 0n
```

Inside the `for (let offset = 0; offset <= maxOffset; offset++)` loop, after
the existing `customers.push(...)`:

```ts
        orders.push(offset > reachable ? null : (cell?.orders ?? 0))

        /*
          THE CUMULATIVE CURVE, built from FIRST returns and nothing else.

          `cell.firstReturners` counts customers whose first return landed on
          this offset, so adding them up walks each returning customer in
          exactly once. Adding `cell.customers` instead would count a monthly
          buyer once a month and send the curve past 100%.

          The running total advances only INSIDE the measured span, so a row's
          last drawn value equals `returned / size` — the «Qaytgan» column —
          rather than continuing past the horizon on stale state.
        */
        if (offset <= reachable) everReturned += cell?.firstReturners ?? 0
        cumulative.push(
          offset > reachable
            ? null
            : row.size === 0
              ? 0
              : Math.round((everReturned / row.size) * 1000) / 10,
        )
        cumulativeCustomers.push(offset > reachable ? null : everReturned)

        /* The cohort's WHOLE revenue. The windowed arm bounds `p.cohort`, not
           `p.months_since`, so a cohort that appears in the matrix appears
           with all of its months — summing along the row is complete, not
           partial. The opposite assumption is the natural one and is wrong. */
        revenueMinor += cell?.revenueMinor ?? 0n
```

and extend the returned object:

```ts
      return {
        cohort: row.cohort,
        size: row.size,
        returned: row.returned,
        retention,
        cumulative,
        cumulativeCustomers,
        customers,
        orders,
        revenue,
        revenueTotal: toMoneyDto(money(revenueMinor, currency)),
        revenuePerCustomer: toMoneyDto(
          money(row.size === 0 ? 0n : revenueMinor / BigInt(row.size), currency),
        ),
        ageMonths: reachable,
        maxOffset: reachable,
      }
```

- [ ] **Step 5: Mirror the DTO on the client**

In `src/lib/api.ts`, copy the same five additions onto the client-side
`CohortDto`, keeping the doc comments — the two declarations are read side by
side and a comment that lives on only one of them rots.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/services/cohortCumulative.test.ts
npm run typecheck
```

Expected: all seven cases PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/server/services/insightsService.ts src/lib/api.ts tests/services/cohortCumulative.test.ts
git commit -m "$(cat <<'EOF'
Ship the retention curve, the order counts and each cohort's money

Five additions to CohortDto, all folded from cells the statement already
returns: the cumulative share and the headcount behind it, the per-offset
order count, the cohort's whole revenue and that revenue per customer, and
the cohort's age in months.

The curve is a running sum of FIRST returns, advanced only inside the
measured span, so a row's last drawn value lands on `returned / size` -- the
figure the «Qaytgan» column prints from the database's own count. That
identity is the cross-check the matrix offers a reader and there is a test on
it.

Revenue per customer carries a warning in its own doc comment, because the
column invites exactly the misreading it must not cause: a thirteen-month-old
cohort has had thirteen months to spend. `ageMonths` exists so every hover can
say so. Normalising to a fixed horizon was considered and rejected -- it would
discard the repeat revenue that is the subject of the screen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Port the matrix from the `kogorta` branch

**Files:**
- Overwrite: `src/components/charts/Heatmap.tsx` (from `kogorta`)
- Overwrite: `tests/components/cohortMatrix.test.tsx` (from `kogorta`)
- Modify: `src/features/cohort/CohortPage.tsx` — the matrix section only

**Interfaces:**
- Consumes: `CohortDto.cumulative`, `.cumulativeCustomers` from Task 2.
- Produces:
  - `export type CohortView = 'cumulative' | 'monthly'`
  - `CohortHeatmap` props gain `view: CohortView`, `monthWindow: number | null`.

**What this brings** (already built and browser-verified on `kogorta`): the
cumulative default, the «6 oy / 12 oy / Hammasi» window counted as an offset
rather than a column count, month columns flexing 44–72px with the three
pinned columns fixed, one continuous heat field instead of 250 rounded chips,
a crosshair lighting the hovered row and column, no per-cell «%», «Qaytgan»
printing the share alone, and the legend's cross-check made conditional.

**What this must NOT bring.** `kogorta` also carries `StateBars.tsx`,
`retentionGroups.ts` and the `stages` → `groups` DTO change. Those are the
«База» card and they belong to the P1 plan. Porting them here would put two
stage vocabularies on one screen, which is the exact defect P1 exists to
remove.

- [ ] **Step 1: Take the two files verbatim**

```bash
cd /home/smack/Work/ISH-rahbar
git show kogorta:src/components/charts/Heatmap.tsx > src/components/charts/Heatmap.tsx
git show kogorta:tests/components/cohortMatrix.test.tsx > tests/components/cohortMatrix.test.tsx
```

- [ ] **Step 2: Run the tests to see exactly what the port needs**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/components/cohortMatrix.test.tsx
npm run typecheck
```

Expected: typecheck FAILS in `CohortPage.tsx` — `CohortHeatmap` now requires
`view` and `monthWindow`, which the page does not pass. The component tests
themselves should PASS, since Task 2 shipped the DTO fields they exercise. If
any test fails on `orders` or `revenueTotal` being absent from its fixtures,
add those two fields to the fixture — do not weaken the test.

- [ ] **Step 3: Wire the two controls into the page**

In `src/features/cohort/CohortPage.tsx`, take the matrix section from
`kogorta` — the `view` state, the window state and the two `ButtonToggle`
groups above the grid:

```bash
git show kogorta:src/features/cohort/CohortPage.tsx | sed -n '90,120p;295,340p'
```

Transplant **only** the matrix `ChartCard` and the two `useState` lines it
needs:

```tsx
  const [view, setView] = useState<CohortView>('cumulative')
  const [monthWindow, setMonthWindow] = useState<number | null>(12)
```

Leave the page's «База» section exactly as `main` has it (`data.stages`,
`StageLadder`). It is P1's subject, not this plan's.

- [ ] **Step 4: Run the gate**

```bash
cd /home/smack/Work/ISH-rahbar
npm run verify
```

Expected: typecheck, lint and the full suite all clean.

- [ ] **Step 5: See it in a browser**

Start the worktree's dev server **on port 3000** — `NEXT_PUBLIC_APP_URL` is
`http://localhost:3000` and better-auth rejects any other origin, so a spare
port cannot be signed into. Check 3000 is free first (`ss -ltn | grep 3000`),
and never `pkill -f "next dev"` inside a compound command — the pattern
matches the shell running it.

```bash
cd /home/smack/Work/ISH-rahbar && nohup npx next dev -p 3000 > /tmp/claude-1000/dev.log 2>&1 & disown
```

Sign in and screenshot `/analytics/cohort` in both themes to
`/home/smack/Work/.playwright-mcp/`. Confirm by eye: the grid opens cumulative,
twelve columns, no «%» in a cell, the crosshair tracks, and the hover panel
names a fraction.

- [ ] **Step 6: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/components/charts/Heatmap.tsx tests/components/cohortMatrix.test.tsx src/features/cohort/CohortPage.tsx
git commit -m "$(cat <<'EOF'
Draw the matrix as one heat field, cumulative, twelve months wide

Ported from the `kogorta` branch, where it was built and verified in a browser
on 2026-09-15: the cumulative default with «Oylik» one press away, a month
window counted as an offset rather than a column count, columns that flex
44-72px so a narrowed table still fills its card, one continuous field with
hairline separators instead of 250 rounded chips, a crosshair on the hovered
row and column, and no per-cell «%» now that the column group states the unit.

Monthly repeat purchase runs 0-4% on this portal, so the old reading put ~250
cells into two indistinguishable shades. The same customers read cumulatively
run 0-37%, which is a curve with a shape.

Deliberately NOT ported: StateBars, retentionGroups and the stages -> groups
DTO change, all of which travel with this on `kogorta`. They are the «База»
card, they partition the same sixteen stages under a different key than
main's customerStates does, and reconciling the two is its own plan. Bringing
them here would put two stage vocabularies on one screen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Two money columns, and a guard against the comparison they invite

**Files:**
- Modify: `src/components/charts/Heatmap.tsx` — `CohortMatrixRow`, `PinnedCell`, `panelFor`
- Test: `tests/components/cohortMatrix.test.tsx`

**Interfaces:**
- Consumes: `CohortDto.revenueTotal`, `.revenuePerCustomer`, `.ageMonths`, `.orders` from Task 2.
- Produces: `CohortMatrixRow` gains `revenueTotal: string`, `revenuePerCustomer: string`,
  `ageMonths: number`, `orders: readonly (number | null)[]`.

**The money crosses a formatting boundary here and that is deliberate.** The
DTO carries `MoneyDto` (a minor-unit amount and a currency); `CohortMatrixRow`
carries a formatted `string`. `Heatmap.tsx` is a presentation component and
every other figure on it arrives pre-formatted; giving it a `MoneyDto` would
put currency logic inside a chart. The mapping happens once, in
`CohortPage.tsx`, where `formatUzs` already lives.

**The young-cohort rule:** a cohort with `ageMonths < 3` prints its
per-customer figure greyed, and its hover says it is too young to compare.
Three months is the floor at which the figure stops being mostly noise — the
measured median inter-purchase gap on this portal is 37.5 days, p75 is 73.9,
so under three months most of a cohort has not yet had its second chance.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/cohortMatrix.test.tsx`:

```tsx
  it('prints the cohort’s whole revenue and its per-customer share', () => {
    render(<CohortHeatmap {...base} rows={[row({ cohort: '2025-08-01', size: 24 })]} />)
    expect(screen.getByLabelText(/kogorta tushumi/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/1 mijozga/i)).toBeInTheDocument()
  })

  it('greys a cohort too young to compare on money-to-date', () => {
    /*
      A thirteen-month-old cohort has had thirteen months to spend and a
      one-month-old cohort has had one. A column of figures is an invitation
      to rank them, and ranking them on this ranks them on age -- which reads
      as «new customers are worse», the exact opposite of the finding.
    */
    render(
      <CohortHeatmap
        {...base}
        rows={[row({ cohort: '2026-08-01', size: 3, ageMonths: 1 })]}
      />,
    )
    const cell = screen.getByLabelText(/1 mijozga/i)
    expect(cell).toHaveAttribute('data-young', 'true')
    expect(cell.getAttribute('aria-label')).toMatch(/solishtirib boʻlmaydi|yosh/i)
  })

  it('does not grey a cohort old enough to compare', () => {
    render(
      <CohortHeatmap
        {...base}
        rows={[row({ cohort: '2025-08-01', size: 24, ageMonths: 13 })]}
      />,
    )
    expect(screen.getByLabelText(/1 mijozga/i)).toHaveAttribute('data-young', 'false')
  })

  it('names orders and customers as different things in the hover', async () => {
    const user = userEvent.setup()
    render(<CohortHeatmap {...base} rows={[row({ cohort: '2025-08-01', size: 24 })]} />)
    await user.hover(screen.getAllByRole('gridcell')[3]!)
    expect(await screen.findByText(/ta buyurtma/i)).toBeInTheDocument()
    expect(screen.getByText(/mijoz/i)).toBeInTheDocument()
  })
```

Extend the file's `row()` fixture helper with `ageMonths`, `orders`,
`revenueTotal` and `revenuePerCustomer` defaults.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/components/cohortMatrix.test.tsx
```

Expected: FAIL — the two columns do not exist, `data-young` is absent, the
hover does not mention orders.

- [ ] **Step 3: Add the two pinned columns**

In `src/components/charts/Heatmap.tsx`, extend `CohortMatrixRow`:

```ts
  /** Every month of this cohort's money added up. Pre-formatted for display. */
  readonly revenueTotal: string
  /** `revenueTotal / size`. See `ageMonths` — this does not compare across rows. */
  readonly revenuePerCustomer: string
  /** Whole months this cohort has lived. Under three, the figure above is noise. */
  readonly ageMonths: number
  /** Orders per offset, beside `customers`. Same offsets, same nulls. */
  readonly orders: readonly (number | null)[]
```

Add `MONEY_YOUNG_MONTHS = 3` as a module constant with the measured
justification in its comment, and render two more `PinnedCell`s after
«Qaytgan», the second carrying:

```tsx
data-young={row.ageMonths < MONEY_YOUNG_MONTHS ? 'true' : 'false'}
aria-label={
  row.ageMonths < MONEY_YOUNG_MONTHS
    ? `1 mijozga hozirgacha ${row.revenuePerCustomer} — kogorta ${row.ageMonths} oylik, boshqa qatorlar bilan solishtirib boʻlmaydi`
    : `1 mijozga hozirgacha ${row.revenuePerCustomer} — kogorta ${row.ageMonths} oylik`
}
```

Every sticky `left` offset is a running sum of the pinned column widths, so
adding two columns means updating that sum — the `kogorta` file computes it
from a `PINNED` array; extend the array rather than hand-editing offsets.

- [ ] **Step 4: Put orders into the hover**

In `panelFor`, add one row to each of the three branches:

```ts
        {
          label: 'Buyurtmalar',
          value: `${formatNumber(row.orders[hot.col] ?? 0)} ta`,
        },
```

and, on the per-customer column's own hover, state the cohort's age:

```ts
      footer:
        row.ageMonths < MONEY_YOUNG_MONTHS
          ? `Kogorta ${row.ageMonths} oylik — bu raqamni eski kogortalar bilan solishtirib boʻlmaydi.`
          : `Kogorta ${row.ageMonths} oy davomida shuncha olib kelgan.`,
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/components/cohortMatrix.test.tsx
npm run verify
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/components/charts/Heatmap.tsx tests/components/cohortMatrix.test.tsx
git commit -m "$(cat <<'EOF'
Put the money on the matrix, and defend the comparison it invites

Two pinned columns: the cohort's whole revenue, and that revenue per customer.
Both fold from cells the payload already carries, so neither costs a query.

Per-customer money-to-date does not compare across rows, and a column of
figures is an invitation to compare across rows. August 2025 has had thirteen
months to spend; July 2026 has had one. Ranking them on this ranks them on
age, and it reads as «new customers are worse» -- the exact misreading the
screen exists to prevent. Three defences: the column says «hozirgacha», every
hover states the cohort's age, and a cohort under three months old prints
greyed with a hover that says why. Three months is where the figure stops
being mostly noise -- the median inter-purchase gap here is 37.5 days and p75
is 73.9, so a younger cohort has largely not had its second chance yet.

The hover also separates orders from customers, which the cells always could
have but never said: «15 mijoz · 23 ta buyurtma».

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The mode toggle, in the URL, shallow

**Files:**
- Create: `src/features/cohort/useCohortMode.ts`
- Test: `tests/features/cohortMode.test.ts`

**Interfaces:**
- Produces: `useCohortMode(): { mode: CohortMode; setMode: (m: CohortMode) => void }`
  with `export type CohortMode = 'simple' | 'detail'`.

**Why the URL and not `useState`.** A manager is sent a link to what someone
is looking at. **Why shallow.** A router push re-runs the server component and
froze this product's UI for 521 ms on every filter click; the finding is
settled and the cure is `history.replaceState`.

- [ ] **Step 1: Write the failing test**

Create `tests/features/cohortMode.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useCohortMode } from '@/features/cohort/useCohortMode'

/**
 * The mode is a link, not a preference.
 *
 * It rides in the URL so «look at this» is one paste, and it is written with
 * replaceState rather than a router push because a push re-runs the server
 * component -- 521ms of frozen UI per click, measured on this product.
 */
describe('the cohort mode', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/analytics/cohort')
  })

  it('opens on the manager’s view', () => {
    const { result } = renderHook(() => useCohortMode())
    expect(result.current.mode).toBe('simple')
  })

  it('reads the mode the URL already carries', () => {
    window.history.replaceState(null, '', '/analytics/cohort?mode=detail')
    const { result } = renderHook(() => useCohortMode())
    expect(result.current.mode).toBe('detail')
  })

  it('writes the mode into the URL without navigating', () => {
    const push = vi.fn()
    const { result } = renderHook(() => useCohortMode())
    act(() => result.current.setMode('detail'))
    expect(new URL(window.location.href).searchParams.get('mode')).toBe('detail')
    expect(push).not.toHaveBeenCalled()
  })

  it('drops the parameter again when it returns to the default', () => {
    // A default in the query string is noise in every link that gets shared.
    window.history.replaceState(null, '', '/analytics/cohort?mode=detail')
    const { result } = renderHook(() => useCohortMode())
    act(() => result.current.setMode('simple'))
    expect(new URL(window.location.href).searchParams.has('mode')).toBe(false)
  })

  it('falls back to the default on a value it does not know', () => {
    window.history.replaceState(null, '', '/analytics/cohort?mode=nonsense')
    const { result } = renderHook(() => useCohortMode())
    expect(result.current.mode).toBe('simple')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortMode.test.ts
```

Expected: FAIL — `useCohortMode` does not exist.

- [ ] **Step 3: Write the hook**

Create `src/features/cohort/useCohortMode.ts`:

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Which reading of the cohort screen is on show.
 *
 * `simple` answers the three questions a manager asks — how many customers
 * arrive, do they come back, where is the money — in sentences and shapes.
 * `detail` is the matrix and the bands beneath it. Both read the SAME
 * `/insights/cohorts` response; the toggle is a rendering choice, never a
 * refetch, and never a permission.
 *
 * IT LIVES IN THE URL because a manager is sent a link to what somebody is
 * looking at, and it is written with `replaceState` because a router push
 * re-runs the server component — 521 ms of frozen UI per click on this
 * product, measured. The default is stripped from the query string rather
 * than written into it: a default in a shared link is noise.
 */
export type CohortMode = 'simple' | 'detail'

const DEFAULT_MODE: CohortMode = 'simple'

function read(): CohortMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  const value = new URL(window.location.href).searchParams.get('mode')
  return value === 'detail' || value === 'simple' ? value : DEFAULT_MODE
}

export function useCohortMode(): {
  readonly mode: CohortMode
  readonly setMode: (mode: CohortMode) => void
} {
  const [mode, setLocal] = useState<CohortMode>(DEFAULT_MODE)

  /* The server renders the default; the URL is only readable once mounted, so
     the first paint and the URL are reconciled here rather than during render. */
  useEffect(() => setLocal(read()), [])

  const setMode = useCallback((next: CohortMode) => {
    setLocal(next)
    const url = new URL(window.location.href)
    if (next === DEFAULT_MODE) url.searchParams.delete('mode')
    else url.searchParams.set('mode', next)
    window.history.replaceState(null, '', url.toString())
  }, [])

  return { mode, setMode }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortMode.test.ts
```

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/features/cohort/useCohortMode.ts tests/features/cohortMode.test.ts
git commit -m "$(cat <<'EOF'
Carry the cohort screen's mode in the URL, without navigating

The screen is about to have two readings and a manager is sent a link to the
one somebody is looking at, so the mode belongs in the query string. It is
written with replaceState, not a router push: a push re-runs the server
component and cost this product 521ms of frozen UI per filter click, which is
a settled finding here.

The default is deleted from the URL rather than written into it. A default in
a shared link is noise, and it makes two links to the same view look different.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: «Oddiy», block one — how many new customers arrive

**Files:**
- Create: `src/features/cohort/ArrivalBars.tsx`
- Test: `tests/features/cohortArrivals.test.tsx`

**Interfaces:**
- Consumes: `CohortSummaryDto.rows` (`cohort`, `size`) from the existing payload.
- Produces: `<ArrivalBars rows={...} currentMonth={...} />`.

**The fact this block rests on.** A cohort's `size` IS the count of customers
who made their first delivered purchase in that month. Eighteen of them are
already computed, already shipped, and rendered today as a numeric column
nobody reads as a series. Drawn as one bar per month it is exactly «qancha
yangi mijoz keladi», on the same clock as every other figure on the screen.

**The running month is always short and always a lie.** A customer counts into
a month when their order is *delivered*; the current month is half-lived and
its orders are still in Тасдиклаш and Доставка. It is drawn hatched, labelled
«oy tugamagan», and excluded from the comparison sentence — the same failure
and the same remedy as the record wall's partial period.

- [ ] **Step 1: Write the failing test**

Create `tests/features/cohortArrivals.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ArrivalBars } from '@/features/cohort/ArrivalBars'

/**
 * «Qancha yangi mijoz keladi» — the client's first question, answered from
 * the cohort sizes that were already on the wire.
 */
const rows = [
  { cohort: '2025-07-01', size: 13 },
  { cohort: '2025-08-01', size: 24 },
  { cohort: '2025-09-01', size: 17 },
  { cohort: '2026-08-01', size: 20 },
  { cohort: '2026-09-01', size: 2 },
]

describe('the arrivals block', () => {
  it('draws one bar per month, oldest first', () => {
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)
    const bars = screen.getAllByRole('img', { hidden: true })
    expect(bars).toHaveLength(5)
    expect(bars[0]?.getAttribute('aria-label')).toMatch(/2025/)
  })

  it('marks the running month as unfinished', () => {
    /*
      A customer joins a month when their order is DELIVERED, so the current
      month is half-lived and its bar is always short. Drawn as a finished
      month it reads as a collapse.
    */
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)
    const running = screen.getByLabelText(/2026.*sen.*oy tugamagan/i)
    expect(running).toHaveAttribute('data-partial', 'true')
  })

  it('keeps the running month out of the comparison sentence', () => {
    render(<ArrivalBars rows={rows} currentMonth="2026-09-01" />)
    // August 2026 is the last COMPLETE month: 20 against the mean of the
    // twelve complete months before it — never against September's partial 2.
    expect(screen.getByRole('status').textContent).toMatch(/avgust/i)
    expect(screen.getByRole('status').textContent).not.toMatch(/sentabr/i)
  })

  it('says nothing rather than compare against one month', () => {
    render(
      <ArrivalBars rows={[{ cohort: '2026-09-01', size: 2 }]} currentMonth="2026-09-01" />,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortArrivals.test.tsx
```

Expected: FAIL — `ArrivalBars` does not exist.

- [ ] **Step 3: Write the component**

Create `src/features/cohort/ArrivalBars.tsx`:

```tsx
'use client'

import { InfoTip } from '@/components/ui/Tooltip'
import { formatMonth, formatNumber } from '@/lib/format'

/**
 * «Qancha yangi mijoz keladi?» — the first of the manager's three questions,
 * answered from the column that was already on the wire.
 *
 * A cohort's `size` IS the count of customers who made their first delivered
 * purchase in that month. Eighteen of them ship with every cohort response
 * and were rendered as a narrow numeric column nobody reads as a series.
 *
 * THE RUNNING MONTH IS SHORT BY CONSTRUCTION. A customer joins a month when
 * their order is DELIVERED, so the current month is half-lived and its orders
 * are still sitting in Тасдиклаш and Доставка. Drawn as a finished month it
 * reads as a collapse — the mistake the record wall already made once — so it
 * is hatched, labelled, and kept out of the comparison below.
 */

/** How many complete months the comparison leans on, at most. */
const TREND_MONTHS = 12

/**
 * Fewer than this many complete months behind the last one and the block says
 * nothing. A comparison against a single month is not a trend; it is that
 * month.
 */
const MIN_TREND_MONTHS = 2

export function ArrivalBars({
  rows,
  currentMonth,
}: {
  readonly rows: readonly { cohort: string; size: number }[]
  readonly currentMonth: string
}) {
  const ordered = [...rows].sort((a, b) => a.cohort.localeCompare(b.cohort))
  const max = Math.max(1, ...ordered.map((r) => r.size))

  const complete = ordered.filter((r) => r.cohort < currentMonth)
  const last = complete.at(-1)
  const before = complete.slice(-1 - TREND_MONTHS, -1)
  const mean =
    before.length >= MIN_TREND_MONTHS
      ? before.reduce((sum, r) => sum + r.size, 0) / before.length
      : null

  return (
    <section>
      <h3>
        Qancha yangi mijoz keladi?{' '}
        <InfoTip
          label="Izoh: yangi mijozlar"
          content="Har oyda BIRINCHI marta xarid qilgan mijozlar soni. Mijoz buyurtmasi yetkazilgan oyga tushadi, shuning uchun tugamagan oy har doim past koʻrinadi."
        />
      </h3>

      <div>
        {ordered.map((row) => {
          const partial = row.cohort >= currentMonth
          return (
            <div
              key={row.cohort}
              role="img"
              data-partial={partial ? 'true' : 'false'}
              aria-label={
                partial
                  ? `${formatMonth(row.cohort)}: ${formatNumber(row.size)} ta yangi mijoz — oy tugamagan`
                  : `${formatMonth(row.cohort)}: ${formatNumber(row.size)} ta yangi mijoz`
              }
              style={{
                height: `${Math.round((row.size / max) * 100)}%`,
                /* Colour follows the entity, never its rank (docs/DESIGN.md),
                   and the hatch is the matrix's own «not measured» fill, so
                   the two blocks say the same thing the same way. */
                background: partial
                  ? 'repeating-linear-gradient(45deg, var(--axis) 0 2px, transparent 2px 6px)'
                  : 'var(--series-1)',
              }}
            />
          )
        })}
      </div>

      {mean !== null && last && (
        <p role="status">
          {formatMonth(last.cohort)}da {formatNumber(last.size)} ta yangi mijoz —{' '}
          oldingi {before.length} toʻliq oyning oʻrtachasi {formatNumber(Math.round(mean))} ta
          edi.
        </p>
      )}
    </section>
  )
}
```

The comparison takes the last **complete** month and the complete months
**before** it — `slice(-1 - TREND_MONTHS, -1)` excludes the month being
compared as well as the running one, which is what the third test pins.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortArrivals.test.tsx
```

Expected: PASS, all four cases.

- [ ] **Step 5: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/features/cohort/ArrivalBars.tsx tests/features/cohortArrivals.test.tsx
git commit -m "$(cat <<'EOF'
Answer «qancha yangi mijoz keladi» from data already on the wire

A cohort's `size` IS the count of customers who first bought that month.
Eighteen of them ship with every cohort response and were rendered as a narrow
numeric column nobody reads as a series. One bar per month turns the column
the client asked about into the picture they asked for, with no new endpoint,
no new query and no second scan of the slowest read in the product.

The running month is hatched and labelled «oy tugamagan», and it is kept out
of the comparison sentence. A customer joins a month when their order is
DELIVERED, so the current month is half-lived by construction and its bar is
always short -- drawn as a finished month it reads as a collapse, which is the
mistake the record wall already made once.

With fewer than two complete months behind it the block prints no sentence at
all. A comparison against a single month is not a trend; it is that month.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: «Oddiy», block two — do they come back

**Files:**
- Create: `src/features/cohort/ReturnAnswer.tsx`
- Test: `tests/features/cohortReturnAnswer.test.tsx`

**Interfaces:**
- Consumes: `CohortSummaryDto.repeatCustomers`, `.totalCustomers`, `.rows[].cumulative`,
  and — **critically** — `columnAverage` from `src/components/charts/Heatmap.tsx`.
- Produces: `<ReturnAnswer data={summary} />`. **No averaging function of its own.**

**THERE IS ONE AVERAGING IMPLEMENTATION AND THIS TASK DOES NOT WRITE A SECOND
ONE.** `columnAverage` already exists in the ported `Heatmap.tsx` (Task 3) and
draws the grid's own summary row. Export it — and its `ColumnAverage` type —
and call it here. Writing a fresh mean for the manager's milestones is the one
thing the whole design forbids: two renderings of one payload would then be
free to disagree, and they would, because the existing average is **weighted by
cohort size** and a hand-written mean almost certainly would not be.

**The averaging rules, all three already encoded in `columnAverage`:**

1. Weighted by cohort size. An unweighted mean of percentages lets a 40-person
   month outvote a 400-person one.
2. Over the cohorts that have **reached** that offset. A cohort two months old
   has no opinion about month +4, and averaging its null as a zero drags every
   long-horizon column toward zero until retention looks like it collapses
   with age.
3. `cohorts` is returned beside the percentage, because the claim is only as
   wide as that number.

This task adds only the **floor**: a milestone whose `cohorts` is under three
prints «yetarli maʼlumot yoʻq» instead of a figure. The `+12` column once had
one qualifying cohort and printed its number as the company average; the
commit that fixed it in the grid is `Stop the cohort summary row painting a
sample of one`, and the manager's view must not reintroduce it.

**The headline denominator is whole-history.** `repeatCustomers /
totalCustomers` comes from the totals arm, which reads every cohort there has
ever been. Folding it from the windowed rows silently deletes the oldest loyal
customers — exactly the repeat business the figure exists to measure — and it
did, once.

- [ ] **Step 1: Write the failing test**

Create `tests/features/cohortReturnAnswer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { columnAverage } from '@/components/charts/Heatmap'
import { ReturnAnswer } from '@/features/cohort/ReturnAnswer'

/**
 * The milestones are the grid's own column averages, read through the grid's
 * own function. Anything this file asserts about the numbers is really an
 * assertion about `columnAverage`; what it asserts about ReturnAnswer is that
 * it calls it, states its width, and refuses to speak when that width is one.
 */
const row = (
  cohort: string,
  size: number,
  cumulative: (number | null)[],
  cumulativeCustomers: (number | null)[],
) => ({ cohort, size, cumulative, cumulativeCustomers, retention: cumulative, customers: cumulativeCustomers })

/** Two cohorts of very different size, so a weighted mean is distinguishable. */
const BIG = row('2025-01-01', 100, [0, 20, 30, 40], [0, 20, 30, 40])
const SMALL = row('2026-07-01', 10, [0, 50, 60, null], [0, 5, 6, null])

describe('the return answer', () => {
  const data = {
    repeatCustomers: 159,
    totalCustomers: 203,
    rows: [
      row('2025-01-01', 24, [0, 18, 28, 37, 45, 51, 56], [0, 4, 7, 9, 11, 12, 13]),
      row('2025-02-01', 17, [0, 18, 28, 37, 45, 51, 56], [0, 3, 5, 6, 8, 9, 10]),
      row('2025-03-01', 15, [0, 18, 28, 37, 45, 51, 56], [0, 3, 4, 6, 7, 8, 8]),
    ],
  }

  it('states the answer as a sentence, on the whole-history denominator', () => {
    /*
      159 / 203 = 78.3%. It comes from the totals arm, which counts every
      cohort there has ever been — folding it from the windowed rows deletes
      the oldest loyal customers, and it did exactly that once.
    */
    render(<ReturnAnswer data={data} />)
    expect(screen.getByRole('status').textContent).toMatch(/100.*78/)
  })

  it('prints the grid’s own average, weighted by cohort size', () => {
    /*
      The single most likely regression in this task is a hand-written mean.
      Unweighted, +1 over BIG and SMALL is (20 + 50) / 2 = 35. Weighted, which
      is what `columnAverage` does and what the grid draws, it is
      (20 + 5) / (100 + 10) = 22.7. If this asserts 35, the manager's view has
      grown a second implementation.
    */
    render(<ReturnAnswer data={{ ...data, rows: [BIG, SMALL] }} />)
    const expected = columnAverage([BIG, SMALL], 1, 'cumulative').percent!
    expect(expected).toBeCloseTo(22.7, 1)
    expect(screen.getByLabelText(/\+1 oy/i).textContent).toMatch(/22[.,]7/)
  })

  it('refuses to print a milestone averaged over fewer than three cohorts', () => {
    /*
      The +12 column once had one qualifying cohort and printed its number as
      the company average. A sample of one is not an average.
    */
    const long = row(
      '2025-01-01',
      24,
      [0, 18, 28, 37, 45, 51, 56, 60, 64, 68, 72, 76, 85],
      [0, 4, 7, 9, 11, 12, 13, 14, 15, 16, 17, 18, 20],
    )
    render(<ReturnAnswer data={{ ...data, rows: [long] }} />)
    expect(screen.getByLabelText(/\+12 oy/i).textContent).toMatch(/yetarli maʼlumot yoʻq/i)
  })

  it('says how many cohorts each milestone averages', () => {
    render(<ReturnAnswer data={data} />)
    expect(screen.getByLabelText(/\+3 oy/i).getAttribute('aria-label')).toMatch(/3 ta kogorta/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortReturnAnswer.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Export the grid's average, then write the component**

First, in `src/components/charts/Heatmap.tsx`, change two declarations from
private to exported — nothing else:

```ts
export interface ColumnAverage {
export function columnAverage(
```

Then create `src/features/cohort/ReturnAnswer.tsx`:

```tsx
'use client'

import { Sparkline } from '@/components/charts/Sparkline'
import { columnAverage, type CohortMatrixRow } from '@/components/charts/Heatmap'
import { InfoTip } from '@/components/ui/Tooltip'
import { formatPercent } from '@/lib/format'

/**
 * «Ular qaytadimi?» — the second of the manager's three questions.
 *
 * ONE AVERAGING IMPLEMENTATION, AND IT IS THE GRID'S. `columnAverage` draws
 * the matrix's own summary row; this block calls it rather than computing a
 * mean of its own, because two renderings of one payload that average
 * separately are two renderings free to disagree. The existing average is
 * weighted by cohort size, and a hand-written one almost certainly would not
 * be — a 40-person month would outvote a 400-person one.
 */
const MILESTONES = [1, 3, 6, 12] as const

/**
 * Below this many cohorts a milestone prints no figure.
 *
 * The +12 column once had exactly one qualifying cohort and printed that
 * cohort's number as the company average. A sample of one is not an average,
 * and the manager is the reader least equipped to notice.
 */
const MIN_COHORTS_FOR_AVERAGE = 3

export function ReturnAnswer({
  data,
}: {
  readonly data: {
    readonly repeatCustomers: number
    readonly totalCustomers: number
    readonly rows: readonly CohortMatrixRow[]
  }
}) {
  const share =
    data.totalCustomers === 0
      ? null
      : Math.round((data.repeatCustomers / data.totalCustomers) * 1000) / 10

  /* The curve's full width, for the sparkline. The milestones below read the
     same function at four offsets, so the shape and the figures cannot drift. */
  const width = Math.max(0, ...data.rows.map((r) => r.cumulative.length))
  const curve = Array.from({ length: width }, (_, offset) =>
    columnAverage(data.rows, offset, 'cumulative'),
  )

  return (
    <section>
      <h3>
        Ular qaytadimi? <InfoTip label="Izoh: qaytish" content="Birinchi marta xarid qilgan mijozlarning qanchasi keyin yana xarid qilgan. Yetkazilgan sana boʻyicha, butun tarix." />
      </h3>

      {share !== null && (
        <p role="status">
          Har 100 ta yangi mijozdan <strong>{Math.round(share)}</strong> tasi keyin
          yana xarid qiladi.
        </p>
      )}

      <Sparkline values={curve.map((c) => c.percent ?? 0)} />

      <dl>
        {MILESTONES.map((offset) => {
          const at = curve[offset]
          const enough = (at?.cohorts ?? 0) >= MIN_COHORTS_FOR_AVERAGE
          return (
            <div
              key={offset}
              aria-label={`+${offset} oy — ${at?.cohorts ?? 0} ta kogorta boʻyicha`}
            >
              <dt>+{offset} oy</dt>
              <dd>
                {enough && at?.percent !== null && at !== undefined
                  ? formatPercent(Math.round(at.percent * 10) / 10)
                  : 'yetarli maʼlumot yoʻq'}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
```

Check `Sparkline`'s actual prop name before wiring it
(`grep -n 'export function Sparkline' -A 10 src/components/charts/Sparkline.tsx`)
and match it; do not add a prop to `Sparkline` for this.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortReturnAnswer.test.tsx
npm run verify
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/components/charts/Heatmap.tsx src/features/cohort/ReturnAnswer.tsx tests/features/cohortReturnAnswer.test.tsx
git commit -m "$(cat <<'EOF'
Say whether customers come back in one sentence, and refuse a sample of one

«Har 100 ta yangi mijozdan 78 tasi keyin yana xarid qiladi» is the figure that
decides whether the retention desk is worth funding, and it was previously a
gauge among four tiles with no sentence attached. It reads from the totals
arm, which counts every cohort there has ever been -- folding it from the
windowed rows deletes the oldest loyal customers, which is the repeat business
the figure exists to measure, and it did exactly that once.

The curve beside it averages only the cohorts that have REACHED each offset.
A cohort two months old has no opinion about month +4, and averaging its null
as a zero drags every long-horizon column down until retention looks like it
collapses with age. Each milestone states how many cohorts it averages, and a
milestone backed by fewer than three prints «yetarli maʼlumot yoʻq» instead of
a figure -- the +12 column once had one qualifying cohort and printed its
number as the company average.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: «Oddiy», block three — where the money comes from, and the two modes wired together

**Files:**
- Create: `src/features/cohort/SimpleView.tsx`
- Modify: `src/features/cohort/CohortPage.tsx`
- Test: `tests/features/cohortSimpleMode.test.tsx`

**Interfaces:**
- Consumes: `ArrivalBars` (Task 6), `ReturnAnswer` (Task 7), `useCohortMode` (Task 5).
- Produces: `<SimpleView data={summary} />`.

**One fetch, two renderings.** `CohortPage` keeps its single
`useQuery(['cohorts'])`. `SimpleView` and the existing detail sections both
read `query.data.data`. Switching modes must not produce a loading state, a
refetch or a second query key — that is the property that makes the two views
unable to disagree.

**One mapping, too.** `CohortPage` already maps `CohortDto[]` into
`CohortMatrixRow[]` for the grid (this is where `MoneyDto` becomes a formatted
string, Task 4). Do that mapping **once**, above the mode switch, and hand the
same array to both `CohortHeatmap` and `ReturnAnswer`. Mapping separately per
mode is how two renderings of one payload start to differ despite sharing a
fetch — `columnAverage` reads `size` and `cumulativeCustomers` off these rows,
so it must be reading the grid's own rows, not a parallel construction of
them.

- [ ] **Step 1: Write the failing test**

Create `tests/features/cohortSimpleMode.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { SimpleView } from '@/features/cohort/SimpleView'

const data = {
  rows: [
    { cohort: '2025-08-01', size: 24, cumulative: [0, 21, 29, 38, 54, 63, 67] },
    { cohort: '2025-09-01', size: 17, cumulative: [0, 18, 35, 35, 41, 41, 53] },
    { cohort: '2025-10-01', size: 15, cumulative: [0, 13, 27, 33, 47, 47, 60] },
  ],
  repeatCustomers: 159,
  totalCustomers: 203,
  repeatRevenueShare: 65.2,
  currentMonth: '2026-09-01',
  revenuePerCustomerAll: { amount: 1_250_000, currency: 'UZS' },
}

describe('the manager’s view', () => {
  it('answers the three questions, in order', () => {
    render(<SimpleView data={data} />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings[0]).toMatch(/yangi mijoz/i)
    expect(headings[1]).toMatch(/qayt/i)
    expect(headings[2]).toMatch(/pul/i)
  })

  it('states the repeat revenue share as a sentence, not a gauge', () => {
    render(<SimpleView data={data} />)
    expect(screen.getByText(/65[.,]2/)).toBeInTheDocument()
    expect(screen.getByText(/keyingi xaridlar/i)).toBeInTheDocument()
  })

  it('labels the per-customer figure as money SO FAR', () => {
    /*
      Whole-history average revenue per customer is honest as ONE number, and
      the word «hozirgacha» is what stops it being read as a settled lifetime
      value for a business that is still running.
    */
    render(<SimpleView data={data} />)
    expect(screen.getByText(/hozirgacha/i)).toBeInTheDocument()
  })

  it('names its clock, so two honest customer totals do not look like a bug', async () => {
    /*
      This screen prints 11 517 customers and, once the arrival band lands,
      15 876. Both are correct on their own clock. Unlabelled, one of them
      reads as broken -- and the manager is the reader most likely to meet
      them side by side.
    */
    render(<SimpleView data={data} />)
    expect(screen.getByText(/yetkazilgan sana boʻyicha/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortSimpleMode.test.tsx
```

Expected: FAIL — `SimpleView` does not exist.

- [ ] **Step 3: Write `SimpleView` and wire the modes**

`SimpleView` composes `ArrivalBars`, `ReturnAnswer` and a money block of two
sentences:

```tsx
/* «Tushumning 65.2% i — mijozning birinchi emas, keyingi xaridlaridan.» */
/* «Bir mijoz hozirgacha oʻrtacha 1 250 000 soʻm olib kelgan.» */
```

Add `revenuePerCustomerAll` to `CohortSummaryDto` in
`src/server/services/insightsService.ts` and `src/lib/api.ts` —
`(firstRevenue + laterRevenue) / totalCustomers`, computed in the same place
`repeatRevenueShare` already is, so the two cannot be built from different
reads.

In `CohortPage.tsx`, take the mode from `useCohortMode()`, render the toggle
in the page header, and switch between `<SimpleView data={data} />` and the
existing sections. Keep the single `useQuery`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortSimpleMode.test.tsx
npm run verify
```

Expected: PASS.

- [ ] **Step 5: See both modes in a browser**

With the dev server on port 3000, screenshot `/analytics/cohort` and
`/analytics/cohort?mode=detail` in both themes. Confirm switching modes shows
**no loading skeleton** — if it does, the single-fetch property has been lost.

- [ ] **Step 6: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/features/cohort/SimpleView.tsx src/features/cohort/CohortPage.tsx src/server/services/insightsService.ts src/lib/api.ts tests/features/cohortSimpleMode.test.tsx
git commit -m "$(cat <<'EOF'
Open the cohort screen on the manager's three questions

«bu kagorta rahbar uchun» -- so the screen opens on how many customers arrive,
whether they come back, and where the money is, in that order, in sentences
and shapes. The matrix is one press away and loses nothing.

Both modes read the SAME useQuery(['cohorts']) result. Switching shows no
loading state and issues no request, which is not a convenience: it is the
property that makes the two views unable to disagree about the same customers.
A second endpoint for the manager's view would also have doubled the most
expensive read in the product -- 1587ms p50 -- to display numbers that were
already in the first response.

Repeat revenue share stops being a gauge among four tiles and becomes the
sentence it always was. Revenue per customer says «hozirgacha», because a
lifetime value for a business that is still running is a figure to date.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The screen explains itself

**Files:**
- Modify: `src/features/cohort/CohortPage.tsx` — section headers and hints
- Modify: `src/features/cohort/SimpleView.tsx` — `InfoTip` per block
- Test: `tests/features/cohortExplains.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: no new exports.

**This replaces the explainer document rather than shrinking it.** A separate
page was offered three ways and declined: «Faqat ilova ichida — alohida sahifa
kerak emas». So every explanation is placed where its number is.

Each `InfoTip` answers «this block answers which question», never «this block
is a cohort analysis». The rule for the copy: name the denominator, name the
clock, and use no word the floor does not use.

- [ ] **Step 1: Write the failing test**

Create `tests/features/cohortExplains.test.tsx` asserting that every block
carries a clock in words and an `InfoTip`, and that the gap between the two
customer totals is stated once as a fact:

```tsx
  it('states the two customer totals as two clocks, not as a contradiction', () => {
    render(<CohortPage />, { wrapper })
    const hint = screen.getByTestId('cohort-total-hint').textContent ?? ''
    expect(hint).toMatch(/yetkazilgan/i)
    expect(hint).toMatch(/buyurtma berilgan/i)
  })

  it('gives every block a tip that names its question', () => {
    render(<CohortPage />, { wrapper })
    for (const tip of screen.getAllByRole('button', { name: /izoh/i })) {
      expect(tip.getAttribute('aria-label')).not.toMatch(/kogorta tahlili|retention/i)
    }
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortExplains.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Write the copy**

In `src/features/cohort/CohortPage.tsx`, give every `SectionHeader` its clock
and its tip. The three headers become:

```tsx
<SectionHeader
  title="Kogorta tahlili"
  hint="Yetkazilgan sana boʻyicha · butun tarix"
  action={
    <InfoTip
      label="Izoh: kogorta tahlili"
      content="Mijoz birinchi buyurtmasi YETKAZILGAN oyga biriktiriladi va oʻsha oydan chiqmaydi. Quyidagi raqamlar butun tarixni sanaydi."
    />
  }
/>

<SectionHeader
  title="Kogorta matritsasi"
  hint="Har qator — bir oyda birinchi marta xarid qilgan mijozlar guruhi"
  action={
    <InfoTip
      label="Izoh: matritsa"
      content="Qator — mijozlar guruhi, ustun — birinchi xariddan keyin oʻtgan oylar. Katak: shu oyga kelib guruhning qancha qismi qaytgan."
    />
  }
/>

<SectionHeader
  title="Mijozlar kontsentratsiyasi"
  hint={concentrationCaption}
  action={
    <InfoTip
      label="Izoh: kontsentratsiya"
      content="Tanlangan davrda yutilgan bitimlar boʻyicha — yuqoridagi bloklardan farqli oʻlaroq, bu davr filtriga ergashadi."
    />
  }
/>
```

Add the hint that reconciles the two totals, directly beneath the tile row:

```tsx
{/*
  TWO HONEST TOTALS, STATED AS TWO CLOCKS.

  The tiles count every customer there has ever been; the grid draws the last
  `months` of them. And once the arrival band lands this screen will print a
  delivery-clock total a few centimetres from an order-clock one — 11 517
  beside 15 876 when last measured. Both are correct. Unlabelled, one of them
  reads as broken, and the manager is the reader most likely to meet them side
  by side and conclude the screen is wrong.
*/}
<p data-testid="cohort-total-hint">
  Yuqoridagi raqamlar <strong>yetkazilgan sana</strong> boʻyicha va butun
  tarixni sanaydi; quyidagi jadval esa shu tarixning oxirgi qismini chizadi.
  Buyurtma <strong>berilgan sana</strong> boʻyicha sanaganda mijozlar soni
  boshqacha chiqadi — ikkalasi ham toʻgʻri, soati boshqa.
</p>
```

If `SectionHeader` has no `action` slot, put the `InfoTip` inside `title` as a
sibling element rather than adding a prop — check its signature first
(`grep -n 'export function SectionHeader' -A 20 src/components/ui/Stat.tsx`).

In `SimpleView.tsx`, each of the three `<h3>` headings already carries its own
`InfoTip` from Tasks 6 and 7; add the third for the money block.

Write no number into the copy. Every figure interpolates from `data`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortExplains.test.tsx
npm run verify
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/smack/Work/ISH-rahbar
git add src/features/cohort/CohortPage.tsx src/features/cohort/SimpleView.tsx tests/features/cohortExplains.test.tsx
git commit -m "$(cat <<'EOF'
Put the explanation where the number is, since nobody reads a manual

A separate explainer was offered as a page, as a panel and as a repo document,
and declined: «Faqat ilova ichida — alohida sahifa kerak emas». So every block
now names its own clock and its own denominator in words, and carries one tip
that says which question it answers rather than what kind of analysis it is.

The load-bearing line is the one about the two customer totals. This screen
prints a whole-history figure beside a windowed grid, and once the arrival
band lands it will print 11 517 customers a few centimetres from 15 876. Both
are correct on their own clock; unlabelled, one of them reads as broken, and
the manager is the reader most likely to meet them side by side.

No count that the database produces is written into copy. The portal added a
nineteenth Доставка stage on 2026-09-10 and a number in prose goes stale in
silence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Verify against production, then write it down

**Files:**
- Create: `probe-kogorta.ts` (throwaway, deleted in this task's final step)
- Modify: `CLAUDE.md` — the Mijoz qaytishi row and section
- Test: `tests/features/cohortAgreement.test.tsx`

**Interfaces:** consumes everything above; produces no exports.

**The seed cannot answer these questions.** The dev database holds 1 600 deals
and 203 customers against production's ~448 000 and 11 517; a plan shape that
looks fine on it has already been measured wrong on this endpoint once. Read
production directly with the `doctl` + CA + strip-`sslmode` recipe.

- [ ] **Step 1: Write the agreement test**

Task 7 already asserts the milestones equal `columnAverage`. What is left to
guard is the thing a future edit would do: grow a second implementation. That
cannot be caught by comparing two numbers — if both come from one function
they always match — so it is caught structurally, in the source.

Create `tests/features/cohortAgreement.test.tsx`:

```tsx
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { columnAverage, type CohortMatrixRow } from '@/components/charts/Heatmap'
import { ReturnAnswer } from '@/features/cohort/ReturnAnswer'

/**
 * ONE PAYLOAD, TWO RENDERINGS, AND THEY MAY NOT DISAGREE.
 *
 * This is the property the whole design rests on: «Oddiy» and «Batafsil» read
 * the same response, so a manager and an analyst looking at the same screen
 * cannot come away with different numbers. It holds only while there is ONE
 * averaging function, which is why the second case reads the source.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/features/cohort/ReturnAnswer.tsx'),
  'utf8',
)

const rows: CohortMatrixRow[] = [
  /* Deliberately uneven sizes: a weighted and an unweighted mean differ here,
     so a second implementation shows up as a wrong figure rather than a tie. */
  { cohort: '2025-08-01', size: 240, cumulative: [0, 21, 29, 38], cumulativeCustomers: [0, 50, 70, 91], retention: [100, 21, 29, 38], customers: [240, 50, 70, 91] } as CohortMatrixRow,
  { cohort: '2026-06-01', size: 12, cumulative: [0, 75, null, null], cumulativeCustomers: [0, 9, null, null], retention: [100, 75, null, null], customers: [12, 9, null, null] } as CohortMatrixRow,
]

describe('the two readings of one payload', () => {
  it('shows the manager the figure the grid draws, not a mean of percentages', () => {
    // Weighted: (50 + 9) / (240 + 12) = 23.4%. Unweighted: (21 + 75) / 2 = 48%.
    const grid = columnAverage(rows, 1, 'cumulative').percent!
    expect(grid).toBeCloseTo(23.4, 1)
    render(<ReturnAnswer data={{ repeatCustomers: 59, totalCustomers: 252, rows }} />)
    expect(screen.getByLabelText(/\+1 oy/i).textContent).toMatch(/23[.,]4/)
  })

  it('computes no average of its own', () => {
    /*
      The regression this guards is a future edit folding a quick mean inline
      rather than importing the grid's. Two functions would agree on the day
      they were written and drift on the first change to either.
    */
    expect(SOURCE).toContain('columnAverage')
    expect(SOURCE).not.toMatch(/reduce\([^)]*\/\s*(rows|arr|list)\.length/)
  })
})
```

- [ ] **Step 2: Run it, and make it pass**

```bash
cd /home/smack/Work/ISH-rahbar
npx vitest run tests/features/cohortAgreement.test.tsx
```

If the rendered figure is 48 rather than 23.4, `ReturnAnswer` has grown its
own mean. **The fix is to delete it and call `columnAverage`**, never to
reconcile two implementations.

- [ ] **Step 3: Probe production for the invariants**

Write `probe-kogorta.ts` against the production connection string and check,
printing each with its measured value:

| Invariant | Expected |
|---|---|
| Σ cohort sizes over **every** cohort (unbounded) | = `totals.customers` |
| Σ per-cohort revenue over **every** cohort | = `firstRevenue + laterRevenue` |
| Per cell `orders ≥ customers` | zero violations |
| Per row `Σ firstReturners` | = `row.returned` |
| Per row, last measured `cumulative` | = `round(returned / size * 1000) / 10` |
| `cohorts()` p50 latency, 5 runs | **≤ 1587 ms**, the pre-change baseline |

The latency row is a **gate, not a note**. Task 1 argues the curve is free
because it replaces a grouping rather than adding one; if the measurement
disagrees, that argument was wrong and the `first_offsets` CTE is the thing to
reconsider.

The two Σ rows are run as **unbounded** queries, not read off the rendered
grid — `months` bounds which cohorts are drawn and the totals arm carries no
such bound, so summing the eighteen visible rows and expecting «Jami mijozlar»
is a misreading of the screen, not a failing invariant.

- [ ] **Step 4: Screenshot both modes on production data**

Sign in against production and capture `/analytics/cohort` and
`?mode=detail`, both themes, into `/home/smack/Work/.playwright-mcp/`.
Production is the only place the real roster and the real spread exist.

A **skeleton-only screenshot is the edge, not the code** — HTTP/2 stream
refusals produce that on this deployment. Retry before investigating.

- [ ] **Step 5: Write it down in CLAUDE.md**

Update the Mijoz qaytishi row of the screen table and its section beneath with:
the two modes and that they share one fetch; the `closedAt` clock; that
`cohorts()` is deliberately unscoped and why; the cumulative curve's identity
with the «Qaytgan» column; the three-month floor on per-customer money; and
the measured duplicate-identity gap (39 of 11 517, 0.34%) as a stated limit.

Record the latency measured in Step 3 beside the 1587 ms baseline.

- [ ] **Step 6: Delete the probe and commit**

```bash
cd /home/smack/Work/ISH-rahbar
rm probe-kogorta.ts
git add CLAUDE.md tests/features/cohortAgreement.test.tsx
git commit -m "$(cat <<'EOF'
Verify the cohort screen against production, and record what it now promises

The dev seed holds 1 600 deals against production's ~448 000, and this is the
endpoint where that gap has already produced a wrong answer once -- a rewrite
that halved the buffers on the seed ran 48% slower in production. So every
invariant here was measured against the live database, including the latency:
Task 1 argues the retention curve is free because it replaces a grouping
rather than adding one, and that argument is only as good as its measurement.

The agreement test is the one that matters. The manager's milestones and the
grid's summary row are asserted to be the same numbers, from one averaging
implementation, because two renderings of one payload disagreeing is the exact
failure the whole design exists to prevent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Run the gate on the commit, not the tree**

```bash
git -C /home/smack/Work/.ish-gate checkout --detach $(git -C /home/smack/Work/ISH-rahbar rev-parse HEAD)
cd /home/smack/Work/.ish-gate && npm run verify
```

Expected: clean. A green working tree is evidence about neither the commit nor
the deploy — this distinction cost a failed build on 2026-09-11.

---

## What this plan deliberately leaves

* **P1, the one stage vocabulary** — `retentionStages.ts`, the «База» card,
  `customerStates.ts`. Its own plan, and the prerequisite for ever porting
  `StateBars` from `kogorta`.
* **The «Mijozlar oqimi» band** — `main`'s own nine-task plan, tasks 5–9
  unbuilt. Task 6 here answers the arrival question from the cohort payload on
  the delivery clock; that band answers it on the order clock and by source.
* **The customer list** («kim yangi, kim eski») — P2 of the P1 spec.
* **The covering index** for `first_win` — P3. This plan adds no scan.
* **A full contact re-import** to close the 0.34% duplicate gap — offered and
  declined on 2026-09-15; recorded as a stated limit instead.
