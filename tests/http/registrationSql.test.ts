import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RegistrationRepository } = await import('@/server/repositories/registrationRepository')
const { RnpRepository } = await import('@/server/repositories/rnpRepository')

const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

/*
  «Registratsiya»'s one statement. Run against a local PostgreSQL copy with a
  week of synthetic handed-out leads on 2026-10-01: three deals of one contact
  on one day gave 2 duplicates, and the per-team counts matched the seed.
*/
describe('distributedDaysSql', () => {
  const sql = bare(RegistrationRepository.distributedDaysSql())

  it('reads the day a lead was handed out, inclusive bounds', () => {
    expect(sql).toContain(`d."leadDistributedOn" BETWEEN $1::date AND $2::date`)
  })

  it('leaves out the Регистрация copy of a handed-out lead, but not a deal that names a ROP', () => {
    expect(sql).toContain(`(p."role" IS DISTINCT FROM 'LEAD' OR d."leadRopEmployeeId" IS NOT NULL)`)
  })

  it('reads the ROP from «РОП (Первичка)» alone — the head, then the unit they sit in (back to it 2026-10-13)', () => {
    const team = sql.slice(sql.indexOf('COALESCE('), sql.indexOf(') AS rop'))
    expect(team.indexOf('h."headId" = d."leadRopEmployeeId"')).toBeGreaterThan(-1)
    expect(team).toContain('dep."name"')
    // Neither «ROP KVAL LID» nor the seller's team: the first counted the desk's copy twice (13.10).
    expect(sql).not.toContain('ropKvalLidEmployeeId')
    expect(sql).not.toContain('a."departmentId"')
  })

  it('names the ROP exactly as «RNP jadvali» does', () => {
    const team = (s: string) => s.slice(s.indexOf('COALESCE('), s.indexOf(') AS rop') + ') AS rop'.length).replace(/\s+/g, ' ')
    expect(team(sql)).toBe(team(bare(RnpRepository.leadDaysSql())))
  })

  it('marks every deal after a contact\'s first that day as a duplicate', () => {
    expect(sql).toMatch(/PARTITION BY d\."leadDistributedOn", COALESCE\(d\."customerId", d\."id"\)/)
    expect(sql).toContain(`count(*) FILTER (WHERE nth > 1)`)
  })
})

