import { describe, expect, it } from 'vitest'

import type { SyncEntityValue, SyncModeValue, SyncStatusValue } from '@/server/domain/types'
import type { CrmProvider, FetchOptions, Page } from '@/server/integrations/crm/CrmProvider'
import {
  type BatchOutcome,
  type EntitySyncHandler,
  type SyncStore,
  SyncEngine,
  isCleanRun,
  nextWatermark,
} from '@/server/integrations/crm/sync/SyncEngine'

// ---------------------------------------------------------------------------
// In-memory fakes — the engine's seams make a database unnecessary here.
// ---------------------------------------------------------------------------

interface Row {
  externalId: string
  value: string
  updatedAtSource?: Date
}

/** Mimics an upsert on (externalSource, externalId). */
class FakeTable {
  readonly rows = new Map<string, Row>()
  persistCalls = 0

  upsert(batch: readonly Row[]): BatchOutcome {
    this.persistCalls++
    let created = 0
    let updated = 0
    for (const row of batch) {
      if (this.rows.has(row.externalId)) updated++
      else created++
      this.rows.set(row.externalId, row)
    }
    return { created, updated, skipped: 0 }
  }
}

class FakeStore implements SyncStore {
  readonly runs: {
    id: string
    entity: SyncEntityValue
    mode: SyncModeValue
    status?: SyncStatusValue
    recordsRead?: number
    recordsFailed?: number
    errorMessage?: string
  }[] = []

  private readonly cursors = new Map<string, Date>()
  private seq = 0

  async beginRun(input: { provider: string; entity: SyncEntityValue; mode: SyncModeValue }) {
    const run = { id: `run-${++this.seq}`, entity: input.entity, mode: input.mode }
    this.runs.push(run)
    return run
  }

  async finishRun(input: {
    id: string
    status: SyncStatusValue
    recordsRead: number
    recordsCreated: number
    recordsUpdated: number
    recordsSkipped: number
    recordsFailed: number
    errorMessage?: string
  }) {
    const run = this.runs.find((r) => r.id === input.id)!
    Object.assign(run, input)
  }

  async getCursor(provider: string, entity: SyncEntityValue) {
    return this.cursors.get(`${provider}:${entity}`)
  }

  async setCursor(provider: string, entity: SyncEntityValue, watermark: Date) {
    this.cursors.set(`${provider}:${entity}`, watermark)
  }
}

function fakeProvider(capabilities: Record<string, boolean>): CrmProvider {
  const notUsed = () => {
    throw new Error('not used in this test')
  }
  return {
    source: 'DEMO',
    capabilities,
    healthCheck: async () => ({ ok: true, detail: 'fake' }),
    fetchDepartments: notUsed,
    fetchEmployees: notUsed,
    fetchProductCategories: notUsed,
    fetchProducts: notUsed,
    fetchStages: notUsed,
    fetchSources: notUsed,
    fetchCustomers: notUsed,
    fetchDeals: notUsed,
    fetchDealItems: notUsed,
    fetchPayments: notUsed,
  } as unknown as CrmProvider
}

/** Pages a fixed array, honouring cursor and updatedSince like a real provider. */
function makeHandler(
  entity: SyncEntityValue,
  source: readonly Row[],
  table: FakeTable,
  overrides: Partial<EntitySyncHandler<Row>> = {},
): EntitySyncHandler<Row> {
  return {
    entity,
    externalIdOf: (record: Row) => record.externalId,
    async fetch(_provider: CrmProvider, options: FetchOptions): Promise<Page<Row>> {
      const filtered = options.updatedSince
        ? source.filter(
            (r) => r.updatedAtSource && r.updatedAtSource >= options.updatedSince!,
          )
        : source
      const size = options.pageSize ?? 100
      const offset = options.cursor ? Number(options.cursor) : 0
      const items = filtered.slice(offset, offset + size)
      const next = offset + items.length
      return next < filtered.length ? { items, nextCursor: String(next) } : { items }
    },
    async persist(batch: readonly Row[]) {
      return table.upsert(batch)
    },
    ...overrides,
  }
}

