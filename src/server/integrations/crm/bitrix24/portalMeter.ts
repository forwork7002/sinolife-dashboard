/**
 * The portal's own fuel gauge — which this integration has never once read.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE THING THAT WAS MISSING
 * Every successful REST answer from Bitrix24 carries a `time` object, and two
 * of its fields are the portal saying how close we are to being cut off:
 *
 *     operating           seconds of method execution this webhook has already
 *                         spent in the current basket, FOR THIS METHOD
 *     operating_reset_at  unix seconds — when that basket empties
 *
 * Bitrix24 allows 480 s of operating time per method per ten-minute basket and
 * answers `OPERATION_TIME_LIMIT` for the remainder of the window once it is
 * spent. `Bitrix24Response` had no `time` field at all, so `response.json()`
 * parsed both numbers and threw them away on every single call this
 * integration has ever made. Every statement we have made about our own load —
 * the 2 rps limiter, the «107 requests into a closed door» measurement, the
 * figures in the support ticket — was an estimate made from THIS side of the
 * wire, against a limit only the portal can see.
 *
 * Both blocks were therefore diagnosed after the fact, from `sync_log` row
 * counts: 2026-09-14 (four hours, `OVERLOAD_LIMIT`) and 2026-09-16 11:53
 * (`OVERLOAD_LIMIT`, three entities). Neither could be seen coming, because
 * nothing in this process was looking at the one number that was rising.
 *
 * WHAT IT IS NOT
 * `PortalGate` is what happens AFTER the portal has refused us — it stops us
 * spending requests on a shut door. This is what keeps us off the wall in the
 * first place, and the two are deliberately separate: a gate that has tripped
 * is a fact about the past, a basket at 70% is a fact about the next minute.
 *
 * `OVERLOAD_LIMIT` is an administrative, portal-wide block with no published
 * threshold, so nothing here can promise to avoid it. What it can do is make
 * our consumption a MEASURED number rather than an assumed one — `peak()` is
 * what the next support ticket should quote, and what tells us which method to
 * cut when the answer is «reduce your load».
 */

/** Seconds of operating time Bitrix24 allows per method per basket. */
export const OPERATING_BUDGET_S = 480

/** How long a basket lasts, used only when the portal sends no reset time. */
export const OPERATING_WINDOW_MS = 600_000

/**
 * Above this fraction of the basket we start pacing; above `HARD` we stop and
 * wait the basket out.
 *
 * The soft rung is not caution for its own sake. A method that reaches 60% of
 * its basket has, at the rate that got it there, about four minutes before the
 * portal refuses it — and a refusal is not local: `OPERATION_TIME_LIMIT`
 * blocks that method for every caller in the account, which is how a contact
 * import once took `crm.contact.list` away from the portal's own users for ten
 * minutes.
 */
export const SOFT_FRACTION = 0.6
export const HARD_FRACTION = 0.85

/**
 * OUR OWN SHARE OF A METHOD'S TEN MINUTES, WHEN THE PORTAL WILL NOT TELL US.
 *
 * `obey.bitrix24.kz` sends no `time` block on any method — measured 2026-09-16
 * against `profile` and `crm.deal.fields` — so everything above this line has
 * nothing to read there, and the meter admitted every call for the whole life of
 * the integration. What the portal will not report we can still MEASURE: the
 * wall-clock of a call is its execution time plus one round trip, and on the
 * calls that matter the round trip is noise. `sync_log` proved it — a DEALS pass
 * reading thirty records took thirty-six seconds while a CUSTOMERS pass reading
 * ten took under one.
 *
 * WHY THESE NUMBERS ARE SO MUCH LOWER THAN 480. The portal's own sales floor
 * spends the same method's basket all day, and we cannot see their share. The
 * evidence of how much room we actually have is the blocks themselves: over the
 * three days that ended in three consecutive late-morning `OVERLOAD_LIMIT`s,
 * DEALS ran at a sustained **145 s per ten minutes** — 30% of the nominal budget,
 * comfortably under it on paper — and was blocked anyway, every day, as the
 * floor came online. So our own share has to sit well below 145:
 *
 *   MEASURED_SOFT_S   60 s / 10 min   pace — 12.5% of 480, well under the load that got blocked
 *   MEASURED_HARD_S  120 s / 10 min   wait the window out — still under the 145 that did
 *
 * The narrow chain (`CHAIN_MIN`) takes an idle DEALS tick to ~1.3 s, which at a
 * 120 s tick is ~6.5 s per ten minutes. These rungs are not where the
 * integration lives; they are where a regression stops.
 */
