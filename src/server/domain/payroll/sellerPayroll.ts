/**
 * What a seller is paid for a period — the client's own scheme, transcribed.
 *
 * Given by the client on 2026-09-14 as a written instruction, and clarified by
 * them in the same conversation. Three parts, and they are independent:
 *
 *   1. EIGHT PER CENT of the period's FAKT 2, always, from the first soʻm.
 *   2. A FIXED amount, decided by which tier the same FAKT 2 has cleared.
 *   3. A DOLLAR bonus, decided by the same figure, plus 25$ for first place.
 *
 * FAKT 2 IS THE BASIS AND NOTHING ELSE IS. «sotuvchilar oyligi fakt 2 ga
 * qarab olinadi» — delivered money, the figure the sellers board and the
 * logistics screen both call Успешно. FAKT 1 (confirmed) is not paid on: an
 * order confirmed and then refused at the post office never became revenue,
 * and paying 8% of it would pay for a parcel that came back.
 *
 * NOBODY IS DISMISSED BY THIS MODULE. The client's sheet writes «< 30 000 000
 * -> xodim ishdan ketadi» and they corrected it on 2026-09-14: «ishdan ketmaydi
 * shunchaki yozilgan… uni ham hisoblayver, 30 mln dan pastlarni ham». So a
 * seller under the first tier is paid their 8% with no fixed part — NOT zero,
 * and not a row the screen hides. Reinstating a dismissal rule here would
 * silently zero real people's pay.
 *
 * THE TABLE IS QUOTED, NOT DERIVED, exactly as `analytics/sellerBonus` is —
 * and the two are different schemes for different questions. That module is
 * the client's published DASHBOARD ladder (45 mln pays 1 mln, gated by a floor
 * badge); this is the PAYROLL the office runs. They share their floors by
 * coincidence of the same business, and combining them would be inventing a
 * third scheme nobody uses.
 */

/** Which of the client's two tables applies. */
export const PAYROLL_SCHEMES = ['month', 'half'] as const
export type PayrollSchemeValue = (typeof PAYROLL_SCHEMES)[number]

export interface PayrollTier {
  /** FAKT 2 at or above this, in minor units, earns `fixedMinor`. */
  readonly floorMinor: bigint
  readonly fixedMinor: bigint
}

/**
 * The commission, in basis points. 8% of FAKT 2, every scheme, every tier.
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
 * who earned a million — the same trap `BONUS_TIERS` records.
 */
export const MONTH_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 7_000_000_000n, fixedMinor: 100_000_000n },
  { floorMinor: 6_000_000_000n, fixedMinor: 75_000_000n },
  { floorMinor: 4_500_000_000n, fixedMinor: 50_000_000n },
])

/**
 * 15 kun — the same table at half the money: 22.5 / 30 / 35 mln.
 *
 * Their own halves, not computed from the month's: a table that derived itself
 * would silently change all three rows the day one of the month's moves, and
 * the client wrote both tables out.
 */
export const HALF_TIERS: readonly PayrollTier[] = Object.freeze([
  { floorMinor: 3_500_000_000n, fixedMinor: 100_000_000n },
  { floorMinor: 3_000_000_000n, fixedMinor: 75_000_000n },
  { floorMinor: 2_250_000_000n, fixedMinor: 50_000_000n },
])

export function tiersFor(scheme: PayrollSchemeValue): readonly PayrollTier[] {
  return scheme === 'half' ? HALF_TIERS : MONTH_TIERS
}

/**
 * The dollar incentives: 40 mln pays 50$, 50 mln and above pays 100$.
 *
 * THE SAME SOʻM THRESHOLDS IN BOTH SCHEMES, because that is how the client
 * wrote them — the instruction states the two tier tables per period and then
 * states these once, with no period attached. So a fortnight is simply harder
 * to earn one in, which is what «ragʻbatlantirish» means. If they ever say the
 * half-month figures are 20 / 25 mln, this is the one list to halve.
 */
export const USD_TIERS: readonly { readonly floorMinor: bigint; readonly usd: number }[] =
  Object.freeze([
    { floorMinor: 5_000_000_000n, usd: 100 },
    { floorMinor: 4_000_000_000n, usd: 50 },
  ])

