import { describe, expect, it } from 'vitest'

/*
  Same preamble as the other SQL-shape tests: the repositories read `env` at
  module scope, and `env` refuses to load without a complete configuration.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')
const { RnpRepository } = await import('@/server/repositories/rnpRepository')

/** Comments name the very tokens some assertions forbid. */
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

/*
  The statements behind «RNP jadvali». Each was run against a local
  PostgreSQL with a portal-shaped fixture on 2026-09-28 and matched the
  figures worked out by hand; these pin the choices that fixture proved.
*/
describe('rnpTeamDaysSql', () => {
  const sql = bare(InsightsRepository.rnpTeamDaysSql())

  it('names the team off the deal first, as Logistika does, with the department as the fallback', () => {
    expect(sql).toMatch(/COALESCE\([\s\S]*"operatorTeamSource"[\s\S]*c\.rop,\s*'\(ROP yoʻq\)'\)/)
  })

  it('counts FAKT 1 and FAKT 2 with the board\'s own predicates', () => {
    expect(sql).toContain(`c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`)
    expect(sql).toContain(`ds."logisticsRole"`)
    expect(sql).toContain(`= 'REFUSED'`)
  })

  it('buckets by the Tashkent queue day', () => {
    expect(sql).toMatch(/c\.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '[^']+'\)::date::text AS day/)
  })
})

describe('RnpRepository statements', () => {
  it('reads handed-out leads from Первичный отдел / Тасдиклаш / Доставка and credits the team the ROP heads', () => {
    const sql = bare(RnpRepository.leadDaysSql())
    expect(sql).toContain(`p."externalId" = ANY($3::text[])`)
    expect(sql).toContain(`h."headId" = d."leadRopEmployeeId"`)
    expect(sql).toContain(`d."leadDistributedOn" BETWEEN $1::date AND $2::date`)
  })

  it('spells the duplicate stage\'s case out rather than trusting the locale', () => {
    const sql = bare(RnpRepository.registrationDaysSql())
    expect(sql).toContain(`!~ '[Дд]убл'`)
    expect(sql).not.toContain('~*')
    expect(sql).toMatch(/d\."status" = 'WON' AND d\."closedAt"/)
  })

  it('counts connected customer calls only — never a callback leg', () => {
    const sql = bare(RnpRepository.callDaysSql())
    expect(sql).toContain(`c."connected"`)
    expect(sql).toContain(`c."direction" IN ('INBOUND', 'OUTBOUND')`)
  })

  it('reads «не собран» from the WAREHOUSE role at each day\'s end, capped at now', () => {
    const sql = bare(RnpRepository.warehouseDaysSql())
    expect(sql).toContain(`s."logisticsRole" = 'WAREHOUSE'`)
    expect(sql).toContain(`LEAST((g::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC', $4::timestamp)`)
    expect(sql).toContain(`p."externalId" = '6'`)
  })
})

/*
  The columns are `timestamp(3)` holding UTC. A bound left as a timestamptz
  makes Postgres cast the column through the SESSION's TimeZone, which is
  Asia/Tashkent on the local cluster and unmeasured in production: an order
  that left the warehouse at 02:00 on the 22nd (Tashkent) could drop out of
  the 21st's «не собран» under one setting and not the other. Measured on 2026-09-28 by running the
  same fixture under both settings.
*/
describe('RnpRepository bounds', () => {
  it.each([
    ['registrationDaysSql', RnpRepository.registrationDaysSql()],
    ['callDaysSql', RnpRepository.callDaysSql()],
    ['warehouseDaysSql', RnpRepository.warehouseDaysSql()],
  ])('%s turns every Tashkent midnight back into naive UTC', (_, raw) => {
    const sql = bare(raw)
    const local = sql.match(/::timestamp AT TIME ZONE \$3(?! AT TIME ZONE 'UTC')/g)
    expect(local).toBeNull()
    // A bound parameter read as timestamptz is read in the session's zone too.
    expect(sql).not.toMatch(/\$\d+::timestamptz/)
  })
})
