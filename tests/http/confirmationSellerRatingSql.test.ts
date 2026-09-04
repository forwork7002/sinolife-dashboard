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

  it('grades FAKT 2 on a DELIVERY stage, never on a bare WON status', () => {
    /*
      The client's rule is «moved to Завершить сделку» — the Доставка kanban's
      end drop-zone, which lands a deal in C6:WON «Доставлено». A WON STATUS is
      not that: nine stages across nine pipelines carry category WON, and two
      of them hold real deals that never met a courier — «База · Успешно»
      (C10:WON, the retention kanban) and «Регистрация · Сделка успешна», the
      automation stamp that HANDS a lead to Тасдиқлаш. Measured over this
      cohort all-time: 41 База rows worth 56 900 000 soʻm plus 33 Регистрация
      rows that inflate the delivered COUNT and so the conversion rate.
    */
    expect(BARE_SQL).toContain(`WHERE ds."logisticsRole" = 'DELIVERED'`)
    expect(BARE_SQL).not.toContain(`FILTER (WHERE d."status" = 'WON')`)
    expect(BARE_SQL).toContain(`LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"`)
  })

  it('keeps a dead order out of «yoʻlda»', () => {
    /*
      In-transit used to mean "confirmed and not won", which files an order the
      seller confirmed and then LOST as live work they are still carrying. In
      July that was 102 orders and 176 230 000 soʻm — a fifth of the money the
      screen labelled in-transit. The two are separate measures now.
    */
    expect(BARE_SQL).toContain(`AND d."status" = 'OPEN'`)
    expect(BARE_SQL).toContain('lost_after_confirm_orders')
    expect(BARE_SQL).not.toContain(`d."status" <> 'WON'`)
  })

  it('carries the operator\'s whole cohort, not only the confirmed part', () => {
    /*
      «barcha buyurtmalar» is the client's own name for the population. Without
      this column the queue page says 3 228 for August and this board says
      2 874, with nothing on either explaining that the second counts only the
      confirmed ones.
    */
    expect(BARE_SQL).toContain('count(*)::bigint AS cohort_orders')
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

  it('keeps every operator that appears in «barcha buyurtmalar»', () => {
    /*
      The client's model: the ОПЕРАТОР on a «barcha buyurtmalar» row IS the
      seller. So a seller whose whole July was refusals — seven operators and
      29 orders that month, four of them in real (ROP) teams — belongs on the
      board with FAKT 1 and FAKT 2 at zero, and their 28 refusals belong in the
      conversion rate's denominator, which they were silently missing from.

      This is a deliberate departure from the client's PUBLISHED page, which
      drops rows with no FAKT 2. Their stated model wins over their old HTML.
    */
    const having = BARE_SQL.slice(BARE_SQL.indexOf('HAVING'))
    expect(having).toContain('HAVING count(*) > 0')
  })

  it('credits the operator who SOLD it, falling back to the assignee', () => {
    /*
      The client's model: the ОПЕРАТОР on a «barcha buyurtmalar» row IS the
      seller. `ASSIGNED_BY_ID` is not that person — this portal moves deals to
      back office during processing, and in July 2026 that put 556 orders on
      the head of Операцион and made him the board's number one, at 4.2x the
      client's own leader. Twelve of twelve sampled deals named a different,
      real seller in the portal's own snapshot field.

      COALESCE and not a bare join: the snapshot was added in May 2026, so the
      July cohort is 20% empty and August 10%. A deal without it keeps the
      assignee rather than dropping off the board.

      Still not a stage-history actor — that column does not exist.
    */
    expect(BARE_SQL).toContain(
      `JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")`,
    )
    expect(BARE_SQL).not.toContain(`e."id" = d."employeeId"`)
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
