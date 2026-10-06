/**
 * «Sverka» — Bitrix24 against MoySklad, deal by deal (the client, 2026-10-06:
 * «bitrix24 bilan moy skladni solishtiramiz … mahsulot … fakt 2 va fakt 1 …
 * moy skladda shuncha bitrix24da shuncha»).
 *
 * THE TWO SIDES MEET ON THE DEAL ID. The Bitrix24 side is the confirmation
 * queue's cohort — the same orders, FAKT 1 and FAKT 2 as Savdo dinamikasi —
 * and each deal is looked up in MoySklad by the id the client's integration
 * stamped on the order. Nothing here matches by name, phone or sum.
 *
 * WHAT COUNTS AS A DIFFERENCE was read off the live systems on 2026-10-06
 * (357 MoySklad orders of 01–05.10 against their deals):
 * - a sum differs only by a whole soʻm or more — MoySklad carries a discounted
 *   line to the kopeck (2 600 000.01 against the portal's 2 600 000), which is
 *   rounding, not a disagreement;
 * - a seller differs only after trimming and folding case — the portal's
 *   field carried a trailing space on 24 of those 357 orders;
 * - a product is compared by CODE — the Bitrix24 product's XML_ID (an
 *   offer's parent's), which is MoySklad's `externalCode` — never by name:
 *   the portal sells «Sinolife collagen marine kakao» and the warehouse files
 *   it as «Collagen Marine Sinolife».
 *
 * Pure: no Prisma, no framework. The service hands rows in and gets lines out.
 */

/** Below this, two sums are the same sum (1 soʻm, in minor units). */
export const SUM_TOLERANCE_MINOR = 100n

/** Where an order stands, in the four words both systems can say. */
export type SverkaPhase = 'PRE_WAREHOUSE' | 'TRANSIT' | 'DELIVERED' | 'RETURNED' | 'OUTSIDE'

/**
 * MoySklad's seven statuses, measured 2026-10-06: Новый 1, В пути 362,
 * Ожидание / нд 2, Успешно 6 092, Касса 1 366, Отказ 2, Возврат получен 1 952.
 * «Касса» is money banked after «Успешно», so it is delivered too.
 */
export function moyskladPhase(state: string | null): SverkaPhase {
  switch (state?.trim()) {
    case 'Новый':
      return 'PRE_WAREHOUSE'
    case 'В пути':
    case 'Ожидание / нд':
      return 'TRANSIT'
    case 'Успешно':
    case 'Касса':
      return 'DELIVERED'
    case 'Отказ':
    case 'Возврат получен':
      return 'RETURNED'
    default:
      return 'OUTSIDE'
  }
}

/**
 * A Bitrix24 stage's logistics role, folded the same way — READ ONLY IN THE
 * DELIVERY FUNNELS (Доставка C6, Ecommerce C14). Hubs, carriers and the
 * chasing stages are all «В пути» to the warehouse — deal 1071642 stood in
 * CARAVAN while MoySklad said В пути. «Успешно заказ» (SETTLED) is a stamp
 * written after delivery.
 *
 * Every other funnel is OUTSIDE, whatever role its stage carries:
 * `DELIVERY_STAGE_ROLES` also gives Тасдиклаш's SMS / missed-call stages
 * CHASING and its refusals CANCELLED_EARLY, and an order parked there is not
 * «on its way». A confirmed order that went on to «База» (C10) is OUTSIDE too.
 */
export function bitrixPhase(role: string | null, stageExternalId: string | null): SverkaPhase {
  if (!stageExternalId || !/^C(6|14):/.test(stageExternalId)) return 'OUTSIDE'
  switch (role) {
    case 'PREPARING':
    case 'WAREHOUSE':
      return 'PRE_WAREHOUSE'
    case 'IN_TRANSIT':
    case 'REGIONAL_HUB':
    case 'CARRIER':
    case 'CHASING':
      return 'TRANSIT'
    case 'DELIVERED':
    case 'SETTLED':
      return 'DELIVERED'
    case 'REFUSED':
    case 'CANCELLED_EARLY':
      return 'RETURNED'
    default:
      return 'OUTSIDE'
  }
}

