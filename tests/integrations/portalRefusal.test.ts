import { describe, expect, it } from 'vitest'

import { classifyRefusal, refusalCode } from '@/server/integrations/crm/bitrix24/refusal'
import { PortalGate } from '@/server/integrations/crm/bitrix24/portalGate'
import { Bitrix24Error } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'

/**
 * The outage of 2026-09-15, turned into tests.
 *
 * Between 05:50 and 06:10 UTC the portal refused every call for overload; at
 * 06:10 the administrator deleted the blocked webhook and made a new one, so
 * the SAME HTTP 401 started meaning something entirely different — and nothing
 * in the system could tell the two apart. Everything below is that distinction,
 * plus the requests we stopped spending on a door that was already shut.
 */

describe('classifyRefusal', () => {
  it('separates a self-clearing throttle from a credential that needs a person', () => {
    expect(classifyRefusal(new Bitrix24Error('x', 401, false, 'OVERLOAD_LIMIT'))).toBe('THROTTLE')
    expect(classifyRefusal(new Bitrix24Error('x', 503, true, 'QUERY_LIMIT_EXCEEDED'))).toBe(
      'THROTTLE',
    )
    expect(classifyRefusal(new Bitrix24Error('x', 401, false, 'INVALID_CREDENTIALS'))).toBe(
      'CREDENTIAL',
    )
  })

  /**
   * `OPERATION_TIME_LIMIT` is ONE method's budget, not the portal's mood. Its
   * own comment in the provider records the measurement: `start=400000` got
   * every `crm.contact.list` in the account refused for ten minutes while
   * everything else kept answering. Classifying it as a portal refusal would
   * stop the whole sync over one expensive read.
   */
  it('keeps a spent method separate from a refused portal', () => {
    expect(classifyRefusal(new Bitrix24Error('x', 429, false, 'OPERATION_TIME_LIMIT'))).toBe(
      'METHOD',
    )
  })

  /**
   * THE ONE THAT WOULD BREAK EVERY SYNC. `batchWalk` ends every completed walk
   * on an `INVALID_ARG_VALUE` — the chain running dry is how it learns it has
   * reached the end of the data. If that classified as a refusal, the gate
   * would slam shut on every SUCCESSFUL pass.
   */
  it('does not treat a per-record fact as a portal refusal', () => {
    expect(classifyRefusal(new Bitrix24Error('x', 400, false, 'INVALID_ARG_VALUE'))).toBeNull()
    expect(classifyRefusal(new Bitrix24Error('x', 403, false, 'ERROR_ACCESS_DENIED'))).toBeNull()
  })

  /**
   * The message is the fallback for errors raised outside the provider — the
   * worker reads `sync_log.errorMessage`, which is prose.
   */
  it('recovers the code from a logged message when there is no field', () => {
    const logged =
      'Bitrix24 call "batch" failed after 1 attempt: Bitrix24 responded 401 — OVERLOAD_LIMIT: REST API is blocked due to overload.'
    expect(refusalCode(logged)).toBe('OVERLOAD_LIMIT')
    expect(classifyRefusal(logged)).toBe('THROTTLE')
  })

  /** «REST API is blocked» must not yield «REST» as the portal's error code. */
  it('does not mistake an English sentence for a code', () => {
    expect(refusalCode('Bitrix24 responded 500 — REST API is blocked')).not.toBe('REST')
  })

  /**
   * A 401 whose body could not be parsed is read as CREDENTIAL on purpose: of
   * the two shapes that produce it, only a dead credential is made worse by
   * waiting. Paging a human for a block that would have cleared costs one
   * notification; silence over a dead webhook cost five hours.
   */
  it('reads an unparsable 401 as a credential problem', () => {
    expect(classifyRefusal(new Bitrix24Error('Bitrix24 responded 401', 401, false))).toBe(
      'CREDENTIAL',
    )
  })

  it('retries a socket failure rather than blocking on it', () => {
    expect(classifyRefusal(new Error('fetch failed'))).toBe('TRANSIENT')
  })
})

