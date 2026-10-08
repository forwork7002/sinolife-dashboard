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

  it('groups day × team × the orders\' product — the brand is the product\'s (2026-10-06), decided in the domain', () => {
    expect(sql).toContain('FROM "deal_item" di JOIN "product" dp ON dp."id" = di."productId"')
    expect(sql).toContain('pb.brand AS product_brand')
    expect(sql).toMatch(/GROUP BY 1, 2, pb\.brand\s*$/)
  })

  it('buckets by the Tashkent queue day', () => {
    expect(sql).toMatch(/c\.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '[^']+'\)::date::text AS day/)
  })
})

describe('RnpRepository statements', () => {
  it('reads handed-out leads from every pipeline, as the portal filter does, and credits the team the ROP heads', () => {
    const sql = bare(RnpRepository.leadDaysSql())
    // The pipeline is joined only for the seller fallback; nothing filters on it.
    expect(sql.slice(sql.indexOf('WHERE d."leadDistributedOn"'))).not.toContain('"role"')
    expect(sql).toContain(`h."headId" = d."leadRopEmployeeId"`)
    expect(sql).toContain(`d."leadDistributedOn" BETWEEN $1::date AND $2::date`)
  })

  it('groups by day and team only — the «guruh» rows are teams now, not registrars (2026-10-02)', () => {
    const sql = bare(RnpRepository.leadDaysSql())
    expect(sql).not.toContain('"registrar"')
    expect(sql).toMatch(/GROUP BY 1, 2\s*$/)
  })

  it('counts only a fresh hand-out: a deal created at most 30 days before its «Лид таркатилган сана» (2026-10-02)', () => {
    const sql = bare(RnpRepository.leadDaysSql())
    // `createdAtSource`, never «Лид тушган сана» (`leadArrivedAt`), which is empty before 14.09.
    expect(sql).toContain(`AND d."createdAtSource" >= d."leadDistributedOn" - interval '30 days'`)
    expect(sql).not.toContain('"leadArrivedAt"')
  })

  it('files a person heading two ROP units under the one they sit in, then by name', () => {
    const sql = bare(RnpRepository.leadDaysSql())
    expect(sql).toContain(`ORDER BY (h."id" = e."departmentId") DESC, h."name"`)
    expect(sql).toContain(`LEFT JOIN "employee" e ON e."id" = d."leadRopEmployeeId"`)
  })

  it('reads leads and kval in one UNION of two arms, summed per day × source × form × «Проект»', () => {
    const sql = bare(RnpRepository.registrationDaysSql())
    expect(sql).toContain('UNION ALL')
    expect(sql).not.toContain('FULL JOIN')
    expect(sql).toMatch(/sum\(leads\)::bigint AS leads[\s\S]*sum\(qualified\)::bigint AS qualified[\s\S]*GROUP BY 1, 2, 3, 4\s*$/)
  })

  it('reads the window\'s deals once: the form aliases come from the rows the first arm counts', () => {
    const sql = bare(RnpRepository.registrationDaysSql())
    // `reg`, the closedAt arm and the one day before the window for the replay's running max — no pass for the aliases.
    expect(sql.match(/FROM "deal"/g)).toHaveLength(3)
    expect(sql).toMatch(/FROM "deal" pd[\s\S]*pd\."createdAtSource" >= [\s\S]* - interval '1 day' AND pd\."createdAtSource" < /)
    expect(sql).toContain('reg AS MATERIALIZED (')
    expect(sql).toContain(`FROM (SELECT r.sd, r.title FROM reg r WHERE r.role = 'LEAD') fd`)
  })

  it('leaves a late «Qayta zayavka» copy out of the leads and the duplicates, never out of the kval', () => {
    // 05.10.2026 18:00–20:00: 1 071 deals for form acts filled days earlier, measured on the portal.
    const sql = bare(RnpRepository.registrationDaysSql())
    expect(sql).toContain(`substring(d."metadata"->'utm'->>'SOURCE_DESCRIPTION' from '^Qayta zayavka \\(forma akt #([0-9]+)\\)')::bigint AS act`)
    expect(sql).toMatch(/max\(q0\.act\) OVER \(ORDER BY q0\.created, q0\.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING\)/)
    expect(sql).toContain(`(SELECT r.id, r.created, r.act FROM reg r WHERE r.role = 'LEAD') q0`)
    expect(sql).toContain('WHERE q0.act IS NOT NULL')
    expect(sql).toMatch(/WHERE q\.act < GREATEST\(q\.before, \(/)
    expect(sql).toContain(`count(*) FILTER (WHERE r.role = 'LEAD' AND rp.id IS NULL AND NOT COALESCE(r.stage, '')`)
    expect(sql).toContain(`count(*) FILTER (WHERE r.role = 'LEAD' AND rp.id IS NULL AND COALESCE(r.stage, '')`)
    expect(sql).toContain('LEFT JOIN replayed rp ON rp.id = r.id')
    // The kval arm reads "deal" directly and knows nothing of the replay.
    expect(sql.slice(sql.indexOf('UNION ALL'))).not.toContain('replayed')
  })

  it('spells the duplicate stage\'s case out rather than trusting the locale', () => {
    const sql = bare(RnpRepository.registrationDaysSql())
    expect(sql).toContain(`NOT COALESCE(r.stage, '') ~ '[Дд]убл[^(]*\\([[:space:]]*[Лл]ид'`)
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

  it('takes an open stay only where the deal still stands — never one whose leaving was not synced (2026-10-02)', () => {
    const [first, second] = bare(RnpRepository.packingStaysSql()).split('UNION')
    expect(first).toMatch(/AND h\."leftAt" >= \(\(\$1::date\)/)
    expect(first).not.toContain('IS NULL')
    expect(second).toContain(`h."leftAt" IS NULL`)
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
        calls.push(sql.includes('arms AS (') ? 'query' : sql)
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

/*
  A month's lead values are its own rows, else each team's last value in force
  (`inheritedLeadValues`). The БАЗА teams carry their own since 2026-10-02
  (migration 20261002120100): what a later month inherits is pinned here.
*/
describe('plans — the lead values a month inherits', () => {
  type Row = { month: string; team: string; metric: string; fromDay: number; valueCenti: bigint }
  const september: Row[] = [
    { month: '2026-09', team: '', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
    { month: '2026-09', team: '', metric: 'lead_value', fromDay: 14, valueCenti: 50_000_000n },
    { month: '2026-09', team: 'Charos', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
    { month: '2026-09', team: 'Baza', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
    { month: '2026-09', team: 'Baza', metric: 'lead_value', fromDay: 27, valueCenti: 20_000_000n },
    { month: '2026-09', team: 'Sevinch', metric: 'leads', fromDay: 1, valueCenti: 180_900n },
  ]
  const october: Row[] = [
    { month: '2026-10', team: 'Charos', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
    { month: '2026-10', team: 'Baza', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
  ]
  function fake(rows: readonly Row[]) {
    const iso = (d: Date) => d.toISOString().slice(0, 7)
    const pick = (r: Row) => ({ team: r.team, metric: r.metric, fromDay: r.fromDay, valueCenti: r.valueCenti })
    return {
      rnpPlan: {
        findMany: async ({ where }: { where: { month: Date | { lt: Date }; metric?: string } }) => {
          if (where.month instanceof Date) return rows.filter((r) => r.month === iso(where.month as Date)).map(pick)
          const before = iso(where.month.lt)
          return rows
            .filter((r) => r.month < before && r.metric === where.metric)
            .sort((a, b) => b.month.localeCompare(a.month) || b.fromDay - a.fromDay)
            .map(pick)
        },
      },
      teamMonthPlan: { findMany: async () => [] },
    }
  }
  const values = async (rows: readonly Row[], month: string) =>
    (await new RnpRepository(fake(rows) as never).plans(month)).rows
      .filter((r) => r.metric === 'lead_value')
      .map((r) => `${r.team || '—'} d${r.fromDay} ${Number(r.valueCenti) / 100}`)
      .sort()

  it("keeps October's own БАЗА values and inherits the company's last one", async () => {
    expect(await values([...september, ...october], '2026-10')).toEqual(['Baza d1 400000', 'Charos d1 400000', '— d1 500000'])
  })

  it('carries every team\'s last value into a month with none of its own', async () => {
    expect(await values([...september, ...october], '2026-11')).toEqual(['Baza d1 400000', 'Charos d1 400000', '— d1 500000'])
  })

  it("would hand October Фаррух's 200 000 of 27.09 had October no rows of its own — why the migration writes them", async () => {
    expect(await values(september, '2026-10')).toContain('Baza d1 200000')
  })
})
