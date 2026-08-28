/**
 * Reads for the Marketing (Roistat) module.
 *
 * TWO LEDGERS IN ONE FILE, AND THAT IS THE WHOLE DESIGN.
 *
 * The first half reads `marketing_daily` / `marketing_snapshot` — the client's
 * own Google Sheets plus Meta Ads, imported verbatim from their published
 * dashboard by `scripts/importRoistat.ts`. The second half reads `deal`,
 * `deal_item`, `employee` and `department` — Bitrix24. Nothing joins them.
 * There is no foreign key between the two sides and there must never be one
 * (see the Marketing block in prisma/schema.prisma): they measure overlapping
 * things by different rules, and a join is how one company's revenue silently
 * becomes two. The only place they meet is `verify()`, where both sides are
 * read separately and reported SIDE BY SIDE with their divergence named.
 *
 * WHY THE TWO HALVES USE DIFFERENT PRISMA APIS
 * The Roistat aggregates are a plain `groupBy` over one table with a summable
 * column list, so the typed API says exactly what it does and the compiler
 * checks the column names. The Bitrix side needs `FILTER (WHERE …)` aggregates
 * and `AT TIME ZONE` day bucketing, neither of which the query builder
 * expresses, so those are raw SQL in the house style (BigInt money crosses the
 * driver as text; `countsAsRevenue` is named in every single one of them —
 * the portal records the same order twice, Доставка then База, and a
 * comparison that forgot this would report Bitrix24 as roughly double Roistat
 * and it would look like a Roistat defect).
 *
 * The queries here are a port of `scripts/verifyRoistat.ts`, deliberately: the
 * script and the endpoint must not be able to disagree about what they measure.
 */

import type { $Enums, PrismaClient } from '@/generated/prisma/client'
import type { MarketingDimension, MarketingRaw } from '@/server/domain/analytics/marketing'

/**
 * Wire name → database enum.
 *
 * Written out rather than `toUpperCase()`-cast: a `Record` keyed by the domain
 * union and valued by the Prisma enum fails to compile the moment either side
 * gains, loses or renames a member, which is the same guarantee
 * `enumParity.ts` gives the other enums.
 */
const DB_DIMENSION: Readonly<Record<MarketingDimension, $Enums.MarketingDimension>> =
  Object.freeze({
    camp: 'CAMP',
    adset: 'ADSET',
    creative: 'CREATIVE',
    targetolog: 'TARGETOLOG',
    form: 'FORM',
    source: 'SOURCE',
    product: 'PRODUCT',
    region: 'REGION',
    rop: 'ROP',
    seller: 'SELLER',
    registrator: 'REGISTRATOR',
    days: 'DAYS',
  })

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

/** One dimension value with its summed counters. */
export interface MarketingKeyRow {
  readonly key: string
  /** Empty string for the flat dimensions — the source's own convention. */
  readonly parent: string
  readonly raw: MarketingRaw
}

/** One day of the DAYS dimension. */
export interface MarketingDayRow {
  readonly date: string
  readonly raw: MarketingRaw
}

/** What one side reports for one key, in units the other side also uses. */
export interface VerifyFacts {
  readonly key: string
  readonly orders: number
  readonly sold: number
  /** UZS minor units. */
  readonly revenueMinor: bigint
}

/** The Bitrix24 cuts that have a Roistat counterpart. */
export type VerifyCut = 'day' | 'region' | 'product' | 'rop' | 'seller'

export interface DateRange {
  readonly from: string
  readonly to: string
}