describe('PortalGate', () => {
  /**
   * THE LADDER HAS TO ACTUALLY CLIMB, AND ON PRODUCTION IT DID NOT.
   *
   * Measured 2026-09-16 under a live `OVERLOAD_LIMIT`: the worker printed
   * «60s kutiladi» on every probe instead of 60 → 120 → 240 → 480 → 600. The
   * startup health check had failed three times at network level, which left
   * `transientRun` at the tolerance for the rest of the outage — only a success
   * reset it, and there are none during a block — so any later stray socket
   * error called `openGate` and rewrote a THROTTLE gate as a TRANSIENT one, flat
   * 60 s, `probes` back to zero. The next OVERLOAD_LIMIT then saw a kind
   * mismatch and opened at rung zero again.
   *
   * ~860 probes a day at a portal that had refused us, under a support ticket
   * promising in writing that we back off. The ladder IS that promise.
   */
  it('climbs the ladder across repeated refusals of the same kind', () => {
    const gate = new PortalGate()
    const now = new Date('2026-09-16T09:00:00Z')
    const overload = { code: 'OVERLOAD_LIMIT', message: 'blocked', status: 401 }

    gate.trip(overload, now)
    expect(gate.nextWaitMs(now)).toBe(60_000)

    gate.noteProbe(now)
    gate.trip(overload, now)
    expect(gate.nextWaitMs(now)).toBe(120_000)

    gate.noteProbe(now)
    gate.trip(overload, now)
    expect(gate.nextWaitMs(now)).toBe(240_000)
  })

  it('does not let a socket error demote a throttle gate or reset its rung', () => {
    const gate = new PortalGate()
    const now = new Date('2026-09-16T09:00:00Z')
    const overload = { code: 'OVERLOAD_LIMIT', message: 'blocked', status: 401 }

    gate.trip(overload, now)
    gate.noteProbe(now)
    gate.trip(overload, now)
    expect(gate.nextWaitMs(now)).toBe(120_000)

    // Three nameless failures — the count that used to open a TRANSIENT gate.
    for (let i = 0; i < 3; i++) gate.trip(new Error('socket hang up'), now)

    expect(gate.state().kind).toBe('THROTTLE')
    expect(gate.state().code).toBe('OVERLOAD_LIMIT')
    expect(gate.nextWaitMs(now)).toBe(120_000)
  })

  /** And a named refusal ends the transient run, so the trigger is not left armed. */
  it('clears the transient run when the portal names a refusal', () => {
    const gate = new PortalGate()
    const now = new Date('2026-09-16T09:00:00Z')

    gate.trip(new Error('socket hang up'), now)
    gate.trip(new Error('socket hang up'), now)
    // A named refusal in between resets the count...
    gate.trip({ code: 'OPERATION_TIME_LIMIT', message: 'slow', method: 'crm.deal.list' }, now)
    // ...so two more transients are still under tolerance and shut nothing.
    gate.trip(new Error('socket hang up'), now)
    gate.trip(new Error('socket hang up'), now)

    expect(gate.state().kind).toBeNull()
  })

  const t0 = new Date('2026-09-15T06:00:00.000Z')
  const at = (ms: number) => new Date(t0.getTime() + ms)
  const overload = new Bitrix24Error('x', 401, false, 'OVERLOAD_LIMIT', 'crm.deal.list')

  it('admits everything while the portal is answering', () => {
    const gate = new PortalGate()
    expect(gate.hold('crm.deal.list', t0)).toBeNull()
    expect(gate.isOpen()).toBe(false)
  })

  /**
   * THE MEASUREMENT THIS EXISTS FOR. `SyncEngine.runAll` walks its entities in
   * a loop with no breaker beneath it, so on 2026-09-15 a hot tick sent three
   * requests of which TWO left after the portal had already refused the first.
   */
  it('shuts on the first refusal so the rest of the tick sends nothing', () => {
    const gate = new PortalGate()
    gate.trip(overload, t0)

    expect(gate.isOpen()).toBe(true)
    expect(gate.hold('crm.contact.list', t0)?.code).toBe('OVERLOAD_LIMIT')
    expect(gate.hold('crm.stagehistory.list', t0)?.code).toBe('OVERLOAD_LIMIT')
  })

  it('names the code and the start in what it throws, so the log still reads', () => {
    const gate = new PortalGate()
    gate.trip(overload, t0)

    const held = gate.hold('crm.deal.list', t0)
    expect(held?.message).toContain('OVERLOAD_LIMIT')
    expect(held?.since).toEqual(t0)
  })

  /**
   * The dashboard prints `since` as «failing since», so an outage that restarts
   * its own clock on every probe would always read as seconds old — which is
   * exactly the defect the `since` field was added to fix.
   */
  it('does not restart the outage clock when it is refused again', () => {
    const gate = new PortalGate()
    gate.trip(overload, t0)
    gate.trip(overload, at(120_000))

    expect(gate.state().since).toEqual(t0)
  })

  /** 60s, 120s, 240s, 480s, then 600s — the ten minutes a 2026-09-14 incident set. */
  it('backs the probe ladder off and stops at ten minutes', () => {
    const gate = new PortalGate()
    gate.trip(overload, t0)
    expect(gate.nextWaitMs(t0)).toBe(60_000)

    const ladder: number[] = []
    let now = t0
    for (let i = 0; i < 5; i++) {
      now = new Date(now.getTime() + gate.nextWaitMs(now))
      gate.noteProbe(now)
      ladder.push(gate.nextWaitMs(now))
    }

    expect(ladder).toEqual([120_000, 240_000, 480_000, 600_000, 600_000])
  })

  /**
   * A revoked credential probes FLAT, and the flatness is the point: it will
   * not clear on its own, so backing off would only delay the moment we notice
   * that somebody has finally issued a new webhook.
   */
  it('probes a dead credential on a flat five minutes', () => {
    const gate = new PortalGate()
    gate.trip(new Bitrix24Error('x', 401, false, 'INVALID_CREDENTIALS'), t0)

    expect(gate.nextWaitMs(t0)).toBe(300_000)
    gate.noteProbe(at(300_000))
    expect(gate.nextWaitMs(at(300_000))).toBe(300_000)
  })

  it('opens the door again the moment a call gets through', () => {
    const gate = new PortalGate()
    gate.trip(overload, t0)
    gate.noteSuccess('profile', at(60_000))

    expect(gate.isOpen()).toBe(false)
    expect(gate.hold('crm.deal.list', at(60_000))).toBeNull()
  })

  /**
   * One method's spent budget must not take the dashboard down: everything
   * else stays admissible.
   */
  it('holds one method without closing the portal', () => {
    const gate = new PortalGate()
    gate.trip(new Bitrix24Error('x', 429, false, 'OPERATION_TIME_LIMIT', 'crm.contact.list'), t0)

    expect(gate.isOpen()).toBe(false)
    expect(gate.hold('crm.contact.list', t0)).not.toBeNull()
    expect(gate.hold('crm.deal.list', t0)).toBeNull()
    expect(gate.hold('crm.contact.list', at(600_001))).toBeNull()
  })

  it('tolerates a couple of transient failures before shutting', () => {
    const gate = new PortalGate()
    gate.trip(new Error('fetch failed'), t0)
    expect(gate.isOpen()).toBe(false)
    gate.trip(new Error('fetch failed'), t0)
    expect(gate.isOpen()).toBe(false)
    gate.trip(new Error('fetch failed'), t0)
    expect(gate.isOpen()).toBe(true)
  })

  it('never shuts on the end-of-data sentinel every completed walk produces', () => {
    const gate = new PortalGate()
    for (let i = 0; i < 10; i++) {
      gate.trip(new Bitrix24Error('x', 400, false, 'INVALID_ARG_VALUE'), t0)
    }
    expect(gate.isOpen()).toBe(false)
  })

  /**
   * A restart inside a block cost ~11 requests re-discovering a block the
   * database already knew about, ~17 times a day at the measured restart rate.
   */
  it('can start already shut, from what the last worker wrote down', () => {
    const gate = new PortalGate()
    gate.seed('THROTTLE', 'OVERLOAD_LIMIT', t0, at(30_000))

    expect(gate.isOpen()).toBe(true)
    expect(gate.state().since).toEqual(t0)
    expect(gate.hold('crm.deal.list', at(30_000))).not.toBeNull()
  })
})
