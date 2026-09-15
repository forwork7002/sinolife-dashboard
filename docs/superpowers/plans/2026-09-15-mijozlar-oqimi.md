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

> **REVISED 2026-09-15, after `origin/main` moved.** Tasks 1–4 shipped as written and are
> merged. Everything from here was re-planned: commit `9d5246c` rebuilt «Mijoz qaytishi»
> the same day — it added `src/lib/retentionGroups.ts` (a four-way partition of the База
> funnel keyed by stage ID) with `src/features/cohort/StateBars.tsx` to draw it, rewrote
> the cohort matrix to a cumulative reading, and **removed the period control from the
> screen** on the stated ground that it drove nothing. Two decisions from the user settle
> what that means here:
>
> 1. **The band resolves its own trailing 90 days on the server**, with no control, the
>    shape `/insights/concentration` took in that same commit.
> 2. **`retentionGroups` wins.** Our `src/lib/customerStates.ts` loses its stage table.
>    Only the TIME verdict survives from it — «no order in 60 / 150 days» — because that
>    is a fact about what the customer did, which no stage table can answer.
>
> And one ruling of mine that follows: the portal's side of the comparison is **already on
> the screen**, in upstream's «База — mijozlar hozir qayerda» card. Our block must not draw
> it twice. So the churn block carries the time bands alone and names where the portal's
> answer lives; `customerStates()` loses its portal half entirely, which deletes more code
> than it adds.

### Task 5: Retire our state module onto upstream's partition

**Files:**
- Modify: `src/lib/customerStates.ts` (delete the stage table and the bucket integers; keep the thresholds and the three time states)
- Modify: `src/server/repositories/insightsRepository.ts` (delete `stateCaseSql`; simplify `customerStates()` to the time bands)
- Modify: `tests/domain/customerStates.test.ts`
- Modify: `tests/http/customerStatesSql.test.ts`

**Interfaces:**
- Consumes: upstream's `src/lib/retentionGroups.ts` and `retentionGroupCaseSql` — **read them, do not touch them**.
- Produces: `CUSTOMER_ACTIVE_DAYS = 60`, `CUSTOMER_AT_RISK_DAYS = 150`, `CUSTOMER_STATES` (unchanged: `{ key, label, colour }`, keys `'ACTIVE' | 'AT_RISK' | 'LOST'`), `type CustomerStateKey`, and
  `async customerStates(): Promise<{ customers: number; ours: Record<CustomerStateKey, number> }>`

**What goes, and why.** `RETENTION_STATE_STAGES`, `STATE_BUCKET`, `UNBUCKETED_BUCKET`, `ABSENT_BUCKET`, `PORTAL_ABSENT` and `InsightsRepository.stateCaseSql` all go. They were a second definition of a partition `retentionGroups.ts` already owns, keyed by stage NAME where upstream keys by stage ID — and ID is the stabler key, because a portal rename moves a name and not an id. The `baza`, `best` and `portal` CTEs go with them, along with the `unbucketedStages` UNION arm: upstream's own query already reports its unmapped stages as «Boshqa bosqichlar».

**What stays.** `cust`, `last_order` and `ours`, and the two thresholds — measured from p75 (73.9 days) and p90 (141.1) of the real inter-purchase interval, which nothing upstream measures.

- [ ] **Step 1: Read what you are deferring to**

Read `src/lib/retentionGroups.ts` and `src/features/cohort/StateBars.tsx`. You are not changing either. You are deleting the thing that competes with them, and your new comments should point a reader at them by name.

- [ ] **Step 2: Cut the tests down first, and watch them fail**

In `tests/domain/customerStates.test.ts`, delete the tests for the stage partition, the bucket integers and the verbatim-Russian names — every one of those facts now lives in upstream's own test for `retentionGroups`. Keep the thresholds test. Add one test that pins the reason the module still exists:

```ts
  it('keeps only what the stage table cannot answer', async () => {
    /*
      src/lib/retentionGroups.ts owns the partition of the База funnel and
      is read by both the screen and the SQL. This module owns one different
      thing: how long a customer has been SILENT, which is a fact about their
      orders and not about any stage they sit on. If a stage list ever
      reappears here, there are two definitions of one partition again.
    */
    const mod = await import('@/lib/customerStates')
    expect(Object.keys(mod).some((k) => /STAGE|BUCKET|PORTAL/i.test(k))).toBe(false)
  })
```

