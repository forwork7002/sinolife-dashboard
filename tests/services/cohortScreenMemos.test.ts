import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { trailingDays } from '@/server/domain/period/period'
import type { ConcentrationRepository } from '@/server/repositories/concentrationRepository'
import type {
  CohortMatrix,
  CustomerFlowRows,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import {
  ConcentrationService,
  resetConcentrationCache,
} from '@/server/services/concentrationService'
import {
  InsightsService,
  resetCohortCaches,
  resetCustomerFlowCaches,
} from '@/server/services/insightsService'

/**
 * «MIJOZ QAYTISHI» BUILDS EACH ANSWER ONCE PER FIVE MINUTES, NOT ONCE PER TAB.
 *
 * The page polls `/insights/cohorts`, `/insights/customers` and
 * `/insights/concentration` every five minutes, and all three are
 * whole-history scans that every reader asks identically. Until 2026-10-06 the
 * cohort matrix, the База card and the concentration band had no memo at all,
 * and the customer-flow memo lived 60 s — below the poll, so a solo reader
 * missed on every request.
 *
 * Each fake answers DIFFERENTLY every time it is asked and counts the asks,
 * because comparing two DTOs built from one fixture would pass whether or not
 * the second build happened.
 */

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-06T09:00:00+05:00')
const PERIOD = trailingDays(90, { timeZone: TZ, now: NOW })

beforeEach(() => {
  resetCohortCaches()
  resetCustomerFlowCaches()
  resetConcentrationCache()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A matrix whose only distinguishing mark is which build produced it. */
function matrix(build: number): CohortMatrix {
  return {
    rows: [],
    totals: { customers: build, returned: 0, firstRevenueMinor: 0n, laterRevenueMinor: 0n },
    currentMonth: '2026-10-01',
    rops: [],
  }
}

function cohortService() {
  const asked: unknown[] = []
  let stageBuilds = 0
  const repository = {
    cohorts: async (options: unknown) => {
      asked.push(options)
      return matrix(asked.length)
    },
    retentionStages: async () => {
      stageBuilds += 1
      return { groups: [], totalCustomers: stageBuilds, workedCustomers: 0 }
    },
  } as unknown as InsightsRepository
  return { service: new InsightsService(repository), asked, stageBuilds: () => stageBuilds }
}

describe('InsightsService.cohorts', () => {
  it('builds the matrix and the База card once for readers asking the same question', async () => {
    const { service, asked, stageBuilds } = cohortService()

    const first = await service.cohorts('UZS', 18)
    const second = await service.cohorts('UZS', 18, { rop: null, includeRops: false })

    expect(asked).toHaveLength(1)
    expect(stageBuilds()).toBe(1)
    expect(second.totalCustomers).toBe(first.totalCustomers)
  })

  it('keeps the currency out of the key — it is applied after the memo', async () => {
    const { service, asked } = cohortService()

    await service.cohorts('UZS', 18)
    await service.cohorts('USD', 18)

    expect(asked).toHaveLength(1)
  })

  it('builds a team cut and the picker list as their own entries, sharing one База build', async () => {
    const { service, asked, stageBuilds } = cohortService()

    await service.cohorts('UZS', 18)
    await service.cohorts('UZS', 18, { rop: 'Sevinch' })
    await service.cohorts('UZS', 3, { includeRops: true })

    expect(asked).toEqual([
      { months: 18, rop: undefined, includeRops: undefined },
      { months: 18, rop: 'Sevinch', includeRops: undefined },
      { months: 3, rop: undefined, includeRops: true },
    ])
    /* The База card is not cut with the matrix, so a cut does not rebuild it. */
    expect(stageBuilds()).toBe(1)
  })

  it('never lets a team NAME share the company view’s entry', async () => {
    /*
      `keyPart(null)` is '-', and `keyPart` hands a string back as it is — so a
      key built that way would have served `?rop=-`'s empty matrix to every
      reader of the company view for ten minutes, or the company's matrix
      under a team's heading.
    */
    const { service, asked } = cohortService()

    const company = await service.cohorts('UZS', 18)
    const dashed = await service.cohorts('UZS', 18, { rop: '-' })

    expect(asked).toHaveLength(2)
    expect(dashed.totalCustomers).not.toBe(company.totalCustomers)
  })
})

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

describe('InsightsService.customerFlow', () => {
  it('serves the page’s five-minute poll from the memo, not from a fresh build', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)

    let flowBuilds = 0
    const repository = {
      customerFlow: async () => {
        flowBuilds += 1
        return emptyFlow()
      },
      sourceRepeatRates: async () => [],
      customerStates: async () => ({ customers: 0, ours: { ACTIVE: 0, AT_RISK: 0, LOST: 0 } }),
    } as unknown as InsightsRepository
    const service = new InsightsService(repository)

    await service.customerFlow('UZS', PERIOD)
    /* Four minutes on: the 60 s memo this replaced had long expired. */
    vi.setSystemTime(NOW.getTime() + 4 * 60_000)
    await service.customerFlow('UZS', PERIOD)

    expect(flowBuilds).toBe(1)
  })
})

function concentrationService() {
  const builds = { customers: 0, bySource: 0, byRegion: 0, repeat: 0 }
  const repository = {
    customerRevenue: async () => {
      builds.customers += 1
      return { revenuesMinor: [], nullCustomerMinor: 0n, totalMinor: 0n }
    },
    revenueBySource: async () => {
      builds.bySource += 1
      return []
    },
    revenueByRegion: async () => {
      builds.byRegion += 1
      return []
    },
    repeatStats: async () => {
      builds.repeat += 1
      return {
        medianDays: null,
        p90Days: null,
        pairsMeasured: builds.repeat,
        cohortSize: 0,
        repurchasedWithin: 0,
        repeatRevenueMinor: 0n,
        totalRevenueMinor: 0n,
        flaggedRevenueMinor: 0n,
      }
    },
  } as unknown as ConcentrationRepository
  return { service: new ConcentrationService(repository), builds }
}

describe('ConcentrationService.concentration', () => {
  it('runs its statements once for the readers of one day’s window', async () => {
    const { service, builds } = concentrationService()

    const first = await service.concentration(PERIOD)
    const second = await service.concentration(
      trailingDays(90, { timeZone: TZ, now: new Date(NOW.getTime() + 3 * 3_600_000) }),
    )

    /* Three hours later is the same Tashkent day, so the same window. */
    expect(builds.customers).toBe(1)
    expect(builds.repeat).toBe(1)
    expect(second.repeat.pairsMeasured).toBe(first.repeat.pairsMeasured)
  })

  it('builds a different window as a different answer', async () => {
    const { service, builds } = concentrationService()

    await service.concentration(PERIOD)
    await service.concentration(trailingDays(30, { timeZone: TZ, now: NOW }))

    expect(builds.customers).toBe(2)
    expect(builds.repeat).toBe(2)
  })
})
