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
import { canSeeSection } from '@/server/auth/rbac'
import { resolvePeriod } from '@/server/domain/period/period'
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
      canSeeSection(principal, 'confirmation')
        ? this.insights.queuePressure(resolvePeriod('today', { timeZone, now }))
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
