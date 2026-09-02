/**
 * What the header says at a glance, on every screen.
 *
 * Two facts a person wants before they read any number: whether the numbers
 * are current, and whether anything is waiting on them. Each is CHEAP by
 * construction — one row from the sync log, one aggregate over today's queue —
 * because this payload is fetched by every page every minute, and a header
 * that costs a second per page is a header nobody keeps.
 *
 * IT CARRIED A THIRD: a list of faults behind a warning triangle. The client
 * did not want the triangle, so the list went with it rather than being
 * computed for nobody — it cost a read of the marketing ledger and a second
 * sync-log query on every tick. Staleness is still SAID, by the chip itself
 * turning amber past five minutes.
 *
 * GATED THE SAME WAY THE SCREENS ARE. The bell reads the confirmation queue,
 * so an account without that section gets no bell rather than a count of
 * something it may not open. A header that disclosed "3 waiting" to somebody
 * barred from the queue would be the boundary leaking through the chrome.
 */

import type { Principal } from '@/server/auth/rbac'
import { can, canSeeSection } from '@/server/auth/rbac'
import { allTime } from '@/server/domain/period/period'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'

export interface AlertsDto {
  /** The last successful sync, or null when none has ever completed. */
  readonly syncedAt: string | null
  /** Minutes since then, already computed so the client need not own a clock. */
  readonly syncAgeMinutes: number | null
  /** Today's queue, or null when this account may not see the queue at all. */
  readonly queue: { readonly pending: number; readonly overdue: number } | null
}

export class AlertsService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly reference: ReferenceRepository,
  ) {}

  async load(principal: Principal, now: Date, timeZone: string): Promise<AlertsDto> {
    const [syncedAt, queue] = await Promise.all([
      this.reference.findLastSuccessfulSync(),
      /*
        THE SAME TWO GATES THE QUEUE ITSELF ASKS FOR.

        The section alone was not enough. `/insights/confirmations/orders`
        declares `permission: 'analytics:read:all'` and does NOT narrow its
        rows to the caller — the queue is company-wide by construction — so an
        account holding the Tasdiqlash section on an OWN data scope was shown a
        bell it could not open: clicking it produced a 403 and an error state
        where a number had promised work. A bell is an invitation, and one
        that leads to a refusal is worse than no bell.
      */
      canSeeSection(principal, 'confirmation') && can(principal, 'analytics:read:all')
        ? /*
             THE BACKLOG, NOT TODAY'S ARRIVALS.

             This counted orders CREATED today that were still waiting, which
             is not what a bell is for: on a portal with 265 unworked orders —
             the oldest from a year ago, 149 of them parked in the silent
             «Пропущенный» stage — the header read zero every morning and the
             one number an owner glances at said there was nothing to do. It
             now counts every still-open order whose latest confirmation
             signal is CONFIRM_NEW, whenever it arrived, which is what the
             page shows behind the link.
          */
          this.insights.queuePressure(allTime(timeZone), 120, 'backlog')
        : Promise.resolve(null),
    ])

    return {
      syncedAt: syncedAt?.toISOString() ?? null,
      /*
        The age is computed HERE, not in the browser.

        The client would otherwise need the server's clock to say "3 daqiqa
        oldin" honestly — a machine whose own clock is ten minutes out would
        report the data as stale, or as fresher than it is, and neither is
        something the reader could tell from the screen.
      */
      syncAgeMinutes:
        syncedAt === null
          ? null
          : Math.max(0, Math.floor((now.getTime() - syncedAt.getTime()) / 60_000)),
      queue,
    }
  }
}
