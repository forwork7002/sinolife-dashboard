/**
 * The one thing the Roistat import still writes: `marketing_snapshot`.
 *
 * WHY ONLY THE SNAPSHOT (2026-10-07). The importer used to replace ~24 500
 * `marketing_daily` rows every hour — a delete + createMany per dimension in
 * one transaction of up to 300 s on the one-core database, then an md5 over
 * the whole table — and nothing has read that table since the Roistat
 * «Reklama samarasi» screen was deleted on 2026-09-30. The one reader left is
 * «Target tahlili», which takes the snapshot's UZS/USD rate (`usdRateMicro`,
 * `rateDate`) for ROAS through `MarketingRepository.snapshot()`. So the hourly
 * run keeps that row current and writes nothing else. The table and its old
 * rows stay where they are; nothing is dropped.
 *
 * Kept apart from importRoistat.ts so it can be tested: that file runs its
 * `main()` the moment it is imported.
 */

import type { PrismaClient } from '../src/generated/prisma/client'
import { parseCbuRate } from '../src/server/integrations/cbu/cbuRates'

/** One published dashboard, one snapshot row. */
export const SNAPSHOT_ID = 'roistat'

/**
 * Refuse a blob holding less than this share of the rows the LAST import's
 * blob held (`rowCount`). A half-written publish is the failure this catches,
 * and the rate it carries would be no more trustworthy than its rows.
 * --force is the escape hatch for the day the client really prunes the sheet.
 */
export const SHRINK_GUARD = 0.5

const RU_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/

/** The blob fields the snapshot is made of — validated by the caller. */
export interface SnapshotFacts {
  readonly rate: number
  readonly rateDate: string
  readonly updated: string
  readonly today: string
  readonly minDate: string
  readonly maxDate: string
  readonly dailyFrom: string
  readonly freshFrom: string
}

/**
 * A bare calendar day as a UTC-midnight Date, which is what a `@db.Date`
 * column wants. Constructed from the parts rather than parsed from the string
 * so the machine's own timezone can never shift the day.
 */
export function day(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function ruDay(value: string): Date {
  const m = RU_DATE.exec(value)
  if (!m) throw new Error(`Not a DD.MM.YYYY date: ${value}`)
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))
}

/**
 * Money into integers, with the rounding stated once. Math.round rather than
 * a cast because the source is JSON floats — 80.36 × 1e6 is 80359999.99999999
 * in IEEE 754, and truncating it would lose a unit.
 */
export function scaled(value: number, scale: number): bigint {
  return BigInt(Math.round(value * scale))
}

/**
 * WHEN THE SOURCE PUBLISHES NO DATED RATE (2026-10-24). The client's page
 * asks the Central Bank for the day's rate; when it cannot, it publishes a
 * typed reserve with `rateDate: "резерв"` instead of a date. That day the
 * reserve was 12 650.0 against the bank's 11 838.92 — 6.9 % over — and the
 * importer, which wanted a DD.MM.YYYY date there, refused every hourly run,
 * so /target kept an older rate with nothing in the log but «1 issue(s)».
 *
 * A reserve is not a rate, so it is never stored: the rate is then asked of
 * the bank directly (`bankRate`, the same cbu.uz endpoint «RNP jadvali»
 * reads), else the last stored rate stays where it is. With neither, the
 * import refuses, as it did before. Everything else in the blob is written
 * either way — it is as good as on any other run.
 */
export function isDatedRate(rateDate: string): boolean {
  return RU_DATE.test(rateDate)
}

/** The bank's answer for one day: soʻm per dollar, and the DD.MM.YYYY it is dated. */
export interface BankRate {
  readonly rate: number
  readonly date: string
}

/**
 * Where the stored rate came from: the blob, the bank (the blob had a
 * reserve), `usd_rate`'s newest day (a reserve and no bank), or the last
 * import (none of those).
 */
export type RateSource = 'source' | 'cbu' | 'stored' | 'previous'

/**
 * `usd_rate` as the import sees it (2026-10-28): the day-by-day rates the
 * dashboard converts with. A dated rate the blob or the bank gives is kept
 * there — the client's page reaches the Central Bank when DigitalOcean cannot
 * — and a reserve with no bank takes its newest day when that is newer than
 * the snapshot's.
 */
export interface DayRates {
  latest(): Promise<StoredRate | null>
  keep(rate: StoredRate, source: 'roistat' | 'cbu'): Promise<void>
}

/** The bank's rate and its own date from a cbu.uz answer — null when it is not one. */
export function bankRateOf(body: unknown): BankRate | null {
  const rate = parseCbuRate(body)
  if (rate === null || !Array.isArray(body)) return null
  const date = (body as { Ccy?: unknown; Date?: unknown }[]).find((r) => r?.Ccy === 'USD')?.Date
  return typeof date === 'string' && RU_DATE.test(date) ? { rate, date } : null
}

