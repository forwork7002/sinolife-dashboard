import { z } from 'zod'

import { LEADERBOARD_METRICS_ALL } from '@/server/domain/analytics/sellerClose'
import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { AnalyticsService } from '@/server/services/analyticsService'
import { analyticsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'leaderboard:read', section: 'sellers' } as const

const schema = analyticsQuerySchema.and(
  z.object({
    /**
     * One metric, never a blend. See docs/API.md.
     *
     * Two BASES live in this enum and the difference is not cosmetic:
     * `revenue`, `deals_won`, `conversion` and `kpi_achievement` rank what was
     * DELIVERED; `closed_deals` and `closed_value` rank what the SELLER CLOSED,
     * counted from the history row the seller's won stage leaves behind. Last
     * August those two sets of deals overlapped in 1 152 of 5 375. The default
     * stays `revenue` so no existing link changes meaning.
     */
    metric: z.enum(LEADERBOARD_METRICS_ALL).default('revenue'),
  }),
)

/**
 * The standings, narrowed to the rows the caller may read.
 *
 * `ctx.scope` IS applied, and it is spread last. This route used to argue that
 * a ranking each person can only see themselves in is not a ranking, and so
 * served every account the whole company — but `leaderboard:read` is a
 * permission every active account holds, which made this and `/analytics/
 * sellers` the two endpoints where a scoped salesperson read the firm's
 * numbers while every other company-wide screen refused them. An ALL-scoped
 * account still reads the company; a ROP reads their own team ranked among
 * themselves, which is a ranking and is the one they are accountable for.
 *
 * `analyticsService.leaderboard` folds the restriction into the roster's own
 * id filter (`narrowEmployeeIds`), so ranking happens AFTER the narrowing and
 * no rank has a hole in it where somebody out of scope was removed.
 *
 * It is company-wide but NOT everyone: it ranks salespeople only, and the
 * `meta.leaderboardScope` block states who that leaves out. No parameter opens
 * it back up to managers — a board that can be switched back to "everyone" is a
 * board that will be read as everyone. See analyticsService.leaderboard.
 */
export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const context = AnalyticsService.context(
    period,
    ctx.currency,
    { ...ctx.query, ...ctx.scope },
    ctx.now,
  )
  const { rows, scope, sellerCloseBasis } = await analyticsService.leaderboard(
    context,
    ctx.query.metric,
  )

  // `data` stays the bare row array the overview page also reads.
  return {
    data: rows,
    meta: {
      ...AnalyticsService.periodMeta(context),
      ...AnalyticsService.leaderboardScopeMeta(scope),
      // How `closedCount` / `closedValue` on every row were arrived at, and
      // whether they were measured at all.
      ...AnalyticsService.sellerCloseBasisMeta(sellerCloseBasis),
    },
  }
})
