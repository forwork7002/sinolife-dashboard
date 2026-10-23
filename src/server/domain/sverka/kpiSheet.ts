/**
 * «KPI jadvali» on «KPI rejalari» (the client, 2026-10-23: «kpi natijalari
 * boʻlimini … jadval usulida … rnp jadvali vizualidagi jadval koʻrinishida …
 * sanasi boʻladi … excel jadvaldek … moyskladdan ham bitrix24dan aniq
 * maʼlumotlarni tortadi, osmondan olib qoʻymaydi»): the cards below it —
 * «Нутрицолог», «Tovarlar», «Kunlar boʻyicha» — as ONE calendar-month sheet in
 * the RNP grid's shape: a row per figure and system (Bitrix24, MoySklad, the
 * difference), a column per day, the month's total beside the label.
 *
 * EVERY CELL IS THE CARDS' OWN FUNCTION OVER THAT DAY'S DEALS. A day's deals
 * are the cohort deals queued on it (`lineDay`, as `sverkaDays` cuts them);
 * its orders are `sverkaTotals` over them, its pieces and soʻm `productRows`,
 * its differing orders `dayOrder`'s verdict — the very functions «Нутрицолог»,
 * «Tovarlar» and «Kunlar boʻyicha» call. All are sums over lines, so a day
 * column equals that day's row on «Kunlar boʻyicha» and the «Jami» column
 * equals the cards over the month; nothing here counts by a rule of its own.
 *
 * MoySklad's cells are EMPTY, not zero, before it held any order
 * (`MOYSKLAD_DATA_FLOOR`) — a June 2026 day there compares with nothing — and
 * every cell after today is empty: a day not lived yet has no figure.
 *
 * Pure: no Prisma, no framework.
 */

import { zonedDateKey } from '@/server/domain/period/period'

import { type NutritionistBrand, NUTRITIONIST_BRANDS, NUTRITIONIST_USD_PER_ORDER } from './nutritionist'
import { type ProductBasis, MOYSKLAD_DATA_FLOOR, productRows, sverkaTotals } from './sverka'
import { type BrandLine, basisSides, dayOrder, lineDay } from './sverkaDays'

/** Which deals a row reads: both brands, or one. */
export type KpiSheetScope = NutritionistBrand | 'all'

/**
 * What a figure row is: one system's count, their difference (MoySklad −
 * Bitrix24, the cards' ▲ / ▼), or the orders whose two sides disagree.
 */
export type KpiSheetSide = 'bitrix' | 'moysklad' | 'diff' | 'mismatch'

export type KpiSheetUnit = 'count' | 'uzs' | 'usd'

export type KpiSheetLine =
  | {
      readonly kind: 'title'
      readonly key: string
      readonly label: string
      readonly scope: KpiSheetScope
    }
  | {
      readonly kind: 'value'
      readonly key: string
      /** The figure's name — on the first row of its group; '' on the others. */
      readonly label: string
      readonly side: KpiSheetSide
      readonly unit: KpiSheetUnit
      readonly scope: KpiSheetScope
      /** The FAKT figure the row is read under — what a day cell opens onto. */
      readonly basis: ProductBasis
      /** Opens a group of sides — the figure's Bitrix24 row, or a row of its own. */
      readonly opens: boolean
      /** The month. Null when nothing in it can be measured on this side. */
      readonly total: number | null
      /** One per day of the month; null for a day after today, or before MoySklad on its side. */
      readonly days: readonly (number | null)[]
    }

interface Pair {
  readonly bitrix: number
  readonly moysklad: number
}

interface Product {
  readonly key: string
  readonly name: string
}

/** One set of lines read the cards' way, under both FAKT figures. */
interface Figures {
  readonly orders: Readonly<Record<ProductBasis, Pair>>
  readonly pieces: Readonly<Record<ProductBasis, Pair>>
  /** Soʻm — the product lines' totals, as «Tovarlar» and «Kunlar boʻyicha» sum them. */
  readonly amount: Readonly<Record<ProductBasis, Pair>>
  readonly products: Readonly<Record<ProductBasis, ReadonlyMap<string, Pair>>>
  /** In `productRows`' order, named as it names them. */
  readonly productList: Readonly<Record<ProductBasis, readonly Product[]>>
  readonly mismatched: Readonly<Record<ProductBasis, number>>
}

