/**
 * «Roistat» — folding the Bitrix24 cohort rows and the Meta rows into the
 * screen's twelve cuts. Pure: no framework, no database.
 *
 * WHERE SPEND MAY GO. Meta and Bitrix24 never meet on a row (no UTM), so a
 * dollar is only placed beside leads where the placing is a fact, not a
 * guess:
 *
 *   days       — the ad account's reporting day is a Tashkent day.
 *   targetolog — each ad account has one owner (`META_ACCOUNT_OWNERS`), and a
 *                lead form names its owner the same way (`formOwner`).
 *   product    — the account's product, as RNP's ad budget reads it.
 *
 * Everywhere else — form, source, region, ROP, seller, registrar — no dollar
 * can be tied to a row, and the column says so instead of inventing a split.
 *
 * WHICH DOLLARS. The AD BUDGET, as RNP's «Жами бюджет» and «Lidlar»'s
 * «Квал лид нархи» read it (`adBudgetProduct`): Collagen and Zextra money,
 * hiring campaigns and unmapped accounts (Kosmetika, «Newgen») left out — so
 * this screen's CPL and ROAS price the same money the client already
 * reconciles there. On the targetolog cut only a FORM campaign's money is the
 * targetolog's: a targetolog meets his leads through his form's name, and a
 * DM lead reaches no targetolog at all, so DM and other-objective money sits
 * in a row of its own rather than raising every targetolog's CPL.
 */

import { formNameOf, formOwner } from '@/server/domain/leads/leadSources'
import type { TargetProduct } from '@/server/domain/types'

/** The spelling of an empty dimension value on every Bitrix cut. */
export const ROISTAT_NOT_STATED = '— не указано —'
/** Spend or leads that no product claims. */
export const ROISTAT_NO_PRODUCT = 'Boshqa'
/** Ad-budget money that bought no form lead: DM and other objectives. */
export const ROISTAT_NOT_FORM = 'DM va boshqa reklama'

export type RoistatDim =
  | 'camp'
  | 'adset'
  | 'ad'
  | 'targetolog'
  | 'form'
  | 'source'
  | 'product'
  | 'region'
  | 'rop'
  | 'seller'
  | 'registrator'
  | 'days'

export const ROISTAT_DIMS = [
  'camp',
  'adset',
  'ad',
  'targetolog',
  'form',
  'source',
  'product',
  'region',
  'rop',
  'seller',
  'registrator',
  'days',
] as const satisfies readonly RoistatDim[]

/** Additive counters. Spend in micro-dollars, money in minor units — as stored. */
export interface RoistatCounters {
  spendMicroUsd: bigint
  impressions: number
  reach: number
  clicks: number
  metaLeads: number
  leads: number
  clean: number
  kval: number
  orders: number
  orderedMinor: bigint
  sold: number
  soldMinor: bigint
  newCustomers: number
  dealDaysSum: number
  dealCount: number
}

export function emptyCounters(): RoistatCounters {
  return {
    spendMicroUsd: 0n,
    impressions: 0,
    reach: 0,
    clicks: 0,
    metaLeads: 0,
    leads: 0,
    clean: 0,
    kval: 0,
    orders: 0,
    orderedMinor: 0n,
    sold: 0,
    soldMinor: 0n,
    newCustomers: 0,
    dealDaysSum: 0,
    dealCount: 0,
  }
}

/** `into += from`, field by field. */
export function addCounters(into: RoistatCounters, from: Partial<RoistatCounters>): RoistatCounters {
  into.spendMicroUsd += from.spendMicroUsd ?? 0n
  into.impressions += from.impressions ?? 0
  into.reach += from.reach ?? 0
  into.clicks += from.clicks ?? 0
  into.metaLeads += from.metaLeads ?? 0
  into.leads += from.leads ?? 0
  into.clean += from.clean ?? 0
  into.kval += from.kval ?? 0
  into.orders += from.orders ?? 0
  into.orderedMinor += from.orderedMinor ?? 0n
  into.sold += from.sold ?? 0
  into.soldMinor += from.soldMinor ?? 0n
  into.newCustomers += from.newCustomers ?? 0
  into.dealDaysSum += from.dealDaysSum ?? 0
  into.dealCount += from.dealCount ?? 0
  return into
}

/** Which column groups a cut can honestly fill. */
export interface RoistatColumns {
  readonly meta: boolean
  readonly leads: boolean
  readonly spend: boolean
  readonly sales: boolean
}