export const MEASURED_SOFT_S = 60
export const MEASURED_HARD_S = 120

/** The `time` block Bitrix24 attaches to every answer. */
export interface PortalTime {
  readonly operating?: number
  readonly operating_reset_at?: number
  readonly duration?: number
}

interface Basket {
  operating: number
  resetAt: Date
  at: Date
}

export interface MeterStats {
  /** HTTP requests this process has sent. */
  readonly requests: number
  /**
   * Method invocations those requests carried.
   *
   * A `batch` is ONE request and up to fifty invocations, and the difference
   * between the two numbers is the whole reason the portal's view of our load
   * and ours disagreed. Both are reported; neither is inferred from the other.
   */
  readonly invocations: number
  /** Highest basket reading seen per method, worst first. */
  readonly peak: readonly { method: string; operating: number; pct: number }[]
  /** Total operating seconds the portal has billed us, per method. */
  readonly waits: number
}

export class PortalMeter {
  private readonly baskets = new Map<string, Basket>()
  /** Our own measured seconds per method, each stamped, rolling ten minutes. */
  private readonly measured = new Map<string, { at: number; seconds: number }[]>()
  private readonly peaks = new Map<string, number>()
  private requests = 0
  private invocations = 0
  private waits = 0

  /** One HTTP request left, carrying `invocations` method calls. */
  countRequest(invocations: number): void {
    this.requests += 1
    this.invocations += Math.max(1, invocations)
  }

  /**
   * File what the portal said about a method's basket.
   *
   * `method` is the METERED method, not the transport: a chained walk sends
   * `batch` and spends `crm.deal.list`'s basket, and filing fifty deal seeks
   * under «batch» would hide the only method that was ever going to be
   * refused.
   */
  record(method: string, time: PortalTime | undefined, now: Date): void {
    if (!time || typeof time.operating !== 'number' || !Number.isFinite(time.operating)) return

    const resetAt =
      typeof time.operating_reset_at === 'number' && Number.isFinite(time.operating_reset_at)
        ? new Date(time.operating_reset_at * 1000)
        : new Date(now.getTime() + OPERATING_WINDOW_MS)

    this.baskets.set(method, { operating: time.operating, resetAt, at: now })

    const peak = this.peaks.get(method) ?? 0
    if (time.operating > peak) this.peaks.set(method, time.operating)
  }

  /**
   * File how long a call to `method` took, as WE measured it.
   *
   * Recorded whether or not the portal also sent a `time` block, so the two can
   * be compared on a portal that does send one — but only CONSULTED when it did
   * not. The portal's own number always wins where it exists: it is the one the
   * portal enforces.
   */
  recordDuration(method: string, seconds: number, now: Date): void {
    if (!Number.isFinite(seconds) || seconds < 0) return
    const at = now.getTime()
    const list = this.measured.get(method) ?? []
    list.push({ at, seconds })
    this.measured.set(method, list)
    this.evictMeasured(method, at)

    // Feeds `peak` too, so `stats()` names the hot method on a portal that
    // sends no telemetry — which is the only kind of portal we actually have.
    const total = this.measuredSeconds(method, now)
    if (total > (this.peaks.get(method) ?? 0)) this.peaks.set(method, total)
  }

  /** Seconds we have measured this method spending in the last ten minutes. */
  measuredSeconds(method: string, now: Date): number {
    const at = now.getTime()
    this.evictMeasured(method, at)
    return (this.measured.get(method) ?? []).reduce((sum, e) => sum + e.seconds, 0)
  }

