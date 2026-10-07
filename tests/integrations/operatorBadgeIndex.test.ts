import { describe, expect, it } from 'vitest'

import type { RawDeal } from '@/server/integrations/crm/CrmProvider'
import { createSyncHandlers } from '@/server/integrations/crm/sync/handlers'

/*
  WHO SOLD IT, AFTER A HIRE.

  The deals pass resolves the portal's operator snapshot («Malika Karimova
  777») to an employee by the floor badge, through an index of the roster. The
  index was kept for the life of the PROCESS — the worker builds its handlers
  once — so a seller the three-hourly reference pass imported had every order
  written with `operatorEmployeeId` NULL until the next deploy, and the
  readers' COALESCE credited them to whoever owned the deal. The EMPLOYEES pass
  now drops it.
*/
function fakes() {
  const state = {
    roster: [{ id: 'emp-115', fullName: 'Sirojov 115 Davlatbek' }],
    rosterReads: 0,
    writes: [] as { sql: string; params: unknown[] }[],
  }
  const prisma = {
    employee: {
      findMany: async (args?: { where?: unknown }) => {
        // The EMPLOYEES pass asks which of its batch exist; the badge index
        // asks for the whole roster, with no filter.
        if (args?.where) return []
        state.rosterReads += 1
        return state.roster
      },
      upsert: async () => ({}),
    },
    departmentMember: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    pipeline: { findMany: async () => [] },
    deal: { findMany: async () => [] },
    dealOwnerChange: { createMany: async () => ({ count: 0 }) },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      state.writes.push({ sql, params })
      return 1
    },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
  }
  const maps: Record<string, Map<string, string>> = {
    dealStage: new Map([['C6:NEW', 'stage']]),
    employee: new Map([['900', 'backoffice-head']]),
    salesSource: new Map(),
    pipeline: new Map([['6', 'delivery']]),
  }
  const resolver = {
    map: async (entity: string) => maps[entity] ?? new Map(),
    mapFor: async () => new Map(),
    isCached: () => false,
    invalidate: () => {},
    optional: async () => undefined,
  }
  const handlers = createSyncHandlers(prisma as never, 'BITRIX24', resolver as never)
  const of = (entity: string) => handlers.find((h) => h.entity === entity)!
  return { state, deals: of('DEALS'), employees: of('EMPLOYEES') }
}

const deal = (externalId: string, operator: string): RawDeal => ({
  externalId,
  title: externalId,
  amountMinor: 100n,
  currency: 'UZS',
  stageExternalId: 'C6:NEW',
  status: 'OPEN',
  employeeExternalId: '900',
  pipelineExternalId: '6',
  countsAsRevenue: true,
  operatorNameSource: operator,
  createdAtSource: new Date('2026-10-06T08:00:00Z'),
  updatedAtSource: new Date('2026-10-06T09:00:00Z'),
})

/** The `operatorEmployeeId` of the deal row the latest bulk write carried. */
function lastOperator(writes: readonly { sql: string; params: unknown[] }[]): unknown {
  const write = writes.findLast((w) => w.sql.startsWith('INSERT INTO "deal"'))!
  const columns = /INSERT INTO "deal" \(([^)]*)\)/.exec(write.sql)![1]!.split(', ').map((c) => c.replace(/"/g, ''))
  return write.params[columns.indexOf('operatorEmployeeId')]
}

describe('the floor badge index', () => {
  it('credits a seller the reference pass imported to that seller, without a restart', async () => {
    const { state, deals, employees } = fakes()

    await deals.persist([deal('1', 'Davlatbek Sirojov 115')])
    expect(lastOperator(state.writes)).toBe('emp-115')

    // Three hours later the reference pass imports a new seller, badge 777.
    state.roster = [...state.roster, { id: 'emp-777', fullName: 'Karimova 777 Malika' }]
    await employees.persist([{ externalId: '7777', fullName: 'Karimova 777 Malika', isActive: true }])

    await deals.persist([deal('2', 'Malika Karimova 777')])
    expect(lastOperator(state.writes)).toBe('emp-777')
    expect(state.rosterReads).toBe(2)
  })

  it('is still read once for every deals batch between two roster changes', async () => {
    const { state, deals } = fakes()
    await deals.persist([deal('1', 'Davlatbek Sirojov 115')])
    await deals.persist([deal('2', 'Davlatbek Sirojov 115')])
    await deals.persist([deal('3', 'Davlatbek Sirojov 115')])
    expect(state.rosterReads).toBe(1)
  })

  it('stops crediting a badge the moment a second person carries it', async () => {
    const { state, deals, employees } = fakes()
    await deals.persist([deal('1', 'Davlatbek Sirojov 115')])

    // A new hire is badged with a departed seller's number: a collision is
    // nobody's, and the stale index would have kept crediting the departed one.
    state.roster = [...state.roster, { id: 'emp-new-115', fullName: 'Aliyev 115 Jasur' }]
    await employees.persist([{ externalId: '8115', fullName: 'Aliyev 115 Jasur', isActive: true }])

    await deals.persist([deal('2', 'Jasur Aliyev 115')])
    expect(lastOperator(state.writes)).toBeNull()
  })
})
