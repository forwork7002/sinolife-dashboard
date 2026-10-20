/**
 * What a seller is paid for a period — the client's own schemes, transcribed.
 *
 * TWO DOCUMENTS, THREE TABLES. Given by the client on 2026-09-14 and restated
 * as two Word files on 2026-10-03 («Sinolife_Oylik_Maosh_Tartibi» and
 * «Sinolife_HAFTALIK_DAROMAD_SOM»):
 *
 *   - `month` and `half` — the monthly payroll: 8% of FAKT 2 from the first
 *     soʻm, plus a FIXED part decided by which tier that figure has cleared.
 *   - `week` — the weekly income: the PERCENTAGE itself rises with the tier
 *     (5 / 8 / 10 / 12%), a weekly oklad comes with the upper three, and under
 *     15 mln nothing is paid at all.
 *
 * Every table is one shape — a floor, a rate and a fixed part — so the three
 * share one reading: find the highest floor cleared, apply its rate to the
 * WHOLE figure, add its fixed part. The rate is never marginal; the client's
 * own examples (34 900 000 × 8% + 300 000) apply it to every soʻm.
 *
 * FAKT 2 IS THE BASIS AND NOTHING ELSE IS — for the week as well as the month
 * (the client, 2026-10-03). Delivered money, the figure the sellers board and
 * the logistics screen both call Успешно. FAKT 1 (confirmed) is not paid on:
 * an order confirmed and then refused at the post office never became revenue.
 *
 * NOBODY IS DISMISSED BY THIS MODULE. The monthly sheet writes «< 30 000 000
 * -> xodim ishdan ketadi» and the client corrected it on 2026-09-14: «ishdan
 * ketmaydi shunchaki yozilgan… 30 mln dan pastlarni ham hisoblayver». So a
 * seller under the month's first tier is paid their 8% with no fixed part —
 * NOT zero. The WEEK is different on purpose: its own table says «0 – 15 mln:
 * oklad / bonus berilmaydi», so under 15 mln a week pays nothing.
 *
 * NO DOLLARS. The 2026-09-14 instruction carried a dollar incentive (40 mln →
 * 50$, 50 mln → 100$, first place +25$); the 2026-10-03 documents do not, and
 * the client said to drop it.
 *
 * БАЗА HAS TABLES OF ITS OWN, AND ONE PERSON HAS A RATE (2026-10-20). The two
 * БАЗА teams are paid by `BAZA_*_TIERS` (10 / 12 / 15%, 8% below the first
 * rung, an oklad on every rung); Marjona Shahtiyarovna by a flat 18%
 * (`FLAT_RATE_SELLERS`). Which table a row is on is the service's call.
 *
 * THE TABLES ARE QUOTED, NOT DERIVED, exactly as `analytics/sellerBonus` is —
 * and that module is a different scheme for a different question (the
 * client's published DASHBOARD ladder); this is the PAYROLL the office runs.
 */

import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays } from 'date-fns'

import { fullUnitWindow } from '@/server/domain/analytics/pulse'
import type { Period } from '@/server/domain/period/period'

/** Which of the client's tables applies. */
export const PAYROLL_SCHEMES = ['month', 'half', 'week'] as const
export type PayrollSchemeValue = (typeof PAYROLL_SCHEMES)[number]

/**
 * WHICH TABLE A WINDOW IS PAID BY — its LENGTH (2026-10-17, the client: the
 * tabs went, the screen takes the dashboard's own window — «huddi savdo
 * dinamikasidek» — and the table follows how long it is). Up to 7 days the
 * week's, up to 16 the fortnight's (16 is the longest second half), longer
 * the month's.
 *
 * MEASURED ON THE WHOLE CALENDAR UNIT (`fullUnitWindow`), not the to-date
 * window: «Shu oy» on the 5th is five days long and is still a month's pay
 * running — paying it by the week's table would print a weekly oklad under a
 * monthly heading. A picked range is its own length.
 */
