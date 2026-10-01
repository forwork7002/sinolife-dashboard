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

  it('groups day × team only — the brand is the team\'s, decided in the domain as the sheet does', () => {
    expect(sql).not.toContain('"deal_item"')
    expect(sql).toMatch(/GROUP BY 1, 2\s*$/)
  })

  it('buckets by the Tashkent queue day', () => {
    expect(sql).toMatch(/c\.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '[^']+'\)::date::text AS day/)
  })
})

describe('RnpRepository statements', () => {
  it('reads handed-out leads from every pipeline, as the portal filter does, and credits the team the ROP heads', () => {
    const sql = bare(RnpRepository.leadDaysSql())
    expect(sql).not.toContain('"pipeline"')
    expect(sql).toContain(`h."headId" = d."leadRopEmployeeId"`)
    expect(sql).toContain(`d."leadDistributedOn" BETWEEN $1::date AND $2::date`)
  })

  it('reads leads and kval in one UNION of two arms, summed per day × source × form', () => {
    const sql = bare(RnpRepository.registrationDaysSql())
    expect(sql).toContain('UNION ALL')
    expect(sql).not.toContain('FULL JOIN')
    expect(sql).toMatch(/sum\(leads\)::bigint AS leads[\s\S]*sum\(qualified\)::bigint AS qualified[\s\S]*GROUP BY 1, 2, 3\s*$/)
  })

  it('spells the duplicate stage\'s case out rather than trusting the locale', () => {
    const sql = bare(RnpRepository.registrationDaysSql())
    expect(sql).toContain(`!~ '[Дд]убл'`)
    expect(sql).not.toContain('~*')
    expect(sql).toMatch(/d\."status" = 'WON' AND d\."closedAt"/)
  })

  it('counts a registrar\'s kval at «Сделка успешна», by the day it closed', () => {
    const sql = bare(RnpRepository.registrarKvalDaysSql())
    expect(sql).toContain(`p."role" = 'LEAD'`)
    expect(sql).toContain(`d."status" = 'WON'`)
    expect(sql).toContain(`d."registrar"`)
  })

  it('counts connected customer calls only — never a callback leg', () => {
    const sql = bare(RnpRepository.callDaysSql())
    expect(sql).toContain(`c."connected"`)
    expect(sql).toContain(`c."direction" IN ('INBOUND', 'OUTBOUND')`)
  })

  it('dates an order by its FIRST Доставка row, probing each one rather than grouping the history', () => {
    const sql = bare(RnpRepository.enteredDaysSql())
    expect(sql).toContain(`p."externalId" = '6'`)
    expect(sql).toMatch(/NOT EXISTS \([\s\S]*h0\."dealId" = h\."dealId" AND h0\."enteredAt" < h\."enteredAt"/)
    expect(sql).not.toMatch(/GROUP BY h\."dealId"/)
  })

  it('reads packing stays by stage id, and keeps a stay still open however old', () => {
    const sql = bare(RnpRepository.packingStaysSql())
    expect(sql).toContain(`s."externalId" = ANY($4::text[])`)
    expect(sql).toContain(`h."stageId" = d."stageId" AND h."leftAt" IS NULL`)
  })
})

/*
  The columns are `timestamp(3)` holding UTC. A bound left as a timestamptz
  makes Postgres cast the column through the SESSION's TimeZone, which is
  Asia/Tashkent on the local cluster and unmeasured in production: an order
  that left the warehouse at 02:00 on the 22nd (Tashkent) could drop out of
  the 21st's «не собран» under one setting and not the other. Measured on
  2026-09-28 by running the same fixture under both settings.
*/
describe('RnpRepository bounds', () => {
  it.each([
    ['registrationDaysSql', RnpRepository.registrationDaysSql()],
    ['callDaysSql', RnpRepository.callDaysSql()],
    ['enteredDaysSql', RnpRepository.enteredDaysSql()],
    ['packingStaysSql', RnpRepository.packingStaysSql()],
    ['registrarKvalDaysSql', RnpRepository.registrarKvalDaysSql()],
  ])('%s turns every Tashkent midnight back into naive UTC', (_, raw) => {
    const sql = bare(raw)
    const local = sql.match(/::timestamp AT TIME ZONE \$3(?! AT TIME ZONE 'UTC')/g)
    expect(local).toBeNull()
    // A bound parameter read as timestamptz is read in the session's zone too.
    expect(sql).not.toMatch(/\$\d+::timestamptz/)
  })
})

describe('registrationDays — the history scan gets its own statement timeout', () => {
  const row = { day: '2026-09-02', source_id: 'CALL', form_title: null, leads: 3n, duplicates: 0n, qualified: 1n, ai: 0n }
  function fakePrisma() {
    const calls: string[] = []
    const client = {
      $queryRawUnsafe: async (sql: string) => {
        calls.push(sql.includes('WITH arms') ? 'query' : sql)
        return [row]
      },
      $executeRawUnsafe: async (sql: string) => {
        calls.push(sql)
        return 0
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>, options: { timeout: number }) => {
        calls.push(`tx:${options.timeout}`)
        return fn(client)
      },
    }
    return { client, calls }
  }

  it('reads plainly when no timeout is asked for', async () => {
    const { client, calls } = fakePrisma()
    const repo = new RnpRepository(client as never)
    const rows = await repo.registrationDays('2026-09-01', '2026-09-29')
    expect(calls).toEqual(['query'])
    expect(rows[0]).toMatchObject({ day: '2026-09-02', leads: 3, qualified: 1 })
  })

  it('lifts the limit inside its own transaction, before the query', async () => {
    const { client, calls } = fakePrisma()
    const repo = new RnpRepository(client as never)
    const rows = await repo.registrationDays('2026-09-01', '2026-09-29', 60_000)
    expect(calls).toEqual(['tx:65000', 'SET LOCAL statement_timeout = 60000', 'query'])
    expect(rows).toHaveLength(1)
  })
})
