import { describe, expect, it } from 'vitest'

import { applyCrmEvents, type PendingCrmEvent, takeDistinct } from '@/server/integrations/crm/sync/crmEvents'

/**
 * The portal's outgoing events, applied between ticks. The worker deletes
 * whatever the by-id read does not return, so the bookkeeping around that
 * read — what is read, what is written, what is deleted and what is HELD —
 * is what these pin.
 */

type Deal = { id: string; title: string }

let seq = 0
const ev = (event: string, externalId: string): PendingCrmEvent => ({ id: ++seq, event, externalId, receivedAt: new Date() })

function harness(live: readonly string[]) {
  const fetched: string[][] = []
  const persisted: Deal[][] = []
  const deleted: string[][] = []
  return {
    fetched,
    persisted,
    deleted,
    run: (events: PendingCrmEvent[], skipped = 0) =>
      applyCrmEvents<Deal>(
        events,
        async (ids) => {
          fetched.push([...ids])
          return ids.filter((id) => live.includes(id)).map((id) => ({ id, title: `Deal ${id}` }))
        },
        (d) => d.id,
        async (deals) => {
          persisted.push([...deals])
          return { failed: 0, skipped }
        },
        async (ids) => {
          deleted.push([...ids])
          return ids.length
        },
      ),
  }
}

describe('applyCrmEvents', () => {
  it('does nothing with no events', async () => {
    const h = harness(['1'])
    expect(await h.run([])).toEqual({ events: 0, checked: 0, written: 0, skipped: 0, failed: 0, deleted: 0, held: 0 })
    expect(h.fetched).toEqual([])
  })

  it('reads each named deal once and writes what the portal returned', async () => {
    const h = harness(['1', '2'])
    const r = await h.run([ev('ONCRMDEALUPDATE', '1'), ev('ONCRMDEALUPDATE', '1'), ev('ONCRMDEALADD', '2')])
    expect(h.fetched).toEqual([['1', '2']])
    expect(h.persisted).toEqual([[{ id: '1', title: 'Deal 1' }, { id: '2', title: 'Deal 2' }]])
    expect(h.deleted).toEqual([])
    expect(r).toMatchObject({ events: 3, checked: 2, written: 2, deleted: 0, held: 0 })
  })

  it('deletes a deal the portal said it deleted and no longer returns', async () => {
    const h = harness(['1'])
    const r = await h.run([ev('ONCRMDEALDELETE', '9'), ev('ONCRMDEALUPDATE', '1')])
    expect(h.deleted).toEqual([['9']])
    expect(r).toMatchObject({ checked: 2, written: 1, deleted: 1, held: 0 })
  })

  it('keeps a «deleted» deal the portal still returns — the event was stale', async () => {
    const h = harness(['9'])
    const r = await h.run([ev('ONCRMDEALDELETE', '9')])
    expect(h.deleted).toEqual([])
    expect(h.persisted).toEqual([[{ id: '9', title: 'Deal 9' }]])
    expect(r).toMatchObject({ written: 1, deleted: 0 })
  })

  it('deletes an updated deal the portal does not return — gone between the event and the read', async () => {
    const h = harness([])
    const r = await h.run([ev('ONCRMDEALUPDATE', '5')])
    expect(h.deleted).toEqual([['5']])
    expect(r).toMatchObject({ deleted: 1, held: 0 })
  })

  it('HOLDS a flood of unreturned add/update deals, but still deletes the ones the portal said it deleted', async () => {
    const h = harness([])
    const updates = Array.from({ length: 30 }, (_, i) => ev('ONCRMDEALUPDATE', String(100 + i)))
    const r = await h.run([...updates, ev('ONCRMDEALDELETE', '7')])
    // 31 checked → limit 25; 30 unconfirmed gone is past it.
    expect(h.deleted).toEqual([['7']])
    expect(r).toMatchObject({ checked: 31, deleted: 1, held: 30 })
  })

  it('counts what the upsert skipped', async () => {
    const h = harness(['1', '2'])
    const r = await h.run([ev('ONCRMDEALADD', '1'), ev('ONCRMDEALADD', '2')], 1)
    expect(r).toMatchObject({ written: 1, skipped: 1 })
  })

  it('throws, deleting nothing, when the read fails', async () => {
    const deleted: string[][] = []
    await expect(
      applyCrmEvents<Deal>(
        [ev('ONCRMDEALDELETE', '1')],
        async () => {
          throw new Error('portal band')
        },
        (d) => d.id,
        async () => ({ failed: 0, skipped: 0 }),
        async (ids) => {
          deleted.push([...ids])
          return ids.length
        },
      ),
    ).rejects.toThrow('portal band')
    expect(deleted).toEqual([])
  })

  it('counts a rejected deal and finishes — the events are not retried over it', async () => {
    const r = await applyCrmEvents<Deal>(
      [ev('ONCRMDEALUPDATE', '1'), ev('ONCRMDEALUPDATE', '2')],
      async () => [{ id: '1', title: 'x' }, { id: '2', title: 'y' }],
      (d) => d.id,
      async () => ({ failed: 1, skipped: 0 }),
      async () => 0,
    )
    expect(r).toMatchObject({ checked: 2, written: 1, failed: 1, deleted: 0 })
  })
})

describe('confirmedGoneLimit / takeDistinct', () => {
  it('holds a flood of DELETE events too — 100 or 10%, whichever is more', async () => {
    const h = harness([])
    const r = await h.run(Array.from({ length: 101 }, (_, i) => ev('ONCRMDEALDELETE', String(i))))
    expect(h.deleted).toEqual([])
    expect(r).toMatchObject({ checked: 101, deleted: 0, held: 101 })

    const h2 = harness([])
    const r2 = await h2.run(Array.from({ length: 100 }, (_, i) => ev('ONCRMDEALDELETE', String(i))))
    expect(h2.deleted[0]).toHaveLength(100)
    expect(r2).toMatchObject({ deleted: 100, held: 0 })
  })

  it('takes the oldest events up to N distinct deals, keeping every event of a taken deal', () => {
    const events = [ev('ONCRMDEALADD', '1'), ev('ONCRMDEALUPDATE', '2'), ev('ONCRMDEALUPDATE', '1'), ev('ONCRMDEALUPDATE', '3')]
    const taken = takeDistinct(events, 2)
    expect(taken.map((e) => e.externalId)).toEqual(['1', '2', '1'])
    expect(takeDistinct(events, 10)).toHaveLength(4)
    expect(takeDistinct([], 10)).toEqual([])
  })
})
