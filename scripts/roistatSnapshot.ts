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

/** The snapshot row exactly as it is stored. */
export function snapshotOf(blob: SnapshotFacts, origin: string, totalRows: number, importedAt: Date) {
  return {
    sourceUrl: origin,
    // UZS per USD in micro units: 11 823.69 is stored as 11 823 690 000.
    usdRateMicro: scaled(blob.rate, 1_000_000),
    rateDate: ruDay(blob.rateDate),
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
 * hold open, no `marketing_daily` write.
 */
export async function saveSnapshot(
  prisma: Pick<PrismaClient, 'marketingSnapshot'>,
  blob: SnapshotFacts,
  origin: string,
  totalRows: number,
  options: { force: boolean; now: Date },
): Promise<SnapshotRecord> {
  const previous = await prisma.marketingSnapshot.findUnique({
    where: { id: SNAPSHOT_ID },
    select: { rowCount: true },
  })

  if (previous && previous.rowCount > 0 && totalRows < previous.rowCount * SHRINK_GUARD && !options.force) {
    throw new Error(
      `The blob carries ${totalRows} rows but the last import's carried ${previous.rowCount}. ` +
        `That is a ${Math.round((1 - totalRows / previous.rowCount) * 100)}% drop, ` +
        `which is far more likely to be a truncated publish than a real change.\n` +
        `      Re-run with --force if the source really did shrink.`,
    )
  }

  const snapshot = snapshotOf(blob, origin, totalRows, options.now)
  await prisma.marketingSnapshot.upsert({
    where: { id: SNAPSHOT_ID },
    create: { id: SNAPSHOT_ID, ...snapshot },
    update: snapshot,
  })
  return snapshot
}
