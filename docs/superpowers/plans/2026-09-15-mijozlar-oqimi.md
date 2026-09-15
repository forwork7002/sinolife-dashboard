# Mijozlar oqimi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a «Mijozlar oqimi» band to the top of `/analytics/cohort` that answers how customers arrive, how many return, where they came from, and which have gone quiet — on the order-date clock, measured against production.

**Architecture:** One new endpoint `/api/v1/insights/customers` backed by three new `InsightsRepository` methods (a period statement, a whole-history source-quality statement, a today's-state statement) folded by `InsightsService.customerFlow`. The business definitions — day thresholds and the RETENTION stage partition — live in one client-safe module `src/lib/customerStates.ts` that both the repository's `CASE` and the screen's labels read, the arrangement `logisticsBuckets.ts` already uses. The screen adds one band above «Kogorta tahlili» and changes nothing below it except one hint.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 + PostgreSQL 16 (`$queryRawUnsafe`), TanStack Query, Recharts, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-mijozlar-oqimi-design.md`

## Global Constraints

- **The one rule:** the frontend never talks to Bitrix24. Bitrix24 → CrmProvider → SyncEngine → PostgreSQL → Repositories → Domain → Services → `/api/v1` → React. Enforced by `eslint.config.mjs`.
- **Scope is spread LAST** — `{ ...ctx.query, ...ctx.scope }` — in every route. That ordering is the security property.
- **`src/lib` is client-safe**: no `@/server/**` imports, in either direction. eslint forbids the crossing.
- **Clock:** `deal."createdAtSource"`, over deals with `"countsAsRevenue"` true and `"customerId"` not null. Windows are `>= $start AND < $end`. All month/day bucketing is `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'` (`this.tz` on the repository).
- **Every customer count is `count(DISTINCT "customerId")`.** A customer with two orders in a month is one customer.
- **Revenue is the only place `status` is filtered** — money counts on `status = 'WON'` only. A refused order is an arrival, not a soʻm.
- **Thresholds, verbatim:** active ≤ **60** days, at risk 60 < d ≤ **150**, lost > **150** days.
- **UI copy is Uzbek. Stage names are Russian and VERBATIM** — «База · Недозвоны», never translated.
- **No stage COUNT is written down** anywhere in code or copy. That number moved once on this portal and two places printed the old one for a day.
- **Never `git add -A`.** Two sessions share this working tree and the index holds other sessions' staged probe files. Every commit names its paths explicitly.
- **Commit locally; never push.** Pushing to `main` deploys. The user says «deploy qil» when they want that.
- **Commit message style:** an imperative sentence saying what changed and why, no `feat:`/`fix:` prefixes. End every message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Verification command:** `npm run verify` (typecheck + lint + test). Individual file: `npx vitest run tests/path/file.test.ts`.

---

### Task 1: The business definitions module

**Files:**
- Create: `src/lib/customerStates.ts`
- Test: `tests/domain/customerStates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CUSTOMER_ACTIVE_DAYS: 60`, `CUSTOMER_AT_RISK_DAYS: 150`, `CUSTOMER_STATES` (readonly array of `{ key, label, colour }` with keys `'ACTIVE' | 'AT_RISK' | 'LOST'`), `PORTAL_ABSENT` (`{ key: 'ABSENT', label, colour }`), `RETENTION_STATE_STAGES` (readonly array of `{ state: CustomerStateKey, stages: readonly string[] }`), `type CustomerStateKey`, and `STATE_BUCKET: Record<CustomerStateKey, number>` plus `UNBUCKETED_BUCKET = 9` and `ABSENT_BUCKET = 0` — the integers the SQL `CASE` emits.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/customerStates.test.ts
import { describe, expect, it } from 'vitest'

import {
  ABSENT_BUCKET,
  CUSTOMER_ACTIVE_DAYS,
  CUSTOMER_AT_RISK_DAYS,
  CUSTOMER_STATES,
  RETENTION_STATE_STAGES,
  STATE_BUCKET,
  UNBUCKETED_BUCKET,
} from '@/lib/customerStates'

describe('the customer state definitions', () => {
  it('keeps the thresholds the measurement chose', () => {
    /*
      Measured on production 2026-09-15 over 2 346 inter-purchase gaps:
      median 37.5 days, p75 73.9, p90 141.1. 60 is past p75 — a customer
      inside it is inside the normal cycle. 150 is past p90 — a customer
      silent that long returns with under one chance in ten. Moving either
      is a business decision and should break this test.
    */
    expect(CUSTOMER_ACTIVE_DAYS).toBe(60)
    expect(CUSTOMER_AT_RISK_DAYS).toBe(150)
    expect(CUSTOMER_ACTIVE_DAYS).toBeLessThan(CUSTOMER_AT_RISK_DAYS)
  })

  it('partitions the retention stages without overlap', () => {
    // A stage in two buckets makes one customer two customers.
    const all = RETENTION_STATE_STAGES.flatMap((row) => row.stages)
    expect(new Set(all).size).toBe(all.length)
  })

  it('names every state exactly once and buckets each to its own integer', () => {
    const keys = CUSTOMER_STATES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(RETENTION_STATE_STAGES.map((r) => r.state)).toEqual(keys)

    const buckets = keys.map((key) => STATE_BUCKET[key])
    expect(new Set(buckets).size).toBe(buckets.length)
    expect(buckets).not.toContain(UNBUCKETED_BUCKET)
    expect(buckets).not.toContain(ABSENT_BUCKET)
  })

  it('orders the buckets so that the BEST state wins a min()', () => {
    /*
      A customer sitting on two База stages is counted once, in their best
      bucket, and the repository does that with min(bucket). That only works
      while ACTIVE < AT_RISK < LOST, and it is the whole reason these are
      integers rather than strings.
    */
    expect(STATE_BUCKET.ACTIVE).toBeLessThan(STATE_BUCKET.AT_RISK)
    expect(STATE_BUCKET.AT_RISK).toBeLessThan(STATE_BUCKET.LOST)
    expect(STATE_BUCKET.LOST).toBeLessThan(UNBUCKETED_BUCKET)
  })

  it('carries the portal stage names in Russian, verbatim', () => {
    // The whole value of this block is that it reconciles against
    // obey.bitrix24.kz. A translated stage name is one more thing to
    // reconcile, and the prefix is load-bearing: stage ids repeat across
    // funnels, so names are stored prefixed with their pipeline.
    const all = RETENTION_STATE_STAGES.flatMap((row) => row.stages)
    for (const stage of all) expect(stage.startsWith('База · ')).toBe(true)
    expect(all).toContain('База · Недозвоны')
    expect(all).toContain('База · Неактивные')
    expect(all).toContain('База · Актив')
  })

  it('writes down no stage count', () => {
    // The portal added a 19th Доставка stage on 2026-09-10 and two places
    // went on printing "eighteen" for a day. Nothing here asserts a total.
    const all = RETENTION_STATE_STAGES.flatMap((row) => row.stages)
    expect(all.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/customerStates.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/customerStates"`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/customerStates.ts
/**
 * When a customer counts as active, at risk, or lost — and what the portal
 * says about the same person.
 *
 * TWO VERDICTS, DELIBERATELY NOT RECONCILED. One is what the customers did
 * (their last order date); the other is what the retention desk believes
 * (their open stage in the База funnel). Measured on production 2026-09-15
 * they disagree hard — the portal calls 7 609 customers active where the
 * order dates say 4 753, and calls 3 452 dead where the order dates say
 * 6 062. Roughly 2 900 people sit in an active-looking stage having not
 * ordered in five months. Printing both side by side is the whole point of
 * the block; averaging them would destroy exactly the signal being shown.
 *
 * THE THRESHOLDS ARE MEASURED, NOT CHOSEN. Over 2 346 inter-purchase gaps
 * the median is 37.5 days, p75 is 73.9 and p90 is 141.1. So 60 days is
 * inside the normal cycle, and past 150 days a customer returns with under
 * one chance in ten. Changing them is one edit here and nothing else.
 *
 * WHY IT LIVES IN `src/lib`. Both sides read it: the repository builds its
 * bucket CASE from `RETENTION_STATE_STAGES`, and the screen draws its labels
 * and colours from `CUSTOMER_STATES`. A business definition must not have two
 * homes — the arrangement `logisticsBuckets.ts` already uses, for the same
 * reason. `src/lib` is client-safe (no server imports).
 */

/** Ordered ≤ first, so a customer falls into the first band that holds them. */
export const CUSTOMER_ACTIVE_DAYS = 60
export const CUSTOMER_AT_RISK_DAYS = 150

/**
 * `colour` is a CSS custom property from `globals.css`, fixed per state and
 * never reassigned by size — «colour follows the entity, never its rank»
 * (docs/DESIGN.md). `--series-8` is the palette's red, so red on this block
 * means exactly one thing: the customer stopped buying.
 */
export const CUSTOMER_STATES = [
  { key: 'ACTIVE', label: 'Faol', colour: '--series-3' },
  { key: 'AT_RISK', label: 'Xavf ostida', colour: '--series-5' },
  { key: 'LOST', label: 'Yoʻqotilgan', colour: '--series-8' },
] as const satisfies readonly { key: string; label: string; colour: string }[]

export type CustomerStateKey = (typeof CUSTOMER_STATES)[number]['key']

/**
 * The fourth row, which has no counterpart on our side.
 *
 * Every customer with no OPEN База deal at all. Without it the two columns
 * have different denominators and invite a reconciliation that cannot come
 * out — measured today it is 4 453 of 15 867 people.
 */
export const PORTAL_ABSENT = {
  key: 'ABSENT',
  label: 'Базада yoʻq',
  colour: '--axis',
} as const

/**
 * Stage names are stored PREFIXED with their funnel — stage ids repeat across
 * pipelines, so a bare «Недозвоны» is ambiguous. Russian and verbatim: this
 * block's value is that it reconciles against obey.bitrix24.kz.
 *
 * Verified on 2026-09-15 to be every open RETENTION stage there is. It will
 * not stay that way — the portal adds stages — which is what `UNBUCKETED`
 * below is for.
 */
export const RETENTION_STATE_STAGES = [
  {
    state: 'ACTIVE',
    stages: [
      'База · Новый база',
      'База · Актив',
      'База · Активный клиент',
      'База · 1 кун',
      'База · 3 кун',
      'База · 10 кун',
      'База · 20 кун',
      'База · 30 кун',
      'База · Успешно раздача',
    ],
  },
  { state: 'AT_RISK', stages: ['База · Пропущенный', 'База · Перерыв успешно'] },
  {
    state: 'LOST',
    stages: ['База · Недозвоны', 'База · Неактивные', 'База · Не активный клиент'],
  },
] as const satisfies readonly { state: CustomerStateKey; stages: readonly string[] }[]

/**
 * The integers the SQL CASE emits, and their ORDER IS LOAD-BEARING.
 *
 * A customer can sit on two open База deals at once. They are counted ONCE,
 * in their BEST bucket, and the repository does that with `min(bucket)` —
 * which is only correct while ACTIVE < AT_RISK < LOST. Summing the ladder
 * instead double-counts, the error `retentionStages` already documents.
 */
export const STATE_BUCKET: Record<CustomerStateKey, number> = {
  ACTIVE: 1,
  AT_RISK: 2,
  LOST: 3,
}

/**
 * A RETENTION stage this table does not name.
 *
 * Above every real bucket so `min()` never picks it for a customer who also
 * stands somewhere known, and reported by name rather than swept into a
 * partition that claims to be exhaustive — the tripwire `logisticsBuckets`
 * taught. It counts as «Xavf ostida» in the totals: an unknown stage is not
 * evidence the customer is fine.
 */
export const UNBUCKETED_BUCKET = 9

/** No open База deal at all. Below every bucket; never produced by the CASE. */
export const ABSENT_BUCKET = 0
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/domain/customerStates.test.ts && npm run typecheck`
Expected: PASS, 6 tests. Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/customerStates.ts tests/domain/customerStates.test.ts
git commit src/lib/customerStates.ts tests/domain/customerStates.test.ts -m "$(cat <<'EOF'
Give «active», «at risk» and «lost» one definition the screen and the SQL share

The thresholds are measured rather than picked: over 2 346 inter-purchase
gaps on production the median is 37.5 days, p75 73.9 and p90 141.1, so 60
days is inside the normal cycle and past 150 a customer returns with under
one chance in ten.

The stage table is the portal's own verdict on the same people, and the two
are deliberately not reconciled — measured today the portal calls 7 609
customers active where the order dates say 4 753.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `InsightsRepository.customerStates()` — today's two verdicts

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` (add after `retentionStages`, around line 1143)
- Test: `tests/http/customerStatesSql.test.ts`

**Interfaces:**
- Consumes: Task 1's `CUSTOMER_ACTIVE_DAYS`, `CUSTOMER_AT_RISK_DAYS`, `RETENTION_STATE_STAGES`, `STATE_BUCKET`, `UNBUCKETED_BUCKET`, `CustomerStateKey`.
- Produces:

```ts
export interface CustomerStateCounts {
  readonly customers: number
  readonly ours: Record<CustomerStateKey, number>
  readonly portal: Record<CustomerStateKey, number> & { readonly ABSENT: number }
  readonly unbucketedStages: readonly string[]
}
// on the class:
async customerStates(): Promise<CustomerStateCounts>
private static stateCaseSql(stageColumn: string): string
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/http/customerStatesSql.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE CUSTOMER-STATE STATEMENT PROMISES.
 *
 * Two verdicts on the same people — the order dates against the portal's open
 * База stage — printed side by side and never reconciled. Everything that
 * could quietly turn that into one wrong number is pinned here.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

function statesSql(): string {
  const at = SOURCE.indexOf('async customerStates(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

/** The statement with every comment stripped, so prose cannot satisfy a test. */
function code(): string {
  return statesSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the customer state statement', () => {
  it('counts a customer once, in their BEST portal bucket', () => {
    // A customer on two open База deals is one customer. Summing the ladder
    // double-counts them — the error `retentionStages` already documents.
    expect(code()).toMatch(/min\(\s*bucket\s*\)/i)
  })

  it('reads only OPEN retention deals', () => {
    // «База · Успешно» holds 1 314 customers and 0 open deals: a closed deal
    // is a finished cadence, not a verdict about the customer today.
    expect(code()).toMatch(/"role"\s*=\s*'RETENTION'/i)
    expect(code()).toMatch(/"status"\s*=\s*'OPEN'/i)
  })

  it('takes the day thresholds as parameters, never as literals', () => {
    /*
      60 and 150 live in src/lib/customerStates.ts, which the screen reads
      too. A number typed into this statement is a second definition that
      agrees right up until somebody moves one.
    */
    expect(code()).toMatch(/make_interval\(days\s*=>\s*\$1::int\)/i)
    expect(code()).toMatch(/make_interval\(days\s*=>\s*\$2::int\)/i)
    expect(code()).not.toMatch(/\b150\b/)
  })

  it('keeps every Customer in the denominator, including those never in База', () => {
    // Without the LEFT JOIN the two columns have different denominators and
    // invite a reconciliation that cannot come out — 4 453 people today.
    expect(code()).toMatch(/LEFT JOIN/i)
  })

  it('cohorts on the ORDER date, not on the delivered date', () => {
    expect(code()).toMatch(/"createdAtSource"/)
    expect(code()).not.toMatch(/"closedAt"/)
  })

  it('names countsAsRevenue explicitly', () => {
    // A forgotten filter pulls 13 474 duplicate База deals in and the result
    // looks entirely plausible.
    expect(code()).toMatch(/"countsAsRevenue"/)
  })

  it('reports unrecognised stages rather than swallowing them', () => {
    expect(code()).toMatch(/9/)
    expect(statesSql()).toMatch(/UNION ALL/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http/customerStatesSql.test.ts`
Expected: FAIL — `expected -1 to be greater than -1` (the method does not exist).

- [ ] **Step 3: Add the import, the CASE builder and the method**

At the top of `src/server/repositories/insightsRepository.ts`, beside the existing `LOGISTICS_BUCKETS` import, add:

```ts
import {
  CUSTOMER_ACTIVE_DAYS,
  CUSTOMER_AT_RISK_DAYS,
  type CustomerStateKey,
  RETENTION_STATE_STAGES,
  STATE_BUCKET,
  UNBUCKETED_BUCKET,
} from '@/lib/customerStates'
```

Add the exported result type near the file's other repository types:

```ts
export interface CustomerStateCounts {
  readonly customers: number
  readonly ours: Record<CustomerStateKey, number>
  readonly portal: Record<CustomerStateKey, number> & { readonly ABSENT: number }
  /** RETENTION stages the table does not name. Expected empty; see the method. */
  readonly unbucketedStages: readonly string[]
}
```

Add to the class, immediately after `retentionStages`:

```ts
  /**
   * ONE CASE, GENERATED FROM THE STATE TABLE.
   *
   * Hand-writing the stage-to-bucket mapping here would be a second
   * definition of something the screen also reads, and the two would agree
   * right up until somebody moved a stage. `ELSE ${UNBUCKETED_BUCKET}` is the
   * honesty valve and is not optional: a stage this table does not name is
   * reported by name rather than quietly counted as healthy.
   *
   * The stage names come from our own constant, never from a caller, but the
   * quote doubling stays — a table that grows an apostrophe should produce a
   * wrong row rather than a broken statement.
   */
  private static stateCaseSql(stageColumn: string): string {
    const arms = RETENTION_STATE_STAGES.flatMap((row) =>
      row.stages.map(
        (stage) => `WHEN '${stage.replace(/'/g, "''")}' THEN ${STATE_BUCKET[row.state]}`,
      ),
    ).join(`
            `)
    return `CASE ${stageColumn}
            ${arms}
            ELSE ${UNBUCKETED_BUCKET}
          END`
  }

  /**
   * Where every customer stands TODAY, by two verdicts that disagree.
   *
   * NO PERIOD, ON PURPOSE. Churn is a state as of now — exactly like the
   * «База — mijozlar hozir qayerda» ladder beside it on the same screen.
   * A customer who went quiet in March did not become un-quiet because the
   * reader picked August.
   *
   * THE TWO COLUMNS ARE NOT MEANT TO AGREE. Measured on production
   * 2026-09-15: the portal calls 7 609 customers active where their order
   * dates say 4 753, and calls 3 452 dead where the order dates say 6 062 —
   * some 2 900 people sitting in an active-looking stage who have not ordered
   * in five months. One column reports what the retention desk believes, the
   * other what the customers did. Averaging them would delete the finding.
   *
   * ONE STATEMENT, TWO ARMS: the counts, then the unrecognised stage names.
   */
  async customerStates(): Promise<CustomerStateCounts> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        kind: number
        stage: string | null
        customers: bigint | null
        ours_active: bigint | null
        ours_at_risk: bigint | null
        ours_lost: bigint | null
        portal_active: bigint | null
        portal_at_risk: bigint | null
        portal_lost: bigint | null
        portal_absent: bigint | null
      }[]
    >(
      `
      WITH cust AS (
        SELECT DISTINCT d."customerId" AS cid
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
      ),
      -- The order clock. Deliberately createdAtSource and not closedAt: the
      -- band this feeds counts arrivals, and the cohort matrix on the same
      -- screen states the other clock in its own heading.
      last_order AS (
        SELECT d."customerId" AS cid, max(d."createdAtSource") AS last_ts
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
        GROUP BY 1
      ),
      ours AS (
        SELECT l.cid,
          CASE
            WHEN l.last_ts >= now() - make_interval(days => $1::int) THEN ${STATE_BUCKET.ACTIVE}
            WHEN l.last_ts >= now() - make_interval(days => $2::int) THEN ${STATE_BUCKET.AT_RISK}
            ELSE ${STATE_BUCKET.LOST}
          END AS bucket
        FROM last_order l
      ),
      baza AS (
        SELECT d."customerId" AS cid, s."name" AS stage,
               ${InsightsRepository.stateCaseSql('s."name"')} AS bucket
        FROM "deal" d
        JOIN "deal_stage" s ON s."id" = d."stageId"
        JOIN "pipeline" p ON p."id" = d."pipelineId"
        WHERE p."role" = 'RETENTION'
          AND d."status" = 'OPEN'
          AND d."customerId" IS NOT NULL
      ),
      -- ONE ROW PER CUSTOMER, IN THEIR BEST BUCKET. A person on two open
      -- stages is one person; min() is correct only because ACTIVE < AT_RISK
      -- < LOST < UNBUCKETED, which customerStates.test.ts pins.
      best AS (SELECT cid, min(bucket) AS bucket FROM baza GROUP BY cid),
      -- LEFT JOIN, so a customer who never entered База is counted rather
      -- than dropped: without it the two columns carry different
      -- denominators and cannot be read against each other.
      portal AS (
        SELECT c.cid, COALESCE(b.bucket, 0) AS bucket
        FROM cust c LEFT JOIN best b ON b.cid = c.cid
      )
      SELECT
        0 AS kind,
        NULL::text AS stage,
        (SELECT count(*) FROM cust)::bigint AS customers,
        (SELECT count(*) FROM ours WHERE bucket = ${STATE_BUCKET.ACTIVE})::bigint AS ours_active,
        (SELECT count(*) FROM ours WHERE bucket = ${STATE_BUCKET.AT_RISK})::bigint AS ours_at_risk,
        (SELECT count(*) FROM ours WHERE bucket = ${STATE_BUCKET.LOST})::bigint AS ours_lost,
        (SELECT count(*) FROM portal WHERE bucket = ${STATE_BUCKET.ACTIVE})::bigint AS portal_active,
        -- An unrecognised stage counts as at risk: not knowing where somebody
        -- stands is not evidence that they are fine.
        (SELECT count(*) FROM portal
          WHERE bucket IN (${STATE_BUCKET.AT_RISK}, ${UNBUCKETED_BUCKET}))::bigint AS portal_at_risk,
        (SELECT count(*) FROM portal WHERE bucket = ${STATE_BUCKET.LOST})::bigint AS portal_lost,
        (SELECT count(*) FROM portal WHERE bucket = 0)::bigint AS portal_absent

      UNION ALL

      SELECT 1, u.stage, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM (SELECT DISTINCT stage FROM baza WHERE bucket = ${UNBUCKETED_BUCKET}) u
      `,
      CUSTOMER_ACTIVE_DAYS,
      CUSTOMER_AT_RISK_DAYS,
    )

    const summary = rows.find((row) => row.kind === 0)

    return {
      customers: int(summary?.customers ?? 0n),
      ours: {
        ACTIVE: int(summary?.ours_active ?? 0n),
        AT_RISK: int(summary?.ours_at_risk ?? 0n),
        LOST: int(summary?.ours_lost ?? 0n),
      },
      portal: {
        ACTIVE: int(summary?.portal_active ?? 0n),
        AT_RISK: int(summary?.portal_at_risk ?? 0n),
        LOST: int(summary?.portal_lost ?? 0n),
        ABSENT: int(summary?.portal_absent ?? 0n),
      },
      unbucketedStages: rows
        .filter((row) => row.kind === 1 && row.stage !== null)
        .map((row) => row.stage as string),
    }
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/http/customerStatesSql.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 7 tests. Typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/insightsRepository.ts tests/http/customerStatesSql.test.ts
git commit src/server/repositories/insightsRepository.ts tests/http/customerStatesSql.test.ts -m "$(cat <<'EOF'
Measure who has gone quiet, twice, and refuse to reconcile the two answers