const NOW = new Date('2026-08-23T09:00:00.000Z')
const rows = (n: number, prefix = 'r'): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    externalId: `${prefix}-${i + 1}`,
    value: `value-${i + 1}`,
    updatedAtSource: new Date(NOW.getTime() - (n - i) * 60_000),
  }))

function engineWith(
  handlers: EntitySyncHandler[],
  store = new FakeStore(),
  capabilities: Record<string, boolean> = { EMPLOYEES: true, DEALS: true, PAYMENTS: true },
  pageSize = 10,
) {
  return {
    store,
    engine: new SyncEngine({
      provider: fakeProvider(capabilities),
      store,
      handlers,
      pageSize,
      now: () => NOW,
    }),
  }
}

// ---------------------------------------------------------------------------

describe('full sync', () => {
  it('imports every record across all pages', async () => {
    const table = new FakeTable()
    const { engine } = engineWith([makeHandler('EMPLOYEES', rows(35), table)])

    const result = await engine.runEntity('EMPLOYEES', 'FULL')

    expect(result.status).toBe('SUCCESS')
    expect(result.recordsRead).toBe(35)
    expect(result.recordsCreated).toBe(35)
    expect(table.rows.size).toBe(35)
  })

  it('pages rather than pulling everything at once', async () => {
    const table = new FakeTable()
    const { engine } = engineWith([makeHandler('EMPLOYEES', rows(35), table)], undefined, undefined, 10)
    await engine.runEntity('EMPLOYEES', 'FULL')
    // 35 records at 10 per page = 4 batches.
    expect(table.persistCalls).toBe(4)
  })
})

describe('duplicate prevention', () => {
  it('leaves the same state after running twice', async () => {
    // The core idempotence guarantee: a retried sync must not double revenue.
    const table = new FakeTable()
    const source = rows(20)
    const { engine } = engineWith([makeHandler('EMPLOYEES', source, table)])

    const first = await engine.runEntity('EMPLOYEES', 'FULL')
    const second = await engine.runEntity('EMPLOYEES', 'FULL')

    expect(first.recordsCreated).toBe(20)
    expect(second.recordsCreated).toBe(0)
    expect(second.recordsUpdated).toBe(20)
    expect(table.rows.size).toBe(20)
  })

  it('updates changed records in place rather than inserting a copy', async () => {
    const table = new FakeTable()
    const source: Row[] = [{ externalId: 'r-1', value: 'before' }]
    const { engine } = engineWith([makeHandler('EMPLOYEES', source, table)])

    await engine.runEntity('EMPLOYEES', 'FULL')
    source[0]!.value = 'after'
    await engine.runEntity('EMPLOYEES', 'FULL')

    expect(table.rows.size).toBe(1)
    expect(table.rows.get('r-1')!.value).toBe('after')
  })
})