export function columnsOf(dim: RoistatDim): RoistatColumns {
  switch (dim) {
    case 'camp':
    case 'adset':
    case 'ad':
      // No lead can be tied to an ad (UTM is empty), so Meta's figures stand alone.
      return { meta: true, leads: false, spend: true, sales: false }
    case 'days': // the reference's «Дни» has no Meta group — Расход, then leads and sales (2026-10-05)
    case 'targetolog':
    case 'product':
      return { meta: false, leads: true, spend: true, sales: true }
    case 'form':
    case 'source':
    case 'registrator':
      return { meta: false, leads: true, spend: false, sales: true }
    case 'region':
    case 'rop':
    case 'seller':
      // A Регистрация lead carries no region, team or seller yet — only its sale does.
      return { meta: false, leads: false, spend: false, sales: true }
  }
}

/** The Bitrix24 grouping-set row, as the repository returns it. */
export interface BitrixCutRow {
  readonly set: 'total' | 'day' | 'form' | 'source' | 'product' | 'region' | 'rop' | 'seller' | 'registrar'
  readonly day: string | null
  readonly sourceId: string | null
  readonly sourceName: string | null
  readonly formTitle: string | null
  readonly targetolog: string | null
  readonly productLine: string | null
  readonly region: string | null
  readonly rop: string | null
  readonly seller: string | null
  readonly registrar: string | null
  readonly leads: number
  readonly clean: number
  readonly kval: number
  readonly orders: number
  readonly orderedMinor: bigint
  readonly sold: number
  readonly soldMinor: bigint
  readonly newCustomers: number
  readonly dealDaysSum: number
  readonly dealCount: number
}

/** A Meta campaign-day with its owner and channel already resolved by the caller. */
export interface SpendDay {
  readonly date: string
  readonly targetolog: string
  /** `adBudgetProduct`: null when the money is not ad budget (hiring, an unmapped account). */
  readonly product: TargetProduct | null
  /** A lead-form campaign (`campaignChannel` = form). */
  readonly form: boolean
  readonly spendMicroUsd: bigint
  readonly impressions: number
  readonly clicks: number
  readonly metaLeads: number
}

/** The product a sales deal's own «Товар» field names, when it names one. */
export function productOfLine(productLine: string | null): TargetProduct | null {
  if (!productLine) return null
  if (/zextra|зекстра|зэкстра/i.test(productLine)) return 'Zextra'
  if (/collagen|коллаген|колаген/i.test(productLine)) return 'Collagen'
  return null
}

/**
 * The cut a Bitrix row belongs to, by its grouping set — null when the row
 * is not this cut's. Targetolog and form share one set (form title +
 * targetolog field), read two ways.
 */
const SET_OF: Partial<Record<RoistatDim, BitrixCutRow['set']>> = {
  days: 'day',
  targetolog: 'form',
  form: 'form',
  source: 'source',
  product: 'product',
  region: 'region',
  rop: 'rop',
  seller: 'seller',
  registrator: 'registrar',
}

/**
 * A row's label on a cut. `brandOf` is RNP's `leadBrand` (source, then form),
 * passed in so this file stays free of the service layer.
 */
export function bitrixLabel(
  dim: RoistatDim,
  row: BitrixCutRow,
  brandOf: (sourceId: string | null, formTitle: string | null) => TargetProduct | null,
): string {
  const stated = (value: string | null) => value ?? ROISTAT_NOT_STATED
  switch (dim) {
    case 'days':
      return stated(row.day)
    case 'targetolog': {
      // The form names its owner as the ad account map spells it; the field is the fallback.
      const form = formNameOf(row.formTitle)
      return (form ? formOwner(form)?.targetolog : null) ?? stated(row.targetolog)
    }
    case 'form':
      return stated(formNameOf(row.formTitle))
    case 'source':
      return stated(row.sourceName)
    case 'product':
      return brandOf(row.sourceId, row.formTitle) ?? productOfLine(row.productLine) ?? ROISTAT_NO_PRODUCT
    case 'region':
      return stated(row.region)
    case 'rop':
      return stated(row.rop)
    case 'seller':
      return stated(row.seller)
    case 'registrator':
      return stated(row.registrar)
    default:
      return ROISTAT_NOT_STATED
  }
}

