/**
 * «Target tahlili» — the service behind `/target/overview` and `/target/leads`.
 *
 * TWO LEDGERS, SIDE BY SIDE AND NEVER ADDED. The Bitrix24 half is the leads
 * the target pages brought in and what became of them (`TargetRepository`).
 * The ad half — spend, the cost of a lead, ROAS, campaigns — is the Roistat
 * ledger (`MarketingService`), the client's own Google Sheets plus Meta Ads.
 * The two count leads by different rules on different clocks, so the screen
 * prints both lead counts next to each other and never divides one ledger's
 * money by the other's count. See the Marketing block in `schema.prisma`.
 */

import { TARGET_SOURCE_IDS } from '@/server/integrations/crm/bitrix24/mapping'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import { type Period, periodLengthInDays, zonedDateKey } from '@/server/domain/period/period'
import {
  NOT_STATED,
  type TargetCountersRow,
  type TargetGroupRow,
  type TargetLeadRow,
  type TargetRepository,
} from '@/server/repositories/targetRepository'
import type { TargetScope } from '@/server/domain/types'

import type { MarketingOverviewDto, MarketingService } from './marketingService'
import { keyPart, ttlCache } from './ttlCache'

// ---------------------------------------------------------------------------
// DTOs — mirrored in `src/lib/api.ts`
// ---------------------------------------------------------------------------

/**
 * One group's leads and what they became.
 *
 * Rates travel unrounded and are NULL over an empty denominator: a source that
 * brought no leads has no pass rate, and 0% would say it brought a hundred
 * that all failed.
 */
export interface TargetCountersDto {
  readonly leads: number
  readonly leadCustomers: number
  readonly leadWon: number
  readonly leadLost: number
  /** leadWon / leads — the registrar passed the lead on. */
  readonly passPercent: number | null
  readonly sales: number
  readonly orders: number
  readonly ordered: MoneyDto
  /** orders / leads — a lead that became an order. */
  readonly orderPercent: number | null
  readonly delivered: number
  readonly deliveredMoney: MoneyDto
  readonly returned: number
  readonly returnedMoney: MoneyDto
  /** delivered / (delivered + returned) — of the parcels that resolved. */
  readonly buyoutPercent: number | null
  readonly inTransit: number
  readonly confirming: number
  readonly sellerLost: number
  /** deliveredMoney / delivered. */
  readonly averageCheque: MoneyDto | null
  /** deliveredMoney / leads — what one lead brought in, on average. */
  readonly revenuePerLead: MoneyDto | null
}

export interface TargetGroupDto extends TargetCountersDto {
  readonly key: string
}

export interface TargetStageDto {
  readonly kind: 'lead' | 'sale'
  readonly pipeline: string
  readonly stage: string
  readonly category: string
  readonly deals: number
  readonly amount: MoneyDto
}

export interface TargetSourceDto {
  readonly name: string
  readonly isTarget: boolean
}

export interface TargetOverviewDto {
  readonly scope: TargetScope
  /** Every source the portal names; `isTarget` marks the seven ad pages. */
  readonly sources: readonly TargetSourceDto[]
  readonly total: TargetCountersDto
  readonly bySource: readonly TargetGroupDto[]
  readonly byTargetolog: readonly TargetGroupDto[]
  readonly byCreative: readonly TargetGroupDto[]
  /** Every day of the window, zero-filled, oldest first. */
  readonly days: readonly TargetGroupDto[]
  readonly stages: readonly TargetStageDto[]
  /** What an empty targetolog / creative / source is filed under. */
  readonly notStated: string
  /**
   * The ad ledger over the same calendar days, or null when it was never
   * imported. Its own window: the ledger clamps to the days it holds.
   */
  readonly ads: Pick<
    MarketingOverviewDto,
    'snapshot' | 'window' | 'current' | 'previous' | 'daily' | 'feedCoverage'
  > | null
}

export interface TargetLeadSaleDto {
  readonly bitrixId: string | null
  readonly createdAt: string
  readonly pipeline: string
  readonly role: string
  readonly stage: string
  readonly status: string
  readonly amount: MoneyDto
  readonly seller: string | null
}

export interface TargetLeadDto {
  readonly bitrixId: string | null
  readonly createdAt: string
  readonly title: string
  readonly customerName: string | null
  readonly phone: string | null
  readonly source: string
  readonly targetolog: string | null
  readonly creative: string | null
  readonly primarySource: string | null
  readonly stage: string
  readonly stageCategory: string
  readonly registrar: string | null
  readonly sale: TargetLeadSaleDto | null
}

// ---------------------------------------------------------------------------

const CURRENCY = 'UZS'

const uzs = (minor: bigint): MoneyDto => toMoneyDto(money(minor, CURRENCY))

/** Percentage, unrounded; null over an empty denominator. */
function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null
}

/** A per-unit money figure, rounded to the minor unit; null over nothing. */
function perUnit(minor: bigint, count: number): MoneyDto | null {
  return count > 0 ? uzs(minor / BigInt(count)) : null
}

export function countersDto(row: TargetCountersRow): TargetCountersDto {
  const resolved = row.delivered + row.returned
  return {
    leads: row.leads,
    leadCustomers: row.leadCustomers,
    leadWon: row.leadWon,
    leadLost: row.leadLost,
    passPercent: percent(row.leadWon, row.leads),
    sales: row.sales,
    orders: row.orders,
    ordered: uzs(row.orderedMinor),
    orderPercent: percent(row.orders, row.leads),
    delivered: row.delivered,
    deliveredMoney: uzs(row.deliveredMinor),
    returned: row.returned,
    returnedMoney: uzs(row.returnedMinor),
    buyoutPercent: percent(row.delivered, resolved),
    inTransit: row.inTransit,
    confirming: row.confirming,
    sellerLost: row.sellerLost,
    averageCheque: perUnit(row.deliveredMinor, row.delivered),
    revenuePerLead: perUnit(row.deliveredMinor, row.leads),
  }
}

