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
  })

  it('is a slice carrying both brands\' teams — the fallback for an order with no line items', () => {
    const team = { collagenTeams: brandTeams('Collagen'), zextraTeams: brandTeams('Zextra') }
    expect(brandTeamsOf(context({ brand: 'Zextra' }))).toEqual({ brand: { slice: 'Zextra', ...team } })
    expect(brandTeamsOf(context({ brand: 'none' }))).toEqual({ brand: { slice: 'none', ...team } })
  })
})

describe('the confirmation-queue readers', () => {
  const ratingFilterSql = (
    InsightsRepository as unknown as {
      ratingFilterSql: (filters: { brand?: Parameters<typeof InsightsRepository.brandSliceSql>[2] }, params: unknown[]) => string
    }
  ).ratingFilterSql
  const slice = (s: 'Collagen' | 'Zextra' | 'none') => ({ slice: s, collagenTeams: ['Sevinch'], zextraTeams: ['Asliddin'] })

  it('narrow by the order\'s product — the team only for an order with no line items', () => {
    const params: unknown[] = ['a', 'b', 'c']
    const clause = ratingFilterSql({ brand: slice('Zextra') }, params)
    expect(clause).toContain('FROM "deal_item" di JOIN "product" dp ON dp."id" = di."productId"')
    expect(clause).toContain('WHERE di."dealId" = d."id"')
    expect(clause).toContain(`WHEN dp."name" ~* 'zextra' THEN 'Zextra'`)
    expect(clause).toContain(`WHEN '-' THEN NULL`)
    expect(clause).toContain('WHEN (c.rop) = ANY($4::text[]) THEN \'Collagen\'')
    expect(clause).toContain('WHEN (c.rop) = ANY($5::text[]) THEN \'Zextra\'')
    expect(clause.endsWith(') = $6')).toBe(true)
    expect(params.slice(3)).toEqual([['Sevinch'], ['Asliddin'], 'Zextra'])
  })

  it('keep, for «Brendsiz», the orders neither brand claims', () => {
    const params: unknown[] = []
    expect(ratingFilterSql({ brand: slice('none') }, params).endsWith(') IS NULL')).toBe(true)
    expect(params).toEqual([['Sevinch'], ['Asliddin']])
  })

  it('add nothing without a brand', () => {
    const params: unknown[] = []
    expect(ratingFilterSql({}, params)).toBe('')
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
    expect((calls[0]![1] as { brand?: { slice: string } }).brand?.slice).toBe('Collagen')
    expect((calls[1]![1] as { brand?: unknown }).brand).toBeUndefined()
  })
})

describe('the Доставка board', () => {
  it('narrows the deals by their product inside the JOIN, the empty columns kept', async () => {
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
    const condition = sql.indexOf('FROM "deal_item" di')
    expect(condition).toBeGreaterThan(sql.indexOf('LEFT JOIN "deal" d'))
    expect(condition).toBeLessThan(sql.indexOf('WHERE pl."externalId"'))
    expect(sql).toContain('d."operatorTeamSource"')
    expect(params.slice(1)).toEqual([brandTeams('Collagen'), brandTeams('Zextra'), 'Zextra'])

    seen.length = 0
    await service.deliveryBoard(context({}))
    expect(seen[0]!.sql).not.toContain('::text[]')
  })
})

describe('the seller\'s day chart', () => {
  it('narrows by the brand like the board row it opens from', async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const prisma = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params })
        return []
      },
    } as unknown as PrismaClient
    const repo = new InsightsRepository(prisma)
    const period = { ...resolvePeriod('this_month', { timeZone: TZ, now: NOW }), restrictToEmployeeIds: null }
    await repo.confirmationSellerRatingDays(period, 'e1')
    await repo.confirmationSellerRatingDays(period, 'e1', { slice: 'none', collagenTeams: ['Sevinch'], zextraTeams: ['Asliddin'] })
    expect(calls[0]!.sql).not.toContain('$5')
    expect(calls[0]!.params).toHaveLength(4)
    expect(calls[1]!.sql).toContain('WHEN (c.rop) = ANY($5::text[])')
    expect(calls[1]!.sql).toContain(') IS NULL')
    expect(calls[1]!.params.slice(4)).toEqual([['Sevinch'], ['Asliddin']])
  })
})
