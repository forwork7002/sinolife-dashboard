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

  it('names the ROP exactly as «RNP jadvali» does', () => {
    const team = (s: string) => s.slice(s.indexOf('COALESCE('), s.indexOf(') AS rop') + ') AS rop'.length).replace(/\s+/g, ' ')
    expect(team(sql)).toBe(team(bare(RnpRepository.leadDaysSql())))
  })

  it('marks every deal after a contact\'s first that day as a duplicate', () => {
    expect(sql).toMatch(/PARTITION BY d\."leadDistributedOn", COALESCE\(d\."customerId", d\."id"\)/)
    expect(sql).toContain(`count(*) FILTER (WHERE nth > 1)`)
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
    expect(sql).toContain(`COALESCE(CASE`)
    expect(rnp).toContain(`COALESCE(CASE`)
  })
})