export function payrollSchemeOf(period: Period): PayrollSchemeValue {
  const full = fullUnitWindow(period)
  const days = differenceInCalendarDays(
    new TZDate(full.end.getTime(), full.timeZone),
    new TZDate(full.start.getTime(), full.timeZone),
  )
  if (days <= 7) return 'week'
  if (days <= 16) return 'half'
  return 'month'
}

export interface PayrollTier {
  /** FAKT 2 at or above this, in minor units, is paid at this tier. */
  readonly floorMinor: bigint
  /** The rate, in basis points, applied to the WHOLE figure. */
  readonly percentBp: bigint
  readonly fixedMinor: bigint
}

/**
 * The monthly commission, in basis points. 8% of FAKT 2, every monthly tier.
 *
 * Basis points rather than 0.08: the whole calculation stays in integers, so
 * nothing here can land a payroll figure on a float's last bit.
 */
export const PERCENT_BP = 800n

/**
 * 1 oy — «45 mln -> +500 000, 60 mln -> +750 000, 70 mln -> +1 000 000».
 *
 * DESCENDING, so the reading is "the highest tier whose floor has been
 * cleared". Ascending would award the first match and pay 500 000 to somebody
 * who earned a million — the same trap `BONUS_TIERS` records. The last row,
 * floor 0, is "under every tier": 8% and no fixed part.
 *
 * 60 mln pays 4 800 000 + 750 000 = 5 550 000. Both documents print
 * «5 500 000» beside that sum; the client chose the formula on 2026-09-14.
 */
export const MONTH_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 7_000_000_000n, percentBp: PERCENT_BP, fixedMinor: 100_000_000n },
  { floorMinor: 6_000_000_000n, percentBp: PERCENT_BP, fixedMinor: 75_000_000n },
  { floorMinor: 4_500_000_000n, percentBp: PERCENT_BP, fixedMinor: 50_000_000n },
  { floorMinor: 0n, percentBp: PERCENT_BP, fixedMinor: 0n },
])

/**
 * 15 kun — the same table at half the money: 22.5 / 30 / 35 mln.
 *
 * Their own halves, not computed from the month's: a table that derived itself
 * would silently change all three rows the day one of the month's moves, and
 * the client wrote both tables out.
 */
export const HALF_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 3_500_000_000n, percentBp: PERCENT_BP, fixedMinor: 100_000_000n },
  { floorMinor: 3_000_000_000n, percentBp: PERCENT_BP, fixedMinor: 75_000_000n },
  { floorMinor: 2_250_000_000n, percentBp: PERCENT_BP, fixedMinor: 50_000_000n },
  { floorMinor: 0n, percentBp: PERCENT_BP, fixedMinor: 0n },
])

/**
 * 1 hafta — «HAFTALIK DAROMAD FORMULASI», 2026-10-03.
 *
 *   0 – 15 mln       —                  nothing
 *   15 – 24,9 mln    5%                 24 900 000 × 5%              = 1 245 000
 *   25 – 34,9 mln    8%  + 300 000      34 900 000 × 8% + 300 000    = 3 092 000
 *   35 – 49,9 mln    10% + 600 000      49 900 000 × 10% + 600 000   = 5 590 000
 *   50 mln +         12% + 1 200 000    50 000 000 × 12% + 1 200 000 = 7 200 000
 *
 * The oklad here is WEEKLY — the document says so in a box of its own
 * («OYLIK MAOSH EMAS, HAFTALIK OKLAD»).
 */
export const WEEK_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 5_000_000_000n, percentBp: 1_200n, fixedMinor: 120_000_000n },
  { floorMinor: 3_500_000_000n, percentBp: 1_000n, fixedMinor: 60_000_000n },
  { floorMinor: 2_500_000_000n, percentBp: 800n, fixedMinor: 30_000_000n },
  { floorMinor: 1_500_000_000n, percentBp: 500n, fixedMinor: 0n },
  { floorMinor: 0n, percentBp: 0n, fixedMinor: 0n },
])

