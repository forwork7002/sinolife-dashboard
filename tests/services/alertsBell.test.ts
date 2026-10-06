import { beforeEach, describe, expect, it } from 'vitest'

import type { Principal, RowScope } from '@/server/auth/rbac'
import type {
  InsightsRepository,
  QueueBacklogRow,
} from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import { AlertsService, resetAlertsQueueCache } from '@/server/services/alertsService'

/**
 * THE BELL IS BUILT ONCE FOR EVERYBODY AND COUNTED FOR EACH READER.
 *
 * The backlog cohort is an all-time build, and the reader's scope is applied
 * only after it — so a memo keyed per scope paid the identical build once per
 * ROP with a tab open, about fourteen times every three minutes on a one-vCPU
 * database. The memo now holds the company's waiting orders and each reader's
 * two numbers are cut from them. These cases pin both halves: one build, and
 * still a different, correctly narrowed answer for every reader — because a
 * shared memo that served one reader's count to another would be the worst
 * thing it could do.
 */

beforeEach(resetAlertsQueueCache)

const NOW = new Date('2026-10-06T10:00:00.000Z')
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

/** Four orders waiting: two on Aziz, one on Lola an hour ago, one on Kamola three hours ago. */
const WAITING: readonly QueueBacklogRow[] = [
  { operatorId: 'aziz', queuedAt: minutesAgo(10) },
  { operatorId: 'aziz', queuedAt: minutesAgo(200) },
  { operatorId: 'lola', queuedAt: minutesAgo(60) },
  { operatorId: 'kamola', queuedAt: minutesAgo(180) },
]

function reader(sections: readonly string[] = ['confirmation']): Principal {
  return {
    userId: 'u',
    role: 'SALES',
    isActive: true,
    employeeId: 'e',
    dataScope: 'TEAM',
    sections,
  } as unknown as Principal
}

/** A service whose repository counts how often the backlog is actually read. */
function counted(rows: readonly QueueBacklogRow[] = WAITING) {
  let builds = 0
  const insights = {
    queueBacklogRows: async () => {
      builds += 1
      return [...rows]
    },
  } as unknown as InsightsRepository
  const reference = {
    findLastSuccessfulSync: async () => new Date('2026-10-06T09:58:00.000Z'),
    findCurrentSyncFailure: async () => null,
  } as unknown as ReferenceRepository

  const service = new AlertsService(insights, reference)
  const bell = async (scope: RowScope, now: Date = NOW, principal: Principal = reader()) =>
    (await service.load(principal, scope, now, 'Asia/Tashkent')).queue

  return { bell, builds: () => builds }
}

describe('the header bell', () => {
  it('reads the backlog once for every reader inside the TTL, whatever their scope', async () => {
    const { bell, builds } = counted()

    await bell({ restrictToEmployeeIds: ['aziz'] })
    await bell({ restrictToEmployeeIds: ['lola', 'kamola'] })
    await bell({ restrictToEmployeeIds: null })

    expect(builds()).toBe(1)
  })

  it('still answers each reader with their own floor', async () => {
    const { bell } = counted()

    expect(await bell({ restrictToEmployeeIds: ['aziz'] })).toEqual({ pending: 2, overdue: 1 })
    expect(await bell({ restrictToEmployeeIds: ['lola', 'kamola'] })).toEqual({
      pending: 2,
      overdue: 1,
    })
    // Null is the whole company — the administrator's bell.
    expect(await bell({ restrictToEmployeeIds: null })).toEqual({ pending: 4, overdue: 2 })
  })

  it('counts nothing for a scope that admits nobody, never the company', async () => {
    const { bell } = counted()

    /*
      An empty list is «nobody» here, as `scopeValue` makes it in SQL. Read as
      "no filter" — which is what `[]` means everywhere a READER chose it — it
      would hand a person scoped to no one the whole company's backlog.
    */
    expect(await bell({ restrictToEmployeeIds: [] })).toEqual({ pending: 0, overdue: 0 })
  })

  it('measures overdue on the reader’s clock, not on the build’s', async () => {
    const { bell, builds } = counted()

    // Lola's order arrived an hour before NOW; the line is two hours.
    expect(await bell({ restrictToEmployeeIds: ['lola'] })).toEqual({ pending: 1, overdue: 0 })

    // It crosses the line an hour later, inside the same memo entry — the
    // memo was built at NOW, and must not freeze the line where it stood then.
    const later = new Date(NOW.getTime() + 61 * 60_000)
    expect(await bell({ restrictToEmployeeIds: ['lola'] }, later)).toEqual({
      pending: 1,
      overdue: 1,
    })
    expect(builds()).toBe(1)
  })

  it('gives an account without the queue no bell, and costs it no read', async () => {
    const { bell, builds } = counted()

    expect(await bell({ restrictToEmployeeIds: null }, NOW, reader(['sales']))).toBeNull()
    expect(builds()).toBe(0)
  })
})