One column is each customer's last order date against the measured
thresholds; the other is the portal's own open База stage. On production
today they disagree by some 2 900 people — sitting in an active-looking
stage having not ordered in five months — and that gap is the finding.

Every customer is counted once, in their best bucket, and a customer who
never entered База is counted rather than dropped, or the two columns carry
different denominators. An unrecognised stage is reported by name: not
knowing where somebody stands is not evidence that they are fine.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `InsightsRepository.customerFlow()` — the period statement

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` (add after `customerStates`)
- Test: `tests/http/customerFlowSql.test.ts`

**Interfaces:**
- Consumes: `Period` (`period.start`, `period.end`), `this.tz`.
- Produces:

```ts
export interface CustomerFlowRows {
  readonly summary: {
    readonly newCustomers: number
    readonly returningCustomers: number
    readonly activeCustomers: number
    readonly newCustomersWon: number
    readonly firstRevenueMinor: bigint
    readonly repeatRevenueMinor: bigint
  }
  readonly series: readonly {
    readonly bucket: string          // 'YYYY-MM-DD'
    readonly newCustomers: number
    readonly returningCustomers: number
  }[]
  readonly sources: readonly {
    readonly key: string             // SalesSource id, or '' for no source
    readonly label: string           // source name, or '(manbasiz)'
    readonly newCustomers: number
  }[]
}
async customerFlow(options: { period: Period; grain: 'day' | 'month' }): Promise<CustomerFlowRows>
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/http/customerFlowSql.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE CUSTOMER-FLOW STATEMENT PROMISES.
 *
 * Three arms over one pair of CTEs — the window's totals, its series, and
 * where its new customers came from — so no two blocks on the band can
 * disagree about the same window.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

