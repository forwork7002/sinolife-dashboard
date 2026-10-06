import { describe, expect, it } from 'vitest'

import {
  attributeText,
  dealIdOf,
  formatMoscow,
  lineTotalMinor,
  minorOf,
  orderRows,
  parseMoscow,
} from '@/server/integrations/moysklad/moyskladImport'

/** An order as MoySklad answered it on 2026-10-06 (expand=state,project,positions.assortment), trimmed. */
const RAW = {
  id: '667b33a6-c0d6-11f1-0a80-065d00a9c1dd',
  name: 'bx10043',
  code: 'bx1071642',
  moment: '2026-10-05 19:04:00.000',
  updated: '2026-10-05 22:26:44.693',
  applicable: true,
  sum: 160000000,
  payedSum: 0.0,
  shippedSum: 0.0,
  state: { name: 'В пути' },
  project: { name: 'Shohjaxon(ROP)' },
  attributes: [
    { name: 'Логистика', value: { name: 'CARAVAN' } },
    { name: 'Регион', value: { name: 'Хорезм' } },
    { name: 'ID сделки в BX', value: '1071642' },
    { name: 'Продавцы (new)', value: { name: 'Zarnigor Mirzayeva230' } },
  ],
  positions: {
    meta: { size: 2 },
    rows: [
      {
        id: 'p1',
        quantity: 2.0,
        price: 80000000,
        discount: 0.0,
        assortment: { name: 'Collagen Marine Sinolife', externalCode: 'LEcGiRfph3h6SUjE5yxxF3' },
      },
      { id: 'p2', quantity: 1.0, price: 0.0, discount: 0.0, assortment: { name: 'Omega Sinolife 500', externalCode: '-n3II3IBjoS45bviltfkN0' } },
    ],
  },
}

describe('MoySklad dates', () => {
  it('reads Moscow wall-clock time (+03:00) as an instant', () => {
    expect(parseMoscow('2026-10-05 22:26:44.693').toISOString()).toBe('2026-10-05T19:26:44.693Z')
    expect(parseMoscow('2026-10-05 19:04:00').toISOString()).toBe('2026-10-05T16:04:00.000Z')
  })

  it('writes a filter value back in Moscow time', () => {
    expect(formatMoscow(new Date('2026-10-05T19:26:44.693Z'))).toBe('2026-10-05 22:26:44')
  })

  it('refuses a date it does not understand rather than guessing', () => {
    expect(() => parseMoscow('05.10.2026')).toThrow()
  })
})

describe('money', () => {
  it('rounds MoySklad kopecks, never truncates', () => {
    expect(minorOf(260000000.99)).toBe(260000001n)
    expect(minorOf(undefined)).toBe(0n)
  })

  it('takes the discount off the line', () => {
    expect(lineTotalMinor(80000000, 2, 12.5)).toBe(140000000n)
  })
})

describe('the deal id', () => {
  it('prefers the «ID сделки в BX» attribute', () => {
    expect(dealIdOf(RAW)).toBe('1071642')
  })

  it('falls back to the «bx…» code', () => {
    expect(dealIdOf({ code: 'bx531186', attributes: [] })).toBe('531186')
  })

  it('is null when neither names a deal', () => {
    expect(dealIdOf({ code: '00075', attributes: [] })).toBeNull()
  })

  it('reads a reference attribute by its name', () => {
    expect(attributeText(RAW.attributes, 'Продавцы (new)')).toBe('Zarnigor Mirzayeva230')
    expect(attributeText(RAW.attributes, 'Нет такого')).toBeNull()
  })
})

describe('orderRows', () => {
  it('turns one API order into one order row and its positions', () => {
    const { order, items } = orderRows(RAW)
    expect(order).toMatchObject({
      id: RAW.id,
      name: 'bx10043',
      bitrixDealId: '1071642',
      stateName: 'В пути',
      sumMinor: 160000000n,
      sellerName: 'Zarnigor Mirzayeva230',
      projectName: 'Shohjaxon(ROP)',
      logistics: 'CARAVAN',
      region: 'Хорезм',
    })
    expect(order.moment.toISOString()).toBe('2026-10-05T16:04:00.000Z')
    expect(items).toEqual([
      expect.objectContaining({ productCode: 'LEcGiRfph3h6SUjE5yxxF3', quantity: 2, priceMinor: 80000000n, totalMinor: 160000000n }),
      expect.objectContaining({ productCode: '-n3II3IBjoS45bviltfkN0', quantity: 1, totalMinor: 0n }),
    ])
  })
})

/*
  A small MoySklad in memory: the list endpoint with `updated>=` filtering,
  `updated,asc` / `created,asc` ordering, limit and offset, and the by-id GET
  the sweep confirms with. `onRequest` lets a test change the data between
  two pages — the concurrent edit or deletion each fix is about.
*/
import { afterEach, vi } from 'vitest'

import { importMoyskladOrders } from '@/server/integrations/moysklad/moyskladImport'

