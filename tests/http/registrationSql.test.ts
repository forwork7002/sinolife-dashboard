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
  «Безквал» by the client's spec v2, 2026-10-26. Run against PGlite with every
  migration applied and twenty-one synthetic deals of 23.10: a Регистрация
  birth with a Доставка deal 13 days before (takror 30), a contact of two
  numbers tied to another contact by one of them with a deal in May (takror
  eski), an «ИИ» birth moved into Регистрация on a +7 number whose last nine
  are another contact's (yangi), a Первичка birth moved back into Регистрация
  (not a kirim), a Регистрация deal moved out to «ИИ» and back (kirim), a
  Первичка birth (kval), a Lead Guard deal created at 01:30 that «arrived» at
  23:30 the evening before (23.10, by DATE_CREATE), a deal whose birth is not
  read yet, an operator of a ROP team in «ROP KVAL LID», a member of a ROP
  team in «РОП (Первичка)», an owner sitting in a ROP team, the desk users 10
  and 1, an HR deal, two contacts on one junk number, and a deal a second
  either side of the day — 13 kirim, 12 clients, 8 new / 3 + 1 repeat, the
  ROPs, the buckets and the kval as worked out by hand. Then 200 000 deals,
  120 000 contacts: a day counted in 0.15 s.
*/
describe('bezkvalLeadsSql', () => {
  const sql = bare(RegistrationRepository.bezkvalLeadsSql())
  const detail = bare(RegistrationRepository.bezkvalLeadsSql(true))
  const kval = bare(RegistrationRepository.bezkvalLeadsSql(true, 'kval'))

  it('reads a window of Tashkent days by the kirim\'s instant, end-exclusive — DATE_CREATE, never «Лид тушган сана»', () => {
    expect(sql).toContain(`WHERE e.at >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC') AND e.at < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`)
    expect(sql).toContain(`(l.at AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day`)
    expect(sql).toContain(`extract(hour FROM (l.at AT TIME ZONE 'UTC' AT TIME ZONE $3))::int AS hour`)
    expect(sql).not.toContain('leadArrivedAt')
    expect(sql).toContain(`COALESCE(d."leadVia" ILIKE '%lead guard%', false) AS lead_guard`)
  })

  it('a deal BORN in Регистрация — its birth row, else where it stands while the feed has not read it', () => {
    expect(sql).toContain(`COALESCE(born."bornAt", m.created_at) AS at, 'created' AS entry`)
    expect(sql).toContain(`WHERE CASE WHEN born."categoryId" IS NULL THEN m.pipeline = '0' ELSE born."categoryId" = 0 END`)
    // Read once for the window's ids — never a lookup per deal (a month timed out that way, 2026-10-22).
    expect(sql).toContain(`WHERE b."dealExternalId" IN (SELECT external_id FROM made)`)
    expect(sql).not.toContain('IN (0, 12)')
    expect(sql).not.toContain('phone_nines')
  })

  it('a deal MOVED into Регистрация whose previous row — its birth or its move before — is in «ИИ обработка»', () => {
    expect(sql).toContain(`SELECT d."id", mv."movedAt", 'ai'`)
    expect(sql).toContain(`WHERE mv."categoryId" = 0 AND mv."movedAt" >= `)
    expect(sql).toContain(`WHERE e.id < mv."externalId"::bigint`)
    expect(sql).toMatch(/ORDER BY e\.id DESC\s+LIMIT 1\) = 20/)
    expect(sql).toContain(`SELECT DISTINCT ON (e.deal_id) e.deal_id, e.at, e.entry`)
  })

  it('kval: Первичный отдел\'s births, and no moves', () => {
    expect(kval).toContain(`WHERE CASE WHEN born."categoryId" IS NULL THEN m.pipeline = '12' ELSE born."categoryId" = 12 END`)
    expect(kval).not.toContain('crm_deal_move')
  })

  it('hands over every number of the contact, and the contact even before the customer pass links it', () => {
    expect(sql).toContain(`array_remove(cu."phones" || cu."phone", NULL) END AS phones`)
    expect(sql).toContain(`d."metadata"->>'contactId' AS meta_contact`)
    expect(sql).toContain(`COALESCE(cu."externalId", l.meta_contact) AS contact_id`)
    expect(sql).toContain(`d."dealPhone" AS deal_phone`)
  })

  it('reads «ROP KVAL LID», «РОП (Первичка)» and the owner once per person, and the desk by its portal ids', () => {
    expect(sql).toContain(`d."ropKvalLidEmployeeId" AS rop_id`)
    expect(sql).toContain(`d."leadRopEmployeeId" AS rop_primary_id`)
    expect(sql).toContain(`d."employeeId" AS owner_id`)
    expect(sql).toContain(`WHERE o."id" IN (SELECT rop_id FROM lead UNION SELECT rop_primary_id FROM lead UNION SELECT owner_id FROM lead)`)
    expect(sql).toContain(`(o."externalSource" = 'BITRIX24' AND o."externalId" IN ('1', '10')) AS desk`)
    // A head of a «(ROP)» team, else the «(ROP)» team they sit in — primary, then any listing.
    expect(sql).toContain(`WHERE h."headId" = o."id" AND h."isActive"`)
    expect(sql).toContain(`WHERE dep."id" = o."departmentId" AND dep."isActive"`)
    expect(sql).toContain(`WHERE m."employeeId" = o."id"`)
    expect(sql).not.toContain('fullName')
  })

  it('reads the names only for the day card', () => {
    expect(sql).not.toContain('sales_source')
    expect(detail).toContain(`LEFT JOIN "sales_source" s ON s."id" = l.source_id`)
    expect(detail).toContain(`st."name" AS stage`)
  })
})

