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

/*
  FAKT 1 / FAKT 2 per Meta campaign on «Reklama samarasi» · «Kampaniyalar».
  Run against a local PostgreSQL with portal-shaped rows on 2026-10-08; these
  pin what that run proved.
*/
describe('campaignFaktSql', () => {
  const sql = InsightsRepository.campaignFaktSql()

  it('continues the queue prelude and reads FAKT with the board\'s own predicates', () => {
    expect(sql.trimStart().startsWith(',')).toBe(true)
    expect(sql).toContain('FROM scoped c')
    expect(sql).toContain(`c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')`)
    expect(sql).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    // FAKT 2 is not a subset of FAKT 1: an order in either is read.
    expect(sql).toContain(`WHERE ((c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')) OR ds."logisticsRole" = 'DELIVERED')`)
  })

  it('meets an order with a Meta lead of the window on the phone\'s last nine digits', () => {
    expect(sql).toContain(`right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 9) AS phone`)
    expect(sql).toContain('unnest(m."phoneKeys") AS k(phone)')
    // The leads' window is its own pair: the queue's ($1, $2) is run to now by the caller.
    expect(sql).toContain('m."createdTime" >= $4 AND m."createdTime" < $5')
    expect(sql).toContain(`!~ '^([0-9])\\1{8}$'`)
    // Both sides are reduced to their numbers before they meet (leadFakt1ClientsSql's lesson).
    expect(sql).toContain('order_phone AS MATERIALIZED')
    expect(sql).toContain('meta_phone AS MATERIALIZED')
  })

  it('gives an order to ONE campaign — the latest lead filed before its deal was opened', () => {
    expect(sql).toContain('SELECT DISTINCT ON (o.deal_id) o.deal_id, mp.campaign_id')
    expect(sql).toContain('mp.created < o.created_at')
    expect(sql).toContain('ORDER BY o.deal_id, mp.created DESC, mp."id"')
    // A lead no campaign brought (the form opened without an ad) is nobody's.
    expect(sql).toContain(`m."campaignId" <> ''`)
  })

  it('names the team as «RNP jadvali» does, for the Первичка / База split', () => {
    const team = `COALESCE(${InsightsRepository.ropNameSql('d."operatorTeamSource"')}, c.rop, '${InsightsRepository.NO_ROP}') AS rop`
    expect(sql).toContain(team)
    expect(InsightsRepository.rnpTeamDaysSql()).toContain(team)
  })
})