/** The rate as it is stored: micro-soʻm per dollar and the day it was taken. */
export interface StoredRate {
  readonly usdRateMicro: bigint
  readonly rateDate: Date
}

/** The blob's own rate — only ever asked of a blob whose `rateDate` is a date. */
export function blobRate(blob: Pick<SnapshotFacts, 'rate' | 'rateDate'>): StoredRate {
  // UZS per USD in micro units: 11 823.69 is stored as 11 823 690 000.
  return { usdRateMicro: scaled(blob.rate, 1_000_000), rateDate: ruDay(blob.rateDate) }
}

/** The snapshot row exactly as it is stored. `rate` is the blob's own unless given. */
export function snapshotOf(
  blob: SnapshotFacts,
  origin: string,
  totalRows: number,
  importedAt: Date,
  rate: StoredRate = blobRate(blob),
) {
  return {
    sourceUrl: origin,
    usdRateMicro: rate.usdRateMicro,
    rateDate: rate.rateDate,
    updatedLabel: blob.updated,
    today: day(blob.today),
    minDate: day(blob.minDate),
    maxDate: day(blob.maxDate),
    dailyFrom: day(blob.dailyFrom),
    freshFrom: day(blob.freshFrom),
    importedAt,
    // The rows the blob carried — what the shrink guard compares against.
    rowCount: totalRows,
  }
}

export type SnapshotRecord = ReturnType<typeof snapshotOf>

/**
 * Write the snapshot, after the shrink guard. One upsert — no transaction to
 * hold open, no `marketing_daily` write. A blob with a reserve in place of a
 * dated rate takes the bank's rate (`bankRate`), else keeps the stored one
 * (see `isDatedRate`); `rateSource` says which.
 */
export async function saveSnapshot(
  prisma: Pick<PrismaClient, 'marketingSnapshot'>,
  blob: SnapshotFacts,
  origin: string,
  totalRows: number,
  options: { force: boolean; now: Date; bankRate?: () => Promise<BankRate | null>; rates?: DayRates },
): Promise<SnapshotRecord & { readonly rateSource: RateSource }> {
  const previous = await prisma.marketingSnapshot.findUnique({
    where: { id: SNAPSHOT_ID },
    select: { rowCount: true, usdRateMicro: true, rateDate: true },
  })

  if (previous && previous.rowCount > 0 && totalRows < previous.rowCount * SHRINK_GUARD && !options.force) {
    throw new Error(
      `The blob carries ${totalRows} rows but the last import's carried ${previous.rowCount}. ` +
        `That is a ${Math.round((1 - totalRows / previous.rowCount) * 100)}% drop, ` +
        `which is far more likely to be a truncated publish than a real change.\n` +
        `      Re-run with --force if the source really did shrink.`,
    )
  }

  let rate: StoredRate
  let rateSource: RateSource
  // A store that fails is no store: the snapshot is written all the same.
  const keep = async (kept: StoredRate, source: 'roistat' | 'cbu') => options.rates?.keep(kept, source).catch(() => {})
  if (isDatedRate(blob.rateDate)) {
    rate = blobRate(blob)
    rateSource = 'source'
    await keep(rate, 'roistat')
  } else {
    // A bank that cannot be reached is the same answer as no bank: the stored rate stays.
    const bank = options.bankRate ? await options.bankRate().catch(() => null) : null
    const stored = bank ? null : await (options.rates?.latest() ?? Promise.resolve(null)).catch(() => null)
    if (bank) {
      rate = blobRate({ rate: bank.rate, rateDate: bank.date })
      rateSource = 'cbu'
      await keep(rate, 'cbu')
    } else if (stored && (!previous || stored.rateDate > previous.rateDate)) {
      rate = stored
      rateSource = 'stored'
    } else if (previous) {
      rate = { usdRateMicro: previous.usdRateMicro, rateDate: previous.rateDate }
      rateSource = 'previous'
    } else {
      throw new Error(
        `The blob's rate is a reserve (rateDate ${JSON.stringify(blob.rateDate)}, rate ${blob.rate}), ` +
          `the Central Bank did not answer, and there is no earlier rate to keep — nothing written.`,
      )
    }
  }

  const snapshot = snapshotOf(blob, origin, totalRows, options.now, rate)
  await prisma.marketingSnapshot.upsert({
    where: { id: SNAPSHOT_ID },
    create: { id: SNAPSHOT_ID, ...snapshot },
    update: snapshot,
  })
  return { ...snapshot, rateSource }
}
