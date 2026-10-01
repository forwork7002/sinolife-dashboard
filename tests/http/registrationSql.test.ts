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