/*
  «Безквал» by the client's spec, 2026-10-22. Run against PGlite with every
  migration applied and fifteen synthetic deals of 21.10: a client's two
  Регистрация deals naming two ROPs (one «Дубликат (лид)»), a contact with two
  numbers and a Первичный отдел deal (now in Доставка) of a contact holding
  one of them, a number-less contact with the deal's own «Телефон ракам», its
  second deal, a deal with only the portal's contact id, one with nothing, a
  Lead Guard deal created after midnight that arrived at 23:00, another that
  arrived the evening before, an «ИИ обработка» deal moved into Регистрация,
  one still there, a Доставка-born deal, an HR deal and a junk number —
  11 leads, 8 clients, the ROPs and the history as worked out by hand.
*/
describe('bezkvalLeadsSql', () => {
  const sql = bare(RegistrationRepository.bezkvalLeadsSql())
  const detail = bare(RegistrationRepository.bezkvalLeadsSql(true))

  it('reads a window of Tashkent days by the lead\'s instant, end-exclusive', () => {
    expect(sql).toContain(`x.at >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`)
    expect(sql).toContain(`x.at < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`)
    expect(sql).toContain(`(x.at AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day`)
    expect(sql).toContain(`extract(hour FROM (x.at AT TIME ZONE 'UTC' AT TIME ZONE $3))::int AS hour`)
  })

  it('dates a Lead Guard deal by «Лид тушган сана», found through either index', () => {
    expect(sql).toContain(`COALESCE(d."leadVia" ILIKE '%lead guard%' AND d."leadArrivedAt" IS NOT NULL, false) AS lead_guard`)
    expect(sql).toContain(`CASE WHEN g.lead_guard THEN d."leadArrivedAt" ELSE d."createdAtSource" END AS at`)
    expect(sql).toMatch(/\(d\."createdAtSource" >= .+ AND d\."createdAtSource" < .+\)\s+OR \(d\."leadArrivedAt" >= .+ AND d\."leadArrivedAt" < .+\)/)
  })

  it('takes a deal born in Регистрация or Первичный отдел, or standing in one now — every stage', () => {
    expect(sql).toContain(`FROM "crm_deal_birth" b`)
    expect(sql).toContain(`WHERE b."dealExternalId" = d."externalId" AND b."externalSource" = d."externalSource"`)
    expect(sql).toContain(`AND (b."categoryId" IN (0, 12) OR p."externalId" IN ('0', '12'))`)
    expect(sql).not.toMatch(/[Дд]убл/)
    expect(sql).not.toContain(`p."role"`)
  })

  it('hands over every number of the contact, and the contact even before the customer pass links it', () => {
    expect(sql).toContain(`phone_nines(cu."phones" || cu."phone") END AS phones`)
    expect(sql).toContain(`COALESCE(cu."externalId", d."metadata"->>'contactId') AS contact_id`)
    expect(sql).toContain(`d."dealPhone" AS deal_phone`)
  })

  it('names «ROP KVAL LID» and «РОП (Первичка)» by the team they head, else by the person — once per person', () => {
    expect(sql).toContain(`d."ropKvalLidEmployeeId" AS rop_id`)
    expect(sql).toContain(`d."leadRopEmployeeId" AS rop_primary_id`)
    expect(sql).toContain(`WHERE h."headId" = o."id" AND h."isActive"`)
    expect(sql).toContain(`AND o."fullName" ~* '(^|[^[:alpha:]])rop([^[:alpha:]]|$)'`)
    expect(sql).toContain(`o."fullName") AS name`)
    expect(sql).toContain(`WHERE o."id" IN (SELECT rop_id FROM w UNION SELECT rop_primary_id FROM w)`)
    expect(sql).toContain(`LEFT JOIN names k ON k."id" = w.rop_id`)
    expect(sql).toContain(`LEFT JOIN names lr ON lr."id" = w.rop_primary_id`)
    // The old guesses are gone: the owner, the seller's unit, the hand-over log.
    expect(sql).not.toContain('deal_owner_change')
    expect(sql).not.toContain('createdByEmployeeId')
  })

  it('reads the names only for the day card', () => {
    expect(sql).not.toContain('sales_source')
    expect(detail).toContain(`LEFT JOIN "sales_source" s ON s."id" = d."sourceId"`)
    expect(detail).toContain(`st."name" AS stage`)
  })
})

describe('dayChunks — a month read a week at a time', () => {
  it('covers every day once, in order, the last run short', async () => {
    const { dayChunks } = await import('@/server/repositories/registrationRepository')
    expect(dayChunks('2026-09-22', '2026-10-20', 7)).toEqual([
      ['2026-09-22', '2026-09-28'],
      ['2026-09-29', '2026-10-05'],
      ['2026-10-06', '2026-10-12'],
      ['2026-10-13', '2026-10-19'],
      ['2026-10-20', '2026-10-20'],
    ])
    expect(dayChunks('2026-10-21', '2026-10-21', 7)).toEqual([['2026-10-21', '2026-10-21']])
    expect(dayChunks('2026-10-22', '2026-10-21', 7)).toEqual([])
  })
})