/** The Bitrix24 counters of one cut, by label. */
export function bitrixCut(
  dim: RoistatDim,
  rows: readonly BitrixCutRow[],
  brandOf: (sourceId: string | null, formTitle: string | null) => TargetProduct | null,
): Map<string, RoistatCounters> {
  const out = new Map<string, RoistatCounters>()
  const set = SET_OF[dim]
  if (!set) return out
  /*
    A cut with no lead columns (region, ROP, seller) is grouped by a field
    only the SALE carries, so every lead lands in its null group. Its lead
    counts are dropped here, and a group left with nothing is not a row.
  */
  const withLeads = columnsOf(dim).leads
  for (const row of rows) {
    if (row.set !== set) continue
    if (!withLeads && row.orders === 0 && row.sold === 0) continue
    const label = bitrixLabel(dim, row, brandOf)
    const counters = withLeads ? row : { ...row, leads: 0, clean: 0, kval: 0 }
    addCounters(out.get(label) ?? out.set(label, emptyCounters()).get(label)!, counters)
  }
  return out
}

/** The grand total row of the scan. */
export function bitrixTotal(rows: readonly BitrixCutRow[]): RoistatCounters {
  const total = rows.find((r) => r.set === 'total')
  if (!total) throw new Error('roistat: the grand-total grouping set is missing')
  return addCounters(emptyCounters(), total)
}

/**
 * The scan narrowed to the rows `keep` accepts — one brand, on the Collagen /
 * Zextra switch. A brand-keyed scan returns each grouping set split by the
 * brand inputs, so a cut's label repeats; `bitrixCut` sums by label and takes
 * that as it is. The grand total is the one set read as a single row, so its
 * kept pieces are folded back into one (a zero row when none is kept).
 */
export function narrowBitrix<R extends BitrixCutRow>(rows: readonly R[], keep: (row: R) => boolean): BitrixCutRow[] {
  const total = emptyCounters()
  const out: BitrixCutRow[] = []
  for (const row of rows) {
    if (!keep(row)) continue
    if (row.set === 'total') addCounters(total, row)
    else out.push(row)
  }
  out.push({
    set: 'total',
    day: null,
    sourceId: null,
    sourceName: null,
    formTitle: null,
    targetolog: null,
    productLine: null,
    region: null,
    rop: null,
    seller: null,
    registrar: null,
    leads: total.leads,
    clean: total.clean,
    kval: total.kval,
    orders: total.orders,
    orderedMinor: total.orderedMinor,
    sold: total.sold,
    soldMinor: total.soldMinor,
    newCustomers: total.newCustomers,
    dealDaysSum: total.dealDaysSum,
    dealCount: total.dealCount,
  })
  return out
}

/** Ad-budget spend (and Meta's own counts) placed on a cut that can carry it. */
export function spendCut(dim: RoistatDim, days: readonly SpendDay[]): Map<string, RoistatCounters> {
  const out = new Map<string, RoistatCounters>()
  if (dim !== 'days' && dim !== 'targetolog' && dim !== 'product') return out
  for (const d of days) {
    if (d.product === null) continue
    const label =
      dim === 'days' ? d.date : dim === 'product' ? d.product : d.form ? d.targetolog : ROISTAT_NOT_FORM
    addCounters(out.get(label) ?? out.set(label, emptyCounters()).get(label)!, {
      spendMicroUsd: d.spendMicroUsd,
      impressions: d.impressions,
      clicks: d.clicks,
      metaLeads: d.metaLeads,
    })
  }
  return out
}

/** Every ad-budget dollar and Meta count of the window. */
export function spendTotal(days: readonly SpendDay[]): RoistatCounters {
  const total = emptyCounters()
  for (const d of days) {
    if (d.product === null) continue
    addCounters(total, {
      spendMicroUsd: d.spendMicroUsd,
      impressions: d.impressions,
      clicks: d.clicks,
      metaLeads: d.metaLeads,
    })
  }
  return total
}

/** Two cuts laid over each other by label: a key on either side is a row. */
export function mergeCuts(...cuts: readonly Map<string, RoistatCounters>[]): Map<string, RoistatCounters> {
  const out = new Map<string, RoistatCounters>()
  for (const cut of cuts) {
    for (const [label, counters] of cut) {
      addCounters(out.get(label) ?? out.set(label, emptyCounters()).get(label)!, counters)
    }
  }
  return out
}

/** Every calendar day from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const last = new Date(`${to}T00:00:00Z`).getTime()
  for (let at = new Date(`${from}T00:00:00Z`).getTime(); at <= last; at += 86_400_000) {
    out.push(new Date(at).toISOString().slice(0, 10))
  }
  return out
}
