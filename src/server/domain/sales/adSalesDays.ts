/**
 * «Kunlar boʻyicha» on Savdo dinamikasi — a row per Tashkent day: the ad
 * money, FAKT 1, and FAKT 1 split into Первичка and База. Pure: no framework,
 * no database.
 *
 * Asked for on 2026-10-05, in place of Roistat's «Дни» cut. That cut is a LEAD
 * cohort (a sale lands on its origin lead's day), so its day never matched the
 * FAKT 1 the floor reconciles. This one is on the floor's own clocks:
 *
 *   FAKT 1   — the confirmation queue cohort by the order's arrival day,
 *              `InsightsRepository.rnpTeamDays`: the hero's figure on this
 *              page and «Сумма ФАКТ 1» on /rnp, to the soʻm.
 *   Первичка — FAKT 1 of every team but БАЗА, the no-team bucket included;
 *   База     — FAKT 1 of the БАЗА teams (`isBaseTeam`): the split of the
 *              sheet's «Первичка усп» / «База усп», on FAKT 1.
 *   Реклама  — the ad budget by the ad account's reporting day
 *              (`adBudgetProduct`: Collagen and Zextra, hiring and unmapped
 *              accounts out) — RNP's «Жами бюджет, $», in dollars as Meta
 *              bills them.
 *
 * So Первичка + База = FAKT 1 on every row, by construction.
 */

import { isBaseTeam } from '@/server/domain/rnp/rnpSheet'

export interface AdSalesTeamDay {
  readonly day: string
  readonly rop: string
  readonly fakt1Minor: bigint
}

export interface AdSalesSpendDay {
  readonly date: string
  /** Null when the money is not ad budget — `adBudgetProduct`. */
  readonly product: string | null
  readonly spendMicroUsd: bigint
}

export interface AdSalesDayRow {
  /** `YYYY-MM-DD`, Tashkent. */
  readonly date: string
  /** Ad budget, dollars with cents. */
  readonly spendUsd: number
  /** FAKT 1, whole soʻm. */
  readonly fakt1: number
  readonly primary: number
  readonly base: number
}

export interface AdSalesDays {
  /** Oldest day first, as a sheet reads. */
  readonly rows: readonly AdSalesDayRow[]
  readonly total: Omit<AdSalesDayRow, 'date'>
  /** Today, when it is a row: its Meta money and FAKT 1 are still arriving. */
  readonly openDay: string | null
}

/** Every calendar day from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
export function daysFrom(from: string, to: string): string[] {
  const out: string[] = []
  const last = Date.parse(`${to}T00:00:00Z`)
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= last; at += 86_400_000) {
    out.push(new Date(at).toISOString().slice(0, 10))
  }
  return out
}

/** Micro-dollars to dollars, cents kept. */
const dollars = (micro: bigint): number => Number(micro / 10_000n) / 100
/** Minor units (tiyin) to whole soʻm, half up — as the headline and /rnp print them. */
const soms = (minor: bigint): number => Math.round(Number(minor) / 100)

/**
 * One row's three soʻm figures, rounded so they still add up: FAKT 1 and
 * Первичка each rounded once, База the difference — never three roundings
 * of a tiyin remainder that could leave Первичка + База a soʻm off FAKT 1.
 */
function split(primary: bigint, base: bigint): { fakt1: number; primary: number; base: number } {
  const fakt1 = soms(primary + base)
  const p = soms(primary)
  return { fakt1, primary: p, base: fakt1 - p }
}

/**
 * The table for `days` (every day is a row, a quiet one with zeros: a day with
 * no order is a Bitrix24 answer). Sums stay in minor units and micro-dollars
 * until the end, so the total row is the rows' exact sum.
 */
export function buildAdSalesDays(
  days: readonly string[],
  fakt: readonly AdSalesTeamDay[],
  spend: readonly AdSalesSpendDay[],
): AdSalesDays {
  const acc = new Map(days.map((d) => [d, { spend: 0n, primary: 0n, base: 0n }]))
  for (const r of fakt) {
    const a = acc.get(r.day)
    if (!a) continue
    if (isBaseTeam(r.rop)) a.base += r.fakt1Minor
    else a.primary += r.fakt1Minor
  }
  for (const s of spend) {
    const a = acc.get(s.date)
    if (!a || s.product === null) continue
    a.spend += s.spendMicroUsd
  }

  const sum = { spend: 0n, primary: 0n, base: 0n }
  const rows = days.map((date) => {
    const a = acc.get(date)!
    sum.spend += a.spend
    sum.primary += a.primary
    sum.base += a.base
    return {
      date,
      spendUsd: dollars(a.spend),
      ...split(a.primary, a.base),
    }
  })
  return {
    rows,
    openDay: null,
    total: {
      spendUsd: dollars(sum.spend),
      ...split(sum.primary, sum.base),
    },
  }
}