In `tests/http/customerStatesSql.test.ts`, delete the assertions about `min(bucket)`, the `RETENTION`/`OPEN` filters, the `LEFT JOIN` and the unrecognised-stage arm. Keep the two that still hold — the order clock, and `countsAsRevenue` named explicitly — and keep the parameterised-thresholds test. Add one:

```ts
  it('no longer reads the retention funnel at all', () => {
    // Upstream's retentionStages query owns that reading; this one is about
    // order dates. Two statements answering the same question is how they
    // start disagreeing.
    expect(code()).not.toMatch(/'RETENTION'/)
    expect(code()).not.toMatch(/deal_stage/)
  })
```

Run: `npx vitest run tests/domain/customerStates.test.ts tests/http/customerStatesSql.test.ts`
Expected: FAIL — the new tests fail against the current module and statement.

- [ ] **Step 3: Cut the module**

Delete `RETENTION_STATE_STAGES`, `STATE_BUCKET`, `UNBUCKETED_BUCKET`, `ABSENT_BUCKET` and `PORTAL_ABSENT` from `src/lib/customerStates.ts`. Rewrite the file header so it says what the module is now — the silence thresholds and their three labels — and names `retentionGroups.ts` as the owner of the funnel partition, so a reader who comes looking for stages is sent one file over rather than left to add them back.

- [ ] **Step 4: Cut the statement**

In `customerStates()`, delete the `baza`, `best` and `portal` CTEs, the whole second UNION arm, and every `portal_*` column. Delete `stateCaseSql` and its import of the stage table. What remains is one row:

```sql
      WITH cust AS (
        SELECT DISTINCT d."customerId" AS cid
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
      ),
      last_order AS (
        SELECT d."customerId" AS cid, max(d."createdAtSource") AS last_ts
        FROM "deal" d
        WHERE d."countsAsRevenue" AND d."customerId" IS NOT NULL
        GROUP BY 1
      ),
      ours AS (
        SELECT l.cid,
          CASE
            WHEN l.last_ts >= now() - make_interval(days => $1::int) THEN 'ACTIVE'
            WHEN l.last_ts >= now() - make_interval(days => $2::int) THEN 'AT_RISK'
            ELSE 'LOST'
          END AS state
        FROM last_order l
      )
      SELECT
        (SELECT count(*) FROM cust)::bigint AS customers,
        count(*) FILTER (WHERE state = 'ACTIVE')::bigint AS active,
        count(*) FILTER (WHERE state = 'AT_RISK')::bigint AS at_risk,
        count(*) FILTER (WHERE state = 'LOST')::bigint AS lost
      FROM ours
```

The state literals are the `CustomerStateKey` values and the three counts must sum to `customers` — say both in comments. Keep the thresholds as `$1`/`$2`.

- [ ] **Step 5: Verify, including against the database**

Run the two focused test files, then the full suite once, then `npm run typecheck`.

Then EXPLAIN and run the statement against the local dev cluster, the way Tasks 2–4 did — extract the template literal from the committed file so what you test is what you ship. Report the plan and the returned row, and confirm the three counts sum to `customers`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/customerStates.ts src/server/repositories/insightsRepository.ts tests/domain/customerStates.test.ts tests/http/customerStatesSql.test.ts
git commit src/lib/customerStates.ts src/server/repositories/insightsRepository.ts tests/domain/customerStates.test.ts tests/http/customerStatesSql.test.ts -m "$(cat <<'EOF'
Let retentionGroups own the funnel, and keep only what it cannot answer

Two modules in src/lib partitioned the same База funnel — upstream's by
stage id, ours by stage name — and both their headers say that must not
happen. Ours goes. The id is the stabler key anyway: a portal rename moves a
name and leaves an id alone.

What survives is the one reading no stage table can give: how long a customer
has been silent, banded at 60 and 150 days, which came from p75 and p90 of the
measured inter-purchase interval. The portal's own verdict on the same people
is already on this screen in «База — mijozlar hozir qayerda», so drawing it
twice was the other thing to stop.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: DTOs and the service, on a fixed trailing 90 days

