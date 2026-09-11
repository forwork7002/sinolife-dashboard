import { describe, expect, it } from 'vitest'

/*
  Same preamble as the other SQL-shape tests: the repository reads `env` at
  module scope for APP_TIMEZONE and `env` refuses to load without a complete
  configuration, deliberately, so a misconfigured deployment fails at boot
  rather than at midnight. A test about SQL shape has no database and no
  secrets, so it supplies the four required names first and imports afterwards.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

const reach = InsightsRepository as unknown as {
  queueSql: (mode: string, scopeParam: string) => string
  logisticsCohortSql: () => string
}

/** What the repository actually sends: the queue prelude plus the cuts. */
const SQL = `${reach.queueSql('window', '$3')}${reach.logisticsCohortSql()}`

/*
  Negative assertions run against the SQL with its prose stripped. The builder
  carries long comments explaining why each figure is what it is, and those
  comments name the very tokens the `not.toContain` checks forbid.
*/
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

const BARE = bare(SQL)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

/**
 * The logistics cohort: the client's own sheet, from one pass.
 *
 * This query answers a whole screen — six columns, a daily table, the post
 * offices, the regions, the eighteen-stage reconciliation and the refusal
 * reasons — out of one scan of the confirmation-queue cohort. Every assertion
 * below stands in for a wrong number that would otherwise render as a plausible
 * report, which is the failure mode this file exists for.
 */