  private evictMeasured(method: string, at: number): void {
    const list = this.measured.get(method)
    if (!list) return
    const kept = list.filter((e) => at - e.at < OPERATING_WINDOW_MS)
    if (kept.length === 0) this.measured.delete(method)
    else this.measured.set(method, kept)
  }

  /**
   * How long to hold this method before sending, in milliseconds.
   *
   * `0` admits the call. A HARD reading returns the whole remainder of the
   * basket — there is no point pacing into a wall that empties on a clock we
   * can read. A SOFT reading returns a pace delay that grows with the reading,
   * which spreads the rest of the basket over the rest of the window instead of
   * spending it in the next twenty seconds.
   */
  waitMs(method: string, now: Date): number {
    const basket = this.baskets.get(method)
    /*
      NO TELEMETRY FROM THE PORTAL IS NOT PERMISSION — FALL BACK TO WHAT WE MEASURED.

      This used to be `if (!basket) return 0`, and on a portal that sends no
      `time` block there is never a basket, so the meter admitted every call
      forever. That was the state of this integration through all three blocks.
    */
    if (!basket) return this.measuredWaitMs(method, now)

    // A stale reading is no reading. Once the basket it described has emptied,
    // the number says nothing about the one we are spending now.
    const remainingMs = basket.resetAt.getTime() - now.getTime()
    if (remainingMs <= 0) {
      this.baskets.delete(method)
      return 0
    }

    const used = basket.operating / OPERATING_BUDGET_S
    if (used >= HARD_FRACTION) {
      this.waits += 1
      return remainingMs
    }
    if (used < SOFT_FRACTION) return 0

    /*
      Spread what is left over what is left.

      Between the two rungs the budget remaining is `(1 - used)` of the basket
      and the time remaining is `remainingMs`. Pacing one call per
      `remainingMs × (used - SOFT) / (HARD - SOFT)` walks the delay from zero at
      60% to the full remainder at 85%, so the approach to the wall is gradual
      and a method that stops being hot recovers immediately rather than
      serving out a penalty.
    */
    const through = (used - SOFT_FRACTION) / (HARD_FRACTION - SOFT_FRACTION)
    this.waits += 1
    return Math.round(remainingMs * through * 0.1)
  }

  /**
   * The measured fallback: our own seconds in the rolling ten minutes, against
   * rungs set from the load that actually got this portal blocked.
   *
   * At the hard rung the wait is until the OLDEST entry in the window ages out,
   * which is the soonest the total can fall — not the full ten minutes, which
   * would idle a method that is one call over the line.
   */
  private measuredWaitMs(method: string, now: Date): number {
    const spent = this.measuredSeconds(method, now)
    if (spent < MEASURED_SOFT_S) return 0

    const list = this.measured.get(method) ?? []
    const oldest = list.length > 0 ? Math.min(...list.map((e) => e.at)) : now.getTime()
    const untilOldestAgesOut = Math.max(0, oldest + OPERATING_WINDOW_MS - now.getTime())

    this.waits += 1
    if (spent >= MEASURED_HARD_S) return untilOldestAgesOut

    const through = (spent - MEASURED_SOFT_S) / (MEASURED_HARD_S - MEASURED_SOFT_S)
    return Math.round(untilOldestAgesOut * through * 0.1)
  }

  /** The current reading for a method, for logs and the support ticket. */
  operating(method: string): number | null {
    return this.baskets.get(method)?.operating ?? null
  }

  stats(): MeterStats {
    const peak = [...this.peaks.entries()]
      .map(([method, operating]) => ({
        method,
        operating: Math.round(operating * 10) / 10,
        pct: Math.round((operating / OPERATING_BUDGET_S) * 100),
      }))
      .sort((a, b) => b.operating - a.operating)

    return { requests: this.requests, invocations: this.invocations, peak, waits: this.waits }
  }

  /** Zero the counters, keeping the baskets — called once a tick by the worker. */
  resetCounters(): void {
    this.requests = 0
    this.invocations = 0
    this.waits = 0
  }
}
