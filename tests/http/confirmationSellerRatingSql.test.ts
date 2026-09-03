import { describe, expect, it } from 'vitest'

/*
  Same reason `confirmationQueueSql.test.ts` supplies these first: `env` is
  read at module scope for APP_TIMEZONE and refuses to load without a
  complete configuration. A unit test about SQL shape has no database.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * Sotuvchilar reytingi, rebuilt on the confirmation queue — FAKT 1 / FAKT 2
 * as the floor names them, not as a screenshot of their site's formulas.
 *
 * FAKT 1 IS Тасдиқланди, NOT «Успешно заказ». The latter (C6:UC_YUKVF1) was
 * the client's own first answer and was rejected after measurement:
 * `mapping.ts` documents it as a settlement stamp automation writes within
 * five seconds of Доставлено in most cases, not an operator's act. Using it
 * would have collapsed FAKT 1 into FAKT 2 — these tests are what keeps that
 * regression out.
 *
 * SAME COHORT AS THE QUEUE BOARD (`classified`, dated by `queued_at`), so an
 * operator's rating and the «barcha buyurtmalar» table it is drawn from can
 * never disagree about which orders are even in it.
 */
const ratingSql = (
  InsightsRepository as unknown as { ratingSql: (filterClause: string) => string }
).ratingSql

const ratingFilterSql = (
  InsightsRepository as unknown as {
    ratingFilterSql: (
      filters: {
        employeeIds?: readonly string[]
        departmentIds?: readonly string[]
        sourceIds?: readonly string[]
        restrictToEmployeeId?: string
      },
      params: unknown[],
    ) => string
  }
).ratingFilterSql

const SQL = ratingSql('')
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const BARE_SQL = bare(SQL)

describe('confirmation seller rating SQL', () => {
  it('runs over classified, not numbered', () => {
    // `numbered` adds a window function over the whole cohort for a number
    // nobody reading a per-operator total needs — see queueSql's own cost
    // note, which this rating follows rather than repeats.
    expect(BARE_SQL).toContain('FROM classified c')
    expect(BARE_SQL).not.toContain('FROM numbered')
  })

  it('grades FAKT 1 on Тасдиқланди, not on «Успешно заказ»', () => {
    expect(BARE_SQL).toContain("WHERE c.outcome = 'CONFIRMED'")
    expect(BARE_SQL).not.toContain('UC_YUKVF1')
    expect(BARE_SQL).not.toContain('SETTLED')
  })

  it('grades FAKT 2 on delivery, C6:WON via deal.status', () => {
    expect(BARE_SQL).toContain(`WHERE d."status" = 'WON'`)
  })

  it('reports orders confirmed but not yet delivered as their own bucket', () => {
    expect(BARE_SQL).toContain(`WHERE c.outcome = 'CONFIRMED' AND d."status" <> 'WON'`)
  })

  it('shows refused orders without folding them into FAKT 1', () => {
    expect(BARE_SQL).toContain("WHERE c.outcome = 'REJECTED'")
  })

  it('does not name countsAsRevenue', () => {
    /*
      Every other money query in this file names it explicitly — this is the
      one documented exception. Every deal in `classified` arrived via a
      confirmation-signal stage in pipeline 4, 6 or 12, never via «#10 База»
      (which never touches a signal stage), so the flag cannot change the
      total; it CAN wrongly drop every still-queued and refused row, since
      pipelines 4 and 12 are not revenue pipelines.
    */
    expect(BARE_SQL).not.toContain('countsAsRevenue')
  })

  it('groups by operator and by their ROP', () => {
    expect(BARE_SQL).toContain('GROUP BY e."id", e."fullName", c.rop')
  })

  it('keeps an operator whose only money was delivered without a confirmation', () => {
    /*
      FAKT 2 spans the whole cohort — "har bir buyurtma" is the client's own
      wording — so a book of Тасдиқланмай чиқди orders that the carrier
      delivered must stay on the board. A confirmed-only HAVING erased it.
      Books that are all pending or all refused stay off: work done ranks.
    */
    const having = BARE_SQL.slice(BARE_SQL.indexOf('HAVING'))
    expect(having).toContain("count(*) FILTER (WHERE c.outcome = 'CONFIRMED') > 0")
    expect(having).toContain(`OR count(*) FILTER (WHERE d."status" = 'WON') > 0`)
  })

  it('joins the operator by the deal\'s employeeId, not by a stage-history actor', () => {
    expect(BARE_SQL).toContain(`JOIN "employee" e ON e."id" = d."employeeId"`)
  })

  it('balances its parentheses', () => {
    expect((SQL.match(/\(/g) ?? []).length).toBe((SQL.match(/\)/g) ?? []).length)
  })
})

describe('confirmation seller rating filters', () => {
  it('adds nothing when no filter is set', () => {
    const params: unknown[] = ['start', 'end']
    expect(ratingFilterSql({}, params)).toBe('')
    expect(params).toEqual(['start', 'end'])
  })

  it('binds restrictToEmployeeId at the next free position', () => {
    const params: unknown[] = ['start', 'end']
    const clause = ratingFilterSql({ restrictToEmployeeId: 'emp-1' }, params)
    expect(clause).toContain('e."id" = $3')
    expect(params).toEqual(['start', 'end', 'emp-1'])
  })

  it('combines every filter, each at its own position, in one AND chain', () => {
    const params: unknown[] = ['start', 'end']
    const clause = ratingFilterSql(
      {
        restrictToEmployeeId: 'emp-1',
        employeeIds: ['emp-2', 'emp-3'],
        departmentIds: ['dep-1'],
        sourceIds: ['src-1'],
      },
      params,
    )
    expect(clause).toContain('e."id" = $3')
    expect(clause).toContain('e."id" = ANY(string_to_array($4')
    expect(clause).toContain('e."departmentId" = ANY(string_to_array($5')
    expect(clause).toContain('d."sourceId" = ANY(string_to_array($6')
    expect(params).toEqual(['start', 'end', 'emp-1', 'emp-2,emp-3', 'dep-1', 'src-1'])
  })
})
