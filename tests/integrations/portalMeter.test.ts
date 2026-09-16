import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import {
  HARD_FRACTION,
  MEASURED_HARD_S,
  MEASURED_SOFT_S,
  OPERATING_BUDGET_S,
  PortalMeter,
  SOFT_FRACTION,
} from '@/server/integrations/crm/bitrix24/portalMeter'

/**
 * THE NUMBER THE PORTAL BLOCKS ON, READ FROM THE PORTAL.
 *
 * Bitrix24 has been sending `time.operating` and `time.operating_reset_at` on
 * every answer since this integration was written, and `Bitrix24Response` had
 * no field for either — so both were parsed and discarded on every call. Two
 * portal-wide blocks (2026-09-14, four hours; 2026-09-16 11:53) were diagnosed
 * after the fact from `sync_log` row counts, because nothing in the process was
 * watching the one number that was rising.
 *
 * These pin the gauge, not a policy: the thresholds may move, but a reading
 * that is never taken cannot move anything.
 */
describe('portal meter', () => {
  const NOW = new Date('2026-09-16T06:00:00Z')
  const RESET_AT = NOW.getTime() / 1000 + 300

  const at = (operating: number) => ({ operating, operating_reset_at: RESET_AT })

  it('admits a method it has never heard of', () => {
    expect(new PortalMeter().waitMs('crm.deal.list', NOW)).toBe(0)
  })

  it('admits a method whose basket is barely touched', () => {
    const meter = new PortalMeter()
    meter.record('crm.deal.list', at(OPERATING_BUDGET_S * (SOFT_FRACTION - 0.1)), NOW)
    expect(meter.waitMs('crm.deal.list', NOW)).toBe(0)
  })

  /**
   * At the hard rung there is nothing to pace INTO — the basket empties on a
   * clock the portal tells us, so the honest wait is the whole remainder. This
   * is the case that would otherwise be an `OPERATION_TIME_LIMIT`, which is not
   * local: it takes the method away from the portal's own users too.
   */
  it('waits out the whole basket once the method is nearly spent', () => {
    const meter = new PortalMeter()
    meter.record('crm.deal.list', at(OPERATING_BUDGET_S * (HARD_FRACTION + 0.05)), NOW)
    expect(meter.waitMs('crm.deal.list', NOW)).toBe(300_000)
  })

  it('paces, rather than stops, between the two rungs', () => {
    const meter = new PortalMeter()
    meter.record('crm.deal.list', at(OPERATING_BUDGET_S * 0.75), NOW)

    const wait = meter.waitMs('crm.deal.list', NOW)
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThan(300_000)
  })

  /**
   * A reading describes ONE basket. Once that basket has emptied the number
   * says nothing about the one being spent now, and holding a call back on it
   * would be this module inventing an outage of its own.
   */
  it('forgets a reading once its basket has reset', () => {
    const meter = new PortalMeter()
    meter.record('crm.deal.list', at(OPERATING_BUDGET_S), NOW)
    expect(meter.waitMs('crm.deal.list', new Date(NOW.getTime() + 301_000))).toBe(0)
  })

  it('never holds one method back for another method being hot', () => {
    const meter = new PortalMeter()
    meter.record('crm.deal.list', at(OPERATING_BUDGET_S), NOW)
    expect(meter.waitMs('crm.contact.list', NOW)).toBe(0)
  })

  it('keeps the peak for the support ticket', () => {
    const meter = new PortalMeter()
    meter.record('crm.deal.list', at(400), NOW)
    meter.record('crm.deal.list', at(12), NOW)

    const [worst] = meter.stats().peak
    expect(worst).toEqual({ method: 'crm.deal.list', operating: 400, pct: 83 })
  })
})

/**
 * WHAT OUR SIDE COUNTS AND WHAT THE PORTAL COUNTS ARE DIFFERENT NUMBERS.
 *
 * The rate limiter takes one token for a `batch`, which is one HTTP request and
 * up to fifty method invocations. That gap is why «2 requests per second» was
 * true on our side of the wire throughout both blocks.
 */
