import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'

/*
  THE LINE-ITEM READ MUST NOT PASS A REFUSAL OFF AS «NO PRODUCTS».

  `crm.deal.productrows.get` is read fifty deals to a `batch` with `halt: 0`, so
  the portal answers HTTP 200 and buries a refused command in `result_error`.
  The read merged `result.result` alone: a spent basket left those deals with
  no lines, DEAL_ITEMS finished SUCCESS, and — with no watermark — nothing
  asked again until the deal was modified.
*/

const PRODUCT_ROWS = 'crm.deal.productrows.get'

/** Three paid Доставка deals, the way `crm.deal.list` sends them. */
const PAID = ['1001', '1002', '1003'].map((ID) => ({
  ID,
  TITLE: `Order ${ID}`,
  CATEGORY_ID: '6',
  STAGE_ID: 'C6:NEW',
  STAGE_SEMANTIC_ID: 'P',
  ASSIGNED_BY_ID: '5',
  OPPORTUNITY: '150000.00',
  DATE_CREATE: '2026-10-06T10:00:00+03:00',
}))

const LINE = { PRODUCT_ID: '676', PRODUCT_NAME: 'Collagen', QUANTITY: '1', PRICE: '150000.00' }

type Answer = readonly unknown[] | { error: string; error_description?: string } | undefined

/**
 * A portal whose deals walk returns `deals()` and whose product rows answer
 * `rows(dealId, read)` — an array, an error, or `undefined` for a command it
 * left out. `read` counts the product-row batches, from 1. `warnings` is what
 * the provider said it gave up on.
 */
function portal(rows: (dealId: string, read: number) => Answer, deals: () => readonly object[] = () => PAID) {
  const asked: string[][] = []
  const warnings: string[] = []
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const { cmd } = JSON.parse(String(init?.body ?? '{}')) as { cmd?: Record<string, string> }
    // `crm.deal.fields`, the enum labels.
    if (!cmd) return json({ result: {} })
    if (Object.values(cmd)[0]!.startsWith('crm.deal.list')) {
      return json({ result: { result: { c0: deals() }, result_error: {} } })
    }

    const ids = Object.keys(cmd).map((key) => key.slice(1))
    asked.push(ids)
    const result: Record<string, unknown> = {}
    const result_error: Record<string, unknown> = {}
    for (const id of ids) {
      const answer = rows(id, asked.length)
      if (answer === undefined) continue
      if (Array.isArray(answer)) result[`d${id}`] = answer
      else result_error[`d${id}`] = answer
    }
    return json({ result: { result, result_error } })
  }) as unknown as typeof fetch

  const provider = new Bitrix24CrmProvider({
    webhookUrl: 'https://portal/rest/1/tok/',
    fetchImpl,
    maxRetries: 0,
    rateLimitRps: 1000,
    onWarning: (message) => warnings.push(message),
  })
  return { provider, asked, warnings }
}

/** A paid Доставка deal that is not one of `PAID`. */
const paid = (ID: string) => ({ ...PAID[0]!, ID, TITLE: `Order ${ID}` })