describe('incremental sync', () => {
  it('reads everything on the first incremental run, then only changes', async () => {
    const table = new FakeTable()
    const source = rows(10)
    const { engine } = engineWith([makeHandler('EMPLOYEES', source, table)])

    const first = await engine.runEntity('EMPLOYEES', 'INCREMENTAL')
    expect(first.recordsRead).toBe(10)

    // Nothing has changed since the watermark was set.
    const second = await engine.runEntity('EMPLOYEES', 'INCREMENTAL')
    expect(second.recordsRead).toBe(0)
  })

  it('picks up records modified after the watermark', async () => {
    const table = new FakeTable()
    const source = rows(5)
    const { engine } = engineWith([makeHandler('EMPLOYEES', source, table)])

    await engine.runEntity('EMPLOYEES', 'INCREMENTAL')

    source.push({
      externalId: 'r-new',
      value: 'fresh',
      updatedAtSource: new Date(NOW.getTime() + 60_000),
    })

    const second = await engine.runEntity('EMPLOYEES', 'INCREMENTAL')
    expect(second.recordsRead).toBe(1)
    expect(table.rows.has('r-new')).toBe(true)
  })

  it('ignores the watermark for a FULL run', async () => {
    const table = new FakeTable()
    const { store, engine } = engineWith([makeHandler('EMPLOYEES', rows(6), table)])

    await engine.runEntity('EMPLOYEES', 'INCREMENTAL')
    expect(await store.getCursor('DEMO', 'EMPLOYEES')).toBeDefined()

    const full = await engine.runEntity('EMPLOYEES', 'FULL')
    expect(full.recordsRead).toBe(6)
  })

  it('does not advance the watermark when records were lost', async () => {
    // Advancing past a failure would skip that record forever.
    const table = new FakeTable()
    const handler = makeHandler('EMPLOYEES', rows(3), table, {
      async persist(batch) {
        if (batch.length > 1) throw new Error('batch write failed')
        if (batch[0]!.externalId === 'r-2') throw new Error('bad record')
        return table.upsert(batch)
      },
    })
    const { store, engine } = engineWith([handler])

    const result = await engine.runEntity('EMPLOYEES', 'INCREMENTAL')

    expect(result.status).toBe('PARTIAL')
    expect(await store.getCursor('DEMO', 'EMPLOYEES')).toBeUndefined()
  })

  it('advances the watermark past records that were deliberately skipped', async () => {
    /**
     * A skip is not a loss.
     *
     * Stage history always skips a couple of thousand transitions belonging to
     * deals outside the imported pipelines, or naming stages the portal has
     * since deleted. They never resolve. Treating that as a reason to hold the
     * watermark made every incremental run re-read all 191 000 rows — ninety
     * seconds, every minute, to change nothing.
     */
    const table = new FakeTable()
    const handler = makeHandler('EMPLOYEES', rows(3), table, {
      async persist(batch) {
        const kept = batch.filter((row) => row.externalId !== 'r-2')
        const outcome = table.upsert(kept)
        return { ...outcome, skipped: batch.length - kept.length }
      },
    })
    const { store, engine } = engineWith([handler])

    const result = await engine.runEntity('EMPLOYEES', 'INCREMENTAL')

    expect(result.recordsSkipped).toBe(1)
    expect(result.recordsFailed).toBe(0)
    // Still reported as PARTIAL — the gap stays visible in the sync log.
    expect(result.status).toBe('PARTIAL')
    expect(await store.getCursor('DEMO', 'EMPLOYEES')).toBeDefined()
  })
})

describe('failure isolation', () => {
  it('isolates a bad record and still imports the rest', async () => {
    const table = new FakeTable()
    const handler = makeHandler('EMPLOYEES', rows(5), table, {
      async persist(batch) {
        if (batch.length > 1) throw new Error('batch write failed')
        if (batch[0]!.externalId === 'r-3') throw new Error('constraint violation')
        return table.upsert(batch)
      },
    })
    const { engine } = engineWith([handler])

    const result = await engine.runEntity('EMPLOYEES', 'FULL')

    expect(result.recordsFailed).toBe(1)
    expect(result.recordsCreated).toBe(4)
    expect(table.rows.size).toBe(4)
  })

  it('reports PARTIAL, never SUCCESS, when anything was lost', async () => {
    const table = new FakeTable()
    const handler = makeHandler('EMPLOYEES', rows(3), table, {
      async persist(batch) {
        if (batch.length > 1) throw new Error('batch failed')
        if (batch[0]!.externalId === 'r-1') throw new Error('rejected')
        return table.upsert(batch)
      },
    })
    const { engine } = engineWith([handler])

    expect((await engine.runEntity('EMPLOYEES', 'FULL')).status).toBe('PARTIAL')
  })

  it('records a fetch failure as FAILED without throwing', async () => {
    const table = new FakeTable()
    const handler = makeHandler('EMPLOYEES', rows(3), table, {
      async fetch() {
        throw new Error('Bitrix24 unreachable')
      },
    })
    const { engine } = engineWith([handler])

    const result = await engine.runEntity('EMPLOYEES', 'FULL')
    expect(result.status).toBe('FAILED')
    expect(result.errorMessage).toContain('unreachable')
  })

  it('only falls back to per-record writes when the batch fails', async () => {
    const table = new FakeTable()
    const { engine } = engineWith([makeHandler('EMPLOYEES', rows(20), table)], undefined, undefined, 20)
    await engine.runEntity('EMPLOYEES', 'FULL')
    expect(table.persistCalls).toBe(1)
  })
})

