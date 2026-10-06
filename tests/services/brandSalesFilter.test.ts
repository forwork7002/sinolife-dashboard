import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import { previousEquivalent, resolvePeriod } from '@/server/domain/period/period'
import { brandTeams, teamBrand } from '@/server/domain/rnp/rnpSheet'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { SellerBoardRepository } from '@/server/repositories/sellerBoardRepository'
import type { AnalyticsContext } from '@/server/services/analyticsService'

/*
  The repositories read `env` at module scope (APP_TIMEZONE); a unit test about
  SQL shape supplies the names first and imports afterwards.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')
const { PulseRepository } = await import('@/server/repositories/pulseRepository')
const { SellerBoardService, brandTeamsOf } = await import('@/server/services/sellerBoardService')
const { PulseService } = await import('@/server/services/pulseService')

/**
 * Savdo dinamikasi's Collagen / Zextra switch: an order is the brand's when
 * the team that sold it is — the P&L's `teamBrand` — so every block narrows
 * by one team list (`brandTeams`) rather than a copy of the rule.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-05T09:00:00+05:00')

function context(filters: Record<string, unknown>): AnalyticsContext {
  const period = resolvePeriod('this_month', { timeZone: TZ, now: NOW })
  return {
    period,
    comparison: previousEquivalent(period),
    currency: 'UZS',
    filters: { restrictToEmployeeIds: null, ...filters },
    now: NOW,
  } as unknown as AnalyticsContext
}

describe('brandTeams', () => {
  it('lists every team teamBrand files under the brand, the folded old names too', () => {
    expect(brandTeams('Zextra').sort()).toEqual(['Asliddin', 'Charos', 'Malika', 'Sadriddin', 'Sevinchxon'])
    expect(brandTeams('Collagen')).toContain('Sevinch')
    expect(brandTeams('Collagen')).not.toContain('Hayot')
    for (const brand of ['Collagen', 'Zextra'] as const) {
      for (const team of brandTeams(brand)) expect(teamBrand(team)).toBe(brand)
    }
  })

  it('is no filter at all for both brands', () => {
    expect(brandTeamsOf(context({}))).toEqual({})
    expect(brandTeamsOf(context({ brand: 'all' }))).toEqual({})
    expect(brandTeamsOf(context({ brand: 'Zextra' }))).toEqual({ teams: brandTeams('Zextra') })
  })

  it('is «on none of the brands\' teams» for «Brendsiz», so the three slices partition the board', () => {
    const none = brandTeamsOf(context({ brand: 'none' }))
    expect(none.excludeTeams).toBe(true)
    expect([...none.teams!].sort()).toEqual([...brandTeams('Collagen'), ...brandTeams('Zextra')].sort())
  })
})

describe('the confirmation-queue readers', () => {
  const ratingFilterSql = (
    InsightsRepository as unknown as {
      ratingFilterSql: (filters: { teams?: readonly string[] }, params: unknown[]) => string
    }
  ).ratingFilterSql

  it('narrow on the cohort’s own team column, as one array parameter', () => {
    const params: unknown[] = ['a', 'b', 'c']
    const clause = ratingFilterSql({ teams: ['Asliddin', 'Charos'] }, params)
    expect(clause).toBe(' AND c.rop = ANY($4::text[])')
    expect(params[3]).toEqual(['Asliddin', 'Charos'])
  })

  it('keep, for «Brendsiz», the orders on none of the teams — a team-less one too', () => {
    const params: unknown[] = []
    const clause = (
      InsightsRepository as unknown as {
        ratingFilterSql: (filters: { teams?: readonly string[]; excludeTeams?: boolean }, params: unknown[]) => string
      }
    ).ratingFilterSql({ teams: ['Asliddin'], excludeTeams: true }, params)
    expect(clause).toBe(' AND (c.rop IS NULL OR NOT (c.rop = ANY($1::text[])))')
    expect(params).toEqual([['Asliddin']])
  })

  it('add nothing without a brand', () => {
    const params: unknown[] = []
    expect(ratingFilterSql({}, params)).toBe('')
    expect(ratingFilterSql({ teams: [] }, params)).toBe('')
    expect(params).toEqual([])
  })

  it('are asked for the brand’s teams by the FAKT chart', async () => {
    const calls: unknown[][] = []
    const insights = {
      confirmationFaktDays: async (...args: unknown[]) => {
        calls.push(args)
        return []
      },
    } as unknown as InstanceType<typeof InsightsRepository>
    const service = new SellerBoardService(
      {} as SellerBoardRepository,
      insights,
      { findKpisForPeriod: async () => [] } as unknown as ReferenceRepository,
    )
    await service.faktTrend(context({ brand: 'Collagen' }))
    await service.faktTrend(context({}))
    expect((calls[0]![1] as { teams?: string[] }).teams).toEqual(brandTeams('Collagen'))
    expect((calls[1]![1] as { teams?: string[] }).teams).toBeUndefined()
  })
})

describe('the Доставка board', () => {
  it('narrows the deals by their team inside the JOIN, the empty columns kept', async () => {
    const seen: { sql: string; params: unknown[] }[] = []
    const prisma = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        seen.push({ sql, params })
        return []
      },
    } as unknown as PrismaClient
    const service = new PulseService(new PulseRepository(prisma))
    await service.deliveryBoard(context({ brand: 'Zextra' }))

    const { sql, params } = seen[0]!
    const condition = sql.indexOf('= ANY($2::text[])')
    expect(condition).toBeGreaterThan(sql.indexOf('LEFT JOIN "deal" d'))
    expect(condition).toBeLessThan(sql.indexOf('WHERE pl."externalId"'))
    expect(sql).toContain('d."operatorTeamSource"')
    expect(params[1]).toEqual(brandTeams('Zextra'))

    seen.length = 0
    await service.deliveryBoard(context({}))
    expect(seen[0]!.sql).not.toContain('::text[]')
  })
})
