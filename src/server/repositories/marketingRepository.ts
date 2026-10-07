/**
 * The Roistat snapshot — the one row of it anything still reads.
 *
 * `scripts/importRoistat.ts` reads the client's published Roistat page and,
 * since 2026-10-07, writes only `marketing_snapshot` (`marketing_daily` is
 * kept, no longer written or read). The screen that read the ledger was
 * deleted on 2026-09-30; what is left is «Target tahlili» borrowing the
 * snapshot's UZS/USD rate for ROAS. Nothing here joins a Bitrix24 table, and
 * there must never be a foreign key between the two sides (see the Marketing
 * block in prisma/schema.prisma).
 */

import type { PrismaClient } from '@/generated/prisma/client'

/** The one snapshot row, id = 'roistat'. Dates as the source states them. */
export interface MarketingSnapshotRow {
  readonly sourceUrl: string
  /** UZS per USD in micro units. 11 823.69 is stored as 11 823 690 000. */
  readonly usdRateMicro: bigint
  readonly rateDate: string
  /** `D.updated` verbatim — a label, not an instant. The blob names no zone. */
  readonly updatedLabel: string
  readonly today: string
  readonly minDate: string
  readonly maxDate: string
  readonly dailyFrom: string
  readonly freshFrom: string
  readonly importedAt: Date
  readonly rowCount: number
}

/** A `@db.Date` column as a bare calendar date, which is what it is. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export class MarketingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Provenance for the whole import. Null before the first successful run. */
  async snapshot(): Promise<MarketingSnapshotRow | null> {
    const row = await this.prisma.marketingSnapshot.findUnique({ where: { id: 'roistat' } })
    if (!row) return null

    return {
      sourceUrl: row.sourceUrl,
      usdRateMicro: row.usdRateMicro,
      rateDate: isoDate(row.rateDate),
      updatedLabel: row.updatedLabel,
      today: isoDate(row.today),
      minDate: isoDate(row.minDate),
      maxDate: isoDate(row.maxDate),
      dailyFrom: isoDate(row.dailyFrom),
      freshFrom: isoDate(row.freshFrom),
      importedAt: row.importedAt,
      rowCount: row.rowCount,
    }
  }
}
