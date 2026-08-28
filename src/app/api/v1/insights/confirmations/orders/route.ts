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
 * that endpoint answers "how does each operator work their queue" and feeds
 * the overview tile, this one answers "what happened to the orders". Folding
 * them together would have broken the overview to save a route file.
 */
export const GET = getHandler(
  'analytics:read:all',
  confirmationOrdersQuerySchema,
  async (ctx) => {
    const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)

    const { items, totalItems, rops, byRop, totals } = await insightsService.confirmationQueue(period, {
      outcomes: ctx.query.outcomes,
      rop: ctx.query.rop,
      q: ctx.query.q,
      page: ctx.query.page,
      pageSize: ctx.query.pageSize,
      sort: ctx.query.sort,
      order: ctx.query.order,
    })

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