describe('upstream deletions', () => {
  /** A handler whose sweep removes rows the source no longer reports. */
  function sweepingHandler(source: Row[], table: FakeTable, deleted: string[]) {
    return makeHandler('EMPLOYEES', source, table, {
      async deleteMissing(seen) {
        const gone = [...table.rows.keys()].filter((id) => !seen.has(id))
        for (const id of gone) {
          table.rows.delete(id)
          deleted.push(id)
        }
        return gone.length
      },
    })
  }

  it('removes rows whose source record has disappeared', async () => {
    // Without this, a deal deleted upstream lingers in every total forever.
    const table = new FakeTable()
    const source = rows(5)
    const deleted: string[] = []
    const { engine } = engineWith([sweepingHandler(source, table, deleted)])

    await engine.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })
    expect(table.rows.size).toBe(5)

    source.splice(2, 1) // r-3 vanishes upstream
    const result = await engine.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })

    expect(result.recordsDeleted).toBe(1)
    expect(deleted).toEqual(['r-3'])
    expect(table.rows.size).toBe(4)
  })

  it('does NOT sweep when sweeping was not requested', async () => {
    const table = new FakeTable()
    const source = rows(4)
    const deleted: string[] = []
    const { engine } = engineWith([sweepingHandler(source, table, deleted)])

    await engine.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })
    source.splice(0, 1)
    const result = await engine.runEntity('EMPLOYEES', 'FULL')

    expect(result.recordsDeleted).toBe(0)
    expect(table.rows.size).toBe(4)
  })

  it('does NOT sweep on an incremental run', async () => {
    // An incremental read only returns CHANGED records, so "not seen" says
    // nothing about whether a row still exists upstream. Sweeping on that
    // basis would delete almost the entire table.
    const table = new FakeTable()
    const source = rows(6)
    const deleted: string[] = []
    const { engine } = engineWith([sweepingHandler(source, table, deleted)])

    await engine.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })
    const result = await engine.runEntity('EMPLOYEES', 'INCREMENTAL', { sweepDeleted: true })

    expect(result.recordsDeleted).toBe(0)
    expect(table.rows.size).toBe(6)
  })

  it('does NOT sweep after a failed fetch', async () => {
    // The dangerous case: a transient network error yields a short read, and
    // deleting on that basis destroys live data.
    const table = new FakeTable()
    const source = rows(5)
    const deleted: string[] = []
    const { engine } = engineWith([sweepingHandler(source, table, deleted)])

    await engine.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })

    const broken = makeHandler('EMPLOYEES', source, table, {
      async fetch() {
        throw new Error('network blip')
      },
      async deleteMissing(seen) {
        const gone = [...table.rows.keys()].filter((id) => !seen.has(id))
        for (const id of gone) table.rows.delete(id)
        return gone.length
      },
    })
    const { engine: failing } = engineWith([broken])

    const result = await failing.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })

    expect(result.status).toBe('FAILED')
    expect(result.recordsDeleted).toBe(0)
    expect(table.rows.size).toBe(5)
  })

  it('does NOT sweep after a PARTIAL run', async () => {
    const table = new FakeTable()
    const source = rows(4)
    const { engine } = engineWith([
      makeHandler('EMPLOYEES', source, table, {
        async persist(batch) {
          if (batch.length > 1) throw new Error('batch failed')
          if (batch[0]!.externalId === 'r-2') throw new Error('rejected')
          return table.upsert(batch)
        },
        async deleteMissing() {
          throw new Error('sweep must not run after a PARTIAL result')
        },
      }),
    ])

    const result = await engine.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })
    expect(result.status).toBe('PARTIAL')
    expect(result.recordsDeleted).toBe(0)
  })

  it('tolerates a handler with no sweep implementation', async () => {
    const table = new FakeTable()
    const { engine } = engineWith([makeHandler('EMPLOYEES', rows(3), table)])
    const result = await engine.runEntity('EMPLOYEES', 'FULL', { sweepDeleted: true })
    expect(result.status).toBe('SUCCESS')
    expect(result.recordsDeleted).toBe(0)
  })
})