describe('logisticsCohortSql', () => {
  it('builds on the confirmation queue, in the order the CTEs depend on', () => {
    const chain = [...BARE.matchAll(/(?:WITH|,)\s*([a-z_]+) AS/g)].map((m) => m[1])

    expect(chain).toEqual([
      // queueSql's prelude, unchanged — the cohort is SHARED with the
      // confirmation queue and the sellers board, never re-derived here.
      'signal_stage',
      'moves',
      'agg',
      'dated',
      'classified',
      'scoped',
      'numbered',
      'visible',
      // the delivery leg
      'routed',
      'delivered_at',
      'refused_at',
      'dispatched',
      'cohort',
      // the seven cuts
      'by_fakt',
      'by_bucket',
      'by_day',
      'by_post',
      'by_region',
      'by_stage',
      'by_wait',
    ])
  })

  /*
    MATERIALIZED is not decoration. Seven arms read `cohort`; inlined, the
    planner estimates the join badly and picks a sequential scan over the whole
    history table. queueSql's own signal_stage measured 1 881 ms against 206 ms
    for exactly this.
  */
  it('pins the row every cut reads', () => {
    expect(BARE).toContain('cohort AS MATERIALIZED (')
  })

  /*
    THE HISTORY SCAN IS BOUNDED ON THE LEFT ONLY.

    Closing it at $2 freezes an order's status at the window's edge — measured
    on the queue: «Kecha» showed 96 orders against a true 101. Every row in this
    cohort arrived at or after $1 and a hub stamp follows the arrival it belongs
    to, so the left bound is free and the right bound is a bug.
  */
  it('bounds the three delivery CTEs from the left and never from the right', () => {
    expect(count(BARE, 'h."enteredAt" >= $1')).toBe(5) // four here + moves
    expect(BARE).not.toContain('h."enteredAt" < $2')
    expect(BARE).not.toContain('h."enteredAt" <= $2')
  })

  /*
    count(k.deal_id), NEVER count(*). Two arms reach their rows through a LEFT
    JOIN from a stage list, so an empty column arrives as one all-null row and
    count(*) would count it — printing «Заказ в мой склад 1» over nothing.
  */
  it('counts the joined row and not the grouping', () => {
    expect(BARE).toContain('count(k.deal_id)::bigint AS orders')
    expect(BARE).not.toContain('count(*)::bigint AS orders')
  })

  /*
    The FAKT 1 filter rides the LEFT JOIN's ON clause on the two arms that
    start from a stage list. Moved to the WHERE it turns the outer join back
    into an inner one and deletes every empty post office — the same trap
    deliveryBoardSql.test.ts pins on the other board.
  */
  it('filters the stage-led arms on the join, not in the WHERE', () => {
    expect(count(BARE, 'LEFT JOIN cohort k ON k.post_stage_id = st."id" AND k.fakt1')).toBe(1)
    expect(count(BARE, 'LEFT JOIN cohort k ON k.stage_id = st."id" AND k.fakt1')).toBe(1)
    // bucket, day and region cut the cohort directly; by_wait adds its own
    // conditions to the same clause. Counted as a standalone clause, since
    // FILTER (WHERE k.fakt1) appears all over the aggregate list and means
    // something else entirely.
    expect(BARE.match(/^\s*WHERE k\.fakt1/gm) ?? []).toHaveLength(4)
  })

  it('reads FAKT 1 and FAKT 2 through the shared definitions', () => {
    // The same predicates ratingSql groups by, so this screen and the sellers
    // board cannot drift apart about what either fact means.
    expect(BARE).toContain(`c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`)
    expect(BARE).toContain(`k.role = 'DELIVERED'`)
  })

  /*
    `countsAsRevenue` IS NAMED, AND IT IS A TRIPWIRE RATHER THAN A FILTER.

    Every money query must name it or report ~30% too much. Filtering on it
    here would be wrong for a different reason: the cohort is chosen by an
    arrival in Тасдиклаш (#4), which is not a revenue pipeline, so a WHERE
    would drop every still-queued and every refused order.
  */
  it('counts the revenue flag instead of filtering on it', () => {
    expect(BARE).toContain('k.fakt1 AND NOT k.counts_as_revenue')
    expect(BARE).not.toMatch(/WHERE[^)]*counts_as_revenue\s*$/m)
    expect(BARE).not.toContain('WHERE d."countsAsRevenue"')
  })

  it('generates the six columns from the client-approved table, with a valve', () => {
    for (const role of [
      'PREPARING',
      'WAREHOUSE',
      'IN_TRANSIT',
      'REGIONAL_HUB',
      'CARRIER',
      'CHASING',
      'REFUSED',
      'CANCELLED_EARLY',
      'DELIVERED',
      'SETTLED',
    ]) {
      expect(BARE, role).toContain(`WHEN '${role}' THEN '`)
    }
    // A confirmed order moved out of Доставка is counted and reported, never
    // dropped out of a partition the screen says is exhaustive.
    expect(count(BARE, `ELSE 'OTHER'`)).toBe(2)
  })

  /*
    «Отказ» is one column on screen and two numbers underneath it, and the two
    are split by JOURNEY. Since June the portal writes every refusal to «Отказ
    предварительно», so reading the split off the stage name reports that
    nothing ever came back.
  */
  it('splits refusals by whether the parcel travelled', () => {
    expect(BARE).toContain(`k.bucket = 'REFUSED' AND k.dispatched`)
    expect(BARE).toContain(`k.bucket = 'REFUSED' AND NOT k.dispatched`)
    /*
      The split lives on every bucket now, not in a reasons arm. That arm
      grouped by `deal."refusalReason"`, a field this portal does not fill —
      830 refusals in sixty days and one reason — so it returned one row and
      the screen drew it as a chart.
    */
    expect(BARE).not.toContain('refusalReason')
    expect(BARE).not.toContain('by_reason')
  })

  /*
    THE WAIT BANDS, AND THE TWO FILTERS THAT MAKE THEM HONEST.

    Resolved orders only — a parcel still standing is undelivered by
    definition and would build the conclusion into the measurement. And
    wait_hours is null for a pass whose stamps were written together at
    closeout, which is 27.5% of passes and 97.2% delivered.
  */
  it('bands the wait over resolved orders only', () => {
    expect(BARE).toContain(`k.fakt1 AND k.wait_hours IS NOT NULL AND k.bucket IN ('REFUSED', 'DONE')`)
    expect(BARE).toContain('WHEN k.wait_hours <  48 THEN')
    expect(BARE).toContain('WHEN k.wait_hours <  96 THEN')
    expect(BARE).toContain('WHEN k.wait_hours < 168 THEN')
  })

  /*
    A pass under an hour carries no elapsed time — both its stamps were
    written when the parcel was closed out. Counting it as «instant» is how
    the gradient this screen reports would become an artefact of stamping.
  */
  it('throws away the retro-stamped passes', () => {
    expect(BARE).toContain(`r.post_left_at - r.post_entered_at > interval '1 hour'`)
  })

  /*
    A revival is decided against the LAST refusal. Against the first, a
    parcel delivered, bounced and then refused counts as a recovery — a loss
    reported as a win.
  */
  it('decides a revival against the last refusal', () => {
    expect(BARE).toContain('max(h."enteredAt") AS refused_at')
    expect(BARE).toContain('dv.last_delivered_at > rf.refused_at')
  })

  /*
    In-flight is tested on the BUCKET, not on the role. `role` is nullable, and
    `NULL NOT IN (…)` is NULL — an order on a stage with no logistics role
    would drop out of the count silently. `bucket` is never null.
  */
  it('measures in-flight on the column, which is never null', () => {
    expect(BARE).toContain(`k.bucket NOT IN ('REFUSED', 'DONE')`)
    expect(BARE).not.toContain(`k.role NOT IN (`)
  })

  it('keeps the funnel filter against the stage table', () => {
    expect(count(BARE, `st."externalId" LIKE 'C6:%'`)).toBe(2)
    expect(BARE).toContain('min(st."sortOrder")::int')
  })

  it('buckets the day in Tashkent, not in UTC', () => {
    expect(BARE).toContain(
      `(c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date::text AS day`,
    )
  })

  it('takes a true median per cut and no ninetieth percentile', () => {
    expect(count(BARE, 'percentile_cont(0.5) WITHIN GROUP (ORDER BY k.pace_days)')).toBe(7)
    expect(count(BARE, 'percentile_cont(0.5) WITHIN GROUP (ORDER BY k.wait_hours)')).toBe(7)
    expect(BARE).not.toContain('percentile_cont(0.9)')
  })

  /*
    The pace is measured from the queue arrival to the «Доставлено» stamp.
    closedAt is a DATE on this portal — every closed deal lands on UTC midnight
    — and the hub stamp's median against the delivered stamp is 0.0 hours,
    because the route is written down when the parcel is closed out.
  */
  it('measures delivery from the arrival, never from closedAt', () => {
    expect(BARE).toContain('EXTRACT(EPOCH FROM (dv.delivered_at - c.queued_at)) / 86400')
    expect(BARE).not.toContain('closedAt')
  })

  it('returns the grand total of every cut that has one', () => {
    expect(count(BARE, 'GROUPING SETS')).toBe(5)
    expect(BARE).toContain('GROUP BY GROUPING SETS ((k.bucket, COALESCE(k.role, \'NONE\')), (k.bucket), ())')
    expect(BARE).toContain('GROUP BY GROUPING SETS ((k.day, k.bucket), (k.day))')
  })

  it('unions the seven arms and orders them for the decoder', () => {
    expect(count(BARE, 'UNION ALL SELECT * FROM')).toBe(6)
    expect(BARE).toContain('ORDER BY cut, is_total, sort NULLS LAST, sub NULLS FIRST, orders DESC')
  })
})
