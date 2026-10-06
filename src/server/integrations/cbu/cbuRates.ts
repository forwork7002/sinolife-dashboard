/**
 * The dollar's official rate — the Central Bank of Uzbekistan (cbu.uz),
 * one figure per day, soʻm per 1 USD.
 *
 * WHY THIS AND NOT A TYPED NUMBER. «RNP jadvali» turns Meta's dollar spend
 * into soʻm (the P&L's «Таргет бюджет», ROMI, CAC). Until 2026-09-30 the rate
 * was typed into «Rejalar» once a month — 12 200 for September, while the
 * bank's rate that month ran ~11 800, so every converted figure was ~3 % off.
 * The client's rule is that nothing on the sheet is typed by hand, so the
 * rate is read from the bank for the very day it converts.
 *
 * The endpoint answers a date with the rate IN FORCE that day (a weekend
 * gets Friday's), so each day is asked for itself. A past day's rate never
 * changes and is kept for the life of the process; today's is kept an hour.
 *
 * A FAILED READ IS REMEMBERED FOR TEN MINUTES (2026-10-02), and the day
 * answers what it had — today's older rate, or null — without asking. It
 * was asked again on every request: while the bank hung, every /rnp load,
 * plan save and headcount save waited out the timeout — 5 s, or 30 s for a
 * month not read yet (30 days, five at a time).
 */

import { processWide } from '@/server/processWide'

const ENDPOINT = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD'
const REQUEST_TIMEOUT_MS = 5_000
const TODAY_TTL_MS = 60 * 60_000
const RETRY_AFTER_MS = 10 * 60_000
/** Days asked in parallel on a cold month — the bank's site is not ours to hammer. */
const CONCURRENCY = 5

interface CbuRow {
  readonly Ccy?: string
  readonly Rate?: string
  readonly Date?: string
}

/** The rate from the bank's answer, or null when it is not one. Exported for its test. */
export function parseCbuRate(body: unknown): number | null {
  if (!Array.isArray(body)) return null
  const row = (body as CbuRow[]).find((r) => r?.Ccy === 'USD')
  const rate = row?.Rate === undefined ? Number.NaN : Number.parseFloat(row.Rate)
  // A dollar has cost between a few thousand and a few tens of thousands of soʻm; anything else is not a rate.
  return Number.isFinite(rate) && rate > 1_000 && rate < 100_000 ? rate : null
}

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export class CbuUsdRates {
  private readonly cache = new Map<string, { rate: number; at: number }>()
  /** When a day's last read failed — it is not asked again before `RETRY_AFTER_MS`. */
  private readonly failedAt = new Map<string, number>()

  constructor(
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * The rate for each of `days` (`YYYY-MM-DD`) up to and including `today`;
   * null for a later day, and for a day the bank did not answer.
   */
  async forDays(days: readonly string[], today: string): Promise<(number | null)[]> {
    const out: (number | null)[] = days.map(() => null)
    const wanted = days.flatMap((day, i) => (day <= today ? [{ day, i }] : []))
    for (let at = 0; at < wanted.length; at += CONCURRENCY) {
      await Promise.all(
        wanted.slice(at, at + CONCURRENCY).map(async ({ day, i }) => {
          out[i] = await this.forDay(day, day === today)
        }),
      )
    }
    return out
  }

  private async forDay(day: string, isToday: boolean): Promise<number | null> {
    const hit = this.cache.get(day)
    if (hit && (!isToday || this.clock() - hit.at < TODAY_TTL_MS)) return hit.rate
    const failed = this.failedAt.get(day)
    if (failed !== undefined && this.clock() - failed < RETRY_AFTER_MS) return hit?.rate ?? null
    try {
      const response = await this.fetcher(`${ENDPOINT}/${day}/`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      const rate = response.ok ? parseCbuRate(await response.json()) : null
      if (rate === null) return this.failed(day, hit)
      this.failedAt.delete(day)
      this.cache.set(day, { rate, at: this.clock() })
      return rate
    } catch {
      return this.failed(day, hit)
    }
  }

  /** Unreachable bank: the day's older answer if there is one, else nothing — never a guess — and no new ask for a while. */
  private failed(day: string, hit: { rate: number } | undefined): number | null {
    this.failedAt.set(day, this.clock())
    return hit?.rate ?? null
  }
}

/*
  ONE PER PROCESS, ON `globalThis` (2026-10-06). `instrumentation.ts` and the
  route handlers are separate bundles, each building its own container, so
  the RNP warmer read the month's rates into a cache no screen asked, and the
  first /rnp after a deploy asked the bank for the whole month again (30
  days, five at a time). Whichever bundle asks first makes it; the other is
  handed the same one (`processWide`).
*/
/** The process's one `CbuUsdRates` — the container's. */
export function sharedCbuUsdRates(): CbuUsdRates {
  return processWide('sinolife.cbu.usdRates', () => new CbuUsdRates())
}