describe('capabilities', () => {
  it('skips an entity the provider cannot supply, without failing the run', async () => {
    const table = new FakeTable()
    const { engine } = engineWith(
      [makeHandler('PAYMENTS', rows(5), table)],
      undefined,
      { PAYMENTS: false },
    )

    const result = await engine.runEntity('PAYMENTS', 'FULL')

    expect(result.skippedUnsupported).toBe(true)
    expect(result.status).toBe('SUCCESS')
    expect(result.recordsRead).toBe(0)
    expect(table.rows.size).toBe(0)
  })

  it('skips an entity with no registered handler', async () => {
    const { engine } = engineWith([])
    const result = await engine.runEntity('DEALS', 'FULL')
    expect(result.skippedUnsupported).toBe(true)
  })
})

describe('audit logging', () => {
  it('opens and closes a log row for every run', async () => {
    const table = new FakeTable()
    const { store, engine } = engineWith([makeHandler('EMPLOYEES', rows(4), table)])

    await engine.runEntity('EMPLOYEES', 'FULL')

    expect(store.runs).toHaveLength(1)
    expect(store.runs[0]!.status).toBe('SUCCESS')
    expect(store.runs[0]!.recordsRead).toBe(4)
  })

  it('records the failure reason', async () => {
    const table = new FakeTable()
    const handler = makeHandler('EMPLOYEES', rows(1), table, {
      async fetch() {
        throw new Error('portal blocked')
      },
    })
    const { store, engine } = engineWith([handler])

    await engine.runEntity('EMPLOYEES', 'FULL')
    expect(store.runs[0]!.errorMessage).toContain('portal blocked')
  })

  it('does not open a log row for a skipped entity', async () => {
    const { store, engine } = engineWith([], undefined, {})
    await engine.runEntity('DEALS', 'FULL')
    expect(store.runs).toHaveLength(0)
  })
})

describe('runAll', () => {
  it('runs entities sequentially in the order given', async () => {
    const order: SyncEntityValue[] = []
    const table = new FakeTable()

    const track = (entity: SyncEntityValue) =>
      makeHandler(entity, rows(2, entity), table, {
        async persist(batch) {
          order.push(entity)
          return table.upsert(batch)
        },
      })

    const { engine } = engineWith([track('EMPLOYEES'), track('DEALS')])
    const results = await engine.runAll(['EMPLOYEES', 'DEALS'], 'FULL')

    expect(order).toEqual(['EMPLOYEES', 'DEALS'])
    expect(results).toHaveLength(2)
    expect(isCleanRun(results)).toBe(true)
  })

  it('continues past a failing entity', async () => {
    const table = new FakeTable()
    const broken = makeHandler('EMPLOYEES', rows(1), table, {
      async fetch() {
        throw new Error('boom')
      },
    })
    const { engine } = engineWith([broken, makeHandler('DEALS', rows(3), table)])

    const results = await engine.runAll(['EMPLOYEES', 'DEALS'], 'FULL')

    expect(results[0]!.status).toBe('FAILED')
    expect(results[1]!.status).toBe('SUCCESS')
    expect(isCleanRun(results)).toBe(false)
  })
})

// ---------------------------------------------------------------------------

