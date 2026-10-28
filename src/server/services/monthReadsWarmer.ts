import { type Period, resolvePeriod } from '@/server/domain/period/period'

import type { InboundAnalysisService } from './inboundAnalysisService'
import type { InboundCallsService } from './inboundCallsService'
import type { InsightsService } from './insightsService'
import type { ReklamaService } from './reklamaService'
import type { TargetService } from './targetService'
import { OFF_HOURS, WARM_HOURS, WARM_OWNED_TTL_MS, type WarmOutcome, withinHours } from './rnpWarmer'

/*
  THE MONTH READS THE SCREENS COULD NOT BUILD (2026-10-28). On the screens'
  pool (20 s) «Shu oy» answered 500 twice in a row on /insights/calls (20.2 s),
  /insights/calls/analysis (24.0 s), /target/dm (20.2–20.9 s) and
  /reklama/overview (20.3–20.5 s), and «Oʻtgan oy» on /insights/calls. The
  warm lane builds them with its minute instead, into the very memos the
  screens read, and hands each out for two ticks (`WARM_OWNED_TTL_MS`).

  «Shu oy» every tick; «Oʻtgan oy» once an hour — a closed month moves only
  by late deliveries — and good for two hours. The first tick builds «Shu oy»
  alone, so a deploy's health gate waits for one month, not two. The same
  SQL, the same builds: only the connection and its limit differ.

  Two more the same day, measured after the first deploy of this warmer:
  «Kiruvchi qoʻngʻiroqlar»' basis (the report and «javobsiz qoldi» both read
  it; /insights/calls/inbound/unanswered «Oʻtgan oy» 16.6–17.2 s cold) and
  «Target tahlili»'s opening question (/target/overview «Shu oy» 15.2–16.0 s).
*/
const PREVIOUS_EVERY_MS = 60 * 60_000
const PREVIOUS_TTL_MS = 2 * PREVIOUS_EVERY_MS

export interface MonthReadServices {
  readonly insights: Pick<InsightsService, 'warmCallActivity'>
  readonly inboundAnalysis: Pick<InboundAnalysisService, 'warm'>
  readonly reklama: Pick<ReklamaService, 'warm'>
  readonly inboundCalls: Pick<InboundCallsService, 'warm'>
  readonly target: Pick<TargetService, 'warm'>
}

/** The warmer's tick: builds what is due, every read tried; the first failure is thrown after, for the warmer to log. */
export function monthReadsWarm(services: MonthReadServices, clock: () => number = Date.now) {
  let previousAt: number | null = null
  return async (now: Date, timeZone: string): Promise<WarmOutcome> => {
    if (!withinHours(now, timeZone, WARM_HOURS)) return OFF_HOURS
    const windows: { period: Period; ttlMs: number }[] = [
      { period: resolvePeriod('this_month', { timeZone, now }), ttlMs: WARM_OWNED_TTL_MS },
    ]
    const previousDue = previousAt !== null && clock() - previousAt >= PREVIOUS_EVERY_MS
    if (previousAt === null) previousAt = clock() - PREVIOUS_EVERY_MS // the second tick builds it
    else if (previousDue) windows.push({ period: resolvePeriod('previous_month', { timeZone, now }), ttlMs: PREVIOUS_TTL_MS })

    let failure: { error: unknown } | undefined
    let previousBuilt = true
    for (const { period, ttlMs } of windows) {
      const reads = [
        () => services.insights.warmCallActivity(period, ttlMs),
        () => services.inboundAnalysis.warm(period, now, ttlMs),
        () => services.reklama.warm(period, timeZone, ttlMs),
        () => services.inboundCalls.warm(period, now, ttlMs),
        () => services.target.warm(period, ttlMs),
      ]
      for (const read of reads) {
        try {
          await read()
        } catch (error) {
          failure ??= { error }
          if (period.preset === 'previous_month') previousBuilt = false
        }
      }
    }
    if (previousDue && previousBuilt) previousAt = clock()
    if (failure) throw failure.error
  }
}