/** A `@db.Date` column as a bare calendar date, which is what it is. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** Midnight UTC for a `@db.Date` comparison. No zone can shift a date column. */
function dateParam(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/**
 * The sixteen additive columns, named once.
 *
 * `groupBy` needs them in `_sum`; the mapper needs them back out. Listing them
 * in one place is what stops a column being summed but never read.
 */
const SUM_SELECT = {
  leads: true,
  clean: true,
  kval: true,
  orders: true,
  sold: true,
  newCustomers: true,
  spendMicroUsd: true,
  orderedMinor: true,
  soldMinor: true,
  metaRevenueMinor: true,
  dealDaysSum: true,
  dealCount: true,
  impressions: true,
  reach: true,
  clicks: true,
  metaLeads: true,
} as const

/** What Prisma hands back for `_sum` — every field nullable on an empty group. */
interface RawSums {
  leads: number | null
  clean: number | null
  kval: number | null
  orders: number | null
  sold: number | null
  newCustomers: number | null
  spendMicroUsd: bigint | null
  orderedMinor: bigint | null
  soldMinor: bigint | null
  metaRevenueMinor: bigint | null
  dealDaysSum: number | null
  dealCount: number | null
  impressions: bigint | null
  reach: bigint | null
  clicks: bigint | null
  metaLeads: number | null
}

/**
 * `_sum` → `MarketingRaw`.
 *
 * A null sum means the group was empty, which for a counter is zero — the one
 * place in this module where null legitimately becomes 0, because "no rows
 * spent anything" and "spent nothing" are the same statement about spend.
 * Derived rates still go null on the zero denominator that results.
 */
function toRaw(sums: RawSums): MarketingRaw {
  return {
    leads: sums.leads ?? 0,
    clean: sums.clean ?? 0,
    kval: sums.kval ?? 0,
    orders: sums.orders ?? 0,
    sold: sums.sold ?? 0,
    newCustomers: sums.newCustomers ?? 0,
    spendMicroUsd: sums.spendMicroUsd ?? 0n,
    orderedMinor: sums.orderedMinor ?? 0n,
    soldMinor: sums.soldMinor ?? 0n,
    metaRevenueMinor: sums.metaRevenueMinor ?? 0n,
    dealDaysSum: sums.dealDaysSum ?? 0,
    dealCount: sums.dealCount ?? 0,
    impressions: sums.impressions ?? 0n,
    reach: sums.reach ?? 0n,
    clicks: sums.clicks ?? 0n,
    metaLeads: sums.metaLeads ?? 0,
  }
}

/** Asia/Tashkent — the same bucketing every other dated figure uses. */
const TZ = 'Asia/Tashkent'

/**
 * Bitrix24 deals bucketed by the day they were CREATED.
 *
 * The lead-date basis, and the only honest one for this comparison: Roistat
 * attributes collected money to the LEAD's date ("Выручка привязана к дате
 * лида", printed in the footer of their own page) while Bitrix24 books a won
 * deal on its close date. Comparing against won-by-close-date would report a
 * divergence that is pure definition. The close-date total is fetched
 * separately so the size of that definitional gap is visible instead of
 * assumed.
 */
const BITRIX_CREATED_BASIS = `
    d."countsAsRevenue"
    AND (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`

/**
 * The five Bitrix24 cuts.
 *
 * A frozen record rather than five methods so `verifyBitrixFacts` can take the
 * cut as data — and so no caller can hand a string straight into SQL: the key
 * type is the `VerifyCut` union, and anything else fails to compile.
 */
const BITRIX_FACTS_SQL: Readonly<Record<VerifyCut, string>> = Object.freeze({
  day: `
    SELECT (d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date::text AS "key",
           count(*)::int                                                        AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int                      AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
  `,
  region: `
    SELECT coalesce(d."region", '')                                            AS "key",
           count(*)::int                                                       AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int                     AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
  `,
  /*
   * Products come from the line items, not from the deal.
   *
   * `count(DISTINCT d."id")` rather than `count(*)`: a deal carrying two lines
   * of the same product is one order, and counting rows would inflate exactly
   * the dimension the client checks most often. Revenue is the LINE total, so
   * a two-product deal contributes to two products and the column still sums
   * back to the deal — which is itself a reason the two systems differ, since
   * Roistat writes one deal against one product.
   */
  product: `
    SELECT p."name"                                                            AS "key",
           count(DISTINCT d."id")::int                                         AS "orders",
           count(DISTINCT d."id") FILTER (WHERE d."status" = 'WON')::int       AS "sold",
           coalesce(sum(i."totalMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal_item" i
    JOIN "deal" d    ON d."id" = i."dealId"
    JOIN "product" p ON p."id" = i."productId"
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
  `,
  /* ROP = the department the deal's assigned employee belongs to. */
  rop: `
    SELECT coalesce(dep."name", '')                                            AS "key",
           count(*)::int                                                       AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int                     AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    JOIN "employee" e          ON e."id" = d."employeeId"
    LEFT JOIN "department" dep ON dep."id" = e."departmentId"
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
  `,
  seller: `
    SELECT e."fullName"                                                        AS "key",
           count(*)::int                                                       AS "orders",
           count(*) FILTER (WHERE d."status" = 'WON')::int                     AS "sold",
           coalesce(sum(d."amountMinor") FILTER (WHERE d."status" = 'WON'), 0)::text AS "revenue"
    FROM "deal" d
    JOIN "employee" e ON e."id" = d."employeeId"
    WHERE ${BITRIX_CREATED_BASIS}
    GROUP BY 1
  `,
})

/** A money column as Postgres returns it: text, to survive the driver. */
interface RawVerifyRow {
  key: string | null
  orders: number
  sold: number
  revenue: string | null
}

function toVerifyFacts(rows: readonly RawVerifyRow[]): VerifyFacts[] {
  return rows.map((row) => ({
    key: row.key ?? '',
    orders: Number(row.orders ?? 0),
    sold: Number(row.sold ?? 0),
    revenueMinor: row.revenue === null || row.revenue === undefined ? 0n : BigInt(row.revenue),
  }))
}

export class MarketingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Roistat
  // -------------------------------------------------------------------------

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

  /**
   * The DAYS dimension, one row per day, over an arbitrary range.
   *
   * ONE QUERY SERVES THREE READS on the overview. The comparison window ends
   * the day before the current one starts (`previousWindow`), so the two are
   * contiguous: asking for `[previous.from … current.to]` and splitting the
   * days in memory gives the period totals, the comparison totals and the
   * dynamics series without a second round trip, and guarantees all three were
   * computed from the same rows at the same instant.
   *
   * Grouped by date rather than taken row-for-row because the source stores
   * whole-month buckets before `dailyFrom`: one calendar key can carry more
   * than one row, and summing is the only aggregation this data allows.
   */
  async dailyRows(range: DateRange): Promise<MarketingDayRow[]> {
    const groups = await this.prisma.marketingDaily.groupBy({
      by: ['date'],
      where: {
        dimension: DB_DIMENSION.days,
        date: { gte: dateParam(range.from), lte: dateParam(range.to) },
      },
      _sum: SUM_SELECT,
      orderBy: { date: 'asc' },
    })

    return groups.map((group) => ({ date: isoDate(group.date), raw: toRaw(group._sum) }))
  }

  /**
   * One dimension's keys over a window, optionally under one parent.
   *
   * `agg()` in logic.js. The parent filter is the drill-down: adsets of one
   * campaign, creatives of one adset. Passing null means "every key", which
   * for a flat dimension is the only sensible reading — their `pfilt()` only
   * ever returns a parent for adset and creative.
   *
   * No LIMIT. The widest dimension is 1 710 creatives and the table sorts and
   * ranks the whole set; truncating server-side would silently change what
   * "JAMI" means.
   */
  async breakdownRows(
    dimension: MarketingDimension,
    parent: string | null,
    window: DateRange,
  ): Promise<MarketingKeyRow[]> {
    const groups = await this.prisma.marketingDaily.groupBy({
      by: ['key', 'parent'],
      where: {
        dimension: DB_DIMENSION[dimension],
        date: { gte: dateParam(window.from), lte: dateParam(window.to) },
        ...(parent === null ? {} : { parent }),
      },
      _sum: SUM_SELECT,
    })

    return groups.map((group) => ({
      key: group.key,
      parent: group.parent,
      raw: toRaw(group._sum),
    }))
  }

  /** What each dimension actually covers. The ranges differ, and that is data. */
  async coverage(): Promise<{ dimension: string; from: string; to: string }[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { dimension: string; from: string; to: string }[]
    >(`
      SELECT "dimension"::text AS "dimension",
             min("date")::text AS "from",
             max("date")::text AS "to"
      FROM "marketing_daily"
      GROUP BY 1
      ORDER BY 1
    `)
    return rows
  }

  /**
   * The days the DAYS dimension actually says something about.
   *
   * The blob pads its day series out to its own `today` with all-zero rows —
   * in the 2026-08-27 import, 2026-08-12…08-27 carry impressions but no leads,
   * no spend, no orders and no money. Scoring that padding against real
   * Bitrix24 days would report a Roistat shortfall of several hundred orders,
   * which is a reporting artefact rather than a divergence, so the cross-check
   * ends its day window at the last day with any activity.
   */
  async activeDayRange(): Promise<DateRange | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ from: string | null; to: string | null }[]>(`
      SELECT min("date")::text AS "from", max("date")::text AS "to"
      FROM "marketing_daily"
      WHERE "dimension" = 'DAYS'
        AND ("leads" > 0 OR "orders" > 0 OR "sold" > 0
             OR "soldMinor" > 0 OR "orderedMinor" > 0 OR "spendMicroUsd" > 0)
    `)
    const row = rows[0]
    if (!row?.from || !row.to) return null
    return { from: row.from, to: row.to }
  }

  /**
   * Roistat's side of the cross-check: orders, sales and collected money by key.
   *
   * The DAYS dimension is keyed by its own date so it lines up with the
   * Bitrix24 day buckets; every other dimension is keyed by the string the
   * client typed into the sheet, unnormalised, because the report has to be
   * able to say which spellings failed to match.
   */
  async verifyRoistatFacts(
    dimension: MarketingDimension,
    window: DateRange,
  ): Promise<VerifyFacts[]> {
    const keyExpression = dimension === 'days' ? `"date"::text` : `"key"`

    const rows = await this.prisma.$queryRawUnsafe<RawVerifyRow[]>(
      `
      SELECT ${keyExpression}            AS "key",
             sum("orders")::int          AS "orders",
             sum("sold")::int            AS "sold",
             sum("soldMinor")::text      AS "revenue"
      FROM "marketing_daily"
      WHERE "dimension" = $1::"MarketingDimension"
        AND "date" BETWEEN $2::date AND $3::date
      GROUP BY 1
      `,
      DB_DIMENSION[dimension],
      window.from,
      window.to,
    )

    return toVerifyFacts(rows)
  }

  // -------------------------------------------------------------------------
  // Bitrix24 — the other ledger
  // -------------------------------------------------------------------------

  /**
   * Bitrix24's side of one cut, on the lead-date (created) basis.
   *
   * `orders` counts every revenue deal created in the window and `sold` counts
   * the won ones, which is the closest match to the sheet's own two columns.
   * Product is the exception and says so in its own comment.
   */
  async verifyBitrixFacts(cut: VerifyCut, window: DateRange): Promise<VerifyFacts[]> {
    const rows = await this.prisma.$queryRawUnsafe<RawVerifyRow[]>(
      BITRIX_FACTS_SQL[cut],
      TZ,
      window.from,
      window.to,
    )
    return toVerifyFacts(rows)
  }

  /**
   * The same window on Bitrix24's OWN basis: won deals on their close date.
   *
   * Printed beside the created-basis figure so the definitional gap between
   * the two systems is a number on the screen rather than a claim in a
   * footnote. Never used to "correct" either side.
   */
  async verifyBitrixByCloseDate(window: DateRange): Promise<VerifyFacts[]> {
    const rows = await this.prisma.$queryRawUnsafe<RawVerifyRow[]>(
      `
      SELECT (d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date::text AS "key",
             0::int                                                        AS "orders",
             count(*)::int                                                 AS "sold",
             coalesce(sum(d."amountMinor"), 0)::text                       AS "revenue"
      FROM "deal" d
      WHERE d."countsAsRevenue" AND d."status" = 'WON' AND d."closedAt" IS NOT NULL
        AND (d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
      GROUP BY 1
      `,
      TZ,
      window.from,
      window.to,
    )
    return toVerifyFacts(rows)
  }

  /** What Bitrix24 covers on the created basis, so the windows can be intersected. */
  async bitrixCoverage(): Promise<DateRange | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ from: string | null; to: string | null }[]>(
      `
      SELECT min((d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date)::text AS "from",
             max((d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date)::text AS "to"
      FROM "deal" d
      WHERE d."countsAsRevenue"
      `,
      TZ,
    )
    const row = rows[0]
    if (!row?.from || !row.to) return null
    return { from: row.from, to: row.to }
  }
}
