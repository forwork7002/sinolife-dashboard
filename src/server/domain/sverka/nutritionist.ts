/**
 * «Нутрицолог» on «KPI rejalari» (the client, 2026-10-17: «Нутрицолог
 * коллаген факт1 / факт2 сони, Битрикс - Мой складан, 100*2$ = 200$»; Zextra
 * beside it since 2026-10-20 — the RNP sheet carries a «Нутрицолог» cost line
 * under each project): the nutritionist is paid a fixed sum in dollars per
 * order, so the card counts FAKT 1 and FAKT 2 on both systems, brand by brand,
 * and prices each count.
 *
 * The counts are «Sverka»'s, over each brand's cohort only — `sverkaTotals`
 * read for its order counts — so they equal what «Sverka» and Savdo
 * dinamikasi print under that brand's switch. Pure: no Prisma, no framework.
 */

import type { SverkaTotals } from './sverka'

/** What the nutritionist is paid per order, in whole US dollars — one rate for both brands. */
export const NUTRITIONIST_USD_PER_ORDER = 2

/** The brands the card prices, in the order it prints them — the RNP sheet's two projects. */
export const NUTRITIONIST_BRANDS = ['Collagen', 'Zextra'] as const
export type NutritionistBrand = (typeof NUTRITIONIST_BRANDS)[number]

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

export interface NutritionistBrandPay {
  readonly brand: NutritionistBrand
  /** FAKT 1: Bitrix24's FAKT 1 deals; MoySklad's side is those of them it has an order for. */
  readonly fakt1: NutritionistCount
  /** FAKT 2: Bitrix24's delivered deals; MoySklad's side is the deals its order calls Успешно / Касса. */
  readonly fakt2: NutritionistCount
}

export interface NutritionistPay {
  readonly usdPerOrder: number
  /** One entry per `NUTRITIONIST_BRANDS`, in that order. */
  readonly brands: readonly NutritionistBrandPay[]
}

function count(bitrix: number, moysklad: number, rate: number): NutritionistCount {
  return { bitrix, moysklad, bitrixUsd: bitrix * rate, moyskladUsd: moysklad * rate }
}

/** The card's figures off each brand's «Sverka» totals. */
export function nutritionistPay(
  totals: Readonly<Record<NutritionistBrand, Pick<SverkaTotals, 'fakt1' | 'fakt2'>>>,
  rate = NUTRITIONIST_USD_PER_ORDER,
): NutritionistPay {
  return {
    usdPerOrder: rate,
    brands: NUTRITIONIST_BRANDS.map((brand) => ({
      brand,
      fakt1: count(totals[brand].fakt1.bitrix.orders, totals[brand].fakt1.moysklad.orders, rate),
      fakt2: count(totals[brand].fakt2.bitrix.orders, totals[brand].fakt2.moysklad.orders, rate),
    })),
  }
}