const BASES: readonly ProductBasis[] = ['FAKT1', 'FAKT2']

const som = (minor: bigint): number => Number(minor) / 100

function figuresOf(entries: readonly BrandLine[]): Figures {
  const lines = entries.map((e) => e.line)
  const totals = sverkaTotals(lines)
  const orders = {} as Record<ProductBasis, Pair>
  const pieces = {} as Record<ProductBasis, Pair>
  const amount = {} as Record<ProductBasis, Pair>
  const products = {} as Record<ProductBasis, Map<string, Pair>>
  const productList = {} as Record<ProductBasis, Product[]>
  const mismatched = {} as Record<ProductBasis, number>
  for (const basis of BASES) {
    const pair = basis === 'FAKT1' ? totals.fakt1 : totals.fakt2
    orders[basis] = { bitrix: pair.bitrix.orders, moysklad: pair.moysklad.orders }
    const rows = productRows(lines, basis)
    pieces[basis] = {
      bitrix: rows.reduce((n, r) => n + r.bitrixQuantity, 0),
      moysklad: rows.reduce((n, r) => n + r.moyskladQuantity, 0),
    }
    amount[basis] = {
      bitrix: som(rows.reduce((n, r) => n + r.bitrixMinor, 0n)),
      moysklad: som(rows.reduce((n, r) => n + r.moyskladMinor, 0n)),
    }
    products[basis] = new Map(rows.map((r) => [r.key, { bitrix: r.bitrixQuantity, moysklad: r.moyskladQuantity }]))
    productList[basis] = rows.map((r) => ({ key: r.key, name: r.name }))
    // «Kunlar boʻyicha»'s count: an order on either side whose verdict is a difference.
    mismatched[basis] = entries.reduce((n, entry) => {
      const sides = basisSides(entry.line, basis)
      if (!sides.bitrix && !sides.moysklad) return n
      const { verdict } = dayOrder(entry, basis)
      return verdict === 'same' || verdict === 'beforeFloor' ? n : n + 1
    }, 0)
  }
  return { orders, pieces, amount, products, productList, mismatched }
}

const EMPTY = figuresOf([])

/** The rows that read a pair: Bitrix24, MoySklad, and their difference unless `diff` is false. */
function pairRows(
  head: { readonly key: string; readonly label: string; readonly unit: KpiSheetUnit; readonly scope: KpiSheetScope; readonly basis: ProductBasis },
  month: Figures,
  days: readonly (Figures | null)[],
  measured: readonly boolean[],
  read: (f: Figures) => Pair,
  diff = true,
): KpiSheetLine[] {
  const total = read(month)
  const bitrixDays = days.map((f) => (f === null ? null : read(f).bitrix))
  const moyskladDays = days.map((f, i) => (f === null || !measured[i] ? null : read(f).moysklad))
  const diffDays = days.map((f, i) => (f === null || !measured[i] ? null : read(f).moysklad - read(f).bitrix))
  const anyMeasured = measured.some(Boolean)
  const row = (side: KpiSheetSide, values: readonly (number | null)[], value: number | null): KpiSheetLine => ({
    kind: 'value',
    key: `${head.key}:${side}`,
    label: side === 'bitrix' ? head.label : '',
    side,
    unit: head.unit,
    scope: head.scope,
    basis: head.basis,
    opens: side === 'bitrix',
    total: value,
    days: values,
  })
  const out = [
    row('bitrix', bitrixDays, total.bitrix),
    row('moysklad', moyskladDays, anyMeasured ? total.moysklad : null),
  ]
  if (diff) {
    /*
      The month's difference is the days' — not MoySklad's total less
      Bitrix24's — so a month that starts before MoySklad (June 2026) does not
      count the orders it could not hold as missing from it.
    */
    const gaps = diffDays.filter((v): v is number => v !== null)
    out.push(row('diff', diffDays, gaps.length ? gaps.reduce((a, b) => a + b, 0) : null))
  }
  return out
}

/**
 * The month's sheet. `days` is every day of the calendar month, `today` the
 * Tashkent day it is now; `lines` the month's cohort as `SverkaService` builds
 * it for the cards (`brandLines`), each labelled with its brand.
 */