describe('what a chained walk costs', () => {
  function provider(time?: Record<string, unknown>, rows: unknown = []) {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { cmd?: Record<string, string> }
      const cmd = body.cmd ?? {}
      const result_time = Object.fromEntries(Object.keys(cmd).map((key) => [key, time ?? {}]))
      return new Response(JSON.stringify({ result: { result: { c0: rows }, result_time } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    return new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl })
  }

  it('counts one request and the commands it carried', async () => {
    // Stage history rather than deals: `fetchDeals` loads enum labels first,
    // and a second real request would muddy the one ratio this pins.
    const crm = provider(undefined, { items: [] })
    await crm.fetchStageHistory()

    const { requests, invocations } = crm.meter.stats()
    expect(requests).toBe(1)
    // CHAIN_MIN, not 1: the request is one, the portal was asked twice.
    expect(invocations).toBe(2)
  })

  /**
   * Filed under the method that was SPENT, never under `batch`. A chained walk
   * sends `batch` and drains `crm.deal.list`'s basket — recording it as
   * «batch» hides the only method the portal was ever going to refuse, which
   * is exactly the blindness that made 2026-09-14 take a live probe to
   * diagnose.
   */
  it('bills the walked method, not the transport', async () => {
    const crm = provider({ operating: 123.5, operating_reset_at: Date.now() / 1000 + 300 })
    await crm.fetchDeals()

    expect(crm.meter.operating('crm.deal.list')).toBe(123.5)
    expect(crm.meter.stats().peak.map((p) => p.method)).toContain('crm.deal.list')
  })
})

/**
 * THE PORTAL WE ACTUALLY HAVE SENDS NO `time` BLOCK AT ALL.
 *
 * Measured 2026-09-16 against `obey.bitrix24.kz`: neither `profile` nor
 * `crm.deal.fields` carries one. Every test above exercises a gauge this portal
 * never feeds, and until the measured fallback existed the meter admitted every
 * call there — through all three blocks.
 */
describe('the measured fallback, on a portal that reports nothing', () => {
  const NOW = new Date('2026-09-16T06:00:00Z')
  const at = (secondsLater: number) => new Date(NOW.getTime() + secondsLater * 1000)

  it('admits a method well inside our share', () => {
    const meter = new PortalMeter()
    meter.recordDuration('crm.deal.list', MEASURED_SOFT_S - 1, NOW)
    expect(meter.waitMs('crm.deal.list', NOW)).toBe(0)
  })

  it('holds a method that has spent its share, until the oldest call ages out', () => {
    const meter = new PortalMeter()
    meter.recordDuration('crm.deal.list', MEASURED_HARD_S, NOW)
    // Ten minutes from the only entry, which is the soonest the total can fall.
    expect(meter.waitMs('crm.deal.list', NOW)).toBe(600_000)
  })

  it('forgets what fell out of the ten minutes', () => {
    const meter = new PortalMeter()
    meter.recordDuration('crm.deal.list', MEASURED_HARD_S, NOW)
    expect(meter.waitMs('crm.deal.list', at(601))).toBe(0)
  })

  /**
   * THE INCIDENT, REPLAYED. `sync_log` for the three days ending 2026-09-16: a
   * DEALS pass averaged 31.8 s on a 180 s tick — the fixed fifty-command chain.
   * Over any ten minutes that is three or four passes, and the meter must stop it
   * before the portal does. Had this existed, it would have.
   */
  it('stops the load that got the portal blocked three mornings running', () => {
    const meter = new PortalMeter()
    let held = false
    for (let tick = 0; tick < 4 && !held; tick++) {
      const now = at(tick * 180)
      if (meter.waitMs('crm.deal.list', now) > 0) held = true
      else meter.recordDuration('crm.deal.list', 36, now)
    }
    expect(held).toBe(true)
  })

  /** And it leaves the narrow chain alone: ~1.3 s a pass on a 120 s tick. */
  it('never touches the load the narrow chain produces', () => {
    const meter = new PortalMeter()
    for (let tick = 0; tick < 50; tick++) {
      const now = at(tick * 120)
      expect(meter.waitMs('crm.deal.list', now)).toBe(0)
      meter.recordDuration('crm.deal.list', 1.3, now)
    }
  })

  /** The portal's own number always wins where it exists — it is the one enforced. */
  it('defers to the portal when the portal does report', () => {
    const meter = new PortalMeter()
    meter.recordDuration('crm.deal.list', MEASURED_HARD_S * 5, NOW)
    meter.record('crm.deal.list', { operating: 10, operating_reset_at: NOW.getTime() / 1000 + 300 }, NOW)
    expect(meter.waitMs('crm.deal.list', NOW)).toBe(0)
  })

  it('bills the walked method, never the transport, and names it as the peak', async () => {
    const fetchImpl = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Response(JSON.stringify({ result: { result: { c0: { items: [] } } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const crm = new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl })
    await crm.fetchStageHistory()

    const now = new Date()
    expect(crm.meter.measuredSeconds('crm.stagehistory.list', now)).toBeGreaterThan(0)
    expect(crm.meter.measuredSeconds('batch', now)).toBe(0)
    expect(crm.meter.stats().peak[0]?.method).toBe('crm.stagehistory.list')
  })
})