interface FakeOrder {
  id: string
  updated: string
  created: number
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Distinct Moscow seconds, one per index. */
const at = (i: number) => `2026-10-01 ${pad(Math.floor(i / 3600) % 24)}:${pad(Math.floor(i / 60) % 60)}:${pad(i % 60)}.000`

function fakeMoysklad(orders: FakeOrder[], onRequest: (url: URL, count: number) => void = () => undefined) {
  let count = 0
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input))
    count += 1
    onRequest(url, count)
    const byId = url.pathname.match(/customerorder\/([^/]+)$/)
    if (byId && byId[1] !== 'customerorder') {
      const found = orders.find((o) => o.id === decodeURIComponent(byId[1]!))
      return new Response(found ? JSON.stringify({ id: found.id }) : '{}', { status: found ? 200 : 404 })
    }
    const limit = Number(url.searchParams.get('limit'))
    const offset = Number(url.searchParams.get('offset'))
    const filter = url.searchParams.get('filter')
    const from = filter?.match(/^updated>=(.+)$/)?.[1]
    const byCreated = url.searchParams.get('order') === 'created,asc'
    const list = orders
      .filter((o) => !from || o.updated.slice(0, 19) >= from)
      .sort((a, b) => (byCreated ? a.created - b.created : a.updated.localeCompare(b.updated)))
    const rows = list.slice(offset, offset + limit).map((o) => ({
      id: o.id,
      name: o.id,
      code: `bx${o.created}`,
      moment: o.updated,
      updated: o.updated,
      sum: 100,
      positions: { meta: { size: 0 }, rows: [] },
    }))
    return new Response(JSON.stringify({ meta: { size: list.length }, rows }), { status: 200 })
  })
}

/** Just enough of Prisma for the import: the two tables and the sync row. */
function fakePrisma() {
  const stored = new Map<string, { id: string; updatedAtSource: Date }>()
  const prisma = {
    moyskladOrder: {
      aggregate: async () => ({
        _max: { updatedAtSource: stored.size ? new Date(Math.max(...[...stored.values()].map((o) => o.updatedAtSource.getTime()))) : null },
      }),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) stored.delete(id)
      },
      createMany: async ({ data }: { data: { id: string; updatedAtSource: Date }[] }) => {
        for (const o of data) stored.set(o.id, o)
      },
      findMany: async () => [...stored.values()].map((o) => ({ id: o.id })),
    },
    moyskladOrderItem: { createMany: async () => undefined },
    moyskladSync: { upsert: async () => undefined },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  }
  return { prisma: prisma as never, stored }
}

afterEach(() => vi.unstubAllGlobals())

describe('importMoyskladOrders paging', () => {
  it('loses no order when one already read is edited mid-read', async () => {
    const orders = Array.from({ length: 250 }, (_, i) => ({ id: `o${i}`, updated: at(i + 1), created: i }))
    vi.stubGlobal(
      'fetch',
      fakeMoysklad(orders, (_url, count) => {
        // After the first page, o10 is edited: it jumps to the end of the list.
        if (count === 2) orders.find((o) => o.id === 'o10')!.updated = at(5000)
      }),
    )
    const { prisma, stored } = fakePrisma()
    const r = await importMoyskladOrders(prisma, 'token')
    expect(r.partial).toBe(false)
    expect(stored.size).toBe(250)
  })

  it('steps through a second that holds more than a page', async () => {
    const orders = Array.from({ length: 230 }, (_, i) => ({ id: `s${i}`, updated: at(1), created: i }))
    vi.stubGlobal('fetch', fakeMoysklad(orders))
    const { prisma, stored } = fakePrisma()
    await importMoyskladOrders(prisma, 'token')
    expect(stored.size).toBe(230)
  })

  it('stops at maxPages and the next run carries on', async () => {
    const orders = Array.from({ length: 450 }, (_, i) => ({ id: `o${i}`, updated: at(i + 1), created: i }))
    vi.stubGlobal('fetch', fakeMoysklad(orders))
    const { prisma, stored } = fakePrisma()
    const first = await importMoyskladOrders(prisma, 'token', { maxPages: 2 })
    expect(first.partial).toBe(true)
    // Two pages, the second re-asking from the first's last second: o0 … o198.
    expect(stored.size).toBe(199)
    await importMoyskladOrders(prisma, 'token')
    expect(stored.size).toBe(450)
  })
})

describe('the deletion sweep', () => {
  it('never deletes the live order an offset listing slid past, and deletes the gone one on the next sweep', async () => {
    const orders = Array.from({ length: 1500 }, (_, i) => ({ id: `o${i}`, updated: at(i + 1), created: i }))
    const { prisma, stored } = fakePrisma()
    vi.stubGlobal('fetch', fakeMoysklad(orders))
    await importMoyskladOrders(prisma, 'token')
    expect(stored.size).toBe(1500)

    // o5 is really deleted, after the sweep's first id page listed it — so the
    // second page slides o1000 (alive) past the boundary.
    let sweepPages = 0
    vi.stubGlobal(
      'fetch',
      fakeMoysklad(orders, (url) => {
        if (url.searchParams.get('order') === 'created,asc' && ++sweepPages === 2) {
          orders.splice(
            orders.findIndex((o) => o.id === 'o5'),
            1,
          )
        }
      }),
    )
    const r = await importMoyskladOrders(prisma, 'token', { sweep: true })
    // o1000 was a candidate, MoySklad answered 200 for it, so nothing went.
    expect(r.deleted).toBe(0)
    expect(stored.has('o1000')).toBe(true)

    vi.stubGlobal('fetch', fakeMoysklad(orders))
    const next = await importMoyskladOrders(prisma, 'token', { sweep: true })
    expect(next.deleted).toBe(1)
    expect(stored.has('o5')).toBe(false)
    expect(stored.size).toBe(1499)
  })
})
