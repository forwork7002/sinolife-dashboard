import { beforeEach, describe, expect, it } from 'vitest'

import { CUSTOMER_STATES } from '@/lib/customerStates'
import { trailingDays } from '@/server/domain/period/period'
import type {
  CustomerFlowRows,
  CustomerStateCounts,
  InsightsRepository,
  SourceRepeatRate,
} from '@/server/repositories/insightsRepository'
import {
  CUSTOMER_FLOW_DAYS,
  InsightsService,
  resetCustomerFlowCaches,
} from '@/server/services/insightsService'

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-09-15T08:00:00+05:00')

/*
  Module-level caches, same hazard `resetConfirmationRopCache` documents: a
  fixture from one case answering a later case's identically-keyed question is
  a silent wrong answer, not a test failure, unless every case starts clean.
*/
beforeEach(resetCustomerFlowCaches)

function emptyFlow(): CustomerFlowRows {
  return {
    summary: {
      newCustomers: 0,
      returningCustomers: 0,
      activeCustomers: 0,
      newCustomersWon: 0,
      firstRevenueMinor: 0n,
      repeatRevenueMinor: 0n,
    },
    series: [],
    sources: [],
  }
}

function fakeRepository(overrides: {
  flow?: CustomerFlowRows
  rates?: readonly SourceRepeatRate[]
  states?: CustomerStateCounts
}): InsightsRepository {
  return {
    customerFlow: async () => overrides.flow ?? emptyFlow(),
    sourceRepeatRates: async () => overrides.rates ?? [],
    customerStates: async () =>
      overrides.states ?? { customers: 0, ours: { ACTIVE: 0, AT_RISK: 0, LOST: 0 } },
  } as unknown as InsightsRepository
}

describe('InsightsService.customerFlow', () => {
  it('resolves its window with trailingDays, not a hand-rolled calculation', async () => {
    const service = new InsightsService(fakeRepository({}))

    const dto = await service.customerFlow('UZS', NOW, TZ)

    // The one true window this method is allowed to build. Re-testing
    // `trailingDays` itself belongs to period.test.ts, not here — this just
    // checks that `customerFlow` actually calls it rather than re-deriving
    // the same span by hand.
    const expected = trailingDays(CUSTOMER_FLOW_DAYS, { timeZone: TZ, now: NOW })
    expect(dto.window.start).toBe(expected.start.toISOString())
    expect(dto.window.end).toBe(expected.end.toISOString())
    expect(dto.window.days).toBe(90)
  })

  it('builds states.rows in CUSTOMER_STATES order, summing to states.customers', async () => {
    const states: CustomerStateCounts = {
      customers: 12,
      ours: { ACTIVE: 5, AT_RISK: 4, LOST: 3 },
    }
    const service = new InsightsService(fakeRepository({ states }))

    const dto = await service.customerFlow('UZS', NOW, TZ)

    expect(dto.states.rows.map((row) => row.key)).toEqual(
      CUSTOMER_STATES.map((state) => state.key),
    )
    expect(dto.states.rows.reduce((sum, row) => sum + row.customers, 0)).toBe(
      dto.states.customers,
    )
    expect(dto.states.customers).toBe(12)
  })

  it('reports a source absent from sourceRepeatRates as null/0, never a manufactured value', async () => {
    // GROUP BY never emits an empty group, so a source with nobody past the
    // ninety-day maturity horizon is simply MISSING from `rates` — this is
    // the real shape sourceRepeatRates produces, not a contrived edge case.
    const flow: CustomerFlowRows = {
      ...emptyFlow(),
      summary: { ...emptyFlow().summary, newCustomers: 5 },
      sources: [{ key: 'instagram', label: 'Instagram', newCustomers: 5 }],
    }
    const service = new InsightsService(fakeRepository({ flow, rates: [] }))

    const dto = await service.customerFlow('UZS', NOW, TZ)

    expect(dto.sources).toEqual([
      expect.objectContaining({
        key: 'instagram',
        repeatPercent: null,
        maturedCustomers: 0,
      }),
    ])
  })

  it('leaves sharePercent null when the window has no new customers to share', async () => {
    const flow: CustomerFlowRows = {
      ...emptyFlow(),
      sources: [{ key: '', label: '(manbasiz)', newCustomers: 0 }],
    }
    const service = new InsightsService(fakeRepository({ flow }))

    const dto = await service.customerFlow('UZS', NOW, TZ)

    expect(dto.summary.newCustomers).toBe(0)
    expect(dto.sources[0]?.sharePercent).toBeNull()
  })
})
