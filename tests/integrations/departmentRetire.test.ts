import { describe, expect, it } from 'vitest'

import type { CrmProvider, RawDepartment } from '@/server/integrations/crm/CrmProvider'
import { createSyncHandlers, retireLimit } from '@/server/integrations/crm/sync/handlers'
import { SyncEngine, type SyncStore } from '@/server/integrations/crm/sync/SyncEngine'

/*
  A UNIT DELETED IN BITRIX24 LEAVES THE ORG CHART.

  The DEPARTMENTS pass only ever upserted what `department.get` returned and
  nothing set `isActive` false, so a disbanded ROP unit kept its card on
  /structure, its place in RNP's ROP list and its head — every `isActive`
  filter downstream was a no-op. It is now retired: deactivated with its head
  cleared, never deleted, since employees, members and deals reference it.
*/

interface Unit {
  id: string
  externalId: string
  name: string
  isActive: boolean
  parentId: string | null
  headId: string | null
}

type Where = {
  id?: string | { in: string[] }
  externalId?: string | { in?: string[]; notIn?: string[] }
  isActive?: boolean
  parentId?: { not: null }
}

/** `department`, in memory, for the handful of `where` shapes the pass uses. */
function database(units: Unit[]) {
  const rows = new Map(units.map((u) => [u.id, { ...u }]))
  const matches = (u: Unit, where: Where = {}) => {
    if (typeof where.id === 'string' && u.id !== where.id) return false
    if (typeof where.id === 'object' && !where.id.in.includes(u.id)) return false
    if (typeof where.externalId === 'string' && u.externalId !== where.externalId) return false
    if (typeof where.externalId === 'object') {
      if (where.externalId.in && !where.externalId.in.includes(u.externalId)) return false
      if (where.externalId.notIn && where.externalId.notIn.includes(u.externalId)) return false
    }
    if (where.isActive !== undefined && u.isActive !== where.isActive) return false
    if (where.parentId && u.parentId === null) return false
    return true
  }
  const select = ({ where }: { where?: Where }) => [...rows.values()].filter((u) => matches(u, where))
  const department = {
    findMany: async (args: { where?: Where }) => select(args).map((u) => ({ ...u })),
    count: async (args: { where?: Where }) => select(args).length,
    upsert: async (args: {
      where: { externalSource_externalId: { externalId: string } }
      create: Partial<Unit>
      update: Partial<Unit>
    }) => {
      const externalId = args.where.externalSource_externalId.externalId
      const found = [...rows.values()].find((u) => u.externalId === externalId)
      if (found) Object.assign(found, args.update)
      else rows.set(`dep-${externalId}`, { id: `dep-${externalId}`, parentId: null, headId: null, ...args.create } as Unit)
      return {}
    },
    update: async (args: { where: { id: string }; data: Partial<Unit> }) => {
      Object.assign(rows.get(args.where.id)!, args.data)
      return {}
    },
    updateMany: async (args: { where: Where; data: Partial<Unit> }) => {
      const hit = select(args)
      for (const u of hit) Object.assign(u, args.data)
      return { count: hit.length }
    },
  }
  const resolver = {
    invalidate: () => {},
    optional: async (_entity: string, externalId?: string) =>
      [...rows.values()].find((u) => u.externalId === externalId)?.id,
  }
  return { rows, prisma: { department }, resolver }
}

const unit = (externalId: string, overrides: Partial<Unit> = {}): Unit => ({
  id: `dep-${externalId}`,
  externalId,
  name: `Unit ${externalId}`,
  isActive: true,
  parentId: null,
  headId: null,
  ...overrides,
})

const raw = (externalId: string, parentExternalId?: string): RawDepartment => ({
  externalId,
  name: `Unit ${externalId}`,
  isActive: true,
  ...(parentExternalId ? { parentExternalId } : {}),
})

const store: SyncStore = {
  beginRun: async ({ entity, mode }) => ({ id: 'run', entity, mode }),
  finishRun: async () => {},
  getCursor: async () => undefined,
  setCursor: async () => {},
}

/** One DEPARTMENTS run through the real engine, the portal answering `answer`. */
async function pass(db: ReturnType<typeof database>, answer: RawDepartment[]) {
  const handlers = createSyncHandlers(db.prisma as never, 'BITRIX24', db.resolver as never)
  const provider = {
    source: 'BITRIX24',
    capabilities: { DEPARTMENTS: true },
    fetchDepartments: async () => ({ items: answer }),
  } as unknown as CrmProvider
  return new SyncEngine({ provider, store, handlers }).runEntity('DEPARTMENTS', 'INCREMENTAL')
}

describe('a unit the portal no longer returns', () => {
  it('is retired — deactivated, its head cleared — and kept as a row', async () => {
    const db = database([unit('1'), unit('2', { parentId: 'dep-1' }), unit('3', { parentId: 'dep-1', headId: 'emp-husniddin' })])

    const r = await pass(db, [raw('1'), raw('2', '1')])

    expect(r.status).toBe('SUCCESS')
    expect(db.rows.get('dep-3')).toMatchObject({ isActive: false, headId: null })
    expect(db.rows.get('dep-1')!.isActive).toBe(true)
    expect(db.rows.get('dep-2')!.isActive).toBe(true)
  })

  it('is active again the day the portal returns it', async () => {
    const db = database([unit('1'), unit('3', { isActive: false })])
    await pass(db, [raw('1'), raw('3', '1')])
    expect(db.rows.get('dep-3')!.isActive).toBe(true)
  })

  it('is not retired on an empty answer — that is a missing scope, not an empty company', async () => {
    // Two units: small enough that the proportional limit alone would let both go.
    const db = database([unit('1'), unit('2', { parentId: 'dep-1' })])
    const r = await pass(db, [])
    expect([...db.rows.values()].every((u) => u.isActive)).toBe(true)
    expect(r.status).toBe('SUCCESS')
  })

  it('is not retired when most of the tree went missing at once', async () => {
    const db = database(Array.from({ length: 10 }, (_, i) => unit(String(i + 1))))

    const r = await pass(db, [raw('1'), raw('2')])

    expect([...db.rows.values()].every((u) => u.isActive)).toBe(true)
    // Written, then refused: the run says so rather than calling it clean.
    expect(r.status).toBe('PARTIAL')
  })

  it('may be half the active units, never fewer than two', () => {
    expect(retireLimit(1)).toBe(2)
    expect(retireLimit(20)).toBe(10)
  })
})

describe('a unit the portal puts at the top', () => {
  it('loses the parent it used to have', async () => {
    const db = database([unit('1'), unit('2', { parentId: 'dep-1' }), unit('3', { parentId: 'dep-2' })])

    await pass(db, [raw('1'), raw('2', '1'), raw('3')])

    expect(db.rows.get('dep-3')!.parentId).toBeNull()
    expect(db.rows.get('dep-2')!.parentId).toBe('dep-1')
  })

  it('keeps it when the answer names no parent anywhere — that proves nothing', async () => {
    const db = database([unit('1'), unit('2', { parentId: 'dep-1' })])
    await pass(db, [raw('1'), raw('2')])
    expect(db.rows.get('dep-2')!.parentId).toBe('dep-1')
  })
})