/**
 * БАЗА — the client, 2026-10-20: «baza foizlari 20 mln ga 10% 500 oklad, 25
 * mln ga 12% 500 oklad, 35 mln ga 15% 500 oklad», and under 20 mln «8% foiz
 * va oklad oladi tamom». The rate rises with the tier and applies to the
 * WHOLE figure, as every table here; the 500 000 oklad is paid on EVERY
 * rung, the floor-0 one included — unlike the standard tables, where the
 * fixed part is the tier's reward.
 *
 * Paid to the two БАЗА teams (`isBaseTeam`: «Baza», Farrux's, and «Malika»,
 * the Zextra base — the user chose «Ha, Bazaga kiradi»).
 */
export const BAZA_MONTH_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 3_500_000_000n, percentBp: 1_500n, fixedMinor: 50_000_000n },
  { floorMinor: 2_500_000_000n, percentBp: 1_200n, fixedMinor: 50_000_000n },
  { floorMinor: 2_000_000_000n, percentBp: 1_000n, fixedMinor: 50_000_000n },
  { floorMinor: 0n, percentBp: 800n, fixedMinor: 50_000_000n },
])

/**
 * БАЗА over 15 days and over a week — the month's table divided, floors AND
 * oklad alike (the user chose «Bo'linadi, oklad ham», 2026-10-20): a half is
 * 10 / 12,5 / 17,5 mln with 250 000, a week 5 / 6,25 / 8,75 mln with 125 000.
 * Written out rather than derived, as `HALF_TIERS` is.
 */
export const BAZA_HALF_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 1_750_000_000n, percentBp: 1_500n, fixedMinor: 25_000_000n },
  { floorMinor: 1_250_000_000n, percentBp: 1_200n, fixedMinor: 25_000_000n },
  { floorMinor: 1_000_000_000n, percentBp: 1_000n, fixedMinor: 25_000_000n },
  { floorMinor: 0n, percentBp: 800n, fixedMinor: 25_000_000n },
])

export const BAZA_WEEK_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 875_000_000n, percentBp: 1_500n, fixedMinor: 12_500_000n },
  { floorMinor: 625_000_000n, percentBp: 1_200n, fixedMinor: 12_500_000n },
  { floorMinor: 500_000_000n, percentBp: 1_000n, fixedMinor: 12_500_000n },
  { floorMinor: 0n, percentBp: 800n, fixedMinor: 12_500_000n },
])

/**
 * A seller paid a FLAT rate of their own FAKT 2 instead of any table — the
 * client, 2026-10-20: «Marjona Shahtiyarovna 18% dan oladi», the user's
 * answer «o'zi sotgan FAKT 2 dan, jadvalsiz». No tier, no fixed part.
 *
 * Keyed by the portal's user id, which survives a rename: 7044 is «Marjona
 * Shahtiyarovna 197», head of «Marjona(ROP)» in Тошкент — her own ROP 2% is
 * paid as well, by `ropPayroll`, on her team's FAKT 2.
 */
export const FLAT_RATE_SELLERS: Readonly<Record<string, bigint>> = Object.freeze({
  '7044': 1_800n,
})

/** Which pay a seller is on. `flat` carries its rate in `PayrollInput.flatBp`. */
export const PAYROLL_TABLES = ['standard', 'baza', 'flat'] as const
export type PayrollTableValue = (typeof PAYROLL_TABLES)[number]

function tiersFor(scheme: PayrollSchemeValue, table: 'standard' | 'baza'): readonly PayrollTier[] {
  if (table === 'baza') return scheme === 'week' ? BAZA_WEEK_TIERS : scheme === 'half' ? BAZA_HALF_TIERS : BAZA_MONTH_TIERS
  return scheme === 'week' ? WEEK_TIERS : scheme === 'half' ? HALF_TIERS : MONTH_TIERS
}

export interface PayrollInput {
  /** FAKT 2 for the period, in minor units. Never negative. */
  readonly basisMinor: bigint
  readonly scheme: PayrollSchemeValue
  /** The seller's table; the standard one when omitted. ROPs ignore it. */
  readonly table?: PayrollTableValue
  /** The rate of a `flat` seller, in basis points. Required with `flat`. */
  readonly flatBp?: bigint
}