describe('reading line items', () => {
  it('reads every paid deal, billed to the method it spends', async () => {
    const { provider, asked } = portal((id) => (id === '1003' ? [] : [LINE, { ...LINE, PRODUCT_ID: '677' }]))
    await provider.fetchDeals()

    const page = await provider.fetchDealItems()

    expect(asked).toEqual([['1001', '1002', '1003']])
    expect(page.items.map((i) => i.externalId)).toEqual(['1001-0', '1001-1', '1002-0', '1002-1'])
    // Answered in full, the deal with no lines left included — the sync may
    // drop whatever else it holds for these three.
    expect(page.dealsRead).toEqual(['1001', '1002', '1003'])
    expect(provider.budget.state(new Date()).byMethod[0]?.method).toBe(PRODUCT_ROWS)
  })

  it('also reads a deal the sync names, though it carries no money', async () => {
    const { provider, asked } = portal(() => [], () => [])
    await provider.fetchDeals()

    const page = await provider.fetchDealItems({ dealExternalIds: ['2001'] })

    expect(asked).toEqual([['2001']])
    expect(page.dealsRead).toEqual(['2001'])
  })

  it('fails on a refused command and holds the method, not the portal', async () => {
    const { provider, asked } = portal((id) =>
      id === '1002'
        ? { error: 'OPERATION_TIME_LIMIT', error_description: 'Method is blocked due to operation time limit.' }
        : [LINE],
    )
    await provider.fetchDeals()

    await expect(provider.fetchDealItems()).rejects.toThrow(/OPERATION_TIME_LIMIT/)
    expect(provider.gate.hold(PRODUCT_ROWS, new Date())).not.toBeNull()
    expect(provider.gate.isOpen()).toBe(false)

    // Held: the next read is refused here and sends nothing.
    await expect(provider.fetchDealItems()).rejects.toThrow()
    expect(asked).toHaveLength(1)
  })

  it('asks again for what a failed read did not settle, on a tick that found nothing new', async () => {
    let quiet = false
    const { provider, asked } = portal(
      (id, read) => (read === 1 && id === '1002' ? undefined : [LINE]),
      () => (quiet ? [] : PAID),
    )
    await provider.fetchDeals()
    await expect(provider.fetchDealItems()).rejects.toThrow(/javobsiz/)

    // The next tick: nothing changed on the portal.
    quiet = true
    await provider.fetchDeals()
    const page = await provider.fetchDealItems()

    expect(asked[1]!.sort()).toEqual(['1001', '1002', '1003'])
    expect(page.items.map((i) => i.dealExternalId).sort()).toEqual(['1001', '1002', '1003'])

    // Settled: a quiet tick after that asks for nothing.
    await provider.fetchDeals()
    expect((await provider.fetchDealItems()).items).toEqual([])
    expect(asked).toHaveLength(2)
  })

  /*
    AN ERROR ABOUT ONE DEAL IS NOT A FAILED READ. A deal deleted between the
    DEALS pass and this read answers «Not found»; failing the read over it
    threw away every other deal's lines — in a one-shot import or resync,
    thousands of them. It is left out of `dealsRead`, so its stored lines are
    neither rewritten nor dropped, and asked about twice more before it is
    given up.
  */
  it('keeps the deals it read when the portal says one is gone, and gives that one up', async () => {
    let quiet = false
    const { provider, asked, warnings } = portal(
      (id) => (id === '1002' ? { error: '', error_description: 'Not found' } : [LINE]),
      () => (quiet ? [] : PAID),
    )
    await provider.fetchDeals()
    const page = await provider.fetchDealItems()

    expect(page.items.map((i) => i.dealExternalId)).toEqual(['1001', '1003'])
    expect(page.dealsRead).toEqual(['1001', '1003'])
    // A fact about one deal, not a refusal: nothing is held or shut.
    expect(provider.gate.hold(PRODUCT_ROWS, new Date())).toBeNull()
    expect(provider.gate.isOpen()).toBe(false)

    // Quiet ticks: the deal is asked about twice more, then given up, once.
    quiet = true
    for (let tick = 0; tick < 3; tick++) {
      await provider.fetchDeals()
      expect((await provider.fetchDealItems()).items).toEqual([])
    }
    expect(asked).toEqual([['1001', '1002', '1003'], ['1002'], ['1002']])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/1002.*Not found/)
  })

  /*
    A COMMAND THE PORTAL NEVER ANSWERS MAY NOT FAIL EVERY READ AFTER IT.
    Owed without a bound, it failed every later read — healthy new orders
    included — and held the worker at its failure backoff until a restart.
  */
  it('gives up a deal the portal never answers, and reads the rest', async () => {
    const walks: (readonly object[])[] = [PAID, [paid('2001')], [paid('2002')], []]
    const { provider, asked, warnings } = portal(
      (id) => (id === '1002' ? undefined : [LINE]),
      () => walks.shift() ?? [],
    )

    await provider.fetchDeals()
    await expect(provider.fetchDealItems()).rejects.toThrow(/javobsiz.*1002/)
    await provider.fetchDeals()
    await expect(provider.fetchDealItems()).rejects.toThrow(/javobsiz.*1002/)

    // Its third miss is its last: the read stops failing and writes the rest.
    await provider.fetchDeals()
    const page = await provider.fetchDealItems()
    expect(page.dealsRead!.slice().sort()).toEqual(['1001', '1003', '2001', '2002'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/1002.*javob yoʻq/)

    // And it is not asked about again.
    await provider.fetchDeals()
    expect((await provider.fetchDealItems()).items).toEqual([])
    expect(asked).toHaveLength(3)
    expect(asked.every((ids) => ids.includes('1002'))).toBe(true)
  })

  it('counts misses in a row: an answer starts them again, even in a read that fails', async () => {
    // 1002 is silent on reads 1, 2 and 4 and answered on read 3, where 1003 is silent.
    const { provider, warnings } = portal((id, read) => {
      if (id === '1002') return read === 3 ? [LINE] : undefined
      if (id === '1003') return read === 3 ? undefined : [LINE]
      return [LINE]
    })
    await provider.fetchDeals()

    for (let read = 1; read <= 4; read++) {
      await expect(provider.fetchDealItems()).rejects.toThrow(/javobsiz/)
    }
    expect(warnings).toEqual([])
  })

  /*
    A REFUSAL IS NOT THE DEAL'S MISS. A read the portal refused for everybody
    leaves each deal's count where it was, so a block cannot hasten giving up
    a deal the portal has merely not answered yet.
  */
  it('counts a refusal against no deal', async () => {
    const overload = { error: 'OVERLOAD_LIMIT', error_description: 'REST API is blocked due to overload' }
    const { provider, warnings } = portal((id, read) =>
      read === 2 ? overload : id === '1002' ? undefined : [LINE],
    )
    await provider.fetchDeals()

    await expect(provider.fetchDealItems()).rejects.toThrow(/javobsiz/) // 1002: its first miss
    await expect(provider.fetchDealItems()).rejects.toThrow(/OVERLOAD_LIMIT/) // nobody's miss
    expect(provider.gate.isOpen()).toBe(true)
    expect(await provider.probe()).toBe(true) // the block lifts

    await expect(provider.fetchDealItems()).rejects.toThrow(/javobsiz/) // its second
    expect(warnings).toEqual([])
    expect((await provider.fetchDealItems()).dealsRead).toEqual(['1001', '1003']) // its last
    expect(warnings).toHaveLength(1)
  })
})
