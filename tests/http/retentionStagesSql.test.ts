import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RETENTION_GROUPS, UNMAPPED_RETENTION_GROUP } from '@/lib/retentionGroups'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/** The private builder the statement interpolates. Same cast as logisticsSql. */
const reach = InsightsRepository as unknown as {
  retentionGroupCaseSql: (column: string) => string
}

/**
 * WHAT THE БАЗА STATEMENT PROMISES: three levels, each counted DISTINCT.
 *
 * The card draws four bars and prints a base under them. Every level of that
 * has to be its own `count(DISTINCT customerId)`, because a customer is in a
 * group once however many of its stages they stand on, and in the base once
 * however many groups they are in. Summing the level below is the error this
 * shape exists to prevent and the one that already happened here once — it
 * produced a «base» of 1 660 more people than the customer list had.
 *
 * Proved against Postgres on 2026-09-15 over a fabricated funnel carrying the
 * exact trap (one customer on two stages in two groups, another on two stages
 * inside one): group counts came back 1, and the base 4 rather than 6. These
 * tests pin the statement that behaviour depends on, so the next edit cannot
 * quietly turn a grouping set into a sum.
 */

const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

/** The template literal `retentionStages()` hands to `$queryRawUnsafe`. */
function retentionSql(): string {
  const at = SOURCE.indexOf('async retentionStages(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

/** The statement with every comment stripped, so prose cannot satisfy a test. */
function code(): string {
  return retentionSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the База statement', () => {
  it('asks for all three levels in ONE walk of the funnel', () => {
    /*
      Stage, group and whole-funnel. Three statements would be three walks of
      a pipeline holding every retention deal on the portal, on the one vCPU
      that answers every other screen.
    */
    expect(code()).toMatch(/GROUP BY GROUPING SETS \(\(grp, stage\), \(grp\), \(\)\)/i)
  })

  it('counts customers DISTINCT at every level, never summing the one below', () => {
    const sql = code()
    expect(sql).toMatch(/count\(DISTINCT customer_id\)::bigint AS customers/i)
    expect(sql).toMatch(
      /count\(DISTINCT customer_id\) FILTER \(WHERE status = 'OPEN'\)::bigint AS open_customers/i,
    )
    // GROUPING() is what tells the three levels apart in the result set; without
    // it a group row and a stage row are indistinguishable and one gets folded
    // into the other.
    expect(sql).toMatch(/GROUPING\(stage\)::int AS g_stage/i)
    expect(sql).toMatch(/GROUPING\(grp\)::int AS g_grp/i)
  })

  it('reads the RETENTION pipeline, and only it', () => {
    expect(code()).toMatch(/WHERE p\."role" = 'RETENTION' AND d\."customerId" IS NOT NULL/i)
  })

  it('builds its CASE from the one table that defines the partition', () => {
    /*
      `src/lib/retentionGroups.ts` is read by the screen for its labels and by
      this statement for its arms — the same doctrine as `logisticsBuckets`.
      A hand-written CASE here would be a second definition of a partition the
      card presents as exhaustive, so the statement INTERPOLATES the builder
      and the builder reads the table.
    */
    expect(code()).toContain('retentionGroupCaseSql(')

    const arms = reach.retentionGroupCaseSql('s."externalId"')
    for (const group of RETENTION_GROUPS) {
      for (const id of group.stages) expect(arms).toContain(`'${id}'`)
      expect(arms).toContain(`THEN '${group.key}'`)
    }
    // And a stage nobody filed still lands somewhere drawable.
    expect(arms).toContain(`ELSE '${UNMAPPED_RETENTION_GROUP}'`)
  })

  it('keys the CASE on the stage id, never on its name', () => {
    /* Stage names are edited from the portal's UI and are stored prefixed with
       their funnel; ids are facts. A CASE on `s."name"` would refile a whole
       group the day somebody fixes a typo in Bitrix24. */
    expect(code()).toContain('retentionGroupCaseSql(\'s."externalId"\')')
    expect(code()).not.toContain('retentionGroupCaseSql(\'s."name"\')')
  })

  it('leaves «Дубль заказы» out of the base entirely', () => {
    /* Duplicate orders are not customers of the base: filtered in `labelled`,
       so no bar, no group and no base count ever sees them. */
    expect(code()).toContain('AND s."externalId" NOT IN (${InsightsRepository.excludedRetentionStagesSql()})')
    const list = (InsightsRepository as unknown as { excludedRetentionStagesSql: () => string })
      .excludedRetentionStagesSql()
    expect(list).toBe("'C10:UC_085NVA'")
  })

})