**Files:**
- Modify: `src/lib/api.ts` (add the DTOs beside `ConcentrationDto`)
- Modify: `src/server/services/insightsService.ts`
- Test: `tests/domain/customerFlow.test.ts`

A partial, uncommitted attempt at this task exists at
`.superpowers/sdd/2026-09-15-mijozlar-oqimi/task5-partial.patch`. It was written against the
old period-scoped design and stopped mid-way. Read it for the DTO shapes if useful; do not
apply it.

**Interfaces:**
- Consumes: `customerStates()` (Task 5), `customerFlow({ period, grain })` and `sourceRepeatRates()` (already shipped, unchanged).
- Produces, in `src/lib/api.ts`:

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
  readonly customers: number
}
export interface CustomerFlowDto {
  /** The window this band resolved for itself, so the screen can print it. */
  readonly window: { readonly start: string; readonly end: string; readonly days: number }
  readonly summary: CustomerFlowSummaryDto
  readonly series: readonly CustomerFlowPointDto[]
  readonly sources: readonly CustomerSourceDto[]
  readonly states: {
    readonly customers: number
    readonly rows: readonly CustomerStateRowDto[]
  }
}
```

- Service: `async customerFlow(currency: string, now: Date, timeZone: string): Promise<CustomerFlowDto>`.

**The window is the service's own, and there is no `grain` argument.** The band resolves a trailing 90 days ending now, and asks the repository for **day** grain. Ninety days at month grain is three bars, which is a number wearing an axis; ninety daily points are a curve. `customerFlow`'s `grain` parameter stays as it is — it is tested — and this caller passes `'day'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/customerFlow.test.ts
import { describe, expect, it } from 'vitest'

import { trailingWindow } from '@/server/services/insightsService'

