import { describe, expect, it } from 'vitest'

/*
  The repository reads `env` at module scope for APP_TIMEZONE, and `env`
  refuses to load without a complete configuration — deliberately, so a
  misconfigured deployment fails at boot rather than at midnight. A unit test
  about SQL shape has no database and no secrets, so it supplies the four
  required names first and imports afterwards.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * The Тасдиклаш board answers two questions from one definition.
 *
 * `window` is the client's own board — what came in during the period, dated
 * by the order's own Дата создания. `backlog` is what is waiting right now,
 * whenever it arrived, because a queue dated by intake cannot answer that: the
 * oldest unworked order on this portal predates every preset, so the tile and
 * the header bell both read zero while hundreds sat unworked.
 *
 * Everything BELOW the cohort — the latest signal, the UNCONFIRMED_SHIPPED
 * refinement, the ROP name, the Tashkent daily number — is shared, and these
 * tests exist to keep it that way: two hand-maintained copies of this SQL
 * would drift, and the drift would show up as two screens disagreeing about
 * the same order.
 */
const queueSql = (
  InsightsRepository as unknown as { queueSql: (mode: 'window' | 'backlog') => string }
).queueSql

const WINDOW = queueSql('window')
const BACKLOG = queueSql('backlog')

describe('confirmation queue SQL', () => {
  it('builds the same CTE chain in both modes', () => {
    const chain = (sql: string) =>
      [...sql.matchAll(/(\w+) AS(?: MATERIALIZED)? \(/g)].map((m) => m[1])

    expect(chain(WINDOW)).toEqual(['signal_stage', 'moves', 'agg', 'dated', 'classified', 'numbered'])
    expect(chain(BACKLOG)).toEqual(chain(WINDOW))
  })

  it('binds both date parameters in both modes', () => {
    // The readings that build on this pass $1 and $2 positionally; a mode that
    // stopped referencing one would make every one of them a bind-count error.
    for (const sql of [WINDOW, BACKLOG]) {
      expect(sql).toContain('$1')
      expect(sql).toContain('$2')
    }
  })

  it('balances its parentheses in both modes', () => {
    for (const sql of [WINDOW, BACKLOG]) {
      expect((sql.match(/\(/g) ?? []).length).toBe((sql.match(/\)/g) ?? []).length)
    }
  })

  it('selects the window cohort by the order’s own date', () => {
    expect(WINDOW).toContain('d."createdAtSource" >= $1')
    expect(WINDOW).not.toContain("a.signal = 'CONFIRM_NEW'")
    // Nothing narrows the history scan: the window already bounds it.
    expect(WINDOW).not.toContain('d0."status"')
  })

  it('selects the backlog cohort by state, and narrows the scan to live orders', () => {
    expect(BACKLOG).toContain("a.signal = 'CONFIRM_NEW'")
    // Without a window there is no cheap bound on the history scan, so the
    // join to open deals is what keeps the bell affordable to poll.
    expect(BACKLOG).toContain(`d0."status" = 'OPEN'`)
  })

  it('classifies an order identically in both modes', () => {
    // The refinement that turns a CONFIRMED signal into UNCONFIRMED_SHIPPED,
    // and the ROP derivation, must not depend on which question is asked.
    const shared = [
      `WHEN w.signal = 'CONFIRMED' AND d."confirmStatus" = 'UNREACHABLE'`,
      `THEN 'UNCONFIRMED_SHIPPED'`,
      `dep."name" ILIKE '%(ROP)%'`,
      'row_number() OVER (',
    ]
    for (const fragment of shared) {
      expect(WINDOW).toContain(fragment)
      expect(BACKLOG).toContain(fragment)
    }
  })
})
