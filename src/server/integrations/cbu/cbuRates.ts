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
 *
 * EVERY ANSWER IS KEPT IN THE DATABASE (`usd_rate`, 2026-10-28). cbu.uz stopped
 * answering DigitalOcean's network (from 26.10 at the latest: a connect
 * timeout from the web container, 200 in 0.1 s from Tashkent), and the rates
 * lived in this process only, so every deploy forgot them: «Kunlar boʻyicha»
 * printed no soʻm spend, CPL, CPQL, CPO or ROAS on any window, «RNP jadvali»
 * no CAC or ROMI for October. A day's stored rate is read before the bank is
 * asked — a past day's never changes — and a day neither answers converts at
 * the newest stored day before it (`dated`), which the screen names.
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

/** A rate and the day it is the bank's rate for. */
export interface DatedRate {
  readonly rate: number
  readonly day: string
}

/**
 * Where the bank's answers outlive the process — `usd_rate`, through
 * `UsdRateRepository`. Every call may fail; a failed store reads as empty.
 */
export interface UsdRateStore {
  /** The stored rate of each of `days` that has one. */
  read(days: readonly string[]): Promise<ReadonlyMap<string, number>>
  /** The newest stored rate dated `day` or earlier. */
  latestOnOrBefore(day: string): Promise<DatedRate | null>
  write(day: string, rate: number): Promise<void>
}

const NO_STORE: UsdRateStore = {
  read: async () => new Map(),
  latestOnOrBefore: async () => null,
  write: async () => {},
}

export class CbuUsdRates {
  private readonly cache = new Map<string, { rate: number; at: number }>()
  /** When a day's last read failed — it is not asked again before `RETRY_AFTER_MS`. */
  private readonly failedAt = new Map<string, number>()
  /** `latestOnOrBefore` per day, for `RETRY_AFTER_MS` — a reader per request would ask the store every time. */
  private readonly latest = new Map<string, { value: DatedRate | null; at: number }>()

  constructor(
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    private readonly clock: () => number = Date.now,
    private readonly store: UsdRateStore = NO_STORE,
  ) {}

  /**
   * The rate for each of `days` (`YYYY-MM-DD`) up to and including `today`;
   * null for a later day, and for a day neither the store nor the bank has.
   */
  async forDays(days: readonly string[], today: string): Promise<(number | null)[]> {
    const out: (number | null)[] = days.map(() => null)
    const wanted = days.flatMap((day, i) => (day <= today ? [{ day, i }] : []))
    const stored = await this.stored(wanted.map(({ day }) => day).filter((day) => !this.cache.has(day) || day === today))
    for (let at = 0; at < wanted.length; at += CONCURRENCY) {
      await Promise.all(
        wanted.slice(at, at + CONCURRENCY).map(async ({ day, i }) => {
          out[i] = await this.forDay(day, day === today, stored.get(day))
        }),
      )
    }
    return out
  }

  /**
   * `day`'s rate, else the newest stored day's before it — and which day that
   * is, for the screen to name («Kurs: … (28.10.2026)»). Null only when
   * nothing up to `day` was ever read.
   */
  async dated(day: string, today: string): Promise<DatedRate | null> {
    const [rate] = await this.forDays([day], today)
    if (rate !== null && rate !== undefined) return { rate, day }
    return this.latestOnOrBefore(day)
  }

  /** The newest stored rate dated `day` or earlier — what a month the bank never answered carries in. */
  async latestOnOrBefore(day: string): Promise<DatedRate | null> {
    const hit = this.latest.get(day)
    if (hit && this.clock() - hit.at < RETRY_AFTER_MS) return hit.value
    const value = await this.store.latestOnOrBefore(day).catch(() => hit?.value ?? null)
    this.latest.set(day, { value, at: this.clock() })
    return value
  }

  private async stored(days: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (days.length === 0) return new Map()
    return this.store.read(days).catch(() => new Map<string, number>())
  }

  private async forDay(day: string, isToday: boolean, stored: number | undefined): Promise<number | null> {
    const hit = this.cache.get(day)
    if (hit && (!isToday || this.clock() - hit.at < TODAY_TTL_MS)) return hit.rate
    // A past day's stored rate is final; today's is the fallback while the bank is asked again.
    if (stored !== undefined && !isToday) {
      this.cache.set(day, { rate: stored, at: this.clock() })
      return stored
    }
    const known = hit?.rate ?? stored
    const failed = this.failedAt.get(day)
    if (failed !== undefined && this.clock() - failed < RETRY_AFTER_MS) return known ?? null
    try {
      const response = await this.fetcher(`${ENDPOINT}/${day}/`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      const rate = response.ok ? parseCbuRate(await response.json()) : null
      if (rate === null) return this.failed(day, known)
      this.failedAt.delete(day)
      this.cache.set(day, { rate, at: this.clock() })
      if (rate !== stored) void this.store.write(day, rate).catch(() => {})
      this.latest.clear()
      return rate
    } catch {
      return this.failed(day, known)
    }
  }

  /** Unreachable bank: the day's older answer if there is one, else nothing — never a guess — and no new ask for a while. */
  private failed(day: string, known: number | undefined): number | null {
    this.failedAt.set(day, this.clock())
    return known ?? null
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
/** The process's one `CbuUsdRates` — the container's, over `usd_rate`. */
export function sharedCbuUsdRates(store?: UsdRateStore): CbuUsdRates {
  return processWide('sinolife.cbu.usdRates', () => new CbuUsdRates(undefined, undefined, store))
}
