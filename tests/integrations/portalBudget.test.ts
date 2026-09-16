import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { PortalBudget } from '@/server/integrations/crm/bitrix24/portalBudget'
import { classifyRefusal, SELF_LIMIT_CODE } from '@/server/integrations/crm/bitrix24/refusal'
import { syncErrorCode } from '@/server/services/alertsService'

/**
 * THE TEST THAT EXISTS SO THIS DOES NOT HAPPEN A THIRD TIME.
 *
 * Bitrix24 blocked `obey.bitrix24.kz` portal-wide on 2026-09-14 (four hours)
 * and again on 2026-09-16 11:53, both `OVERLOAD_LIMIT`. Neither was a rate
 * problem — 2 requests a second was true for every second of both — and
 * neither was visible from this side of the wire, because a `batch` is ONE
 * request and up to fifty method invocations and nothing counted the second
 * number.
 *
 * What produced them was VOLUME: ~288 000 invocations a day on the hot path, of
 * which ~277 000 existed only to discover there was nothing left to read. A
 * comment cannot stop that coming back and neither can a constant. This can: it
 * walks a simulated hour of the deployed cadence and counts what the portal
 * would have been asked for. Widen the chain back to a fixed fifty, add a pass
 * nobody costed, or make a walk re-read its window, and the number moves HERE
 * before it moves on the portal.
 */
