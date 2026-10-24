import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CohortMatrix, InsightsRepository } from '@/server/repositories/insightsRepository'
import type { StoredCohortAnswer } from '@/server/repositories/cohortSnapshotRepository'

// The worker pass builds a real InsightsRepository, which reads the validated environment at import.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { decodeCohortPayload, encodeCohortPayload } = await import('@/server/repositories/cohortSnapshotRepository')
const { COHORT_REFRESH_MS, COHORT_REFRESH_NIGHT_MS, cohortRefreshEvery, refreshStoredCohorts, storedCohortsBuiltAt } =
  await import('@/server/services/cohortSnapshotRefresh')
const {
  COHORT_SNAPSHOT_MAX_AGE_MS,
  InsightsService,
  STORED_COHORT_KEYS,
  STORED_STAGES_KEY,
  resetCohortCaches,
  storedCohortKey,
} = await import('@/server/services/insightsService')

/**
 * «MIJOZ QAYTISHI» READS THE WORKER'S STORED ANSWERS (2026-10-24).
 *
 * After 8b7b51b6 the matrix answered 200 but cold in 13 s, the Collagen cut
 * in 48 s and Zextra's in 16 s, each holding a screen connection that long.
 * The worker now builds the page's standing questions every half hour and
 * the screen is handed the stored answer — only while it is true (this month,
 * under six hours old); anything else is built live, as before.
 */

const TZ = 'Asia/Tashkent'

beforeEach(() => {
  resetCohortCaches()
})

function matrix(mark: number, currentMonth = '2026-10-01'): CohortMatrix {
  return {
    rows: [
      {
        cohort: '2026-09-01',
        size: mark,
        returned: 1,
        cells: [{ monthsSince: 0, customers: mark, orders: mark, firstReturners: 0, revenueMinor: 123_456_789n }],
      },
    ],
    totals: { customers: mark, returned: 1, firstRevenueMinor: 9_007_199n, laterRevenueMinor: 0n },
    currentMonth,
    rops: [],
  }
}

const STAGES = { groups: [], totalCustomers: 7, workedCustomers: 3 }

function service(stored: Map<string, StoredCohortAnswer>, options: { failRead?: boolean } = {}) {
  const live: unknown[] = []
  let liveStages = 0
  const repository = {
    cohorts: async (o: unknown) => {
      live.push(o)
      return matrix(1000 + live.length)
    },
    retentionStages: async () => {
      liveStages += 1
      return { groups: [], totalCustomers: 100 + liveStages, workedCustomers: 0 }
    },
  } as unknown as InsightsRepository
  const reads: string[] = []
  const reader = {
    read: async (key: string) => {
      reads.push(key)
      if (options.failRead) throw new Error('relation "cohort_snapshot" does not exist')
      return stored.get(key) ?? null
    },
  }
  return {
    service: new InsightsService(repository, { reader, timeZone: TZ }),
    live,
    liveStages: () => liveStages,
    reads,
  }
}

function row(value: unknown, builtAt: Date): StoredCohortAnswer {
  return { payload: encodeCohortPayload(value), builtAt, ms: 1 }
}

describe('the stored payload', () => {
  it('round-trips a matrix exactly, BigInt money as BigInt', () => {
    const original = matrix(5)
    expect(decodeCohortPayload<CohortMatrix>(JSON.parse(JSON.stringify(encodeCohortPayload(original))))).toEqual(original)
  })

  it('keeps every digit past 2^53, where a JSON number would round', () => {
    const original = { totals: { firstRevenueMinor: 9_007_199_254_740_993n }, cells: [{ revenueMinor: 123_456_789_012_345_678n }] }
    const back = decodeCohortPayload<typeof original>(JSON.parse(JSON.stringify(encodeCohortPayload(original))))
    expect(back.totals.firstRevenueMinor).toBe(9_007_199_254_740_993n)
    expect(back.cells[0]!.revenueMinor).toBe(123_456_789_012_345_678n)
  })
})