describe('bezkvalHistorySql', () => {
  const sql = bare(RegistrationRepository.bezkvalHistorySql())

  it('finds the contacts holding a number through the phone index, and number-less contacts by id', () => {
    expect(sql).toContain(`WHERE phone_nines(cu."phones" || cu."phone") && $2::text[]`)
    expect(sql).toContain(`WHERE cu."externalId" = ANY($3::text[])`)
  })

  it('looks only before the day, past HR, with the lead rule and instant of the window read', () => {
    expect(sql).toContain(`WHERE d."customerId" = o.customer_id`)
    expect(sql).toContain(`AND x.at < (($1::date)::timestamp AT TIME ZONE $4 AT TIME ZONE 'UTC')`)
    // A fence: the LATERAL must stay a per-contact index read, never a hash of every deal.
    expect(sql).toMatch(/IS DISTINCT FROM '8'\s+OFFSET 0\s+\) y/)
    expect(sql).toContain(`AND p."externalId" IS DISTINCT FROM '8'`)
    expect(sql).toContain(`(b."categoryId" IN (0, 12) OR p."externalId" IN ('0', '12')) AS is_lead`)
    expect(sql).toContain(`FILTER (WHERE is_lead AND at >= (($1::date)::timestamp AT TIME ZONE $4 AT TIME ZONE 'UTC') - interval '30 days')`)
  })

  it('returns one row a key: its latest earlier deal', () => {
    expect(sql).toContain('SELECT DISTINCT ON (key)')
    expect(sql).toContain('ORDER BY key, at DESC, external_id DESC')
  })
})

describe('sellerLeadsSql', () => {
  const sql = bare(RegistrationRepository.sellerLeadsSql())
  const distributed = bare(RegistrationRepository.distributedDaysSql())

  it('counts the same handed-out deals as «Olgan lid», inclusive bounds', () => {
    expect(sql).toContain(`d."leadDistributedOn" BETWEEN $1::date AND $2::date`)
    expect(sql).toContain(`(p."role" IS DISTINCT FROM 'LEAD' OR d."leadRopEmployeeId" IS NOT NULL)`)
  })

  it('names the team exactly as the split does', () => {
    const team = (s: string) => s.slice(s.indexOf('COALESCE('), s.indexOf(') AS rop') + ') AS rop'.length).replace(/\s+/g, ' ')
    expect(team(sql)).toBe(team(distributed))
  })

  it('credits the person the sellers board credits — the operator, else the owner', () => {
    expect(sql).toContain(`COALESCE(d."operatorEmployeeId", d."employeeId") AS employee_id`)
  })
})

describe('sellerCallsSql', () => {
  const sql = bare(RegistrationRepository.sellerCallsSql())

  it('counts connected calls and their talk time per person, the day end-exclusive', () => {
    expect(sql).toContain(`WHERE c."connected"`)
    expect(sql).toContain(`c."startedAt" >= $1 AND c."startedAt" < $2`)
    expect(sql).toContain(`COALESCE(sum(c."durationSec"), 0)::bigint AS talk_sec`)
  })

  it('takes every direction, as «Qoʻngʻiroqlar» does', () => {
    expect(sql).not.toContain('direction')
  })
})

describe('rosterSql', () => {
  it('puts a head of two ROP units in the one they sit in, as the leads are read (2026-10-02)', () => {
    const sql = bare(RegistrationRepository.rosterSql())
    expect(sql).toMatch(/ORDER BY x\.employee_id, x\.rank, \(x\.unit_id = e\."departmentId"\) DESC, x\."name"\s*$/)
    expect(bare(RegistrationRepository.distributedDaysSql())).toContain(`ORDER BY (h."id" = e."departmentId") DESC, h."name"`)
  })
})

describe('sellerFaktDaysSql', () => {
  it('reads FAKT 1 / FAKT 2 by the board\'s predicates and /rnp\'s team, per operator', async () => {
    const { InsightsRepository } = await import('@/server/repositories/insightsRepository')
    const sql = bare(InsightsRepository.sellerFaktDaysSql())
    const rnp = bare(InsightsRepository.rnpTeamDaysSql())
    expect(sql).toContain('c.operator_id AS employee_id')
    expect(sql).toContain(`= 'DELIVERED'`)
    const fakt1 = (s: string) => s.slice(s.indexOf('count(*) FILTER (WHERE'), s.indexOf('::bigint AS fakt1_orders'))
    expect(fakt1(sql)).toBe(fakt1(rnp))
    // Both read the queue's own team, c.rop (teamSql in classified).
    expect(sql).toContain('c.rop AS rop')
    expect(rnp).toContain(`COALESCE(c.rop, '(ROP yoʻq)') AS rop`)
  })
})