describe('an idle hour costs the portal almost nothing', () => {
  /** A portal where nothing has changed: every walk runs dry on its first page. */
  function quietPortal() {
    let invocations = 0
    let requests = 0

    const fetchImpl = (async (url: string, init?: RequestInit) => {
      requests += 1
      const body = JSON.parse(String(init?.body ?? '{}')) as { cmd?: Record<string, string> }
      const cmd = body.cmd
      invocations += cmd ? Object.keys(cmd).length : 1

      // `crm.deal.fields` — the enum labels, fetched once per process and cached.
      if (!cmd) {
        return new Response(JSON.stringify({ result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      /*
        One shape answers every walk: `crm.*.list` reads a command as a bare
        array and `crm.stagehistory.list` reads it through `items`. An empty
        array satisfies the first and an object with an empty `items` the
        second, so the mock does not have to know which method it is answering
        — and cannot accidentally let a walk continue that should have ended.
      */
      const nested = url.includes('batch') && String(init?.body ?? '').includes('stagehistory')
      const result = Object.fromEntries(
        Object.keys(cmd).map((key) => [key, nested ? { items: [] } : []]),
      )
      return new Response(JSON.stringify({ result: { result } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const provider = new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl,
      historyPipelines: [6, 4],
      historyStages: ['C12:UC_1OM8B2'],
      // The limiter is not under test and would make this take two minutes of
      // real time: 240 requests at the deployed 2 rps. What is under test is
      // how many invocations those requests carry, which the clock cannot move.
      rateLimitRps: 100_000,
    })

    return { provider, cost: () => ({ requests, invocations }) }
  }

  /** What the worker's HOT list does in one tick when nothing has changed. */
  async function tick(provider: Bitrix24CrmProvider): Promise<void> {
    await provider.fetchCustomers()
    await provider.fetchDeals()
    // Stage history walks two passes behind one cursor, which the sync engine
    // drives to the end inside the tick.
    let cursor: string | undefined
    for (let pass = 0; pass < 4; pass++) {
      const page: { nextCursor?: string } = await provider.fetchStageHistory({ cursor })
      cursor = page.nextCursor
      if (cursor === undefined) break
    }
    await provider.fetchDealItems()
  }

  it('asks for under 800 method invocations in sixty idle ticks', async () => {
    const { provider, cost } = quietPortal()
    for (let minute = 0; minute < 60; minute++) await tick(provider)

    const { requests, invocations } = cost()

    /*
      THE NUMBER THAT MATTERS, AND THE ONE THAT NEVER DID.

      `requests` is a couple of hundred an hour and was a couple of hundred
      before any of this — which is exactly why our own side of the wire never
      saw a problem, and why the support ticket quoted a request rate that was
      true and useless. `invocations` was ~15 000 an hour and is a few hundred.
      If this ever fails upward, read the walk's chain width first.
    */
    /*
      PINNED EXACTLY, NOT BOUNDED. A range would absorb a new pass without
      anybody noticing it was added — and «one more entity, it is only fifty
      commands» is precisely how the old number reached fifteen thousand. Change
      the cadence and this fails; update it deliberately, with the new figure
      measured rather than guessed.

      241 = 4 walks × 60 ticks + 1 `crm.deal.fields` (cached after the first).
      481 = the same walks at CHAIN_MIN 2, plus that one field read.
    */
    expect({ requests, invocations }).toEqual({ requests: 241, invocations: 481 })

    // And the ceiling is nowhere near: an idle hour uses a few percent of it.
    expect(provider.budget.state(new Date()).pct).toBeLessThan(10)
  })

  /**
   * The old shape stated as a NUMBER rather than in prose, so the size of the
   * cut is checkable and the comment above cannot quietly rot away from it.
   */
  it('would have been fifteen thousand at the old fixed chain width', () => {
    const WALKS_PER_TICK = 5
    const OLD_CHAIN = 50
    expect(WALKS_PER_TICK * OLD_CHAIN * 60).toBeGreaterThan(14_000)
  })
})

describe('the rolling-hour ceiling', () => {
  const NOW = new Date('2026-09-16T06:00:00Z')

  it('admits an ordinary hour without slowing anything down', () => {
    const budget = new PortalBudget(15_000)
    for (let minute = 0; minute < 60; minute++) {
      budget.spend('crm.deal.list', 8, new Date(NOW.getTime() + minute * 60_000))
    }
    expect(budget.waitMs(8, new Date(NOW.getTime() + 60 * 60_000))).toBe(0)
  })

  /**
   * Refusing, not queueing. Queueing behind a full window sends the request
   * anyway — only later, and with the worker blocked meanwhile, which is the
   * shape that turned a throttle into a four-hour outage on 2026-09-14.
   */
  it('refuses rather than queues once the window is full', () => {
    const budget = new PortalBudget(100)
    budget.spend('crm.deal.list', 100, NOW)
    expect(budget.waitMs(1, NOW)).toBe(Number.POSITIVE_INFINITY)
  })

  it('paces between the soft rung and the ceiling', () => {
    const budget = new PortalBudget(100)
    budget.spend('crm.deal.list', 90, NOW)
    expect(budget.waitMs(1, NOW)).toBeGreaterThan(0)
  })

  /** Rolling, not fixed: an hour later the window has drained. */
  it('forgets what fell out of the window', () => {
    const budget = new PortalBudget(100)
    budget.spend('crm.deal.list', 100, NOW)
    expect(budget.spent(new Date(NOW.getTime() + 61 * 60_000))).toBe(0)
  })

  /** Attribution, so a trip names the regression instead of merely reporting one. */
  it('names what spent the budget', () => {
    const budget = new PortalBudget(15_000)
    budget.spend('crm.deal.list', 9_000, NOW)
    budget.spend('crm.contact.list', 120, NOW)
    expect(budget.state(NOW).byMethod[0]).toEqual({ method: 'crm.deal.list', invocations: 9_000 })
  })
})

/**
 * A refusal here is OURS, and must not be mistaken for the portal's.
 *
 * Tripping `PortalGate` on it would put the dashboard's freshness chip into
 * «Bitrix24 band» over our own accounting, and send a reader hunting an outage
 * that is not happening.
 */
describe('a budget refusal is ours, not the portal', () => {
  it('fails the call without sending it and without shutting the gate', async () => {
    let sent = 0
    const fetchImpl = (async () => {
      sent += 1
      return new Response(JSON.stringify({ result: { result: { c0: { items: [] } } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const provider = new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl,
      hourlyInvocations: 1,
    })

    await expect(provider.fetchStageHistory()).rejects.toThrow(/soatlik cheklov/)
    expect(sent).toBe(0)
    expect(provider.gate.isOpen()).toBe(false)
  })

  /**
   * THE CODE HAS TO SURVIVE THE MESSAGE, because the message is all that
   * survives.
   *
   * `sync_log` stores text; `syncErrorCode` recovers the code from that text
   * with a regex and the header chip prints what it finds. A code carried only
   * on the error's `code` field reaches an operator as «UNKNOWN» — the one
   * word they cannot act on, and the exact failure the 2026-09-14 incident was
   * about.
   */
  it('carries its code all the way into the header chip', async () => {
    const provider = new Bitrix24CrmProvider({
      webhookUrl: 'https://portal/rest/1/tok/',
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      hourlyInvocations: 1,
    })

    const error = await provider
      .fetchStageHistory()
      .then(() => null)
      .catch((e: unknown) => e as Error)

    expect(error).not.toBeNull()
    expect(syncErrorCode(error!.message)).toBe(SELF_LIMIT_CODE)
  })

  /**
   * And it must NOT be read as a portal refusal. Left to the bare-401 fallback
   * it would classify as `CREDENTIAL`, which shuts `PortalGate` over our own
   * accounting and tells somebody to go and issue a new webhook for a portal
   * that is answering every call.
   */
  it('is not a portal refusal', () => {
    expect(classifyRefusal(`${SELF_LIMIT_CODE}: soatlik cheklov 15000/15000`)).toBeNull()
  })
})
