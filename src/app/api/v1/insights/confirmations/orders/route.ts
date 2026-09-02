import { toPeriodDto } from '@/server/domain/period/period'
import { buildPagination } from '@/server/http/envelope'
import { getHandler, periodFrom } from '@/server/http/handler'
import { confirmationOrdersQuerySchema } from '@/server/http/queryParams'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * The Тасдиклаш queue, one row per order.
 *
 * A sibling of `/insights/confirmations` rather than a replacement for it:
 * that endpoint answers "how does each operator work their queue", this one
 * answers "what happened to the orders".
 *
 * THE SIBLING NO LONGER FEEDS ANYTHING. This comment used to say it fed the
 * overview tile; the command centre moved to `confirmationOutcomes` for speed
 * and nothing in `src/features` has called `/insights/confirmations` since.
 * The two are also not interchangeable: it counts every order that entered a
 * PENDING_CONFIRM stage during the window (3,210 for one August) while this
 * one counts every order CREATED in the window that reached any confirmation
 * stage (3,049) — two populations, both fielded as `orders`. Nothing on a
 * screen compares them today; if one ever does, that is the first thing to
 * reconcile.
 */
export const GET = getHandler(
  { permission: 'analytics:read:all', section: 'confirmation' },
  confirmationOrdersQuerySchema,
  async (ctx) => {
    const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)

    const { items, totalItems, rops, byRop, totals } = await insightsService.confirmationQueue(
      period,
      {
        outcomes: ctx.query.outcomes,
        rop: ctx.query.rop,
        q: ctx.query.q,
        page: ctx.query.page,
        pageSize: ctx.query.pageSize,
        sort: ctx.query.sort,
        order: ctx.query.order,
      },
      {},
      ctx.query.queue,
    )

    return {
      data: {
        items,
        pagination: buildPagination(ctx.query.page, ctx.query.pageSize, totalItems),
        rops,
        byRop,
        totals,
      },
      meta: { period: toPeriodDto(period) },
    }
  },
)