describe('storedBezkvalDaysSql — every screen reads what the worker stored', () => {
  const sql = bare(RegistrationRepository.storedBezkvalDaysSql())
  it('counts stored clients and their deals by day and ROP, inclusive bounds', () => {
    expect(sql).toContain(`FROM "bezkval_client" c`)
    expect(sql).toContain(`WHERE c."day" BETWEEN $1::date AND $2::date`)
    expect(sql).toContain(`count(*)::bigint AS leads, sum(c."dealCount")::bigint AS deals`)
    expect(sql).toContain(`c."day"::text AS day`)
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

  it('finds the contacts holding a number one GIN probe per number, and number-less contacts by id', () => {
    expect(sql).toContain(`FROM unnest($2::text[]) AS t(tail)`)
    expect(sql).toMatch(/WHERE phone_nines\(c\."phones" \|\| c\."phone"\) @> ARRAY\[t\.tail\]\s+OFFSET 0/)
    // The array form scanned every contact (4 s on 120 000 in PGlite): never again.
    expect(sql).not.toContain('&& $2')
    expect(sql).toContain(`WHERE cardinality($3::text[]) > 0 AND cu."externalId" = ANY($3::text[])`)
  })

  it('hands over each contact\'s numbers and its latest deal created before the day, past HR', () => {
    expect(sql).toContain(`SELECT o.contact_id, o.phones, y.external_id, y.pipeline, y.at`)
    expect(sql).toContain(`WHERE d."customerId" = o.customer_id`)
    expect(sql).toContain(`AND d."createdAtSource" < (($1::date)::timestamp AT TIME ZONE $4 AT TIME ZONE 'UTC')`)
    expect(sql).toContain(`AND p."externalId" IS DISTINCT FROM '8'`)
    expect(sql).toMatch(/ORDER BY d\."createdAtSource" DESC, d\."externalId" DESC\s+LIMIT 1/)
    expect(sql).not.toContain('crm_deal_birth')
  })
})

describe('ropHeadsSql', () => {
  it('names the head of every active «(ROP)» team', () => {
    const sql = bare(RegistrationRepository.ropHeadsSql())
    expect(sql).toContain(`JOIN "employee" e ON e."id" = h."headId"`)
    expect(sql).toContain(`WHERE h."isActive" AND`)
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
