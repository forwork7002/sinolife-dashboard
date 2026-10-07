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
const { formAliasOverSql, leadFormTitleSql } = await import('@/server/repositories/leadFormSql')

/*
  «Факт1 мижоз» on «Barcha manbalar · Регистрация». Run against a local
  PostgreSQL with portal-shaped rows on 2026-10-01; these pin what that run
  proved.
*/
describe('leadFakt1ClientsSql', () => {
  const sql = InsightsRepository.leadFakt1ClientsSql()

  it('continues the queue prelude and takes FAKT 1 with the board\'s own predicate', () => {
    expect(sql.trimStart().startsWith(',')).toBe(true)
    expect(sql).toContain('FROM scoped c')
    expect(sql).toContain(`c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`)
  })

  it('matches every number of both contacts on its last nine digits', () => {
    expect(sql.match(/unnest\(cu\."phones" \|\| cu\."phone"\)/g)).toHaveLength(2)
    // Each side is reduced to its numbers first, then matched on them: lead_phone, not a
    // per-phone re-read of the month's leads (68-106 s on production, 2026-10-07).
    expect(sql).toContain(`right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 9) AS phone`)
    expect(sql).toContain('lead_phone AS MATERIALIZED')
    expect(sql).toContain('JOIN fakt1_phone f ON f.phone = lp.phone')
    expect(sql).toContain(`length(right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 9)) = 9`)
  })

  it('leaves out placeholder numbers of one repeated digit', () => {
    expect(sql).toContain(`!~ '^([0-9])\\1{8}$'`)
  })

  it('reads Регистрация leads created in the window, and only orders created after the lead', () => {
    expect(sql).toContain(`p."role" = 'LEAD'`)
    expect(sql).toContain(`d."createdAtSource" >= $1 AND d."createdAtSource" < $2`)
    expect(sql).toContain(`max(c.created_at) AS created_at`)
    expect(sql).toContain(`l."createdAtSource" AS created`)
    expect(sql).toContain(`f.created_at > lp.created`)
  })

  it('names the form exactly as the registration scan does, one row per lead', () => {
    // leadFormSql.ts: the title, else a repeat lead's SOURCE_DESCRIPTION.
    expect(sql).toContain(`min(${leadFormTitleSql('l."title"', 'l.sd', 's."externalId"', 'fa.title')}) AS form_title`)
    expect(sql).toContain('LEFT JOIN form_alias fa ON fa.sd = l.sd')
    expect(sql).toMatch(/GROUP BY l\."id", s\."externalId", s\."name"\s*$/)
  })

  it('reads the window\'s leads once, the form aliases from those same rows (2026-10-06 audit)', () => {
    // The alias CTE of its own (`FROM "deal" ad`) was a second pass over a month of Регистрация deals.
    expect(sql.match(/FROM "deal"/g)).toHaveLength(1)
    expect(sql).toContain('lw AS MATERIALIZED (')
    expect(sql).toContain(formAliasOverSql('(SELECT w.sd, w.title FROM lw w) fd'))
    expect(sql).toMatch(/FROM lw l\b/)
  })
})