export function kpiSheet(input: {
  readonly lines: readonly BrandLine[]
  readonly days: readonly string[]
  readonly today: string
  readonly timeZone: string
  readonly usdPerOrder?: number
}): KpiSheetLine[] {
  const { lines, days, today, timeZone } = input
  const rate = input.usdPerOrder ?? NUTRITIONIST_USD_PER_ORDER
  const floor = zonedDateKey(MOYSKLAD_DATA_FLOOR, timeZone)
  const measured = days.map((d) => d >= floor && d <= today)

  const byDay = new Map<string, BrandLine[]>()
  for (const entry of lines) {
    const day = lineDay(entry.line, timeZone)
    if (day === null) continue
    const list = byDay.get(day) ?? []
    list.push(entry)
    byDay.set(day, list)
  }

  const out: KpiSheetLine[] = []
  const scopes: readonly KpiSheetScope[] = ['all', ...NUTRITIONIST_BRANDS]
  for (const scope of scopes) {
    const inScope = (entries: readonly BrandLine[]) => (scope === 'all' ? entries : entries.filter((e) => e.brand === scope))
    const month = figuresOf(inScope(lines))
    const dayFigures = days.map((d) => {
      if (d > today) return null
      const entries = byDay.get(d)
      return entries ? figuresOf(inScope(entries)) : EMPTY
    })
    out.push({
      kind: 'title',
      key: `${scope}:title`,
      // Short enough for one line beside the block's «mos» / «N farq» chip.
      label: scope === 'all' ? 'Collagen + Zextra · jami' : scope,
      scope,
    })
    const pairs = (key: string, label: string, unit: KpiSheetUnit, basis: ProductBasis, read: (f: Figures) => Pair, diff = true) =>
      out.push(...pairRows({ key: `${scope}:${key}:${basis}`, label, unit, scope, basis }, month, dayFigures, measured, read, diff))

    for (const basis of BASES) {
      pairs('orders', `Buyurtmalar · ${faktName(basis)}`, 'count', basis, (f) => f.orders[basis])
    }
    for (const basis of BASES) {
      pairs(
        'nutritionist',
        `Нутрицолог · ${faktName(basis)} × ${rate} $`,
        'usd',
        basis,
        (f) => ({ bitrix: f.orders[basis].bitrix * rate, moysklad: f.orders[basis].moysklad * rate }),
        false,
      )
    }
    for (const basis of BASES) {
      pairs('amount', `Summa · ${faktName(basis)}, soʻm`, 'uzs', basis, (f) => f.amount[basis])
    }
    for (const basis of BASES) {
      pairs('pieces', `Tovar soni · ${faktName(basis)}, dona`, 'count', basis, (f) => f.pieces[basis])
    }
    for (const basis of BASES) {
      out.push({
        kind: 'value',
        key: `${scope}:mismatch:${basis}`,
        label: `Farqli buyurtmalar · ${faktName(basis)}`,
        side: 'mismatch',
        unit: 'count',
        scope,
        basis,
        opens: true,
        total: measured.some(Boolean) ? month.mismatched[basis] : null,
        days: dayFigures.map((f, i) => (f === null || !measured[i] ? null : f.mismatched[basis])),
      })
    }

    // Products per brand only, as «Tovarlar» lists them: the two brands share Omega and Sedana.
    if (scope === 'all') continue
    for (const basis of BASES) {
      const products = month.productList[basis]
      if (products.length === 0) continue
      out.push({ kind: 'title', key: `${scope}:products:${basis}:title`, label: `${scope} tovarlari · ${faktName(basis)} · dona`, scope })
      for (const product of products) {
        const read = (f: Figures): Pair => f.products[basis].get(product.key) ?? { bitrix: 0, moysklad: 0 }
        pairs(`product:${product.key}`, product.name, 'count', basis, read)
      }
    }
  }
  return out
}

function faktName(basis: ProductBasis): string {
  return basis === 'FAKT1' ? 'FAKT 1' : 'FAKT 2'
}

/** Every day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function sheetMonthDays(month: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${month}-01T00:00:00Z`); d.toISOString().startsWith(month); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