const ZERO: TargetCountersRow = {
  leads: 0,
  leadCustomers: 0,
  leadWon: 0,
  leadLost: 0,
  sales: 0,
  orders: 0,
  orderedMinor: 0n,
  delivered: 0,
  deliveredMinor: 0n,
  returned: 0,
  returnedMinor: 0n,
  inTransit: 0,
  confirming: 0,
  sellerLost: 0,
}

/**
 * Every calendar day of the window, with the ones nothing happened on as zeros.
 *
 * A gap in a daily bar chart reads as «no data» on some screens and «zero» on
 * others; here a quiet Sunday is a real zero and must be drawn as one.
 */
export function fillDays(period: Period, rows: readonly TargetGroupRow[]): TargetGroupRow[] {
  const byDay = new Map(rows.map((r) => [r.key, r]))
  const first = zonedDateKey(period.start, period.timeZone)
  const last = zonedDateKey(new Date(period.end.getTime() - 1), period.timeZone)
  const out: TargetGroupRow[] = []
  // Walk calendar days as UTC dates: the keys are already zone-resolved.
  for (
    let day = new Date(`${first}T00:00:00Z`);
    day.toISOString().slice(0, 10) <= last;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const key = day.toISOString().slice(0, 10)
    out.push(byDay.get(key) ?? { key, ...ZERO })
    // Bounded: the period schema caps a range at ten years.
    if (out.length > 4000) break
  }
  return out
}

function leadDto(row: TargetLeadRow): TargetLeadDto {
  return {
    bitrixId: row.bitrixId,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    customerName: row.customerName,
    phone: row.phone,
    source: row.source,
    targetolog: row.targetolog,
    creative: row.creative,
    primarySource: row.primarySource,
    stage: row.stage,
    stageCategory: row.stageCategory,
    registrar: row.registrar,
    sale: row.sale
      ? {
          bitrixId: row.sale.bitrixId,
          createdAt: row.sale.createdAt.toISOString(),
          pipeline: row.sale.pipeline,
          role: row.sale.role,
          stage: row.sale.stage,
          status: row.sale.status,
          amount: uzs(row.sale.amountMinor),
          seller: row.sale.seller,
        }
      : null,
  }
}

/*
  A memo in front of the summary, keyed by the whole question: the window, the
  preset and the source scope. Company-wide by construction — the route refuses
  a narrowed account — so no employee scope reaches it.
*/
const summaryCache = ttlCache<Awaited<ReturnType<TargetRepository['summary']>>>(60_000)

/** Test seam: module-level, so shared between test files inside one worker. */
export function resetTargetCaches(): void {
  summaryCache.clear()
}

/** What `/target/leads` narrows by, already validated by `targetLeadsQuerySchema`. */
export interface TargetLeadsQuery {
  readonly scope: TargetScope
  readonly source?: string
  readonly targetolog?: string
  readonly stage?: string
  readonly q?: string
  readonly page: number
  readonly pageSize: number
}

export class TargetService {
  constructor(
    private readonly repository: TargetRepository,
    private readonly marketing: MarketingService,
  ) {}

  private sourceIds(scope: TargetScope): readonly string[] | null {
    return scope === 'target' ? TARGET_SOURCE_IDS : null
  }

  async overview(
    period: Period,
    scope: TargetScope,
    timeZone: string,
    now: Date,
  ): Promise<TargetOverviewDto> {
    const sourceIds = this.sourceIds(scope)
    const key = [
      period.preset,
      period.start.toISOString(),
      periodLengthInDays(period),
      keyPart(sourceIds ?? null),
    ].join('|')

    const window = {
      from: zonedDateKey(period.start, timeZone),
      to: zonedDateKey(new Date(period.end.getTime() - 1), timeZone),
    }

    const [summary, sources, ads] = await Promise.all([
      summaryCache.get(key, () => this.repository.summary({ period, sourceIds })),
      this.repository.sources(TARGET_SOURCE_IDS),
      this.marketing.overview(window, timeZone, now),
    ])

    const group = (rows: readonly TargetGroupRow[]): TargetGroupDto[] =>
      rows.map((row) => ({ key: row.key, ...countersDto(row) }))

    return {
      scope,
      sources: sources.map((s) => ({ name: s.name, isTarget: s.isTarget })),
      total: countersDto(summary.total),
      bySource: group(summary.sources),
      byTargetolog: group(summary.targetologs),
      byCreative: group(summary.creatives),
      days: group(fillDays(period, summary.days)),
      stages: summary.stages.map((s) => ({
        kind: s.kind,
        pipeline: s.pipeline,
        stage: s.stage,
        category: s.category,
        deals: s.deals,
        amount: uzs(s.amountMinor),
      })),
      notStated: NOT_STATED,
      ads: ads.snapshot
        ? {
            snapshot: ads.snapshot,
            window: ads.window,
            current: ads.current,
            previous: ads.previous,
            daily: ads.daily,
            feedCoverage: ads.feedCoverage,
          }
        : null,
    }
  }

  async leads(
    period: Period,
    query: TargetLeadsQuery,
  ): Promise<{ items: TargetLeadDto[]; totalItems: number }> {
    const { rows, total } = await this.repository.leads({
      period,
      sourceIds: this.sourceIds(query.scope),
      source: query.source,
      targetolog: query.targetolog,
      stage: query.stage,
      search: query.q,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })
    return { items: rows.map(leadDto), totalItems: total }
  }
}