/**
 * First place pays 25$ MORE, on top of whatever the tiers paid.
 *
 * The instruction reads «1-oʻrinni egallasa -> qoʻshimcha +25$ (jami 125$)»,
 * and 125 is 100 + 25 — the top tier plus this. It is stated as an addition,
 * so it is applied as one: a leader who sold 45 mln takes 50 + 25. Making it
 * conditional on the 100$ rung would be a rule the instruction does not carry.
 */
export const FIRST_PLACE_USD = 25

/** The rank that earns `FIRST_PLACE_USD`. Named so the screen can say it. */
export const FIRST_PLACE_RANK = 1

export interface PayrollInput {
  /** FAKT 2 for the period, in minor units. Never negative. */
  readonly basisMinor: bigint
  readonly scheme: PayrollSchemeValue
  /** Competition rank on FAKT 2, 1 being the best. */
  readonly rank: number
}

export interface PayrollBreakdown {
  /** 8% of FAKT 2. */
  readonly percentMinor: bigint
  /** The tier's fixed part. Zero below the first floor. */
  readonly fixedMinor: bigint
  /** percent + fixed. The soʻm half of the pay, and the whole of it for most. */
  readonly totalMinor: bigint
  /** The tier floor this row was paid at, or null below the first one. */
  readonly tierFloorMinor: bigint | null
  /** The next floor up, or null once the top tier is cleared. */
  readonly nextFloorMinor: bigint | null
  /** What the next tier's fixed part would be. Null with `nextFloorMinor`. */
  readonly nextFixedMinor: bigint | null
  /** How much more FAKT 2 the next tier needs. Null with `nextFloorMinor`. */
  readonly toNextMinor: bigint | null
  /** The dollar tier, without the first-place addition. */
  readonly tierUsd: number
  /** 25 for the leader, 0 for everybody else. */
  readonly firstPlaceUsd: number
  /** tierUsd + firstPlaceUsd — what the row is actually paid in dollars. */
  readonly bonusUsd: number
}

/**
 * Eight per cent, rounded half up, in integers throughout.
 *
 * `scaleMoney(m, 0.08)` would give the same answer and is the house helper,
 * but it needs a currency and this module deliberately deals in the bare
 * figure: the rule is about an amount, not about money in a wallet, and the
 * service is where a currency is attached. The rounding matches the house's —
 * half away from zero — and FAKT 2 is never negative here.
 */
function percentOf(basisMinor: bigint, bp: bigint): bigint {
  if (basisMinor <= 0n) return 0n
  return (basisMinor * bp + 5_000n) / 10_000n
}

/**
 * One seller's pay for one period.
 *
 * Pure, and it takes the rank rather than working it out: ranking is a
 * property of the whole board and is decided once, by the service, over the
 * same rows the screen prints — two definitions of "first place" on one screen
 * is how a 25$ argument starts.
 */
export function sellerPayroll({ basisMinor, scheme, rank }: PayrollInput): PayrollBreakdown {
  const tiers = tiersFor(scheme)
  const percentMinor = percentOf(basisMinor, PERCENT_BP)

  const cleared = tiers.find((tier) => basisMinor >= tier.floorMinor) ?? null
  /*
    The next rung is the LOWEST floor still above this figure. Read off the
    descending list from the end, so a seller below every floor is told about
    the FIRST tier rather than about the top one — «45 mln gacha 2.3 mln
    qoldi» is a target; «70 mln gacha» is not.
  */
  const next = [...tiers].reverse().find((tier) => basisMinor < tier.floorMinor) ?? null

  const tierUsd = USD_TIERS.find((tier) => basisMinor >= tier.floorMinor)?.usd ?? 0
  const firstPlaceUsd = rank === FIRST_PLACE_RANK ? FIRST_PLACE_USD : 0

  const fixedMinor = cleared?.fixedMinor ?? 0n

  return {
    percentMinor,
    fixedMinor,
    totalMinor: percentMinor + fixedMinor,
    tierFloorMinor: cleared?.floorMinor ?? null,
    nextFloorMinor: next?.floorMinor ?? null,
    nextFixedMinor: next?.fixedMinor ?? null,
    toNextMinor: next ? next.floorMinor - basisMinor : null,
    tierUsd,
    firstPlaceUsd,
    bonusUsd: tierUsd + firstPlaceUsd,
  }
}
