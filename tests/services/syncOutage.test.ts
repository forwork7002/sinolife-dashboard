import { describe, expect, it } from 'vitest'

import { AlertsService } from '@/server/services/alertsService'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import type { Principal } from '@/server/auth/rbac'

/**
 * WHAT THE HEADER KNOWS ABOUT AN OUTAGE, BEYOND «SOMETHING FAILED».
 *
 * Two things were missing on 2026-09-15 and both cost hours. The DTO carried
 * `at` — the newest failed tick, which during an outage is always seconds old —
 * so a four-hour block and a four-minute blip were indistinguishable on screen.
 * And the difference between «wait, this clears itself» and «a person must
 * issue a new webhook» lived in a two-element allowlist of Bitrix24 codes
 * inside a React component, which the worker could not reach and the one rule
 * says does not belong there.
 */

const ADMIN = {
  userId: 'u1',
  role: 'ADMIN',
  permissions: new Set(['analytics:read:all']),
  sections: null,
  dataScope: 'ALL',
  employeeId: null,
} as unknown as Principal

const NO_SCOPE = { restrictToEmployeeIds: null }

function serviceWith(
  failure: {
    entity: string
    at: Date
    since: Date
    message: string | null
    entities: number | null
  } | null,
) {
  const reference = {
    findLastSuccessfulSync: async () => new Date('2026-09-15T05:47:39.000Z'),
    findCurrentSyncFailure: async () => failure,
  } as unknown as ReferenceRepository

  const insights = {
    queuePressure: async () => ({ pending: 0, overdue: 0 }),
  } as unknown as InsightsRepository

  return new AlertsService(insights, reference)
}

describe('AlertsDto.syncError', () => {
  it('reports when the outage BEGAN, not when it last ticked', async () => {
    const service = serviceWith({
      entity: 'DEALS',
      entities: 9,
      at: new Date('2026-09-15T10:25:24.000Z'),
      since: new Date('2026-09-15T05:50:17.000Z'),
      message: 'Bitrix24 responded 401 — OVERLOAD_LIMIT: REST API is blocked due to overload.',
    })

    const dto = await service.load(ADMIN, NO_SCOPE, new Date('2026-09-15T10:26:00.000Z'), 'UTC')

    expect(dto.syncError?.since).toBe('2026-09-15T05:50:17.000Z')
    expect(dto.syncError?.at).toBe('2026-09-15T10:25:24.000Z')
  })

  /**
   * A throttle lifts on the portal's clock and the worker's probe ladder picks
   * the sync back up on its own. Nobody needs to be called.
   */
  it('marks a portal throttle as the kind that clears itself', async () => {
    const service = serviceWith({
      entity: 'DEALS',
      entities: 9,
      at: new Date('2026-09-15T06:00:00.000Z'),
      since: new Date('2026-09-15T05:50:00.000Z'),
      message: 'Bitrix24 responded 401 — OVERLOAD_LIMIT: REST API is blocked due to overload.',
    })

    const dto = await service.load(ADMIN, NO_SCOPE, new Date('2026-09-15T06:01:00.000Z'), 'UTC')

    expect(dto.syncError?.kind).toBe('THROTTLE')
    expect(dto.syncError?.code).toBe('OVERLOAD_LIMIT')
  })

  /**
   * THE ONE THAT WENT UNNOTICED FOR HOURS. At 06:10 UTC the administrator
   * deleted the blocked webhook and made a new one, so every call came back
   * `INVALID_CREDENTIALS` — the same HTTP 401, and nothing on the dashboard
   * said it would never clear on its own.
   */
  it('marks a revoked webhook as the kind that needs a person', async () => {
    const service = serviceWith({
      entity: 'CUSTOMERS',
      entities: 3,
      at: new Date('2026-09-15T06:25:24.000Z'),
      since: new Date('2026-09-15T06:10:19.000Z'),
      message:
        'Bitrix24 call "batch" failed after 1 attempt: Bitrix24 responded 401 — INVALID_CREDENTIALS: Invalid request credentials',
    })

    const dto = await service.load(ADMIN, NO_SCOPE, new Date('2026-09-15T06:26:00.000Z'), 'UTC')

    expect(dto.syncError?.kind).toBe('CREDENTIAL')
    expect(dto.syncError?.code).toBe('INVALID_CREDENTIALS')
  })

  it('says nothing at all while the sync is healthy', async () => {
    const dto = await serviceWith(null).load(
      ADMIN,
      NO_SCOPE,
      new Date('2026-09-15T05:48:00.000Z'),
      'UTC',
    )

    expect(dto.syncError).toBeNull()
    expect(dto.syncedAt).toBe('2026-09-15T05:47:39.000Z')
  })

  /**
   * THE CLOCK MUST NOT BE TAKEN DOWN BY THE BELL.
   *
   * These two used to ride one `Promise.all`, so a slow or failing backlog
   * aggregate rejected the whole payload and the endpoint answered
   * INTERNAL_ERROR — which is precisely backwards: the moment the database is
   * under strain is the moment the header most needs to say how stale the
   * numbers are.
   */
  it('still reports freshness when the queue aggregate fails', async () => {
    const reference = {
      findLastSuccessfulSync: async () => new Date('2026-09-15T05:47:39.000Z'),
      findCurrentSyncFailure: async () => null,
    } as unknown as ReferenceRepository

    const insights = {
      queuePressure: async () => {
        throw new Error('statement timeout')
      },
    } as unknown as InsightsRepository

    const dto = await new AlertsService(insights, reference).load(
      ADMIN,
      NO_SCOPE,
      new Date('2026-09-15T05:48:00.000Z'),
      'UTC',
    )

    expect(dto.syncedAt).toBe('2026-09-15T05:47:39.000Z')
    expect(dto.queue).toBeNull()
  })
})