describe('the band’s own window', () => {
  it('trails ninety days back from now, half-open', () => {
    /*
      The screen lost its period control on 2026-09-15 because it drove
      nothing, so this band resolves its own window on the server — the same
      shape /insights/concentration took in that commit. Ninety days is the
      horizon the repeat-rate column already uses, so the two halves of the
      source block are measured over spans a reader can hold together.
    */
    const now = new Date('2026-09-15T08:00:00Z')
    const w = trailingWindow(now)
    expect(w.end.toISOString()).toBe('2026-09-15T08:00:00.000Z')
    expect(w.start.toISOString()).toBe('2026-06-17T08:00:00.000Z')
    expect(w.days).toBe(90)
  })

  it('does not mutate the clock it was handed', () => {
    // A Date is mutable and `setDate` on the caller's instance would move
    // every other window resolved from it in the same request.
    const now = new Date('2026-09-15T08:00:00Z')
    trailingWindow(now)
    expect(now.toISOString()).toBe('2026-09-15T08:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/customerFlow.test.ts`
Expected: FAIL — no such export.

- [ ] **Step 3: Write the helper, the DTOs and the service method**

```ts
/**
 * The band's own ninety days.
 *
 * «Mijoz qaytishi» has no period control — it was removed on 2026-09-15
 * because it drove nothing, and its «Bugun» default had made the
 * concentration band read twelve customers and one first-to-second pair. So
 * this band resolves its own window, as that commit made /insights/
 * concentration do, and the card prints the dates rather than implying a
 * control that is not there.
 *
 * NINETY, not thirty and not a year, because the source block's repeat column
 * is measured on a ninety-day horizon: one span across the whole card is one
 * fewer thing for a reader to hold.
 */
export function trailingWindow(now: Date): { start: Date; end: Date; days: number } {
  const days = 90
  /* A new Date, never `now` itself: Date is mutable and every other window
     resolved from the same instant in this request would move with it. */
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { start, end: new Date(now.getTime()), days }
}
```

Add the six DTOs to `src/lib/api.ts` with a header saying the three clocks: the series and summary are the band's own trailing ninety days by ORDER date; `sources[].repeatPercent` is the whole history on a ninety-day maturity horizon and moves with neither; `states` is today. Say that the cohort matrix on the same screen counts a customer from when their first order was DELIVERED, so the two totals differ on purpose.

Then the service method, modelled on `cohorts()` beside it:

```ts
  async customerFlow(currency: string, now: Date, timeZone: string): Promise<CustomerFlowDto> {
    const w = trailingWindow(now)
    const period: Period = { start: w.start, end: w.end, timeZone, preset: 'custom' }

    /*
      THREE READS, THREE CLOCKS, AND ONLY ONE OF THEM MOVES.

      The window is resolved here and not by the caller, so the key below is
      the DAY it lands on rather than the instant: a band that re-queried on
      every request would put the most expensive statement on this screen into
      a one-vCPU database once per reader per minute. Measured on production:
      customerFlow 370-1478 ms warm, 3.7-8 s cold.

      No scope in the key because there is no scope to carry — `cohort` is in
      COMPANY_WIDE and this endpoint asks for `analytics:read:all`, so every
      caller who gets through reads the same rows. If that ever changes, the
      key changes in the same commit or the memo goes.
    */
    const dayKey = w.end.toISOString().slice(0, 10)

    const [flow, rates, states] = await Promise.all([
      customerFlowCache.get(`flow|${dayKey}|${w.days}|day`, () =>
        this.repository.customerFlow({ period, grain: 'day' }),
      ),
      sourceRatesCache.get('rates', () => this.repository.sourceRepeatRates()),
      customerStatesCache.get('states', () => this.repository.customerStates()),
    ])
    …
  }
```

Fold the rest as the old plan had it: `sharePercent` against `summary.newCustomers` (null when there are none), `repeatPercent` and `maturedCustomers` from `byKey.get(row.key)` with `?? null` and `?? 0` — **a source with nothing matured is ABSENT from `sourceRepeatRates` rather than present with a null, so the `??` is what produces the null the screen needs; say so in a comment.** Build `states.rows` from `CUSTOMER_STATES` in its order. Name the money total `moneyTotal`.

Caches, beside the existing `confirmationRopCache`:

```ts
const customerFlowCache = ttlCache<Awaited<ReturnType<InsightsRepository['customerFlow']>>>(60_000)
const sourceRatesCache = ttlCache<Awaited<ReturnType<InsightsRepository['sourceRepeatRates']>>>(5 * 60_000)
const customerStatesCache = ttlCache<Awaited<ReturnType<InsightsRepository['customerStates']>>>(5 * 60_000)
```

- [ ] **Step 4: Verify**

Focused test, full suite once, `npm run typecheck`. All three must be clean — this worktree has no scratch files, so there is no error baseline to subtract any more.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/server/services/insightsService.ts tests/domain/customerFlow.test.ts
git commit src/lib/api.ts src/server/services/insightsService.ts tests/domain/customerFlow.test.ts -m "$(cat <<'EOF'
Give the arrivals band its own ninety days, since the screen no longer has one

The period control left «Mijoz qaytishi» because it drove nothing, so the band
resolves its window on the server the way the concentration band now does, and
the card prints the dates instead of implying a control that is not there.
Ninety days matches the horizon the source block's repeat column already uses,
which is one span across the card rather than two.

The memo is keyed on the day the window lands on, not the instant, or the most
expensive statement on this screen would run once per reader per minute
against one vCPU — 370 ms to 1.5 s warm, and up to eight seconds cold.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The endpoint

**Files:**
- Create: `src/app/api/v1/insights/customers/route.ts`
- Modify: `docs/API.md`

**Do NOT edit `tests/http/routeAccess.test.ts`.** That suite discovers routes from the filesystem (`routeFiles(API_ROOT)`) and asserts properties over `it.each` — there is no table to add a row to. Its one hand-written list, `NARROWS`, is asserted against routes that do **not** declare `permission: 'analytics:read:all'`, and this route declares exactly that, so it is filtered out and needs no entry.

- [ ] **Step 1: Run the suite and record what it does not yet see**

Run: `npx vitest run tests/http/routeAccess.test.ts`
Confirm `insights/customers` appears in no case name. That is your RED.

- [ ] **Step 2: Write the route**

```ts
import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'cohort' } as const

/**
 * «Mijozlar oqimi» — arrivals, returns, sources and silence.
 *
 * TAKES NO PERIOD, like `/insights/cohorts` beside it and for a related
 * reason. That one refuses a window because a retention matrix is a statement
 * about the whole history; this one resolves its OWN trailing ninety days,
 * because the screen's period control was removed on 2026-09-15 and a band
 * that read a parameter nothing sets would answer «Bugun» forever.
 *
 * The empty schema is written out rather than omitted so that giving this
 * endpoint a parameter is a decision somebody makes, not an oversight.
 */
const schema = z.object({})

export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const data = await insightsService.customerFlow(ctx.currency, ctx.now, ctx.timeZone)
  return { data }
})
```

Check `getHandler`'s signature and how a sibling route with no query parameters declares its schema before settling on `z.object({})`; follow what the file's neighbours do.

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/http/routeAccess.test.ts` — the new file must now appear as its own case and pass. Then the full suite and `npm run typecheck`.

- [ ] **Step 4: Document it**

In `docs/API.md`, add `/insights/customers` beside `/insights/cohorts`: that it takes no parameters, that it resolves a trailing 90 days itself, the `CustomerFlowDto` shape, and one line saying it counts by ORDER date where `/insights/cohorts` counts by DELIVERED date.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/insights/customers/route.ts docs/API.md
git commit src/app/api/v1/insights/customers/route.ts docs/API.md -m "$(cat <<'EOF'
Serve the customer flow at /insights/customers, on a window it resolves itself

It takes no parameters. The screen it feeds lost its period control, so an
endpoint that read one would answer «Bugun» forever — the failure that made
the concentration band report twelve customers under a red gauge.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The two chart pieces

**Files:**
- Modify: `src/components/charts/CategoryBarList.tsx`
- Create: `src/components/charts/CustomerFlowChart.tsx`

- [ ] **Step 1: Widen `CategoryBarList`'s mode, and change nothing else**

Read the component first. `peak` is `mode === 'magnitude' ? … : 100` and `colour` is `mode === 'rate' ? toneFor(value) : 'var(--seq-450)'`, so a new `'share'` member already falls through to a hundred-denominator bar in the neutral hue. **The only code change is widening the union** to `'magnitude' | 'rate' | 'share'`; if the file does not match that description, stop and report rather than inventing a change.

Add a comment saying why `share` exists: `rate` grades on the house thresholds (85 / 60), which is right for a delivery rate and wrong for a repeat rate — these run 9% to 40%, so every source would paint critical and the dashboard would assert a benchmark nothing in this business supports. Both rate gauges on this very screen already carry `tone="neutral"` for that reason.

- [ ] **Step 2: Confirm the existing callers are untouched**

Run: `npm run typecheck && npx vitest run`
`LogisticsPage` passes only `'magnitude'` and `'rate'`, so a widened union cannot reach it.

- [ ] **Step 3: Write `CustomerFlowChart`**

Two lines, ONE Y axis, counts only. Both series are people, which is what makes one axis honest; a second axis can be rescaled to imply any relationship and is forbidden in this codebase. Model it on `src/components/charts/DailyOutcomeChart.tsx` — copy its `ChartTooltipPanel` usage, its hand-rolled legend (Recharts' own `<Legend>` reserves a band inside the plot and re-lays the chart out when it wraps) and its `useReducedMotion` guard. Props:

```tsx
export function CustomerFlowChart({
  data,
  height,
}: {
  data: readonly CustomerFlowPointDto[]
  height?: number
}) 
```

No `grain` prop — the band is always ninety daily points. Label the X axis with `formatDateShort(point.bucket)`, legend «Yangi mijoz» / «Qaytgan mijoz», colours `var(--series-1)` and `var(--series-3)`.

**One thing the series does not do: gap-fill.** A day with no orders at all emits no row, so a quiet day is a missing point rather than a zero. Say so in the component's header — with ninety daily buckets on this portal's volume it will rarely bite, and a reader who sees a straight segment should know why.

- [ ] **Step 4: Verify**

`npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/CategoryBarList.tsx src/components/charts/CustomerFlowChart.tsx
git commit src/components/charts/CategoryBarList.tsx src/components/charts/CustomerFlowChart.tsx -m "$(cat <<'EOF'
Give the bar list a rate mode that states a share without judging it

The existing rate mode grades on 85 and 60, which is right for a delivery rate
and wrong for a repeat rate: these run 9% to 40%, so every source would paint
red and the dashboard would be asserting a benchmark nothing in this business
supports. Both rate gauges already on this screen carry tone="neutral" for the
same reason.

The flow chart is two lines on one axis because both count people.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The band on the screen

**Files:**
- Modify: `src/features/cohort/CohortPage.tsx`

**Read the file first.** It was rewritten on 2026-09-15: the cohort matrix is cumulative, «База — mijozlar hozir qayerda» draws `<StateBars>` from upstream's four-way partition, the concentration band resolves its own trailing ninety days, and **`useDashboardFilters` is gone**. Your band adds to that screen; it does not restore anything that was removed.

- [ ] **Step 1: Add the query**

```tsx
  const flow = useQuery({
    queryKey: ['customer-flow'],
    queryFn: ({ signal }) => apiGet<CustomerFlowDto>('/insights/customers', {}, signal),
    /* Ninety days do not move in a minute, and the server memoises on the day
       this window lands on. Match the cohort read beside it. */
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
```

A literal key with no `apiParams`, like the concentration read above it — there is no period to carry, and a key that could carry one would invite somebody to pass one.

- [ ] **Step 2: Put the band at the TOP, above «Kogorta tahlili»**

- `SectionHeader` «Mijozlar oqimi», hint naming the window and the clock: «Buyurtma berilgan sana boʻyicha · soʻnggi 90 kun» with the resolved dates from `data.window`.
- Four tiles: **Yangi mijozlar** (`summary.newCustomers`, hint `${newCustomersWon} tasi xarid qildi` — the headline counts arrivals and a quarter of orders never land), **Qaytgan mijozlar**, **Takroriy tushum ulushi** as a `GaugeTile` with `tone="neutral"` (no benchmark exists; the two gauges below it already do this), and **Yoʻqotilgan mijozlar** (the `LOST` row of `states.rows`, hint «150 kundan beri buyurtma yoʻq · bugungi holat» — it is the one tile in the row that is not about the window).
- `ChartCard` «Yangi va qaytgan mijozlar» → `<CustomerFlowChart data={f.series} height={280} />`, with loading, error and empty branches. All three: the «База» card shipped without an error branch once and a failed request read as an empty funnel.
- `ChartCard` «Mijoz qayerdan kelayapti» → two `CategoryBarList` panels, `magnitude` above (new customers per source) and `share` below (that source's repeat %), **in the same row order, the lower panel never re-sorted** — the mechanism is that the reader's eye runs down one column of labels. Hint must say the two panels are on different clocks: the count is the band's ninety days, the rate is the whole history on a ninety-day maturity horizon.
- `ChartCard` «Mijozlar holati — bugun» → the three time bands as hand-drawn rows with their `colour` from the shared table, over a caption saying the total and pointing at the other card: «Портал oʻz hukmini «База — mijozlar hozir qayerda» kartasida aytadi». **Do not redraw the portal's groups** — `StateBars` already does, further down the same page.

- [ ] **Step 3: Name the other clock on the existing cohort header**

The «Kogorta tahlili» hint gains «yetkazilgan sana boʻyicha» at the front. Add a comment above it saying the band at the top counts a customer from the day they ORDERED and this block from the day their first order was DELIVERED, so the two customer totals differ on purpose. Change nothing else in that block.

- [ ] **Step 4: Verify**

`npm run typecheck && npm run lint && npx vitest run`, then run the app and open `http://localhost:3000/analytics/cohort` — **`localhost`, never `127.0.0.1`**, or better-auth rejects the origin as untrusted and the sign-in form silently re-renders. Note that this worktree cannot run `next dev` while the main checkout's server is running; if it is, verify on production in Task 10 instead and say so.

- [ ] **Step 5: Commit**

```bash
git add src/features/cohort/CohortPage.tsx
git commit src/features/cohort/CohortPage.tsx -m "$(cat <<'EOF'
Put arrivals, sources and silence at the top of «Mijoz qaytishi»

The screen answers whether customers come back and, since this morning, where
the база stands. It still does not answer how customers are ARRIVING, from
which source, or which of them have gone quiet by their own order dates.

Both clocks are now named. The band counts a customer from the day they
ordered and the matrix from the day their first order was delivered, and
unlabelled the two totals read as one of them being broken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Verify against production, then document

**Files:**
- Create: `probe-flow-verify.mts` (throwaway; `git add` it immediately)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Check the machine can still reach production**

`curl -s https://api.ipify.org` against
`doctl databases firewalls list 352cdb7b-53a7-4567-842f-5fee6d852f38`. **The IP rotates**, and when it has, the connection HANGS rather than failing. Appending a rule is refused by the auto-mode classifier — ask the user to run
`doctl databases firewalls append 352cdb7b-53a7-4567-842f-5fee6d852f38 --rule ip_addr:<new ip>` themselves with the `!` prefix.

- [ ] **Step 2: Write the probe**

Read `probe-rates-prod.mts` in the repo root for the working recipe: the URI goes to a file and is never inlined, the CA comes from `doctl databases get-ca`, and **`sslmode` must be stripped from the URI** or `pg` v9 ignores the CA and dies with «self-signed certificate in certificate chain».

Call the SERVICE, not the SQL, so the probe tests what the screen gets.

- [ ] **Step 3: Assert these four invariants, and no others**

1. `sum(series[].newCustomers) === summary.newCustomers` — a customer is new in exactly one bucket.
2. `sum(sources[].newCustomers) === summary.newCustomers`, the `(manbasiz)` row included.
3. `states.rows` sums to `states.customers`.
4. `window.days === 90` and `window.end` is within a minute of now.

**Do NOT assert `sum(series[].returningCustomers) === summary.returningCustomers`.** It cannot hold and the earlier draft of this plan was wrong to ask for it: a customer who returns in three different days is legitimately in three buckets. Assert `>=` instead, and put the reason beside it.

- [ ] **Step 4: Run it, and report the timing**

If the whole-screen call takes more than about three seconds cold, say so rather than shipping quietly — this cluster is one vCPU with 2 MB `work_mem`, and `sourceRepeatRates` alone touches ~138 MB of buffers against 190 MB of `shared_buffers`.

- [ ] **Step 5: Record the numbers in the spec**

Append the measured figures and the date to `docs/superpowers/specs/2026-09-15-mijozlar-oqimi-design.md` under §7, so a later reader can tell whether the screen has drifted.

- [ ] **Step 6: Update `CLAUDE.md`**

The screen table's «Mijoz qaytishi» row gains `/insights/customers`, and its cohort column must name both clocks — the matrix on `closedAt` over revenue-bearing WON deals, the arrivals band on `createdAtSource` over revenue-bearing orders of any status, on a server-resolved trailing 90 days. Add one line to the per-screen notes saying the two customer totals differ on purpose and that the silence block takes no window.

- [ ] **Step 7: Commit, and stop**

Commit `CLAUDE.md` and the spec. **Do not push** — pushing to `main` deploys. Report what is on the branch and wait for «deploy qil».

---

## Self-Review of the revision

**Spec coverage after the revision.** The spec's §5.4 portal-verdict column is the one requirement this revision DROPS, and deliberately: upstream's `StateBars` draws it, so keeping ours would put two answers to one question on one screen. Everything else survives — §5.1 → Task 7; §5.2 → shipped in Task 3; §5.3 → shipped in Task 4; §5.4's time bands → Task 5; §5.5 → Task 6; §6 → Tasks 8 and 9; §7 → Task 10.

**What the spec now says that is no longer true**, and is corrected in Task 10's step 5 rather than left to rot: §3's «the period control» and §5.2's window language both assume a control the screen no longer has.

**Type consistency.** `CustomerStateRowDto` lost `ours`/`portal` and carries a single `customers`, because there is only one column now. `CustomerFlowDto` gained `window` and lost `grain`. `trailingWindow` is defined in Task 6 and used only there. `CustomerFlowChart` lost its `grain` prop in Task 8 and is called without one in Task 9.