describe('InsightsService.cohorts over stored answers', () => {
  const NOW = new Date()
  const MONTH = `${new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(NOW).slice(0, 7)}-01`

  it('hands the page its three standing matrices and the База card from the store, building nothing', async () => {
    const stored = new Map([
      [storedCohortKey(null), row(matrix(11, MONTH), NOW)],
      [storedCohortKey('Collagen'), row(matrix(22, MONTH), NOW)],
      [storedCohortKey('Zextra'), row(matrix(33, MONTH), NOW)],
      [STORED_STAGES_KEY, row(STAGES, NOW)],
    ])
    const { service: s, live, liveStages } = service(stored)

    const company = await s.cohorts('UZS', 18)
    const collagen = await s.cohorts('UZS', 18, { brand: 'Collagen' })
    const zextra = await s.cohorts('UZS', 18, { brand: 'Zextra' })

    expect(live).toHaveLength(0)
    expect(liveStages()).toBe(0)
    expect([company.totalCustomers, collagen.totalCustomers, zextra.totalCustomers]).toEqual([11, 22, 33])
  })

  it('builds a question nobody stores live — a team cut, the picker, another span', async () => {
    const stored = new Map([
      [storedCohortKey(null), row(matrix(11, MONTH), NOW)],
      [STORED_STAGES_KEY, row(STAGES, NOW)],
    ])
    const { service: s, live, liveStages, reads } = service(stored)

    await s.cohorts('UZS', 18, { rop: 'Sevinch' })
    await s.cohorts('UZS', 3, { includeRops: true })
    await s.cohorts('UZS', 12)

    expect(live).toHaveLength(3)
    expect(reads.every((key) => key === STORED_STAGES_KEY)).toBe(true)
    /* The База card is not cut with the matrix, so the stored one serves every cut. */
    expect(liveStages()).toBe(0)
  })

  it('builds live when the stored answer is too old, from another month, missing, or unreadable', async () => {
    const old = new Date(NOW.getTime() - COHORT_SNAPSHOT_MAX_AGE_MS - 1)
    const cases = [
      new Map([[storedCohortKey(null), row(matrix(11, MONTH), old)]]),
      new Map<string, StoredCohortAnswer>(),
    ]
    for (const stored of cases) {
      resetCohortCaches()
      const { service: s, live } = service(stored)
      const answer = await s.cohorts('UZS', 18)
      expect(live).toHaveLength(1)
      expect(answer.totalCustomers).toBe(1001)
    }
    resetCohortCaches()
    const failing = service(new Map(), { failRead: true })
    expect((await failing.service.cohorts('UZS', 18)).totalCustomers).toBe(1001)
  })

  it('does not hand out last month\u2019s grid on the 1st, however fresh — its horizon is the month it was built in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T01:00:00+05:00'))
    try {
      const builtLastMonth = new Date('2026-10-31T23:30:00+05:00')
      const builtThisMonth = new Date('2026-11-01T00:30:00+05:00')
      const stale = service(new Map([[storedCohortKey(null), row(matrix(11, '2026-10-01'), builtLastMonth)]]))
      expect((await stale.service.cohorts('UZS', 18)).totalCustomers).toBe(1001)
      resetCohortCaches()
      const fresh = service(new Map([[storedCohortKey(null), row(matrix(11, '2026-11-01'), builtThisMonth)]]))
      expect((await fresh.service.cohorts('UZS', 18)).totalCustomers).toBe(11)
      expect(fresh.live).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a store, builds everything live as it always did', async () => {
    const repository = {
      cohorts: async () => matrix(7),
      retentionStages: async () => STAGES,
    } as unknown as InsightsRepository
    expect((await new InsightsService(repository).cohorts('UZS', 18)).totalCustomers).toBe(7)
  })
})

describe('the worker pass', () => {
  it('is due every half hour of the working day and every three hours of the night', () => {
    expect(cohortRefreshEvery(new Date('2026-10-24T14:00:00+05:00'), TZ)).toBe(COHORT_REFRESH_MS)
    expect(cohortRefreshEvery(new Date('2026-10-24T02:00:00+05:00'), TZ)).toBe(COHORT_REFRESH_NIGHT_MS)
  })

  it('reads the OLDEST stored build, and none while any question is missing', async () => {
    const at = (iso: string) => new Date(iso)
    const prisma = (rows: { key: string; builtAt: Date }[]) =>
      ({ cohortSnapshot: { findMany: async () => rows } }) as never
    const all = STORED_COHORT_KEYS.map((key, i) => ({ key, builtAt: at(`2026-10-24T1${i}:00:00Z`) }))
    expect(await storedCohortsBuiltAt(prisma(all))).toEqual(at('2026-10-24T10:00:00Z'))
    expect(await storedCohortsBuiltAt(prisma(all.slice(1)))).toBeNull()
  })

  it('builds every standing question one at a time, under its own limit, and stores each', async () => {
    let inFlight = 0
    let most = 0
    const limits: string[] = []
    const written = new Map<string, unknown>()
    const query = async (sql: string) => {
      inFlight += 1
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 2))
      inFlight -= 1
      // The matrix's arms and the База card's rows: none, so each folds to an empty answer.
      void sql
      return []
    }
    const prisma = {
      $queryRawUnsafe: query,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $executeRawUnsafe: async (sql: string) => {
            limits.push(sql)
          },
          $queryRawUnsafe: query,
        }),
      cohortSnapshot: {
        upsert: async ({ where, create }: { where: { key: string }; create: { payload: unknown } }) => {
          written.set(where.key, create.payload)
        },
      },
    } as never

    const r = await refreshStoredCohorts({ prisma, stopping: () => false })

    expect(r.failed).toEqual([])
    expect(r.built.map((b) => b.key)).toEqual([...STORED_COHORT_KEYS])
    expect([...written.keys()]).toEqual([...STORED_COHORT_KEYS])
    expect(most).toBe(1)
    expect(limits).toEqual(Array(3).fill('SET LOCAL statement_timeout = 300000'))
  })

  it('keeps going past a question that fails, and stops between questions on shutdown', async () => {
    let asked = 0
    const prisma = {
      $queryRawUnsafe: async () => [],
      $transaction: async () => {
        asked += 1
        if (asked === 2) throw new Error('canceling statement due to statement timeout')
        return []
      },
      cohortSnapshot: { upsert: async () => undefined },
    } as never
    const r = await refreshStoredCohorts({ prisma, stopping: () => false })
    expect(r.failed.map((f) => f.key)).toEqual([storedCohortKey('Collagen')])
    expect(r.built).toHaveLength(STORED_COHORT_KEYS.length - 1)

    const stopped = await refreshStoredCohorts({ prisma, stopping: () => true })
    expect(stopped.built).toHaveLength(0)
  })
})
