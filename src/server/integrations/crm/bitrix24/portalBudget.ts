/**
 * A ceiling on what this process may ask the portal for in any rolling hour.
 *
 * WHY A CEILING AND NOT JUST A FASTER LIMITER
 * Everything else in this directory limits a RATE. The rate was never the
 * problem: 2 requests a second was true throughout both portal-wide blocks
 * (2026-09-14, four hours; 2026-09-16 11:53). What earned them was VOLUME —
 * ~288 000 method invocations a day on the hot path, of which ~277 000 existed
 * only to discover there was nothing left to read, plus a worker restarting
 * seventeen times a day and re-reading 45 days of stage history on each start.
 * Every one of those was inside the rate limit, every second of the way.
 *
 * A rate limiter cannot see that, because it has no memory: it asks «may this
 * request leave now», never «how much have we asked for today». This is the
 * memory. It is deliberately the LAST line rather than the first — the chain
 * width, the meter and the reference cadence are what keep us far below it, and
 * if this ever trips, something has regressed and the log says what.
 *
 * WHAT IT COUNTS
 * INVOCATIONS, not requests, because that is what the portal bills. A `batch`
 * is one HTTP request and up to fifty method calls, and that gap is precisely
 * why our side of the wire and Bitrix24's side disagreed about our load for the
 * whole life of this integration.
 *
 * HOW IT BEHAVES
 * Above `SOFT_FRACTION` it paces — the tick still completes, more slowly, and
 * the worker logs it. Above the ceiling it REFUSES locally, sending nothing,
 * until the rolling window drains. A refusal is safe by construction
 * everywhere it can land: `listDealIds` throws rather than returning a short
 * read, `sweepByAntiJoin` will not delete on an empty source, and every
 * entity's watermark only advances after a clean run — so a budget refusal
 * costs freshness and nothing else.
 *
 * WHAT IT IS NOT. It cannot promise Bitrix24 will not block the portal again:
 * `OVERLOAD_LIMIT` is administrative, portal-wide and has no published
 * threshold, and other integrations share this portal. What it promises is
 * narrower and worth more — that a regression on OUR side cannot silently
 * spend its way back into one, because the spending is now bounded, attributed
 * per method, and loud when it approaches the bound.
 */

/** Minutes of history kept. One bucket per minute, rolling. */
const WINDOW_MINUTES = 60

/**
 * Invocations per rolling hour, before anything is held back.
 *
 * MEASURED AGAINST THE DEPLOYED CADENCE, with roughly 40× headroom on an
 * ordinary hour and 1.5× on the worst legitimate one:
 *
 *   ordinary hour   60 ticks × 8 invocations             ≈    500
 *   reference hour  the above plus one reference pass    ≈    600
 *   sweep hour      the above plus `listDealIds`         ≈  9 800
 *   the OLD hot path, for comparison                     ≈ 12 000
 *
 * So the ceiling sits above the most expensive hour this worker has any
 * business having, and BELOW the behaviour that produced the blocks — a
 * regression to the fixed fifty-command chain trips it inside one hour rather
 * than surfacing days later as a 401.
 *
 * `npm run bitrix:import` legitimately exceeds it: a full import is a deliberate
 * act a person is watching, so `scripts/import.ts` raises it rather than this
 * number being set high enough to cover a case that happens twice a year.
 */
export const DEFAULT_HOURLY_INVOCATIONS = 15_000

/** Above this fraction of the ceiling, calls are paced rather than refused. */
export const SOFT_FRACTION = 0.7

export interface BudgetState {
  /** Invocations in the rolling window. */
  readonly spent: number
  readonly ceiling: number
  readonly pct: number
  /** Worst spenders in the window, most expensive first. */
  readonly byMethod: readonly { method: string; invocations: number }[]
}

export class PortalBudget {
  /** minute-since-epoch → invocations in that minute. */
  private readonly buckets = new Map<number, number>()
  private readonly byMethod = new Map<string, number>()

  constructor(private readonly ceiling: number = DEFAULT_HOURLY_INVOCATIONS) {}

  /** Record invocations that are about to leave. */
  spend(method: string, invocations: number, now: Date): void {
    const minute = Math.floor(now.getTime() / 60_000)
    this.buckets.set(minute, (this.buckets.get(minute) ?? 0) + invocations)
    this.byMethod.set(method, (this.byMethod.get(method) ?? 0) + invocations)
    this.evict(minute)
  }

  /** Invocations inside the rolling window. */
  spent(now: Date): number {
    const minute = Math.floor(now.getTime() / 60_000)
    this.evict(minute)
    let total = 0
    for (const value of this.buckets.values()) total += value
    return total
  }

  /**
   * How long to hold a call carrying `invocations`, in milliseconds.
   *
   * `Infinity` means «not now» — the ceiling is reached and the caller must be
   * refused rather than queued, because queueing behind a full window is the
   * same as sending it, only later and with the worker blocked meanwhile.
   */
  waitMs(invocations: number, now: Date): number {
    const spent = this.spent(now)
    if (spent + invocations > this.ceiling) return Number.POSITIVE_INFINITY

    const used = spent / this.ceiling
    if (used < SOFT_FRACTION) return 0

    /*
      Between the soft rung and the ceiling, slow down in proportion to how far
      through we are. At 70% this is nothing; approaching 100% it is seconds per
      call, which is enough to turn «about to trip» into «reported, and still
      running» — the state an operator can act on.
    */
    const through = (used - SOFT_FRACTION) / (1 - SOFT_FRACTION)
    return Math.round(through * through * 5_000)
  }

  state(now: Date): BudgetState {
    const spent = this.spent(now)
    return {
      spent,
      ceiling: this.ceiling,
      pct: Math.round((spent / this.ceiling) * 100),
      byMethod: [...this.byMethod.entries()]
        .map(([method, invocations]) => ({ method, invocations }))
        .sort((a, b) => b.invocations - a.invocations),
    }
  }

  /**
   * Drop buckets older than the window.
   *
   * `byMethod` is deliberately NOT evicted with them: it is attribution for the
   * log and the support ticket — «which method spent this» — and a per-method
   * ring would be sixty times the bookkeeping to answer a question nobody asks
   * by the minute.
   */
  private evict(minute: number): void {
    for (const key of this.buckets.keys()) {
      if (key <= minute - WINDOW_MINUTES) this.buckets.delete(key)
    }
  }
}
