/**
 * «Kunlar boʻyicha · Bitrix24 ↔ MoySklad» on «KPI rejalari» (the client,
 * 2026-10-22: «har bir buyurtmadagi tovarlar farqi moy sklad va bitrix24da»,
 * then «sanalar boʻyicha chiqishi kerak har biri»): the two cards above it —
 * «Нутрицолог»'s order counts and «Tovarlar»'s pieces and soʻm — cut by day,
 * each day opening onto its orders and every product of each.
 *
 * A DAY IS THE CARDS' OWN FIGURES OVER THAT DAY'S DEALS. The cohort is the
 * deals queued in the window (`queueSql`'s `queued_at`), so each deal belongs
 * to the Tashkent day it was queued on, and the days partition the window.
 * A day's orders are `sverkaTotals` over its lines and its pieces and soʻm
 * are `productRows` over them — the very functions the cards call over the
 * whole window. Both are sums over lines, so the days add up to the cards to
 * the order, the piece and the soʻm; nothing here counts by a rule of its own.
 *
 * Pure: no Prisma, no framework.
 */

import { zonedDateKey } from '@/server/domain/period/period'

import type { NutritionistBrand } from './nutritionist'
import { type ProductBasis, type SverkaLine, itemKey, moyskladPhase, productRows, sverkaTotals } from './sverka'

/** A cohort line and the brand whose cohort it is (`SverkaService.brandLines`). */
export interface BrandLine {
  readonly brand: NutritionistBrand
  readonly line: SverkaLine
}

export interface DaySide {
  /** Orders as the «Нутрицолог» card counts them. */
  readonly orders: number
  /** Pieces as the «Tovarlar» card counts them. */
  readonly pieces: number
  /** Soʻm (tiyin) as the «Tovarlar» card counts them — the product lines' totals. */
  readonly amountMinor: bigint
}

export interface SverkaDay {
  /** The Tashkent day the deals were queued on, YYYY-MM-DD; null for a deal with no queue date. */
  readonly day: string | null
  readonly bitrix: DaySide
  readonly moysklad: DaySide
  /** The day's orders whose two sides disagree (`orderVerdict` other than 'same' or 'beforeFloor'). */
  readonly mismatched: number
}

/**
 * Where an order stands between the two systems under `basis`:
 *   same        — on both sides, every product to the piece and the soʻm;
 *   products    — on both sides, some product's pieces or soʻm differ;
 *   noMoysklad  — counted by Bitrix24 only (FAKT 1: no MoySklad order; FAKT 2:
 *                 MoySklad does not call it Успешно / Касса);
 *   noBitrix    — counted by MoySklad only (FAKT 2: MoySklad calls it
 *                 delivered, Bitrix24 does not);
 *   beforeFloor — queued before MoySklad held any order: Bitrix24's count
 *                 keeps it, the pieces leave it out (`productRows`).
 */
export type OrderVerdict = 'same' | 'products' | 'noMoysklad' | 'noBitrix' | 'beforeFloor'

export interface DayOrderItem {
  readonly key: string
  readonly name: string
  readonly bitrixQuantity: number
  readonly moyskladQuantity: number
  readonly bitrixMinor: bigint
  readonly moyskladMinor: bigint
}

export interface DayOrder {
  readonly brand: NutritionistBrand
  readonly line: SverkaLine
  /** Counted on Bitrix24's side of `basis`. */
  readonly inBitrix: boolean
  /** Counted on MoySklad's side of `basis`. */
  readonly inMoysklad: boolean
  readonly verdict: OrderVerdict
  /**
   * The products of the sides it is counted on — what its pieces add to the
   * day. Named by MoySklad where it has the product, as `productRows` names.
   */
  readonly items: readonly DayOrderItem[]
}

/** The Tashkent day a cohort deal belongs to. */
export function lineDay(line: SverkaLine, timeZone: string): string | null {
  const at = line.bitrix?.queuedAt
  return at ? zonedDateKey(at, timeZone) : null
}

/**
 * Which sides of `basis` count this line — `sverkaTotals`' order rules:
 * FAKT 1 is Bitrix24's FAKT 1 deals and those of them MoySklad has an order
 * for; FAKT 2 is Bitrix24's delivered deals and the deals MoySklad's order
 * calls delivered (Успешно / Касса).
 */
export function basisSides(line: SverkaLine, basis: ProductBasis): { bitrix: boolean; moysklad: boolean } {
  const bx = line.bitrix
  if (!bx) return { bitrix: false, moysklad: false }
  const ms = line.moysklad
  return basis === 'FAKT1'
    ? { bitrix: bx.fakt1, moysklad: bx.fakt1 && ms !== null }
    : { bitrix: bx.delivered, moysklad: ms !== null && moyskladPhase(ms.stateName) === 'DELIVERED' }
}

const sideOf = (orders: number, rows: ReturnType<typeof productRows>, side: 'bitrix' | 'moysklad'): DaySide => ({
  orders,
  pieces: rows.reduce((n, r) => n + (side === 'bitrix' ? r.bitrixQuantity : r.moyskladQuantity), 0),
  amountMinor: rows.reduce((n, r) => n + (side === 'bitrix' ? r.bitrixMinor : r.moyskladMinor), 0n),
})

