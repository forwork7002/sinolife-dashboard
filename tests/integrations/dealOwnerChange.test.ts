import { describe, expect, it } from 'vitest'

import type { RawDeal } from '@/server/integrations/crm/CrmProvider'
import { createSyncHandlers, ownerChangesOf } from '@/server/integrations/crm/sync/handlers'

/*
  «Безквал» (2026-10-06): the portal returns no «Ответственный» history over
  REST, so the deals pass records each owner change it sees.
*/
describe('ownerChangesOf', () => {
  const employees = new Map([
    ['10', 'doniyor'],
    ['7010', 'azizbek'],
    ['7034', 'mohigul'],
  ])
  const before = [
    { id: 'd1', externalId: '1', employeeId: 'doniyor' },
    { id: 'd2', externalId: '2', employeeId: 'azizbek' },
    { id: 'd3', externalId: '3', employeeId: 'azizbek' },
  ]
  const at = new Date('2026-10-06T10:00:00Z')
  const now = new Date('2026-10-06T10:05:00Z')

  it('records a stored deal whose owner now resolves to someone else, at the portal\'s DATE_MODIFY', () => {
    const changes = ownerChangesOf(before, [{ externalId: '1', employeeExternalId: '7010', updatedAtSource: at }], employees, now)
    expect(changes).toEqual([{ dealId: 'd1', fromEmployeeId: 'doniyor', toEmployeeId: 'azizbek', changedAt: at }])
  })

  it('records nothing for an unchanged owner, a new deal or an owner it cannot resolve', () => {
    const changes = ownerChangesOf(
      before,
      [
        { externalId: '2', employeeExternalId: '7010', updatedAtSource: at },
        { externalId: '9', employeeExternalId: '7034', updatedAtSource: at },
        { externalId: '3', employeeExternalId: '999', updatedAtSource: at },
      ],
      employees,
      now,
    )
    expect(changes).toEqual([])
  })

  it('falls back to the read time when the portal sends no DATE_MODIFY', () => {
    const [change] = ownerChangesOf(before, [{ externalId: '3', employeeExternalId: '7034' }], employees, now)
    expect(change).toMatchObject({ dealId: 'd3', fromEmployeeId: 'azizbek', toEmployeeId: 'mohigul', changedAt: now })
  })
})

describe('the deals pass', () => {
  function fakes(stored: { id: string; externalId: string; employeeId: string }[], failUpsert = false) {
    const calls: string[] = []
    const changes: unknown[] = []
    const prisma = {
      employee: { findMany: async () => [] },
      pipeline: { findMany: async () => [{ id: 'reg' }] },
      deal: { findMany: async () => stored },
      dealOwnerChange: {
        createMany: async ({ data }: { data: unknown[] }) => {
          calls.push('changes')
          changes.push(...data)
          return { count: data.length }
        },
      },
      $executeRawUnsafe: async () => {
        calls.push('upsert')
        if (failUpsert) throw new Error('upsert failed')
        return 1
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        calls.push('begin')
        return fn(prisma)
      },
    }
    const maps: Record<string, Map<string, string>> = {
      dealStage: new Map([['NEW', 'stage']]),
      employee: new Map([['10', 'doniyor'], ['7010', 'azizbek']]),
      salesSource: new Map(),
      pipeline: new Map([['0', 'reg'], ['12', 'primary']]),
    }
    const resolver = { map: async (e: string) => maps[e], mapFor: async () => new Map(), isCached: () => false }
    const deals = createSyncHandlers(prisma as never, 'BITRIX24', resolver as never).find((h) => h.entity === 'DEALS')!
    return { deals, calls, changes }
  }
  const deal = (externalId: string, owner: string, pipeline: string, stage = 'NEW'): RawDeal => ({
    externalId,
    title: externalId,
    amountMinor: 0n,
    currency: 'UZS',
    stageExternalId: stage,
    status: 'OPEN',
    employeeExternalId: owner,
    pipelineExternalId: pipeline,
    countsAsRevenue: false,
    createdAtSource: new Date('2026-10-06T08:00:00Z'),
    updatedAtSource: new Date('2026-10-06T09:00:00Z'),
  })

  it('records a Регистрация hand-over in the same transaction, after the write', async () => {
    const { deals, calls, changes } = fakes([{ id: 'd1', externalId: '1', employeeId: 'doniyor' }])
    await deals.persist([deal('1', '7010', '0')])
    expect(calls).toEqual(['begin', 'upsert', 'changes'])
    expect(changes).toEqual([
      { dealId: 'd1', fromEmployeeId: 'doniyor', toEmployeeId: 'azizbek', changedAt: new Date('2026-10-06T09:00:00Z') },
    ])
  })

  it('keeps no history outside Регистрация, and none for a deal the write skipped', async () => {
    const { deals, changes } = fakes([
      { id: 'd1', externalId: '1', employeeId: 'doniyor' },
      { id: 'd2', externalId: '2', employeeId: 'doniyor' },
    ])
    await deals.persist([deal('1', '7010', '12'), deal('2', '7010', '0', 'UNKNOWN')])
    expect(changes).toEqual([])
  })

  it('records nothing when the write fails', async () => {
    const { deals, calls } = fakes([{ id: 'd1', externalId: '1', employeeId: 'doniyor' }], true)
    await expect(deals.persist([deal('1', '7010', '0')])).rejects.toThrow('upsert failed')
    expect(calls).not.toContain('changes')
  })
})