export interface PayrollBreakdown {
  /** The rate this row was paid at, in basis points. 0 under the week's floor. */
  readonly percentBp: bigint
  /** The rate applied to FAKT 2. */
  readonly percentMinor: bigint
  /** The tier's fixed part. Zero below the first paying floor. */
  readonly fixedMinor: bigint
  /** percent + fixed — what the person is paid. */
  readonly totalMinor: bigint
  /** The tier floor this row was paid at, or null below the first one. */
  readonly tierFloorMinor: bigint | null
  /** The next floor up, or null once the top tier is cleared. */
  readonly nextFloorMinor: bigint | null
  /** How much more FAKT 2 the next tier needs. Null with `nextFloorMinor`. */
  readonly toNextMinor: bigint | null
}

/**
 * A rate of the figure, rounded half up, in integers throughout.
 *
 * `scaleMoney(m, 0.08)` would give the same answer and is the house helper,
 * but it needs a currency and this module deliberately deals in the bare
 * figure: the service is where a currency is attached. The rounding matches
 * the house's — half away from zero — and FAKT 2 is never negative here.
 */
function percentOf(basisMinor: bigint, bp: bigint): bigint {
  if (basisMinor <= 0n || bp <= 0n) return 0n
  return (basisMinor * bp + 5_000n) / 10_000n
}

/**
 * A ROP's pay — the client, 2026-10-07: «ROPlar guruhi FAKT 2 dan 2% + 2 mln
 * oklad». 2% of the whole team's FAKT 2 on every table; the 2 000 000 oklad is
 * monthly and is added on the month only (the client chose «hamma tabda 2%»).
 */
export const ROP_PERCENT_BP = 200n
export const ROP_MONTH_OKLAD_MINOR = 200_000_000n

export interface RopPayBreakdown {
  readonly percentMinor: bigint
  readonly fixedMinor: bigint
  readonly totalMinor: bigint
}

/** One ROP's pay for one period, off their team's FAKT 2. Pure. */
export function ropPayroll({ basisMinor, scheme }: PayrollInput): RopPayBreakdown {
  const percentMinor = percentOf(basisMinor, ROP_PERCENT_BP)
  const fixedMinor = scheme === 'month' ? ROP_MONTH_OKLAD_MINOR : 0n
  return { percentMinor, fixedMinor, totalMinor: percentMinor + fixedMinor }
}

/** One seller's pay for one period. Pure. */
export function sellerPayroll({ basisMinor, scheme, table = 'standard', flatBp }: PayrollInput): PayrollBreakdown {
  if (table === 'flat') {
    if (flatBp === undefined) throw new Error('sellerPayroll: a flat seller needs flatBp')
    const percentMinor = percentOf(basisMinor, flatBp)
    return {
      percentBp: flatBp,
      percentMinor,
      fixedMinor: 0n,
      totalMinor: percentMinor,
      tierFloorMinor: null,
      nextFloorMinor: null,
      toNextMinor: null,
    }
  }
  const tiers = tiersFor(scheme, table)

  // The floor-0 row always matches, so `cleared` is never undefined.
  const cleared = tiers.find((tier) => basisMinor >= tier.floorMinor) ?? tiers[tiers.length - 1]!
  /*
    The next rung is the LOWEST floor still above this figure. Read off the
    descending list from the end, so a seller below every floor is told about
    the FIRST tier rather than about the top one — «45 mln gacha 2.3 mln
    qoldi» is a target; «70 mln gacha» is not.
  */
  const next = [...tiers].reverse().find((tier) => basisMinor < tier.floorMinor) ?? null

  const percentMinor = percentOf(basisMinor, cleared.percentBp)

  return {
    percentBp: cleared.percentBp,
    percentMinor,
    fixedMinor: cleared.fixedMinor,
    totalMinor: percentMinor + cleared.fixedMinor,
    tierFloorMinor: cleared.floorMinor > 0n ? cleared.floorMinor : null,
    nextFloorMinor: next?.floorMinor ?? null,
    toNextMinor: next ? next.floorMinor - basisMinor : null,
  }
}
