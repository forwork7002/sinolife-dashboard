/**
 * Ad money no system holds — typed by hand on «Targetologlar · kunlik».
 *
 * The client's «Таргетолог» sheet carries a «Telegram» block beside the
 * targetologs' (Zextra: 09–10.09.2026 390,6 $ a day, 06–07.10.2026 254,9 $):
 * Telegram Ads has no feed the dashboard can read, so the sheet's owner types
 * each day's dollars, and asked for the same here (2026-10-07: «telegramga
 * ketgan xarajatlar ham bo'lishi kerak»). One row per day × project ×
 * channel, in whole cents; a day nobody typed has no row and shows empty.
 */

import { type TargetProduct, TARGET_PRODUCTS, type BrandFilter, brandMatches } from '@/server/domain/types'

export const MANUAL_SPEND_CHANNELS = ['telegram'] as const
export type ManualSpendChannel = (typeof MANUAL_SPEND_CHANNELS)[number]

export const MANUAL_SPEND_PROJECTS = TARGET_PRODUCTS

export const MANUAL_SPEND_NAMES: Readonly<Record<ManualSpendChannel, string>> = Object.freeze({ telegram: 'Telegram' })

/** Typed dollars to whole cents («254,9» → 25 490); null clears the day. */
export function usdToCents(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100)
}

/** A typed day as the repository hands it back. */
export interface ManualSpendRow {
  readonly day: string
  readonly project: TargetProduct
  readonly channel: ManualSpendChannel
  readonly amountCents: number
}

/** One channel's typed dollars for one product, a row per day of the window. */
export interface ManualSpendDto {
  readonly key: string
  readonly channel: ManualSpendChannel
  readonly name: string
  readonly product: TargetProduct
  readonly totalUsd: number
  /** `spendUsd` is null on a day nobody typed — the sheet's empty cell, not a zero. */
  readonly days: readonly { readonly date: string; readonly spendUsd: number | null }[]
}

/**
 * The typed rows onto the window's days: every channel × project the brand
 * switch admits, in the products' order, each with its total. Under
 * «Brendsiz» nothing is typed by hand, so the list is empty.
 */
export function manualSpendBlocks(days: readonly string[], rows: readonly ManualSpendRow[], brand: BrandFilter): ManualSpendDto[] {
  const at = new Map(days.map((d, i) => [d, i] as const))
  const out: ManualSpendDto[] = []
  for (const product of MANUAL_SPEND_PROJECTS) {
    if (!brandMatches(brand, product)) continue
    for (const channel of MANUAL_SPEND_CHANNELS) {
      const cells: (number | null)[] = days.map(() => null)
      let total = 0
      for (const r of rows) {
        const i = at.get(r.day)
        if (r.project !== product || r.channel !== channel || i === undefined) continue
        cells[i] = (cells[i] ?? 0) + r.amountCents
        total += r.amountCents
      }
      out.push({
        key: `${product}|${channel}`,
        channel,
        name: MANUAL_SPEND_NAMES[channel],
        product,
        totalUsd: total / 100,
        days: days.map((date, i) => ({ date, spendUsd: cells[i] === null ? null : cells[i]! / 100 })),
      })
    }
  }
  return out
}
