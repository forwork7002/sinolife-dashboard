import type { SellerBoardRowDto, SellerTeamRowDto } from '@/lib/api'

/**
 * Taxtaning saralash mantig'i — `SellersPage` dan ajratilgan, ikkala ustun
 * (`SellersBoard`, `TeamsBoard`) shu bitta qoidani o'qiydi.
 */

/**
 * Which of the two facts the board is ranked and read on.
 *
 * 'auto' is not a third reading — it is the absence of a decision, and it
 * resolves to one of the other two on every render: FAKT 2 once anybody has
 * delivered, FAKT 1 until then. It has to stay reachable as the OPENING
 * state, or a board left on «Bugun» overnight opens pinned to a fact nobody
 * has any money in yet.
 */
export type FaktChoice = 'auto' | 'fakt1' | 'fakt2'

/**
 * One line of either board, in the words both boards share. A seller and a
 * team are ranked by the same two figures under the same rule; what differs
 * is what stands beside the name — a seller's team, a team's headcount.
 */
export interface BoardEntry {
  readonly key: string
  readonly rank: number
  readonly name: string
  /** Sotuvchining ROP komandasi; komanda qatorida null. */
  readonly badge: string | null
  /** Komandaning sotuvchilar soni; sotuvchi qatorida null. */
  readonly sellers: number | null
  /** FAKT 2 — Доставланди, in soʻm. */
  readonly won: number
  /** FAKT 1 — Тасдиқланди + Тасдиқланмай чиқди, in soʻm. */
  readonly ordered: number
  readonly wonOrders: number
  readonly orders: number
  /** Null where the DTO does not carry it (teams). */
  readonly openOrders: number | null
  /**
   * Orders still IN THE CONFIRMATION QUEUE — nobody has decided them yet
   * (`C4:NEW` and «no answer»). Null on a team row, and null where the row
   * does not carry the four counts it is derived from. See `queuedOf`.
   */
  readonly queuedOrders: number | null
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
}

export function fromSeller(row: SellerBoardRowDto): BoardEntry {
  return {
    key: row.employeeId,
    rank: row.rank,
    name: row.fullName,
    badge: row.rop,
    sellers: null,
    won: row.won.amount,
    ordered: row.ordered.amount,
    wonOrders: row.wonOrders,
    orders: row.orders,
    openOrders: row.openOrders,
    queuedOrders: queuedOf(row),
    conversionPercent: row.conversionPercent,
    sharePercent: row.sharePercent,
  }
}

export function fromTeam(row: SellerTeamRowDto): BoardEntry {
  return {
    key: row.rop,
    rank: row.rank,
    name: row.rop,
    badge: null,
    sellers: row.sellers,
    won: row.won.amount,
    ordered: row.ordered.amount,
    wonOrders: row.wonOrders,
    orders: row.orders,
    openOrders: null,
    queuedOrders: null,
    conversionPercent: row.conversionPercent,
    sharePercent: row.sharePercent,
  }
}

/**
 * How many of a seller's orders are waiting in the confirmation queue NOW.
 *
 * NOT `openOrders`: on the queue basis that is `inTransitOrders` — orders
 * already CONFIRMED and on the road (`insightsRepository`, «In FAKT 1, not
 * delivered, still OPEN»). The row does not carry the five queue states
 * apart, but it carries enough to recover the undecided two:
 *
 *   cohortOrders = CONFIRM_NEW + NO_ANSWER + CONFIRMED + REJECTED + UNCONFIRMED_SHIPPED
 *   orders       = CONFIRMED + UNCONFIRMED_SHIPPED                 (FAKT 1)
 *   lostOrders   = REJECTED + lostAfterConfirmOrders               (service `rowsFor`)
 *
 * so `cohortOrders − orders − (lostOrders − lostAfterConfirmOrders)` is
 * CONFIRM_NEW + NO_ANSWER. Checked against production «Bugun» on 2026-09-17:
 * the rows sum to 8, and `totals.outcomes` says 5 + 3.
 *
 * Null when a count is missing (an older payload) or the arithmetic comes out
 * negative — a number that cannot be vouched for is not printed.
 */
export function queuedOf(row: SellerBoardRowDto): number | null {
  const { cohortOrders, orders, lostOrders, lostAfterConfirmOrders } = row
  if (![cohortOrders, orders, lostOrders, lostAfterConfirmOrders].every((n) => Number.isFinite(n))) return null
  const queued = cohortOrders - orders - (lostOrders - lostAfterConfirmOrders)
  return queued >= 0 ? queued : null
}