function flowSql(): string {
  const at = SOURCE.indexOf('async customerFlow(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

function code(): string {
  return flowSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the customer flow statement', () => {
  it('cohorts on the order date and never on the delivered date', () => {
    /*
      The client chose «buyurtma bergan sana» over the delivered date. The
      cohort matrix on the same screen legitimately uses the other clock and
      prints a different customer total; each states its own in its heading.
    */
    expect(code()).toMatch(/"createdAtSource"/)
    expect(code()).not.toMatch(/"closedAt"/)
  })

  it('counts customers, never rows', () => {
    // A customer with two orders in a month is one customer.
    expect(code()).not.toMatch(/count\(\*\)\s+AS\s+(new|returning|active)_customers/i)
    expect([...code().matchAll(/count\(DISTINCT\s+cid\)/gi)].length).toBeGreaterThanOrEqual(4)
  })

  it('decides new against the customer’s FIRST EVER order, not the window’s', () => {
    /*
      `first_ts` is a min() over the whole history with no date bound. Bounded
      to the window, every customer in it would look new and the returning
      count would be zero — the exact inversion this band exists to prevent.
    */
    const cte = code().slice(code().indexOf('ranked AS ('), code().indexOf('win AS ('))
    expect(cte).toMatch(/min\(ts\)\s+OVER\s*\(\s*PARTITION BY cid\s*\)/i)
    expect(cte).not.toMatch(/\$1|\$2/)
  })

  it('bounds the window half-open, the way every other period query does', () => {
    expect(code()).toMatch(/ts\s*>=\s*\$1/i)
    expect(code()).toMatch(/ts\s*<\s*\$2/i)
  })

  it('filters status ONLY for money', () => {
    /*
      A refused order is an arrival, not a soʻm. Every headcount counts it;
      every revenue figure does not. 26% of revenue-pipeline orders never
      reach WON, so a status filter in the wrong place moves 26% of the band.
    */
    for (const m of code().matchAll(/'WON'/g)) {
      const around = code().slice(Math.max(0, m.index - 120), m.index + 40)
      expect(around).toMatch(/sum\(|count\(DISTINCT cid\) FILTER \(WHERE first_ts/i)
    }
  })

  it('splits first-order money from later money in ONE pass', () => {
    // Two FILTERs over the same CTE, not two scans — the shape `cohorts`
    // settled on for exactly this split.
    expect(code()).toMatch(/FILTER \(WHERE rn = 1\)/i)
    expect(code()).toMatch(/FILTER \(WHERE rn > 1\)/i)
  })

  it('takes the series grain as a parameter, not by string surgery', () => {
    // date_trunc accepts the unit as a text parameter. Interpolating it would
    // put a caller's string into the statement for no gain.
    expect(code()).toMatch(/date_trunc\(\$3/i)
  })

  it('buckets in Asia/Tashkent, like every other window in the product', () => {
    expect(code()).toMatch(/AT TIME ZONE 'UTC' AT TIME ZONE \$4/i)
  })

  it('attributes a new customer to their FIRST order’s source', () => {
    /*
      Marketing attribution is about where the customer came from, not where
      their third order was logged — «База клиент» is a source that only ever
      appears on repeat orders.
    */
    const sources = code().slice(code().lastIndexOf('UNION ALL'))
    expect(sources).toMatch(/rn = 1/i)
  })

  it('never drops the sourceless row', () => {
    // 1.7% of orders carry no source. Dropped, the source rows stop summing
    // to the new-customer total and the block silently lies about its own
    // denominator.
    expect(code()).toMatch(/LEFT JOIN "sales_source"/i)
  })

  it('names countsAsRevenue explicitly', () => {
    expect(code()).toMatch(/"countsAsRevenue"/)
  })

  it('walks the deal table once', () => {
    // 18 392 revenue deals — small enough that the window-function sort that
    // was too expensive for `cohorts` (180 000 rows against 2 MB work_mem) is
    // the cheaper shape here. A second walk would be a regression.
    expect([...code().matchAll(/FROM\s+"deal"/gi)].length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http/customerFlowSql.test.ts`
Expected: FAIL — `expected -1 to be greater than -1`.

- [ ] **Step 3: Write the method**

Add the result type near `CustomerStateCounts`:

```ts
export interface CustomerFlowRows {
  readonly summary: {
    readonly newCustomers: number
    readonly returningCustomers: number
    readonly activeCustomers: number
    readonly newCustomersWon: number
    readonly firstRevenueMinor: bigint
    readonly repeatRevenueMinor: bigint
  }
  readonly series: readonly {
    readonly bucket: string
    readonly newCustomers: number
    readonly returningCustomers: number
  }[]
  readonly sources: readonly {
    readonly key: string
    readonly label: string
    readonly newCustomers: number
  }[]
}
```

Add to the class, after `customerStates`:

```ts
  /**
   * How customers arrived in the window: new, returning, and from where.
   *
   * THE CLOCK IS THE ORDER DATE — `createdAtSource` — chosen by the client
   * over the delivered date («buyurtma bergan sana (kelgan kun)»). The cohort
   * matrix on the same screen is cohorted by `closedAt` on WON deals and
   * legitimately prints a different customer total (15 867 against 11 512 on
   * 2026-09-15). Both blocks state their clock in their own heading; neither
   * is wrong and they must never be summed.
   *
   * NEW IS DECIDED AGAINST THE WHOLE HISTORY. `first_ts` carries no date
   * bound. Bounded to the window every customer in it would look new and the
   * returning count would be a flat zero.
   *
   * STATUS IS FILTERED ONLY FOR MONEY. A refused order is an arrival, not a
   * soʻm, and 26% of revenue-pipeline orders never reach WON — a status
   * filter in the wrong place moves a quarter of this band.
   *
   * ONE WALK OF "deal", AND HERE THAT IS THE CHEAP SHAPE. `cohorts` measured
   * the opposite and its note says why: its window function sorts ~180 000
   * rows against a 2 MB `work_mem` and spills. This statement's set is the
   * 18 392 revenue-bearing deals, which sorts in memory — measured at 0.4-0.9 s
   * from this machine including the fra1 round trip.
   */
  async customerFlow(options: {
    period: Period
    grain: 'day' | 'month'
  }): Promise<CustomerFlowRows> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        kind: number
        bucket: Date | null
        source_key: string | null
        source_label: string | null
        new_customers: bigint | null
        returning_customers: bigint | null
        active_customers: bigint | null
        new_customers_won: bigint | null
        first_revenue: MoneyText
        repeat_revenue: MoneyText
      }[]
    >(
      `
      WITH orders AS (
        SELECT d."customerId" AS cid,
               d."createdAtSource" AS ts,
               d."amountMinor" AS amount,
               d."status" AS status,
               d."sourceId" AS sid
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
      ),
      -- NO DATE BOUND HERE, and that is the whole correctness property: a
      -- customer is new because this is their first order EVER, not because
      -- it is the earliest one the reader's window happens to contain.
      ranked AS (
        SELECT cid, ts, amount, status, sid,
               row_number() OVER (PARTITION BY cid ORDER BY ts, sid NULLS LAST) AS rn,
               min(ts) OVER (PARTITION BY cid) AS first_ts
        FROM orders
      ),
      win AS (SELECT * FROM ranked WHERE ts >= $1 AND ts < $2)

      SELECT
        0 AS kind,
        NULL::timestamp AS bucket,
        NULL::text AS source_key,
        NULL::text AS source_label,
        count(DISTINCT cid) FILTER (WHERE first_ts >= $1)::bigint AS new_customers,
        count(DISTINCT cid) FILTER (WHERE first_ts < $1)::bigint AS returning_customers,
        count(DISTINCT cid)::bigint AS active_customers,
        -- Of the window's new customers, how many actually bought. Printed
        -- under the tile because «yangi mijoz» counts arrivals and a quarter
        -- of them never land.
        count(DISTINCT cid) FILTER (WHERE first_ts >= $1 AND status = 'WON')::bigint
          AS new_customers_won,
        -- The same split the repeat-share gauge on this screen already makes:
        -- per ORDER, first against later, never per customer.
        COALESCE(sum(amount) FILTER (WHERE rn = 1 AND status = 'WON'), 0)::text AS first_revenue,
        COALESCE(sum(amount) FILTER (WHERE rn > 1 AND status = 'WON'), 0)::text AS repeat_revenue
      FROM win

      UNION ALL

      SELECT
        1,
        date_trunc($3, ts AT TIME ZONE 'UTC' AT TIME ZONE $4) AS bucket,
        NULL, NULL,
        count(DISTINCT cid) FILTER (WHERE first_ts >= $1)::bigint,
        count(DISTINCT cid) FILTER (WHERE first_ts < $1)::bigint,
        NULL, NULL, NULL, NULL
      FROM win
      GROUP BY 1, 2

      UNION ALL

      -- WHERE THE WINDOW'S NEW CUSTOMERS CAME FROM.
      --
      -- `rn = 1` inside the window IS the set of new customers, so these rows
      -- sum exactly to new_customers above — an invariant the screen relies
      -- on to print a share. The LEFT JOIN keeps the sourceless row (1.7% of
      -- orders); dropped, the block would silently lie about its denominator.
      SELECT
        2,
        NULL,
        COALESCE(s."id", '') AS source_key,
        COALESCE(s."name", '(manbasiz)') AS source_label,
        count(DISTINCT w.cid)::bigint,
        NULL, NULL, NULL, NULL, NULL
      FROM win w
      LEFT JOIN "sales_source" s ON s."id" = w.sid
      WHERE w.rn = 1
      GROUP BY 2, 3, 4

      ORDER BY 1, 2, 5 DESC
      `,
      options.period.start,
      options.period.end,
      options.grain,
      this.tz,
    )

    const summary = rows.find((row) => row.kind === 0)

    return {
      summary: {
        newCustomers: int(summary?.new_customers ?? 0n),
        returningCustomers: int(summary?.returning_customers ?? 0n),
        activeCustomers: int(summary?.active_customers ?? 0n),
        newCustomersWon: int(summary?.new_customers_won ?? 0n),
        firstRevenueMinor: money(summary?.first_revenue ?? null),
        repeatRevenueMinor: money(summary?.repeat_revenue ?? null),
      },
      series: rows
        .filter((row) => row.kind === 1 && row.bucket !== null)
        .map((row) => ({
          bucket: (row.bucket as Date).toISOString().slice(0, 10),
          newCustomers: int(row.new_customers ?? 0n),
          returningCustomers: int(row.returning_customers ?? 0n),
        })),
      sources: rows
        .filter((row) => row.kind === 2)
        .map((row) => ({
          key: row.source_key ?? '',
          label: row.source_label ?? '(manbasiz)',
          newCustomers: int(row.new_customers ?? 0n),
        })),
    }
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/http/customerFlowSql.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 12 tests. Typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/insightsRepository.ts tests/http/customerFlowSql.test.ts
git commit src/server/repositories/insightsRepository.ts tests/http/customerFlowSql.test.ts -m "$(cat <<'EOF'
Count how customers arrive in a window, on the order clock the client chose

Three arms over one pair of CTEs — the window's totals, its series and where
its new customers came from — so no two blocks on the band can disagree
about the same window, and the source rows sum exactly to the new-customer
total the tile prints.

Two things decide whether this is right. «New» is measured against the
customer's first order EVER, not the window's earliest, or every customer in
the window looks new. And status is filtered only for money: a refused order
is an arrival, not a soʻm, and 26% of orders never reach WON.

One walk of "deal" here, against two in `cohorts`. The window-function sort
that spilled work_mem there is over 180 000 rows; this set is the 18 392
revenue-bearing deals and sorts in memory.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `InsightsRepository.sourceRepeatRates()` — the source's own quality

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` (add after `customerFlow`)
- Test: `tests/http/customerFlowSql.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `this.tz` is not needed here — the horizon is an interval, not a calendar.
- Produces:

```ts
export interface SourceRepeatRate {
  readonly key: string              // SalesSource id, or '' for no source
  readonly maturedCustomers: number
  readonly repeatPercent: number | null
}
async sourceRepeatRates(): Promise<readonly SourceRepeatRate[]>
```

- [ ] **Step 1: Write the failing test**

Append to `tests/http/customerFlowSql.test.ts`:

```ts
function ratesSql(): string {
  const at = SOURCE.indexOf('async sourceRepeatRates(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the source repeat-rate statement', () => {
  it('gives every customer a complete 90-day horizon', () => {
    /*
      THE HORIZON IS NOT COSMETIC. Measured without it over the last 365 days
      the same sources read 8.0 / 10.2 / 14.0 against 12.4 / 16.9 / 15.6 with
      it, and «База клиент» reads 19.6 against 40.3 — every source understated,
      because a customer acquired last month is counted as having failed to
      return. The concentration card on the same screen already uses this rule.
    */
    expect(ratesSql()).toMatch(/interval '90 days'/i)
  })

  it('takes no period', () => {
    // A source's repeat rate is a property of the source, not of the window
    // the reader picked. It must not move with the period control.
    expect(ratesSql()).not.toMatch(/\$1|\$2/)
  })

  it('attributes on the FIRST order and counts customers once', () => {
    expect(ratesSql()).toMatch(/rn = 1/i)
    expect(ratesSql()).toMatch(/orders\s*>\s*1/i)
  })

  it('keeps the sourceless row', () => {
    expect(ratesSql()).toMatch(/LEFT JOIN "sales_source"/i)
  })

  it('names countsAsRevenue explicitly', () => {
    expect(ratesSql()).toMatch(/"countsAsRevenue"/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http/customerFlowSql.test.ts`
Expected: FAIL — the new `describe` fails at `expect(at).toBeGreaterThan(-1)`; the 12 tests from Task 3 still pass.

- [ ] **Step 3: Write the method**

Add the result type near `CustomerFlowRows`:

```ts
export interface SourceRepeatRate {
  readonly key: string
  readonly maturedCustomers: number
  readonly repeatPercent: number | null
}
```

Add to the class, after `customerFlow`:

```ts
  /**
   * How often a source's customers come back — a property of the SOURCE.
   *
   * NO PERIOD, AND A 90-DAY HORIZON. Only customers whose first order is old
   * enough to have had a chance to return are counted. Without that horizon a
   * source that acquired heavily last month reports a near-zero repeat rate
   * for no reason but the calendar, and every source is understated:
   * measured on production 2026-09-15 over the last 365 days, Ген лид reads
   * 8.0% uncontrolled against 12.4% on the horizon, Входящий 10.2% against
   * 16.9%, and «База клиент» 19.6% against 40.3% — a twenty-point error on
   * the row a reader would act on first.
   *
   * It is the same rule the concentration card on this screen already applies
   * to `repurchaseWithin90Percent`, which is what stops one screen printing
   * two different answers to "do they come back".
   *
   * THE COLUMN DOES NOT FOLLOW THE PERIOD CONTROL, and the block's hint says
   * so. A rate that sat beside a period-scoped count and silently ignored it
   * would be the worst of both.
   */
  async sourceRepeatRates(): Promise<readonly SourceRepeatRate[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { source_key: string | null; matured: bigint; returned: bigint }[]
    >(
      `
      WITH orders AS (
        SELECT d."customerId" AS cid, d."createdAtSource" AS ts, d."sourceId" AS sid
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
      ),
      ranked AS (
        SELECT cid, ts, sid,
               row_number() OVER (PARTITION BY cid ORDER BY ts, sid NULLS LAST) AS rn,
               count(*) OVER (PARTITION BY cid) AS orders
        FROM orders
      )
      SELECT
        COALESCE(s."id", '') AS source_key,
        count(*)::bigint AS matured,
        count(*) FILTER (WHERE r.orders > 1)::bigint AS returned
      FROM ranked r
      LEFT JOIN "sales_source" s ON s."id" = r.sid
      -- The horizon. A first order younger than this has not had its chance.
      WHERE r.rn = 1 AND r.ts < now() - interval '90 days'
      GROUP BY 1
      `,
    )

    return rows.map((row) => {
      const matured = int(row.matured)
      return {
        key: row.source_key ?? '',
        maturedCustomers: matured,
        /* Null, never 0, when nothing has matured: «no answer yet» is not
           «nobody came back», and CategoryBarList draws the two differently. */
        repeatPercent:
          matured === 0 ? null : Math.round((int(row.returned) / matured) * 1000) / 10,
      }
    })
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/http/customerFlowSql.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/insightsRepository.ts tests/http/customerFlowSql.test.ts
git commit src/server/repositories/insightsRepository.ts tests/http/customerFlowSql.test.ts -m "$(cat <<'EOF'
Grade a source by how often its customers return, on a complete 90-day horizon

Without the horizon every source is understated, because a customer acquired
last month is counted as having failed to return: measured on production over
the last 365 days Ген лид reads 8.0% uncontrolled against 12.4% with it, and
«База клиент» 19.6% against 40.3% — a twenty-point error on the row a reader
would act on first.

It is the rule the concentration card on the same screen already applies, so
one screen cannot print two answers to "do they come back". The rate takes no
period and the block's hint says so.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: DTOs and `InsightsService.customerFlow()`

**Files:**
- Modify: `src/lib/api.ts` (add DTOs beside `ConcentrationDto`, around line 1390)
- Modify: `src/server/services/insightsService.ts` (add after `cohorts`, around line 978)
- Test: `tests/domain/customerFlow.test.ts`

**Interfaces:**
- Consumes: Task 2's `customerStates()`, Task 3's `customerFlow()`, Task 4's `sourceRepeatRates()`, Task 1's `CUSTOMER_STATES` / `PORTAL_ABSENT`.
- Produces (in `src/lib/api.ts`):

```ts
export interface CustomerFlowSummaryDto {
  readonly newCustomers: number
  readonly returningCustomers: number
  readonly activeCustomers: number
  readonly newCustomersWon: number
  readonly firstRevenue: MoneyDto
  readonly repeatRevenue: MoneyDto
  readonly repeatRevenueSharePercent: number | null
}
export interface CustomerFlowPointDto {
  readonly bucket: string
  readonly newCustomers: number
  readonly returningCustomers: number
}
export interface CustomerSourceDto {
  readonly key: string
  readonly label: string
  readonly newCustomers: number
  readonly sharePercent: number | null
  readonly repeatPercent: number | null
  readonly maturedCustomers: number
}
export interface CustomerStateRowDto {
  readonly key: string
  readonly label: string
  readonly colour: string
  readonly ours: number | null
  readonly portal: number
}
export interface CustomerStatesDto {
  readonly customers: number
  readonly rows: readonly CustomerStateRowDto[]
  readonly unbucketedStages: readonly string[]
}
export interface CustomerFlowDto {
  readonly summary: CustomerFlowSummaryDto
  readonly grain: 'day' | 'month'
  readonly series: readonly CustomerFlowPointDto[]
  readonly sources: readonly CustomerSourceDto[]
  readonly states: CustomerStatesDto
}
```

- Service: `async customerFlow(currency: string, period: Period, scope: EmployeeScopeFilter): Promise<CustomerFlowDto>`, plus an exported pure helper `export function grainFor(days: number): 'day' | 'month'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/customerFlow.test.ts
import { describe, expect, it } from 'vitest'

import { grainFor } from '@/server/services/insightsService'

describe('the series grain', () => {
  it('draws days for a window a reader would read as days', () => {
    /*
      The period control's shortest presets are a day and a week. Bucketed by
      month those draw ONE bar, which is not a series — it is a number wearing
      an axis.
    */
    expect(grainFor(1)).toBe('day')
    expect(grainFor(7)).toBe('day')
    expect(grainFor(31)).toBe('day')
    expect(grainFor(62)).toBe('day')
  })

  it('switches to months past two of them', () => {
    // 62 daily bars is the most this card draws legibly at 360px.
    expect(grainFor(63)).toBe('month')
    expect(grainFor(365)).toBe('month')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/customerFlow.test.ts`
Expected: FAIL — `grainFor is not a function` / no such export.

- [ ] **Step 3: Add the DTOs, the helper and the service method**

In `src/lib/api.ts`, immediately after `ConcentrationDto`, add the six interfaces exactly as written in **Interfaces** above, with this comment above the group:

```ts
/**
 * «Mijozlar oqimi» — the band at the top of «Mijoz qaytishi».
 *
 * ON THE ORDER CLOCK, and that is the one thing a reader of this type must
 * know: `summary` and `series` count customers by when they ORDERED
 * (`createdAtSource`), while `CohortSummaryDto` above counts them by when
 * their first order was DELIVERED. The two legitimately disagree — 15 867
 * against 11 512 on 2026-09-15 — and each block prints its clock in its own
 * heading. Nothing may sum across the two.
 *
 * `states` takes no period at all: churn is a fact about today, like the
 * retention ladder beside it. `sources[].repeatPercent` takes no period
 * either — see `InsightsRepository.sourceRepeatRates`.
 */
```

In `src/server/services/insightsService.ts`, add near the top of the file:

```ts
import { CUSTOMER_STATES, PORTAL_ABSENT } from '@/lib/customerStates'
```

and, beside the existing `confirmationRopCache`:

```ts
/* Both take no period and no scope, and both are identical for every reader.
   Five minutes, matching the cohort read on the same screen: neither answer
   can move more than a few times a day. */
const customerStatesCache = ttlCache<Awaited<ReturnType<InsightsRepository['customerStates']>>>(
  5 * 60_000,
)
const sourceRatesCache = ttlCache<Awaited<ReturnType<InsightsRepository['sourceRepeatRates']>>>(
  5 * 60_000,
)
```

Add the exported helper above the class:

```ts
/**
 * Days per bar, from the window's own length.
 *
 * Resolved on the SERVER and returned in the DTO, so the axis label and the
 * bucket boundaries come from one decision. Re-derived on the client they
 * would disagree the moment a window straddled the threshold.
 */
export function grainFor(days: number): 'day' | 'month' {
  return days <= 62 ? 'day' : 'month'
}
```

Add the method to `InsightsService`, after `cohorts`:

```ts
  /**
   * The «Mijozlar oqimi» band: arrivals, returns, sources, and who went quiet.
   *
   * THREE READS, THREE CLOCKS, SAID OUT LOUD. `customerFlow` is the reader's
   * window. `sourceRepeatRates` is the whole history on a 90-day horizon.
   * `customerStates` is today. Folding them into one DTO is only safe because
   * each block on the screen prints which of the three it is showing.
   *
   * THE SCOPE IS TAKEN AND NOT USED, AND THAT IS DELIBERATE. `cohort` is in
   * `COMPANY_WIDE` and this endpoint asks for `analytics:read:all`, so
   * `restrictToEmployeeIds` is null for every caller who gets through. It is
   * still in the cache key below: the day this section narrows, a memo that
   * had forgotten the scope would serve one account another's rows, and
   * `ttlCache`'s own header calls that the worst thing it could cause.
   */
  async customerFlow(
    currency: string,
    period: Period,
    scope: EmployeeScopeFilter = {},
  ): Promise<CustomerFlowDto> {
    const grain = grainFor(periodLengthInDays(period))
    const scopeKey = keyPart(scope.restrictToEmployeeIds ?? null)

    const [flow, rates, states] = await Promise.all([
      this.repository.customerFlow({ period, grain }),
      sourceRatesCache.get(`rates|${scopeKey}`, () => this.repository.sourceRepeatRates()),
      customerStatesCache.get(`states|${scopeKey}`, () => this.repository.customerStates()),
    ])

    const byKey = new Map(rates.map((rate) => [rate.key, rate]))
    const total = flow.summary.newCustomers

    const sources = flow.sources.map((row) => {
      const rate = byKey.get(row.key)
      return {
        key: row.key,
        label: row.label,
        newCustomers: row.newCustomers,
        /* Against the window's new customers, which the source rows sum to by
           construction — see the statement's third arm. */
        sharePercent: total === 0 ? null : Math.round((row.newCustomers / total) * 1000) / 10,
        /* Null, never 0, when this source has nobody past the 90-day horizon.
           «No answer yet» is not «nobody came back». */
        repeatPercent: rate?.repeatPercent ?? null,
        maturedCustomers: rate?.maturedCustomers ?? 0,
      }
    })

    /* The state rows are built from the SHARED table, in its order, so the two
       columns of the block cannot fall out of step with the labels above them.
       «Базада yoʻq» has no counterpart on our side and carries null rather
       than 0 — a 0 there would read as "nobody", not as "not applicable". */
    const rows = [
      ...CUSTOMER_STATES.map((state) => ({
        key: state.key,
        label: state.label,
        colour: state.colour,
        ours: states.ours[state.key],
        portal: states.portal[state.key],
      })),
      {
        key: PORTAL_ABSENT.key,
        label: PORTAL_ABSENT.label,
        colour: PORTAL_ABSENT.colour,
        ours: null,
        portal: states.portal.ABSENT,
      },
    ]

    const first = flow.summary.firstRevenueMinor
    const repeat = flow.summary.repeatRevenueMinor
    const money_total = first + repeat

    return {
      summary: {
        newCustomers: flow.summary.newCustomers,
        returningCustomers: flow.summary.returningCustomers,
        activeCustomers: flow.summary.activeCustomers,
        newCustomersWon: flow.summary.newCustomersWon,
        firstRevenue: toMoneyDto(money(first, currency)),
        repeatRevenue: toMoneyDto(money(repeat, currency)),
        repeatRevenueSharePercent:
          money_total === 0n ? null : Math.round(Number((repeat * 1000n) / money_total)) / 10,
      },
      grain,
      series: flow.series,
      sources,
      states: {
        customers: states.customers,
        rows,
        unbucketedStages: states.unbucketedStages,
      },
    }
  }
```

Add any missing imports to `insightsService.ts`: `periodLengthInDays` and `type Period` from `@/server/domain/period/period`, and the `CustomerFlowDto` type from `@/lib/api`. Follow the file's existing import style.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/domain/customerFlow.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 2 tests. Typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/server/services/insightsService.ts tests/domain/customerFlow.test.ts
git commit src/lib/api.ts src/server/services/insightsService.ts tests/domain/customerFlow.test.ts -m "$(cat <<'EOF'
Fold the three customer-flow reads into one payload that names each clock

Three reads with three clocks — the reader's window, the whole history on a
90-day horizon, and today — and the DTO says which is which, because the
screen has to print it. The two period-less reads are memoised for five
minutes, matching the cohort read on the same screen.

The scope is taken and not used: `cohort` is company-wide, so it is null for
every caller who gets through. It is in the cache key anyway, so the day this
section narrows the memo cannot serve one account another's rows.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The endpoint

**Files:**
- Create: `src/app/api/v1/insights/customers/route.ts`
- Modify: `tests/http/routeAccess.test.ts` (add the route to its table)
- Modify: `docs/API.md` (document the endpoint beside `/insights/cohorts`)

**Interfaces:**
- Consumes: Task 5's `insightsService.customerFlow`.
- Produces: `GET /api/v1/insights/customers` → `{ data: CustomerFlowDto, meta: { period: PeriodDto } }`.

- [ ] **Step 1: Read how the route table is written, then add the failing row**

Run: `grep -n "insights/concentration" tests/http/routeAccess.test.ts`

Add a row for `/api/v1/insights/customers` in the same shape the neighbouring
`/insights/concentration` row uses, asserting `permission: 'analytics:read:all'`
and `section: 'cohort'`. Copy the surrounding row's exact structure — this
file's table format is what the test iterates.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http/routeAccess.test.ts`
Expected: FAIL — the new row's module cannot be imported.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/v1/insights/customers/route.ts
import { toPeriodDto } from '@/server/domain/period/period'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'cohort' } as const

/**
 * «Mijozlar oqimi» — arrivals, returns, sources and churn.
 *
 * TAKES THE PERIOD, unlike `/insights/cohorts` beside it. That endpoint
 * refuses one because a retention matrix is a statement about the whole
 * history; this one answers "who arrived in the window the reader picked",
 * which is a different question on a different clock. Both feed the same
 * screen and each block there prints which clock it is on.
 *
 * Two of the three reads behind it take no period at all — a source's repeat
 * rate and today's churn state — and the service says so in place.
 */
export const GET = getHandler(ACCESS, analyticsQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await insightsService.customerFlow(ctx.currency, period, {
    ...ctx.query,
    ...ctx.scope,
  })
  return { data, meta: { period: toPeriodDto(period) } }
})
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npm run verify`
Expected: everything green. If `eslint` complains about the layering, the
import is reaching past `@/server/services/container` — fix the import, never
the rule.

- [ ] **Step 5: Document it**

In `docs/API.md`, add `/insights/customers` beside `/insights/cohorts`: the
query parameters it takes, the `CustomerFlowDto` shape, and one line saying it
is on the order clock while `/insights/cohorts` is on the delivered clock.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/insights/customers/route.ts tests/http/routeAccess.test.ts docs/API.md
git commit src/app/api/v1/insights/customers/route.ts tests/http/routeAccess.test.ts docs/API.md -m "$(cat <<'EOF'
Serve the customer flow at /insights/customers, on the period the reader picked

It sits beside /insights/cohorts and deliberately takes the period that one
refuses: a retention matrix is a statement about the whole history, while
"who arrived in this window" is a different question on a different clock.
Both feed «Mijoz qaytishi» and each block there prints which clock it is on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The two chart pieces

**Files:**
- Modify: `src/components/charts/CategoryBarList.tsx`
- Create: `src/components/charts/CustomerFlowChart.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CategoryBarList` gains `mode: 'magnitude' | 'rate' | 'share'`; `CustomerFlowChart({ data, grain, height })` where `data: readonly CustomerFlowPointDto[]`.

- [ ] **Step 1: Add the `share` mode to `CategoryBarList`**

The `rate` mode grades on the house thresholds (85 / 60), which would paint
every repeat rate in this product critical — they run 9% to 40%. That is the
dashboard asserting a benchmark it does not have, and the cohort page already
refuses to: both its rate gauges carry `tone="neutral"` for exactly this
reason.

Change the `mode` prop to `'magnitude' | 'rate' | 'share'` and add, beside the
existing `peak` and `colour` lines:

```tsx
  /*
    `share` IS `rate` WITHOUT THE JUDGEMENT.

    Same denominator — the value's own hundred, so a 12% bar is a tenth of the
    track and two panels can be read against each other — but one neutral hue
    for every row. The house thresholds (85 / 60) encode "higher is better and
    85 is good", which is true of a delivery rate and false of a repeat rate:
    nothing in this business says what share of customers SHOULD come back, and
    painting 12.4% red would be the dashboard asserting a benchmark it cannot
    support. The cohort page's two rate gauges already carry `tone="neutral"`
    for the same reason; this keeps the bar list agreeing with them.
  */
  const peak = mode === 'magnitude'
    ? Math.max(1, ...rows.map((row) => (row.value === null ? 0 : row.value)))
    : 100
  const colour =
    mode === 'rate' ? toneFor(value) : 'var(--seq-450)'
```

(The existing `peak` ternary already yields 100 for anything that is not
`magnitude`, so only the `colour` line changes: `mode === 'rate'` where it said
`mode === 'rate'` before is unchanged — confirm by reading the file that
`share` falls through to `var(--seq-450)`.)

- [ ] **Step 2: Verify the existing callers still render**

Run: `npm run typecheck && npx vitest run`
Expected: green. `LogisticsPage` passes `'magnitude'` and `'rate'` only, so it
is untouched by the widened union.

- [ ] **Step 3: Write `CustomerFlowChart`**

```tsx
// src/components/charts/CustomerFlowChart.tsx
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

import { ChartTooltipPanel } from '@/components/charts/chartTooltip'
import type { CustomerFlowPointDto } from '@/lib/api'
import { formatDateShort, formatNumber } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * New customers against returning ones, over the reader's own window.
 *
 * ONE Y AXIS. A second one is forbidden in this codebase because it can be
 * rescaled to imply any relationship between two series. Here both lines
 * count PEOPLE, which is what makes one axis honest — and the gap between
 * them is the whole reading: on this portal returning customers run at
 * roughly a seventh of new ones, and the question is whether that ratio is
 * moving.
 *
 * COUNTS ONLY, never money. Revenue by arrival month is a different question
 * with a different denominator, and the tiles above already carry it.
 *
 * Modelled on `DailyOutcomeChart`, which is the logistics screen's and is
 * welded to Успешно / Отказ and a money toggle. Copied rather than
 * generalised: two small charts that share a shape are cheaper to read than
 * one chart with four props deciding what it means.
 */
export function CustomerFlowChart({
  data,
  grain,
  height,
}: {
  data: readonly CustomerFlowPointDto[]
  grain: 'day' | 'month'
  height?: number
}) {
  // Recharts drives its draw-in from JS, out of reach of the CSS media guards
  // every other animation sits behind — so it asks the same question here.
  const reducedMotion = useReducedMotion()

  const points = data.map((point) => ({
    ...point,
    label:
      grain === 'month'
        ? /* «2026-08» reads as a month; formatDateShort would print a first-of-
             the-month day and invite it to be read as one day's arrivals. */
          point.bucket.slice(0, 7)
        : formatDateShort(point.bucket),
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: height ?? '100%' }}>
      {/* Ours, not Recharts' <Legend>: its own reserves a band inside the plot
          and re-lays the chart out when it wraps. */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <LegendItem colour="var(--series-1)" label="Yangi mijoz" />
        <LegendItem colour="var(--series-3)" label="Qaytgan mijoz" />
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--ink-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--axis)' }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--ink-muted)' }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(value: number) => formatNumber(value)}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltipPanel formatter={(value: number) => formatNumber(value)} />}
            />
            <Line
              type="monotone"
              dataKey="newCustomers"
              name="Yangi mijoz"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={!reducedMotion}
            />
            <Line
              type="monotone"
              dataKey="returningCustomers"
              name="Qaytgan mijoz"
              stroke="var(--series-3)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={!reducedMotion}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function LegendItem({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-0.5 w-3 rounded-full"
        style={{ background: colour }}
      />
      {label}
    </span>
  )
}
```

Before running, open `src/components/charts/chartTooltip.tsx` and
`src/components/charts/DailyOutcomeChart.tsx` and match `ChartTooltipPanel`'s
actual prop names and the `LegendItem` helper's actual signature — copy them
rather than the sketch above if they differ.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/CategoryBarList.tsx src/components/charts/CustomerFlowChart.tsx
git commit src/components/charts/CategoryBarList.tsx src/components/charts/CustomerFlowChart.tsx -m "$(cat <<'EOF'
Give the bar list a rate mode that states a share without judging it

The existing rate mode grades on the house thresholds, 85 and 60, which is
right for a delivery rate and wrong for a repeat rate: these run 9% to 40%,
so every source would paint red and the dashboard would be asserting a
benchmark nothing in this business supports. The cohort page's own rate
gauges already carry tone="neutral" for that reason; `share` keeps the bar
list agreeing with them.

The flow chart is two lines on one axis because both count people. A second
axis can be rescaled to imply any relationship between two series and is
forbidden here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The band on the screen

**Files:**
- Modify: `src/features/cohort/CohortPage.tsx`

**Interfaces:**
- Consumes: `/insights/customers` (Task 6), `CustomerFlowDto` (Task 5), `CustomerFlowChart` and `CategoryBarList`'s `share` mode (Task 7), `CUSTOMER_STATES` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Add the query**

Beside the existing `concentration` query in `CohortPage`, add:

```tsx
  /*
    Period-scoped, and keyed on `apiParams` so the cache follows the period
    control — the same key shape the concentration read uses. The cohort read
    above deliberately takes no period; this one is the other clock on this
    screen and the section header says so.
  */
  const flow = useQuery({
    queryKey: ['customer-flow', apiParams],
    queryFn: ({ signal }) => apiGet<CustomerFlowDto>('/insights/customers', apiParams, signal),
  })

  const flowStatus = flow.isPending ? 'loading' : flow.isError ? 'error' : 'ready'
  const f = flow.data?.data
```

- [ ] **Step 2: Insert the band above «Kogorta tahlili»**

Immediately after `<PageShell …>` opens and before the existing
`<SectionHeader title="Kogorta tahlili" …>`:

```tsx
      {/*
        THE ARRIVAL BAND, AND IT IS ON THE OTHER CLOCK.

        Everything below this counts a customer from the day their first order
        was DELIVERED; this band counts them from the day they ORDERED. The two
        legitimately print different totals — 15 867 against 11 512 on
        2026-09-15 — so the clock is named here and in the cohort header below,
        never left for a reader to infer from two numbers that will not
        reconcile.
      */}
      <SectionHeader
        title="Mijozlar oqimi"
        hint="Buyurtma berilgan sana boʻyicha · tanlangan davr"
      />

      <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          status={flowStatus}
          label="Yangi mijozlar"
          value={f?.summary.newCustomers ?? null}
          unit="count"
          /* «Yangi mijoz» counts ARRIVALS, and a quarter of orders never land.
             The share that bought rides in the hint rather than replacing the
             headline: the client asked how customers are coming. */
          hint={
            f
              ? `${formatNumber(f.summary.newCustomersWon)} tasi xarid qildi · birinchi buyurtmasi shu davrda`
              : undefined
          }
        />
        <StatTile
          status={flowStatus}
          label="Qaytgan mijozlar"
          value={f?.summary.returningCustomers ?? null}
          unit="count"
          hint="Avval ham buyurtma bergan · shu davrda yana keldi"
        />
        <GaugeTile
          status={flowStatus}
          label="Takroriy tushum ulushi"
          value={f?.summary.repeatRevenueSharePercent ?? null}
          /* Uncoloured, like the whole-history gauge below it and the 90-day
             gauge at the bottom: there is no benchmark for what repeat share
             SHOULD be here, and painting a number red asserts one. */
          tone="neutral"
          hint="Tanlangan davrda · birinchi buyurtmadan keyingi savdolar"
        />
        <StatTile
          status={flowStatus}
          label="Yoʻqotilgan mijozlar"
          value={f?.states.rows.find((r) => r.key === 'LOST')?.ours ?? null}
          unit="count"
          /* BUGUNGI HOLAT, not the window's. Said on the tile because it sits
             in a row of three figures that all follow the period control. */
          hint={`${CUSTOMER_AT_RISK_DAYS} kundan beri buyurtma yoʻq · bugungi holat`}
        />
      </div>

      <ChartCard
        title="Yangi va qaytgan mijozlar"
        hint="Har ikkalasi ham mijoz soni — bitta oʻqda, shuning uchun oralaridagi masofa haqiqiy nisbatni koʻrsatadi."
      >
        {flow.isPending && <ChartSkeleton height={280} />}
        {flow.isError && (
          <ErrorState
            message={(flow.error as Error | null)?.message}
            onRetry={() => void flow.refetch()}
          />
        )}
        {f && f.series.length === 0 && (
          <EmptyState
            title="Bu davrda buyurtma yoʻq"
            body="Boshqa davrni tanlab koʻring."
          />
        )}
        {f && f.series.length > 0 && (
          <CustomerFlowChart data={f.series} grain={f.grain} height={280} />
        )}
      </ChartCard>

      <ChartCard
        title="Mijoz qayerdan kelayapti"
        /*
          THE TWO PANELS ARE ON DIFFERENT CLOCKS AND THE HINT SAYS BOTH.

          The count follows the period control; the rate cannot, because a
          source that acquired heavily last month would report a near-zero
          repeat rate for no reason but the calendar. Measured: without the
          horizon every source reads several points low and «База клиент»
          twenty points low.
        */
        hint="Yuqorida — shu davrda kelgan yangi mijozlar. Pastda — oʻsha manbadan kelgan mijozlarning qaytish foizi: butun tarix, birinchi xaridiga 90 kun toʻlganlar boʻyicha."
      >
        {f && f.sources.length === 0 && flowStatus === 'ready' ? (
          <EmptyState
            title="Manba maʼlumoti yoʻq"
            body="Bu davrda yangi mijoz kelmagan."
          />
        ) : (
          <div className="flex flex-col gap-5">
            <CategoryBarList
              mode="magnitude"
              status={flowStatus}
              rows={(f?.sources ?? []).map((s) => ({
                key: s.key || 'none',
                label: s.label,
                value: s.newCustomers,
                display: formatNumber(s.newCustomers),
                meta: s.sharePercent === null ? undefined : formatPercent(s.sharePercent),
              }))}
            />
            {/*
              SAME ROW ORDER, NEVER RE-SORTED. The whole mechanism is that the
              reader's eye runs straight down one column of labels — re-sorting
              this panel by rate turns a comparison into two unrelated lists.
            */}
            <CategoryBarList
              mode="share"
              status={flowStatus}
              rows={(f?.sources ?? []).map((s) => ({
                key: s.key || 'none',
                label: s.label,
                value: s.repeatPercent,
                display: s.repeatPercent === null ? NO_VALUE : formatPercent(s.repeatPercent),
                meta:
                  s.maturedCustomers === 0
                    ? '90 kunlik ufqi toʻlgan mijoz yoʻq'
                    : `${formatNumber(s.maturedCustomers)} ta mijozdan`,
              }))}
            />
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Mijozlar holati — bugun"
        /*
          The two columns are NOT meant to agree, and a reader who expects them
          to will read the block as broken. The hint states the disagreement is
          the finding before they get to the numbers.
        */
        hint="Chapda — oxirgi buyurtma sanasi boʻyicha. Oʻngda — portalning База voronkasidagi hukmi. Ikkisi bir xil chiqmaydi, va aynan shu farq koʻrsatkich. Davr tanlovi bu blokka taʼsir qilmaydi."
      >
        {flow.isPending && <ChartSkeleton height={200} />}
        {flow.isError && (
          <ErrorState
            message={(flow.error as Error | null)?.message}
            onRetry={() => void flow.refetch()}
          />
        )}
        {f && <CustomerStateTable states={f.states} />}
      </ChartCard>
```

- [ ] **Step 3: Write the `CustomerStateTable` helper at the bottom of the file**

Beside `StageLadder` and `RepeatShareCard`:

```tsx
/**
 * Two verdicts on the same people, side by side, never reconciled.
 *
 * Hand-drawn rather than charted: four fixed rows compared against each other
 * need a number and a bar, not a chart library — it works at 360px, it prints,
 * and every figure stays on screen instead of behind a hover.
 *
 * «Базада yoʻq» carries an em dash on our side, not a zero. A 0 there would
 * read as "nobody is in this state", when what is true is that the state does
 * not exist on that side of the comparison.
 */
function CustomerStateTable({ states }: { readonly states: CustomerStatesDto }) {
  const total = states.customers

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="flex items-baseline gap-3 text-[11px]"
        style={{ color: 'var(--ink-muted)' }}
      >
        <span className="min-w-0 flex-1" />
        <span className="w-20 text-right">Buyurtma boʻyicha</span>
        <span className="w-20 text-right">Портал (База)</span>
      </div>

      {states.rows.map((row) => (
        <div key={row.key} className="flex items-baseline gap-3">
          <span
            className="min-w-0 flex-1 truncate text-[12.5px]"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <span
              aria-hidden
              className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: `var(${row.colour})` }}
            />
            {row.label}
          </span>
          <span className="w-20 text-right text-[13px] tabular-nums">
            {row.ours === null ? NO_VALUE : formatNumber(row.ours)}
          </span>
          <span className="w-20 text-right text-[13px] tabular-nums">
            {formatNumber(row.portal)}
          </span>
        </div>
      ))}

      <p className="pt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Jami {formatNumber(total)} ta mijoz · har ikkala ustun ham shu songa yigʻiladi.
      </p>

      {/*
        THE TRIPWIRE, PRINTED. The portal adds stages — it added a 19th
        Доставка stage on 2026-09-10 — and a stage this screen does not know
        is counted as «Xavf ostida». Saying which one is what turns a silent
        mis-bucketing into a thing somebody fixes.
      */}
      {states.unbucketedStages.length > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
          Notanish bosqich: {states.unbucketedStages.join(', ')} — «Xavf ostida» deb sanaldi.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Name the other clock on the existing cohort header**

Change the existing `SectionHeader` for «Kogorta tahlili» hint from:

```
hint="Koʻrsatkichlar — butun tarix · matritsa — soʻnggi 18 oy · tanlangan davr bu blokka taʼsir qilmaydi."
```

to:

```
hint="Yetkazilgan sana boʻyicha · koʻrsatkichlar — butun tarix · matritsa — soʻnggi 18 oy · tanlangan davr bu blokka taʼsir qilmaydi."
```

Add above it:

```tsx
      {/*
        THE CLOCK, NAMED, because the band above this one is on the other.
        «Mijozlar oqimi» counts a customer from the day they ORDERED and this
        block counts them from the day their first order was DELIVERED — 15 867
        against 11 512 on 2026-09-15. Unlabelled, the two totals read as one of
        them being broken.
      */}
```

- [ ] **Step 5: Add the imports**

At the top of `CohortPage.tsx`: `CustomerFlowChart`, `CategoryBarList`,
`CUSTOMER_AT_RISK_DAYS` from `@/lib/customerStates`, and
`type CustomerFlowDto`, `type CustomerStatesDto` from `@/lib/api`.

- [ ] **Step 6: Verify**

Run: `npm run verify`
Expected: green.

Then run the dev server and open the screen: `npm run dev`, then
`http://localhost:3000/analytics/cohort` (never `127.0.0.1` — better-auth
rejects the other host as an untrusted origin). The local `sinolife` seed has
1 600 deals and no confirmation queue, so expect thin but non-empty bars; the
numbers that matter are checked against production in Task 9.

- [ ] **Step 7: Commit**

```bash
git add src/features/cohort/CohortPage.tsx
git commit src/features/cohort/CohortPage.tsx -m "$(cat <<'EOF'
Put arrivals, sources and churn at the top of «Mijoz qaytishi»

The screen has answered "do customers come back" and never "how are they
arriving, from where, and who stopped". Four tiles, the two-line flow chart,
the source panels and the two churn verdicts go above the matrix; nothing
below moves.

Both clocks are now named. This band counts a customer from the day they
ordered and the matrix counts them from the day their first order was
delivered — 15 867 against 11 512 — and unlabelled the two totals read as
one of them being broken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Verify the invariants against production, then document

**Files:**
- Create: `probe-flow-verify.ts` (throwaway; `git add` it immediately — untracked files in this repo get wiped)
- Modify: `CLAUDE.md` (the screen table, around line 425)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing downstream.

- [ ] **Step 1: Confirm the machine can still reach production**

Run: `curl -s https://api.ipify.org` and
`doctl databases firewalls list 352cdb7b-53a7-4567-842f-5fee6d852f38`

The IP must appear in the list. **It rotates**, and when it has, the
connection HANGS rather than failing. Appending a rule is refused by the
auto-mode classifier — ask the user to run
`doctl databases firewalls append 352cdb7b-53a7-4567-842f-5fee6d852f38 --rule ip_addr:<new ip>`
themselves with the `!` prefix.

- [ ] **Step 2: Write the verification probe**

Read `probe-cust1.ts` in the repo root for the exact connection recipe — the
URI goes to a file (never inlined), the CA comes from `doctl databases get-ca`,
and `sslmode` must be stripped from the URI or `pg` v9 ignores the CA and dies
with «self-signed certificate in certificate chain».

The probe calls the SERVICE, not the SQL, so it tests what the screen gets:
build `new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl: { ca, rejectUnauthorized: true } }) })`, construct `new InsightsRepository(prisma)`
and `new InsightsService(repository)`, and call `customerFlow('UZS', period, {})`
for a 30-day and a 365-day window.

Assert, and print, all five:

1. `sum(series[].newCustomers) === summary.newCustomers`
2. `sum(series[].returningCustomers) === summary.returningCustomers`
3. `sum(sources[].newCustomers) === summary.newCustomers` — the `(manbasiz)` row included
4. `states.rows` — the `ours` column (excluding the null on «Базада yoʻq») and the `portal` column each sum to `states.customers`
5. `states.unbucketedStages` is empty

- [ ] **Step 3: Run it**

Run: `git add probe-flow-verify.ts && npx tsx probe-flow-verify.ts`
Expected: all five hold. Round trip from here to fra1 is ~1.4 s per
whole-screen call; if `customerFlow` takes more than ~3 s, say so rather than
shipping it — this cluster is one vCPU with 2 MB `work_mem`.

**If an invariant fails, stop and fix the statement.** These are the reasons
each one exists: a series that does not sum to its own total means the grain
is dropping a bucket at a window edge; sources that do not sum mean the
sourceless row was lost to an inner join; a state column that does not sum
means the `LEFT JOIN` or the `min(bucket)` is wrong and one customer is being
counted twice or not at all.

- [ ] **Step 4: Record the numbers in the plan's own spec**

Append the measured figures to
`docs/superpowers/specs/2026-09-15-mijozlar-oqimi-design.md` under §7, with the
date — so the next reader can tell whether the screen has drifted since.

- [ ] **Step 5: Add the screen to `CLAUDE.md`**

The screen table around line 425 has a row for «Mijoz qaytishi». Add
`/insights/customers` to its endpoint list and extend its cohort column to name
both clocks: the matrix on `closedAt` over revenue-bearing WON deals, the
arrival band on `createdAtSource` over revenue-bearing orders of any status.

Add one line to the per-screen notes below (where «Mijoz qaytishi — «Faol
bazada» is a separate DISTINCT-customer total» already sits): that the band and
the matrix carry different customer totals on purpose, and that the churn block
takes no period.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-15-mijozlar-oqimi-design.md probe-flow-verify.ts
git commit CLAUDE.md docs/superpowers/specs/2026-09-15-mijozlar-oqimi-design.md -m "$(cat <<'EOF'
Check the customer flow against production and write down both clocks

Five invariants hold on the live portal: the series and the source rows each
sum to the new-customer total the tiles print, both state columns sum to the
customer total, and no RETENTION stage falls outside the table.

CLAUDE.md's screen row now names both clocks for «Mijoz qaytishi», because
the two blocks on it legitimately print different customer totals and the
next reader should learn that from the entry point rather than from the gap.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Report, do not push**

Pushing to `main` deploys. Tell the user what shipped locally and wait for
«deploy qil».

---

## Self-Review

**Spec coverage.** §1 → Task 8. §2's measurements → cited in Tasks 1-4's
comments and re-checked in Task 9. §3 (the two clocks) → Task 8 step 4 and
Task 9 step 5. §4 (definitions) → Global Constraints, Task 3. §5.1 → Task 6.
§5.2 → Task 3. §5.3 → Task 4. §5.4 → Tasks 1 and 2. §5.5 (service, caching)
→ Task 5. §6 (screen) → Tasks 7 and 8. §7 (tests and invariants) → the test
in every task plus Task 9. §8 (out of scope) → nothing built. §9 (known
unfixed) → the 0.3% duplicate note stays in the spec; `isReturnCustomer` is
untouched, as promised.

**One thing the spec asked for that no task builds:** §6 lists a per-card
`EmptyState` for the state block. It has none — `customerStates` returns
counts that are zero rather than rows that are absent, so there is nothing to
be empty. Left as is deliberately.

**Type consistency.** `CustomerStateKey`, `STATE_BUCKET`, `CustomerFlowRows`,
`SourceRepeatRate`, `CustomerFlowDto` and `grainFor` are defined in Tasks 1,
2, 3, 4 and 5 and used under those exact names in Tasks 5, 6 and 8. The DTO
field `firstRevenue`/`repeatRevenue` is named the same in `api.ts` and in the
service. `mode="share"` is added in Task 7 and consumed in Task 8.
