import type { BezkvalClientDto } from './leadSplitApi'

/**
 * Which of a day's «Безквал» clients a drill-down lists — the client side of
 * «Bezkval lidlar» and of the month grid's cells. Pure, so the predicates the
 * card's numbers were counted by and the lists behind them are one rule.
 */
export interface BezkvalPick {
  /** A team; null «Tarqatilmagan»; undefined every client. */
  readonly rop?: string | null
  readonly kind?: 'new30' | 'newEver' | 'repeat30' | 'multiRop' | 'leadGuard' | 'noPhone'
  /** The first deal's source; null «Manbasiz»; undefined every source. */
  readonly source?: string | null
  readonly hour?: number
}

export function pickClients(clients: readonly BezkvalClientDto[], pick: BezkvalPick): BezkvalClientDto[] {
  return clients.filter((c) => {
    if (pick.rop !== undefined && c.rop !== pick.rop) return false
    if (pick.source !== undefined && c.source !== pick.source) return false
    if (pick.hour !== undefined && c.hour !== pick.hour) return false
    switch (pick.kind) {
      case 'new30':
        return c.new30
      case 'newEver':
        return c.newEver
      case 'repeat30':
        return !c.new30
      case 'multiRop':
        return c.multiRop
      case 'leadGuard':
        return c.deals.some((d) => d.leadGuard)
      case 'noPhone':
        return c.kind === 'contact' || c.kind === 'deal'
      default:
        return true
    }
  })
}

/** The rows a drill-down prints at first; «Yana» adds this many. */
export const BEZKVAL_ROWS_PER_PAGE = 100
