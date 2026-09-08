/**
 * What the header says at a glance, on every screen.
 *
 * Two facts a person wants before they read any number: whether the numbers
 * are current, and whether anything is waiting on them. Each was CHEAP by
 * construction — one row from the sync log, one aggregate over today's queue —
 * because this payload is fetched by every page every minute, and a header
 * that costs a second per page is a header nobody keeps.
 *
 * THE SECOND HALF OF THAT STOPPED BEING TRUE when the bell moved to the
 * backlog, and it took a while to notice because nothing on screen changed.
 * See `cachedQueuePressure` below for what it costs now and what holds the
 * line instead.
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

import type { Principal, RowScope } from '@/server/auth/rbac'
import { canSeeSection } from '@/server/auth/rbac'
import { scopedPeriod } from '@/server/domain/employees/branches'
import { allTime } from '@/server/domain/period/period'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'
import { keyPart, ttlCache } from './ttlCache'

export interface AlertsDto {
  /** The last successful sync, or null when none has ever completed. */
  readonly syncedAt: string | null
  /** Minutes since then, already computed so the client need not own a clock. */
  readonly syncAgeMinutes: number | null
  /** Today's queue, or null when this account may not see the queue at all. */
  readonly queue: { readonly pending: number; readonly overdue: number } | null
}

type QueueCount = { readonly pending: number; readonly overdue: number }

/**
 * ONE backlog count per minute, however many people have the app open.
 *
 * The header above says this payload is "CHEAP by construction — one row from
 * the sync log, one aggregate over today's queue". The first half is still
 * true. The second stopped being true when the bell moved to the BACKLOG: the
 * call below is `queuePressure(allTime, …, 'backlog')`, which is the whole
 * `queueSql` CTE chain over an unbounded left bound — measured at ~4 s on
 * production, and recorded as that in `Shell.tsx` beside the poll that issues
 * it. A four-second query is a perfectly reasonable thing for a page to do
 * once. This one runs on EVERY screen, once a minute, per open tab.
 *
 * N people watching the dashboard were issuing N identical four-second
 * statements against a pool of eight on a one-core database. That is the same
 * failure the command centre's cache was written to stop, arriving through a
 * different door.
 *
 * THE ANSWER IS SCOPED, SO THE KEY CARRIES THE SCOPE. This memo was first
 * written when the bell was company-wide by construction, and `ttlCache`'s own
 * header still says the safest rule is to memoise only unscoped answers. The
 * bell narrowed after that — `scopedPeriod(allTime, scope)` below — and the
 * two readings a ROP and an administrator get are genuinely different numbers.
 * Keyed on the window alone they would share one entry and the second caller
 * would be served the first's count: an administrator's 265 handed to a ROP
 * whose own floor has 12, or the reverse. So `keyPart(restrictToEmployeeIds)`
 * is part of the key, which is the one job that function exists for — it sorts
 * the list, and it keeps `undefined` and `[]` distinct, because an empty array
 * reads as "no filter" everywhere in this codebase and widens to the company.
 *
 * The hit rate survives it. A scope is a team, not a person: every tab an
 * administrator has open shares the `-` key, and each ROP's own tabs share
 * theirs, so the entry count is the number of distinct teams reading at once —
 * about sixteen on this portal — not the number of readers.
 *
 * THE TTL IS 60 SECONDS, NOT 45. The command centre uses 45 against a screen
 * whose readers arrive together; this is polled on a fixed 60-second interval
 * by every tab, so a 45-second entry is missed by every solo reader and buys
 * no freshness for it — the data behind it moves once a minute either way.
 *
 * WHAT IS DELIBERATELY NOT CACHED:
 *
 *  * The PERMISSION GATE, which stays in `load` where it is. Caching the whole
 *    AlertsDto under a key with no principal in it would hand an account
 *    barred from the queue a count of orders it cannot open — the exact
 *    disclosure the gate below was added to close.
 *  * `syncedAt`. It is one indexed row, and being honest about the clock is
 *    the freshness chip's entire job; serving it from a cache would make the
 *    chip lie about its own staleness by up to a minute.
 *  * A REJECTION. Caching a timeout would turn one bad minute into sixty
 *    seconds of them, which is the opposite of the point.
 */
const QUEUE_CACHE_TTL_MS = 60_000
const queueCache = ttlCache<QueueCount>(QUEUE_CACHE_TTL_MS)

/**
 * Test seam only. See `resetSellerBoardCache` for the failure this prevents —
 * no test drives this service today, and the seam is here so the first one
 * that does is not the one that discovers the problem.
 */
export function resetAlertsQueueCache(): void {
  queueCache.clear()
}

function cachedQueuePressure(
  insights: InsightsRepository,
  scope: RowScope,
  timeZone: string,
  overdueAfterMinutes: number,
): Promise<QueueCount> {
  const period = scopedPeriod(allTime(timeZone), scope)
  /*
    `allTime` is frozen at epoch → 2100 with `preset: 'custom'`, so the window
    half of this key is a constant. It is written out in full anyway: the key
    has to name every argument that reaches the query, or the next person to
    give the bell a real window silently serves them the all-time answer.
    (Same rule as `commandCentreCacheKey` — the preset is part of the key —
    satisfied here trivially rather than skipped.)
  */
  const key = [
    'backlog',
    period.preset,
    period.start.toISOString(),
    period.end.toISOString(),
    timeZone,
    overdueAfterMinutes,
    keyPart(period.restrictToEmployeeIds),
  ].join('|')

  return queueCache.get(key, () =>
    insights.queuePressure(period, overdueAfterMinutes, 'backlog'),
  )
}

export class AlertsService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly reference: ReferenceRepository,
  ) {}

  async load(
    principal: Principal,
    scope: RowScope,
    now: Date,
    timeZone: string,
  ): Promise<AlertsDto> {
    const [syncedAt, queue] = await Promise.all([
      this.reference.findLastSuccessfulSync(),
      /*
        THE SECTION, AND NOW ONLY THE SECTION.

        It used to ask for `analytics:read:all` as well, because the queue was
        company-wide by construction and an OWN-scoped account holding the
        Tasdiqlash section would have been shown a bell it could not open —
        clicking it produced a 403 where a number had promised work, and a bell
        that leads to a refusal is worse than no bell.

        The queue narrows now, so the second gate would do the opposite damage:
        a ROP whose board has forty orders waiting on it would be given the
        board and no bell to tell them so. The COUNT is narrowed by the same
        scope the board is — `scope` is threaded into `queuePressure` below —
        so the header and the page behind it still describe one set of rows,
        which is the property this gate has always been protecting.
      */
      canSeeSection(principal, 'confirmation')
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
          cachedQueuePressure(this.insights, scope, timeZone, 120)
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