/** A day's figures — the cards' own functions over the day's lines. */
function dayFigures(day: string | null, lines: readonly SverkaLine[], basis: ProductBasis): SverkaDay {
  const totals = sverkaTotals(lines)
  const pair = basis === 'FAKT1' ? totals.fakt1 : totals.fakt2
  const rows = productRows(lines, basis)
  const mismatched = lines.reduce((n, line) => {
    const { verdict } = orderOf(line, basis)
    return verdict === 'same' || verdict === 'beforeFloor' ? n : n + 1
  }, 0)
  return {
    day,
    bitrix: sideOf(pair.bitrix.orders, rows, 'bitrix'),
    moysklad: sideOf(pair.moysklad.orders, rows, 'moysklad'),
    mismatched,
  }
}

/**
 * The days of the window that hold an order under `basis`, newest first, and
 * their sum — which equals the cards over the same lines.
 */
export function sverkaDays(
  lines: readonly BrandLine[],
  basis: ProductBasis,
  timeZone: string,
): { days: SverkaDay[]; total: SverkaDay } {
  const byDay = new Map<string | null, SverkaLine[]>()
  for (const { line } of lines) {
    const sides = basisSides(line, basis)
    if (!sides.bitrix && !sides.moysklad) continue
    const day = lineDay(line, timeZone)
    const list = byDay.get(day) ?? []
    list.push(line)
    byDay.set(day, list)
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
    .map(([day, dayLines]) => dayFigures(day, dayLines, basis))
  const total = dayFigures(
    null,
    lines.map((l) => l.line),
    basis,
  )
  return { days, total }
}

/** One order under `basis`: the sides it counts on, its products there, and the verdict. */
export function dayOrder(entry: BrandLine, basis: ProductBasis): DayOrder {
  return { brand: entry.brand, line: entry.line, ...orderOf(entry.line, basis) }
}

function orderOf(line: SverkaLine, basis: ProductBasis): Omit<DayOrder, 'brand' | 'line'> {
  const sides = basisSides(line, basis)
  const items = new Map<string, { name: string; named: boolean; bq: number; mq: number; bm: bigint; mm: bigint }>()
  const row = (item: { code: string | null; name: string }) => {
    const key = itemKey(item)
    let r = items.get(key)
    if (!r) {
      r = { name: item.name, named: false, bq: 0, mq: 0, bm: 0n, mm: 0n }
      items.set(key, r)
    }
    return r
  }
  if (sides.bitrix) {
    for (const item of line.bitrix?.items ?? []) {
      const r = row(item)
      r.bq += item.quantity
      r.bm += item.totalMinor
    }
  }
  if (sides.moysklad) {
    for (const item of line.moysklad?.items ?? []) {
      const r = row(item)
      r.mq += item.quantity
      r.mm += item.totalMinor
      if (!r.named) {
        r.name = item.name
        r.named = true
      }
    }
  }
  const list: DayOrderItem[] = [...items.entries()]
    .map(([key, r]) => ({
      key,
      name: r.name,
      bitrixQuantity: r.bq,
      moyskladQuantity: r.mq,
      bitrixMinor: r.bm,
      moyskladMinor: r.mm,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  // A gap under one whole piece or one whole soʻm is float or tiyin noise — the cards' `gapIsZero` rule.
  const differs = list.some(
    (i) =>
      Math.round(i.moyskladQuantity - i.bitrixQuantity) !== 0 ||
      Math.round(Number(i.moyskladMinor - i.bitrixMinor) / 100) !== 0,
  )
  const verdict: OrderVerdict = line.beforeFloor
    ? 'beforeFloor'
    : sides.bitrix && !sides.moysklad
      ? 'noMoysklad'
      : !sides.bitrix && sides.moysklad
        ? 'noBitrix'
        : differs
          ? 'products'
          : 'same'
  return { inBitrix: sides.bitrix, inMoysklad: sides.moysklad, verdict, items: list }
}

/** The orders of one day under `basis`: differences first, then the bigger order. */
export function dayOrders(lines: readonly BrandLine[], basis: ProductBasis, timeZone: string, day: string): DayOrder[] {
  const rank: Record<OrderVerdict, number> = { noMoysklad: 0, noBitrix: 1, products: 2, beforeFloor: 3, same: 4 }
  return lines
    .filter(({ line }) => {
      const sides = basisSides(line, basis)
      return (sides.bitrix || sides.moysklad) && lineDay(line, timeZone) === day
    })
    .map((entry) => dayOrder(entry, basis))
    .sort((a, b) => {
      const amount = (o: DayOrder) => o.line.bitrix?.amountMinor ?? o.line.moysklad?.sumMinor ?? 0n
      return rank[a.verdict] - rank[b.verdict] || (amount(b) > amount(a) ? 1 : amount(b) < amount(a) ? -1 : 0)
    })
}
