/**
 * What the header says at a glance, on every screen.
 *
 * Three facts a person wants before they read any number: whether the
 * numbers are current, whether anything is waiting on them, and whether
 * anything has gone wrong. Each is CHEAP by construction — one row from the
 * sync log, one aggregate over today's queue, one two-column read of the
 * marketing ledger — because this payload is fetched by every page every
 * minute, and a header that costs a second per page is a header nobody keeps.
 *
 * GATED THE SAME WAY THE SCREENS ARE. The bell reads the confirmation queue,
 * so an account without that section gets no bell rather than a count of
 * something it may not open; the marketing warning likewise. A header that
 * disclosed "3 waiting" to somebody barred from the queue would be the
 * boundary leaking through the chrome.
 */

import type { Principal } from '@/server/auth/rbac'
import { canSeeSection } from '@/server/auth/rbac'
import { resolvePeriod } from '@/server/domain/period/period'
import type { InsightsRepository } from '@/server/repositories/insightsRepository'
import type { MarketingRepository } from '@/server/repositories/marketingRepository'
import type { ReferenceRepository } from '@/server/repositories/referenceRepository'

export interface AlertDto {
  readonly key: 'sync-stale' | 'sync-failed' | 'queue-overdue' | 'feed-gap'
  readonly severity: 'warning' | 'critical'
  readonly label: string
  /** Where to go about it. Absent when the fix is not on this dashboard. */
  readonly href?: string
}

export interface AlertsDto {
  /** The last successful sync, or null when none has ever completed. */
  readonly syncedAt: string | null
  /** Minutes since then, already computed so the client need not own a clock. */
  readonly syncAgeMinutes: number | null
  /** Today's queue, or null when this account may not see the queue at all. */
  readonly queue: { readonly pending: number; readonly overdue: number } | null
  readonly alerts: readonly AlertDto[]
}

/** The worker ticks every sixty seconds, so five missed ticks is a fault. */
const STALE_AFTER_MINUTES = 5
/** Fifteen means the worker is down, not busy. */
const DOWN_AFTER_MINUTES = 15

export class AlertsService {
  constructor(
    private readonly insights: InsightsRepository,
    private readonly reference: ReferenceRepository,
    private readonly marketing: MarketingRepository,
  ) {}

  async load(principal: Principal, now: Date, timeZone: string): Promise<AlertsDto> {
    const seesQueue = canSeeSection(principal, 'confirmation')
    const seesMarketing = canSeeSection(principal, 'marketing')

    const [syncedAt, lastTick, queue, feed] = await Promise.all([
      this.reference.findLastSuccessfulSync(),
      this.reference.findLastSyncOutcome(),
      seesQueue
        ? this.insights.queuePressure(resolvePeriod('today', { timeZone, now }))
        : Promise.resolve(null),
      seesMarketing ? this.marketing.feedCoverage() : Promise.resolve(null),
    ])

    const alerts: AlertDto[] = []

    const syncAgeMinutes =
      syncedAt === null ? null : Math.max(0, Math.floor((now.getTime() - syncedAt.getTime()) / 60_000))

    if (syncAgeMinutes !== null && syncAgeMinutes >= STALE_AFTER_MINUTES) {
      alerts.push({
        key: 'sync-stale',
        severity: syncAgeMinutes >= DOWN_AFTER_MINUTES ? 'critical' : 'warning',
        label: `Maʼlumot ${syncAgeMinutes} daqiqadan beri yangilanmagan`,
      })
    }

    // A failed tick is worth saying even when a later one succeeded within
    // the stale window: an entity that keeps failing leaves its table frozen
    // while the freshness dot stays green for the ones that did not.
    if (lastTick?.status === 'FAILED') {
      alerts.push({
        key: 'sync-failed',
        severity: 'critical',
        label: `Oxirgi sinxronizatsiya xato bilan tugadi (${lastTick.entity})`,
      })
    }

    if (queue && queue.overdue > 0) {
      alerts.push({
        key: 'queue-overdue',
        severity: 'warning',
        label: `${queue.overdue} ta buyurtma navbatda 2 soatdan koʻp kutmoqda`,
        href: '/confirmation?preset=today&outcomes=CONFIRM_NEW',
      })
    }

    if (feed && feed.adsThrough && feed.salesThrough && feed.adsThrough < feed.salesThrough) {
      const gapDays = Math.round(
        (Date.parse(feed.salesThrough) - Date.parse(feed.adsThrough)) / 86_400_000,
      )
      alerts.push({
        key: 'feed-gap',
        severity: 'warning',
        label: `Reklama maʼlumoti savdodan ${gapDays} kun orqada — ROAS oshirib koʻrsatiladi`,
        href: '/marketing',
      })
    }

    return {
      syncedAt: syncedAt?.toISOString() ?? null,
      syncAgeMinutes,
      queue,
      alerts,
    }
  }
}