/**
 * A SKIP CAN BE TRANSIENT, AND ONE KIND OF IT COST THE CONFIRMATION BOARD
 * ORDERS.
 *
 * The hot entities run in sequence inside one tick, each capturing its own
 * start time. A deal created between the DEALS read and the STAGE_HISTORY read
 * is not in the database yet while its arrival in `C4:NEW` is already in the
 * portal's history — so that row is skipped for an unresolvable deal, the
 * watermark advances past it, and `>CREATED_TIME` means it is never offered
 * again. The deal lands a minute later with its later transitions and no
 * arrival: the order is simply not on the board, and no count anywhere says so.
 *
 * Production, 2026-09-03: portal 44 orders, the client's own bot board 44,
 * this database 43. Deal 935632 — arrival 11:28:30, deal row 11:29:39.
 */
describe('watermark after a run that skipped records', () => {
  it('rewinds far enough for the skipped record to be offered again', () => {
    // Stage history waits on a deal that lands in the very next tick.
    expect(nextWatermark('STAGE_HISTORY', NOW, 1).getTime()).toBe(NOW.getTime() - 35 * 60_000)
    /*
      Deals wait on reference data instead, which reloads every thirty TICKS —
      and a tick has no ceiling, so the window has to allow for slow ones. It
      is affordable because it almost never fires: over five hours of
      production DEALS skipped on none of its 293 runs.
    */
    expect(nextWatermark('DEALS', NOW, 1).getTime()).toBe(NOW.getTime() - 95 * 60_000)
  })

  it('does not rewind a clean run, so the common case is unchanged', () => {
    expect(nextWatermark('STAGE_HISTORY', NOW, 0)).toEqual(NOW)
  })

  it('leaves entities that cannot lose the race exactly where they were', () => {
    // DEAL_ITEMS reads the state the DEALS pass left in this process rather
    // than a watermark, and CALLS links its deal optionally instead of
    // skipping. Rewinding either would be cost with nothing to buy.
    for (const entity of ['EMPLOYEES', 'CUSTOMERS', 'DEAL_ITEMS', 'CALLS'] as const) {
      expect(nextWatermark(entity, NOW, 5)).toEqual(NOW)
    }
  })

  it('always moves forward, however many runs keep skipping', () => {
    // The value is derived from THIS run's start, never from the stored
    // cursor, so it cannot creep backwards or stall — which is what blocking
    // the watermark on skips did, leaving 191 000 transitions re-read a minute.
    const later = new Date(NOW.getTime() + 60_000)
    expect(nextWatermark('STAGE_HISTORY', later, 3).getTime()).toBeGreaterThan(
      nextWatermark('STAGE_HISTORY', NOW, 3).getTime(),
    )
  })

  it('re-reads a record whose foreign key resolved a tick later', async () => {
    const history = rows(3, 'h')
    const table = new FakeTable()

    // Stands in for the deal that has not been imported yet: 'h-1' cannot be
    // written on the first run and can be on the second.
    let dealArrived = false

    const handler = makeHandler('STAGE_HISTORY', history, table, {
      async persist(batch: readonly Row[]) {
        const writable = batch.filter((r) => dealArrived || r.externalId !== 'h-1')
        const outcome = table.upsert(writable)
        return { ...outcome, skipped: batch.length - writable.length }
      },
    })

    const { engine, store } = engineWith([handler], new FakeStore(), { STAGE_HISTORY: true })

    const first = await engine.runEntity('STAGE_HISTORY', 'INCREMENTAL')
    expect(first.recordsSkipped).toBe(1)
    expect(first.status).toBe('PARTIAL')
    expect(table.rows.has('h-1')).toBe(false)

    // The deal lands in the next tick's DEALS pass.
    dealArrived = true

    await engine.runEntity('STAGE_HISTORY', 'INCREMENTAL')

    // THE POINT: the arrival is on the board, without a full re-read of the
    // history table and without the watermark ever standing still.
    expect(table.rows.has('h-1')).toBe(true)
    expect((await store.getCursor('DEMO', 'STAGE_HISTORY'))!.getTime()).toBe(NOW.getTime())
  })
})
