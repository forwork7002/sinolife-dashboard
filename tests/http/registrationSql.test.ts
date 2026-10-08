import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RegistrationRepository } = await import('@/server/repositories/registrationRepository')

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
    expect(sql).toContain(`(p."role" IS DISTINCT FROM 'LEAD' OR d."leadRopEmployeeId" IS NOT NULL OR d."ropKvalLidEmployeeId" IS NOT NULL)`)
  })

  it('reads «ROP KVAL LID» first, then «РОП (Первичка)», then — out of Регистрация only — the seller\'s team (2026-10-07)', () => {
    const team = sql.slice(sql.indexOf('COALESCE('), sql.indexOf(') AS rop'))
    const kval = team.indexOf('k."id"')
    const field = team.indexOf('h."headId" = d."leadRopEmployeeId"')
    const seller = team.indexOf('ad."id" = a."departmentId"')
    expect(kval).toBeGreaterThan(-1)
    expect(field).toBeGreaterThan(kval)
    expect(seller).toBeGreaterThan(field)
    expect(team.slice(seller)).toContain(`p."role" IS DISTINCT FROM 'LEAD'`)
    expect(sql).toContain('LEFT JOIN "employee" k ON k."id" = d."ropKvalLidEmployeeId"')
    expect(sql).toContain('LEFT JOIN "employee" a ON a."id" = d."employeeId"')
  })

  it('marks every deal after a contact\'s first that day as a duplicate', () => {
    expect(sql).toMatch(/PARTITION BY d\."leadDistributedOn", COALESCE\(d\."customerId", d\."id"\)/)
    expect(sql).toContain(`count(*) FILTER (WHERE nth > 1)`)
  })
})

/*
  «Безквал», 2026-10-06. Run against a scratch PostgreSQL with the migrations
  applied and ten synthetic Регистрация deals: a head's deal, a seller's deal
  the desk opened, a seller's own, one with no opener, a deal that went to a
  ROP and back to the desk, a registrar's, Davlat's, a deal moved from one ROP
  to another, one created 01:00 Tashkent, and a registrar whose primary unit
  is a ROP's but who is also listed in Регистрация — Azizbek 3, Maftuna 2,
  Shohjaxon 1, unassigned 4, as seeded.
*/
describe('bezkvalDaysSql', () => {
  const sql = bare(RegistrationRepository.bezkvalDaysSql())

  it('reads Регистрация deals by the Tashkent day they were created, end-exclusive', () => {
    expect(sql).toContain(`JOIN "pipeline" p ON p."id" = d."pipelineId" AND p."role" = 'LEAD'`)
    expect(sql).toContain(`(d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day`)
    expect(sql).toContain(`d."createdAtSource" >= (($1::date)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`)
    expect(sql).toContain(`d."createdAtSource" < (($2::date + 1)::timestamp AT TIME ZONE $3 AT TIME ZONE 'UTC')`)
  })

  it('credits the portal\'s «ROP KVAL LID» first, read through the same head rule', () => {
    expect(sql).toContain(`LEFT JOIN "employee" k ON k."id" = d."ropKvalLidEmployeeId"`)
    expect(sql).toContain(`WHERE h."headId" = k."id" AND h."isActive"`)
    expect(sql.indexOf('h."headId" = k."id"')).toBeLessThan(sql.indexOf('h."headId" = e."id"'))
  })

  it('credits a team the owner HEADS first, the head read as the split reads one', () => {
    expect(sql).toContain(`WHERE h."headId" = e."id" AND h."isActive"`)
    expect(sql).toContain(`ORDER BY (h."id" = e."departmentId") DESC, h."name"`)
    expect(sql.indexOf('h."headId" = e."id"')).toBeLessThan(sql.indexOf('dep."id" = e."departmentId"'))
  })

  it('credits a registrar named «… rop» to the ROP unit the portal lists them in, the primary first', () => {
    expect(sql).toContain(`FROM "department_member" m`)
    expect(sql).toContain(`JOIN "department" md ON md."id" = m."departmentId" AND md."isActive"`)
    expect(sql).toContain(`WHERE m."employeeId" = e."id"`)
    expect(sql).toContain(`AND e."fullName" ~* '(^|[^[:alpha:]])rop([^[:alpha:]]|$)'`)
    expect(sql).toContain(`ORDER BY m."isPrimary" DESC, md."name"`)
  })

  it('credits a seller\'s deal to their primary ROP team only when someone else opened it', () => {
    expect(sql).toContain(`WHERE dep."id" = e."departmentId" AND dep."isActive"`)
    expect(sql).toContain(`AND d."createdByEmployeeId" IS NOT NULL`)
    expect(sql).toContain(`AND d."createdByEmployeeId" <> d."employeeId"`)
  })

  it('keeps a registrar the portal also files under a ROP out of the seller rule', () => {
    expect(sql).toContain(`WHERE om."employeeId" = e."id"`)
    expect(sql).toMatch(/AND NOT EXISTS \(\s*SELECT 1\s*FROM "department_member" om/)
  })

  it('falls back to the last recorded hand-over to a ROP, read by the same owner rule', () => {
    expect(sql).toContain(`FROM "deal_owner_change" c`)
    expect(sql).toContain(`JOIN "employee" he ON he."id" = c."toEmployeeId"`)
    expect(sql).toContain(`WHERE h."headId" = he."id" AND h."isActive"`)
    expect(sql).toContain(`AND he."fullName" ~* '(^|[^[:alpha:]])rop([^[:alpha:]]|$)'`)
    expect(sql).toContain(`WHERE c."dealId" = d."id" AND x.rop IS NOT NULL`)
    expect(sql).toContain(`ORDER BY c."changedAt" DESC, c."createdAt" DESC`)
  })

  it('counts every stage, as the portal filter does', () => {
    expect(sql).not.toContain('stage')
    expect(sql).not.toContain('status')
  })
})

describe('sellerLeadsSql', () => {
  const sql = bare(RegistrationRepository.sellerLeadsSql())
  const distributed = bare(RegistrationRepository.distributedDaysSql())

  it('counts the same handed-out deals as «Olgan lid», inclusive bounds', () => {
    expect(sql).toContain(`d."leadDistributedOn" BETWEEN $1::date AND $2::date`)
    expect(sql).toContain(`(p."role" IS DISTINCT FROM 'LEAD' OR d."leadRopEmployeeId" IS NOT NULL OR d."ropKvalLidEmployeeId" IS NOT NULL)`)
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
    expect(sql).toContain(`COALESCE(CASE`)
    expect(rnp).toContain(`COALESCE(CASE`)
  })
})