/** Whether the two statuses describe the same place. An order not yet packed is still «on its way». */
export function phasesAgree(bitrix: SverkaPhase, moysklad: SverkaPhase): boolean {
  const moving = (p: SverkaPhase) => p === 'PRE_WAREHOUSE' || p === 'TRANSIT'
  if (moving(bitrix) && moving(moysklad)) return true
  return bitrix === moysklad
}

/** «160 Mohlaroy Erkinovna » and «160 mohlaroy  erkinovna» are one person. */
export function normaliseName(name: string | null | undefined): string {
  return (name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru')
}

export type SverkaIssue =
  /** FAKT 1, past the warehouse in Bitrix24, and no MoySklad order. */
  | 'MISSING_IN_MS'
  /** In MoySklad, but Bitrix24 does not count the deal in FAKT 1. */
  | 'NOT_FAKT1'
  /** In MoySklad, and the deal never passed through the confirmation queue. */
  | 'NOT_QUEUED'
  /** In MoySklad, naming a deal Bitrix24 does not have (or no deal at all). */
  | 'NO_DEAL'
  | 'SUM'
  | 'STATUS'
  | 'PRODUCTS'
  | 'SELLER'
  /** Two or more MoySklad orders for one deal. */
  | 'DUPLICATE'

export interface SverkaItem {
  /** MoySklad's externalCode / Bitrix24's XML_ID; null when the product has none. */
  readonly code: string | null
  readonly name: string
  readonly quantity: number
  readonly totalMinor: bigint
}

export interface BitrixSide {
  readonly externalId: string
  readonly amountMinor: bigint
  readonly fakt1: boolean
  readonly delivered: boolean
  readonly logisticsRole: string | null
  /** The current stage's portal id («C6:WON») — which funnel it is in. */
  readonly stageExternalId: string | null
  readonly stageName: string
  readonly seller: string | null
  readonly rop: string | null
  readonly queuedAt: Date | null
  readonly items: readonly SverkaItem[]
}

export interface MoyskladSide {
  /** MoySklad's UUID — the order's address in MoySklad's own UI. */
  readonly orderId: string
  readonly orderName: string
  readonly moment: Date
  readonly stateName: string | null
  readonly sumMinor: bigint
  readonly seller: string | null
  readonly project: string | null
  readonly items: readonly SverkaItem[]
}

/** One deal, both sides, and what disagrees. */
export interface SverkaLine {
  readonly dealId: string | null
  readonly bitrix: BitrixSide | null
  /** The deal's latest MoySklad order — the one compared. */
  readonly moysklad: MoyskladSide | null
  /** How many MoySklad orders name this deal. */
  readonly moyskladOrders: number
  readonly issues: readonly SverkaIssue[]
}

/** Items folded by code — a product without one keyed by its name. */
export function itemKey(item: Pick<SverkaItem, 'code' | 'name'>): string {
  return item.code ? `code:${item.code}` : `name:${normaliseName(item.name)}`
}

function quantities(items: readonly SverkaItem[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const item of items) out.set(itemKey(item), (out.get(itemKey(item)) ?? 0) + item.quantity)
  return out
}

/** Whether two baskets hold the same pieces of the same products. */
export function sameProducts(a: readonly SverkaItem[], b: readonly SverkaItem[]): boolean {
  const qa = quantities(a)
  const qb = quantities(b)
  if (qa.size !== qb.size) return false
  for (const [key, q] of qa) {
    // A missing key is a difference — NaN would compare false and let it pass.
    const other = qb.get(key)
    if (other === undefined || Math.abs(other - q) > 1e-6) return false
  }
  return true
}

/**
 * Compares one cohort deal with its MoySklad orders (newest first).
 */
export function compareDeal(bitrix: BitrixSide, orders: readonly MoyskladSide[]): SverkaLine {
  const issues: SverkaIssue[] = []
  const ms = orders[0] ?? null
  const phase = bitrixPhase(bitrix.logisticsRole, bitrix.stageExternalId)

  if (!ms) {
    /*
      Only an order Bitrix24 has already sent past the warehouse is MISSING.
      «Подготовка товара» and «Заказ в мой склад» are where the warehouse
      order is still being made — waiting, not missing; the line is returned
      with no issue and counted as `pending`.
    */
    if (bitrix.fakt1 && phase !== 'PRE_WAREHOUSE') issues.push('MISSING_IN_MS')
    return { dealId: bitrix.externalId, bitrix, moysklad: null, moyskladOrders: 0, issues }
  }

  if (!bitrix.fakt1) issues.push('NOT_FAKT1')
  if (orders.length > 1) issues.push('DUPLICATE')
  const diff = ms.sumMinor - bitrix.amountMinor
  if (diff >= SUM_TOLERANCE_MINOR || -diff >= SUM_TOLERANCE_MINOR) issues.push('SUM')
  /*
    Only a deal still in a delivery funnel has a place to compare. One that
    moved on to «База» after delivery (the queue keeps it in FAKT 1) is
    OUTSIDE, and «Успешно» against it is no disagreement.
  */
  if (bitrix.fakt1 && phase !== 'OUTSIDE' && !phasesAgree(phase, moyskladPhase(ms.stateName))) {
    issues.push('STATUS')
  }
  if (bitrix.items.length > 0 && !sameProducts(bitrix.items, ms.items)) issues.push('PRODUCTS')
  if (bitrix.seller && ms.seller && normaliseName(bitrix.seller) !== normaliseName(ms.seller)) issues.push('SELLER')

  return { dealId: bitrix.externalId, bitrix, moysklad: ms, moyskladOrders: orders.length, issues }
}

/** A MoySklad order whose deal is not in the window's cohort. */
export type OrphanKind =
  /** The deal is in another window's cohort — not a difference, only counted. */
  | 'OTHER_WINDOW'
  | 'NOT_QUEUED'
  | 'NO_DEAL'

export function orphanLine(dealId: string | null, kind: OrphanKind, orders: readonly MoyskladSide[]): SverkaLine {
  const issues: SverkaIssue[] = kind === 'NOT_QUEUED' ? ['NOT_QUEUED'] : kind === 'NO_DEAL' ? ['NO_DEAL'] : []
  if (orders.length > 1 && dealId) issues.push('DUPLICATE')
  return { dealId, bitrix: null, moysklad: orders[0] ?? null, moyskladOrders: orders.length, issues }
}

export interface SideTotal {
  orders: number
  amountMinor: bigint
}

export interface SverkaPair {
  readonly bitrix: SideTotal
  readonly moysklad: SideTotal
}

const zero = (): SideTotal => ({ orders: 0, amountMinor: 0n })
const add = (t: SideTotal, amount: bigint) => {
  t.orders += 1
  t.amountMinor += amount
}

export interface SverkaTotals {
  /** FAKT 1 against the MoySklad orders of those same deals. */
  readonly fakt1: SverkaPair
  /** FAKT 2 against the cohort deals MoySklad calls Успешно / Касса. */
  readonly fakt2: SverkaPair
  /** On the way, in each system's own words. */
  readonly transit: SverkaPair
  /** Refused or returned, in each system's own words. */
  readonly returned: SverkaPair
  /** FAKT 1 deals whose MoySklad order is still being made. */
  readonly pending: SideTotal
  /** FAKT 1 deals that have a MoySklad order and no difference at all. */
  readonly clean: number
}

/**
 * The tiles, over the cohort's lines only. Each Bitrix24 figure is over FAKT 1
 * deals except FAKT 2, which — like every FAKT 2 on the dashboard — is the
 * cohort's delivered deals whatever their queue outcome.
 */
export function sverkaTotals(lines: readonly SverkaLine[]): SverkaTotals {
  const fakt1 = { bitrix: zero(), moysklad: zero() }
  const fakt2 = { bitrix: zero(), moysklad: zero() }
  const transit = { bitrix: zero(), moysklad: zero() }
  const returned = { bitrix: zero(), moysklad: zero() }
  const pending = zero()
  let clean = 0

  for (const line of lines) {
    const bx = line.bitrix
    if (!bx) continue
    const ms = line.moysklad
    const bxPhase = bitrixPhase(bx.logisticsRole, bx.stageExternalId)
    const msPhase = ms ? moyskladPhase(ms.stateName) : null

    if (bx.delivered) add(fakt2.bitrix, bx.amountMinor)
    if (ms && msPhase === 'DELIVERED') add(fakt2.moysklad, ms.sumMinor)

    if (!bx.fakt1) continue
    add(fakt1.bitrix, bx.amountMinor)
    if (ms) add(fakt1.moysklad, ms.sumMinor)
    if (!ms && bxPhase === 'PRE_WAREHOUSE') add(pending, bx.amountMinor)
    if (bxPhase === 'TRANSIT') add(transit.bitrix, bx.amountMinor)
    if (ms && msPhase === 'TRANSIT') add(transit.moysklad, ms.sumMinor)
    if (bxPhase === 'RETURNED') add(returned.bitrix, bx.amountMinor)
    if (ms && msPhase === 'RETURNED') add(returned.moysklad, ms.sumMinor)
    if (ms && line.issues.length === 0) clean += 1
  }
  return { fakt1, fakt2, transit, returned, pending, clean }
}

export interface ProductRow {
  readonly key: string
  readonly code: string | null
  readonly name: string
  readonly bitrixQuantity: number
  readonly bitrixMinor: bigint
  readonly moyskladQuantity: number
  readonly moyskladMinor: bigint
}

/**
 * Pieces and money per product over the FAKT 1 deals: Bitrix24's product rows
 * against the lines of those deals' MoySklad orders. Named by MoySklad where
 * it has the product — the warehouse's catalogue is the one with one name per
 * code — else by Bitrix24.
 */
export function productRows(lines: readonly SverkaLine[]): ProductRow[] {
  const rows = new Map<
    string,
    { code: string | null; name: string; named: boolean; bq: number; bm: bigint; mq: number; mm: bigint }
  >()
  const row = (item: SverkaItem) => {
    const key = itemKey(item)
    let r = rows.get(key)
    if (!r) {
      r = { code: item.code, name: item.name, named: false, bq: 0, bm: 0n, mq: 0, mm: 0n }
      rows.set(key, r)
    }
    return r
  }
  for (const line of lines) {
    if (!line.bitrix?.fakt1) continue
    for (const item of line.bitrix.items) {
      const r = row(item)
      r.bq += item.quantity
      r.bm += item.totalMinor
    }
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
  return [...rows.entries()]
    .map(([key, r]) => ({
      key,
      code: r.code,
      name: r.name,
      bitrixQuantity: r.bq,
      bitrixMinor: r.bm,
      moyskladQuantity: r.mq,
      moyskladMinor: r.mm,
    }))
    .sort((a, b) => Math.max(b.bitrixQuantity, b.moyskladQuantity) - Math.max(a.bitrixQuantity, a.moyskladQuantity) || a.name.localeCompare(b.name, 'ru'))
}

export interface TeamRow {
  readonly team: string
  readonly bitrix: SideTotal
  readonly moysklad: SideTotal
  readonly issues: number
}

/** FAKT 1 against MoySklad per ROP team (the board's team, off the deal). */
export function teamRows(lines: readonly SverkaLine[], noTeam: string): TeamRow[] {
  const teams = new Map<string, { bitrix: SideTotal; moysklad: SideTotal; issues: number }>()
  for (const line of lines) {
    const bx = line.bitrix
    if (!bx?.fakt1) continue
    const name = bx.rop ?? noTeam
    let t = teams.get(name)
    if (!t) {
      t = { bitrix: zero(), moysklad: zero(), issues: 0 }
      teams.set(name, t)
    }
    add(t.bitrix, bx.amountMinor)
    if (line.moysklad) add(t.moysklad, line.moysklad.sumMinor)
    if (line.issues.length > 0) t.issues += 1
  }
  return [...teams.entries()]
    .map(([team, t]) => ({ team, ...t }))
    .sort((a, b) => (b.bitrix.amountMinor > a.bitrix.amountMinor ? 1 : b.bitrix.amountMinor < a.bitrix.amountMinor ? -1 : 0))
}
