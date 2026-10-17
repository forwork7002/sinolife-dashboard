/**
 * «Нутрицолог · Collagen» on «KPI rejalari» (the client, 2026-10-17:
 * «Нутрицолог коллаген факт1 / факт2 сони, Битрикс - Мой складан,
 * 100*2$ = 200$»): the nutritionist is paid a fixed sum in dollars per
 * Collagen order, so the card counts FAKT 1 and FAKT 2 on both systems and
 * prices each count.
 *
 * The counts are «Sverka»'s, over Collagen's cohort only — `sverkaTotals`
 * read for its order counts — so they equal what «Sverka» and Savdo
 * dinamikasi print under the Collagen switch. Pure: no Prisma, no framework.
 */

import type { SverkaTotals } from './sverka'

/** What the nutritionist is paid per Collagen order, in whole US dollars. */
export const NUTRITIONIST_USD_PER_ORDER = 2

export interface NutritionistCount {
  /** Orders as Bitrix24 counts them. */
  readonly bitrix: number
  /** The same deals as MoySklad holds them. */
  readonly moysklad: number
  /** `bitrix` × the rate, in dollars. */
  readonly bitrixUsd: number
  /** `moysklad` × the rate, in dollars. */
  readonly moyskladUsd: number
}

export interface NutritionistPay {
  readonly usdPerOrder: number
  /** FAKT 1: Bitrix24's FAKT 1 deals; MoySklad's side is those of them it has an order for. */
  readonly fakt1: NutritionistCount
  /** FAKT 2: Bitrix24's delivered deals; MoySklad's side is the deals its order calls Успешно / Касса. */
  readonly fakt2: NutritionistCount
}

function count(bitrix: number, moysklad: number, rate: number): NutritionistCount {
  return { bitrix, moysklad, bitrixUsd: bitrix * rate, moyskladUsd: moysklad * rate }
}

/** The card's figures off Collagen's «Sverka» totals. */
export function nutritionistPay(totals: Pick<SverkaTotals, 'fakt1' | 'fakt2'>, rate = NUTRITIONIST_USD_PER_ORDER): NutritionistPay {
  return {
    usdPerOrder: rate,
    fakt1: count(totals.fakt1.bitrix.orders, totals.fakt1.moysklad.orders, rate),
    fakt2: count(totals.fakt2.bitrix.orders, totals.fakt2.moysklad.orders, rate),
  }
}