/**
 * The board's four kinds of line (EFIR Premium §8), over the fact being read:
 *
 * - `earners` — the fact being read is above zero. They take the seats (or
 *   the stage) and the ranked rows.
 * - `ranked` — everyone who has money in EITHER fact, in the board's order;
 *   `earners` is its head. A row with only the other fact keeps its rank and
 *   a faint dash in the hero cell, as it always did.
 * - `queued` — no money in either fact, but orders waiting in the
 *   confirmation queue. No rank, no zero: one sentence.
 *
 * - `idle` — none of the above: no money, nothing waiting (a day of refusals).
 *   On «Bugun» it is not on the board at all; over a longer window it keeps
 *   its unranked row, because a seller whose whole month was refused is a row
 *   a floor manager needs (`insightsRepository` `ratingSql`, «EVERY OPERATOR
 *   IN THE COHORT»).
 */
export interface BoardSplit {
  readonly earners: readonly BoardEntry[]
  readonly ranked: readonly BoardEntry[]
  readonly queued: readonly BoardEntry[]
  readonly idle: readonly BoardEntry[]
}

export function splitBoard(ranked: readonly BoardEntry[], onDelivered: boolean): BoardSplit {
  const moneyed = ranked.filter((e) => e.won > 0 || e.ordered > 0)
  return {
    earners: moneyed.filter((e) => figureOf(e, onDelivered) > 0),
    ranked: moneyed,
    queued: ranked.filter((e) => e.won <= 0 && e.ordered <= 0 && (e.queuedOrders ?? 0) > 0),
    idle: ranked.filter((e) => e.won <= 0 && e.ordered <= 0 && !((e.queuedOrders ?? 0) > 0)),
  }
}

/** The figure the board is being read on. */
export function figureOf(entry: BoardEntry, onDelivered: boolean): number {
  return onDelivered ? entry.won : entry.ordered
}

/**
 * 'auto' resolves the way the board always did: FAKT 2 the moment anybody
 * has delivered, FAKT 1 while nobody has. Delivery takes days, so for most
 * of a working day nobody has FAKT 2, and a podium gated on it stood empty
 * over a floor that had confirmed 148 mln soʻm between 55 people.
 */
export function resolveOnDelivered(entries: readonly BoardEntry[], fakt: FaktChoice): boolean {
  return fakt === 'auto' ? entries.some((e) => e.won > 0) : fakt === 'fakt2'
}

/**
 * The board's own order, over whichever fact is being read.
 *
 * THIS MIRRORS `SellerBoardService` — `buildBoard` for the sellers and
 * `teamRows` for the teams — AND HAS TO KEEP MIRRORING IT: the fact being
 * read, then the other one, then the key, with competition ranking over BOTH
 * figures so equal money is an equal rank and the next rank skips. Read on
 * FAKT 2 it reproduces the ranks the service already sent, which is what
 * `sellersTvBoard.test.tsx` asserts row by row; read on FAKT 1 it is the same
 * rule with the two keys swapped, and that swap is the whole of what the
 * switch does. Ranking on the leading fact alone is the failure both those
 * comments record: on «Bugun» nobody has FAKT 2, the comparison ties for all
 * fifteen teams, and the tie-break — a name, an employee id — becomes the
 * ranking, under a seat claiming a fact.
 *
 * WHY IT IS DONE HERE AND NOT ASKED OF THE API. Every row is already on the
 * payload carrying both facts; this is ONE answer read two ways, not a second
 * question. So the switch costs no request, cannot straddle a sync, cannot
 * flash a stale board while a second one lands, and cannot disagree with the
 * totals beside it. The key stays the last resort — an employee id, a ROP's
 * name — so two rows level on both figures do not swap places between two
 * refreshes of one screen.
 */
export function rankedBy(entries: readonly BoardEntry[], onDelivered: boolean): readonly BoardEntry[] {
  const read = (e: BoardEntry) => (onDelivered ? e.won : e.ordered)
  const other = (e: BoardEntry) => (onDelivered ? e.ordered : e.won)

  const ordered = [...entries].sort(
    (a, b) => read(b) - read(a) || other(b) - other(a) || a.key.localeCompare(b.key),
  )

  let rank = 0
  return ordered.map((entry, index) => {
    const previous = index > 0 ? ordered[index - 1]! : null
    // Equal on BOTH figures, because both decide the order. Otherwise two
    // sellers level on the fact being read but far apart on the other would
    // share a rank the sort has already separated them by, and the board
    // would print 1, 1, 3 over rows that visibly differ.
    if (!previous || previous.won !== entry.won || previous.ordered !== entry.ordered) {
      rank = index + 1
    }
    return { ...entry, rank }
  })
}
