/**
 * «Sverka» — Bitrix24 against MoySklad, for one dashboard window.
 *
 * THE WINDOW IS THE QUEUE ARRIVAL, as on Savdo dinamikasi, Logistika and
 * every FAKT figure: the cohort's deals are taken whole and each is looked up
 * in MoySklad by its id, whenever the warehouse dated its order. So «FAKT 1»
 * here is Savdo dinamikasi's FAKT 1 to the soʻm, and MoySklad's column is the
 * same deals as the warehouse sees them.
 *
 * THE OTHER DIRECTION — MoySklad orders DATED in the window whose deal is not
 * in this cohort — is read too, because that is where an order with no
 * Bitrix24 deal, or one that skipped the queue, shows up. One whose deal
 * simply arrived in another window is no difference and is only counted.
 *
 * Company-wide: the route asks for `analytics:read:all` (see its ACCESS).
 */

import {
  type BitrixSide,
  type MoyskladSide,
  type OrphanKind,
  type SverkaIssue,
  type SverkaItem,
  type SverkaLine,
  type SverkaPhase,
  bitrixPhase,
  compareDeal,
  moyskladPhase,
  orphanLine,
  productDiff,
  productRows,
  regionVerdict,
  ropVerdict,
  sverkaTotals,
  teamRows,
} from '@/server/domain/sverka/sverka'
import type { Period } from '@/server/domain/period/period'
import { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { MoyskladOrderRow, SverkaRepository } from '@/server/repositories/sverkaRepository'

import { LIVE_CACHE, ttlCache } from './ttlCache'

/** Lines sent to the browser at most; the counts above them are always whole. */
export const SVERKA_LINE_LIMIT = 3000

/** The most serious first — the order the issue chips and the table read in. */
export const SVERKA_ISSUES: readonly SverkaIssue[] = [
  'MISSING_IN_MS',
  'NOT_FAKT1',
  'NOT_QUEUED',
  'NO_DEAL',
  'SUM',
  'STATUS',
  'PRODUCTS',
  'SELLER',
  'REGION',
  'ROP',
  'DUPLICATE',
]

export interface SverkaSideDto {
  readonly orders: number
  /** Soʻm. */
  readonly amount: number
}

export interface SverkaPairDto {
  readonly bitrix: SverkaSideDto
  readonly moysklad: SverkaSideDto
}

export interface SverkaItemDto {
  readonly code: string | null
  readonly name: string
  readonly quantity: number
  readonly amount: number
}

export interface SverkaProductDiffDto {
  readonly key: string
  readonly name: string
  readonly bitrixQuantity: number
  readonly moyskladQuantity: number
}

export interface SverkaOtherOrderDto {
  readonly orderId: string
  readonly orderName: string
  readonly moment: string
  readonly state: string | null
  readonly amount: number
}

export interface SverkaLineDto {
  readonly dealId: string | null
  readonly issues: readonly SverkaIssue[]
  /** MoySklad − Bitrix24, soʻm; null when one side is missing. */
  readonly diffAmount: number | null
  /** The products the two baskets disagree on; empty when they agree or a side is missing. */
  readonly productDiff: readonly SverkaProductDiffDto[]
  /** The region and team as compared: null when either side names none the comparison knows. */
  readonly regionMatch: 'same' | 'diff' | null
  readonly ropMatch: 'same' | 'diff' | null
  readonly bitrix: {
    readonly amount: number
    readonly stage: string
    readonly phase: SverkaPhase
    readonly fakt1: boolean
    readonly delivered: boolean
    readonly seller: string | null
    readonly rop: string | null
    readonly ropSource: string | null
    readonly region: string | null
    readonly queuedAt: string | null
    readonly items: readonly SverkaItemDto[]
  } | null
  readonly moysklad: {
    readonly orderId: string
    readonly orderName: string
    readonly moment: string
    readonly state: string | null
    readonly phase: SverkaPhase
    readonly amount: number
    readonly seller: string | null
    readonly project: string | null
    readonly region: string | null
    readonly logistics: string | null
    /** Soʻm MoySklad has received against the order. */
    readonly payed: number
    /** Soʻm MoySklad has shipped against the order. */
    readonly shipped: number
    readonly items: readonly SverkaItemDto[]
  } | null
  readonly moyskladOrders: number
  /** The deal's other MoySklad orders, newest first. */
  readonly otherOrders: readonly SverkaOtherOrderDto[]
}

export interface SverkaProductDto {
  readonly key: string
  readonly code: string | null
  readonly name: string
  readonly bitrixQuantity: number
  readonly bitrixAmount: number
  readonly moyskladQuantity: number
  readonly moyskladAmount: number
}

export interface SverkaTeamDto {
  readonly team: string
  readonly bitrix: SverkaSideDto
  readonly moysklad: SverkaSideDto
  readonly issues: number
}

export interface SverkaOverviewDto {
  readonly totals: {
    readonly fakt1: SverkaPairDto
    readonly fakt2: SverkaPairDto
    readonly transit: SverkaPairDto
    readonly returned: SverkaPairDto
    /** FAKT 1 deals whose MoySklad order is still being made. */
    readonly pending: SverkaSideDto
    /** FAKT 1 deals with a MoySklad order and no difference. */
    readonly clean: number
    /** Every deal in the window's queue cohort. */
    readonly cohortOrders: number
  }
  /** Deals per issue, over every line (not only the ones sent). */
  readonly issueCounts: Readonly<Record<SverkaIssue, number>>
  /**
   * Soʻm at stake per issue, over every line: the gap itself for SUM, the
   * order's money for the rest (Bitrix24's where it has the deal, else
   * MoySklad's). Not summable across issues — one deal can carry several.
   */
  readonly issueAmounts: Readonly<Record<SverkaIssue, number>>
  /** MoySklad orders dated in the window whose deal arrived in another window. */
  readonly otherWindowOrders: number
  readonly lines: readonly SverkaLineDto[]
  /** Every line with a difference — `lines` stops at `SVERKA_LINE_LIMIT`. */
  readonly flaggedCount: number
  readonly linesTruncated: boolean
  readonly products: readonly SverkaProductDto[]
  readonly teams: readonly SverkaTeamDto[]
  readonly moysklad: {
    readonly orders: number
    /** The import's last successful run; null before the first. */
    readonly lastSuccessAt: string | null
    /** The last failure, when it is newer than the last success. */
    readonly lastError: { readonly message: string; readonly at: string } | null
  }
}

const som = (minor: bigint): number => Number(minor) / 100

const itemDto = (i: SverkaItem): SverkaItemDto => ({
  code: i.code,
  name: i.name,
  quantity: i.quantity,
  amount: som(i.totalMinor),
})

function lineDto(line: SverkaLine): SverkaLineDto {
  const bx = line.bitrix
  const ms = line.moysklad
  return {
    dealId: line.dealId,
    issues: line.issues,
    diffAmount: bx && ms ? som(ms.sumMinor - bx.amountMinor) : null,
    productDiff:
      bx && ms && line.issues.includes('PRODUCTS')
        ? productDiff(bx.items, ms.items).map((d) => ({
            key: d.key,
            name: d.name,
            bitrixQuantity: d.bitrixQuantity,
            moyskladQuantity: d.moyskladQuantity,
          }))
        : [],
    regionMatch: bx && ms ? regionVerdict(bx.region, ms.region) : null,
    ropMatch: bx && ms ? ropVerdict(bx.ropSource, ms.project) : null,
    bitrix: bx
      ? {
          amount: som(bx.amountMinor),
          stage: bx.stageName,
          phase: bitrixPhase(bx.logisticsRole, bx.stageExternalId),
          fakt1: bx.fakt1,
          delivered: bx.delivered,
          seller: bx.seller,
          rop: bx.rop,
          ropSource: bx.ropSource,
          region: bx.region,
          queuedAt: bx.queuedAt?.toISOString() ?? null,
          items: bx.items.map(itemDto),
        }
      : null,
    moysklad: ms
      ? {
          orderId: ms.orderId,
          orderName: ms.orderName,
          moment: ms.moment.toISOString(),
          state: ms.stateName,
          phase: moyskladPhase(ms.stateName),
          amount: som(ms.sumMinor),
          seller: ms.seller,
          project: ms.project,
          region: ms.region,
          logistics: ms.logistics,
          payed: som(ms.payedMinor),
          shipped: som(ms.shippedMinor),
          items: ms.items.map(itemDto),
        }
      : null,
    moyskladOrders: line.moyskladOrders,
    otherOrders: line.others.map((o) => ({
      orderId: o.orderId,
      orderName: o.orderName,
      moment: o.moment.toISOString(),
      state: o.stateName,
      amount: som(o.sumMinor),
    })),
  }
}

/** What one line puts at stake under one issue — see `issueAmounts`. */
function stakeOf(line: SverkaLine, issue: SverkaIssue): bigint {
  if (issue === 'SUM' && line.bitrix && line.moysklad) {
    const gap = line.moysklad.sumMinor - line.bitrix.amountMinor
    return gap < 0n ? -gap : gap
  }
  return amountOf(line)
}

const pair = (p: { bitrix: { orders: number; amountMinor: bigint }; moysklad: { orders: number; amountMinor: bigint } }) => ({
  bitrix: { orders: p.bitrix.orders, amount: som(p.bitrix.amountMinor) },
  moysklad: { orders: p.moysklad.orders, amount: som(p.moysklad.amountMinor) },
})

/** Orders grouped by deal, keeping the repository's newest-first order. */
function byDeal(orders: readonly MoyskladOrderRow[]): Map<string | null, MoyskladSide[]> {
  const out = new Map<string | null, MoyskladSide[]>()
  for (const o of orders) {
    const list = out.get(o.bitrixDealId) ?? []
    list.push(o)
    out.set(o.bitrixDealId, list)
  }
  return out
}

/** The most serious issue first, then the bigger order. */
function severity(line: SverkaLine): number {
  const ranks = line.issues.map((i) => SVERKA_ISSUES.indexOf(i))
  return ranks.length ? Math.min(...ranks) : SVERKA_ISSUES.length
}

const amountOf = (line: SverkaLine): bigint => line.bitrix?.amountMinor ?? line.moysklad?.sumMinor ?? 0n

const cache = ttlCache<SverkaOverviewDto>(120_000, LIVE_CACHE)

export class SverkaService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly repository: SverkaRepository,
  ) {}

  async overview(period: Period): Promise<SverkaOverviewDto> {
    const key = [period.preset, period.start.toISOString(), period.end.toISOString()].join('|')
    return cache.get(key, () => this.build(period))
  }

  private async build(period: Period): Promise<SverkaOverviewDto> {
    const cohort = await this.insights.sverkaCohort({ ...period, restrictToEmployeeIds: null })
    const externalIds = cohort.flatMap((d) => (d.externalId ? [d.externalId] : []))

    const [forDeals, inWindow, items, freshness] = await Promise.all([
      this.repository.ordersForDeals(externalIds),
      this.repository.ordersInWindow(period.start, period.end),
      this.repository.dealItems(cohort.map((d) => d.dealId)),
      this.repository.freshness(),
    ])

    const ordersByDeal = byDeal(forDeals)
    const lines: SverkaLine[] = cohort.map((d) => {
      const side: BitrixSide = {
        externalId: d.externalId ?? d.dealId,
        amountMinor: d.amountMinor,
        fakt1: d.fakt1,
        delivered: d.delivered,
        logisticsRole: d.logisticsRole,
        stageExternalId: d.stageExternalId,
        stageName: d.stageName,
        seller: d.sellerSource,
        rop: d.rop,
        ropSource: d.ropSource,
        region: d.region,
        queuedAt: d.queuedAt,
        items: items.get(d.dealId) ?? [],
      }
      return compareDeal(side, d.externalId ? (ordersByDeal.get(d.externalId) ?? []) : [])
    })

    // MoySklad orders dated in the window whose deal is not in the cohort.
    const inCohort = new Set(externalIds)
    const orphans = byDeal(inWindow.filter((o) => !o.bitrixDealId || !inCohort.has(o.bitrixDealId)))
    const orphanIds = [...orphans.keys()].filter((id): id is string => id !== null)
    const known = new Map((await this.repository.dealsByExternalId(orphanIds)).map((d) => [d.externalId, d]))

    let otherWindowOrders = 0
    for (const [dealId, orders] of orphans) {
      if (dealId === null) {
        // No deal named at all: each order is its own line.
        for (const o of orders) lines.push(orphanLine(null, 'NO_DEAL', [o]))
        continue
      }
      const deal = known.get(dealId)
      const kind: OrphanKind = !deal ? 'NO_DEAL' : deal.queuedAt === null ? 'NOT_QUEUED' : 'OTHER_WINDOW'
      if (kind === 'OTHER_WINDOW') {
        otherWindowOrders += orders.length
        continue
      }
      lines.push(orphanLine(dealId, kind, orders))
    }

    const issueCounts = Object.fromEntries(SVERKA_ISSUES.map((i) => [i, 0])) as Record<SverkaIssue, number>
    const stakes = new Map<SverkaIssue, bigint>(SVERKA_ISSUES.map((i) => [i, 0n]))
    for (const line of lines) {
      for (const issue of line.issues) {
        issueCounts[issue] += 1
        stakes.set(issue, (stakes.get(issue) ?? 0n) + stakeOf(line, issue))
      }
    }
    const issueAmounts = Object.fromEntries(SVERKA_ISSUES.map((i) => [i, som(stakes.get(i) ?? 0n)])) as Record<
      SverkaIssue,
      number
    >

    const flagged = lines
      .filter((l) => l.issues.length > 0)
      .sort((a, b) => severity(a) - severity(b) || (amountOf(b) > amountOf(a) ? 1 : amountOf(b) < amountOf(a) ? -1 : 0))

    const totals = sverkaTotals(lines)
    return {
      totals: {
        fakt1: pair(totals.fakt1),
        fakt2: pair(totals.fakt2),
        transit: pair(totals.transit),
        returned: pair(totals.returned),
        pending: { orders: totals.pending.orders, amount: som(totals.pending.amountMinor) },
        clean: totals.clean,
        cohortOrders: cohort.length,
      },
      issueCounts,
      issueAmounts,
      otherWindowOrders,
      lines: flagged.slice(0, SVERKA_LINE_LIMIT).map(lineDto),
      flaggedCount: flagged.length,
      linesTruncated: flagged.length > SVERKA_LINE_LIMIT,
      products: productRows(lines).map((p) => ({
        key: p.key,
        code: p.code,
        name: p.name,
        bitrixQuantity: p.bitrixQuantity,
        bitrixAmount: som(p.bitrixMinor),
        moyskladQuantity: p.moyskladQuantity,
        moyskladAmount: som(p.moyskladMinor),
      })),
      teams: teamRows(lines, InsightsRepository.NO_ROP).map((t) => ({
        team: t.team,
        bitrix: { orders: t.bitrix.orders, amount: som(t.bitrix.amountMinor) },
        moysklad: { orders: t.moysklad.orders, amount: som(t.moysklad.amountMinor) },
        issues: t.issues,
      })),
      moysklad: {
        orders: freshness.orders,
        lastSuccessAt: freshness.lastSuccessAt?.toISOString() ?? null,
        lastError:
          freshness.lastError && freshness.lastErrorAt &&
          (!freshness.lastSuccessAt || freshness.lastErrorAt > freshness.lastSuccessAt)
            ? { message: freshness.lastError, at: freshness.lastErrorAt.toISOString() }
            : null,
      },
    }
  }
}
